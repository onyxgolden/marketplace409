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
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use forge_capture_core::ai_edit;
use forge_capture_core::annotations::{self, AnnotationsSidecar, SourceBinding};
use forge_capture_core::artifact::{CaptureArtifact, CaptureKind, CursorState, RasterMime};
use forge_capture_core::capture_meta::{self, CaptureMeta};
use forge_capture_core::coords::{Monitor, Rect};
use forge_capture_core::engines::{
    AcquisitionEngine, CaptureMode, CaptureRequest, DomAwareScrollEngine, NativeRasterEngine,
    RasterObservationScrollEngine,
};
use forge_capture_core::library_index::{LibraryIndex, LibraryIndexEntry};
use forge_capture_core::native;
use forge_capture_core::png::{decode_own, encode_rgba, png_dimensions};
use forge_capture_core::process_capture::{self, ProcessCaptureConfig};
use forge_capture_core::result::ScrollingResult;
use forge_capture_core::scroll::{
    AbortFlag, ProgressCallback, ScrollDirection, ScrollEngineKind, ScrollLimits, ScrollRequest,
    ScrollTarget,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod session_store;
/// Bounded capture worker (ChatGPT design verdict 2026-10-23, Option C):
/// parent-side supervisor, wire protocol, phase ring log. See the module
/// docs for the contract.
mod capture_worker;

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
    /// Frozen fullscreen frame, captured BEFORE the overlay window was
    /// created (so the overlay can never appear in its own backdrop) and
    /// blank-checked. Served to the overlay page by `region_pick_backdrop`.
    backdrop_png: Option<Vec<u8>>,
    /// Monotonic session id, captured by the 60-second watchdog at spawn
    /// time. A stale watchdog (from a cancelled session) must never clear
    /// or close a NEWER region-pick session — the token is checked before
    /// the watchdog touches anything.
    session_id: u64,
    /// True when the frozen frame came back a single solid color. The
    /// picker opens anyway with a blank-frame warning (cancel / retry /
    /// proceed) instead of aborting: a genuinely solid-color desktop is
    /// rare but legitimate, and a hard abort would strand that user with
    /// no way to region-pick at all.
    backdrop_blank: bool,
}

struct AppState {
    captures: Mutex<HashMap<String, StoredCapture>>,
    pending_overlay: Mutex<Option<OverlayContext>>,
    id_counter: Mutex<u64>,
    /// Monotonic generation counter for region-pick sessions. Each
    /// `open_region_overlay` takes the next value as the session's id and
    /// hands it to that session's watchdog, so a stale watchdog can be
    /// told apart from the session it was spawned for.
    overlay_session: Mutex<u64>,
    /// C639-007: the parent-owned token for "the pick/session currently
    /// allowed to install an overlay context/window, or whose completed
    /// capture may steal focus back to the main window." Minted (as the
    /// session id itself) by `open_region_overlay` BEFORE its blocking
    /// backdrop acquisition, so a pick claims ownership up front rather
    /// than only after the blocking call returns; cleared by
    /// `cancel_region_pick`; implicitly superseded whenever a newer pick
    /// mints its own. Checked again atomically, with `pending_overlay`'s
    /// lock held across both the check and the install, after every
    /// blocking wait that could have been overtaken (initial acquisition
    /// here; retry already fences itself via `pending_overlay`'s own
    /// session id, held across its own check-and-show).
    active_pick: Mutex<Option<u64>>,
    /// C639-001C.1: which session's window is the CURRENT live "overlay"
    /// webview, if any — set the instant `open_region_overlay_claimed`'s
    /// main-thread closure actually builds one, cleared by every path that
    /// actually destroys it (the closure's own cancel-closes, a stale
    /// outer cleanup's owned close, `cancel_region_pick`, the 60s
    /// watchdog). A close that only checks "is there a window labeled
    /// `overlay`" cannot tell its own, now-superseded attempt's window
    /// apart from a newer session's — this token is the actual binding a
    /// stale cleanup must check before it may touch the window at all.
    overlay_window_owner: Mutex<Option<u64>>,
    /// Bounded capture worker supervisor (C639 Option C). Owns the single
    /// worker slot, the 3 s parent deadline, generation fencing, and the
    /// phase ring log. All potentially blocking native acquisition for the
    /// region path (initial backdrop, retry, final region read) goes
    /// through here; the native code itself runs in the child process.
    capture_supervisor: capture_worker::CaptureSupervisor,
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
    /// In-flight meeting audio uploads, keyed by the upload id handed to
    /// `meeting_upload_begin`. Unlike Rung 4 media uploads, chunks are
    /// appended to a `.meeting.part` file on disk AS THEY ARRIVE, so a
    /// crash mid-recording leaves a recoverable partial that
    /// `meeting_recover` finalizes on the next launch.
    meeting_uploads: Mutex<HashMap<String, MeetingUpload>>,
    /// The running PT-1 process-capture pipeline, if a session is active.
    /// `None` until `process_capture_start_session` is called — which, as
    /// of this sub-slice, no startup path or test ever does; see
    /// `forge_capture_core::process_capture`'s own doc comment.
    process_capture: Mutex<Option<forge_capture_core::process_capture::ProcessCaptureHandle>>,
    /// Events the pipeline's sink has produced for the active session, in
    /// arrival order. Bounded (`BoundedDropOldest`, the same drop-oldest-
    /// and-count policy the pipeline's own inter-thread queues use) —
    /// review finding: an unbounded `Vec` here would accumulate forever,
    /// including potentially huge RGBA frames, with no cap at all even
    /// though every queue upstream of it is bounded. `Arc<Mutex<_>>` (not
    /// `Mutex` wrapping an inner `Arc`) so the sink closure handed to
    /// `process_capture::start` can hold a cheap clone of the exact same
    /// buffer this field reads — one buffer, not two. A later, UI-facing
    /// slice drains this into durable `events.ndjson` writes; this
    /// sub-slice only wires the pipe.
    process_capture_events: Arc<
        Mutex<
            forge_capture_core::process_capture::BoundedDropOldest<
                forge_capture_core::process_capture::PipelineMessage,
            >,
        >,
    >,
}

/// Size estimate for one `PipelineMessage`, for
/// `AppState::process_capture_events`'s byte budget — dominated by a
/// screenshot's RGBA buffer when one is present; everything else is a
/// small, roughly-constant overhead.
fn pipeline_message_size(message: &forge_capture_core::process_capture::PipelineMessage) -> usize {
    use forge_capture_core::process_capture::PipelineMessage;
    match message {
        PipelineMessage::Event(event) => {
            64 + event
                .screenshot
                .as_ref()
                .map(|(_, _, rgba)| rgba.len())
                .unwrap_or(0)
        }
        PipelineMessage::Gap(_)
        | PipelineMessage::QueueOverflow { .. }
        | PipelineMessage::SessionReconciliationUncertain { .. } => 32,
    }
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
    /// C639-007C.3: the session id the overlay page learned from
    /// `overlay_context` when IT opened — echoed back here so `capture` can
    /// bind this request to the EXACT generation that created it, never to
    /// whichever pick happens to be `active_pick` at the moment the request
    /// is processed. Required (and verified) for mode == "region-overlay";
    /// absent and ignored for every other mode, which never has an overlay
    /// session to carry.
    overlay_session_id: Option<u64>,
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
            size_physical: m.size_physical,
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

/// ui/record.js uploadBytes(): { totalBytes, mime, suggestedExtension, nameHint }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeginMediaUploadDto {
    total_bytes: u64,
    mime: String,
    suggested_extension: Option<String>,
    name_hint: Option<String>,
}

/// ui/record.js uploadBytes(): { uploadId, offset, bytes }
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
    /// True when the frozen frame came back a single solid color. The
    /// overlay page shows a blank-frame warning (retry / proceed / cancel)
    /// instead of picking blind on a possibly dead frame.
    backdrop_blank: bool,
    /// C639-007C.3: this pick's own session id, echoed back by the page as
    /// `overlaySessionId` on its eventual `capture` call so that call can be
    /// bound to the exact generation that opened it, not to whichever pick
    /// happens to be `active_pick` when the request is actually processed.
    session_id: u64,
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
        // C639-007C.3: bind the take to the EXACT session this request
        // carries (`overlay_session_id`, echoed back from `overlay_context`
        // by the page that owns it), verified atomically against
        // `active_pick` at the same instant `pending_overlay` is consumed —
        // never a blind `.take()` of "whatever context currently exists".
        // A blind take let a stale/already-superseded request (A) consume a
        // NEWER session's (B's) context and close B's picker while applying
        // A's own (unrelated) overlay_rect geometry to it. If a cancel or a
        // newer admission has displaced this session by the instant of the
        // take, this is a loud error and B's context/window are untouched.
        let session_id = dto
            .overlay_session_id
            .ok_or("region-overlay request missing its overlay session id")?;
        let overlay = take_pending_overlay_if_current(
            &state.active_pick,
            &state.pending_overlay,
            session_id,
        )
        .ok_or("no pending region overlay; call begin_region_pick first")?;
        // The overlay is always-on-top: the live-region BitBlt below must
        // never run while the picker window might still be visible.
        // `close()` is asynchronous, so wait for actual destruction — and
        // if the window will not go away, abort LOUDLY instead of
        // screenshotting the picker itself. C639-001C.1: bound to this
        // session's own window via `overlay_window_owner`, not a blind
        // "whatever is labeled overlay" lookup — under the strict
        // `active_pick` reservation this session is always the current
        // owner here, but if that ever stopped holding, the owner-gated
        // close degrades to a safe no-op and the wait below still catches
        // a window that is (wrongly) still present, aborting loudly
        // instead of silently closing someone else's window.
        close_owned_overlay_window(app, overlay.session_id)?;
        let gone = wait_for_overlay_gone(app, Duration::from_millis(1500));
        must_abort_capture_if_overlay_present(!gone)?;
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

/// C639-007C.1/007C.2: retire a region-overlay request's `active_pick`/
/// `pending_overlay` claim on EVERY terminal failure from the operation
/// boundary onward — not only failures reached from inside the capture
/// worker's own wrapper. A direct (non-overlay) request never claimed
/// anything, so this is always a no-op for it; an overlay request's claim
/// is only ever retired through `clear_pick_if_current`, which clears an
/// exact `session_id` match, so a stale/already-superseded session's
/// retire can never clear a newer claim. On success this does nothing —
/// the claim must stay held for the worker wrapper that runs next, which
/// is this reservation's normal (success-path) release point.
///
/// C639-007C.2: `active_claim` must be read from `active_pick` — the
/// authoritative claim — never from `pending_overlay`. `pending_overlay`
/// is only a snapshot of a *healthy* session's context and is already
/// `None` on several terminal paths (a `build_mode` call with no pending
/// context at all, a monitor-enumeration failure reached before any
/// context was ever installed) while `active_pick` still names the
/// stranded session that must be retired.
fn retire_claim_on_overlay_build_failure<T>(
    is_overlay_request: bool,
    active_claim: Option<u64>,
    active_pick: &Mutex<Option<u64>>,
    pending_overlay: &Mutex<Option<OverlayContext>>,
    result: Result<T, String>,
) -> Result<T, String> {
    if result.is_err() && is_overlay_request {
        if let Some(session_id) = active_claim {
            clear_pick_if_current(active_pick, pending_overlay, session_id);
        }
    }
    result
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
async fn capture(dto: CaptureRequestDto, app: tauri::AppHandle) -> Result<ArtifactRefDto, String> {
    // C639-001: the full capture orchestration — the direct engine path
    // or the supervised worker round trip for region captures — runs off
    // the main thread. See the module note above `run_on_main_thread_sync`.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        run_capture(&app, state, &dto)
    })
    .await
    .map_err(|e| format!("capture background task failed: {e}"))?
}

/// Shared capture path: the `capture` command and the Alt+PrintScreen
/// hotkey both run through here.
///
/// Failures are broadcast app-wide (`capture-failed`), the same way success
/// already is (`capture-saved`), rather than relying solely on this
/// function's `Result` reaching back to whichever window originated the
/// request. For `region-overlay` mode specifically, `build_mode` closes the
/// overlay window *before* the actual pixel acquisition / disk write below
/// run — a failure in either of those happens after that window's own IPC
/// response channel can no longer deliver anything back to it, so a bare
/// `Err` return would be a capture that fails completely silently: no
/// screenshot, no error, nothing in the UI. (2026-09-30, root-caused from
/// Jason's report of a drag-selected region producing no preview and an
/// empty Captures folder, with no visible error anywhere.)
fn run_capture(
    app: &tauri::AppHandle,
    state: State<AppState>,
    dto: &CaptureRequestDto,
) -> Result<ArtifactRefDto, String> {
    let result = run_capture_inner(app, state, dto);
    if let Err(message) = &result {
        let _ = app.emit("capture-failed", message.clone());
    }
    result
}

fn run_capture_inner(
    app: &tauri::AppHandle,
    state: State<AppState>,
    dto: &CaptureRequestDto,
) -> Result<ArtifactRefDto, String> {
    // C639-004: provenance comes from the ORIGINAL request (`dto.mode`),
    // never from the erased `CaptureMode` variant below — "region"
    // (direct, no picker involved) and "region-overlay" both lower to the
    // same `CaptureMode::RegionVirtual`, but only the overlay request has
    // (or needs) a `pending_overlay` session to borrow. Read before
    // `build_mode` takes the pending context.
    let is_overlay_request = dto.mode == "region-overlay";
    // C639-007C.3: an overlay request's identity is the session id its OWN
    // overlay page learned from `overlay_context` when it opened — carried
    // in the DTO as `overlay_session_id` — never inferred from whichever
    // pick happens to be `active_pick` at the moment this request is
    // actually processed. Round 6 read `active_pick`'s CURRENT value as if
    // it were this request's own identity, which let a stale request (A,
    // already cancelled and superseded by a newer B) silently adopt B's
    // identity instead of failing as the dead session it actually is. A
    // direct (non-overlay) request carries no overlay session and never
    // claimed `active_pick` in the first place.
    let active_claim = if is_overlay_request {
        Some(
            dto.overlay_session_id
                .ok_or_else(|| "region-overlay request missing its overlay session id".to_string())?,
        )
    } else {
        None
    };
    // C639-007C.3: verify, atomically, that THIS request's own session is
    // still the live claim across `active_pick`, `pending_overlay`'s own
    // recorded session, AND the overlay window's owner — before monitor
    // enumeration, before `build_mode` ever reads or consumes `pending_
    // overlay`, before anything of a newer session is touched at all. A
    // stale request fails here having touched nothing. Monitor enumeration
    // below is itself an unbounded OS call, so `build_mode` re-verifies the
    // exact same binding again, atomically, at the actual instant it would
    // consume `pending_overlay` — this check must not be trusted to still
    // hold by the time execution gets there.
    if let Some(session_id) = active_claim {
        if !overlay_request_session_still_current(
            &state.active_pick,
            &state.pending_overlay,
            &state.overlay_window_owner,
            session_id,
        ) {
            return Err(
                "region pick was cancelled or superseded before this capture could run"
                    .to_string(),
            );
        }
    }
    // `region_worker_session_id` below needs the actual pending session —
    // already established to equal `active_claim` by the verification
    // above (re-verified again by `build_mode` at its own point of
    // consumption, per C639-007C.3).
    let overlay_session = active_claim;
    // C639-007C.2: monitor enumeration can also fail before any retirement
    // guard previously ran — an injected/transient enumeration error for an
    // overlay request used to return here with `active_pick` still
    // installed, permanently refusing every later `open_region_overlay`.
    let monitors = retire_claim_on_overlay_build_failure(
        is_overlay_request,
        active_claim,
        &state.active_pick,
        &state.pending_overlay,
        current_monitors(),
    )?;
    // C639-007C.1/007C.2: `build_mode` can fail on several terminal steps
    // for a region-overlay request — `close_overlay_window`, the overlay-
    // destruction wait, a missing `overlay_rect`, or (007C.2) no pending
    // context at all — all BEFORE the worker wrapper (`run_capture_via_
    // worker`'s own unconditional `clear_pick_if_current`) is ever
    // reached. That wrapper was the only release point for the strict
    // `active_pick` reservation once `build_mode` has taken
    // `pending_overlay`; a failure here used to strand this session's
    // token forever, permanently refusing the next `open_region_overlay`.
    // Retire through the exact same `clear_pick_if_current` on every
    // terminal failure here too, using the authoritative `active_claim`.
    let (mode, include_cursor) = retire_claim_on_overlay_build_failure(
        is_overlay_request,
        active_claim,
        &state.active_pick,
        &state.pending_overlay,
        build_mode(dto, app, &state),
    )?;
    let id = next_id(&state);
    // C639 Option C: the final live region read runs in the supervised
    // capture worker (3 s parent deadline, generation fencing, one worker
    // max). All other modes keep the existing direct engine path.
    if let Some((rect, delay_ms)) = worker_region_request(&mode) {
        let session_id = region_worker_session_id(is_overlay_request, overlay_session, || {
            mint_capture_session(&state)
        })?;
        return run_capture_via_worker(
            app,
            &state,
            &id,
            session_id,
            is_overlay_request,
            &rect,
            include_cursor,
            delay_ms,
        );
    }
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
            // C639-004: a global-shortcut capture (Alt+PrintScreen) with the
            // app minimized must bring the preview into view — the DOM dialog
            // cannot unminimize the native window by itself. This runs AFTER
            // acquisition, so focusing cannot pollute the screenshot.
            focus_capture_window(app);
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

/// Extract a worker-suitable region from a built capture mode: the
/// region-overlay path, optionally delay-wrapped. Returns (physical rect,
/// delay_ms). Pure so the routing decision is unit-testable. Any other
/// mode returns None and keeps the direct engine path.
fn worker_region_request(mode: &CaptureMode) -> Option<(Rect, u64)> {
    match mode {
        CaptureMode::RegionVirtual { rect } => Some((*rect, 0)),
        CaptureMode::Delayed { mode, delay_ms } => match mode.as_ref() {
            CaptureMode::RegionVirtual { rect } => Some((*rect, *delay_ms)),
            _ => None,
        },
        _ => None,
    }
}

/// C639-004 dispatch: decide the capture-worker session identity from the
/// request's own provenance (`is_overlay_request`, read from `dto.mode`),
/// never from the erased `CaptureMode` variant — both "region" (direct)
/// and "region-overlay" lower to the same `RegionVirtual`, and routing
/// both into the overlay-required path broke direct region capture (and
/// let a direct request silently borrow an unrelated, concurrently
/// pending overlay's session identity). A direct region request always
/// mints its own fresh id and never touches `pending_overlay`, even when
/// one happens to be live for an unrelated in-flight pick; an overlay
/// request whose context already vanished is a loud error, not a silent
/// substitution. Pure (besides the lazy mint) so the dispatch contract is
/// unit-testable without a live Tauri app.
fn region_worker_session_id(
    is_overlay_request: bool,
    pending_overlay_session: Option<u64>,
    mint_fresh: impl FnOnce() -> u64,
) -> Result<u64, String> {
    if is_overlay_request {
        pending_overlay_session
            .ok_or_else(|| "region overlay session vanished before capture".to_string())
    } else {
        Ok(mint_fresh())
    }
}

/// Mint a fresh monotonic id for a capture-worker admission. Shared by the
/// region-overlay pick (`open_region_overlay`) and a direct region
/// request that has no overlay to borrow an identity from (C639-004) —
/// drawn from the same counter so the two can never collide.
fn mint_capture_session(state: &State<AppState>) -> u64 {
    let mut counter = state.overlay_session.lock().unwrap();
    *counter = counter.wrapping_add(1);
    *counter
}

/// Final live region capture through the supervised worker (C639 Option C).
/// Rebuilds the `CaptureArtifact` from the worker's validated reply,
/// preserving the engine's provenance: cursor state, solid-color warnings,
/// acquisition timestamp, and DPI scale. The worker ran the SAME
/// `NativeRasterEngine` acquisition — including the per-piece blank
/// hard-fail (`validate_raw_blit`) — so the hard-fail blank policy is
/// unchanged; only the execution boundary moved.
#[allow(clippy::too_many_arguments)]
fn run_capture_via_worker(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    id: &str,
    session_id: u64,
    is_overlay_request: bool,
    rect: &Rect,
    include_cursor: bool,
    delay_ms: u64,
) -> Result<ArtifactRefDto, String> {
    let result = run_capture_via_worker_inner(
        app,
        state,
        id,
        session_id,
        is_overlay_request,
        rect,
        include_cursor,
        delay_ms,
    );
    // C639-007C: the strict reservation `open_region_overlay` installs in
    // `active_pick` (C639-007A) has no other release point once
    // `build_mode` has already taken `pending_overlay` — this is it.
    // Terminal success AND terminal failure both retire this session's
    // claim here, unconditionally and regardless of which early-return
    // inside `run_capture_via_worker_inner` produced `result` — otherwise
    // the next `open_region_overlay` is refused forever by this already-
    // finished session's own leftover token. `clear_pick_if_current` only
    // ever clears an EXACT match on `session_id` (C639-007A again), so a
    // direct (non-overlay) request that never claimed `active_pick`, or an
    // overlay request a cancel/newer pick already superseded, both no-op
    // here rather than clearing something that was never (or no longer)
    // this call's to clear.
    if is_overlay_request {
        clear_pick_if_current(&state.active_pick, &state.pending_overlay, session_id);
    }
    result
}

/// `run_capture_via_worker`'s body: the supervised worker round trip plus
/// publication. Split out purely so the caller above can wrap EVERY exit
/// path — including the early `?` returns below — in one unconditional
/// claim-retire (C639-007C), without each exit having to remember it
/// itself.
///
/// Final live region capture through the supervised worker (C639 Option C).
/// Rebuilds the `CaptureArtifact` from the worker's validated reply,
/// preserving the engine's provenance: cursor state, solid-color warnings,
/// acquisition timestamp, and DPI scale. The worker ran the SAME
/// `NativeRasterEngine` acquisition — including the per-piece blank
/// hard-fail (`validate_raw_blit`) — so the hard-fail blank policy is
/// unchanged; only the execution boundary moved.
#[allow(clippy::too_many_arguments)]
fn run_capture_via_worker_inner(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    id: &str,
    session_id: u64,
    is_overlay_request: bool,
    rect: &Rect,
    include_cursor: bool,
    delay_ms: u64,
) -> Result<ArtifactRefDto, String> {
    // Physical pixels in virtual-desktop coords. Negative origins are
    // legitimate (secondary monitor left/above the primary); the worker
    // re-validates the bounds.
    let x = rect.x.round() as i64;
    let y = rect.y.round() as i64;
    let w = rect.w.round().max(1.0) as u64;
    let h = rect.h.round().max(1.0) as u64;
    // C639-007: for an overlay-originated capture, the delay and admission
    // stages below must be able to observe a cancel/supersede that lands
    // while they are in flight, not only once the worker has already
    // replied. A direct (non-overlay) request has no `active_pick` claim to
    // be cancelled against — never cancellable here, same as before.
    let reply = state
        .capture_supervisor
        .execute_region(session_id, x, y, w, h, include_cursor, delay_ms, || {
            is_overlay_request && !pick_still_active(*state.active_pick.lock().unwrap(), session_id)
        })
        .map_err(|e| format!("capture worker: {e}"))?;
    // C639-007B / C639-007D.1: authorize the publication commit under a
    // momentary hold of `active_pick` — just long enough to check-then-
    // decide "yes, this capture may be stored" — but the guard is dropped
    // at the end of THIS block, deliberately before `store_artifact`
    // below, never held across it. `store_artifact` performs unbounded
    // filesystem I/O (directory resolution, on-disk collision checks, a
    // PNG write, a sidecar write); `cancel_region_pick` takes this same
    // lock first, so holding it across that I/O would make cancellation —
    // on whatever thread calls it, potentially the main thread — block for
    // as long as a slow or disconnected filesystem does. Once this check
    // passes, a cancel arriving after is too late to stop publication
    // (same as it already is for any other already-persisted result).
    //
    // C639-007D.1: this authorizes ONLY the commit, nothing else. Whether
    // the result may ALSO steal focus back to the main window is a
    // SEPARATE decision, revalidated fresh after `store_artifact` below
    // (never cached from here) — caching it here let an already-
    // authorized publication's focus decision survive a cancel/supersede
    // that landed during the unbounded write that follows, stealing focus
    // from whatever newer pick is now active.
    if !capture_focus_still_current(is_overlay_request, *state.active_pick.lock().unwrap(), session_id)
    {
        return Err(
            "region pick was cancelled or superseded before the capture could be saved"
                .to_string(),
        );
    }
    let mut artifact = CaptureArtifact::new(
        id.to_string(),
        CaptureKind::Region,
        reply.png_bytes,
        RasterMime::Png,
        reply.width,
        reply.height,
        None,
        None,
        reply.meta.scale,
        CursorState {
            captured: reply.meta.cursor_captured,
            position_physical: reply.meta.cursor_pos,
        },
        reply.meta.captured_at,
        if delay_ms > 0 { Some(delay_ms) } else { None },
    )
    .map_err(|e| format!("worker artifact rejected: {e}"))?;
    artifact.warnings = reply.meta.warnings;
    let saved = store_artifact(state, id.to_string(), artifact)?;
    // C639-007D.1/007D.2: revalidate the focus-eligibility decision HERE,
    // fresh, AFTER `store_artifact`'s unbounded disk write — not reused
    // from the authorization check above. A cancel/supersession landing
    // during that write must be able to suppress this capture's focus
    // steal even though its publication was already authorized and
    // already committed; publication-after-commit is unaffected (the
    // artifact is saved either way; this only gates the follow-on UI
    // action). Notify the main window either way (region captures
    // originate from the overlay window, which closed itself before
    // acquisition).
    //
    // C639-007D.2: a single check-then-separately-call-`focus_capture_
    // window` left a gap between the decision and the action — long
    // enough for A to pass this check, be descheduled, get cancelled
    // while B opens/builds its own picker, then resume and steal focus
    // from B with a decision that was already stale by the time it acted.
    // `focus_capture_window_if_current` closes that gap by re-owning the
    // generation check at each individual window action's point of
    // execution (mirroring `open_region_overlay_claimed`'s own per-step
    // re-checks around `.build()`/`.set_focus()`), never from one decision
    // cached before the whole call.
    focus_capture_window_if_current(app, is_overlay_request, session_id);
    let _ = app.emit("capture-saved", saved.clone());
    Ok(saved)
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

// ---------------------------------------------------------------------------
// Annotation layer (Slice 1 of the annotation/blur/callouts/library program)
// ---------------------------------------------------------------------------
//
// The validated, versioned shape lives entirely in
// `forge_capture_core::annotations` — the ONE authoritative contract. These
// two commands are the sole boundary the JS/webview side goes through:
// `load_annotations` always hands back an already-parsed-and-validated
// `AnnotationsSidecar`, and `save_annotations` re-validates (`parse_sidecar`)
// before anything touches disk, so an invalid shape can never be persisted
// even if the JS side had a bug. The JS renderer consumes this validated
// shape; it never independently parses or re-derives sidecar structure from
// raw bytes.
//
// Commands take the PNG's own path rather than a capture `id` / session
// lookup: the UI already has `pngPath` from `ArtifactRefDto`, and operating
// directly on disk by path means these commands work for any capture the
// app can see, not only one still held in this run's in-memory `captures`
// map (e.g. after a restart, or for a file the user reopened).

/// `<stem>.png` -> `<stem>.annotations.json`, next to the source, never
/// inside it.
fn annotations_sidecar_path(png_path: &std::path::Path) -> std::path::PathBuf {
    png_path.with_extension("annotations.json")
}

/// Writes `bytes` to `path` atomically: a temp file in the same directory,
/// flushed, then renamed over the target. A crash or a concurrent read
/// mid-write can never observe a partial file at `path` — the rename is the
/// only moment the new content becomes visible under the real name, and
/// renames within one directory are atomic on both NTFS and POSIX
/// filesystems. Mirrors the two-phase finalize pattern already used for
/// capture uploads above (`finish_media_upload`), scoped down to one file
/// since a sidecar has no paired media file that must land with it.
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "sidecar path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "sidecar path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    // Include the process id so two FORGE Capture instances writing the same
    // sidecar at once (unlikely, but not impossible) never collide on the
    // temp name itself; the final rename is still the only point of truth.
    let tmp_path = dir.join(format!("{file_name}.tmp-{}", std::process::id()));
    std::fs::write(&tmp_path, bytes).map_err(|e| format!("cannot write sidecar temp file: {e}"))?;
    std::fs::rename(&tmp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path); // best effort — no orphan temp file
        format!("cannot finalize sidecar file: {e}")
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationsLoadDto {
    sidecar: AnnotationsSidecar,
    /// "fresh" (hash matches these exact PNG bytes), "stale" (a sidecar
    /// exists but was drawn against different bytes — the UI must refuse to
    /// render/export it until the mismatch is explicitly accepted), or
    /// "none" (no sidecar exists yet; `sidecar` is a fresh empty one,
    /// already correctly bound to this PNG, ready to edit and save).
    binding: String,
}

fn binding_str(b: SourceBinding) -> &'static str {
    match b {
        SourceBinding::Fresh => "fresh",
        SourceBinding::Stale => "stale",
    }
}

/// Loads (or, if none exists yet, creates in memory — not on disk) the
/// annotation sidecar for the PNG at `pngPath`. Tauri matches invoke
/// argument names exactly (see `begin_region_pick`'s doc comment above), so
/// this stays camelCase to match the JS call.
#[tauri::command]
#[allow(non_snake_case)]
fn load_annotations(pngPath: String) -> Result<AnnotationsLoadDto, String> {
    let png_path = std::path::PathBuf::from(&pngPath);
    let png_bytes = std::fs::read(&png_path).map_err(|e| format!("cannot read source PNG: {e}"))?;
    let (width, height) = png_dimensions(&png_bytes).map_err(err)?;
    let sidecar_path = annotations_sidecar_path(&png_path);
    match std::fs::read_to_string(&sidecar_path) {
        Ok(text) => {
            let sidecar = annotations::parse_sidecar(&text).map_err(err)?;
            // The SHA binding alone only proves these are the bytes the sidecar was drawn
            // against; it says nothing about whether `canvas` honestly describes their decoded
            // dimensions. Checked unconditionally, before reporting any binding status, so a
            // false canvas with a correct hash can never be reported "fresh" and rendered into
            // the wrong coordinate space (Slice 1 review finding).
            annotations::check_canvas_matches_source(&sidecar, width, height).map_err(err)?;
            let binding = binding_str(annotations::check_source_binding(&sidecar, &png_bytes));
            Ok(AnnotationsLoadDto {
                sidecar,
                binding: binding.to_string(),
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let hash = annotations::source_sha256_hex(&png_bytes);
            let sidecar = AnnotationsSidecar::new(
                hash,
                annotations::Canvas {
                    w: width,
                    h: height,
                },
            );
            Ok(AnnotationsLoadDto {
                sidecar,
                binding: "none".to_string(),
            })
        }
        Err(e) => Err(format!("cannot read existing sidecar: {e}")),
    }
}

/// Persists `sidecarJson` for the PNG at `pngPath`, atomically. Re-parses
/// and re-validates through the one authoritative contract
/// (`annotations::parse_sidecar`) and re-checks the source binding against
/// the PNG's current bytes before writing anything — this is the
/// enforcement point, not a formality: a stale or structurally invalid
/// sidecar can never reach disk through this command, regardless of what
/// the caller sent.
#[tauri::command]
#[allow(non_snake_case)]
fn save_annotations(pngPath: String, sidecarJson: String) -> Result<(), String> {
    let png_path = std::path::PathBuf::from(&pngPath);
    let png_bytes = std::fs::read(&png_path).map_err(|e| format!("cannot read source PNG: {e}"))?;
    let (width, height) = png_dimensions(&png_bytes).map_err(err)?;
    let sidecar = annotations::parse_sidecar(&sidecarJson).map_err(err)?;
    // Same canvas/dimension check as load_annotations, and for the same reason: a correct source
    // hash does not prove `canvas` is honest, so a false canvas must be rejected here too, not
    // just on read.
    annotations::check_canvas_matches_source(&sidecar, width, height).map_err(err)?;
    if annotations::check_source_binding(&sidecar, &png_bytes) == SourceBinding::Stale {
        return Err(
            "sidecar's source hash does not match the current PNG bytes — refusing to save against pixels it was not drawn against"
                .to_string(),
        );
    }
    let sidecar_path = annotations_sidecar_path(&png_path);
    atomic_write(&sidecar_path, sidecarJson.as_bytes())
}

/// Exports a sanitized, irreversible redacted derivative (Slice 2). `rgbaBase64` is an ORDINARY
/// flattened RGBA buffer the webview composited (`ui/annotations-render.js`'s
/// `flattenAnnotations`, its existing Slice 1 primitive -- source image plus ordinary
/// annotations, nothing destructive). This command does not trust that buffer to already be
/// sanitized in any way; it performs the actual destructive overwrite itself, which is the
/// trusted export boundary's whole job (review finding, Slice 2: the earlier version trusted an
/// opaque claim from the caller that a buffer was already redacted, which an arbitrary
/// correctly-sized buffer -- including one containing the original, unredacted pixels -- could
/// satisfy without ever being sanitized).
///
/// Concretely, in order:
/// 1. Re-reads `pngPath` from disk -- the actual source, never a caller's claim about it.
/// 2. Decodes its ACTUAL dimensions (`png_dimensions`) and checks the sidecar's `canvas` against
///    them (`check_canvas_matches_source`) -- a caller cannot override the real dimensions by
///    passing different ones; there is no width/height parameter here at all.
/// 3. Checks the sidecar's source SHA against those same real bytes
///    (`check_source_binding`) and refuses a stale sidecar, the same as `load`/`save`.
/// 4. Confirms the sidecar actually declares at least one `Redact` item.
/// 5. Decodes and length-checks the incoming buffer against the REAL dimensions.
/// 6. Overwrites every validated `Redact` rectangle in that buffer with the fixed sanitizing
///    pixel (`annotations::apply_redactions`) -- regardless of what was there before, so a
///    hostile or simply unredacted incoming buffer still ends up sanitized in the output.
/// 7. Encodes and writes only THAT overwritten buffer.
#[tauri::command]
#[allow(non_snake_case)]
fn export_redacted(
    pngPath: String,
    sidecarJson: String,
    rgbaBase64: String,
) -> Result<String, String> {
    let png_path = std::path::PathBuf::from(&pngPath);
    let png_bytes = std::fs::read(&png_path).map_err(|e| format!("cannot read source PNG: {e}"))?;
    let (width, height) = png_dimensions(&png_bytes).map_err(err)?;
    let sidecar = annotations::parse_sidecar(&sidecarJson).map_err(err)?;
    annotations::check_canvas_matches_source(&sidecar, width, height).map_err(err)?;
    if annotations::check_source_binding(&sidecar, &png_bytes) == SourceBinding::Stale {
        return Err(
            "sidecar's source hash does not match the current PNG bytes — refusing to export a redaction against pixels it was not drawn against"
                .to_string(),
        );
    }
    if !annotations::has_redaction(&sidecar) {
        return Err("sidecar has no redact regions — nothing to export".to_string());
    }
    let mut rgba = base64_decode(&rgbaBase64)?;
    let expected_len = width as usize * height as usize * 4;
    if rgba.len() != expected_len {
        return Err(format!(
            "flattened pixel buffer is {} bytes, expected {expected_len} for {width}x{height} RGBA",
            rgba.len()
        ));
    }
    // THE destructive step, performed here, not trusted from the caller: every validated Redact
    // rectangle is overwritten with the fixed sanitizing pixel, regardless of what the incoming
    // buffer contained there.
    annotations::apply_redactions(&mut rgba, width, height, &sidecar);
    // encode_rgba never writes metadata chunks (it only ever emits signature/IHDR/IDAT/IEND --
    // see core/src/png.rs), so the "strip metadata by default" requirement is satisfied by
    // construction, not by anything this command does.
    let output_png_bytes = encode_rgba(width, height, &rgba).map_err(err)?;

    let dir = png_path
        .parent()
        .ok_or_else(|| "pngPath has no parent directory".to_string())?
        .to_path_buf();
    let source_stem = png_path
        .file_stem()
        .ok_or_else(|| "pngPath has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let taken = |s: &str| dir.join(format!("{s}.png")).exists();
    let stem = annotations::versioned_redacted_stem(&source_stem, &taken);
    let out_path = dir.join(format!("{stem}.png"));
    atomic_write(&out_path, &output_png_bytes)?;
    Ok(out_path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Durable tags and the rebuildable library index (Slice 4)
// ---------------------------------------------------------------------------

/// `<stem>.png` -> `<stem>.meta.json` -- a sidecar separate from both the capture's own
/// `.forge.json` provenance sidecar and its `.annotations.json`, mirroring
/// `annotations_sidecar_path`'s convention.
fn capture_meta_path(png_path: &std::path::Path) -> std::path::PathBuf {
    png_path.with_extension("meta.json")
}

/// The tags for the capture at `pngPath`. No meta file yet is not an error -- it means no tags
/// have ever been set, so this returns an empty list rather than requiring a file to exist first.
#[tauri::command]
#[allow(non_snake_case)]
fn load_capture_tags(pngPath: String) -> Result<Vec<String>, String> {
    let png_path = std::path::PathBuf::from(&pngPath);
    match std::fs::read_to_string(capture_meta_path(&png_path)) {
        Ok(text) => Ok(capture_meta::parse_meta(&text).map_err(err)?.tags),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("cannot read capture tags: {e}")),
    }
}

/// Replaces the tag list for the capture at `pngPath`. Each incoming tag is trimmed
/// (`capture_meta::normalize_tag`) before validation, so a caller cannot accidentally persist
/// pure-whitespace differences as distinct tags; validation (non-empty, length cap, no
/// duplicates, count cap) then runs the same way it would for any other capture-meta write.
/// Written atomically, same as every other sidecar in this program.
#[tauri::command]
#[allow(non_snake_case)]
fn save_capture_tags(pngPath: String, tags: Vec<String>) -> Result<(), String> {
    let png_path = std::path::PathBuf::from(&pngPath);
    if !png_path.exists() {
        return Err(format!("no capture at {}", png_path.display()));
    }
    let meta = CaptureMeta {
        tags: tags
            .iter()
            .map(|t| capture_meta::normalize_tag(t))
            .collect(),
        ..CaptureMeta::new()
    };
    let json = meta.to_json().map_err(err)?;
    atomic_write(&capture_meta_path(&png_path), json.as_bytes())
}

/// Best-effort: a capture's window title, if its `.forge.json` sidecar has one. Reads the raw
/// JSON directly rather than requiring strict `artifact::parse_sidecar` success, since not every
/// sidecar in the captures dir is a still-capture artifact (recordings use a simpler inline
/// shape) -- this is opt-in, best-effort metadata for the library index, not a security boundary,
/// so a missing/unexpected shape here means "no title", never a hard failure.
fn read_window_title(forge_json_path: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(forge_json_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("window")?
        .get("title")?
        .as_str()
        .map(str::to_string)
}

/// Rebuilds `library-index.json` from scratch by scanning the captures directory -- a derived
/// cache, never a source of truth. Tags are projected from each capture's own durable
/// `.meta.json` (never originated here); rebuilding can never lose a tag, only the index file
/// itself. `titleIndexingEnabled` is opt-in and caller-supplied every call -- there is no stored
/// "title indexing is on" setting this command reads on its own, so a caller that never asks for
/// titles can never get them by accident.
///
/// Stems are enumerated from `.forge.json` files (every file this app writes gets one -- the
/// existing invariant `unique_stem` already depends on). A corrupt or missing `.meta.json` for a
/// given capture is treated as "no tags" rather than failing the whole rebuild: this is a search
/// convenience index, not a security-sensitive path, and one bad sidecar should not make every
/// other capture briefly unsearchable.
#[tauri::command]
#[allow(non_snake_case)]
fn rebuild_library_index(titleIndexingEnabled: bool) -> Result<String, String> {
    rebuild_library_index_in(&captures_dir()?, titleIndexingEnabled)
}

/// The directory-parameterized rebuild logic, separated from the Tauri command so tests can
/// point it at a temp directory instead of the real captures dir -- the same thin-wrapper split
/// already used for every other filesystem-touching command in this file.
fn rebuild_library_index_in(
    dir: &std::path::Path,
    title_indexing_enabled: bool,
) -> Result<String, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| format!("cannot list captures dir: {e}"))? {
        let entry = entry.map_err(|e| format!("cannot read captures dir entry: {e}"))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".forge.json") else {
            continue;
        };
        let stem = stem.to_string();

        let tags = std::fs::read_to_string(dir.join(format!("{stem}.meta.json")))
            .ok()
            .and_then(|text| capture_meta::parse_meta(&text).ok())
            .map(|meta| meta.tags)
            .unwrap_or_default();
        let title = if title_indexing_enabled {
            read_window_title(&path)
        } else {
            None
        };

        entries.push(LibraryIndexEntry { stem, tags, title });
    }

    let index = LibraryIndex::build(entries, title_indexing_enabled);
    let json = index.to_json().map_err(err)?;
    let index_path = dir.join("library-index.json");
    atomic_write(&index_path, json.as_bytes())?;
    Ok(index_path.to_string_lossy().into_owned())
}

/// Process Training (PT-1) — starts the hook/capture-worker/UI-Automation-
/// evidence pipeline (`forge_capture_core::process_capture`). **Not
/// invoked by any startup path, any test, or any other command in this
/// codebase as of this sub-slice** — no UI exists yet to call it, and no
/// Rust test exercises it either, since doing so would install a real,
/// live, global mouse hook on whatever machine runs the test. Wiring it
/// up to a Tauri command is the deliberate "implemented, not activated"
/// line the approved design's safety gate asks for: the capability exists
/// in the built binary, but nothing in this program's own operation ever
/// calls it. `authorTrustedProcesses` must be exactly the lowercase
/// executable names the caller has already shown the author the required
/// disclosure for — this command does not show any UI itself.
#[tauri::command]
#[allow(non_snake_case)]
fn process_capture_start_session(
    authorTrustedProcesses: Vec<String>,
    persistVerbatimMetadata: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let mut slot = state
        .process_capture
        .lock()
        .map_err(|_| "process capture state poisoned".to_string())?;
    if slot.is_some() {
        return Err("a process-capture session is already running".to_string());
    }
    let config = ProcessCaptureConfig {
        self_pid: std::process::id(),
        author_trusted_processes: authorTrustedProcesses
            .into_iter()
            .map(|s| s.to_lowercase())
            .collect(),
        persist_verbatim_metadata: persistVerbatimMetadata,
    };
    if let Ok(mut shared) = state.process_capture_events.lock() {
        *shared = forge_capture_core::process_capture::BoundedDropOldest::new(
            512,
            256 * 1024 * 1024,
            pipeline_message_size,
        );
    }
    let events_for_sink = state.process_capture_events.clone();
    let handle = process_capture::start(
        config,
        Box::new(move |message| {
            if let Ok(mut v) = events_for_sink.lock() {
                v.push(message);
            }
        }),
    )
    .map_err(err)?;
    *slot = Some(handle);
    Ok(())
}

/// Stops a running PT-1 session: signals all three pipeline threads,
/// joins them, and drops `IUIAutomation`/the hook before returning. Safe
/// to call even though nothing in this codebase ever starts a session —
/// included for completeness and so the command pair is symmetric for
/// whatever UI eventually calls it.
#[tauri::command]
fn process_capture_stop_session(state: State<AppState>) -> Result<(), String> {
    let handle = state
        .process_capture
        .lock()
        .map_err(|_| "process capture state poisoned".to_string())?
        .take();
    match handle {
        Some(h) => {
            h.stop();
            Ok(())
        }
        None => Err("no process-capture session is running".to_string()),
    }
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

/// Local-display payload for the capture preview dialog (C639-001).
///
/// Unlike `get_capture_upload_payload` — whose 25MB cap is a *server-upload*
/// policy — this path must not refuse a valid large capture: a 3840×2160
/// RGBA screenshot is ~33MB raw before PNG overhead, so the upload cap
/// would wrongly block local preview of ordinary 4K captures. Bounded at
/// 256MB as a sanity limit against pathological files; empty payloads are
/// refused loudly so the preview can show a real error instead of a blank
/// image (C639-003).
#[tauri::command]
fn get_capture_preview_payload(
    id: String,
    state: State<AppState>,
) -> Result<CaptureUploadPayloadDto, String> {
    const PREVIEW_CAP_BYTES: usize = 256 * 1024 * 1024;
    let (bytes, sidecar_json) = {
        let captures = state.captures.lock().unwrap();
        let stored = captures
            .get(&id)
            .ok_or_else(|| format!("unknown capture id: {id}"))?;
        (stored.png_bytes.clone(), stored.sidecar_json.clone())
    };
    if bytes.is_empty() {
        return Err("Capture has no image data.".to_string());
    }
    if bytes.len() > PREVIEW_CAP_BYTES {
        return Err("Capture exceeds the 256 MB local preview limit.".to_string());
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

/// Dependency-free, STRICT base64 decoder (standard alphabet, padded), the
/// inverse of `base64_encode`. Used for `export_redacted`'s flattened RGBA
/// payload from JS -- that direction has no existing decoder in this
/// codebase (every prior use only ever encoded Rust bytes for JS to
/// consume), and this is new code on an IPC boundary, so it rejects
/// malformed length/padding rather than silently decoding it (review
/// finding, Slice 2: the previous version stripped every trailing '=' first
/// and then decoded whatever chunk length was left, including an invalid
/// length-1 final chunk -- e.g. a single stray character would silently
/// "decode" to a byte built from only 6 real bits instead of failing).
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(format!("invalid base64 character: {}", c as char)),
        }
    }
    let bytes = input.as_bytes();
    if !bytes.iter().all(u8::is_ascii) {
        return Err("base64 input must be ASCII".to_string());
    }
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    // Valid padded base64's total length (including any '=' padding) is always a multiple of 4.
    // The previous decoder stripped padding BEFORE checking this, which is exactly how a
    // too-short, malformed input slipped through.
    if !bytes.len().is_multiple_of(4) {
        return Err(format!(
            "invalid base64 length {} (must be a multiple of 4, including padding)",
            bytes.len()
        ));
    }
    let padding = bytes.iter().rev().take_while(|&&b| b == b'=').count();
    if padding > 2 {
        return Err("invalid base64 padding (more than 2 '=' characters)".to_string());
    }
    // '=' is only ever valid in that trailing run -- never anywhere else in the input.
    if bytes[..bytes.len() - padding].contains(&b'=') {
        return Err("invalid base64 padding ('=' may only appear at the very end)".to_string());
    }
    let num_chunks = bytes.len() / 4;
    let mut out = Vec::with_capacity(num_chunks * 3);
    for (i, chunk) in bytes.chunks(4).enumerate() {
        let is_last = i == num_chunks - 1;
        let chunk_padding = if is_last { padding } else { 0 };
        let mut n: u32 = 0;
        for (j, &c) in chunk.iter().enumerate() {
            let v = if c == b'=' { 0 } else { value(c)? };
            n |= v << (18 - 6 * j);
        }
        out.push((n >> 16) as u8);
        if chunk_padding < 2 {
            out.push((n >> 8) as u8);
        }
        if chunk_padding < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
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

// ---------------------------------------------------------------------------
// Main-thread dispatch (C639-001)
// ---------------------------------------------------------------------------
//
// `begin_region_pick`, `retry_region_backdrop` and `capture` all run
// orchestration that can legitimately block for up to the capture
// worker's ~3.5 s budget (admission + native round trip + termination
// confirmation). Tauri's documented default is that a command WITHOUT
// `async` runs on the application's main thread — the same thread that
// pumps the event loop and delivers window-destruction, IPC and hotkey
// events. Blocking it for seconds means none of those can be processed
// for the duration, which is exactly how a window that never finishes
// closing (because the main thread is busy polling for it to finish
// closing) becomes possible. (The prior per-module doc's claim of a
// "Tauri command-pool thread" was incorrect — there is no such pool for
// sync commands; this is the actual F12 correction.)
//
// The fix: these three commands are `async fn`, and their entire bodies
// run via `tauri::async_runtime::spawn_blocking` on a plain background
// thread — never the main thread, never a bare in-process thread with no
// bound (spawn_blocking's pool IS bounded and its lifetime is owned by
// the join handle this awaits). Window CREATION specifically
// (`WebviewWindowBuilder::build`) is marshaled back onto the main thread
// via `run_on_main_thread_sync` below, since creating a native window is
// the one operation most tied to owning the platform message loop.
// Window close/hide/show/set_focus are left as direct calls off the main
// thread — consistent with this codebase's own pre-existing
// `spawn_overlay_watchdog`, which has closed the overlay window from a
// background `std::thread` for as long as it has existed, unflagged by
// this review.

/// Bridge a background thread to the main thread for one `FnOnce`, and
/// wait (bounded) for its result. Used only for the window actions that
/// need to run on the thread owning the event loop — never for the
/// blocking native/supervisor work itself, which must stay off the main
/// thread. Bounded rather than an unbounded `recv()`: a main thread that
/// never services the dispatch (e.g. mid-shutdown) must surface as a
/// loud error here, not hang the caller forever — "hang-safe by
/// construction" applies to this bridge too, not just the capture worker.
fn run_on_main_thread_sync<R: Send + 'static>(
    app: &tauri::AppHandle,
    f: impl FnOnce() -> R + Send + 'static,
) -> Result<R, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("cannot dispatch to main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| {
        "main-thread task did not reply within 5s (app may be shutting down)".to_string()
    })
}

/// C639-007C.7: a bounded channel (what `run_on_main_thread_sync` uses)
/// cannot tell a late-running main-thread closure "the waiter already gave
/// up" — once the receiving end is dropped on timeout, a closure that
/// finally runs afterward just has its `send` silently discarded. For a
/// closure whose action is a committing side effect the caller is relying
/// on to be paired with a later restore (the Retry hide below), that is
/// exactly backwards: the mutation still happens, with nobody left who
/// knows to undo it. `AbandonableBridge` makes "has anyone already given
/// up" and "what did the action decide" one piece of state, guarded by one
/// lock, so the two can never race past each other: either the waiter
/// observes the action's result (it committed first), or the action, once
/// it finally runs, observes the abandonment and skips its own body
/// entirely (the waiter gave up first) — there is no third interleaving
/// where the action runs after the waiter has already walked away.
///
/// C639-007C.8: the lock must never be held across `action` itself.
/// `action` is a potentially-blocking/native call (a window `hide()`) whose
/// duration is not guaranteed, and `wait_or_abandon` can only return by
/// reacquiring this same lock — so holding it across `action` defeats the
/// waiter's own timeout: a stuck `action` hangs the waiter indefinitely,
/// not just for 5s. `Running` makes claiming "I am about to run `action`"
/// a separate, instantaneous lock hold from running it: `settle` claims
/// `Pending -> Running` and releases the lock BEFORE calling `action`, so
/// the waiter can reacquire the lock and mark `Abandoned` the moment its
/// timeout elapses, no matter how long `action` goes on running. Because
/// the lock is released before `action` runs, a `Running` action that
/// commits its result after the waiter has already abandoned cannot be
/// delivered — nobody is left waiting — so `settle` calls `compensate`
/// with that result instead, exactly once, also outside the lock: the
/// counterpart that undoes whatever committing side effect `action` just
/// performed (e.g. re-showing a window `action` already hid).
enum AbandonableOutcome<T> {
    Pending,
    Running,
    Abandoned,
    Done(T),
}

struct AbandonableBridge<T> {
    state: Mutex<AbandonableOutcome<T>>,
    cv: Condvar,
}

impl<T: Clone> AbandonableBridge<T> {
    fn new() -> Self {
        Self {
            state: Mutex::new(AbandonableOutcome::Pending),
            cv: Condvar::new(),
        }
    }

    /// Run `action` — but only if the waiter has not already abandoned
    /// this bridge. Called from the main-thread closure, whenever it
    /// actually runs (immediately, or long after a busy main thread
    /// finally drains its queue). Claiming the right to run `action` (the
    /// `Pending -> Running` transition) and actually running it are two
    /// separate steps: the lock is held only for the former, so a slow or
    /// stuck `action` can never block the waiter from timing out. If
    /// `action` commits while the bridge is still un-abandoned, its result
    /// is recorded and the waiter is woken. If the waiter has already
    /// abandoned — either before `action` started (checked up front, so a
    /// not-yet-started closure skips `action` entirely: no hide, no window
    /// lookup, nothing) or while `action` was running (checked again after
    /// it returns) — `compensate` is called with `action`'s result instead
    /// of delivering it to nobody.
    fn settle(&self, action: impl FnOnce() -> T, compensate: impl FnOnce(T)) {
        {
            let mut guard = self.state.lock().unwrap();
            match &*guard {
                AbandonableOutcome::Abandoned => return,
                AbandonableOutcome::Pending => *guard = AbandonableOutcome::Running,
                AbandonableOutcome::Running | AbandonableOutcome::Done(_) => {
                    unreachable!("settle is called exactly once per bridge")
                }
            }
        }
        // The lock is NOT held here: `action` may block indefinitely (a
        // native window call), and the waiter must still be able to time
        // out and mark `Abandoned` while this runs.
        let result = action();
        let mut guard = self.state.lock().unwrap();
        if matches!(*guard, AbandonableOutcome::Abandoned) {
            drop(guard);
            compensate(result);
            return;
        }
        *guard = AbandonableOutcome::Done(result);
        self.cv.notify_all();
    }

    /// Block up to `timeout` for `settle` to commit. If `action` committed
    /// in time — including the boundary where it committed right as the
    /// timeout elapsed, which this re-checks under the same lock rather
    /// than trusting a separate timed-out flag — its result is returned.
    /// Otherwise the bridge is marked `Abandoned`, atomically, under the
    /// same lock, regardless of whether `settle` has not yet started
    /// (`Pending`) or is still running `action` (`Running`) — the lock is
    /// never held by `action` itself (see `settle`), so this always
    /// returns within `timeout` plus ordinary scheduling slop, never
    /// waiting for `action` to finish.
    fn wait_or_abandon(&self, timeout: Duration) -> Result<T, String> {
        let guard = self.state.lock().unwrap();
        let (mut guard, _) = self
            .cv
            .wait_timeout_while(guard, timeout, |s| {
                matches!(s, AbandonableOutcome::Pending | AbandonableOutcome::Running)
            })
            .unwrap();
        match &*guard {
            AbandonableOutcome::Done(v) => Ok(v.clone()),
            AbandonableOutcome::Pending | AbandonableOutcome::Running => {
                *guard = AbandonableOutcome::Abandoned;
                Err(
                    "main-thread task did not reply within the bound (treated as abandoned)"
                        .to_string(),
                )
            }
            AbandonableOutcome::Abandoned => {
                unreachable!("only wait_or_abandon ever sets Abandoned, and it returns immediately after")
            }
        }
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

/// Open the fullscreen region-picker overlay on a monitor.
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
async fn begin_region_pick(
    monitorId: String,
    delayMs: Option<u64>,
    includeCursor: Option<bool>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let delay_ms = delayMs.unwrap_or(0);
    let include_cursor = includeCursor.unwrap_or(true);
    // C639-001: the whole orchestration (backdrop acquisition through the
    // supervised worker, closing/waiting-out a stale overlay, building
    // the new one) runs off the main thread — see the module note above
    // `run_on_main_thread_sync`.
    tauri::async_runtime::spawn_blocking(move || {
        open_region_overlay(&app, &monitorId, delay_ms, include_cursor)
    })
    .await
    .map_err(|e| format!("region-pick background task failed: {e}"))?
}

/// Shared overlay path: the `begin_region_pick` command and the
/// Shift+PrintScreen hotkey both open the overlay through here.
///
/// The frozen backdrop is captured BEFORE the overlay window is created, so
/// the overlay can never appear in (or blank) its own backdrop. A frame
/// that comes back a single solid color sets the context's `backdrop_blank`
/// flag instead of aborting the pick: the overlay opens with a blank-frame
/// warning (retry / proceed / cancel), because a genuinely solid-color
/// desktop is rare but legitimate and a hard abort would strand that user.
/// The overlay window itself is opaque: it draws the frozen PNG, so no
/// transparent-window compositing is required.
///
/// At most one region pick is ever in flight: a second open while a LIVE
/// session (one whose overlay window still exists) is pending is rejected,
/// and a leftover overlay window from a dead session is fully closed (not
/// just asked to close) before the new window is built, so two pages can
/// never race against one context. An orphaned `pending_overlay` — its
/// window already gone with no window left for the user to cancel, e.g. the
/// page crashed before calling `cancel_region_pick` — is reclaimed here
/// rather than rejected, so a crash can't lock Region out until the 60s
/// watchdog eventually clears it.
fn open_region_overlay(
    app: &tauri::AppHandle,
    monitor_id: &str,
    delay_ms: u64,
    include_cursor: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let overlay_window_present = app.get_webview_window("overlay").is_some();
    if state.pending_overlay.lock().unwrap().is_some() && overlay_window_present {
        return Err("a region pick is already in progress; cancel it first".to_string());
    }
    // Either nothing is pending, or `pending_overlay` is orphaned (Some,
    // but its window is already gone) — the check above let that case
    // through deliberately. Close it and wait until it is really gone
    // before building the new window on the same label — `close()` is
    // asynchronous and the builder would otherwise race it. This whole
    // function runs off the main thread (C639-001), so this poll loop no
    // longer risks starving the event loop that actually has to deliver
    // the window-destruction event it is waiting for.
    if overlay_window_present {
        close_overlay_window(app)?;
        // This is an orphan reclaim (no pending context claims this
        // window — see the check above), so whatever stale session the
        // owner token names, if any, is forcibly destroyed along with it.
        *state.overlay_window_owner.lock().unwrap() = None;
        if !wait_for_overlay_gone(app, Duration::from_millis(1500)) {
            return Err(
                "stale overlay window did not close; region pick aborted rather than \
                 racing a new picker against the old one"
                    .to_string(),
            );
        }
    }
    let monitors = current_monitors()?;
    let monitor = monitors
        .iter()
        .find(|m| m.id == monitor_id)
        .ok_or_else(|| format!("unknown monitor id: {monitor_id}"))?;
    // Mint the session before acquisition so the worker request carries
    // the session identity the overlay (and its watchdog) will use, and
    // claim `active_pick` immediately (C639-007): a `cancel_region_pick`
    // landing during the blocking backdrop acquisition below must be able
    // to supersede this one before it ever installs a window — not only
    // after.
    //
    // C639-007A: this claim is a strict reservation (refuse if something
    // else already holds it), never an unconditional overwrite. An
    // earlier design let a second opener overwrite a still-live claim and
    // then "restore" it on its own failure — but restoring a displaced
    // token cannot undo a supersession the displaced operation already
    // observed and aborted on, which could resurrect a stale token with
    // no live owner, or let a second opener silently cancel a first one
    // it was never entitled to touch. Refusing outright is both simpler
    // and strictly safe: a concurrent second open is told to retry
    // (mirroring the existing post-window-build refusal above) instead of
    // racing ownership of `active_pick`. `cancel_region_pick` itself is
    // unaffected — it unconditionally clears the slot, same as always.
    let session_id = mint_capture_session(&state);
    {
        let mut active = state.active_pick.lock().unwrap();
        if active.is_some() {
            return Err(
                "a region pick is already starting; try again in a moment".to_string(),
            );
        }
        *active = Some(session_id);
    }
    let result = open_region_overlay_claimed(
        app,
        &state,
        monitor,
        monitor_id,
        delay_ms,
        include_cursor,
        session_id,
    );
    if result.is_err() {
        // We know we were the only claimant (nothing could have displaced
        // us pre-resolution, since claiming above refuses rather than
        // overwrites), so clearing unconditionally here is always exactly
        // our own claim — never someone else's.
        clear_pick_if_current(&state.active_pick, &state.pending_overlay, session_id);
        // C639-001C.1: `result` being an error does not prove the
        // main-thread closure dispatched above never finished building
        // (and focusing) the window — a timeout in `run_on_main_thread_sync`
        // means the CALLER gave up after 5s, not that the closure, already
        // queued on the main thread, stopped running. If it finishes just
        // after this point, its own post-focus check (inside the closure)
        // can lose a narrow race against this exact cleanup. The clear
        // above just released THIS session's reservation, so by the time
        // this line runs a NEWER session may already have been admitted,
        // built its own window, and be live — closing "whatever is
        // labeled overlay" would be closing that newer window, not ours.
        // `close_owned_overlay_window` binds the close to the
        // `overlay_window_owner` token instead of the window's shared
        // label: it only ever closes a window this exact `session_id`
        // itself built, and no-ops otherwise — whether that's because no
        // window was ever built, or because the closure's own check
        // already closed it, or because a newer session now owns the
        // label.
        let _ = close_owned_overlay_window(app, session_id);
    }
    result
}

/// The body of `open_region_overlay` that runs once `session_id` has
/// already claimed `active_pick`. Split out so every failure path — from
/// here through the main-thread window build — funnels through the same
/// restore-on-failure cleanup in the caller, instead of each early return
/// having to remember to clean up itself.
fn open_region_overlay_claimed(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    monitor: &Monitor,
    monitor_id: &str,
    delay_ms: u64,
    include_cursor: bool,
    session_id: u64,
) -> Result<(), String> {
    // 1. Frozen backdrop first, while no overlay window exists. Runs in
    // the supervised capture worker (C639 Option C) — a blocking native
    // round trip, fine here since this whole function is already off the
    // main thread.
    let backdrop_png = capture_region_backdrop(state, session_id, &monitor.id)?;
    let (_, _, rgba) =
        decode_own(&backdrop_png).map_err(|e| format!("backdrop decode failed: {e}"))?;
    let backdrop_blank = solid_frame_rgba(&rgba);
    // Tauri `position`/`inner_size` take *logical* units: convert the
    // monitor's physical virtual-desktop rect, or the overlay lands in the
    // wrong place at the wrong size on mixed-DPI setups.
    let origin = monitor.virtual_to_logical_placement(
        monitor.origin_virtual.0 as i64,
        monitor.origin_virtual.1 as i64,
    );
    let size_logical = monitor.size_logical;
    let app_for_build = app.clone();
    // C639-007: re-check the active-pick token AND install the context
    // under ONE held lock, so a cancel (or a newer pick) landing between
    // "the backdrop finished" and "this context exists" can never slip
    // through. Unlike before (C639-001A), this lock is released as soon as
    // the context is installed — NOT held across the main-thread dispatch
    // below, which can block for up to 5 seconds. Holding a shared
    // cancellation/session lock across that wait is exactly what let
    // `cancel_region_pick` get stuck behind a slow/busy main thread and
    // then lose to an already-queued window build.
    {
        let active = state.active_pick.lock().unwrap();
        if !pick_still_active(*active, session_id) {
            return Err(
                "region pick was cancelled or superseded before the backdrop finished"
                    .to_string(),
            );
        }
        *state.pending_overlay.lock().unwrap() = Some(OverlayContext {
            monitor_id: monitor_id.to_string(),
            origin_virtual: monitor.origin_virtual,
            dpr: monitor.scale,
            delay_ms,
            include_cursor,
            backdrop_png: Some(backdrop_png),
            session_id,
            backdrop_blank,
        });
    }
    // C639-001: window CREATION is marshaled onto the main thread — the
    // one window action here most tied to owning the platform message
    // loop. `.set_focus()` travels with it in the same dispatch so the
    // window is built and focused as one main-thread unit, rather than a
    // second bounded round trip for a cosmetic follow-up.
    //
    // C639-001A / C639-001B: the closure re-validates `active_pick` BEFORE
    // building (catches a cancel that landed before this closure started —
    // including a late-queued closure that only runs after its caller gave
    // up), and AGAIN right after `.build()` returns, BEFORE focusing
    // (catches a cancel that lands WHILE the native build is in flight —
    // `build()` can in principle take longer than the caller's own 5s
    // bridge timeout, and holding the session lock across it would just
    // reintroduce the original C639-001A hazard one level deeper). If the
    // second check finds we were cancelled/superseded mid-build, the
    // window we just created is closed here, immediately, rather than
    // left to show and rely on `cancel_region_pick`'s own best-effort
    // close as the only backstop. Each check holds the lock only for its
    // own instant, never across `build()` or `set_focus()` themselves.
    run_on_main_thread_sync(app, move || -> Result<(), String> {
        let state = app_for_build.state::<AppState>();
        if !pick_still_active(*state.active_pick.lock().unwrap(), session_id) {
            return Err(
                "region pick was cancelled or superseded before the window could open"
                    .to_string(),
            );
        }
        let window = tauri::WebviewWindowBuilder::new(
            &app_for_build,
            "overlay",
            // C639-007C.4: the page's own session id travels in the URL
            // itself, readable synchronously (`location.search`) the
            // instant the page's script runs — unlike `overlay_context`'s
            // own async round trip, this is available before ANY of the
            // page's IPC calls (including the Esc/right-click cancel
            // hatches, wired before `overlay_context` ever resolves) can
            // fire. `Url::join` (what `WebviewUrl::App` resolves through)
            // parses `?query` per RFC 3986, so the query string survives
            // intact rather than being percent-escaped into the path.
            tauri::WebviewUrl::App(format!("overlay.html?session={session_id}").into()),
        )
        .title("Select region")
        .position(origin.x, origin.y)
        .inner_size(size_logical.0 as f64, size_logical.1 as f64)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .build()
        .map_err(|e| format!("cannot open overlay: {e}"))?;
        // C639-001C.1: record ownership the instant a window actually
        // exists, so any cleanup from here on — this closure's own
        // cancel-closes below, or a stale outer caller's owned close — can
        // tell THIS session's window apart from whatever window (if any)
        // a different session owns by the time it runs.
        *state.overlay_window_owner.lock().unwrap() = Some(session_id);
        if !pick_still_active(*state.active_pick.lock().unwrap(), session_id) {
            let _ = window.close();
            *state.overlay_window_owner.lock().unwrap() = None;
            return Err(
                "region pick was cancelled or superseded while the window was opening"
                    .to_string(),
            );
        }
        // Esc / right-click cancel lives in the overlay page, so the
        // window must own keyboard focus for the escape hatches to work.
        let _ = window.set_focus();
        // C639-001C.1: a third check, after focusing. The caller's own
        // wait for this closure is bounded (`run_on_main_thread_sync`'s 5s
        // `recv_timeout`), but this closure is not — once dispatched, it
        // runs to completion on the main thread regardless of whether the
        // caller already gave up. If `.build()` finished just before the
        // caller's timeout, the check above passed, and then `set_focus()`
        // (or just the time already spent) crosses that timeout, the
        // caller returns an error and clears the token — leaving this
        // closure the only thing that still knows a window exists. Catch
        // that here: close the window THIS closure just built instead of
        // leaving it orphaned with no backing state.
        if !pick_still_active(*state.active_pick.lock().unwrap(), session_id) {
            let _ = window.close();
            *state.overlay_window_owner.lock().unwrap() = None;
            return Err(
                "region pick was cancelled or superseded while the window was focusing"
                    .to_string(),
            );
        }
        Ok(())
    })??;
    spawn_overlay_watchdog(app.clone(), session_id);
    Ok(())
}

/// Clear `session_id`'s claim on `active_pick`/`pending_overlay` — but only
/// if it is still exactly this session's claim (a no-op if a cancel already
/// cleared it first, or if a newer session now owns the slot). Used on
/// every exit path of a claimed pick attempt: the failure paths inside
/// `open_region_overlay` (backdrop error, cancelled/superseded mid-flight,
/// main-thread dispatch timeout, window-build failure), AND — C639-007C —
/// both the success and failure paths of `run_capture_via_worker`, which is
/// the strict reservation's (C639-007A) only release point once
/// `build_mode` has already taken `pending_overlay`. Safe to call
/// unconditionally in all of these because claiming only ever refuses
/// rather than overwrites: a call here can only ever be clearing its OWN
/// claim, never one it displaced from someone else.
///
/// Takes the raw mutexes rather than `&State<AppState>` so this — the exact
/// production retire logic, not a reimplementation of it — stays
/// unit-testable without a live Tauri app (same reasoning as
/// `pick_still_active` et al. above).
fn clear_pick_if_current(
    active_pick: &Mutex<Option<u64>>,
    pending_overlay: &Mutex<Option<OverlayContext>>,
    session_id: u64,
) {
    let mut active = active_pick.lock().unwrap();
    if *active == Some(session_id) {
        *active = None;
    }
    drop(active);
    let mut pending = pending_overlay.lock().unwrap();
    if pending.as_ref().map(|c| c.session_id) == Some(session_id) {
        *pending = None;
    }
}

/// C639-007C.3: whether `session_id` — the identity an overlay-originated
/// `capture` request carries from its OWN DTO, never inferred from
/// whichever pick happens to be `active_pick` right now — is still the live
/// claim across every piece of state the request depends on: `active_pick`,
/// `pending_overlay`'s own recorded session, and the overlay window's
/// recorded owner. A stranded/superseded request (A, displaced by a newer
/// B) fails this check and must be refused outright, before monitor
/// enumeration, before `build_mode` ever reads or consumes `pending_
/// overlay`, before anything of B's is read or touched. Each lock is held
/// only long enough to compare — same discipline as `clear_pick_if_current`
/// — so this is a point-in-time read, not a reservation held across the
/// caller's own subsequent work (which is why `build_mode` re-verifies the
/// same binding again, atomically, at its own later point of consumption).
fn overlay_request_session_still_current(
    active_pick: &Mutex<Option<u64>>,
    pending_overlay: &Mutex<Option<OverlayContext>>,
    overlay_window_owner: &Mutex<Option<u64>>,
    session_id: u64,
) -> bool {
    if *active_pick.lock().unwrap() != Some(session_id) {
        return false;
    }
    if pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id) != Some(session_id) {
        return false;
    }
    *overlay_window_owner.lock().unwrap() == Some(session_id)
}

/// C639-007C.3: atomically verify `session_id` is still the live claim on
/// BOTH `active_pick` and `pending_overlay`'s own recorded session, and only
/// then consume (`take`) the context — under one held `pending_overlay`
/// lock, with `active_pick` checked first while already holding it, so a
/// cancel or a newer admission landing between those two checks can never
/// let a stale/superseded request slip a NEWER session's context out from
/// under it (and apply its own, unrelated geometry to it). Returns `None`
/// without mutating `pending_overlay` at all when the binding does not
/// hold — a stale request must consume nothing, not even inspect what a
/// newer session installed. Mirrors `clear_pick_if_current`'s own lock
/// order (`active_pick`, then `pending_overlay`) and "hold only long enough
/// to decide" discipline.
fn take_pending_overlay_if_current(
    active_pick: &Mutex<Option<u64>>,
    pending_overlay: &Mutex<Option<OverlayContext>>,
    session_id: u64,
) -> Option<OverlayContext> {
    let active = active_pick.lock().unwrap();
    if *active != Some(session_id) {
        return None;
    }
    let mut pending = pending_overlay.lock().unwrap();
    if pending.as_ref().map(|c| c.session_id) != Some(session_id) {
        return None;
    }
    pending.take()
}

/// Close the overlay window unconditionally — whatever window currently
/// has that label, regardless of which session (if any) owns it — and
/// propagate a failure instead of silently ignoring it: a close that fails
/// leaves an always-on-top fullscreen window on the user's screen, which
/// must not go unreported. Only ever correct where the caller is deliberately
/// reclaiming an ORPHAN (no live session claims this window at all, so there
/// is no ownership to respect) or acting on the user's own explicit cancel —
/// `cancel_region_pick`'s "nuke whatever is active right now" and the
/// orphan-reclaim branch of `open_region_overlay`. A cleanup acting on behalf
/// of one specific, possibly-already-superseded session must use
/// `close_owned_overlay_window` instead (C639-001C.1) — this unconditional
/// version is exactly the "whatever is labeled overlay" lookup that let a
/// stale session's cleanup close a newer session's window.
fn close_overlay_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        w.close()
            .map_err(|e| format!("cannot close overlay window: {e}"))?;
    }
    Ok(())
}

/// C639-001C.1: whether a close acting on behalf of `session_id` may
/// actually tear down the current overlay window — i.e., whether
/// `overlay_window_owner` still names this exact session, not a newer one
/// that has since been admitted and built its own window. Pure so the
/// ownership-binding contract is unit-testable without a live Tauri app,
/// mirroring `pick_still_active`'s shape.
fn owns_overlay_window(owner: Option<u64>, session_id: u64) -> bool {
    owner == Some(session_id)
}

/// Close the overlay window ONLY if `session_id` is still its recorded
/// owner (C639-001C.1) — bound to the actual session-owned window via
/// `overlay_window_owner`, never to "whatever window currently has the
/// shared `overlay` label". A session that never built a window, or whose
/// window a newer session's admission has since superseded in the owner
/// slot, has nothing of its own to close here and no-ops instead of
/// reaching for someone else's window. The owner slot is cleared under the
/// same lock as the ownership check, before the actual close, so a second
/// concurrent call for the same session can only ever win the close once.
fn close_owned_overlay_window(app: &tauri::AppHandle, session_id: u64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut owner = state.overlay_window_owner.lock().unwrap();
    if !owns_overlay_window(*owner, session_id) {
        return Ok(());
    }
    *owner = None;
    drop(owner);
    close_overlay_window(app)
}

/// Poll until the overlay window is actually destroyed. `close()` is
/// asynchronous — callers must not capture until this reports the window
/// gone. Returns false on timeout; the caller reports the abort with the
/// reason that fits its site.
fn wait_for_overlay_gone(app: &tauri::AppHandle, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while app.get_webview_window("overlay").is_some() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    true
}

/// Policy gate for the region-overlay capture path: the overlay must be
/// gone before the live-region BitBlt runs. Pure so the never-capture-
/// with-overlay-visible contract is unit-tested.
fn must_abort_capture_if_overlay_present(overlay_present: bool) -> Result<(), String> {
    if overlay_present {
        Err("overlay window is still open; region capture aborted rather than \
             capturing the picker itself"
            .to_string())
    } else {
        Ok(())
    }
}

/// Capture the frozen fullscreen frame for region picking. The caller must
/// invoke this BEFORE creating the overlay window.
///
/// C639 Option C: the native acquisition runs in the supervised capture
/// worker process (3 s parent deadline, generation fencing, one worker
/// max), never inline on the calling thread. The worker runs the SAME
/// `NativeRasterEngine` code path as before — including the per-piece
/// blank hard-fail (`validate_raw_blit`) — so the blank policy is
/// unchanged; only the execution boundary moved.
fn capture_region_backdrop(
    state: &State<AppState>,
    session_id: u64,
    monitor_id: &str,
) -> Result<Vec<u8>, String> {
    let reply = state
        .capture_supervisor
        .execute_backdrop(session_id, monitor_id)
        .map_err(|e| format!("capture worker: {e}"))?;
    Ok(reply.png_bytes)
}

// ---------------------------------------------------------------------------
// Capture worker entry (`--capture-worker`)
// ---------------------------------------------------------------------------

/// Worker entry point (C639 Option C): reads ONE framed request from
/// stdin, performs exactly one native acquisition with the same
/// `NativeRasterEngine` the parent used to run inline, writes ONE framed
/// reply to stdout, and exits. Phase markers go to stderr; the parent
/// drains them into its ring log.
///
/// This function must never: create a window, touch Tauri state, persist
/// files, touch the network, or call back into the parent. A native error
/// is returned as stage + message — never replaced with a fabricated
/// frame. The per-piece blank hard-fail (`validate_raw_blit`) runs here,
/// unchanged, as part of the engine.
fn capture_worker_main() -> i32 {
    use capture_worker::{
        decode_request_frame, encode_reply_err, encode_reply_ok, ReplyMeta, ReplyStatus,
        RequestTarget, WorkerOp,
    };
    use std::io::Write as _;

    eprintln!("[capture-worker] start pid={}", std::process::id());

    let stdin = std::io::stdin();
    let req = match decode_request_frame(stdin.lock()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[capture-worker] malformed request: {e}");
            return 2;
        }
    };
    eprintln!(
        "[capture-worker] request op={:?} session={} gen={}",
        req.op, req.session_id, req.generation
    );

    // The worker owns enumeration, exactly like the parent did before.
    let monitors = match native::list_monitors() {
        Ok(m) => m,
        Err(e) => {
            return worker_exit_err(
                &req,
                ReplyStatus::WorkerError,
                "enumerate",
                &format!("monitor enumeration failed: {e}"),
            );
        }
    };

    let (mode, monitor_label) = match (&req.op, &req.target) {
        (WorkerOp::Backdrop, RequestTarget::Backdrop { monitor_id }) => {
            if !monitors.iter().any(|m| m.id == *monitor_id) {
                return worker_exit_err(
                    &req,
                    ReplyStatus::WorkerError,
                    "resolve",
                    &format!("unknown monitor id: {monitor_id}"),
                );
            }
            (
                CaptureMode::FullMonitor {
                    monitor_id: monitor_id.clone(),
                },
                monitor_id.clone(),
            )
        }
        (WorkerOp::Region, RequestTarget::Region { x, y, w, h }) => {
            // C639-003 hardening (cross-check, 2026-10-24): the parent-owned
            // delay contract guarantees delay_ms=0 on the wire always — the
            // user's wait already ran as its own pre-admission stage before
            // this worker was even spawned (see `execute_region`). A
            // nonzero value here is a protocol violation, not a request to
            // honor: no caller sends one today, but silently sleeping
            // inside the worker's own fixed CAPTURE_DEADLINE_MS budget
            // would be exactly the kind of latent footgun a future
            // "simplification" could reactivate. Fail loud instead.
            if req.delay_ms != 0 {
                eprintln!(
                    "[capture-worker] rejecting nonzero wire delay_ms={} \
                     (parent-owned delay contract violated)",
                    req.delay_ms
                );
                return worker_exit_err(
                    &req,
                    ReplyStatus::WorkerError,
                    "decode",
                    &format!(
                        "worker received nonzero delay_ms={} (must be 0; delay is parent-owned)",
                        req.delay_ms
                    ),
                );
            }
            let rect = Rect {
                x: *x as f64,
                y: *y as f64,
                w: *w as f64,
                h: *h as f64,
            };
            let mode = CaptureMode::RegionVirtual { rect };
            (mode, format!("region {x},{y} {w}x{h}"))
        }
        _ => {
            return worker_exit_err(
                &req,
                ReplyStatus::WorkerError,
                "decode",
                "op/target mismatch",
            );
        }
    };
    eprintln!("[capture-worker] acquire {monitor_label}");

    let request = CaptureRequest {
        mode,
        include_cursor: req.include_cursor,
        id: format!("worker-{}-{}", req.session_id, req.generation),
    };
    let mut engine = NativeRasterEngine;
    let reply_frame = match engine.acquire(&request, &monitors) {
        ScrollingResult::Complete { artifact } => {
            eprintln!(
                "[capture-worker] complete {}x{} {} bytes",
                artifact.raster_width, artifact.raster_height, artifact.raster_bytes.len()
            );
            let meta = ReplyMeta {
                cursor_captured: artifact.cursor.captured,
                cursor_pos: artifact.cursor.position_physical,
                scale: artifact.scale,
                captured_at: artifact.captured_at.clone(),
                warnings: artifact.warnings.clone(),
            };
            match encode_reply_ok(
                req.session_id,
                req.generation,
                artifact.raster_width,
                artifact.raster_height,
                &artifact.raster_bytes,
                &meta,
            ) {
                Ok(f) => f,
                Err(e) => {
                    return worker_exit_err(&req, ReplyStatus::WorkerError, "encode", &e);
                }
            }
        }
        other => {
            // Preserve the native failure exactly: the engine's own
            // wording as stage + message. No fabricated frame.
            let message = other.describe();
            eprintln!("[capture-worker] native failure: {message}");
            match encode_reply_err(
                req.session_id,
                req.generation,
                ReplyStatus::NativeError,
                "acquire",
                &message,
            ) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[capture-worker] error encode failed: {e}");
                    return 2;
                }
            }
        }
    };

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    if let Err(e) = out.write_all(&reply_frame).and_then(|_| out.flush()) {
        eprintln!("[capture-worker] reply write failed: {e}");
        return 2;
    }
    eprintln!("[capture-worker] done");
    0
}

/// Write a framed error reply and return the process exit code. Used when
/// the worker cannot produce a capture but can still speak protocol.
fn worker_exit_err(
    req: &capture_worker::WorkerRequest,
    status: capture_worker::ReplyStatus,
    stage: &str,
    message: &str,
) -> i32 {
    use std::io::Write as _;
    match capture_worker::encode_reply_err(req.session_id, req.generation, status, stage, message)
    {
        Ok(frame) => {
            let stdout = std::io::stdout();
            let mut out = stdout.lock();
            if out.write_all(&frame).and_then(|_| out.flush()).is_err() {
                return 2;
            }
            0
        }
        Err(e) => {
            eprintln!("[capture-worker] error encode failed: {e}");
            2
        }
    }
}

/// Dump the capture worker's phase ring log (oldest first) for
/// diagnostics. Used by the on-hardware gate to collect phase evidence.
#[tauri::command]
fn capture_phase_log(state: State<AppState>) -> Vec<String> {
    let mut v = state.capture_supervisor.ring().tail(200);
    v.reverse();
    v
}

/// Overlay page phase marker (C639 §5 instrumentation): the page reports
/// page_boot / context / backdrop / image / aim_ready / preview_unavailable
/// with millisecond offsets. Namespaced "overlay" in the ring so frontend
/// markers stay distinguishable from native markers. Fire-and-forget from
/// the page; a failure here never breaks the picker.
#[tauri::command]
fn capture_overlay_phase(
    phase: String,
    ms: u64,
    detail: Option<String>,
    state: State<AppState>,
) {
    let mut d = format!("phase={phase} +{ms}ms");
    if let Some(detail) = detail {
        let mut detail = detail;
        detail.truncate(256);
        d.push_str(&format!(" {detail}"));
    }
    state.capture_supervisor.ring().log("overlay", d);
}

/// True when every pixel of an RGBA frame is byte-identical. A uniform
/// frame usually means a dead/blank capture pipeline — but a genuinely
/// solid-color desktop is also uniform, so this only raises the
/// blank-frame *warning* (retry / proceed / cancel), never a hard abort.
fn solid_frame_rgba(rgba: &[u8]) -> bool {
    if rgba.len() < 8 || !rgba.len().is_multiple_of(4) {
        return false;
    }
    let (first, rest) = rgba.split_at(4);
    let (chunks, _) = rest.as_chunks::<4>();
    chunks.iter().all(|px| px == first)
}

/// Watchdog: if a region pick is still pending after 60 s (the overlay never
/// reported back — e.g. its page failed to load), close the overlay and
/// clear the context so the user is never trapped on a dead fullscreen
/// window. A real region pick takes seconds; 60 s is generous.
///
/// The watchdog captures the session's generation token at spawn time and
/// only acts when the pending context still carries that same token: an old
/// watchdog from a cancelled session can never kill a newer session.
fn spawn_overlay_watchdog(app: tauri::AppHandle, session_id: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        let state = app.state::<AppState>();
        let should_clear =
            watchdog_should_clear(state.pending_overlay.lock().unwrap().as_ref(), session_id);
        if should_clear {
            // C639-007C.2: a watchdog expiry is a terminal failure path
            // like any other and must retire the matching `active_pick`
            // claim too, not just the pending context — through the exact
            // same `clear_pick_if_current` every other retire site uses —
            // or the strict reservation strands this session's token
            // forever, permanently refusing every later
            // `open_region_overlay`.
            clear_pick_if_current(&state.active_pick, &state.pending_overlay, session_id);
            // Clearing `active_pick` above can let a brand-new session be
            // admitted and build its own window before this runs — bind
            // the close to the `overlay_window_owner` token
            // (`close_owned_overlay_window`, C639-001C.1) rather than
            // "whatever is labeled overlay", so a newer session's live
            // window is never the one this stale watchdog closes.
            let _ = close_owned_overlay_window(&app, session_id);
        }
    });
}

/// Pure watchdog decision: clear/close only when the pending context is the
/// very session this watchdog was spawned for. A stale watchdog (older
/// session id, or no pending session at all) must leave everything alone.
fn watchdog_should_clear(pending: Option<&OverlayContext>, watchdog_session: u64) -> bool {
    pending.map(|ctx| ctx.session_id) == Some(watchdog_session)
}

/// C639-007: whether a pick's claim on `active_pick` is still valid after
/// a blocking wait (the initial backdrop acquisition) — i.e. nothing
/// cancelled or superseded it while that wait was in flight. Pure,
/// mirroring `watchdog_should_clear`'s shape.
fn pick_still_active(active_pick: Option<u64>, session_id: u64) -> bool {
    active_pick == Some(session_id)
}

/// C639-007: whether a just-completed overlay-originated capture's own
/// session is still the active pick, and so may steal focus back to the
/// main window. A direct (non-overlay) request always returns true —
/// unchanged behavior, nothing for it to be superseded by. Pure so the
/// stale-focus-steal guard is unit-testable without a live Tauri app.
fn capture_focus_still_current(
    is_overlay_request: bool,
    active_pick: Option<u64>,
    session_id: u64,
) -> bool {
    !is_overlay_request || pick_still_active(active_pick, session_id)
}

/// C639-007C.5: `overlaySessionId` is the calling page's own URL-borne
/// session (see `open_region_overlay_claimed`'s window build), never
/// inferred from whichever `pending_overlay` happens to be current when
/// this runs. The prior version took no caller session at all and simply
/// returned the current global context — so a stale page A, delayed past
/// its own retirement, could receive a NEWER page B's context and (per the
/// old `overlay.js`) adopt B's session id as its own, then carry B's valid
/// authority on every later Esc/right-click/sliver-cancel/Retry. Binding to
/// the three-way claim (`active_pick`/`pending_overlay`/
/// `overlay_window_owner`, via `overlay_request_session_still_current` —
/// the same check `capture`/Retry already use) and re-filtering the read
/// itself by the caller's exact session closes that: a mismatched request
/// fails closed with no context returned, so a stale page's local identity
/// is never mutated by surviving data obtained under a different session.
#[tauri::command]
#[allow(non_snake_case)]
fn overlay_context(
    overlaySessionId: u64,
    state: State<AppState>,
) -> Result<OverlayContextDto, String> {
    if !overlay_request_session_still_current(
        &state.active_pick,
        &state.pending_overlay,
        &state.overlay_window_owner,
        overlaySessionId,
    ) {
        return Err(
            "region pick was cancelled or superseded before context could load".to_string(),
        );
    }
    let guard = state.pending_overlay.lock().unwrap();
    overlay_context_for_session(guard.as_ref(), overlaySessionId)
        .ok_or_else(|| "no pending region overlay".to_string())
}

/// C639-007C.5: pure extraction mirroring `stored_backdrop_png` below — a
/// context is served ONLY while its own recorded session matches the
/// caller's exact `overlaySessionId`, re-filtered here on top of the
/// three-way `overlay_request_session_still_current` check the command
/// itself runs first (that check's `pending_overlay` lock is released
/// before this one is taken, so a cancel/supersession landing in between
/// must not let a since-mismatched context through). Pure over the option
/// so the re-filter itself is unit-testable without a live Tauri app: a
/// context being PENDING is not sufficient, it must be pending for THIS
/// session.
fn overlay_context_for_session(
    pending: Option<&OverlayContext>,
    session_id: u64,
) -> Option<OverlayContextDto> {
    pending
        .filter(|ctx| ctx.session_id == session_id)
        .map(overlay_context_dto)
}

/// Pure context-to-DTO mapping, so the page always receives the session's
/// stored frame metadata (including the blank-frame warning flag) and the
/// mapping itself is unit-testable.
fn overlay_context_dto(ctx: &OverlayContext) -> OverlayContextDto {
    OverlayContextDto {
        monitor_id: ctx.monitor_id.clone(),
        origin_virtual: ctx.origin_virtual,
        dpr: ctx.dpr,
        backdrop_blank: ctx.backdrop_blank,
        session_id: ctx.session_id,
    }
}

/// C639-007C.4: the overlay page's own cancel (Esc, right-click, a
/// sliver-drag's implicit cancel) must bind to THAT page's exact session —
/// `overlaySessionId`, carried in the URL the page was built with (see
/// `open_region_overlay_claimed`) — never treat "whatever is currently
/// active" as this request's own identity. The prior unconditional version
/// let a stale, delayed cancel from a superseded page (A) tear down a
/// newer page's (B) claim and window; a stale cancel now no-ops instead —
/// touches no state, closes no window — exactly like a stale Retry
/// (C639-007C.4) and a stale `capture` (C639-007C.3). Reuses the same
/// bound primitives (`clear_pick_if_current`, `close_owned_overlay_window`)
/// every other retire site here already funnels through, rather than the
/// unconditional "whatever is labeled overlay" lookup those exist
/// specifically to replace.
#[tauri::command]
#[allow(non_snake_case)]
fn cancel_region_pick(
    overlaySessionId: u64,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    clear_pick_if_current(&state.active_pick, &state.pending_overlay, overlaySessionId);
    // Best-effort close, same as the prior unconditional version: a close
    // failure here must not fail the cancel IPC itself.
    let _ = close_owned_overlay_window(&app, overlaySessionId);
    Ok(())
}

// ---------------------------------------------------------------------------
// Region-picker backdrop (Snagit-style crosshair + magnifier loupe)
// ---------------------------------------------------------------------------

/// Frozen fullscreen frame the overlay page draws its crosshair and
/// magnifier loupe over — the Snagit approach: freeze first, aim on the
/// frozen image, then capture the live region. Without a frozen frame the
/// loupe would have no pixels to magnify. The frame is captured (and
/// blank-checked) by `open_region_overlay` BEFORE the overlay window is
/// created; this command just serves the stored bytes to the page.
#[derive(Debug, Serialize, Clone)]
struct BackdropDto {
    png_b64: String,
    width: u32,
    height: u32,
}

/// C639-007C.5: the same caller-bound read as `overlay_context` above —
/// `overlaySessionId` is the page's own URL-borne identity, verified
/// against the live three-way claim before ANY frame is served, and the
/// stored-backdrop lookup itself is re-filtered to that exact session so a
/// stale/superseded caller can never receive (and thus never locally adopt
/// or act on) a different session's frame.
#[tauri::command]
#[allow(non_snake_case)]
fn region_pick_backdrop(
    overlaySessionId: u64,
    state: State<AppState>,
) -> Result<BackdropDto, String> {
    if !overlay_request_session_still_current(
        &state.active_pick,
        &state.pending_overlay,
        &state.overlay_window_owner,
        overlaySessionId,
    ) {
        return Err(
            "region pick was cancelled or superseded before the backdrop could load".to_string(),
        );
    }
    let guard = state.pending_overlay.lock().unwrap();
    let ctx_ref = guard.as_ref().filter(|c| c.session_id == overlaySessionId);
    let png = stored_backdrop_png(ctx_ref)?;
    let (width, height) =
        png_dimensions(png).map_err(|e| format!("backdrop dimensions unreadable: {e}"))?;
    Ok(BackdropDto {
        png_b64: base64_encode(png),
        width,
        height,
    })
}

/// Stored-backdrop lookup for `region_pick_backdrop`, pure over the context
/// so the serve-from-context contract is unit-testable: the overlay page
/// must always receive the frame captured before its window existed, never
/// trigger a fresh capture (which could catch the overlay itself).
fn stored_backdrop_png(ctx: Option<&OverlayContext>) -> Result<&[u8], String> {
    let ctx = ctx
        .ok_or_else(|| "no pending region overlay; call begin_region_pick first".to_string())?;
    ctx.backdrop_png
        .as_deref()
        .ok_or_else(|| "no stored backdrop for this region pick".to_string())
}

/// Retry the frozen backdrop for the in-flight region pick (the page's
/// blank-frame warning "Retry" button). The overlay window is hidden — not
/// closed — while the fresh frame is captured, so the retry frame cannot
/// catch the picker itself. The commit is session-guarded: if the pick was
/// cancelled mid-retry, the window stays down and the retry reports it
/// instead of resurrecting a dead picker. If the capture itself failed, the
/// window is reshown with the previous frame intact, so the user is never
/// stranded on a dead overlay with no way back. If the hidden window cannot
/// be reshown at all, the pick is cancelled outright — an invisible picker
/// with a live session would be unrecoverable.
#[tauri::command]
#[allow(non_snake_case)]
async fn retry_region_backdrop(
    overlaySessionId: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // C639-001: the retry's blocking supervisor round trip (plus its
    // settle sleep) runs off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        retry_region_backdrop_blocking(&app, overlaySessionId)
    })
    .await
    .map_err(|e| format!("retry background task failed: {e}"))?
}

/// C639-007C.7: dispatch the Retry hide's recheck-lookup-hide step through
/// `AbandonableBridge` rather than the plain-channel `run_on_main_thread_
/// sync`, so a main-thread closure that only gets to run after its caller
/// has already timed out can detect that and skip the hide entirely — see
/// the bridge's own doc comment and the call site in
/// `retry_region_backdrop_blocking` for the full failure mode this closes.
///
/// C639-007C.8: `hide()` is exactly the unbounded native call
/// `AbandonableBridge::settle` must never hold its lock across (see the
/// bridge's own doc comment), so the waiter's 5s bound stays real even if
/// `hide()` blocks past it. The counterpart: if `hide()` nonetheless
/// succeeds after the waiter has already given up, `compensate` runs —
/// still on the main thread, still inside the same dispatched closure, so
/// nothing else can have run on the single main-event-loop thread between
/// `action` resolving `window` and `compensate` acting on it — and restores
/// the EXACT window `action` already resolved and hid, never a fresh
/// `get_webview_window("overlay")` lookup, which could by then resolve to a
/// newer generation's window. If the restore itself fails, the session is
/// torn down exactly like the terminal-failure path below does, rather than
/// leave an unrecoverable hidden picker with a live reservation nobody but
/// the 60s watchdog will ever clear.
///
/// C639-007C.9: "nothing else can run on the main-event-loop thread between
/// `action` resolving `window` and `compensate` acting on it" is true but
/// does not make A's state stale-proof: cancellation and admission of a
/// newer session (B) are NOT dispatched through this same main-thread
/// closure — `cancel_region_pick`'s state clear and a newer `open_region_
/// overlay`'s `active_pick` claim run from their own command/background
/// threads, so they can land (and fully complete) while this closure is
/// still blocked inside A's native `hide()`, strictly before `compensate`
/// ever runs. `compensate` therefore revalidates the full three-way binding
/// (`overlay_request_session_still_current` — active_pick, pending_
/// overlay's own recorded session, and overlay_window_owner, the same
/// check every other retire site in this module is built from) before
/// touching the window at all: if A is no longer the live claim, the
/// window is closed (the exact captured handle, never a fresh shared-label
/// lookup) and nothing else is touched — B's state is not this closure's
/// to read or retire. Only when A is still current does it get reshown.
/// The prior version showed A unconditionally and, on a show failure,
/// cleared `overlay_window_owner` unconditionally too — both now go
/// through the same owner-bound primitives (`overlay_request_session_
/// still_current`, `owns_overlay_window`'s compare-and-clear) the rest of
/// the module already uses, so a stale A can never resurrect itself over a
/// live B or erase B's owner claim.
fn retry_hide_overlay_or_abandon(
    app: tauri::AppHandle,
    retry_session: u64,
) -> Result<tauri::WebviewWindow, String> {
    let bridge = Arc::new(AbandonableBridge::<Result<tauri::WebviewWindow, String>>::new());
    let bridge_for_main = bridge.clone();
    app.clone().run_on_main_thread(move || {
        let app_for_action = app.clone();
        let app_for_compensate = app;
        bridge_for_main.settle(
            move || -> Result<tauri::WebviewWindow, String> {
                let state = app_for_action.state::<AppState>();
                if *state.overlay_window_owner.lock().unwrap() != Some(retry_session) {
                    return Err(
                        "region pick was cancelled or superseded before retry could run"
                            .to_string(),
                    );
                }
                let window = app_for_action
                    .get_webview_window("overlay")
                    .ok_or_else(|| "overlay window is gone; start a new region pick".to_string())?;
                window
                    .hide()
                    .map_err(|e| format!("cannot hide overlay for retry: {e}"))?;
                Ok(window)
            },
            move |result| {
                let Ok(window) = result else { return };
                let state = app_for_compensate.state::<AppState>();
                // C639-007C.9: `action` already returned — `hide()` finally
                // unblocked, well after the waiter abandoned — so between
                // then and now the user had a real window to cancel A
                // through, and a newer session (B) had a real window to be
                // admitted through, while this closure sat blocked behind
                // A's native `hide()` on the single main-event-loop thread.
                // Revalidate the full three-way binding
                // (`overlay_request_session_still_current`, the same check
                // every other retire site in this module uses) before
                // deciding whether to resurrect A's window — resolving a
                // real handle in `action` is not proof A is still live.
                if !overlay_request_session_still_current(
                    &state.active_pick,
                    &state.pending_overlay,
                    &state.overlay_window_owner,
                    retry_session,
                ) {
                    // A was cancelled or superseded while its hide() was
                    // still blocked. Do not show it back: close only the
                    // exact handle `action` already resolved and hid —
                    // never a fresh shared-"overlay"-label lookup, which
                    // could by now resolve to B's window — and touch
                    // nothing else. B's active_pick, pending_overlay, and
                    // overlay_window_owner were never this closure's to
                    // retire.
                    let _ = window.close();
                    return;
                }
                if window.show().is_err() {
                    clear_pick_if_current(
                        &state.active_pick,
                        &state.pending_overlay,
                        retry_session,
                    );
                    // Compare-and-clear (`owns_overlay_window`), never an
                    // unconditional `None`: a newer session could in
                    // principle have claimed the owner slot by the time
                    // this failure path runs, and this cleanup must never
                    // erase a claim that was never this session's.
                    let mut owner = state.overlay_window_owner.lock().unwrap();
                    if owns_overlay_window(*owner, retry_session) {
                        *owner = None;
                    }
                    drop(owner);
                    let _ = window.close();
                    return;
                }
                let _ = window.set_focus();
            },
        );
    })
    .map_err(|e| format!("cannot dispatch to main thread: {e}"))?;
    bridge.wait_or_abandon(Duration::from_secs(5))?
}

/// C639-007C.4: `retry_session` is the session id the PAGE that issued this
/// command was built with (its own URL — see `open_region_overlay_claimed`),
/// never inferred from whichever `pending_overlay` happens to be current
/// when this body actually runs. The prior version read "whichever pending
/// context is current" as if it were this request's own identity — the
/// same borrowed-global-claim mistake C639-007C.3 fixed for `capture` —
/// which let a stale, delayed retry from a superseded page (A) hide, wipe,
/// or (on a restore failure) tear down a newer page's (B) picker. Every
/// path here verifies the full three-way binding (`active_pick`,
/// `pending_overlay`'s own recorded session, `overlay_window_owner` —
/// `overlay_request_session_still_current`, the same check
/// `run_capture_inner` uses for `capture`) BEFORE the first hide, capture,
/// show, or focus — a stale request fails having touched nothing of B's.
fn retry_region_backdrop_blocking(
    app: &tauri::AppHandle,
    retry_session: u64,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let monitor_id = {
        if !overlay_request_session_still_current(
            &state.active_pick,
            &state.pending_overlay,
            &state.overlay_window_owner,
            retry_session,
        ) {
            return Err(
                "region pick was cancelled or superseded before retry could run".to_string(),
            );
        }
        let guard = state.pending_overlay.lock().unwrap();
        guard
            .as_ref()
            .filter(|ctx| ctx.session_id == retry_session)
            .map(|ctx| ctx.monitor_id.clone())
            .ok_or_else(|| {
                "region pick was cancelled or superseded before retry could run".to_string()
            })?
    };
    let monitors = current_monitors()?;
    if !monitors.iter().any(|m| m.id == monitor_id) {
        return Err(format!("unknown monitor id: {monitor_id}"));
    }
    // Monitor enumeration above is itself an unbounded OS call; re-verify
    // the same binding again, atomically, right before the first window
    // mutation — the same discipline `run_capture_inner`/`build_mode` use
    // around their own unbounded calls.
    //
    // C639-007C.6: the recheck, the shared-"overlay"-label lookup, and the
    // hide must happen as ONE atomic step, never a check followed by a
    // separate later lookup. The prior version re-verified ownership here,
    // then reacquired the window by its shared label and hid it as two
    // separate operations with nothing — no lock, no main-thread
    // serialization — spanning them: if a newer session (B) was admitted
    // and built its own window in that gap (window CREATION already runs
    // as one `run_on_main_thread_sync` closure, see
    // `open_region_overlay_claimed`), the label lookup below would resolve
    // to B's window and hide it, stranding B hidden even though this retry
    // is a stale request that must touch nothing of B's. Dispatching the
    // recheck + label lookup + hide as one main-thread closure serializes
    // it against that exact build closure on Tauri's single
    // main-event-loop thread — the two can never interleave, so the lookup
    // here can only ever resolve to whichever window is actually live at
    // that one instant, never a window a concurrent build swapped onto the
    // label between two separate steps. The resolved handle is returned
    // and reused for every later show/focus/close in this function (below)
    // instead of being reacquired by label again, per the same
    // requirement.
    //
    // C639-007C.7: this hide is dispatched through `AbandonableBridge`
    // instead of the plain-channel `run_on_main_thread_sync`. A channel
    // bridge bounds only the WAITER's patience, not the closure's: if the
    // main thread is busy past the 5s bound, `run_on_main_thread_sync`
    // returns a timeout error and this function used to return right
    // here, but the already-queued closure keeps running to completion
    // whenever the main thread gets to it — ownership is still unchanged
    // (nothing retired it; the caller merely gave up), so it would hide
    // the live picker and then discard its own result into a dropped
    // receiver, stranding the user on an invisible overlay with no caller
    // left to show it back and a live reservation that only the 60s
    // watchdog would eventually clear. `AbandonableBridge` closes that
    // gap: on timeout the bridge is marked abandoned under the same lock
    // the closure checks before it does anything at all, so a closure
    // that has not yet run when the timeout fires skips the hide
    // entirely — never touches ownership, never looks up the window,
    // never hides it. The one case where the closure might already be
    // past that check and mid-hide right as the timeout fires is handled
    // by `wait_or_abandon`'s own re-check under the lock, which then
    // yields the real result instead of a spurious abandonment — this
    // function's existing restore-on-failure / commit-on-success path
    // below still runs exactly as it always has for that result.
    let app_for_hide = app.clone();
    let window = retry_hide_overlay_or_abandon(app_for_hide, retry_session)?;
    // Let the compositor settle so the hidden window is truly gone from
    // the next frame; without this the retry could capture the picker.
    std::thread::sleep(Duration::from_millis(250));
    // C639 Option C: the re-acquisition runs in the supervised worker.
    let fresh = capture_region_backdrop(&state, retry_session, &monitor_id);
    // Commit only if `retry_session` is STILL the live claim across
    // active_pick, pending_overlay's own recorded session, AND the overlay
    // window's owner together (C639-007C.4) — not pending_overlay's own
    // recorded session alone as before, which let a stale request's
    // cleanup act on a binding it no longer actually held. Lock order
    // matches `overlay_request_session_still_current` (active_pick, then
    // pending_overlay); the pending_overlay lock is then held continuously
    // through the window restore below — `cancel_region_pick` takes that
    // same lock to clear the session, so a cancel landing between the
    // check and the restore can never slip through and resurrect a dead
    // picker.
    let active = state.active_pick.lock().unwrap();
    if *active != Some(retry_session) {
        return Err("region pick was cancelled during retry".to_string());
    }
    let mut guard = state.pending_overlay.lock().unwrap();
    drop(active);
    let ctx = match guard.as_mut() {
        Some(ctx) if ctx.session_id == retry_session => ctx,
        _ => return Err("region pick was cancelled during retry".to_string()),
    };
    if *state.overlay_window_owner.lock().unwrap() != Some(retry_session) {
        return Err("region pick was cancelled during retry".to_string());
    }
    // The picker was hidden for the capture. If it cannot be reshown, the
    // pick is dead: tear the session down exactly like cancel_region_pick
    // instead of stranding the user on an invisible picker with a live
    // session and no way to recover it. (set_focus stays best-effort: a
    // visible window the user can click is not a trap.)
    if let Err(e) = window.show() {
        // C639-007C.2: this terminal failure tears the session down
        // exactly like `cancel_region_pick` — retire the matching
        // `active_pick` claim too (via the exact same `clear_pick_if_
        // current` every other retire site uses), not just the pending
        // context, or the strict reservation strands a session that can
        // never be reused once the picker itself is already unrecoverable.
        // `retry_session` is this call's own verified id (C639-007C.4), so
        // this can only ever be retiring this exact session's claim, never
        // a newer session's — `clear_pick_if_current` no-ops otherwise.
        drop(guard);
        clear_pick_if_current(&state.active_pick, &state.pending_overlay, retry_session);
        *state.overlay_window_owner.lock().unwrap() = None;
        let _ = window.close();
        return Err(format!("could not restore the region picker window: {e}"));
    }
    let _ = window.set_focus();
    let backdrop_png = fresh.map_err(|e| format!("retry capture failed: {e}"))?;
    let (_, _, rgba) =
        decode_own(&backdrop_png).map_err(|e| format!("retry backdrop decode failed: {e}"))?;
    ctx.backdrop_png = Some(backdrop_png);
    ctx.backdrop_blank = solid_frame_rgba(&rgba);
    Ok(())
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
// Meeting mode — local audio capture + transcription spool
// ---------------------------------------------------------------------------
//
// Same honest, local-first design as AI Edit: the webview records audio
// with the platform MediaRecorder (Rung 4 precedent) and streams chunks
// here; the backend writes the audio file to the library directory and
// spools a `transcribe` job into the local ai-spool. An EXTERNAL runner
// (see forge-capture-app/docs/meeting-mode.md — Koe Jr's lane) carries
// jobs to local Whisper and drops `result.json` back. This app never
// touches the network and never transcribes anything itself.
//
// Crash safety: unlike the Rung 4 media upload (in-memory assembly, single
// disk write), meeting chunks are appended to a `.meeting.part` file on
// disk AS THEY ARRIVE, so a crash mid-recording leaves a recoverable
// partial file. `meeting_recover` (called at startup) finalizes those
// partials and spools transcription jobs for them.

/// One in-flight meeting audio upload. Chunks land in `part_path` on disk
/// immediately — never held only in memory — so a crash mid-recording is
/// recoverable by `meeting_recover`.
struct MeetingUpload {
    expected_bytes: u64,
    mime: String,
    extension: String,
    stem: String,
    part_path: std::path::PathBuf,
    received: u64,
}

fn meeting_job_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("tr-{millis}-{counter}")
}

fn meeting_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("mtg-{millis}-{counter}")
}

fn meeting_upload_id(state: &State<AppState>) -> String {
    let mut counter = state.id_counter.lock().unwrap();
    *counter += 1;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("mu-{millis}-{counter}")
}

/// The only audio this command will write. The mime comes from the UI's
/// MediaRecorder pick; the extension must agree with it.
fn meeting_audio_extension(mime: &str) -> Result<String, String> {
    // Same exact-base matching discipline as media_extension: a
    // starts_with check would wrongly accept "audio/webm-evil".
    let base = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match base.as_str() {
        "audio/webm" => Ok("webm".to_string()),
        "audio/mp4" => Ok("m4a".to_string()),
        _ => Err(format!("unsupported meeting audio mime: {mime}")),
    }
}

/// Container sanity check on the first bytes of a meeting recording.
/// WebM: EBML header declaring DocType "webm" (shared with the Rung 4
/// checker). M4A: 'ftyp' at offset 4 (ISO BMFF signature sanity check).
/// A truncated-but-started recording still opens with a valid header, so
/// recovered partials pass this too.
fn sniff_audio_ok(probe: &[u8], extension: &str) -> bool {
    match extension {
        "webm" => webm_doctype_ok(probe),
        "m4a" => probe.len() >= 8 && probe[4..8] == [0x66, 0x74, 0x79, 0x70],
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BeginMeetingUploadDto {
    total_bytes: u64,
    mime: String,
    name_hint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendMeetingChunkDto {
    upload_id: String,
    offset: u64,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinishMeetingUploadDto {
    upload_id: String,
    device_label: Option<String>,
    language_hint: Option<String>,
    /// Streaming uploads declare a capacity cap in `begin` (the true total
    /// is unknowable while recording) and report the actual byte count
    /// here. When absent, `received` must equal the declared total
    /// (buffered upload path).
    actual_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MeetingFinishDto {
    audio_path: String,
    file_name: String,
    #[serde(rename = "jobId")]
    job_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct MeetingPollDto {
    #[serde(rename = "jobId")]
    job_id: String,
    /// "queued" | "processing" | "done" | "failed" | "imported"
    status: String,
    /// Present when status == "failed": the runner's error (truncated).
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MeetingImportDto {
    transcript_path: String,
    segment_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_sec: Option<f64>,
    /// The validated segments, inline so the UI can render without a
    /// file-read round trip. The durable copy is `transcript_path`.
    segments: Vec<forge_capture_core::meeting::TranscriptSegment>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecoveredMeetingDto {
    audio_path: String,
    file_name: String,
    #[serde(rename = "jobId")]
    job_id: String,
}

/// Provenance sidecar for a meeting audio file, mirroring the recording
/// convention: every file the app writes gets a `.forge.json` next to it.
fn meeting_sidecar_json(
    mime: &str,
    byte_len: u64,
    device_label: &str,
    language_hint: &str,
    recovered: bool,
) -> String {
    format!(
        "{{\n  \"schemaVersion\": 1,\n  \"kind\": \"meeting-audio\",\n  \"mime\": {},\n  \"byteLength\": {},\n  \"deviceLabel\": {},\n  \"languageHint\": {},\n  \"recovered\": {},\n  \"createdAt\": {}\n}}\n",
        serde_json::to_string(mime).unwrap_or_else(|_| "\"\"".to_string()),
        byte_len,
        serde_json::to_string(device_label).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(language_hint).unwrap_or_else(|_| "\"\"".to_string()),
        recovered,
        serde_json::to_string(&forge_capture_core::timestamp::now_utc_iso8601())
            .unwrap_or_else(|_| "\"\"".to_string()),
    )
}

/// Two-phase sidecar write: temp file first, rename into place, so a crash
/// can never leave a partial sidecar under a final name.
fn write_sidecar_two_phase(
    dir: &std::path::Path,
    stem: &str,
    sidecar: &str,
    tag: &str,
) -> Result<std::path::PathBuf, String> {
    let sidecar_path = dir.join(format!("{stem}.forge.json"));
    let sidecar_temp = dir.join(format!("{stem}.{tag}.forge.json.part"));
    std::fs::write(&sidecar_temp, sidecar.as_bytes())
        .map_err(|e| format!("cannot write sidecar temp file: {e}"))?;
    std::fs::rename(&sidecar_temp, &sidecar_path)
        .map_err(|e| format!("cannot finalize sidecar: {e}"))?;
    Ok(sidecar_path)
}

/// Read the first bytes of a file for container sniffing (the header walk
/// is bounded to a few KB; the whole file is never loaded for this).
fn read_probe(path: &std::path::Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut f =
        std::fs::File::open(path).map_err(|e| format!("cannot open audio file: {e}"))?;
    let mut probe = vec![0u8; 8192];
    let n = f
        .read(&mut probe)
        .map_err(|e| format!("cannot read audio file: {e}"))?;
    probe.truncate(n);
    Ok(probe)
}

#[tauri::command]
fn meeting_upload_begin(
    dto: BeginMeetingUploadDto,
    state: State<AppState>,
) -> Result<String, String> {
    if dto.total_bytes == 0 || dto.total_bytes > MAX_MEDIA_UPLOAD_BYTES {
        return Err(format!(
            "total_bytes {} is outside the allowed 1..{} range",
            dto.total_bytes, MAX_MEDIA_UPLOAD_BYTES
        ));
    }
    let extension = meeting_audio_extension(&dto.mime)?;
    let dir = captures_dir()?;
    let base_hint = dto.name_hint.as_deref().unwrap_or("");
    let base = if base_hint.trim().is_empty() {
        format!(
            "meeting-{}",
            forge_capture_core::timestamp::now_utc_iso8601()
        )
    } else {
        base_hint.to_string()
    };
    let stem = unique_stem(&state, &dir, &sanitize_stem(Some(&base)), &extension);
    let id = meeting_upload_id(&state);
    // The part filename carries the upload id AND the extension: recovery
    // needs both without trusting file contents.
    let part_path = dir.join(format!("{stem}.{id}.{extension}.meeting.part"));
    // Create the part file now so a later append can never fail on a
    // missing file, and so a crash before the first chunk still leaves a
    // (zero-byte, unrecoverable-but-harmless) marker.
    std::fs::write(&part_path, b"").map_err(|e| format!("cannot create meeting part file: {e}"))?;
    let mut uploads = state.meeting_uploads.lock().unwrap();
    uploads.insert(
        id.clone(),
        MeetingUpload {
            expected_bytes: dto.total_bytes,
            mime: dto.mime,
            extension,
            stem,
            part_path,
            received: 0,
        },
    );
    Ok(id)
}

#[tauri::command]
fn meeting_upload_append(
    dto: AppendMeetingChunkDto,
    state: State<AppState>,
) -> Result<u64, String> {
    use std::io::Write;
    let mut uploads = state.meeting_uploads.lock().unwrap();
    let upload = uploads
        .get_mut(&dto.upload_id)
        .ok_or_else(|| format!("unknown meeting upload id: {}", dto.upload_id))?;
    // Same strict sequencing as the Rung 4 media upload: no gaps, no
    // re-sends, no reordering — a buggy caller cannot assemble a malformed
    // file out of reordered chunks.
    check_chunk_offset(upload.received, dto.offset)?;
    let new_len = upload.received + dto.bytes.len() as u64;
    if new_len > upload.expected_bytes {
        return Err(format!(
            "meeting upload would exceed declared total: {} > {}",
            new_len, upload.expected_bytes
        ));
    }
    // Crash-safe: bytes hit the disk NOW, not at finish. A crash after
    // this point leaves a playable partial (MediaRecorder chunks share the
    // init segment, so truncation never corrupts the container header).
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&upload.part_path)
        .map_err(|e| format!("cannot append to meeting part file: {e}"))?;
    f.write_all(&dto.bytes)
        .map_err(|e| format!("cannot write meeting chunk: {e}"))?;
    upload.received = new_len;
    Ok(new_len)
}

#[tauri::command]
fn meeting_upload_cancel(id: String, state: State<AppState>) -> Result<(), String> {
    let upload = {
        let mut uploads = state.meeting_uploads.lock().unwrap();
        uploads.remove(&id)
    };
    if let Some(upload) = upload {
        // Best effort: a leftover part file is harmless (recovery skips
        // zero-byte files), but a cancelled take should not resurrect.
        let _ = std::fs::remove_file(&upload.part_path);
    }
    Ok(())
}

/// Finish a meeting recording: validate the audio, finalize it into the
/// library with its sidecar, and spool a `transcribe` job. Returns the
/// library audio path and the job id for polling.
///
/// Ordering note: the audio is finalized BEFORE the job is spooled. If the
/// spool fails after a successful finalize, the error names the saved
/// audio path honestly instead of pretending the recording was lost.
#[tauri::command]
fn meeting_upload_finish(
    dto: FinishMeetingUploadDto,
    state: State<AppState>,
) -> Result<MeetingFinishDto, String> {
    let upload = {
        let mut uploads = state.meeting_uploads.lock().unwrap();
        uploads
            .remove(&dto.upload_id)
            .ok_or_else(|| format!("unknown meeting upload id: {}", dto.upload_id))?
    };
    let language_hint = dto.language_hint.as_deref().unwrap_or("auto");
    forge_capture_core::meeting::validate_language_hint(language_hint)
        .map_err(|e| e.to_string())?;
    // Streaming uploads declare a capacity cap up front and report the
    // actual count here; buffered uploads must match the declared total
    // exactly. Either way the byte count on disk is authoritative.
    let actual_bytes = match dto.actual_bytes {
        Some(n) => {
            if n != upload.received {
                let _ = std::fs::remove_file(&upload.part_path);
                return Err(format!(
                    "meeting upload byte count mismatch: reported {n}, received {}",
                    upload.received
                ));
            }
            if n > upload.expected_bytes {
                let _ = std::fs::remove_file(&upload.part_path);
                return Err(format!(
                    "meeting upload exceeded declared capacity: {n} > {}",
                    upload.expected_bytes
                ));
            }
            n
        }
        None => {
            if upload.received != upload.expected_bytes {
                let _ = std::fs::remove_file(&upload.part_path);
                return Err(format!(
                    "incomplete meeting upload: got {} of {} declared bytes",
                    upload.received, upload.expected_bytes
                ));
            }
            upload.received
        }
    };
    if actual_bytes == 0 {
        let _ = std::fs::remove_file(&upload.part_path);
        return Err("meeting upload is empty: nothing was recorded".to_string());
    }
    if !sniff_audio_ok(
        &read_probe(&upload.part_path)?,
        &upload.extension,
    ) {
        let _ = std::fs::remove_file(&upload.part_path);
        return Err(format!(
            "recorded bytes failed the .{} audio signature check — refusing to write",
            upload.extension
        ));
    }
    let dir = captures_dir()?;
    let file_name = format!("{}.{}", upload.stem, upload.extension);
    let final_path = dir.join(&file_name);
    std::fs::rename(&upload.part_path, &final_path)
        .map_err(|e| format!("cannot finalize meeting audio: {e}"))?;
    let device_label = dto.device_label.as_deref().unwrap_or("");
    let sidecar = meeting_sidecar_json(
        &upload.mime,
        actual_bytes,
        device_label,
        language_hint,
        false,
    );
    if let Err(e) = write_sidecar_two_phase(&dir, &upload.stem, &sidecar, &dto.upload_id) {
        // The audio is finalized but sidecar-less: roll the audio back
        // rather than break the every-file-has-a-sidecar invariant (the
        // Rung 4 media-upload discipline).
        let _ = std::fs::remove_file(&final_path);
        return Err(e);
    }
    // Spool the transcription job. The job directory is self-contained
    // (audio copy + manifest, manifest written LAST): a crash mid-spool
    // never yields a half job, and the runner never needs the library.
    let spool = ai_spool_dir()?;
    let job_id = meeting_job_id(&state);
    debug_assert!(forge_capture_core::ai_edit::validate_job_id(&job_id));
    let meeting_id = meeting_id(&state);
    let job_dir = spool
        .join(forge_capture_core::ai_edit::SPOOL_PENDING)
        .join(&job_id);
    if let Err(e) = (|| -> Result<(), String> {
        std::fs::create_dir_all(&job_dir).map_err(|e| format!("cannot spool transcribe job: {e}"))?;
        let input_name = format!(
            "{}.{}",
            forge_capture_core::meeting::JOB_INPUT_AUDIO,
            upload.extension
        );
        std::fs::copy(&final_path, job_dir.join(&input_name))
            .map_err(|e| format!("cannot spool meeting audio: {e}"))?;
        let manifest = forge_capture_core::meeting::TranscribeJobManifest::new(
            &job_id,
            &meeting_id,
            &file_name,
            language_hint,
            &forge_capture_core::timestamp::now_utc_iso8601(),
        );
        let manifest_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("cannot encode transcribe manifest: {e}"))?;
        std::fs::write(
            job_dir.join(forge_capture_core::ai_edit::JOB_MANIFEST),
            manifest_json.as_bytes(),
        )
        .map_err(|e| format!("cannot spool transcribe manifest: {e}"))?;
        Ok(())
    })() {
        // The audio survived (it is finalized in the library); only the
        // transcription spool failed. Say so honestly with the path.
        return Err(format!(
            "{e} — the recording was saved at {} but no transcription job was queued",
            final_path.to_string_lossy()
        ));
    }
    Ok(MeetingFinishDto {
        audio_path: final_path.to_string_lossy().into_owned(),
        file_name,
        job_id,
    })
}

/// Poll a transcription job's status. Pure directory-presence check; never
/// blocks, never touches the network. Mirrors `ai_edit_poll`.
#[tauri::command]
#[allow(non_snake_case)]
fn meeting_poll(jobId: String, state: State<AppState>) -> Result<MeetingPollDto, String> {
    if !forge_capture_core::ai_edit::validate_job_id(&jobId) {
        return Err("invalid transcription job id".to_string());
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
    .ok_or_else(|| format!("unknown transcription job: {jobId}"))?;
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
    Ok(MeetingPollDto {
        job_id: jobId,
        status: status.as_str().to_string(),
        reason,
    })
}

/// Import a finished transcript: validate `result.json`, store it as
/// `<audio-stem>.transcript.json` next to the untouched audio file, and
/// move the job to `imported/` so a second import is impossible.
#[tauri::command]
#[allow(non_snake_case)]
fn meeting_import(jobId: String, _state: State<AppState>) -> Result<MeetingImportDto, String> {
    if !forge_capture_core::ai_edit::validate_job_id(&jobId) {
        return Err("invalid transcription job id".to_string());
    }
    let spool = ai_spool_dir()?;
    let done_dir = spool.join(ai_edit::SPOOL_DONE).join(&jobId);
    if !done_dir.is_dir() {
        return Err(format!(
            "transcription job {jobId} has no finished result to import"
        ));
    }
    let result_bytes = std::fs::read(done_dir.join(forge_capture_core::meeting::JOB_RESULT_JSON))
        .map_err(|e| format!("cannot read transcript result: {e}"))?;
    // The transcript comes from an external runner: parse + validate
    // strictly (timestamps finite, text capped) before trusting it.
    let result = forge_capture_core::meeting::parse_transcript_result(&jobId, &result_bytes)?;
    let manifest: forge_capture_core::meeting::TranscribeJobManifest =
        std::fs::read_to_string(done_dir.join(ai_edit::JOB_MANIFEST))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .ok_or_else(|| "transcription job manifest is missing or corrupt".to_string())?;
    if manifest.job_type != forge_capture_core::meeting::JOB_TYPE_TRANSCRIBE {
        return Err(format!(
            "job {jobId} is not a transcription job (job_type={})",
            manifest.job_type
        ));
    }
    let dir = captures_dir()?;
    let audio_stem = manifest
        .audio_file
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(&manifest.audio_file);
    let transcript_name = format!("{audio_stem}.transcript.json");
    let transcript_path = dir.join(&transcript_name);
    let doc = serde_json::json!({
        "schemaVersion": 1,
        "jobId": jobId,
        "meetingId": manifest.meeting_id,
        "audioFile": manifest.audio_file,
        "languageHint": manifest.language_hint,
        "transcript": result,
        "importedAt": forge_capture_core::timestamp::now_utc_iso8601(),
    });
    let doc_json = serde_json::to_string_pretty(&doc)
        .map_err(|e| format!("cannot encode transcript: {e}"))?;
    // Two-phase write: the transcript is never half-visible.
    let temp_path = dir.join(format!("{transcript_name}.{jobId}.part"));
    std::fs::write(&temp_path, doc_json.as_bytes())
        .map_err(|e| format!("cannot write transcript temp file: {e}"))?;
    std::fs::rename(&temp_path, &transcript_path)
        .map_err(|e| format!("cannot finalize transcript: {e}"))?;
    // Mark imported: a second import of the same job is refused because the
    // job no longer sits in done/.
    let _ = std::fs::rename(&done_dir, spool.join(ai_edit::SPOOL_IMPORTED).join(&jobId));
    Ok(MeetingImportDto {
        transcript_path: transcript_path.to_string_lossy().into_owned(),
        segment_count: result.segments.len(),
        duration_sec: result.duration_sec,
        segments: result.segments.clone(),
    })
}

/// Recover interrupted meeting recordings after a crash: any
/// `*.meeting.part` file left in the captures dir is a recording that
/// never reached `meeting_upload_finish`. Each recoverable partial is
/// finalized as `<stem>-recovered.<ext>` with a `recovered: true`
/// sidecar, and a fresh `transcribe` job (language hint "auto" — the
/// original choice died with the crashed process) is spooled for it.
/// Zero-byte part files (crash before the first chunk) are deleted as
/// unrecoverable; files failing the container sniff are left in place
/// and skipped loudly on stderr.
#[tauri::command]
fn meeting_recover(state: State<AppState>) -> Result<Vec<RecoveredMeetingDto>, String> {
    let dir = captures_dir()?;
    let mut parts: Vec<std::path::PathBuf> = Vec::new();
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("cannot list captures dir: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read captures dir entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".meeting.part") {
            parts.push(entry.path());
        }
    }
    parts.sort();
    let mut recovered = Vec::new();
    for part_path in parts {
        let name = part_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        // Part filename: <stem>.<upload-id>.<ext>.meeting.part
        let Some(base) = name.strip_suffix(".meeting.part") else {
            continue;
        };
        // rsplit yields right-to-left: [ext, upload-id, stem…].
        let pieces: Vec<&str> = base.rsplit('.').collect();
        if pieces.len() < 3 {
            eprintln!("[capture] meeting_recover: ignoring malformed part file {name}");
            continue;
        }
        let extension = pieces[0];
        let stem = pieces[2..].iter().rev().cloned().collect::<Vec<_>>().join(".");
        let meta = match std::fs::metadata(&part_path) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[capture] meeting_recover: cannot stat {name}: {e}");
                continue;
            }
        };
        if meta.len() == 0 {
            // Crash before the first chunk: nothing to recover.
            let _ = std::fs::remove_file(&part_path);
            continue;
        }
        let probe = match read_probe(&part_path) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[capture] meeting_recover: cannot read {name}: {e}");
                continue;
            }
        };
        if !sniff_audio_ok(&probe, extension) {
            eprintln!(
                "[capture] meeting_recover: {name} failed the .{extension} audio signature check — leaving it in place"
            );
            continue;
        }
        let final_stem = unique_stem(&state, &dir, &format!("{stem}-recovered"), extension);
        let file_name = format!("{final_stem}.{extension}");
        let final_path = dir.join(&file_name);
        if let Err(e) = std::fs::rename(&part_path, &final_path) {
            eprintln!("[capture] meeting_recover: cannot finalize {name}: {e}");
            continue;
        }
        let sidecar = meeting_sidecar_json(
            if extension == "webm" {
                "audio/webm"
            } else {
                "audio/mp4"
            },
            meta.len(),
            "",
            "auto",
            true,
        );
        if let Err(e) = write_sidecar_two_phase(&dir, &final_stem, &sidecar, "recover") {
            eprintln!("[capture] meeting_recover: cannot write sidecar for {file_name}: {e}");
            continue;
        }
        // Spool a transcription job for the recovered audio (best effort —
        // a spool failure must not lose the recovered file itself).
        let job_id = match (|| -> Result<String, String> {
            let spool = ai_spool_dir()?;
            let job_id = meeting_job_id(&state);
            let meeting_id = meeting_id(&state);
            let job_dir = spool.join(ai_edit::SPOOL_PENDING).join(&job_id);
            std::fs::create_dir_all(&job_dir)
                .map_err(|e| format!("cannot spool transcribe job: {e}"))?;
            let input_name = format!("{}.{}", forge_capture_core::meeting::JOB_INPUT_AUDIO, extension);
            std::fs::copy(&final_path, job_dir.join(&input_name))
                .map_err(|e| format!("cannot spool meeting audio: {e}"))?;
            let manifest = forge_capture_core::meeting::TranscribeJobManifest::new(
                &job_id,
                &meeting_id,
                &file_name,
                "auto",
                &forge_capture_core::timestamp::now_utc_iso8601(),
            );
            let manifest_json = serde_json::to_string_pretty(&manifest)
                .map_err(|e| format!("cannot encode transcribe manifest: {e}"))?;
            std::fs::write(job_dir.join(ai_edit::JOB_MANIFEST), manifest_json.as_bytes())
                .map_err(|e| format!("cannot spool transcribe manifest: {e}"))?;
            Ok(job_id)
        })() {
            Ok(id) => id,
            Err(e) => {
                eprintln!("[capture] meeting_recover: recovered {file_name} but spool failed: {e}");
                continue;
            }
        };
        recovered.push(RecoveredMeetingDto {
            audio_path: final_path.to_string_lossy().into_owned(),
            file_name,
            job_id,
        });
    }
    Ok(recovered)
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

/// C639-007D.2/007D.3: `focus_capture_window`, but for an overlay-originated
/// capture's post-publication focus steal specifically. Round 6
/// (007D.2) re-checked `active_pick` immediately before each individual
/// window action rather than from one decision cached before the whole
/// call — but each of those per-step checks still read the lock and
/// dropped it BEFORE its own action ran, on a background thread, with
/// nothing stopping a competing session's own main-thread window-build/
/// focus closure (`open_region_overlay_claimed`) from running in the gap
/// between the read and the act.
///
/// C639-007D.3: the fix funnels the ENTIRE recheck-and-act sequence through
/// ONE `run_on_main_thread_sync` dispatch, mirroring `open_region_overlay_
/// claimed`'s own build+focus closure exactly. Once dispatched, this
/// closure runs to completion on Tauri's single-threaded event loop with
/// nothing else FROM THAT LOOP interleaved between any of its own
/// check/act pairs — so a competing session's build/focus closure can only
/// ever run strictly before this one (in which case this closure's own
/// fresh, same-thread check catches the supersession immediately, before
/// touching anything) or strictly after it (in which case it is the LAST
/// thing to run and its own focus wins, undisturbed by this already-
/// completed closure) — never interleaved partway through one of this
/// closure's own check-then-act steps. A direct (non-overlay) capture has
/// no claim to revalidate (`capture_focus_still_current` always returns
/// true for it) and proceeds exactly as `focus_capture_window` always did,
/// just via the same single dispatch.
fn focus_capture_window_if_current(app: &tauri::AppHandle, is_overlay_request: bool, session_id: u64) {
    let app_for_dispatch = app.clone();
    let dispatched = run_on_main_thread_sync(app, move || {
        let app = app_for_dispatch;
        let state = app.state::<AppState>();
        let still_current = || {
            capture_focus_still_current(
                is_overlay_request,
                *state.active_pick.lock().unwrap(),
                session_id,
            )
        };
        if !still_current() {
            return;
        }
        if let Some(w) = app.get_webview_window("main") {
            if !still_current() {
                return;
            }
            let _ = w.unminimize();
            if !still_current() {
                return;
            }
            let _ = w.show();
            if !still_current() {
                return;
            }
            if let Err(e) = w.set_focus() {
                eprintln!("[capture] could not focus capture window: {e}");
            }
        }
    });
    if let Err(e) = dispatched {
        eprintln!("[capture] could not dispatch post-capture focus check: {e}");
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
        // C639-001: the global-shortcut callback itself runs on the main
        // thread (it must, to interact with window focus synchronously)
        // — the same reason `begin_region_pick`/`capture` needed an
        // explicit background boundary applies here. Dispatch to a
        // background thread rather than blocking the shortcut callback
        // (and therefore the main/event-loop thread) for the capture
        // worker's multi-second budget.
        HotkeyAction::RegionCapture => match monitor_id_for_hotkey() {
            Ok(id) => {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = open_region_overlay(&app, &id, 0, true) {
                        report_hotkey_error(&app, &e);
                    }
                });
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
                    overlay_session_id: None,
                    delay_ms: Some(0),
                    include_cursor: true,
                };
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let state = app.state::<AppState>();
                    if let Err(e) = run_capture(&app, state, &dto) {
                        report_hotkey_error(&app, &e);
                    }
                });
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
        GetAwarenessFromDpiAwarenessContext, GetThreadDpiAwarenessContext,
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    // The capture engine's entire coordinate pipeline assumes per-monitor
    // V2 awareness (virtual-desktop coords == physical pixels). A silent
    // failure here used to poison every downstream rect, so verify the
    // actual level and log it instead of ignoring the result.
    unsafe {
        let set_ok =
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).is_ok();
        let awareness = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
        // NOTE: V2 reports as PER_MONITOR_AWARE (there is no separate V2
        // level in DPI_AWARENESS); UNAWARE or SYSTEM_AWARE here means the
        // coordinate assumption is broken and captures may be blank.
        eprintln!(
            "[capture] DPI awareness: set_ok={set_ok} level={awareness:?}"
        );
    }
}

/// EXE identity for the phase ring log (C639 §5): path, size, SHA-256.
/// Best effort — "unreadable" when the file cannot be read.
fn exe_identity_string(exe: &std::path::Path) -> String {
    match std::fs::read(exe) {
        Ok(bytes) => {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(&bytes);
            format!(
                "path={} size={} sha256={:x}",
                exe.display(),
                bytes.len(),
                h.finalize()
            )
        }
        Err(e) => format!("path={} unreadable: {e}", exe.display()),
    }
}

fn main() {
    #[cfg(windows)]
    ensure_dpi_awareness();

    // C639 Option C: capture-worker mode. The parent re-enters its own EXE
    // with `--capture-worker`; this MUST precede all Tauri/window
    // initialization — the worker owns native GDI objects and must never
    // create a window, touch sessions, or write files. It performs exactly
    // one framed acquisition and exits.
    if std::env::args().any(|a| a == "--capture-worker") {
        std::process::exit(capture_worker_main());
    }

    // Resolved once, never caller-supplied: the worker is always this EXE.
    let exe_path = std::env::current_exe().unwrap_or_default();
    let supervisor = capture_worker::CaptureSupervisor::new(
        exe_path.clone(),
        forge_capture_core::artifact::MAX_ARTIFACT_BYTES,
    );
    supervisor
        .ring()
        .log("exe_identity", exe_identity_string(&exe_path));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            captures: Mutex::new(HashMap::new()),
            pending_overlay: Mutex::new(None),
            id_counter: Mutex::new(0),
            overlay_session: Mutex::new(0),
            active_pick: Mutex::new(None),
            overlay_window_owner: Mutex::new(None),
            capture_supervisor: supervisor,
            used_stems: Mutex::new(HashSet::new()),
            scroll_aborts: Mutex::new(HashMap::new()),
            printscreen_active: AtomicBool::new(false),
            media_uploads: Mutex::new(HashMap::new()),
            meeting_uploads: Mutex::new(HashMap::new()),
            process_capture: Mutex::new(None),
            process_capture_events: Arc::new(Mutex::new(
                forge_capture_core::process_capture::BoundedDropOldest::new(
                    512,
                    256 * 1024 * 1024,
                    pipeline_message_size,
                ),
            )),
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
            load_annotations,
            save_annotations,
            export_redacted,
            load_capture_tags,
            save_capture_tags,
            rebuild_library_index,
            process_capture_start_session,
            process_capture_stop_session,
            export_capture,
            begin_region_pick,
            overlay_context,
            cancel_region_pick,
            region_pick_backdrop,
            retry_region_backdrop,
            capture_phase_log,
            capture_overlay_phase,
            ai_edit_submit,
            ai_edit_poll,
            ai_edit_import,
            meeting_upload_begin,
            meeting_upload_append,
            meeting_upload_cancel,
            meeting_upload_finish,
            meeting_poll,
            meeting_import,
            meeting_recover,
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
            get_capture_preview_payload,
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
        //     region: null, overlayRect: r, overlaySessionId: sessionId,
        //     delayMs: 0, includeCursor: false }
        let json = r#"{
            "mode": "region-overlay",
            "monitorId": null,
            "windowId": null,
            "region": null,
            "overlayRect": {"x":1,"y":2,"w":3,"h":4},
            "overlaySessionId": 9,
            "delayMs": 0,
            "includeCursor": false
        }"#;
        let dto: CaptureRequestDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.mode, "region-overlay");
        let r = dto.overlay_rect.expect("overlayRect binds");
        assert_eq!((r.x, r.y, r.w, r.h), (1.0, 2.0, 3.0, 4.0));
        assert!(!dto.include_cursor);
        // C639-007C.3: this is the binding `run_capture_inner` verifies
        // against `active_pick`/`pending_overlay`/`overlay_window_owner`
        // before doing anything else for a region-overlay request.
        assert_eq!(dto.overlay_session_id, Some(9));
    }

    #[test]
    fn capture_request_dto_overlay_session_id_absent_for_non_overlay_modes() {
        // C639-007C.3: every other mode omits `overlaySessionId` entirely
        // (it never had an overlay to carry one from) — the field must
        // deserialize to `None`, not fail the whole request.
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
        assert_eq!(dto.overlay_session_id, None);
    }

    #[test]
    fn meeting_dtos_match_ui_payloads() {
        // ui/meeting.js startRecording():
        //   invoke("meeting_upload_begin",
        //     { dto: { totalBytes, mime, nameHint } })
        let json = r#"{"totalBytes": 1048576, "mime": "audio/webm;codecs=opus", "nameHint": "standup"}"#;
        let dto: BeginMeetingUploadDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.total_bytes, 1048576);
        assert_eq!(dto.mime, "audio/webm;codecs=opus");
        assert_eq!(dto.name_hint.as_deref(), Some("standup"));

        // ui/meeting.js pumpChunks():
        //   invoke("meeting_upload_append",
        //     { dto: { uploadId, offset, bytes } })
        let json = r#"{"uploadId": "mu-1-2", "offset": 0, "bytes": [1, 2, 3]}"#;
        let dto: AppendMeetingChunkDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.upload_id, "mu-1-2");
        assert_eq!(dto.offset, 0);
        assert_eq!(dto.bytes, vec![1u8, 2, 3]);

        // ui/meeting.js stopRecording():
        //   invoke("meeting_upload_finish",
        //     { dto: { uploadId, deviceLabel, languageHint, actualBytes } })
        let json =
            r#"{"uploadId": "mu-1-2", "deviceLabel": "Default Mic", "languageHint": "en", "actualBytes": 12345}"#;
        let dto: FinishMeetingUploadDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.upload_id, "mu-1-2");
        assert_eq!(dto.device_label.as_deref(), Some("Default Mic"));
        assert_eq!(dto.language_hint.as_deref(), Some("en"));
        assert_eq!(dto.actual_bytes, Some(12345));

        // Optional fields may be omitted entirely.
        let json = r#"{"uploadId": "mu-1-2"}"#;
        let dto: FinishMeetingUploadDto = serde_json::from_str(json).unwrap();
        assert!(dto.device_label.is_none());
        assert!(dto.language_hint.is_none());
    }

    #[test]
    fn meeting_audio_extension_allowlist() {
        assert_eq!(
            meeting_audio_extension("audio/webm").as_deref(),
            Ok("webm")
        );
        assert_eq!(
            meeting_audio_extension("audio/webm;codecs=opus").as_deref(),
            Ok("webm")
        );
        assert_eq!(
            meeting_audio_extension("audio/mp4").as_deref(),
            Ok("m4a")
        );
        assert!(meeting_audio_extension("video/webm").is_err());
        assert!(meeting_audio_extension("audio/webm-evil").is_err());
        assert!(meeting_audio_extension("").is_err());
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
        //
        // `begin_region_pick` is `async` (C639-001), so its return type is
        // an anonymous `impl Future` and it can no longer be cast to a
        // plain `fn` pointer. Pinning the signature by reference inside an
        // uncalled closure still fails to compile on a rename/reorder/
        // retype, or if the `State<AppState>` parameter this command used
        // to take ever comes back.
        let _pin = |monitor_id: String,
                    delay_ms: Option<u64>,
                    include_cursor: Option<bool>,
                    app: tauri::AppHandle| {
            let _future = begin_region_pick(monitor_id, delay_ms, include_cursor, app);
        };
    }

    #[test]
    fn begin_media_upload_dto_matches_ui_payload() {
        // ui/record.js uploadBytes():
        //   { totalBytes, mime, suggestedExtension, nameHint }
        let json = r#"{
            "totalBytes": 1048576,
            "mime": "video/webm;codecs=vp9",
            "suggestedExtension": null,
            "nameHint": "recording"
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
            "totalBytes": 2048,
            "mime": "image/gif",
            "suggestedExtension": "gif",
            "nameHint": "recording-clip"
        }"#;
        let dto: BeginMediaUploadDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.mime, "image/gif");
        assert_eq!(dto.suggested_extension.as_deref(), Some("gif"));
    }

    #[test]
    fn append_media_chunk_dto_matches_ui_payload() {
        // ui/record.js uploadBytes(): { uploadId, offset, bytes } where
        // bytes is a plain JSON number array (Tauri has no binary IPC for
        // number arrays).
        let json = r#"{"uploadId": "upl-123-1", "offset": 1048576, "bytes": [26, 69, 223, 163]}"#;
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
    fn base64_decode_matches_known_vectors() {
        assert_eq!(base64_decode("").unwrap(), b"");
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64_decode("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(base64_decode("Zm9vYmE=").unwrap(), b"fooba");
        assert_eq!(base64_decode("Zm9vYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn base64_round_trips_every_byte_value() {
        let all: Vec<u8> = (0u8..=255u8).collect();
        assert_eq!(base64_decode(&base64_encode(&all)).unwrap(), all);
    }

    #[test]
    fn base64_decode_rejects_invalid_characters() {
        assert!(base64_decode("not valid base64!!").is_err());
    }

    #[test]
    fn base64_decode_rejects_a_length_that_is_not_a_multiple_of_four() {
        // Review finding: the previous decoder stripped trailing '=' before checking length, so
        // a too-short input silently decoded a partial, wrong byte instead of failing. "QQ" (2
        // chars, no padding) is exactly that case: a real base64 encoder would never emit it.
        for input in ["Q", "QQ", "QQQ", "QQQQQ"] {
            assert!(
                base64_decode(input).is_err(),
                "expected {input:?} (length {}) to be rejected",
                input.len()
            );
        }
    }

    #[test]
    fn base64_decode_rejects_excessive_padding() {
        // "====" alone has a valid length (4) but is not a valid encoding of anything -- the
        // previous decoder stripped all four '=' and silently returned an empty Vec instead of
        // rejecting it.
        assert!(base64_decode("====").is_err());
        assert!(base64_decode("A===").is_err());
    }

    #[test]
    fn base64_decode_rejects_padding_before_the_end() {
        assert!(base64_decode("Zg=A").is_err());
        assert!(base64_decode("Z=g=").is_err());
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

#[cfg(test)]
mod region_picker_tests {
    //! Regression tests for the region-picker white-square failure
    //! (2026-09-28, real hardware: the Region overlay opened on a blank
    //! white square with no crosshair and trapped the screen).
    //!
    //! The overlay opens on a frozen backdrop captured before its window
    //! exists, and the page is served those stored bytes — it never
    //! triggers a fresh capture that could catch the overlay itself. A
    //! uniform frame raises a blank-frame warning (retry / proceed /
    //! cancel) instead of a hard abort, because a solid-color desktop is
    //! legitimate.

    use super::*;

    fn overlay_ctx_with_backdrop(png: Option<Vec<u8>>) -> OverlayContext {
        OverlayContext {
            monitor_id: "DISPLAY1".to_string(),
            origin_virtual: (0, 0),
            dpr: 1.0,
            delay_ms: 0,
            include_cursor: false,
            backdrop_png: png,
            session_id: 7,
            backdrop_blank: false,
        }
    }

    #[test]
    fn solid_frame_detector_rejects_uniform_white() {
        // 4x1 RGBA frame, every pixel 0xFF — the dead-frame signature.
        let rgba = vec![0xFFu8; 16];
        assert!(solid_frame_rgba(&rgba));
    }

    #[test]
    fn solid_frame_detector_rejects_uniform_black() {
        let rgba = vec![0x00u8; 16];
        assert!(solid_frame_rgba(&rgba));
    }

    #[test]
    fn solid_frame_detector_accepts_one_different_pixel() {
        let mut rgba = vec![0xFFu8; 16];
        rgba[5] = 0x00; // green channel of the second pixel differs
        assert!(!solid_frame_rgba(&rgba));
    }

    #[test]
    fn solid_frame_detector_accepts_one_different_byte() {
        let mut rgba = vec![0xABu8; 64];
        rgba[63] = 0xAC; // last byte of the last pixel differs
        assert!(!solid_frame_rgba(&rgba));
    }

    #[test]
    fn solid_frame_detector_rejects_degenerate_inputs() {
        assert!(!solid_frame_rgba(&[]));
        assert!(!solid_frame_rgba(&[0xFFu8; 4])); // single pixel: too small to judge
        assert!(!solid_frame_rgba(&[0xFFu8; 7])); // not a whole number of pixels
    }

    #[test]
    fn backdrop_lookup_serves_stored_bytes() {
        let png = vec![137u8, 80, 78, 71];
        let ctx = overlay_ctx_with_backdrop(Some(png.clone()));
        assert_eq!(stored_backdrop_png(Some(&ctx)).unwrap(), png.as_slice());
    }

    #[test]
    fn backdrop_lookup_errors_without_pending_overlay() {
        let err = stored_backdrop_png(None).unwrap_err();
        assert!(err.contains("no pending region overlay"), "got: {err}");
    }

    #[test]
    fn backdrop_lookup_errors_when_backdrop_missing() {
        // The overlay must never open without a stored backdrop; if the
        // context somehow has none, the page gets an error, not a fresh
        // capture that could see the overlay itself.
        let ctx = overlay_ctx_with_backdrop(None);
        let err = stored_backdrop_png(Some(&ctx)).unwrap_err();
        assert!(err.contains("no stored backdrop"), "got: {err}");
    }

    #[test]
    fn stale_watchdog_never_kills_a_newer_session() {
        // Session A opens (watchdog A spawned), the user cancels, session B
        // opens (watchdog B spawned). When watchdog A's 60 s expire it must
        // leave session B completely alone.
        let mut ctx_b = overlay_ctx_with_backdrop(None);
        ctx_b.session_id = 8;
        assert!(
            !watchdog_should_clear(Some(&ctx_b), 7),
            "stale watchdog cleared a newer session"
        );
        assert!(watchdog_should_clear(Some(&ctx_b), 8));
        assert!(!watchdog_should_clear(None, 8));
    }

    #[test]
    fn pick_still_active_requires_exact_match() {
        // C639-007: a pick claims active_pick before its blocking backdrop
        // acquisition; after that wait, only an EXACT match (nothing
        // cancelled it to None, nothing newer overwrote it) lets the
        // install proceed.
        assert!(pick_still_active(Some(5), 5));
        assert!(!pick_still_active(None, 5), "cancelled must not read as active");
        assert!(
            !pick_still_active(Some(6), 5),
            "a newer, different pick must not read as this one's"
        );
    }

    #[test]
    fn capture_focus_still_current_gates_only_overlay_originated_captures() {
        // C639-007: a direct (non-overlay) capture always may steal focus
        // — unchanged behavior, nothing for it to be superseded by.
        assert!(capture_focus_still_current(false, None, 5));
        assert!(capture_focus_still_current(false, Some(999), 5));
        // An overlay-originated capture only steals focus while its own
        // session is still the active pick.
        assert!(capture_focus_still_current(true, Some(5), 5));
        assert!(
            !capture_focus_still_current(true, None, 5),
            "cancelled during the worker round trip must not steal focus"
        );
        assert!(
            !capture_focus_still_current(true, Some(6), 5),
            "a newer pick must not have its focus stolen by an older capture's result"
        );
    }

    #[test]
    fn publication_commit_is_rejected_for_a_cancelled_or_superseded_overlay_pick() {
        // C639-007D.1: the commit-authorization check in
        // `run_capture_via_worker_inner` is exactly `capture_focus_still_current`
        // evaluated once, under a momentary lock hold, before `store_artifact`
        // — a cancel must block publication outright, not just a later
        // focus-steal.
        assert!(!capture_focus_still_current(true, None, 5));
        assert!(!capture_focus_still_current(true, Some(6), 5));
    }

    #[test]
    fn late_focus_after_a_slow_store_is_revalidated_not_cached() {
        // C639-007D.1: the original bug cached a `should_focus` boolean
        // decided at authorization time and reused it AFTER
        // `store_artifact`'s unbounded disk write — so a pick (A) that was
        // authorized, then superseded by a newer pick (B) while A's write
        // was still in flight, could steal focus back from B using its
        // stale, pre-write decision. The fix: `capture_focus_still_current`
        // is called again, fresh, after the write — never reused from the
        // authorization moment.
        let active_pick = Mutex::new(Some(5u64)); // A authorized
        let authorized = capture_focus_still_current(true, *active_pick.lock().unwrap(), 5);
        assert!(authorized, "A must be authorized to publish while still active");
        // A's store stalls; B supersedes A while the write is in flight.
        *active_pick.lock().unwrap() = Some(6);
        // A's store "completes" here. Revalidating now — not reusing
        // `authorized` — must refuse A's focus steal.
        let should_focus_now = capture_focus_still_current(true, *active_pick.lock().unwrap(), 5);
        assert!(!should_focus_now, "a too-late A must not steal focus from B");
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(6),
            "B's claim must survive A's entire publication untouched"
        );
    }

    #[test]
    fn build_failure_before_worker_admission_retires_the_overlay_claim() {
        // C639-007C.1: `build_mode` can fail on a region-overlay request
        // (overlay-close, destruction-wait, or missing `overlay_rect`)
        // BEFORE `run_capture_via_worker`'s own wrapper is ever reached —
        // that wrapper was the reservation's only other release point, so
        // without this, a pre-worker failure here stranded the session's
        // `active_pick` token forever, permanently refusing every future
        // `open_region_overlay`.
        let active_pick = Mutex::new(Some(5u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 5;
        let result: Result<(), String> = retire_claim_on_overlay_build_failure(
            true,
            Some(5),
            &active_pick,
            &pending_overlay,
            Err("close_overlay_window failed".to_string()),
        );
        assert!(result.is_err(), "the original build_mode failure must still propagate");
        assert_eq!(
            *active_pick.lock().unwrap(),
            None,
            "the stranded active_pick token must be retired"
        );
        assert!(
            pending_overlay.lock().unwrap().is_none(),
            "the matching pending_overlay context must be retired too"
        );
    }

    #[test]
    fn build_failure_retire_never_clears_a_newer_claimant() {
        // Freeze: an immediate second open after the failure must be
        // admitted (the stale session's own token is gone), and a newer
        // token already in the slot must survive a late/duplicate retire
        // from the older, already-superseded session.
        let active_pick = Mutex::new(Some(6u64)); // a newer session already admitted
        let pending_overlay = Mutex::new(None::<OverlayContext>);
        let _: Result<(), String> = retire_claim_on_overlay_build_failure(
            true,
            Some(5), // the stale, superseded session's own id
            &active_pick,
            &pending_overlay,
            Err("close_overlay_window failed".to_string()),
        );
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(6),
            "a late retire from a superseded session must never clear a newer claim"
        );
    }

    #[test]
    fn build_failure_retire_is_a_no_op_for_direct_requests_and_on_success() {
        // A direct (non-overlay) request never claimed anything, so a
        // build failure for one must leave active_pick alone. On SUCCESS
        // the claim must also stay held — `run_capture_via_worker`'s own
        // wrapper is the reservation's normal release point for the
        // worker it is about to run, not this one.
        let active_pick = Mutex::new(Some(5u64));
        let pending_overlay = Mutex::new(None::<OverlayContext>);
        let _: Result<(), String> = retire_claim_on_overlay_build_failure(
            false,
            None,
            &active_pick,
            &pending_overlay,
            Err("unrelated direct-mode failure".to_string()),
        );
        assert_eq!(*active_pick.lock().unwrap(), Some(5), "direct request: no-op on failure");
        let result = retire_claim_on_overlay_build_failure(
            true,
            Some(5),
            &active_pick,
            &pending_overlay,
            Ok(()),
        );
        assert!(result.is_ok());
        assert_eq!(*active_pick.lock().unwrap(), Some(5), "no-op on success: stays held for the worker");
    }

    #[test]
    fn owns_overlay_window_requires_exact_session_match() {
        // C639-001C.1: a close acting on behalf of a stale/superseded
        // session must bind to the actual `overlay_window_owner` token,
        // never to "whatever window currently has the shared label".
        assert!(owns_overlay_window(Some(2), 2));
        assert!(
            !owns_overlay_window(Some(2), 1),
            "session 1's cleanup must not think it owns session 2's window"
        );
        assert!(
            !owns_overlay_window(None, 1),
            "a session that never built a window has nothing of its own to close"
        );
    }

    #[test]
    fn successful_pick_retires_its_claim_so_the_next_open_is_admitted() {
        // C639-007C: `open_region_overlay`'s strict reservation (C639-007A)
        // refuses a second open outright whenever `active_pick.is_some()`.
        // `run_capture_via_worker`'s terminal-success cleanup must retire
        // its own claim through the exact same `clear_pick_if_current` the
        // failure paths already used, or the next open is refused forever
        // by this already-finished session's own leftover token.
        let active_pick = Mutex::new(Some(42u64));
        let pending_overlay = Mutex::new(None::<OverlayContext>); // build_mode already took it
        clear_pick_if_current(&active_pick, &pending_overlay, 42);
        assert_eq!(
            *active_pick.lock().unwrap(),
            None,
            "a completed pick must release its claim so the next open_region_overlay is admitted"
        );
    }

    #[test]
    fn retiring_a_finished_pick_never_clears_a_newer_claim() {
        // The same safety property `pick_still_active` enforces elsewhere:
        // a stale retire (e.g. a slow worker's cleanup finally running
        // after a newer pick has already started) must never clear
        // something it didn't claim.
        let active_pick = Mutex::new(Some(2u64)); // session 2 is the current, newer claim
        let pending_overlay = Mutex::new(None::<OverlayContext>);
        clear_pick_if_current(&active_pick, &pending_overlay, 1); // a late retire from session 1
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(2),
            "retiring an old session's claim must not clear a newer session's claim"
        );
    }

    #[test]
    fn retiring_a_pick_also_clears_a_still_pending_overlay_context() {
        // Covers the failure-path shape (unlike the success path, where
        // `build_mode` already took `pending_overlay` before this ever
        // runs): a backdrop/dispatch/build failure must retire BOTH the
        // `active_pick` token and any `pending_overlay` context still
        // carrying the same session id.
        let active_pick = Mutex::new(Some(9u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 9;
        clear_pick_if_current(&active_pick, &pending_overlay, 9);
        assert_eq!(*active_pick.lock().unwrap(), None);
        assert!(pending_overlay.lock().unwrap().is_none());
    }

    #[test]
    fn stranded_claim_with_no_pending_overlay_is_still_retired() {
        // C639-007C.2 freeze: `active_pick=Some(A), pending_overlay=None`
        // followed by a capture — e.g. a `build_mode` call that finds no
        // pending context at all ("no pending region overlay; call
        // begin_region_pick first"), or an injected monitor-enumeration
        // failure reached before any context was ever installed. The
        // round-5 helper derived its retire identity from `pending_overlay`
        // alone, which is `None` here, so it never cleared anything and
        // `active_pick` stayed stranded forever. The fix: `run_capture_
        // inner` now reads `active_claim` from `active_pick` itself —
        // modeled here directly, since `retire_claim_on_overlay_build_
        // failure` only ever acts on whatever identity it is given.
        let active_pick = Mutex::new(Some(11u64)); // A: stranded, no pending context
        let pending_overlay = Mutex::new(None::<OverlayContext>);
        let active_claim = *active_pick.lock().unwrap(); // what run_capture_inner reads now
        let result: Result<(), String> = retire_claim_on_overlay_build_failure(
            true,
            active_claim,
            &active_pick,
            &pending_overlay,
            Err("no pending region overlay; call begin_region_pick first".to_string()),
        );
        assert!(result.is_err());
        assert_eq!(
            *active_pick.lock().unwrap(),
            None,
            "A's stranded claim must be retired even with no pending_overlay to name it"
        );
        // An immediate second open is now admitted: `open_region_overlay`'s
        // own claim step refuses only `if active.is_some()`.
        assert!(active_pick.lock().unwrap().is_none());
    }

    #[test]
    fn stranded_claim_retire_never_clears_a_newer_token_already_substituted() {
        // C639-007C.2 freeze, continued: if some other admission already
        // installed a newer token (B) in `active_pick` by the time A's
        // stranded-claim retire runs, B must survive untouched — same
        // exact-match safety `clear_pick_if_current`/`retire_claim_on_
        // overlay_build_failure` already guarantee elsewhere, re-asserted
        // for the `pending_overlay == None` shape this round closes.
        let active_pick = Mutex::new(Some(22u64)); // B already admitted
        let pending_overlay = Mutex::new(None::<OverlayContext>);
        let stale_active_claim = Some(11u64); // A's own id, captured before B's admission
        let _: Result<(), String> = retire_claim_on_overlay_build_failure(
            true,
            stale_active_claim,
            &active_pick,
            &pending_overlay,
            Err("watchdog expiry".to_string()),
        );
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(22),
            "a late retire from A's stranded claim must never clear B's newer token"
        );
    }

    #[test]
    fn watchdog_expiry_retires_the_matching_active_pick_claim() {
        // C639-007C.2: the 60s watchdog's expiry now runs through the same
        // `clear_pick_if_current` every other terminal path uses, so it
        // retires `active_pick` too, not only `pending_overlay` — mirrors
        // production `spawn_overlay_watchdog`'s decide-then-retire shape
        // without needing a live Tauri app/thread.
        let active_pick = Mutex::new(Some(5u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 5;
        let should_clear =
            watchdog_should_clear(pending_overlay.lock().unwrap().as_ref(), 5);
        assert!(should_clear);
        clear_pick_if_current(&active_pick, &pending_overlay, 5);
        assert_eq!(
            *active_pick.lock().unwrap(),
            None,
            "a watchdog expiry must retire the matching active_pick claim"
        );
        assert!(pending_overlay.lock().unwrap().is_none());
    }

    #[test]
    fn watchdog_expiry_never_closes_or_strands_a_newer_sessions_window() {
        // C639-007C.2 freeze: watchdog expiry, with a substituted newer
        // token B surviving. Once the watchdog's retire clears A's claim,
        // a brand-new session B can be admitted and build its own window
        // before the watchdog's close runs — the close must stay bound to
        // `overlay_window_owner` (`close_owned_overlay_window`,
        // C639-001C.1), never "whatever is labeled overlay", or a stale
        // watchdog could tear down B's live picker.
        let owner_after_b_admitted = Some(6u64); // B built its own window
        assert!(
            !owns_overlay_window(owner_after_b_admitted, 5),
            "watchdog A's close must not think it owns B's window"
        );
    }

    #[test]
    fn retry_show_failure_retires_the_matching_active_pick_claim() {
        // C639-007C.2: `retry_region_backdrop_blocking`'s "could not
        // restore the picker window" terminal failure tears the session
        // down exactly like `cancel_region_pick` — it must retire
        // `active_pick` too (via the same `clear_pick_if_current`), not
        // only `pending_overlay`/`overlay_window_owner`, or the strict
        // reservation strands a session nothing can ever reuse once the
        // picker itself is already unrecoverable.
        let active_pick = Mutex::new(Some(13u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 13;
        clear_pick_if_current(&active_pick, &pending_overlay, 13);
        assert_eq!(*active_pick.lock().unwrap(), None);
        assert!(pending_overlay.lock().unwrap().is_none());
    }

    #[test]
    fn per_step_focus_recheck_catches_a_supersession_a_single_cached_check_would_miss() {
        // C639-007D.2 freeze: "A passes post-store check -> cancel A -> B
        // opens/builds -> A attempts UI action", asserting B keeps focus.
        // `focus_capture_window_if_current` re-reads `active_pick` fresh
        // immediately before EACH window action (unminimize/show/
        // set_focus), never from one decision cached before the whole
        // call. Modeled here without a live Tauri app: the single
        // pre-call check (what round 5 shipped) passes at authorization
        // time, but by the time the (simulated) first window action would
        // run, A has been cancelled and B has been admitted — the SAME
        // `capture_focus_still_current` re-evaluated at that later point
        // must now refuse, which is exactly what each per-step check in
        // `focus_capture_window_if_current` does.
        let active_pick = Mutex::new(Some(5u64)); // A, just authorized
        let cached_check_at_authorization = capture_focus_still_current(
            true,
            *active_pick.lock().unwrap(),
            5,
        );
        assert!(cached_check_at_authorization, "A's own authorization must pass");
        // A is cancelled; B opens and is admitted into active_pick.
        *active_pick.lock().unwrap() = Some(6);
        // A now reaches what would be its first window action. A stale
        // implementation would reuse `cached_check_at_authorization`
        // (still `true`) and steal focus from B. The fix re-checks fresh,
        // right here, at the point of execution:
        let recheck_at_first_window_action =
            capture_focus_still_current(true, *active_pick.lock().unwrap(), 5);
        assert!(
            !recheck_at_first_window_action,
            "a per-step recheck must catch A's supersession even though A's own \
             pre-call authorization already passed"
        );
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(6),
            "B's claim must survive A's entire (suppressed) focus attempt untouched"
        );
    }

    #[test]
    fn capture_aborts_when_overlay_still_present() {
        // The never-capture-with-overlay-visible contract: a stuck overlay
        // window aborts the BitBlt loudly instead of screenshotting the
        // picker itself.
        let err = must_abort_capture_if_overlay_present(true).unwrap_err();
        assert!(err.contains("aborted"), "got: {err}");
        assert!(must_abort_capture_if_overlay_present(false).is_ok());
    }

    #[test]
    fn blank_backdrop_surfaces_warning_flag_to_page() {
        // A uniform frame warns instead of aborting: the DTO must carry
        // the flag so the page can show retry / proceed / cancel.
        let mut ctx = overlay_ctx_with_backdrop(None);
        ctx.backdrop_blank = true;
        assert!(overlay_context_dto(&ctx).backdrop_blank);
        ctx.backdrop_blank = false;
        assert!(!overlay_context_dto(&ctx).backdrop_blank);
    }

    #[test]
    fn overlay_context_dto_carries_its_own_session_id() {
        // C639-007C.3: the page echoes this straight back on its eventual
        // `capture` call as `overlaySessionId` — the binding the backend
        // verifies against `active_pick`/`pending_overlay`/`overlay_
        // window_owner` depends on the DTO actually carrying it.
        let mut ctx = overlay_ctx_with_backdrop(None);
        ctx.session_id = 123;
        assert_eq!(overlay_context_dto(&ctx).session_id, 123);
    }

    // -----------------------------------------------------------------
    // C639-007C.5: `overlay_context`/`region_pick_backdrop` must never
    // serve a DIFFERENT session's context/frame — a stale page's read
    // must fail closed rather than return data it could adopt as its own
    // identity.
    // -----------------------------------------------------------------

    #[test]
    fn overlay_context_for_session_returns_the_dto_when_sessions_agree() {
        let mut ctx = overlay_ctx_with_backdrop(None);
        ctx.session_id = 5;
        let dto = overlay_context_for_session(Some(&ctx), 5).expect("must serve matching session");
        assert_eq!(dto.session_id, 5);
    }

    #[test]
    fn overlay_context_for_session_refuses_a_different_sessions_context() {
        // A context IS pending — just not for the caller's session. The
        // prior unbound `overlay_context` returned whichever context was
        // current regardless of who asked; serving B's context to a
        // request carrying stale A's id is exactly what let A silently
        // adopt B's identity.
        let mut b_ctx = overlay_ctx_with_backdrop(None);
        b_ctx.session_id = 6;
        assert!(overlay_context_for_session(Some(&b_ctx), 5).is_none());
    }

    #[test]
    fn overlay_context_for_session_refuses_when_nothing_is_pending() {
        assert!(overlay_context_for_session(None, 5).is_none());
    }

    #[test]
    fn stored_backdrop_png_refuses_a_different_sessions_context() {
        // Same binding as `overlay_context_for_session`, exercised through
        // the actual helper `region_pick_backdrop` calls: a pending
        // context for session 6 must yield nothing when the caller's own
        // session (the exact filter `region_pick_backdrop` applies before
        // calling this) is 5 — modeled here by passing the pre-filtered
        // `None` a session mismatch produces, the same shape the command
        // itself constructs.
        let b_ctx = overlay_ctx_with_backdrop(Some(vec![1, 2, 3]));
        let filtered: Option<&OverlayContext> =
            Some(&b_ctx).filter(|c| c.session_id == 5);
        assert!(filtered.is_none(), "session 6's context must not pass a session-5 filter");
        assert!(stored_backdrop_png(filtered).is_err());
    }

    #[test]
    fn worker_routing_takes_plain_region() {
        // C639 Option C: a plain RegionVirtual routes to the worker.
        let mode = CaptureMode::RegionVirtual {
            rect: Rect {
                x: -1920.0,
                y: 0.0,
                w: 2560.0,
                h: 1440.0,
            },
        };
        let (rect, delay) = worker_region_request(&mode).expect("must route");
        assert_eq!((rect.x, rect.y, rect.w, rect.h), (-1920.0, 0.0, 2560.0, 1440.0));
        assert_eq!(delay, 0);
    }

    #[test]
    fn worker_routing_unwraps_delayed_region() {
        // The delay travels with the request; the worker sleeps before
        // acquiring so the acquisition timestamp stays truthful.
        let mode = CaptureMode::Delayed {
            mode: Box::new(CaptureMode::RegionVirtual {
                rect: Rect { x: 0.0, y: 0.0, w: 100.0, h: 100.0 },
            }),
            delay_ms: 2500,
        };
        let (rect, delay) = worker_region_request(&mode).expect("must route");
        assert_eq!((rect.w, rect.h), (100.0, 100.0));
        assert_eq!(delay, 2500);
    }

    #[test]
    fn worker_routing_leaves_other_modes_on_direct_path() {
        // Only the region-overlay path moves to the worker; everything
        // else keeps the existing direct engine path (blast radius).
        assert!(worker_region_request(&CaptureMode::FullMonitor {
            monitor_id: "m".to_string()
        })
        .is_none());
        assert!(worker_region_request(&CaptureMode::Delayed {
            mode: Box::new(CaptureMode::FullMonitor {
                monitor_id: "m".to_string()
            }),
            delay_ms: 100,
        })
        .is_none());
        assert!(worker_region_request(&CaptureMode::Window {
            window_id: "w".to_string()
        })
        .is_none());
    }

    #[test]
    fn direct_region_mints_fresh_session_with_no_picker_pending() {
        // C639-004: a direct ("region") capture has no overlay to borrow
        // an identity from and must not require one.
        let id = region_worker_session_id(false, None, || 777).unwrap();
        assert_eq!(id, 777);
    }

    #[test]
    fn delayed_direct_region_also_mints_fresh_session() {
        // C639-004: the delayed variant of a direct region request takes
        // the exact same dispatch path as the plain one.
        let mode = CaptureMode::Delayed {
            mode: Box::new(CaptureMode::RegionVirtual {
                rect: Rect { x: 0.0, y: 0.0, w: 50.0, h: 50.0 },
            }),
            delay_ms: 1000,
        };
        assert!(worker_region_request(&mode).is_some());
        let id = region_worker_session_id(false, None, || 778).unwrap();
        assert_eq!(id, 778);
    }

    #[test]
    fn direct_region_never_borrows_an_unrelated_pending_overlay_session() {
        // C639-004: a direct region request must not silently consume a
        // DIFFERENT, concurrently pending overlay pick's session
        // identity — even though one happens to be live.
        let id = region_worker_session_id(false, Some(999), || 42).unwrap();
        assert_eq!(id, 42, "must mint fresh, not borrow the unrelated session 999");
    }

    #[test]
    fn overlay_region_uses_its_own_pending_session() {
        let id = region_worker_session_id(true, Some(5), || panic!("must not mint")).unwrap();
        assert_eq!(id, 5);
    }

    #[test]
    fn overlay_region_with_vanished_context_is_a_loud_error() {
        let err = region_worker_session_id(true, None, || panic!("must not mint")).unwrap_err();
        assert!(err.contains("vanished"));
    }

    // -----------------------------------------------------------------
    // C639-007C.3: a request session must bind to the SAME generation
    // across active_pick / pending_overlay / overlay_window_owner, never
    // to whichever claim happens to be current when it is processed.
    // -----------------------------------------------------------------

    #[test]
    fn overlay_request_session_still_current_requires_all_three_to_agree() {
        let active_pick = Mutex::new(Some(5u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 5;
        let overlay_window_owner = Mutex::new(Some(5u64));
        assert!(overlay_request_session_still_current(
            &active_pick,
            &pending_overlay,
            &overlay_window_owner,
            5
        ));
    }

    #[test]
    fn overlay_request_session_still_current_rejects_a_stale_request_displaced_by_a_newer_one() {
        // C639-007C.3 freeze: A's overlay queued `capture` (carrying A's own
        // session id, 5) but had not yet begun its body; A was cancelled;
        // B (6) was admitted and installed active_pick/pending_overlay/
        // overlay_window_owner for ITSELF. A's delayed body now runs and
        // must bind to A's OWN id (5) — never to whichever claim (6) is
        // current — and must observe the mismatch and refuse.
        let active_pick = Mutex::new(Some(6u64)); // B now holds the claim
        let mut b_ctx = overlay_ctx_with_backdrop(None);
        b_ctx.session_id = 6;
        let pending_overlay = Mutex::new(Some(b_ctx));
        let overlay_window_owner = Mutex::new(Some(6u64));
        assert!(
            !overlay_request_session_still_current(
                &active_pick,
                &pending_overlay,
                &overlay_window_owner,
                5 // A's own, now-stale id
            ),
            "A's stale request must not read B's live claim as its own"
        );
        // B's state must be completely untouched by A's failed check.
        assert_eq!(*active_pick.lock().unwrap(), Some(6));
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            Some(6)
        );
        assert_eq!(*overlay_window_owner.lock().unwrap(), Some(6));
    }

    #[test]
    fn overlay_request_session_still_current_rejects_when_only_the_window_owner_disagrees() {
        // active_pick and pending_overlay can agree while overlay_window_
        // owner alone has moved on (e.g. an owner-gated close already ran
        // for this session but the other two slots have not yet been
        // retired) — the binding requires all three, not just two of three.
        let active_pick = Mutex::new(Some(5u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 5;
        let overlay_window_owner = Mutex::new(None::<u64>);
        assert!(!overlay_request_session_still_current(
            &active_pick,
            &pending_overlay,
            &overlay_window_owner,
            5
        ));
    }

    // -----------------------------------------------------------------
    // C639-007C.4: `retry_region_backdrop_blocking` and `cancel_region_
    // pick` must bind to the session the ORIGINATING PAGE carries (its own
    // URL — see `open_region_overlay_claimed`), never to whichever claim
    // happens to be `active_pick`/`pending_overlay`/`overlay_window_owner`
    // right now. Both commands require a live `tauri::AppHandle` and so are
    // themselves untestable here (same as `run_capture_inner`, `build_mode`,
    // `open_region_overlay` above) — these tests exercise the exact bound
    // primitives their bodies are built from, in the same sequence those
    // bodies use them: `overlay_request_session_still_current` for the
    // pre-mutation guard both commands check before touching anything,
    // `clear_pick_if_current` for the state retire cancel (and the retry
    // restore-failure branch) perform, and `owns_overlay_window` for the
    // window-owner-gated close `close_owned_overlay_window` (cancel's close,
    // the retry restore-failure branch's close) is built from.
    // -----------------------------------------------------------------

    #[test]
    fn retry_and_cancel_bound_primitives_reject_a_stale_session_displaced_by_a_newer_one() {
        // Freeze: overlay A (session 5) queued Retry and, separately,
        // Cancel; neither command body has acquired state yet. A is
        // retired; B (session 6) is admitted and installs its own
        // active_pick/pending_overlay/overlay_window_owner. A's delayed
        // command bodies now begin.
        let active_pick = Mutex::new(Some(6u64));
        let mut b_ctx = overlay_ctx_with_backdrop(None);
        b_ctx.session_id = 6;
        let pending_overlay = Mutex::new(Some(b_ctx));
        let overlay_window_owner = Mutex::new(Some(6u64));

        // Retry's (and cancel's) pre-mutation guard: A's stale id (5) must
        // fail the same three-way check `run_capture_inner` uses for
        // `capture` — before any hide/capture/show/focus/close of B's
        // window.
        assert!(
            !overlay_request_session_still_current(
                &active_pick,
                &pending_overlay,
                &overlay_window_owner,
                5
            ),
            "A's stale retry/cancel must not read B's live claim as its own"
        );

        // Cancel's (and the retry restore-failure branch's) state retire:
        // A's stale id must not clear B's claim.
        clear_pick_if_current(&active_pick, &pending_overlay, 5);
        assert_eq!(*active_pick.lock().unwrap(), Some(6));
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            Some(6)
        );

        // Cancel's (and the retry restore-failure branch's) window-owner-
        // gated close: A's stale id is never recognized as the window's
        // owner, so no close (and, in the live commands, no hide/show/
        // focus) can ever be dispatched against B's window on A's behalf.
        assert!(!owns_overlay_window(
            *overlay_window_owner.lock().unwrap(),
            5
        ));
        assert_eq!(*overlay_window_owner.lock().unwrap(), Some(6));
    }

    #[test]
    fn retry_and_cancel_bound_primitives_accept_the_session_that_still_owns_the_claim() {
        // The matching, non-stale case: the fix binds retry/cancel to the
        // caller's own session — it must not disable the ordinary path for
        // a session that is still genuinely current.
        let active_pick = Mutex::new(Some(6u64));
        let mut ctx = overlay_ctx_with_backdrop(None);
        ctx.session_id = 6;
        let pending_overlay = Mutex::new(Some(ctx));
        let overlay_window_owner = Mutex::new(Some(6u64));

        assert!(overlay_request_session_still_current(
            &active_pick,
            &pending_overlay,
            &overlay_window_owner,
            6
        ));
        assert!(owns_overlay_window(*overlay_window_owner.lock().unwrap(), 6));

        clear_pick_if_current(&active_pick, &pending_overlay, 6);
        assert_eq!(*active_pick.lock().unwrap(), None);
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            None
        );
    }

    #[test]
    fn take_pending_overlay_if_current_consumes_only_its_own_matching_context() {
        let active_pick = Mutex::new(Some(7u64));
        let pending_overlay = Mutex::new(Some(overlay_ctx_with_backdrop(None)));
        pending_overlay.lock().unwrap().as_mut().unwrap().session_id = 7;
        let taken = take_pending_overlay_if_current(&active_pick, &pending_overlay, 7);
        assert_eq!(taken.map(|c| c.session_id), Some(7));
        assert!(
            pending_overlay.lock().unwrap().is_none(),
            "a successful take must consume the context"
        );
    }

    #[test]
    fn take_pending_overlay_if_current_never_consumes_a_newer_sessions_context() {
        // C639-007C.3 freeze, continued: A's stale `build_mode` call (bound
        // to A's own id, 5) must not consume B's (6) context, close B's
        // picker, or apply A's geometry to it, even though A's call is the
        // one actually reaching `build_mode`'s take.
        let active_pick = Mutex::new(Some(6u64)); // B holds the claim
        let mut b_ctx = overlay_ctx_with_backdrop(None);
        b_ctx.session_id = 6;
        let pending_overlay = Mutex::new(Some(b_ctx));
        let taken = take_pending_overlay_if_current(&active_pick, &pending_overlay, 5);
        assert!(
            taken.is_none(),
            "A's stale take must not consume B's context"
        );
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            Some(6),
            "B's context must survive A's failed take completely untouched"
        );
    }

    #[test]
    fn take_pending_overlay_if_current_refuses_when_active_pick_already_moved_on_even_if_pending_still_matches(
    ) {
        // A narrower shape of the same race: active_pick has already moved
        // past A, but nothing has gotten around to clearing pending_overlay
        // yet. The take must still refuse — active_pick is the
        // authoritative claim, and a stale request must not be able to
        // resurrect a dead session's context just because the slower-to-
        // clear field has not caught up yet.
        let active_pick = Mutex::new(Some(6u64));
        let mut stale_ctx = overlay_ctx_with_backdrop(None);
        stale_ctx.session_id = 5;
        let pending_overlay = Mutex::new(Some(stale_ctx));
        let taken = take_pending_overlay_if_current(&active_pick, &pending_overlay, 5);
        assert!(taken.is_none());
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            Some(5),
            "a refused take must not even clear the stale context it declined to consume"
        );
    }

    // -----------------------------------------------------------------
    // C639-007C.7 freeze: AbandonableBridge (Retry hide timeout-vs-late-
    // closure race). These exercise the real synchronization primitive
    // with real threads standing in for "a main thread busy past the
    // waiter's bound" and "the waiter giving up" — no live Tauri app,
    // same discipline as every other test in this module, but genuine
    // concurrency rather than a pure function call, because the bug this
    // closes is a genuine race between two threads.
    // -----------------------------------------------------------------

    #[test]
    fn abandonable_bridge_delivers_the_result_when_settle_runs_in_time() {
        let bridge = Arc::new(AbandonableBridge::<u32>::new());
        let bridge_for_main = bridge.clone();
        let calls = Arc::new(Mutex::new(0u32));
        let calls_for_main = calls.clone();
        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    *calls_for_main.lock().unwrap() += 1;
                    42
                },
                |_| panic!("must not compensate when the waiter is still listening"),
            );
        });
        let got = bridge
            .wait_or_abandon(Duration::from_secs(5))
            .expect("settle ran well within the bound");
        main_thread.join().unwrap();
        assert_eq!(got, 42);
        assert_eq!(*calls.lock().unwrap(), 1);
    }

    #[test]
    fn abandonable_bridge_timeout_then_late_settle_never_runs_its_action() {
        // The exact failing interleaving from the verdict: dispatch A,
        // hold the main-thread closure past the waiter's bound, let the
        // waiter time out, THEN release the queued closure. The action
        // (which in production is the owner-check-then-hide) must never
        // run at all once the waiter has already given up — not run and
        // discarded, not run and compensated after the fact: never run.
        let bridge = Arc::new(AbandonableBridge::<u32>::new());
        let calls = Arc::new(Mutex::new(0u32));

        // Nothing ever calls settle() before the bound elapses — this
        // stands in for "the main thread is busy and hasn't serviced the
        // queued closure yet," which is the scenario the verdict names.
        let err = bridge
            .wait_or_abandon(Duration::from_millis(50))
            .expect_err("nothing settled in time; must be treated as abandoned");
        assert!(
            err.contains("abandoned"),
            "timeout must be reported as an abandonment, got: {err}"
        );

        // The queued closure is now released — it finally gets to run,
        // well after the waiter already left.
        let calls_for_late = calls.clone();
        bridge.settle(
            move || {
                *calls_for_late.lock().unwrap() += 1;
                7
            },
            |_| panic!("action never ran, so compensate must never run either"),
        );

        assert_eq!(
            *calls.lock().unwrap(),
            0,
            "a closure that runs after abandonment must never execute its action body \
             (no hide, no window lookup, nothing)"
        );
    }

    #[test]
    fn abandonable_bridge_protects_a_newer_generation_installed_after_abandonment() {
        // Freeze step 5: install B's window before releasing A's stale
        // (already-abandoned) closure, and prove A's closure never
        // touches it — not a hide, not a show, not a focus, not a close.
        // Modeled as a shared "currently labeled overlay window" the
        // action would look up and act on in production; the action
        // itself records every window it ever touched.
        let bridge = Arc::new(AbandonableBridge::<Result<(), String>>::new());
        let shared_window_label = Arc::new(Mutex::new("A"));
        let touched = Arc::new(Mutex::new(Vec::<&'static str>::new()));

        // A's waiter gives up — the main thread never got around to A's
        // closure in time.
        let err = bridge
            .wait_or_abandon(Duration::from_millis(30))
            .expect_err("A's waiter must time out before B is ever installed");
        assert!(err.contains("abandoned"));

        // B is installed strictly after A's waiter already abandoned —
        // e.g. a newer generation's window-build closure running on the
        // same single main-thread event loop.
        *shared_window_label.lock().unwrap() = "B";

        // A's queued closure finally runs now. Production shape: look up
        // whatever is currently labeled "overlay" and hide/show/focus/
        // close it. This must be a complete no-op given the bridge is
        // already abandoned.
        let touched_for_action = touched.clone();
        let label_for_action = shared_window_label.clone();
        bridge.settle(
            move || {
                touched_for_action
                    .lock()
                    .unwrap()
                    .push(*label_for_action.lock().unwrap());
                Ok(())
            },
            |_| panic!("action never ran, so compensate must never run either"),
        );

        assert!(
            touched.lock().unwrap().is_empty(),
            "an abandoned A closure must never touch the currently-labeled window, \
             even after a newer generation (B) has taken it over"
        );
        assert_eq!(
            *shared_window_label.lock().unwrap(),
            "B",
            "B's label must be completely untouched by A's abandoned closure"
        );
    }

    #[test]
    fn abandonable_bridge_boundary_commit_right_at_the_deadline_is_still_delivered() {
        // "Account for the boundary where the closure hides successfully
        // just before five seconds but the receiver times out before
        // consuming the result" — settle() runs concurrently with the
        // wait, close enough to the bound that a naive channel-timeout
        // implementation could plausibly race it. wait_or_abandon must
        // still deliver the real result rather than reporting a spurious
        // abandonment, because it re-checks the authoritative state under
        // the same lock the action commits through, not a separate flag.
        let bridge = Arc::new(AbandonableBridge::<u32>::new());
        let bridge_for_main = bridge.clone();
        let main_thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(40));
            bridge_for_main.settle(
                || 99,
                |_| panic!("a commit that lands before the bound must not be compensated"),
            );
        });
        let got = bridge
            .wait_or_abandon(Duration::from_millis(500))
            .expect("a commit that lands before the bound must be delivered, not abandoned");
        main_thread.join().unwrap();
        assert_eq!(got, 99);
    }

    #[test]
    fn abandonable_bridge_waiter_returns_on_time_even_while_action_is_still_running() {
        // C639-007C.8 freeze step 1: the defect itself. `settle` must not
        // hold the abandonment-state lock across `action` — otherwise a
        // blocked/native action (standing in for a stuck `hide()`) defeats
        // the waiter's own timeout entirely, since `wait_or_abandon` can
        // only return by reacquiring that same lock. A gate holds the
        // action open well past the waiter's bound; the waiter must still
        // return close to its own bound, not whenever the gate opens.
        let bridge = Arc::new(AbandonableBridge::<u32>::new());
        let bridge_for_main = bridge.clone();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let gate_for_action = gate.clone();
        let entered_running = Arc::new((Mutex::new(false), Condvar::new()));
        let entered_running_for_action = entered_running.clone();

        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    {
                        let (lock, cv) = &*entered_running_for_action;
                        *lock.lock().unwrap() = true;
                        cv.notify_all();
                    }
                    // Stands in for a native hide() call that hangs well
                    // past the waiter's own bound.
                    let (lock, cv) = &*gate_for_action;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cv.wait(released).unwrap();
                    }
                    7
                },
                |_| {},
            );
        });

        // Don't start the timer until `action` has actually entered
        // Running and is blocked on the gate, so the timeout genuinely
        // elapses mid-action rather than before it even started.
        {
            let (lock, cv) = &*entered_running;
            let mut started = lock.lock().unwrap();
            while !*started {
                started = cv.wait(started).unwrap();
            }
        }

        let start = std::time::Instant::now();
        let err = bridge
            .wait_or_abandon(Duration::from_millis(100))
            .expect_err("action is blocked indefinitely; must be treated as abandoned");
        let elapsed = start.elapsed();
        assert!(err.contains("abandoned"));
        assert!(
            elapsed < Duration::from_secs(2),
            "the waiter must return close to its own bound, never wait for the blocked \
             action to finish; took {elapsed:?}"
        );

        // Release the action so the thread can finish (and compensate,
        // exercised by its own test below) — join so nothing leaks.
        {
            let (lock, cv) = &*gate;
            *lock.lock().unwrap() = true;
            cv.notify_all();
        }
        main_thread.join().unwrap();
    }

    #[test]
    fn abandonable_bridge_compensates_a_late_commit_after_abandonment() {
        // Freeze step 2: once the waiter has abandoned, an action that
        // nonetheless goes on to commit its side effect (a late-arriving
        // hide succeeding well after the bound) must be compensated — not
        // silently committed with nobody left to undo it, which is the
        // exact strand this bridge exists to prevent.
        let bridge = Arc::new(AbandonableBridge::<u32>::new());
        let bridge_for_main = bridge.clone();
        let window_hidden = Arc::new(Mutex::new(false));
        let window_hidden_for_action = window_hidden.clone();
        let window_hidden_for_compensate = window_hidden.clone();
        let compensated = Arc::new(Mutex::new(false));
        let compensated_for_compensate = compensated.clone();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let gate_for_action = gate.clone();

        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    let (lock, cv) = &*gate_for_action;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cv.wait(released).unwrap();
                    }
                    // Stands in for the native hide() finally succeeding,
                    // well after the waiter already gave up.
                    *window_hidden_for_action.lock().unwrap() = true;
                    99
                },
                move |_result| {
                    // Compensate: undo the side effect action already
                    // committed, since nobody is left to show it back.
                    *window_hidden_for_compensate.lock().unwrap() = false;
                    *compensated_for_compensate.lock().unwrap() = true;
                },
            );
        });

        let err = bridge
            .wait_or_abandon(Duration::from_millis(30))
            .expect_err("nothing settled in time; must be treated as abandoned");
        assert!(err.contains("abandoned"));

        // Release the gate now that abandonment has already committed —
        // the action proceeds to "hide" and must then be compensated.
        {
            let (lock, cv) = &*gate;
            *lock.lock().unwrap() = true;
            cv.notify_all();
        }
        main_thread.join().unwrap();

        assert!(
            *compensated.lock().unwrap(),
            "a result committed after abandonment must trigger compensate()"
        );
        assert!(
            !*window_hidden.lock().unwrap(),
            "the late hide must be undone by compensate, leaving the window shown"
        );
    }

    #[test]
    fn abandonable_bridge_compensate_acts_only_on_the_captured_result_never_a_newer_label() {
        // Freeze step 3: install B strictly before releasing A's held
        // action, and prove compensate acts only on the exact window
        // `action` already resolved and returned — never a fresh lookup
        // of whatever is currently labeled, which by now would resolve to
        // B. `touched` records every window the action AND compensate
        // ever act on; it must contain only "A", twice.
        let bridge = Arc::new(AbandonableBridge::<Result<&'static str, String>>::new());
        let bridge_for_main = bridge.clone();
        let shared_window_label = Arc::new(Mutex::new("A"));
        let shared_window_label_for_action = shared_window_label.clone();
        let touched = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let touched_for_action = touched.clone();
        let touched_for_compensate = touched.clone();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let gate_for_action = gate.clone();

        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    // Resolve once, as the real recheck+lookup+hide
                    // closure does, and reuse the captured value — never
                    // look the label up again.
                    let resolved = *shared_window_label_for_action.lock().unwrap();
                    touched_for_action.lock().unwrap().push(resolved);
                    let (lock, cv) = &*gate_for_action;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cv.wait(released).unwrap();
                    }
                    Ok(resolved)
                },
                move |result| {
                    if let Ok(resolved) = result {
                        touched_for_compensate.lock().unwrap().push(resolved);
                    }
                },
            );
        });

        let err = bridge
            .wait_or_abandon(Duration::from_millis(30))
            .expect_err("A's waiter must time out before B is ever installed");
        assert!(err.contains("abandoned"));

        // B takes over the shared label strictly after A abandoned, while
        // A's action is still blocked on the gate.
        *shared_window_label.lock().unwrap() = "B";

        {
            let (lock, cv) = &*gate;
            *lock.lock().unwrap() = true;
            cv.notify_all();
        }
        main_thread.join().unwrap();

        assert_eq!(
            *touched.lock().unwrap(),
            vec!["A", "A"],
            "both action and compensate must only ever touch A's captured handle — \
             never re-read the shared label after B has taken it over"
        );
    }

    // -----------------------------------------------------------------
    // C639-007C.9: a late-committing compensate must revalidate the full
    // three-way session binding (`overlay_request_session_still_current`)
    // before resurrecting A's window — resolving a real handle in `action`
    // is not proof A is still live, since cancellation and a newer
    // session's admission run from their own command/background threads
    // and can both land, and fully complete, while this closure sits
    // blocked inside A's native `hide()`.
    // -----------------------------------------------------------------

    #[test]
    fn abandonable_bridge_compensate_never_reshows_a_cancelled_and_superseded_a() {
        // Freeze: A's Retry hide blocks past the waiter's deadline, the
        // waiter abandons, and — strictly before A's gated action is
        // released — the user cancels A (the exact state transitions
        // `cancel_region_pick`/`close_owned_overlay_window` perform) and B
        // is admitted, installing its own active_pick/pending_overlay/
        // overlay_window_owner. A's `hide()` then finally returns `Ok`.
        // Compensate must close only A's captured handle and must never
        // show/focus it, and must leave every one of B's three slots
        // byte-for-byte unchanged.
        let active_pick = Arc::new(Mutex::new(Some(5u64)));
        let pending_overlay = Arc::new(Mutex::new(Some({
            let mut ctx = overlay_ctx_with_backdrop(None);
            ctx.session_id = 5;
            ctx
        })));
        let overlay_window_owner = Arc::new(Mutex::new(Some(5u64)));

        let owner_for_action = overlay_window_owner.clone();
        let active_pick_for_compensate = active_pick.clone();
        let pending_overlay_for_compensate = pending_overlay.clone();
        let owner_for_compensate = overlay_window_owner.clone();

        let touched = Arc::new(Mutex::new(Vec::<(&'static str, &'static str)>::new()));
        let touched_for_action = touched.clone();
        let touched_for_compensate = touched.clone();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let gate_for_action = gate.clone();

        let bridge = Arc::new(AbandonableBridge::<Result<&'static str, String>>::new());
        let bridge_for_main = bridge.clone();

        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    // Mirrors the real action's own pre-hide ownership
                    // check: at the moment this starts, A is still owner —
                    // cancellation/B's admission only happen while this is
                    // blocked below, standing in for the native hide().
                    assert_eq!(*owner_for_action.lock().unwrap(), Some(5));
                    touched_for_action.lock().unwrap().push(("action", "A"));
                    let (lock, cv) = &*gate_for_action;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cv.wait(released).unwrap();
                    }
                    Ok("A")
                },
                move |result| {
                    let Ok(resolved) = result else { return };
                    let still_current = overlay_request_session_still_current(
                        &active_pick_for_compensate,
                        &pending_overlay_for_compensate,
                        &owner_for_compensate,
                        5,
                    );
                    if !still_current {
                        touched_for_compensate
                            .lock()
                            .unwrap()
                            .push(("close", resolved));
                        return;
                    }
                    touched_for_compensate
                        .lock()
                        .unwrap()
                        .push(("show", resolved));
                },
            );
        });

        let err = bridge
            .wait_or_abandon(Duration::from_millis(30))
            .expect_err("A's waiter must time out before cancellation/B's admission land");
        assert!(err.contains("abandoned"));

        // Cancel A — `clear_pick_if_current` plus the owner-gated retire
        // `close_owned_overlay_window` performs — then admit B, installing
        // all three of its own slots. All strictly before A's gate opens.
        clear_pick_if_current(&active_pick, &pending_overlay, 5);
        {
            let mut owner = overlay_window_owner.lock().unwrap();
            if owns_overlay_window(*owner, 5) {
                *owner = None;
            }
        }
        *active_pick.lock().unwrap() = Some(6);
        let mut b_ctx = overlay_ctx_with_backdrop(None);
        b_ctx.session_id = 6;
        *pending_overlay.lock().unwrap() = Some(b_ctx);
        *overlay_window_owner.lock().unwrap() = Some(6);

        {
            let (lock, cv) = &*gate;
            *lock.lock().unwrap() = true;
            cv.notify_all();
        }
        main_thread.join().unwrap();

        assert_eq!(
            *touched.lock().unwrap(),
            vec![("action", "A"), ("close", "A")],
            "compensate must close A's own captured handle and must never show/focus \
             it once A has been cancelled and superseded"
        );
        assert_eq!(
            *active_pick.lock().unwrap(),
            Some(6),
            "B's active_pick must be byte-for-byte unchanged"
        );
        assert_eq!(
            pending_overlay.lock().unwrap().as_ref().map(|c| c.session_id),
            Some(6),
            "B's pending_overlay must be byte-for-byte unchanged"
        );
        assert_eq!(
            *overlay_window_owner.lock().unwrap(),
            Some(6),
            "B's overlay_window_owner must be byte-for-byte unchanged"
        );
    }

    #[test]
    fn abandonable_bridge_compensate_reshows_the_live_a_handle_when_a_remains_current() {
        // Complementary case: nobody cancels A and no newer session is
        // admitted. When the late hide finally returns, A is still the
        // live claim across all three slots, so compensate must show (and
        // focus) the exact captured A handle back.
        let active_pick = Arc::new(Mutex::new(Some(5u64)));
        let pending_overlay = Arc::new(Mutex::new(Some({
            let mut ctx = overlay_ctx_with_backdrop(None);
            ctx.session_id = 5;
            ctx
        })));
        let overlay_window_owner = Arc::new(Mutex::new(Some(5u64)));

        let active_pick_for_compensate = active_pick.clone();
        let pending_overlay_for_compensate = pending_overlay.clone();
        let owner_for_compensate = overlay_window_owner.clone();

        let touched = Arc::new(Mutex::new(Vec::<(&'static str, &'static str)>::new()));
        let touched_for_action = touched.clone();
        let touched_for_compensate = touched.clone();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let gate_for_action = gate.clone();

        let bridge = Arc::new(AbandonableBridge::<Result<&'static str, String>>::new());
        let bridge_for_main = bridge.clone();

        let main_thread = std::thread::spawn(move || {
            bridge_for_main.settle(
                move || {
                    touched_for_action.lock().unwrap().push(("action", "A"));
                    let (lock, cv) = &*gate_for_action;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cv.wait(released).unwrap();
                    }
                    Ok("A")
                },
                move |result| {
                    let Ok(resolved) = result else { return };
                    let still_current = overlay_request_session_still_current(
                        &active_pick_for_compensate,
                        &pending_overlay_for_compensate,
                        &owner_for_compensate,
                        5,
                    );
                    if !still_current {
                        touched_for_compensate
                            .lock()
                            .unwrap()
                            .push(("close", resolved));
                        return;
                    }
                    touched_for_compensate
                        .lock()
                        .unwrap()
                        .push(("show", resolved));
                },
            );
        });

        let err = bridge
            .wait_or_abandon(Duration::from_millis(30))
            .expect_err("nothing settled before the bound; must be treated as abandoned");
        assert!(err.contains("abandoned"));

        // A remains current: nothing cancels it, nothing supersedes it.
        {
            let (lock, cv) = &*gate;
            *lock.lock().unwrap() = true;
            cv.notify_all();
        }
        main_thread.join().unwrap();

        assert_eq!(
            *touched.lock().unwrap(),
            vec![("action", "A"), ("show", "A")],
            "compensate must show the exact live A handle back when A is still current"
        );
    }

    #[test]
    fn abandonable_bridge_true_boundary_race_resolves_without_hanging_or_double_running() {
        // Freeze step 4: a true deadline-boundary test, synchronized with
        // a barrier rather than a sleep duration picked to land inside a
        // timeout window. Both threads reach the starting line together,
        // so which one wins the race to settle vs. time out is a genuine
        // OS-scheduler race, not a baked-in assumption. Either outcome is
        // acceptable; what must never happen is a hang, a panic, or the
        // action running more than once — run repeatedly to stress both
        // outcomes across iterations.
        for _ in 0..50 {
            let bridge = Arc::new(AbandonableBridge::<u32>::new());
            let bridge_for_main = bridge.clone();
            let calls = Arc::new(Mutex::new(0u32));
            let calls_for_main = calls.clone();
            let barrier = Arc::new(std::sync::Barrier::new(2));
            let barrier_for_main = barrier.clone();

            let main_thread = std::thread::spawn(move || {
                barrier_for_main.wait();
                bridge_for_main.settle(
                    move || {
                        *calls_for_main.lock().unwrap() += 1;
                        99
                    },
                    |_| {},
                );
            });

            barrier.wait();
            let result = bridge.wait_or_abandon(Duration::from_micros(1));
            main_thread.join().unwrap();

            assert_eq!(
                *calls.lock().unwrap(),
                1,
                "the action must run exactly once regardless of which side of the race won"
            );
            match result {
                Ok(v) => assert_eq!(v, 99),
                Err(e) => assert!(e.contains("abandoned")),
            }
        }
    }
}

#[cfg(test)]
mod annotations_commands_tests {
    //! `atomic_write` and `annotations_sidecar_path` are plain path/fs
    //! helpers, tested directly. `load_annotations`/`save_annotations` are
    //! `#[tauri::command]` functions, but neither takes `State`/`AppHandle`,
    //! so they are ALSO plain functions callable directly in a test, against
    //! real files on disk and a real encoded PNG (`forge_capture_core::png`)
    //! -- no running app or webview needed for this much. What genuinely
    //! does need the live app is the actual IPC round trip from JS; see
    //! docs/annotations.md for that gap.

    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

    fn tiny_png(width: u32, height: u32) -> Vec<u8> {
        let rgba = vec![0u8; (width * height * 4) as usize];
        forge_capture_core::png::encode_rgba(width, height, &rgba).unwrap()
    }

    // Each test gets its own subdirectory under the OS temp dir, so
    // concurrent `cargo test` runs (and repeated runs leaving stale
    // directories) can never collide or interfere with each other.
    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);
    fn temp_test_dir(label: &str) -> std::path::PathBuf {
        let n = NEXT_TEST_DIR.fetch_add(1, AtomicOrdering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "forge-capture-annotations-test-{label}-{}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sidecar_path_sits_next_to_the_png_with_the_annotations_extension() {
        let png = std::path::PathBuf::from("/captures/cap-123.png");
        assert_eq!(
            annotations_sidecar_path(&png),
            std::path::PathBuf::from("/captures/cap-123.annotations.json")
        );
    }

    #[test]
    fn atomic_write_round_trips_content_and_leaves_no_temp_file() {
        let dir = temp_test_dir("round-trip");
        let path = dir.join("x.annotations.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "atomic_write left a temp file behind: {leftovers:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_overwrites_existing_content_cleanly() {
        let dir = temp_test_dir("overwrite");
        let path = dir.join("x.annotations.json");
        atomic_write(&path, b"version one").unwrap();
        atomic_write(&path, b"version two, longer than the first").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "version two, longer than the first"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_fails_clearly_when_the_directory_does_not_exist() {
        let path = std::path::PathBuf::from("/this/does/not/exist/x.annotations.json");
        assert!(atomic_write(&path, b"x").is_err());
    }

    #[test]
    fn load_annotations_accepts_a_sidecar_whose_canvas_matches_the_real_png() {
        let dir = temp_test_dir("load-canvas-ok");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let sidecar = AnnotationsSidecar::new(hash, annotations::Canvas { w: 10, h: 10 });
        let json = sidecar.to_json().unwrap();
        atomic_write(&annotations_sidecar_path(&png_path), json.as_bytes()).unwrap();

        let dto = load_annotations(png_path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(dto.binding, "fresh");
        assert_eq!((dto.sidecar.canvas.w, dto.sidecar.canvas.h), (10, 10));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_annotations_rejects_a_sidecar_whose_canvas_does_not_match_the_real_png_even_with_a_correct_hash(
    ) {
        // Slice 1 review finding: a correct source hash does not prove `canvas` is honest.
        let dir = temp_test_dir("load-canvas-mismatch");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes); // correct hash for the real 10x10 PNG
        let sidecar = AnnotationsSidecar::new(hash, annotations::Canvas { w: 9999, h: 9999 }); // false canvas
        let json = sidecar.to_json().unwrap();
        atomic_write(&annotations_sidecar_path(&png_path), json.as_bytes()).unwrap();

        let result = load_annotations(png_path.to_string_lossy().into_owned());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("does not match"),
            "expected a canvas-mismatch error, got: {msg}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_annotations_rejects_a_sidecar_whose_canvas_does_not_match_the_real_png_and_writes_nothing(
    ) {
        let dir = temp_test_dir("save-canvas-mismatch");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let sidecar_json = AnnotationsSidecar::new(hash, annotations::Canvas { w: 9999, h: 9999 })
            .to_json()
            .unwrap();

        let result = save_annotations(png_path.to_string_lossy().into_owned(), sidecar_json);
        assert!(result.unwrap_err().contains("does not match"));
        assert!(
            !annotations_sidecar_path(&png_path).exists(),
            "a rejected sidecar must never be written to disk"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_annotations_accepts_and_persists_a_sidecar_whose_canvas_matches() {
        let dir = temp_test_dir("save-canvas-ok");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let sidecar_json = AnnotationsSidecar::new(hash, annotations::Canvas { w: 10, h: 10 })
            .to_json()
            .unwrap();

        save_annotations(png_path.to_string_lossy().into_owned(), sidecar_json.clone()).unwrap();
        let on_disk = std::fs::read_to_string(annotations_sidecar_path(&png_path)).unwrap();
        assert_eq!(on_disk, sidecar_json);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_annotations_rejects_schema_version_zero_at_the_command_boundary_too() {
        let dir = temp_test_dir("save-schema-zero");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let bad_json = format!(
            r#"{{"schemaVersion":0,"kind":"annotations","sourceSha256":"{hash}","canvas":{{"w":10,"h":10}},"items":[]}}"#
        );

        let result = save_annotations(png_path.to_string_lossy().into_owned(), bad_json);
        assert!(result.is_err());
        assert!(!annotations_sidecar_path(&png_path).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    // ---- export_redacted (Slice 2) ----
    //
    // Rewritten per the Slice 2 review: this command re-reads the source itself, validates the
    // sidecar's canvas and source SHA against those real bytes (never a caller's claim), and
    // performs the destructive overwrite itself -- so these tests exercise exactly that, not a
    // trust relationship with whatever JS happened to send.

    fn redact_sidecar_json(hash: &str, w: u32, h: u32, geometry: (i64, i64, i64, i64)) -> String {
        let (x, y, gw, gh) = geometry;
        format!(
            r#"{{"schemaVersion":1,"kind":"annotations","sourceSha256":"{hash}","canvas":{{"w":{w},"h":{h}}},"items":[{{"id":"r1","kind":"redact","geometry":{{"x":{x},"y":{y},"w":{gw},"h":{gh}}}}}]}}"#
        )
    }

    /// An "ordinary flattened" RGBA buffer, filled with a non-black, non-zero value everywhere --
    /// standing in for real captured content. Deliberately NOT pre-redacted: these tests exist to
    /// prove Rust does that, not to assume JS already did.
    fn unredacted_rgba(w: u32, h: u32) -> Vec<u8> {
        (0..(w * h * 4) as usize).map(|i| if i % 4 == 3 { 255 } else { 200 }).collect()
    }

    fn unredacted_rgba_b64(w: u32, h: u32) -> String {
        base64_encode(&unredacted_rgba(w, h))
    }

    #[test]
    fn export_redacted_rejects_a_sidecar_with_no_redact_regions() {
        let dir = temp_test_dir("export-no-redact");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let no_redact = AnnotationsSidecar::new(hash, annotations::Canvas { w: 10, h: 10 })
            .to_json()
            .unwrap();

        let result = export_redacted(
            png_path.to_string_lossy().into_owned(),
            no_redact,
            unredacted_rgba_b64(10, 10),
        );
        assert!(result.unwrap_err().contains("nothing to export"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_rejects_a_sidecar_canvas_that_does_not_match_the_real_png_even_with_a_correct_hash(
    ) {
        // The security property this slice exists for: a correct source hash does not prove
        // `canvas` is honest, and there is no width/height parameter a caller could use to
        // override the real, re-decoded dimensions either.
        let dir = temp_test_dir("export-canvas-mismatch");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes); // correct hash for the real 10x10 PNG
        let json = redact_sidecar_json(&hash, 99, 99, (1, 1, 2, 2)); // false canvas
        // The canvas check runs (and fails) before the buffer is ever examined, so an arbitrary
        // small buffer is enough here -- no need to build one matching the false 99x99 claim.

        let result = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            unredacted_rgba_b64(1, 1),
        );
        assert!(result.unwrap_err().contains("does not match"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_rejects_a_stale_sidecar_whose_hash_does_not_match_the_current_source() {
        let dir = temp_test_dir("export-stale");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(10, 10)).unwrap();
        // The hash is for DIFFERENT bytes than what is actually on disk at png_path.
        let stale_hash = annotations::source_sha256_hex(b"not the real source bytes");
        let json = redact_sidecar_json(&stale_hash, 10, 10, (1, 1, 2, 2));

        let result = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            unredacted_rgba_b64(10, 10),
        );
        assert!(result.unwrap_err().contains("does not match the current PNG bytes"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_rejects_a_pixel_buffer_of_the_wrong_length() {
        let dir = temp_test_dir("export-bad-buffer");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let json = redact_sidecar_json(&hash, 10, 10, (1, 1, 2, 2));

        let result = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            base64_encode(&[0u8; 10]), // nowhere near 10*10*4 bytes
        );
        assert!(result.unwrap_err().contains("bytes, expected"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_sanitizes_hostile_unredacted_pixels_regardless_of_what_the_caller_sent() {
        // The core security regression: the incoming buffer is NOT pre-redacted (every pixel is
        // 200,200,200,255 -- standing in for a hostile or simply buggy caller that never actually
        // redacted anything). Rust must still produce a genuinely black, opaque redact region in
        // the OUTPUT FILE -- inspected here by decoding the file this command just wrote, not by
        // inspecting the in-memory buffer this test built, so the assertion is about what actually
        // landed on disk.
        let dir = temp_test_dir("export-hostile");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let json = redact_sidecar_json(&hash, 10, 10, (2, 3, 4, 4)); // redact rect: x2 y3 w4 h4

        let out_path = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            unredacted_rgba_b64(10, 10),
        )
        .unwrap();

        let (w, _h, rgba) = decode_own(&std::fs::read(&out_path).unwrap()).unwrap();
        let pixel = |x: u32, y: u32| {
            let i = ((y * w + x) * 4) as usize;
            (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])
        };
        // Every pixel inside the declared redact rectangle (x:2..6, y:3..7) is the fixed
        // sanitizing value, not the hostile 200,200,200,255 the caller sent.
        for y in 3..7 {
            for x in 2..6 {
                assert_eq!(pixel(x, y), annotations::REDACTION_PIXEL, "at ({x}, {y})");
            }
        }
        // Just outside the rectangle, the caller's original (unredacted) content survives --
        // proves this is a targeted overwrite of the declared region, not e.g. the whole image.
        assert_eq!(pixel(0, 0), (200, 200, 200, 255));
        assert_eq!(pixel(9, 9), (200, 200, 200, 255));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_writes_a_new_file_and_never_touches_the_source_or_its_sidecar() {
        let dir = temp_test_dir("export-ok");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let sidecar_path = annotations_sidecar_path(&png_path);
        let hash = annotations::source_sha256_hex(&png_bytes);
        let json = redact_sidecar_json(&hash, 10, 10, (1, 1, 2, 2));
        atomic_write(&sidecar_path, json.as_bytes()).unwrap();
        let sidecar_before = std::fs::read(&sidecar_path).unwrap();
        let source_before = std::fs::read(&png_path).unwrap();

        let out_path = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            unredacted_rgba_b64(10, 10),
        )
        .unwrap();

        assert_eq!(out_path, dir.join("a-redacted.png").to_string_lossy());
        assert!(std::path::Path::new(&out_path).exists());
        // Decoding the file we just wrote proves it is a real, valid PNG at the right size, not
        // just arbitrary bytes under a .png name.
        let (w, h) = png_dimensions(&std::fs::read(&out_path).unwrap()).unwrap();
        assert_eq!((w, h), (10, 10));
        // Neither the source PNG nor its editable sidecar was touched.
        assert_eq!(std::fs::read(&png_path).unwrap(), source_before);
        assert_eq!(std::fs::read(&sidecar_path).unwrap(), sidecar_before);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_redacted_versions_the_output_stem_rather_than_overwriting_a_previous_export() {
        let dir = temp_test_dir("export-versioned");
        let png_bytes = tiny_png(10, 10);
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, &png_bytes).unwrap();
        let hash = annotations::source_sha256_hex(&png_bytes);
        let json = redact_sidecar_json(&hash, 10, 10, (1, 1, 2, 2));

        let first = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json.clone(),
            unredacted_rgba_b64(10, 10),
        )
        .unwrap();
        let second = export_redacted(
            png_path.to_string_lossy().into_owned(),
            json,
            unredacted_rgba_b64(10, 10),
        )
        .unwrap();

        assert_eq!(first, dir.join("a-redacted.png").to_string_lossy());
        assert_eq!(second, dir.join("a-redacted-2.png").to_string_lossy());
        assert!(std::path::Path::new(&first).exists());
        assert!(std::path::Path::new(&second).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- Slice 4: load_capture_tags / save_capture_tags / rebuild_library_index --

    #[test]
    fn load_capture_tags_returns_empty_when_no_meta_file_exists() {
        let dir = temp_test_dir("tags-missing");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        let tags = load_capture_tags(png_path.to_string_lossy().into_owned()).unwrap();
        assert!(tags.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_then_load_capture_tags_round_trips() {
        let dir = temp_test_dir("tags-round-trip");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        save_capture_tags(
            png_path.to_string_lossy().into_owned(),
            vec!["safety".to_string(), "pump".to_string()],
        )
        .unwrap();
        let tags = load_capture_tags(png_path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(tags, vec!["safety".to_string(), "pump".to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_trims_each_tag_before_storing() {
        let dir = temp_test_dir("tags-trim");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        save_capture_tags(
            png_path.to_string_lossy().into_owned(),
            vec!["  safety  ".to_string()],
        )
        .unwrap();
        let tags = load_capture_tags(png_path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(tags, vec!["safety".to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_rejects_duplicate_tags_and_writes_nothing() {
        let dir = temp_test_dir("tags-dup");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        let result = save_capture_tags(
            png_path.to_string_lossy().into_owned(),
            vec!["safety".to_string(), "safety".to_string()],
        );
        assert!(result.is_err());
        assert!(!capture_meta_path(&png_path).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_rejects_an_empty_tag() {
        let dir = temp_test_dir("tags-empty");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        let result =
            save_capture_tags(png_path.to_string_lossy().into_owned(), vec![String::new()]);
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_rejects_an_overlong_tag() {
        let dir = temp_test_dir("tags-overlong");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        let result = save_capture_tags(
            png_path.to_string_lossy().into_owned(),
            vec!["x".repeat(capture_meta::MAX_TAG_CHARS + 1)],
        );
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_rejects_too_many_tags() {
        let dir = temp_test_dir("tags-too-many");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();

        let too_many: Vec<String> = (0..capture_meta::MAX_TAGS + 1)
            .map(|i| format!("t{i}"))
            .collect();
        let result = save_capture_tags(png_path.to_string_lossy().into_owned(), too_many);
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_capture_tags_refuses_when_the_png_does_not_exist() {
        let dir = temp_test_dir("tags-no-png");
        let png_path = dir.join("missing.png");

        let result = save_capture_tags(
            png_path.to_string_lossy().into_owned(),
            vec!["safety".to_string()],
        );
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_capture_tags_surfaces_a_corrupt_meta_file_as_an_error_rather_than_silently_empty() {
        let dir = temp_test_dir("tags-corrupt");
        let png_path = dir.join("a.png");
        std::fs::write(&png_path, tiny_png(4, 4)).unwrap();
        std::fs::write(capture_meta_path(&png_path), b"not json").unwrap();

        let result = load_capture_tags(png_path.to_string_lossy().into_owned());
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    fn write_forge_json(dir: &std::path::Path, stem: &str, title: Option<&str>) {
        let body = match title {
            Some(t) => format!(r#"{{"window":{{"title":{t:?}}}}}"#),
            None => "{}".to_string(),
        };
        std::fs::write(dir.join(format!("{stem}.forge.json")), body).unwrap();
    }

    fn write_capture_meta(dir: &std::path::Path, stem: &str, tags: &[&str]) {
        let mut meta = CaptureMeta::new();
        meta.tags = tags.iter().map(|t| t.to_string()).collect();
        std::fs::write(
            dir.join(format!("{stem}.meta.json")),
            meta.to_json().unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn rebuild_library_index_projects_tags_from_each_captures_durable_meta_file() {
        let dir = temp_test_dir("index-tags");
        write_forge_json(&dir, "a", None);
        write_capture_meta(&dir, "a", &["safety", "pump"]);

        let index_path = rebuild_library_index_in(&dir, false).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();

        assert_eq!(index.entries.len(), 1);
        assert_eq!(index.entries[0].stem, "a");
        assert_eq!(
            index.entries[0].tags,
            vec!["safety".to_string(), "pump".to_string()]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_never_includes_titles_when_title_indexing_is_disabled() {
        let dir = temp_test_dir("index-titles-off");
        write_forge_json(&dir, "a", Some("Save dialog"));

        let index_path = rebuild_library_index_in(&dir, false).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        assert!(!json.contains("Save dialog"));
        assert!(!json.contains("\"title\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_includes_titles_when_present_and_enabled() {
        let dir = temp_test_dir("index-titles-on");
        write_forge_json(&dir, "a", Some("Save dialog"));

        let index_path = rebuild_library_index_in(&dir, true).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();
        assert_eq!(index.entries[0].title, Some("Save dialog".to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_omits_title_when_enabled_but_the_capture_has_none() {
        let dir = temp_test_dir("index-titles-absent");
        write_forge_json(&dir, "a", None);

        let index_path = rebuild_library_index_in(&dir, true).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();
        assert_eq!(index.entries[0].title, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_treats_a_corrupt_meta_file_as_no_tags_without_failing_the_rebuild() {
        let dir = temp_test_dir("index-corrupt-meta");
        write_forge_json(&dir, "a", None);
        std::fs::write(dir.join("a.meta.json"), b"not json").unwrap();
        write_forge_json(&dir, "b", None);
        write_capture_meta(&dir, "b", &["ok"]);

        let index_path = rebuild_library_index_in(&dir, false).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();

        assert_eq!(index.entries.len(), 2);
        let a = index.entries.iter().find(|e| e.stem == "a").unwrap();
        assert!(a.tags.is_empty());
        let b = index.entries.iter().find(|e| e.stem == "b").unwrap();
        assert_eq!(b.tags, vec!["ok".to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_is_deterministic_and_sorted_by_stem_regardless_of_scan_order() {
        let dir = temp_test_dir("index-sorted");
        write_forge_json(&dir, "zebra", None);
        write_forge_json(&dir, "apple", None);
        write_forge_json(&dir, "mango", None);

        let index_path = rebuild_library_index_in(&dir, false).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();

        assert_eq!(
            index
                .entries
                .iter()
                .map(|e| e.stem.as_str())
                .collect::<Vec<_>>(),
            vec!["apple", "mango", "zebra"]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebuild_library_index_ignores_files_that_are_not_forge_json_sidecars() {
        let dir = temp_test_dir("index-ignore-others");
        write_forge_json(&dir, "a", None);
        std::fs::write(dir.join("a.png"), tiny_png(2, 2)).unwrap();
        std::fs::write(dir.join("a.annotations.json"), b"{}").unwrap();
        std::fs::write(dir.join("stray.txt"), b"not a capture").unwrap();

        let index_path = rebuild_library_index_in(&dir, false).unwrap();
        let json = std::fs::read_to_string(&index_path).unwrap();
        let index: forge_capture_core::library_index::LibraryIndex =
            serde_json::from_str(&json).unwrap();

        assert_eq!(index.entries.len(), 1);
        assert_eq!(index.entries[0].stem, "a");
        std::fs::remove_dir_all(&dir).ok();
    }
}
