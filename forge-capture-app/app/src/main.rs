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
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use forge_capture_core::coords::{Monitor, Rect};
use forge_capture_core::engines::{
    AcquisitionEngine, CaptureMode, CaptureRequest, NativeRasterEngine,
};
use forge_capture_core::native;
use forge_capture_core::result::ScrollingResult;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

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

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Serialize, Clone)]
struct OverlayContextDto {
    origin_virtual: (i32, i32),
    dpr: f64,
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
            let dir = captures_dir()?;
            let stem = unique_stem(
                &state,
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
            let kind = artifact.kind.as_str().to_string();
            let width = artifact.raster_width;
            let height = artifact.raster_height;
            state.captures.lock().unwrap().insert(
                id.clone(),
                StoredCapture {
                    png_bytes: artifact.raster_bytes,
                    sidecar_json,
                },
            );
            let saved = ArtifactRefDto {
                id,
                kind,
                width,
                height,
                png_path: png_path.to_string_lossy().into_owned(),
                sidecar_path: sidecar_path.to_string_lossy().into_owned(),
            };
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
#[tauri::command]
fn begin_region_pick(
    monitor_id: String,
    delay_ms: Option<u64>,
    include_cursor: Option<bool>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let monitors = current_monitors()?;
    let monitor = monitors
        .iter()
        .find(|m| m.id == monitor_id)
        .ok_or_else(|| format!("unknown monitor id: {monitor_id}"))?;
    *state.pending_overlay.lock().unwrap() = Some(OverlayContext {
        origin_virtual: monitor.origin_virtual,
        dpr: monitor.scale,
        delay_ms: delay_ms.unwrap_or(0),
        include_cursor: include_cursor.unwrap_or(true),
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
        .manage(AppState {
            captures: Mutex::new(HashMap::new()),
            pending_overlay: Mutex::new(None),
            id_counter: Mutex::new(0),
            used_stems: Mutex::new(HashSet::new()),
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FORGE Capture");
}
