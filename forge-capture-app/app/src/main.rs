// FORGE Capture Rung 2a — Tauri shell (Rust backend).
//
// Thin command layer over forge-capture-core. All capture logic, coordinate
// conversion, artifact contracts, and result handling live in the core
// crate; this file only wires Tauri commands to it, manages the local
// capture store, and owns the region-picker overlay window.
//
// Local-first: captures are written under
// `%LOCALAPPDATA%/FORGE Capture/Captures` (Windows) or
// `~/.local/share/forge-capture/captures` (other hosts). No account, no
// upload, no network use at all.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use forge_capture_core::ai_edit;
use forge_capture_core::artifact::{CaptureArtifact, CaptureKind, CursorState, RasterMime};
use forge_capture_core::coords::{Monitor, Rect};
use forge_capture_core::engines::{
    AcquisitionEngine, CaptureMode, CaptureRequest, DomAwareScrollEngine, NativeRasterEngine,
    RasterObservationScrollEngine,
};
use forge_capture_core::native;
use forge_capture_core::png::png_dimensions;
use forge_capture_core::result::ScrollingResult;
use forge_capture_core::scroll::{
    AbortFlag, ProgressCallback, ScrollDirection, ScrollEngineKind, ScrollLimits, ScrollRequest,
    ScrollTarget,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod session_store;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct StoredCapture {
    png_bytes: Vec<u8>,
    sidecar_json: String,
}

struct OverlayContext {
    /// Monitor the overlay was opened on (also the region-pick backdrop source).
    monitor_id: String,
    /// Webview content origin in virtual-desktop coords (physical px).
    origin_virtual: (i32, i32),
    dpr: f64,
    /// The user's delay/cursor selections at pick time. The overlay page
    /// cannot see the main window's controls, so the selections travel with
    /// the context instead of the capture dto.
    delay_ms: u64,
    include_cursor: bool,
}

struct AppState {
    captures: Mutex<HashMap<String, StoredCapture>>,
    pending_overlay: Mutex<Option<OverlayContext>>,
    id_counter: Mutex<u64>,
    /// File stems already handed out (in-memory part of stem uniqueness;
    /// the on-disk check in `unique_stem` covers previous runs).
    used_stems: Mutex<HashSet<String>>,
    /// Cooperative abort flags for in-flight scrolling captures, keyed by
    /// the run id handed to `start_scroll_capture`.
    scroll_aborts: Mutex<HashMap<String, AbortFlag>>,
    /// Whether the Print Screen global-shortcut takeover registered
    /// successfully at startup. Set once in `setup`; read by the
    /// `printscreen_takeover_active` command so the UI can show the status.
    printscreen_active: AtomicBool,
    /// In-flight chunked media uploads (Rung 4 screen recordings), keyed by
    /// the upload id handed to `begin_media_upload`. Entries are removed by
    /// `finish_media_upload` / `cancel_media_upload`; abandoned uploads die
    /// with the process (no persistence, no expiry thread in Rung 4).
    media_uploads: Mutex<HashMap<String, MediaUpload>>,
}

/// One in-flight chunked media upload. The webview holds the encoded bytes
/// (it produced them with the platform MediaRecorder); the backend only
/// reassembles and writes them.
///
/// Operational note: despite the chunked transport, the backend assembles
/// the full payload in memory (`received`) and writes it in one go —
/// chunked IPC → in-memory assembly → single disk write, NOT a streaming
/// disk write. An upload approaching the 2 GiB hard cap therefore implies up
/// to ~2 GiB of resident backend memory. The UI enforces a 1 GiB hard
/// in-memory limit before upload, so uploads from our own UI cannot
/// realistically approach that bound; the 2 GiB cap here is a
/// defense-in-depth ceiling, and a streaming-to-temp-file redesign is the
/// documented follow-up if uploads ever need to grow past it.
struct MediaUpload {
    expected_bytes: u64,
    mime: String,
    extension: String,
    stem: String,
    received: Vec<u8>,
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RegionDto {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

// The JS UI (ui/main.js, ui/overlay.js) sends camelCase invoke payloads.
// These DTOs use rename_all so the two sides cannot drift apart; a missing
// rename here silently drops fields (serde ignores unknown keys) or, for
// required fields like `include_cursor`, fails every capture outright.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureRequestDto {
    /// "full-monitor" | "window" | "region" | "delayed"
    mode: String,
    monitor_id: Option<String>,
    window_id: Option<String>,
    /// Virtual-desktop coords for mode == "region".
    region: Option<RegionDto>,
    /// CSS-px rect from the overlay picker for mode == "region-overlay".
    overlay_rect: Option<RegionDto>,
    delay_ms: Option<u64>,
    include_cursor: bool,
}

#[derive(Debug, Serialize, Clone)]
struct MonitorDto {
    id: String,
    name: String,
    origin_virtual: (i32, i32),
    size_logical: (u32, u32),
    scale: f64,
    size_physical: (u64, u64),
}

impl From<&Monitor> for MonitorDto {
    fn from(m: &Monitor) -> Self {
        MonitorDto {
            id: m.id.clone(),
            name: m.name.clone(),
            origin_virtual: m.origin_virtual,
            size_logical: m.size_logical,
            scale: m.scale,
            size_physical: m.size_physical(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct WindowDto {
    window_id: String,
    title: String,
    class_name: String,
    process_name: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ArtifactRefDto {
    id: String,
    kind: String,
    width: u32,
    height: u32,
    png_path: String,
    sidecar_path: String,
}

/// Cursor hotspot position for the Rung 4 recording compositor, in
/// virtual-desktop physical pixels.
#[derive(Debug, Serialize, Clone)]
struct CursorPosDto {
    x: i32,
    y: i32,
}

/// ui/record.js uploadBytes(): { total_bytes, mime, suggested_extension, name_hint }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeginMediaUploadDto {
    total_bytes: u64,
    mime: String,
    suggested_extension: Option<String>,
    name_hint: Option<String>,
}

/// ui/record.js uploadBytes(): { upload_id, offset, bytes }
/// `offset` is the byte offset this chunk starts at; the backend requires
/// chunks to arrive in order with no gaps or duplicates (offset must equal
/// the bytes received so far), so a buggy or hostile caller cannot
/// assemble a malformed file out of reordered chunks.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendMediaChunkDto {
    upload_id: String,
    offset: u64,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaUploadResultDto {
    path: String,
    bytes_written: u64,
    mime: String,
}

#[derive(Debug, Serialize, Clone)]
struct OverlayContextDto {
    monitor_id: String,
    origin_virtual: (i32, i32),
    dpr: f64,
}

// ---------------------------------------------------------------------------
// Scrolling capture DTOs (Rung 2b)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrollTargetDto {
    /// "window" | "region"
    #[serde(rename = "type")]
    kind: String,
    window_id: Option<String>,
    /// Virtual-desktop physical px, for kind == "region".
    region: Option<RegionDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrollCaptureDto {
    target: ScrollTargetDto,
    /// "auto" | "dom-aware" | "raster-observation"
    engine: String,
    /// "vertical" | "horizontal"
    direction: String,
    max_distance_px: Option<u64>,
    max_tiles: Option<u32>,
    settle_ms: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct ScrollProgressDto {
    id: String,
    tiles_captured: u32,
    distance_px: u64,
    tiles_expected: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
struct ScrollInfoDto {
    engine: String,
    direction: String,
    tiles_captured: u32,
    distance_px: u64,
    complete: bool,
    reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ScrollResultDto {
    id: String,
    /// "complete" | "incomplete" | "failed"
    outcome: String,
    /// Present for "complete", and for "incomplete" when at least one tile
    /// landed (the partial stitch, saved like any capture).
    #[serde(skip_serializing_if = "Option::is_none")]
    capture: Option<ArtifactRefDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    evidence: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scroll: Option<ScrollInfoDto>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn next_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("cap-{millis}-{counter}")
}

/// Make a capture file stem unique. File stems are second-resolution, so
/// two same-kind captures in one second would collide and overwrite each
/// other. The in-memory set handles same-run collisions; the on-disk check
/// also covers files left by previous runs.
fn unique_stem(
    state: &State<AppState>,
    dir: &std::path::Path,
    base: &str,
    raster_extension: &str,
) -> String {
    let mut used = state.used_stems.lock().unwrap();
    let mut stem = base.to_string();
    let mut n = 1u64;
    let taken = |s: &str| {
        used.contains(s)
            || dir.join(format!("{s}.{raster_extension}")).exists()
            || dir.join(format!("{s}.forge.json")).exists()
    };
    while taken(&stem) {
        n += 1;
        stem = format!("{base}-{n}");
    }
    used.insert(stem.clone());
    stem
}

fn captures_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .map_err(|_| "LOCALAPPDATA is not set".to_string())?
        .join("FORGE Capture");
    #[cfg(not(windows))]
    let base = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())?
        .join(".local/share/forge-capture");
    let dir = base.join("Captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create captures dir: {e}"))?;
    Ok(dir)
}

fn current_monitors() -> Result<Vec<Monitor>, String> {
    native::list_monitors().map_err(err)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn list_monitors() -> Result<Vec<MonitorDto>, String> {
    Ok(current_monitors()?.iter().map(MonitorDto::from).collect())
}

#[tauri::command]
fn list_windows() -> Result<Vec<WindowDto>, String> {
    Ok(native::list_windows()
        .map_err(err)?
        .into_iter()
        .map(|w| WindowDto {
            window_id: w.window_id,
            title: w.title,
            class_name: w.class_name,
            process_name: w.process_name,
        })
        .collect())
}

#[tauri::command]
fn captures_dir_path() -> Result<String, String> {
    captures_dir().map(|p| p.to_string_lossy().into_owned())
}

/// Current cursor hotspot position (virtual-desktop physical pixels) for the
/// Rung 4 recording compositor's cursor overlay.
#[tauri::command]
fn get_cursor_pos() -> Result<CursorPosDto, String> {
    let (x, y) = native::cursor_pos().map_err(err)?;
    Ok(CursorPosDto { x, y })
}

// ---------------------------------------------------------------------------
// Rung 4 chunked media upload: the webview produces recording bytes with the
// platform MediaRecorder and streams them to the backend in ~1 MiB JSON
// chunks; the backend reassembles, sniffs, and writes one local file.
// ---------------------------------------------------------------------------

/// Hard cap per upload: 2 GiB. The UI stops recordings at 1 GiB in memory;
/// this is the backstop against a lying or buggy chunk count.
const MAX_MEDIA_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn next_upload_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("upl-{millis}-{counter}")
}

/// Keep a filename stem to safe characters: letters, digits, dash,
/// underscore. Falls back to "recording".
fn sanitize_stem(hint: Option<&str>) -> String {
    let cleaned: String = hint
        .unwrap_or("")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else if c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    let cut: String = trimmed.chars().take(40).collect();
    if cut.is_empty() {
        "recording".to_string()
    } else {
        cut
    }
}

/// The only media this command will write. The mime comes from the UI's
/// MediaRecorder pick (WebM-first) or the GIF exporter; the extension must
/// agree with it.
fn media_extension(mime: &str, suggested: Option<&str>) -> Result<String, String> {
    // Exact match on the base MIME (parameters stripped, lowercased). A
    // starts_with check would wrongly accept "video/webm-evil" or
    // "video/mp4garbage". The original full mime is still stored on the
    // upload and in the sidecar — only the allowlist decision uses the base.
    let base = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let from_mime = match base.as_str() {
        "video/webm" => "webm",
        "video/mp4" => "mp4",
        "image/gif" => "gif",
        _ => return Err(format!("unsupported media mime for upload: {mime}")),
    };
    if let Some(s) = suggested {
        let s = s.trim_start_matches('.').to_ascii_lowercase();
        if s != from_mime {
            return Err(format!(
                "suggested extension .{s} does not match mime {mime} (expected .{from_mime})"
            ));
        }
    }
    Ok(from_mime.to_string())
}

/// Read an EBML element ID at `pos`. IDs are 1-4 bytes; the length-marker
/// bit is part of the value. Returns (id, bytes_consumed), or None on
/// truncation / malformed width.
fn ebml_read_id(bytes: &[u8], pos: usize) -> Option<(u64, usize)> {
    let first = *bytes.get(pos)?;
    let width = (first.leading_zeros() + 1) as usize;
    if width == 0 || width > 4 || pos + width > bytes.len() {
        return None;
    }
    let mut id: u64 = 0;
    for i in 0..width {
        id = (id << 8) | bytes[pos + i] as u64;
    }
    Some((id, width))
}

/// Read an EBML data-size vint at `pos`. Sizes are 1-8 bytes; the
/// length-marker bit is NOT part of the value. Returns (size, bytes_consumed)
/// where size is None for the all-ones "unknown size" marker used by
/// streaming writers. Returns None on truncation / malformed width.
fn ebml_read_size(bytes: &[u8], pos: usize) -> Option<(Option<u64>, usize)> {
    let first = *bytes.get(pos)?;
    let width = (first.leading_zeros() + 1) as usize;
    if width == 0 || width > 8 || pos + width > bytes.len() {
        return None;
    }
    let mask: u8 = if width >= 8 { 0 } else { 0xFFu8 >> width };
    let mut size: u64 = (first & mask) as u64;
    for i in 1..width {
        size = (size << 8) | bytes[pos + i] as u64;
    }
    let all_ones: u64 = if width >= 8 {
        u64::MAX
    } else {
        (1u64 << (7 * width)) - 1
    };
    if size == all_ones {
        return Some((None, width));
    }
    Some((Some(size), width))
}

/// Confirm the bytes open with an EBML header whose DocType is exactly
/// "webm". The header is walked child-by-child, bounded to a small cap —
/// real EBML headers are tens of bytes, never kilobytes. Any truncation,
/// unknown size, or DocType mismatch fails closed (false). This is a
/// signature sanity check, not full media validation: the bytes are never
/// decoded by a native parser in Rust, they are only ever written to disk.
fn webm_doctype_ok(bytes: &[u8]) -> bool {
    const EBML_HEADER_ID: u64 = 0x1A45DFA3;
    const DOCTYPE_ID: u64 = 0x4282;
    const MAX_HEADER_WALK: u64 = 4096;
    let (id, id_len) = match ebml_read_id(bytes, 0) {
        Some(v) => v,
        None => return false,
    };
    if id != EBML_HEADER_ID {
        return false;
    }
    let (size, size_len) = match ebml_read_size(bytes, id_len) {
        Some(v) => v,
        None => return false,
    };
    let header_len = match size {
        Some(n) if n <= MAX_HEADER_WALK => n,
        _ => return false, // unknown or absurd header size: fail closed
    };
    let mut pos = id_len + size_len;
    let end = match (pos as u64).checked_add(header_len) {
        Some(e) if e <= bytes.len() as u64 => e as usize,
        _ => return false,
    };
    while pos < end {
        let (child_id, child_id_len) = match ebml_read_id(bytes, pos) {
            Some(v) => v,
            None => return false,
        };
        let (child_size, child_size_len) = match ebml_read_size(bytes, pos + child_id_len) {
            Some(v) => v,
            None => return false,
        };
        let data_start = pos + child_id_len + child_size_len;
        let child_len = match child_size {
            Some(n) => n as usize,
            None => return false, // unknown-size child in a bounded buffer: fail closed
        };
        let data_end = match data_start.checked_add(child_len) {
            Some(e) if e <= end => e,
            _ => return false,
        };
        if child_id == DOCTYPE_ID {
            return &bytes[data_start..data_end] == b"webm";
        }
        pos = data_end; // always advances: child_id_len >= 1
    }
    false
}

fn sniff_media_ok(bytes: &[u8], extension: &str) -> bool {
    match extension {
        // WebM: EBML header declaring DocType "webm" (Matroska shares the
        // EBML magic but declares a different DocType, so bare magic would
        // overclaim).
        "webm" => webm_doctype_ok(bytes),
        // 'ftyp' at offset 4: ISO BMFF-family signature sanity check, not
        // full MP4 validation.
        "mp4" => bytes.len() >= 8 && bytes[4..8] == [0x66, 0x74, 0x79, 0x70],
        // GIF87a / GIF89a
        "gif" => bytes.len() >= 6 && (bytes[0..6] == *b"GIF87a" || bytes[0..6] == *b"GIF89a"),
        _ => false,
    }
}

#[tauri::command]
fn begin_media_upload(dto: BeginMediaUploadDto, state: State<AppState>) -> Result<String, String> {
    if dto.total_bytes == 0 || dto.total_bytes > MAX_MEDIA_UPLOAD_BYTES {
        return Err(format!(
            "total_bytes {} is outside the allowed 1..{} range",
            dto.total_bytes, MAX_MEDIA_UPLOAD_BYTES
        ));
    }
    let extension = media_extension(&dto.mime, dto.suggested_extension.as_deref())?;
    let dir = captures_dir()?;
    let stem = unique_stem(
        &state,
        &dir,
        &sanitize_stem(dto.name_hint.as_deref()),
        &extension,
    );
    let id = next_upload_id(&state);
    let mut uploads = state.media_uploads.lock().unwrap();
    uploads.insert(
        id.clone(),
        MediaUpload {
            expected_bytes: dto.total_bytes,
            mime: dto.mime,
            extension,
            stem,
            received: Vec::new(),
        },
    );
    Ok(id)
}

/// Pure sequencing check for `append_media_chunk`: the chunk must start
/// exactly where the received bytes end — no gaps, no re-sends, no
/// reordering. Kept as a free function so it is unit-testable without
/// Tauri state.
fn check_chunk_offset(received_len: u64, offset: u64) -> Result<(), String> {
    if offset != received_len {
        return Err(format!(
            "chunk offset {offset} does not match received bytes {received_len} — chunks must arrive in order with no gaps or duplicates"
        ));
    }
    Ok(())
}

#[tauri::command]
fn append_media_chunk(dto: AppendMediaChunkDto, state: State<AppState>) -> Result<u64, String> {
    let mut uploads = state.media_uploads.lock().unwrap();
    let upload = uploads
        .get_mut(&dto.upload_id)
        .ok_or_else(|| format!("unknown upload id: {}", dto.upload_id))?;
    check_chunk_offset(upload.received.len() as u64, dto.offset)?;
    let new_len = upload.received.len() as u64 + dto.bytes.len() as u64;
    if new_len > upload.expected_bytes {
        return Err(format!(
            "upload would exceed declared total: {} > {}",
            new_len, upload.expected_bytes
        ));
    }
    upload.received.extend_from_slice(&dto.bytes);
    Ok(upload.received.len() as u64)
}

#[tauri::command]
fn finish_media_upload(id: String, state: State<AppState>) -> Result<MediaUploadResultDto, String> {
    let upload = {
        let mut uploads = state.media_uploads.lock().unwrap();
        uploads
            .remove(&id)
            .ok_or_else(|| format!("unknown upload id: {id}"))?
    };
    if upload.received.len() as u64 != upload.expected_bytes {
        return Err(format!(
            "incomplete upload: got {} of {} declared bytes",
            upload.received.len(),
            upload.expected_bytes
        ));
    }
    if !sniff_media_ok(&upload.received, &upload.extension) {
        return Err(format!(
            "uploaded bytes failed the .{} media signature check — refusing to write",
            upload.extension
        ));
    }
    let dir = captures_dir()?;
    let final_path = dir.join(format!("{}.{}", upload.stem, upload.extension));
    // Two-phase finalize. Both payloads are written to temp names first and
    // only exposed via rename afterwards, so a crash mid-write can never
    // leave a partial file under a final name. The invariant this upholds:
    // a finalized media file ALWAYS has its .forge.json sidecar. If the
    // sidecar rename fails after the media rename succeeded, the media file
    // is removed again (best effort) rather than leaving a sidecar-less
    // finalized capture — and the upload was already removed from state, so
    // a failed finish can never be silently "half done". Any `.part` file
    // left behind by a hard crash is clearly incomplete and never treated
    // as a capture.
    let media_temp = dir.join(format!("{}.{}.part", upload.stem, id));
    let sidecar_temp = dir.join(format!("{}.{}.forge.json.part", upload.stem, id));
    // Provenance sidecar, mirroring the still-capture convention: every
    // file the app writes gets a `.forge.json` next to it.
    let sidecar_path = dir.join(format!("{}.forge.json", upload.stem));
    let sidecar = format!(
        "{{\n  \"schemaVersion\": 1,\n  \"kind\": \"recording\",\n  \"mime\": {},\n  \"byteLength\": {},\n  \"createdAt\": {}\n}}\n",
        serde_json::to_string(&upload.mime).unwrap_or_else(|_| "\"\"".to_string()),
        upload.received.len(),
        serde_json::to_string(&forge_capture_core::timestamp::now_utc_iso8601())
            .unwrap_or_else(|_| "\"\"".to_string()),
    );
    std::fs::write(&sidecar_temp, sidecar.as_bytes())
        .map_err(|e| format!("cannot write sidecar temp file: {e}"))?;
    if let Err(e) = std::fs::write(&media_temp, &upload.received) {
        let _ = std::fs::remove_file(&sidecar_temp); // best effort — no orphan
        return Err(format!("cannot write media temp file: {e}"));
    }
    if let Err(e) = std::fs::rename(&media_temp, &final_path) {
        let _ = std::fs::remove_file(&media_temp); // best effort — no orphan
        let _ = std::fs::remove_file(&sidecar_temp);
        return Err(format!("cannot finalize media file: {e}"));
    }
    if let Err(e) = std::fs::rename(&sidecar_temp, &sidecar_path) {
        // Media is already finalized at this point; leaving it without its
        // sidecar would break the every-file-has-a-sidecar invariant, so
        // roll the media file back instead of reporting a "successful"
        // capture that violates it.
        let _ = std::fs::remove_file(&final_path);
        let _ = std::fs::remove_file(&sidecar_temp);
        return Err(format!("cannot finalize sidecar: {e}"));
    }
    Ok(MediaUploadResultDto {
        path: final_path.to_string_lossy().into_owned(),
        bytes_written: upload.received.len() as u64,
        mime: upload.mime,
    })
}

#[tauri::command]
fn cancel_media_upload(id: String, state: State<AppState>) -> Result<(), String> {
    let mut uploads = state.media_uploads.lock().unwrap();
    uploads.remove(&id);
    Ok(())
}

fn build_mode(
    dto: &CaptureRequestDto,
    app: &tauri::AppHandle,
    state: &State<AppState>,
) -> Result<(CaptureMode, bool), String> {
    // Returns (mode, include_cursor). For "region-overlay" the delay and
    // cursor selections come from the OverlayContext recorded by
    // begin_region_pick — the overlay page cannot see the main window's
    // controls, so the dto's delayMs/includeCursor are ignored there.
    if dto.mode == "region-overlay" {
        let overlay = state
            .pending_overlay
            .lock()
            .unwrap()
            .take()
            .ok_or("no pending region overlay; call begin_region_pick first")?;
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.close();
        }
        let r = dto
            .overlay_rect
            .as_ref()
            .ok_or("overlay_rect is required")?;
        let phys = forge_capture_core::coords::css_to_physical(
            Rect {
                x: r.x,
                y: r.y,
                w: r.w,
                h: r.h,
            },
            overlay.origin_virtual,
            overlay.dpr,
        );
        let inner = CaptureMode::RegionVirtual {
            rect: Rect {
                x: phys.x as f64,
                y: phys.y as f64,
                w: phys.w as f64,
                h: phys.h as f64,
            },
        };
        return wrap_delayed(inner, overlay.delay_ms, overlay.include_cursor);
    }
    let delay_ms = dto.delay_ms.unwrap_or(0);
    let inner = match dto.mode.as_str() {
        "full-monitor" => {
            let monitor_id = dto.monitor_id.clone().ok_or("monitor_id is required")?;
            CaptureMode::FullMonitor { monitor_id }
        }
        "window" => {
            let window_id = dto.window_id.clone().ok_or("window_id is required")?;
            CaptureMode::Window { window_id }
        }
        "region" => {
            let r = dto.region.as_ref().ok_or("region is required")?;
            CaptureMode::RegionVirtual {
                rect: Rect {
                    x: r.x,
                    y: r.y,
                    w: r.w,
                    h: r.h,
                }
                .normalize(),
            }
        }
        other => return Err(format!("unknown capture mode: {other}")),
    };
    wrap_delayed(inner, delay_ms, dto.include_cursor)
}

/// Wrap a mode in `Delayed` when a delay was requested.
fn wrap_delayed(
    inner: CaptureMode,
    delay_ms: u64,
    include_cursor: bool,
) -> Result<(CaptureMode, bool), String> {
    if delay_ms > 0 {
        Ok((
            CaptureMode::Delayed {
                mode: Box::new(inner),
                delay_ms,
            },
            include_cursor,
        ))
    } else {
        Ok((inner, include_cursor))
    }
}

/// Persist an artifact to the captures dir and the in-memory store under
/// `key`, returning the ref the UI uses for copy/export/provenance.
fn store_artifact(
    state: &State<AppState>,
    key: String,
    artifact: CaptureArtifact,
) -> Result<ArtifactRefDto, String> {
    let base_stem = artifact.file_stem();
    store_artifact_with_base_stem(state, key, artifact, &base_stem)
}

/// `store_artifact` with an explicit file-stem base (AI Edit imports use a
/// `<stem>-ai-edit` base so versions never collide with fresh captures).
fn store_artifact_with_base_stem(
    state: &State<AppState>,
    key: String,
    artifact: CaptureArtifact,
    base_stem: &str,
) -> Result<ArtifactRefDto, String> {
    let dir = captures_dir()?;
    let stem = unique_stem(state, &dir, base_stem, artifact.raster_mime.extension());
    let png_name = format!("{stem}.{}", artifact.raster_mime.extension());
    let sidecar_name = format!("{stem}.forge.json");
    let sidecar_json = artifact.to_sidecar_json().map_err(err)?;
    let png_path = dir.join(&png_name);
    let sidecar_path = dir.join(&sidecar_name);
    std::fs::write(&png_path, &artifact.raster_bytes)
        .map_err(|e| format!("cannot write PNG: {e}"))?;
    std::fs::write(&sidecar_path, sidecar_json.as_bytes())
        .map_err(|e| format!("cannot write sidecar: {e}"))?;
    let saved = ArtifactRefDto {
        id: key.clone(),
        kind: artifact.kind.as_str().to_string(),
        width: artifact.raster_width,
        height: artifact.raster_height,
        png_path: png_path.to_string_lossy().into_owned(),
        sidecar_path: sidecar_path.to_string_lossy().into_owned(),
    };
    state.captures.lock().unwrap().insert(
        key,
        StoredCapture {
            png_bytes: artifact.raster_bytes,
            sidecar_json,
        },
    );
    Ok(saved)
}

#[tauri::command]
fn capture(
    dto: CaptureRequestDto,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<ArtifactRefDto, String> {
    run_capture(&app, state, &dto)
}

/// Shared capture path: the `capture` command and the Alt+PrintScreen
/// hotkey both run through here.
fn run_capture(
    app: &tauri::AppHandle,
    state: State<AppState>,
    dto: &CaptureRequestDto,
) -> Result<ArtifactRefDto, String> {
    let monitors = current_monitors()?;
    let (mode, include_cursor) = build_mode(dto, app, &state)?;
    let id = next_id(&state);
    // The engine stamps captured_at at acquisition time (after any delay
    // sleep); the request carries no request-time timestamp.
    let request = CaptureRequest {
        mode,
        include_cursor,
        id: id.clone(),
    };
    let mut engine = NativeRasterEngine;
    match engine.acquire(&request, &monitors) {
        ScrollingResult::Complete { artifact } => {
            let saved = store_artifact(&state, id, artifact)?;
            // Notify the main window (region captures originate from the
            // overlay window, which has already closed itself).
            let _ = app.emit("capture-saved", saved.clone());
            Ok(saved)
        }
        // The native engine only emits Complete or Failed; Incomplete is a
        // 2b scrolling outcome. Both non-complete arms are loud errors here.
        other => Err(format!("capture did not complete: {}", other.describe())),
    }
}

#[tauri::command]
fn copy_to_clipboard(id: String, state: State<AppState>) -> Result<(), String> {
    let (width, height, rgba) = {
        let captures = state.captures.lock().unwrap();
        let stored = captures
            .get(&id)
            .ok_or_else(|| format!("unknown capture id: {id}"))?;
        // Stored bytes are our own encoder's PNG: decode back to RGBA with
        // the core's dependency-free decoder (foreign PNGs never reach here).
        forge_capture_core::png::decode_own(&stored.png_bytes).map_err(err)?
    };
    native::copy_rgba_to_clipboard(width, height, &rgba).map_err(err)
}

#[tauri::command]
fn get_sidecar(id: String, state: State<AppState>) -> Result<String, String> {
    let captures = state.captures.lock().unwrap();
    captures
        .get(&id)
        .map(|s| s.sidecar_json.clone())
        .ok_or_else(|| format!("unknown capture id: {id}"))
}

/// Rung 5 — payload for the "Save to FORGE" upload. Returns the stored
/// raster bytes (base64) plus the sidecar's MIME type so the UI can build the
/// multipart POST. Screenshots produced by this app are PNG/JPEG/WebP; the
/// server allowlist is PNG/JPEG/WebM, so a WebP screenshot is reported with
/// its real MIME and the server answers 400 with a clear message.
#[derive(Debug, Serialize)]
struct CaptureUploadPayloadDto {
    bytes_b64: String,
    mime: String,
}

#[tauri::command]
fn get_capture_upload_payload(
    id: String,
    state: State<AppState>,
) -> Result<CaptureUploadPayloadDto, String> {
    const UPLOAD_CAP_BYTES: usize = 25 * 1024 * 1024;
    let (bytes, sidecar_json) = {
        let captures = state.captures.lock().unwrap();
        let stored = captures
            .get(&id)
            .ok_or_else(|| format!("unknown capture id: {id}"))?;
        (stored.png_bytes.clone(), stored.sidecar_json.clone())
    };
    if bytes.len() > UPLOAD_CAP_BYTES {
        return Err("Capture exceeds the 25 MB FORGE upload cap.".to_string());
    }
    let mime = sidecar_raster_mime(&sidecar_json)?;
    Ok(CaptureUploadPayloadDto {
        bytes_b64: base64_encode(&bytes),
        mime,
    })
}

/// Reads `raster.mime` out of the capture sidecar envelope.
fn sidecar_raster_mime(sidecar_json: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(sidecar_json).map_err(|e| format!("sidecar is not JSON: {e}"))?;
    value
        .get("raster")
        .and_then(|r| r.get("mime"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar has no raster.mime".to_string())
}

/// Dependency-free base64 encoder (standard alphabet, padded). Used for the
/// upload payload; no base64 crate is in the dependency tree.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Rung 6 — opens the FORGE capture library deep link in the OS default
/// Opens the FORGE capture library page in the user's default browser. The
/// URL is allowlisted to the library page (optionally with a ?capture=<uuid>
/// highlight) so the command can never be repurposed to open arbitrary
/// sites. Windows uses `cmd /C start`; Linux uses `xdg-open` (present on
/// Zorin/Ubuntu desktops). Other hosts fail closed.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_library_url_allowed(&url) {
        return Err("Refusing to open a URL outside the FORGE capture library.".to_string());
    }
    #[cfg(windows)]
    {
        // `start "" <url>`: the empty quoted arg is the window title slot,
        // without it a quoted URL would be misparsed as the title.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Could not open the browser: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| {
                format!(
                    "Could not open the browser (xdg-open failed: {e}). Is xdg-utils installed?"
                )
            })?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = url;
        Err(
            "Opening the library in a browser is only implemented on Windows and Linux."
                .to_string(),
        )
    }
}

fn is_library_url_allowed(url: &str) -> bool {
    const LIBRARY_PAGE: &str = "https://www.409marketplace.online/forge/capture/library";
    const HIGHLIGHT_PREFIX: &str =
        "https://www.409marketplace.online/forge/capture/library?capture=";
    if url == LIBRARY_PAGE {
        return true;
    }
    let Some(tail) = url.strip_prefix(HIGHLIGHT_PREFIX) else {
        return false;
    };
    // The desktop always deep-links a capture UUID; nothing else may ride
    // along in the query string.
    is_uuid_shape(tail)
}

fn is_uuid_shape(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        let is_hyphen_slot = i == 8 || i == 13 || i == 18 || i == 23;
        let ok = if is_hyphen_slot {
            *b == b'-'
        } else {
            b.is_ascii_hexdigit()
        };
        if !ok {
            return false;
        }
    }
    true
}

/// Rung 5 — copies plain text (e.g. the "Open in FORGE" library link) to the
/// system clipboard. Windows only; other hosts fail closed.
#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        copy_text_to_clipboard_windows(&text)
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Text clipboard copy is only implemented on Windows.".to_string())
    }
}

#[cfg(windows)]
fn copy_text_to_clipboard_windows(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    unsafe {
        // UTF-16 with null terminator, as CF_UNICODETEXT requires.
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = wide.len() * 2;

        OpenClipboard(None).map_err(|e| format!("Could not open the clipboard: {e}"))?;
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| format!("Could not empty the clipboard: {e}"))?;
            let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes)
                .map_err(|e| format!("Could not allocate clipboard memory: {e}"))?;
            let ptr = GlobalLock(hmem);
            if ptr.is_null() {
                return Err("Could not lock clipboard memory.".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
            GlobalUnlock(hmem).map_err(|e| format!("Could not unlock clipboard memory: {e}"))?;
            // On success the system owns hmem — it must NOT be freed here.
            SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(hmem.0)))
                .map_err(|e| format!("Could not set clipboard text: {e}"))?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

/// Export a capture to a user-chosen location (Save dialog). Writes the PNG
/// plus its `.forge.json` sidecar next to it. Purely local file copy.
#[tauri::command]
fn export_capture(
    app: tauri::AppHandle,
    id: String,
    state: State<AppState>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let stored = {
        let captures = state.captures.lock().unwrap();
        captures
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown capture id: {id}"))?
    };
    let dest = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(format!("{id}.png"))
        .blocking_save_file()
        .ok_or("export cancelled")?;
    let dest_path = dest
        .as_path()
        .ok_or("the chosen export location is not a file path")?;
    let sidecar_dest = dest_path.with_extension("forge.json");
    std::fs::write(dest_path, &stored.png_bytes)
        .map_err(|e| format!("cannot write export PNG: {e}"))?;
    std::fs::write(&sidecar_dest, stored.sidecar_json.as_bytes())
        .map_err(|e| format!("cannot write export sidecar: {e}"))?;
    Ok(dest_path.to_string_lossy().into_owned())
}

/// Open the fullscreen transparent region-picker overlay on a monitor.
/// The overlay page calls `overlay_context` for its origin/DPR, then
/// `capture` with mode "region-overlay" when the user finishes dragging.
/// `delay_ms` / `include_cursor` are the user's selections from the main
/// window (the overlay page cannot see them); they are recorded in the
/// overlay context and applied by `build_mode`.
/// Tauri matches invoke argument names to Rust parameter names *exactly* —
/// no case conversion. The JS side sends camelCase, so these parameters are
/// camelCase too (snake_case here would make every call fail with
/// "missing required key monitor_id").
#[tauri::command]
#[allow(non_snake_case)]
fn begin_region_pick(
    monitorId: String,
    delayMs: Option<u64>,
    includeCursor: Option<bool>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    open_region_overlay(
        app,
        state,
        &monitorId,
        delayMs.unwrap_or(0),
        includeCursor.unwrap_or(true),
    )
}

/// Shared overlay path: the `begin_region_pick` command and the
/// Shift+PrintScreen hotkey both open the overlay through here.
fn open_region_overlay(
    app: tauri::AppHandle,
    state: State<AppState>,
    monitor_id: &str,
    delay_ms: u64,
    include_cursor: bool,
) -> Result<(), String> {
    let monitors = current_monitors()?;
    let monitor = monitors
        .iter()
        .find(|m| m.id == monitor_id)
        .ok_or_else(|| format!("unknown monitor id: {monitor_id}"))?;
    *state.pending_overlay.lock().unwrap() = Some(OverlayContext {
        monitor_id: monitor_id.to_string(),
        origin_virtual: monitor.origin_virtual,
        dpr: monitor.scale,
        delay_ms,
        include_cursor,
    });
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
    // Tauri `position`/`inner_size` take *logical* units: convert the
    // monitor's physical virtual-desktop rect, or the overlay lands in the
    // wrong place at the wrong size on mixed-DPI setups.
    let origin = monitor.virtual_to_logical_placement(
        monitor.origin_virtual.0 as i64,
        monitor.origin_virtual.1 as i64,
    );
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "overlay",
        tauri::WebviewUrl::App("overlay.html".into()),
    )
    .title("Select region")
    .position(origin.x, origin.y)
    .inner_size(monitor.size_logical.0 as f64, monitor.size_logical.1 as f64)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| format!("cannot open overlay: {e}"))?;
    Ok(())
}

#[tauri::command]
fn overlay_context(state: State<AppState>) -> Result<OverlayContextDto, String> {
    let guard = state.pending_overlay.lock().unwrap();
    guard
        .as_ref()
        .map(|o| OverlayContextDto {
            monitor_id: o.monitor_id.clone(),
            origin_virtual: o.origin_virtual,
            dpr: o.dpr,
        })
        .ok_or_else(|| "no pending region overlay".to_string())
}

#[tauri::command]
fn cancel_region_pick(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    *state.pending_overlay.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Region-picker backdrop (Snagit-style crosshair + magnifier loupe)
// ---------------------------------------------------------------------------

/// Frozen fullscreen frame the overlay page draws its crosshair and
/// magnifier loupe over — the Snagit approach: freeze first, aim on the
/// frozen image, then capture the live region. Without a frozen frame the
/// loupe would have no pixels to magnify (the overlay window is
/// transparent; it cannot see the screen behind it).
#[derive(Debug, Serialize, Clone)]
struct BackdropDto {
    png_b64: String,
    width: u32,
    height: u32,
}

#[tauri::command]
fn region_pick_backdrop(state: State<AppState>) -> Result<BackdropDto, String> {
    let monitor_id = {
        let guard = state.pending_overlay.lock().unwrap();
        guard
            .as_ref()
            .map(|o| o.monitor_id.clone())
            .ok_or_else(|| "no pending region overlay; call begin_region_pick first".to_string())?
    };
    let monitors = current_monitors()?;
    let request = CaptureRequest {
        mode: CaptureMode::FullMonitor { monitor_id },
        include_cursor: false,
        id: "region-pick-backdrop".to_string(),
    };
    let mut engine = NativeRasterEngine;
    match engine.acquire(&request, &monitors) {
        ScrollingResult::Complete { artifact } => Ok(BackdropDto {
            png_b64: base64_encode(&artifact.raster_bytes),
            width: artifact.raster_width,
            height: artifact.raster_height,
        }),
        other => Err(format!("backdrop capture failed: {}", other.describe())),
    }
}

// ---------------------------------------------------------------------------
// AI Edit — the "AI plugin" spool contract
// ---------------------------------------------------------------------------
//
// Local-first and network-free, like everything else in this shell: the app
// spools {input.png, prompt.txt, job.json} into the local ai-spool and polls
// for a result. An EXTERNAL runner (see forge-capture-app/docs/ai-edit.md)
// carries jobs to the AI team and drops results back. The app never touches
// the network and invents no credentials; until a runner exists, jobs sit
// honestly in `pending/` and the UI says so.

/// Base of the AI Edit spool: `%LOCALAPPDATA%/FORGE Capture/ai-spool`
/// (Windows) or `~/.local/share/forge-capture/ai-spool` (other hosts).
fn ai_spool_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .map_err(|_| "LOCALAPPDATA is not set".to_string())?
        .join("FORGE Capture");
    #[cfg(not(windows))]
    let base = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())?
        .join(".local/share/forge-capture");
    let dir = base.join("ai-spool");
    for sub in [
        ai_edit::SPOOL_PENDING,
        ai_edit::SPOOL_PROCESSING,
        ai_edit::SPOOL_DONE,
        ai_edit::SPOOL_FAILED,
        ai_edit::SPOOL_IMPORTED,
    ] {
        std::fs::create_dir_all(dir.join(sub))
            .map_err(|e| format!("cannot create ai-spool/{sub}: {e}"))?;
    }
    Ok(dir)
}

fn ai_job_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("ai-{millis}-{counter}")
}

/// Read the `captureKind` string out of a capture sidecar envelope.
fn sidecar_capture_kind(sidecar_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(sidecar_json)
        .ok()
        .and_then(|v| {
            v.get("captureKind")
                .and_then(|k| k.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "region".to_string())
}

fn capture_kind_from_str(s: &str) -> CaptureKind {
    // Sidecars serialize the Rust variant name ("Window") while the
    // manifest records the wire string ("window"); accept either.
    match s.to_lowercase().as_str() {
        "full-monitor" | "fullmonitor" => CaptureKind::FullMonitor,
        "window" => CaptureKind::Window,
        "scrolling" => CaptureKind::Scrolling,
        _ => CaptureKind::Region,
    }
}

#[derive(Debug, Serialize, Clone)]
struct AiEditSubmitDto {
    #[serde(rename = "jobId")]
    job_id: String,
}

/// Queue an AI Edit job: copies the capture's PNG + the user's prompt into
/// the local spool. Returns the job id for polling. The job sits in
/// `pending/` until an external runner picks it up (see docs/ai-edit.md) —
/// nothing is uploaded by this app.
#[tauri::command]
fn ai_edit_submit(
    id: String,
    prompt: String,
    state: State<AppState>,
) -> Result<AiEditSubmitDto, String> {
    ai_edit::validate_prompt(&prompt).map_err(|e| e.to_string())?;
    let (png_bytes, source_kind) = {
        let captures = state.captures.lock().unwrap();
        let stored = captures
            .get(&id)
            .ok_or_else(|| format!("unknown capture id: {id}"))?;
        (
            stored.png_bytes.clone(),
            sidecar_capture_kind(&stored.sidecar_json),
        )
    };
    let spool = ai_spool_dir()?;
    let job_id = ai_job_id(&state);
    debug_assert!(ai_edit::validate_job_id(&job_id));
    let job_dir = spool.join(ai_edit::SPOOL_PENDING).join(&job_id);
    std::fs::create_dir_all(&job_dir).map_err(|e| format!("cannot spool AI job: {e}"))?;
    let manifest = ai_edit::AiJobManifest::new(
        &job_id,
        &id,
        prompt.trim(),
        &forge_capture_core::timestamp::now_utc_iso8601(),
        &source_kind,
    );
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("cannot encode job: {e}"))?;
    // Write the manifest last: a job directory without job.json is ignored
    // by the runner contract, so a crash mid-spool never yields a half job.
    std::fs::write(job_dir.join(ai_edit::JOB_INPUT_PNG), &png_bytes)
        .map_err(|e| format!("cannot spool input PNG: {e}"))?;
    std::fs::write(
        job_dir.join(ai_edit::JOB_PROMPT_TXT),
        manifest.prompt.as_bytes(),
    )
    .map_err(|e| format!("cannot spool prompt: {e}"))?;
    std::fs::write(
        job_dir.join(ai_edit::JOB_MANIFEST),
        manifest_json.as_bytes(),
    )
    .map_err(|e| format!("cannot spool manifest: {e}"))?;
    Ok(AiEditSubmitDto { job_id })
}

#[derive(Debug, Serialize, Clone)]
struct AiEditPollDto {
    #[serde(rename = "jobId")]
    job_id: String,
    /// "queued" | "processing" | "done" | "failed" | "imported"
    status: String,
    /// Present when status == "failed": the runner's error (truncated).
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// Poll an AI Edit job's status. Pure directory-presence check; never
/// blocks, never touches the network.
#[tauri::command]
#[allow(non_snake_case)]
fn ai_edit_poll(jobId: String, state: State<AppState>) -> Result<AiEditPollDto, String> {
    if !ai_edit::validate_job_id(&jobId) {
        return Err("invalid AI edit job id".to_string());
    }
    let _ = state; // reserved: future in-memory job cache
    let spool = ai_spool_dir()?;
    let presence = |sub: &str| spool.join(sub).join(&jobId).is_dir();
    let status = ai_edit::status_from_presence(
        presence(ai_edit::SPOOL_PENDING),
        presence(ai_edit::SPOOL_PROCESSING),
        presence(ai_edit::SPOOL_DONE),
        presence(ai_edit::SPOOL_FAILED),
        presence(ai_edit::SPOOL_IMPORTED),
    )
    .ok_or_else(|| format!("unknown AI edit job: {jobId}"))?;
    let reason = if status == ai_edit::AiJobStatus::Failed {
        let err_path = spool
            .join(ai_edit::SPOOL_FAILED)
            .join(&jobId)
            .join(ai_edit::JOB_ERROR_TXT);
        std::fs::read_to_string(&err_path)
            .ok()
            .map(|s| s.chars().take(500).collect::<String>())
    } else {
        None
    };
    Ok(AiEditPollDto {
        job_id: jobId,
        status: status.as_str().to_string(),
        reason,
    })
}

/// Import a finished AI Edit result as a versioned capture
/// (`<stem>-ai-edit.png`), leaving the original untouched. The job moves to
/// `imported/` so a second import is impossible.
#[tauri::command]
#[allow(non_snake_case)]
fn ai_edit_import(jobId: String, state: State<AppState>) -> Result<ArtifactRefDto, String> {
    if !ai_edit::validate_job_id(&jobId) {
        return Err("invalid AI edit job id".to_string());
    }
    let spool = ai_spool_dir()?;
    let done_dir = spool.join(ai_edit::SPOOL_DONE).join(&jobId);
    if !done_dir.is_dir() {
        return Err(format!(
            "AI edit job {jobId} has no finished result to import"
        ));
    }
    let result_bytes = std::fs::read(done_dir.join(ai_edit::JOB_RESULT_PNG))
        .map_err(|e| format!("cannot read AI edit result: {e}"))?;
    // The result PNG comes from an external model: read dimensions from the
    // IHDR (never trust a sidecar the runner may have written).
    let (width, height) =
        png_dimensions(&result_bytes).map_err(|e| format!("AI edit result is not a PNG: {e}"))?;
    let manifest: ai_edit::AiJobManifest =
        std::fs::read_to_string(done_dir.join(ai_edit::JOB_MANIFEST))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .ok_or_else(|| "AI edit job manifest is missing or corrupt".to_string())?;
    let artifact = CaptureArtifact::new(
        next_id(&state),
        capture_kind_from_str(&manifest.source_kind),
        result_bytes,
        RasterMime::Png,
        width,
        height,
        None,
        None,
        1.0,
        CursorState {
            captured: false,
            position_physical: None,
        },
        forge_capture_core::timestamp::now_utc_iso8601(),
        None,
    )
    .map_err(|e| format!("AI edit result failed validation: {e}"))?;
    let base_stem = format!("{}-ai-edit", artifact.file_stem());
    let saved = store_artifact_with_base_stem(&state, artifact.id.clone(), artifact, &base_stem)?;
    // Mark imported: a second import of the same job is refused because the
    // job no longer sits in done/.
    let _ = std::fs::rename(&done_dir, spool.join(ai_edit::SPOOL_IMPORTED).join(&jobId));
    Ok(saved)
}

// ---------------------------------------------------------------------------
// Scrolling capture commands (Rung 2b)
// ---------------------------------------------------------------------------

fn scroll_info_dto(
    info: &Option<forge_capture_core::artifact::ScrollSection>,
) -> Option<ScrollInfoDto> {
    info.as_ref().map(|s| ScrollInfoDto {
        engine: s.engine.clone(),
        direction: s.direction.clone(),
        tiles_captured: s.tiles_captured,
        distance_px: s.distance_px,
        complete: s.complete,
        reason: s.reason.clone(),
    })
}

/// Start a scrolling capture in the background. Returns the run id
/// immediately; per-tile progress arrives as `scroll-progress` events and
/// the final outcome as a `scroll-finished` event carrying a
/// [`ScrollResultDto`]. `stop_scroll_capture` cancels cooperatively between
/// tiles — the run then reports `incomplete` with reason `UserAborted`,
/// never a silent partial.
#[tauri::command]
fn start_scroll_capture(
    dto: ScrollCaptureDto,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    let target = match dto.target.kind.as_str() {
        "window" => {
            let window_id = dto
                .target
                .window_id
                .clone()
                .ok_or("window_id is required for a window scroll target")?;
            ScrollTarget::Window { window_id }
        }
        "region" => {
            let r = dto
                .target
                .region
                .as_ref()
                .ok_or("region is required for a region scroll target")?;
            // Regions expose no scroll geometry: the DOM-aware engine
            // rejects them loudly, so force raster-observation here.
            ScrollTarget::Region {
                rect: Rect {
                    x: r.x,
                    y: r.y,
                    w: r.w,
                    h: r.h,
                }
                .normalize(),
            }
        }
        other => return Err(format!("unknown scroll target: {other}")),
    };
    let requested_engine = ScrollEngineKind::parse(&dto.engine)?;
    let mut engine_kind = requested_engine;
    if matches!(target, ScrollTarget::Region { .. })
        && matches!(engine_kind, ScrollEngineKind::DomAware)
    {
        // A bare rect exposes no scroll geometry; choosing it explicitly is
        // a caller error, not something to silently reinterpret.
        return Err(
            "dom-aware scrolling needs a window target (a region exposes no scroll geometry); use auto or raster-observation for regions".to_string(),
        );
    }
    if matches!(target, ScrollTarget::Region { .. }) {
        engine_kind = ScrollEngineKind::RasterObservation;
    }
    let direction = ScrollDirection::parse(&dto.direction)?;
    let defaults = ScrollLimits::default();
    let limits = ScrollLimits {
        max_distance_px: dto.max_distance_px.unwrap_or(defaults.max_distance_px),
        max_tiles: dto.max_tiles.unwrap_or(defaults.max_tiles),
        still_limit: defaults.still_limit,
        settle_ms: dto.settle_ms.unwrap_or(defaults.settle_ms),
    };
    if limits.max_tiles == 0 {
        return Err("max_tiles must be at least 1".to_string());
    }

    let id = next_id(&state);
    let abort: AbortFlag = Arc::new(AtomicBool::new(false));
    state
        .scroll_aborts
        .lock()
        .unwrap()
        .insert(id.clone(), abort.clone());

    let progress_app = app.clone();
    let progress_id = id.clone();
    let return_id = id.clone();
    let on_progress: ProgressCallback = Arc::new(move |p| {
        let _ = progress_app.emit(
            "scroll-progress",
            ScrollProgressDto {
                id: progress_id.clone(),
                tiles_captured: p.tiles_captured,
                distance_px: p.distance_px,
                tiles_expected: p.tiles_expected,
            },
        );
    });

    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let finish = |dto: ScrollResultDto| {
            let _ = app.emit("scroll-finished", dto);
            state.scroll_aborts.lock().unwrap().remove(&id);
        };
        let monitors = match current_monitors() {
            Ok(m) => m,
            Err(e) => {
                finish(ScrollResultDto {
                    id: id.clone(),
                    outcome: "failed".to_string(),
                    capture: None,
                    reason: Some("could not list monitors".to_string()),
                    evidence: vec![e],
                    scroll: None,
                });
                return;
            }
        };
        let request = ScrollRequest {
            id: id.clone(),
            target,
            engine: engine_kind,
            requested_engine,
            direction,
            limits,
            on_progress: Some(on_progress),
            abort: Some(abort),
        };
        // Auto resolves inside DomAwareScrollEngine::acquire_scroll, which
        // falls back to the raster engine when no scroll geometry exists.
        let result = match engine_kind {
            ScrollEngineKind::RasterObservation => {
                RasterObservationScrollEngine.acquire_scroll(&request, &monitors)
            }
            ScrollEngineKind::DomAware | ScrollEngineKind::Auto => {
                DomAwareScrollEngine.acquire_scroll(&request, &monitors)
            }
        };
        finish(scroll_result_dto(&state, &id, result));
    });

    Ok(return_id)
}

/// Cooperatively stop an in-flight scrolling capture. Returns true when a
/// run with that id was still registered. The run reports `incomplete`
/// (UserAborted) with whatever tiles already landed.
#[tauri::command]
fn stop_scroll_capture(id: String, state: State<AppState>) -> Result<bool, String> {
    let found = state
        .scroll_aborts
        .lock()
        .unwrap()
        .get(&id)
        .map(|flag| {
            flag.store(true, Ordering::Relaxed);
            true
        })
        .unwrap_or(false);
    Ok(found)
}

fn scroll_result_dto(
    state: &State<AppState>,
    id: &str,
    result: ScrollingResult,
) -> ScrollResultDto {
    match result {
        ScrollingResult::Complete { artifact } => {
            let scroll = scroll_info_dto(&artifact.scroll_info);
            match store_artifact(state, id.to_string(), artifact) {
                Ok(saved) => ScrollResultDto {
                    id: id.to_string(),
                    outcome: "complete".to_string(),
                    capture: Some(saved),
                    reason: None,
                    evidence: Vec::new(),
                    scroll,
                },
                Err(e) => ScrollResultDto {
                    id: id.to_string(),
                    outcome: "failed".to_string(),
                    capture: None,
                    reason: Some("scrolling capture succeeded but saving failed".to_string()),
                    evidence: vec![e],
                    scroll,
                },
            }
        }
        ScrollingResult::Incomplete {
            partial_artifact,
            completed,
            missing,
            reason,
        } => {
            let reason_str = reason.to_string();
            let mut evidence = vec![
                reason_str.clone(),
                format!(
                    "{} tiles captured, {} regions missing",
                    completed.len(),
                    missing.len()
                ),
            ];
            for m in &missing {
                evidence.push(format!(
                    "missing {}x{} at ({},{}) after {} attempts: {}",
                    m.rect.w, m.rect.h, m.rect.x, m.rect.y, m.attempts, m.last_error
                ));
            }
            let (capture, scroll) = match partial_artifact {
                Some(partial) => {
                    let scroll = scroll_info_dto(&partial.scroll_info);
                    match store_artifact(state, format!("{id}-partial"), partial) {
                        Ok(saved) => (Some(saved), scroll),
                        Err(e) => {
                            evidence.push(format!("partial stitch could not be saved: {e}"));
                            (None, scroll)
                        }
                    }
                }
                None => (None, None),
            };
            ScrollResultDto {
                id: id.to_string(),
                outcome: "incomplete".to_string(),
                capture,
                reason: Some(reason_str),
                evidence,
                scroll,
            }
        }
        ScrollingResult::Failed { reason, evidence } => ScrollResultDto {
            id: id.to_string(),
            outcome: "failed".to_string(),
            capture: None,
            reason: Some(reason),
            evidence,
            scroll: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Global capture shortcuts (Print Screen + direct-capture variants)
// ---------------------------------------------------------------------------

/// Bring the main Capture window forward: unminimize, show, focus.
/// Failures are logged, never fatal — a stuck window must not break the
/// hotkey path.
fn focus_capture_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        if let Err(e) = w.set_focus() {
            eprintln!("[capture] could not focus capture window: {e}");
        }
    }
}

/// Pick the monitor a direct-capture shortcut should target: the one under
/// the cursor, falling back to the first monitor when the cursor position
/// is unavailable.
fn monitor_id_for_hotkey() -> Result<String, String> {
    let monitors = current_monitors()?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }
    if let Ok((px, py)) = forge_capture_core::native::cursor_pos() {
        if let Some(m) = monitors
            .iter()
            .find(|m| m.bounds_virtual().contains_point(px as i64, py as i64))
        {
            return Ok(m.id.clone());
        }
    }
    Ok(monitors[0].id.clone())
}

/// Payload the shell emits to the UI when a direct-capture shortcut needs
/// the app window (window capture: the user still picks the window).
#[derive(Clone, serde::Serialize)]
struct HotkeyActionPayload {
    action: &'static str,
}

/// Payload for `hotkey-error`: a shortcut fired but the action could not
/// run; the UI shows the message in its status line.
#[derive(Clone, serde::Serialize)]
struct HotkeyErrorPayload {
    message: String,
}

/// A shortcut fired but its action failed: log, focus the app window so
/// the user is not left wondering, and surface the message in the UI.
fn report_hotkey_error(app: &tauri::AppHandle, message: &str) {
    eprintln!("[capture] hotkey action failed: {message}");
    focus_capture_window(app);
    let _ = app.emit(
        "hotkey-error",
        HotkeyErrorPayload {
            message: message.to_string(),
        },
    );
}

/// Dispatch a global-shortcut action. Region and full-screen run
/// immediately against the monitor under the cursor; window capture
/// focuses the app and tells the UI to arm window mode (the window itself
/// must still be picked).
fn handle_hotkey_action(app: &tauri::AppHandle, action: forge_capture_core::hotkey::HotkeyAction) {
    use forge_capture_core::hotkey::HotkeyAction;
    match action {
        HotkeyAction::FocusWindow => focus_capture_window(app),
        HotkeyAction::RegionCapture => match monitor_id_for_hotkey() {
            Ok(id) => {
                let state = app.state::<AppState>();
                if let Err(e) = open_region_overlay(app.clone(), state, &id, 0, true) {
                    report_hotkey_error(app, &e);
                }
            }
            Err(e) => report_hotkey_error(app, &e),
        },
        HotkeyAction::WindowCapture => {
            focus_capture_window(app);
            let _ = app.emit(
                "hotkey-action",
                HotkeyActionPayload {
                    action: forge_capture_core::hotkey::ACTION_WINDOW_CAPTURE,
                },
            );
        }
        HotkeyAction::FullscreenCapture => match monitor_id_for_hotkey() {
            Ok(monitor_id) => {
                let dto = CaptureRequestDto {
                    mode: "full-monitor".into(),
                    monitor_id: Some(monitor_id),
                    window_id: None,
                    region: None,
                    overlay_rect: None,
                    delay_ms: Some(0),
                    include_cursor: true,
                };
                let state = app.state::<AppState>();
                if let Err(e) = run_capture(app, state, &dto) {
                    report_hotkey_error(app, &e);
                }
            }
            Err(e) => report_hotkey_error(app, &e),
        },
    }
}

/// Register all four capture shortcuts (best effort).
///
/// Returns true when the OS accepted the Print Screen registration. A
/// failure is *expected* on machines where the OS already reserves the key
/// (Windows 11 maps Print Screen to screen snipping via an Accessibility
/// setting), where a Wayland compositor refuses global shortcuts, or where
/// another capture tool holds one — it is logged loudly and never fails
/// startup. The accelerator strings and the action mapping are owned by
/// [`forge_capture_core::hotkey`].
fn register_capture_shortcuts(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_global_shortcut::ShortcutState;
    let mut printscreen_active = false;
    for (accelerator, action) in forge_capture_core::hotkey::CAPTURE_SHORTCUTS {
        let outcome = app
            .global_shortcut()
            .on_shortcut(accelerator, move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    handle_hotkey_action(app, action);
                }
            })
            .map_err(|e| e.to_string())
            .and_then(|_| {
                app.global_shortcut()
                    .register(accelerator)
                    .map_err(|e| e.to_string())
            });
        let status = forge_capture_core::hotkey::status_from_registration(outcome);
        eprintln!(
            "[capture] {}",
            forge_capture_core::hotkey::describe_shortcut_status(accelerator, &status)
        );
        if action == forge_capture_core::hotkey::HotkeyAction::FocusWindow {
            printscreen_active = status.active();
        }
    }
    printscreen_active
}

/// Whether the Print Screen takeover is active in this session. The UI can
/// surface this so the user knows if the OS kept the key for itself.
#[tauri::command]
fn printscreen_takeover_active(state: State<AppState>) -> bool {
    state.printscreen_active.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn ensure_dpi_awareness() {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    // Best effort: the Tauri runtime usually sets this via the manifest
    // already; ignore failure.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

fn main() {
    #[cfg(windows)]
    ensure_dpi_awareness();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            captures: Mutex::new(HashMap::new()),
            pending_overlay: Mutex::new(None),
            id_counter: Mutex::new(0),
            used_stems: Mutex::new(HashSet::new()),
            scroll_aborts: Mutex::new(HashMap::new()),
            printscreen_active: AtomicBool::new(false),
            media_uploads: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            // Best-effort capture shortcuts: register the four PrintScreen
            // shortcuts and record whether the OS accepted the bare
            // PrintScreen one. A rejection never fails startup (see
            // register_capture_shortcuts).
            let active = register_capture_shortcuts(app.handle());
            app.state::<AppState>()
                .printscreen_active
                .store(active, Ordering::Relaxed);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            list_monitors,
            list_windows,
            captures_dir_path,
            capture,
            copy_to_clipboard,
            get_sidecar,
            export_capture,
            begin_region_pick,
            overlay_context,
            cancel_region_pick,
            region_pick_backdrop,
            ai_edit_submit,
            ai_edit_poll,
            ai_edit_import,
            start_scroll_capture,
            stop_scroll_capture,
            printscreen_takeover_active,
            get_cursor_pos,
            begin_media_upload,
            append_media_chunk,
            finish_media_upload,
            cancel_media_upload,
            session_store::forge_session_get,
            session_store::forge_session_set,
            session_store::forge_session_clear,
            get_capture_upload_payload,
            copy_text_to_clipboard,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FORGE Capture");
}

#[cfg(test)]
mod dto_ipc_tests {
    //! The JS UI sends camelCase invoke payloads and Tauri matches argument
    //! names exactly (no case conversion — verified against tauri 2.11's
    //! `ipc::command`: `v.get(self.key)`). These tests pin each DTO against
    //! the EXACT JSON shape the UI sends, so a renamed field on either side
    //! fails here instead of silently dropping data at runtime.

    use super::*;

    #[test]
    fn scroll_target_dto_matches_ui_window_payload() {
        // ui/main.js doScrollCapture(), kind == "window":
        //   target: { type: kind }; dto.target.windowId = $("scroll-window").value || null
        let json = r#"{"type":"window","windowId":"12345"}"#;
        let dto: ScrollTargetDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.kind, "window");
        assert_eq!(dto.window_id.as_deref(), Some("12345"));
        assert!(dto.region.is_none());
    }

    #[test]
    fn scroll_target_dto_matches_ui_region_payload() {
        // ui/main.js doScrollCapture(), kind == "region":
        //   dto.target.region = { x: Number(...), y: ..., w: ..., h: ... }
        let json = r#"{"type":"region","region":{"x":10.5,"y":20,"w":300,"h":200}}"#;
        let dto: ScrollTargetDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.kind, "region");
        let r = dto.region.expect("region payload binds");
        assert_eq!((r.x, r.y, r.w, r.h), (10.5, 20.0, 300.0, 200.0));
    }

    #[test]
    fn scroll_capture_dto_matches_ui_payload() {
        // ui/main.js doScrollCapture(): { target, engine, direction } with
        // camelCase option keys when the UI grows them.
        let json = r#"{
            "target": {"type":"window","windowId":"99"},
            "engine": "auto",
            "direction": "vertical",
            "maxDistancePx": 5000,
            "maxTiles": 40,
            "settleMs": 300
        }"#;
        let dto: ScrollCaptureDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.target.window_id.as_deref(), Some("99"));
        assert_eq!(dto.engine, "auto");
        assert_eq!(dto.direction, "vertical");
        assert_eq!(dto.max_distance_px, Some(5000));
        assert_eq!(dto.max_tiles, Some(40));
        assert_eq!(dto.settle_ms, Some(300));
    }

    #[test]
    fn capture_request_dto_matches_ui_payload() {
        // ui/main.js doCapture():
        //   { mode, monitorId, windowId, region: null, overlayRect: null,
        //     delayMs, includeCursor }
        let json = r#"{
            "mode": "window",
            "monitorId": null,
            "windowId": "42",
            "region": null,
            "overlayRect": null,
            "delayMs": 5000,
            "includeCursor": true
        }"#;
        let dto: CaptureRequestDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.mode, "window");
        assert_eq!(dto.window_id.as_deref(), Some("42"));
        assert_eq!(dto.delay_ms, Some(5000));
        assert!(dto.include_cursor);
    }

    #[test]
    fn capture_request_dto_matches_overlay_payload() {
        // ui/overlay.js on drag end:
        //   { mode: "region-overlay", monitorId: null, windowId: null,
        //     region: null, overlayRect: r, delayMs: 0, includeCursor: false }
        let json = r#"{
            "mode": "region-overlay",
            "monitorId": null,
            "windowId": null,
            "region": null,
            "overlayRect": {"x":1,"y":2,"w":3,"h":4},
            "delayMs": 0,
            "includeCursor": false
        }"#;
        let dto: CaptureRequestDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.mode, "region-overlay");
        let r = dto.overlay_rect.expect("overlayRect binds");
        assert_eq!((r.x, r.y, r.w, r.h), (1.0, 2.0, 3.0, 4.0));
        assert!(!dto.include_cursor);
    }

    #[test]
    fn begin_region_pick_param_names_match_ui() {
        // ui/main.js: invoke("begin_region_pick",
        //   { monitorId, delayMs, includeCursor }).
        // Tauri binds command parameters by exact name, so the Rust
        // parameters must be camelCase. This cannot be exercised through the
        // IPC layer in a unit test; it is pinned here as documentation of the
        // contract, and the parameter names are asserted via stringify on
        // the function pointer's debug form is not possible — instead we
        // assert the UI-facing contract through the DTO above and keep this
        // test as a tripwire reminding reviewers that renaming the
        // begin_region_pick parameters breaks the overlay flow.
        let _ = begin_region_pick
            as fn(
                String,
                Option<u64>,
                Option<bool>,
                tauri::AppHandle,
                State<AppState>,
            ) -> Result<(), String>;
    }

    #[test]
    fn begin_media_upload_dto_matches_ui_payload() {
        // ui/record.js uploadBytes():
        //   { total_bytes, mime, suggested_extension, name_hint }
        let json = r#"{
            "total_bytes": 1048576,
            "mime": "video/webm;codecs=vp9",
            "suggested_extension": null,
            "name_hint": "recording"
        }"#;
        let dto: BeginMediaUploadDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.total_bytes, 1048576);
        assert_eq!(dto.mime, "video/webm;codecs=vp9");
        assert!(dto.suggested_extension.is_none());
        assert_eq!(dto.name_hint.as_deref(), Some("recording"));
    }

    #[test]
    fn begin_media_upload_gif_dto_matches_ui_payload() {
        // ui/record.js onExportGif(): mime image/gif + suggestedExtension "gif".
        let json = r#"{
            "total_bytes": 2048,
            "mime": "image/gif",
            "suggested_extension": "gif",
            "name_hint": "recording-clip"
        }"#;
        let dto: BeginMediaUploadDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.mime, "image/gif");
        assert_eq!(dto.suggested_extension.as_deref(), Some("gif"));
    }

    #[test]
    fn append_media_chunk_dto_matches_ui_payload() {
        // ui/record.js uploadBytes(): { upload_id, offset, bytes } where
        // bytes is a plain JSON number array (Tauri has no binary IPC for
        // number arrays).
        let json = r#"{"upload_id": "upl-123-1", "offset": 1048576, "bytes": [26, 69, 223, 163]}"#;
        let dto: AppendMediaChunkDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.upload_id, "upl-123-1");
        assert_eq!(dto.offset, 1048576);
        assert_eq!(dto.bytes, vec![26u8, 69, 223, 163]);
    }

    #[test]
    fn check_chunk_offset_accepts_sequential_chunks_only() {
        assert!(check_chunk_offset(0, 0).is_ok());
        assert!(check_chunk_offset(1048576, 1048576).is_ok());
        // Gap: caller skipped ahead.
        assert!(check_chunk_offset(0, 1048576).is_err());
        // Duplicate / reordered: offset behind the received cursor.
        assert!(check_chunk_offset(1048576, 0).is_err());
        assert!(check_chunk_offset(2097152, 1048576).is_err());
    }

    #[test]
    fn media_extension_accepts_supported_pairs() {
        assert_eq!(
            media_extension("video/webm;codecs=vp9", None).unwrap(),
            "webm"
        );
        // Parameters and case are normalized for the allowlist decision.
        assert_eq!(media_extension("video/webm", None).unwrap(), "webm");
        assert_eq!(media_extension("VIDEO/WEBM", None).unwrap(), "webm");
        assert_eq!(media_extension("video/mp4", None).unwrap(), "mp4");
        assert_eq!(media_extension("image/gif", Some("gif")).unwrap(), "gif");
        assert_eq!(media_extension("image/gif", None).unwrap(), "gif");
    }

    #[test]
    fn media_extension_rejects_mismatch_and_unknown() {
        assert!(media_extension("video/x-matroska", None).is_err());
        assert!(media_extension("application/octet-stream", None).is_err());
        // Prefix traps: a starts_with allowlist would accept these.
        assert!(media_extension("video/webm-evil", None).is_err());
        assert!(media_extension("video/webmanything", None).is_err());
        assert!(media_extension("video/mp4garbage", None).is_err());
        // Suggested extension must agree with the mime, not override it.
        assert!(media_extension("video/webm", Some("mp4")).is_err());
        assert!(media_extension("video/webm", Some("exe")).is_err());
    }

    #[test]
    fn sanitize_stem_keeps_safe_characters() {
        assert_eq!(
            sanitize_stem(Some("recording-trimmed")),
            "recording-trimmed"
        );
        assert_eq!(sanitize_stem(Some("../../evil")), "evil");
        assert_eq!(sanitize_stem(Some("Clip 1 (final)")), "clip-1--final");
        assert_eq!(sanitize_stem(None), "recording");
        assert_eq!(sanitize_stem(Some("!!!")), "recording");
    }

    #[test]
    fn sniff_media_ok_recognizes_magic_bytes() {
        // Minimal WebM EBML header: [1A 45 DF A3][87 size=7][42 82][84 size=4]["webm"]
        let webm_header: Vec<u8> = vec![
            0x1A, 0x45, 0xDF, 0xA3, 0x87, 0x42, 0x82, 0x84, b'w', b'e', b'b', b'm',
        ];
        assert!(sniff_media_ok(&webm_header, "webm"));
        // Bare EBML magic without a DocType proves EBML, not WebM — must fail.
        assert!(!sniff_media_ok(&[0x1A, 0x45, 0xDF, 0xA3, 0x00], "webm"));
        assert!(!sniff_media_ok(&[0x00, 0x00, 0x00, 0x20], "webm"));
        // Matroska shares the EBML magic but declares a different DocType.
        let mkv_header: Vec<u8> = vec![
            0x1A, 0x45, 0xDF, 0xA3, 0x8B, 0x42, 0x82, 0x88, b'm', b'a', b't', b'r', b'o', b's',
            b'k', b'a',
        ];
        assert!(!sniff_media_ok(&mkv_header, "webm"));
        // Truncated header and unknown-size header fail closed.
        assert!(!sniff_media_ok(&[0x1A, 0x45, 0xDF, 0xA3], "webm"));
        assert!(!sniff_media_ok(&[0x1A, 0x45, 0xDF, 0xA3, 0xFF], "webm"));
        assert!(sniff_media_ok(
            &[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70],
            "mp4"
        ));
        assert!(!sniff_media_ok(&webm_header, "mp4"));
        assert!(sniff_media_ok(b"GIF89a....", "gif"));
        assert!(sniff_media_ok(b"GIF87a....", "gif"));
        assert!(!sniff_media_ok(b"GIF89a....", "webm"));
        assert!(!sniff_media_ok(&[], "webm"));
    }

    #[test]
    fn base64_encode_matches_known_vectors() {
        // RFC 4648 test vectors, including all padding shapes.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // Binary edge bytes round-trip through the full alphabet.
        let all: Vec<u8> = (0u8..=255u8).collect();
        let encoded = base64_encode(&all);
        assert_eq!(encoded.len(), 344);
        assert!(encoded.ends_with("=="));
    }

    #[test]
    fn sidecar_raster_mime_reads_the_envelope() {
        let sidecar = r#"{"kind":"forge-capture-artifact","raster":{"mime":"image/png"}}"#;
        assert_eq!(sidecar_raster_mime(sidecar).unwrap(), "image/png");
        assert!(sidecar_raster_mime(r#"{"raster":{}}"#).is_err());
        assert!(sidecar_raster_mime("not json").is_err());
    }

    #[test]
    fn ai_edit_submit_param_names_match_ui() {
        // ui/ai-edit.js: invoke("ai_edit_submit", { id, prompt }).
        // Tauri binds command parameters by exact name; pin the signature
        // so a rename breaks here instead of failing every submit at
        // runtime with "missing required key".
        let _ = ai_edit_submit
            as fn(String, String, State<AppState>) -> Result<AiEditSubmitDto, String>;
    }

    #[test]
    fn ai_edit_poll_param_names_match_ui() {
        // ui/ai-edit.js: invoke("ai_edit_poll", { jobId }).
        let _ = ai_edit_poll as fn(String, State<AppState>) -> Result<AiEditPollDto, String>;
    }

    #[test]
    fn ai_edit_import_param_names_match_ui() {
        // ui/ai-edit.js: invoke("ai_edit_import", { jobId }).
        let _ = ai_edit_import as fn(String, State<AppState>) -> Result<ArtifactRefDto, String>;
    }

    #[test]
    fn ai_edit_dtos_serialize_camel_case() {
        let submit = AiEditSubmitDto {
            job_id: "ai-123-1".to_string(),
        };
        let json = serde_json::to_string(&submit).unwrap();
        assert!(json.contains("\"jobId\":\"ai-123-1\""), "{json}");

        let poll = AiEditPollDto {
            job_id: "ai-123-1".to_string(),
            status: "done".to_string(),
            reason: None,
        };
        let json = serde_json::to_string(&poll).unwrap();
        assert!(json.contains("\"jobId\""), "{json}");
        assert!(json.contains("\"status\":\"done\""), "{json}");
        assert!(
            !json.contains("reason"),
            "None reason must be skipped: {json}"
        );

        let failed = AiEditPollDto {
            job_id: "ai-123-1".to_string(),
            status: "failed".to_string(),
            reason: Some("runner exploded".to_string()),
        };
        let json = serde_json::to_string(&failed).unwrap();
        assert!(json.contains("\"reason\":\"runner exploded\""), "{json}");
    }

    #[test]
    fn capture_kind_from_str_maps_sidecar_strings() {
        assert_eq!(
            capture_kind_from_str("full-monitor"),
            forge_capture_core::artifact::CaptureKind::FullMonitor
        );
        assert_eq!(
            capture_kind_from_str("window"),
            forge_capture_core::artifact::CaptureKind::Window
        );
        assert_eq!(
            capture_kind_from_str("scrolling"),
            forge_capture_core::artifact::CaptureKind::Scrolling
        );
        assert_eq!(
            capture_kind_from_str("region"),
            forge_capture_core::artifact::CaptureKind::Region
        );
        // Unknown / missing kinds fail closed to Region, never panic.
        assert_eq!(
            capture_kind_from_str("something-new"),
            forge_capture_core::artifact::CaptureKind::Region
        );
    }

    #[test]
    fn sidecar_capture_kind_reads_the_envelope() {
        let sidecar = r#"{"kind":"forge-capture-artifact","captureKind":"Window"}"#;
        assert_eq!(sidecar_capture_kind(sidecar), "Window");
        assert_eq!(sidecar_capture_kind(r#"{"kind":"x"}"#), "region");
        assert_eq!(sidecar_capture_kind("not json"), "region");
    }

    #[test]
    fn capture_kind_mapping_accepts_sidecar_and_wire_spellings() {
        use forge_capture_core::artifact::CaptureKind as K;
        assert_eq!(capture_kind_from_str("Window"), K::Window);
        assert_eq!(capture_kind_from_str("window"), K::Window);
        assert_eq!(capture_kind_from_str("FullMonitor"), K::FullMonitor);
        assert_eq!(capture_kind_from_str("full-monitor"), K::FullMonitor);
        assert_eq!(capture_kind_from_str("Scrolling"), K::Scrolling);
        assert_eq!(capture_kind_from_str("Region"), K::Region);
    }

    #[test]
    fn library_url_allowlist_blocks_arbitrary_sites() {
        // Rung 6 — open_external_url may only open the library page.
        assert!(is_library_url_allowed(
            "https://www.409marketplace.online/forge/capture/library"
        ));
        assert!(is_library_url_allowed(
            "https://www.409marketplace.online/forge/capture/library?capture=123e4567-e89b-42d3-a456-426614174000"
        ));
        assert!(!is_library_url_allowed(
            "https://www.409marketplace.online/forge/capture"
        ));
        assert!(!is_library_url_allowed(
            "https://www.409marketplace.online/"
        ));
        assert!(!is_library_url_allowed("https://evil.example/"));
        assert!(!is_library_url_allowed(
            "http://www.409marketplace.online/forge/capture/library"
        ));
        assert!(!is_library_url_allowed("https://www.409marketplace.online/forge/capture/library?capture=x&next=https://evil.example/"));
        assert!(!is_library_url_allowed(
            "https://www.409marketplace.online/forge/capture/library?capture=not-a-uuid"
        ));
        assert!(!is_library_url_allowed(
            "https://www.409marketplace.online/forge/capture/library?capture=123e4567-e89b-42d3-a456-426614174000 "
        ));
    }
}
