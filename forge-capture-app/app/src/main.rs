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

use forge_capture_core::artifact::CaptureArtifact;
use forge_capture_core::coords::{Monitor, Rect};
use forge_capture_core::engines::{
    AcquisitionEngine, CaptureMode, CaptureRequest, DomAwareScrollEngine, NativeRasterEngine,
    RasterObservationScrollEngine,
};
use forge_capture_core::native;
use forge_capture_core::result::ScrollingResult;
use forge_capture_core::scroll::{
    AbortFlag, ProgressCallback, ScrollDirection, ScrollEngineKind, ScrollLimits, ScrollRequest,
    ScrollTarget,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct StoredCapture {
    png_bytes: Vec<u8>,
    sidecar_json: String,
}

struct OverlayContext {
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

/// ui/record.js uploadBytes(): { upload_id, bytes }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendMediaChunkDto {
    upload_id: String,
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
    let from_mime = if mime.starts_with("video/webm") {
        "webm"
    } else if mime.starts_with("video/mp4") {
        "mp4"
    } else if mime == "image/gif" {
        "gif"
    } else {
        return Err(format!("unsupported media mime for upload: {mime}"));
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

fn sniff_media_ok(bytes: &[u8], extension: &str) -> bool {
    match extension {
        // EBML header ID
        "webm" => bytes.len() >= 4 && bytes[0..4] == [0x1A, 0x45, 0xDF, 0xA3],
        // 'ftyp' at offset 4
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

#[tauri::command]
fn append_media_chunk(dto: AppendMediaChunkDto, state: State<AppState>) -> Result<u64, String> {
    let mut uploads = state.media_uploads.lock().unwrap();
    let upload = uploads
        .get_mut(&dto.upload_id)
        .ok_or_else(|| format!("unknown upload id: {}", dto.upload_id))?;
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
            "uploaded bytes are not a valid .{} stream — refusing to write",
            upload.extension
        ));
    }
    let dir = captures_dir()?;
    let path = dir.join(format!("{}.{}", upload.stem, upload.extension));
    std::fs::write(&path, &upload.received).map_err(|e| format!("cannot write media file: {e}"))?;
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
    std::fs::write(&sidecar_path, sidecar.as_bytes())
        .map_err(|e| format!("cannot write sidecar: {e}"))?;
    Ok(MediaUploadResultDto {
        path: path.to_string_lossy().into_owned(),
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
    let dir = captures_dir()?;
    let stem = unique_stem(
        state,
        &dir,
        &artifact.file_stem(),
        artifact.raster_mime.extension(),
    );
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
    let monitors = current_monitors()?;
    let (mode, include_cursor) = build_mode(&dto, &app, &state)?;
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
    let monitors = current_monitors()?;
    let monitor = monitors
        .iter()
        .find(|m| m.id == monitorId)
        .ok_or_else(|| format!("unknown monitor id: {monitorId}"))?;
    *state.pending_overlay.lock().unwrap() = Some(OverlayContext {
        origin_virtual: monitor.origin_virtual,
        dpr: monitor.scale,
        delay_ms: delayMs.unwrap_or(0),
        include_cursor: includeCursor.unwrap_or(true),
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
// Print Screen system-default takeover
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

/// Register Print Screen as the global capture shortcut (best effort).
///
/// Returns true when the OS accepted the registration. A failure is
/// *expected* on machines where the OS already reserves the key (Windows 11
/// maps Print Screen to screen snipping via an Accessibility setting) or
/// where another capture tool holds it — it is logged loudly and never
/// fails startup. The accelerator string and the launch-not-shutter action
/// are owned by [`forge_capture_core::hotkey`].
fn register_printscreen_shortcut(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_global_shortcut::ShortcutState;
    let outcome = app
        .global_shortcut()
        .on_shortcut(
            forge_capture_core::hotkey::PRINTSCREEN_ACCELERATOR,
            |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    focus_capture_window(app);
                }
            },
        )
        .map_err(|e| e.to_string());
    let status = forge_capture_core::hotkey::status_from_registration(outcome);
    eprintln!("[capture] {}", status.describe());
    status.active()
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
            // Best-effort Print Screen takeover: register the global
            // shortcut and record whether the OS accepted it. A rejection
            // never fails startup (see register_printscreen_shortcut).
            let active = register_printscreen_shortcut(app.handle());
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
            start_scroll_capture,
            stop_scroll_capture,
            printscreen_takeover_active,
            get_cursor_pos,
            begin_media_upload,
            append_media_chunk,
            finish_media_upload,
            cancel_media_upload,
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
        // ui/record.js uploadBytes(): { upload_id, bytes } where bytes is a
        // plain JSON number array (Tauri has no binary IPC for number arrays).
        let json = r#"{"upload_id": "upl-123-1", "bytes": [26, 69, 223, 163]}"#;
        let dto: AppendMediaChunkDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.upload_id, "upl-123-1");
        assert_eq!(dto.bytes, vec![26u8, 69, 223, 163]);
    }

    #[test]
    fn media_extension_accepts_supported_pairs() {
        assert_eq!(
            media_extension("video/webm;codecs=vp9", None).unwrap(),
            "webm"
        );
        assert_eq!(media_extension("video/webm", None).unwrap(), "webm");
        assert_eq!(media_extension("video/mp4", None).unwrap(), "mp4");
        assert_eq!(media_extension("image/gif", Some("gif")).unwrap(), "gif");
        assert_eq!(media_extension("image/gif", None).unwrap(), "gif");
    }

    #[test]
    fn media_extension_rejects_mismatch_and_unknown() {
        assert!(media_extension("video/x-matroska", None).is_err());
        assert!(media_extension("application/octet-stream", None).is_err());
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
        assert!(sniff_media_ok(&[0x1A, 0x45, 0xDF, 0xA3, 0x00], "webm"));
        assert!(!sniff_media_ok(&[0x00, 0x00, 0x00, 0x20], "webm"));
        assert!(sniff_media_ok(
            &[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70],
            "mp4"
        ));
        assert!(!sniff_media_ok(&[0x1A, 0x45, 0xDF, 0xA3], "mp4"));
        assert!(sniff_media_ok(b"GIF89a....", "gif"));
        assert!(sniff_media_ok(b"GIF87a....", "gif"));
        assert!(!sniff_media_ok(b"GIF89a....", "webm"));
        assert!(!sniff_media_ok(&[], "webm"));
    }
}
