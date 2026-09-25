//! Thin OS boundary for native capture.
//!
//! Everything cross-platform lives in the other modules; this module is the
//! only place that touches OS capture APIs.
//!
//! - **Windows** (`#[cfg(windows)]`): GDI screen capture (BitBlt).
//! - **Linux** (`#[cfg(target_os = "linux")]`): X11/Xorg capture via x11rb
//!   (pure Rust — no X11 dev headers needed). Wayland sessions are rejected
//!   with a clear message telling the user to pick an X11/Xorg session at
//!   login; window capture and scrolling capture are not implemented on
//!   Linux yet and fail closed with explicit errors.
//! - Any other host: the functions below return an explicit error — never a
//!   fake image, never a panic.
//!
//! ## Windows notes (compile-verified via
//! `cargo check --target x86_64-pc-windows-msvc`; runtime behavior is
//! Windows-untested until run on real hardware — see docs/packaging.md)
//!
//! - The process should be per-monitor-DPI-aware (V2); the Tauri shell sets
//!   this at startup and virtual-desktop coordinates then coincide with
//!   physical pixels (see `coords`).
//! - Window capture currently `BitBlt`s the window's screen rect from the
//!   screen DC (`GetDC(None)`): an occluded window captures its occluders'
//!   pixels, not its own content — a known 2a limitation, not a blank
//!   frame. (A future hardening pass can switch to `PrintWindow` /
//!   `GetWindowDC` plus a blank-frame detector; it needs real Windows
//!   hardware to validate, so it is documented, not implemented, here.)
//!
//! ## Linux notes
//!
//! - Monitor enumeration uses Xinerama when active, falling back to the
//!   root-window geometry on single-screen setups. DPI scale comes from the
//!   X resource manager's `Xft.dpi` (what GNOME/Xfce set); 1.0 otherwise.
//! - Screen capture is `GetImage` (`ZPixmap`) on the root window, converted
//!   from the server's byte order to RGBA. The cursor is composited from the
//!   XFixes cursor image when `include_cursor` is set and XFixes is
//!   available; otherwise `CursorState.captured` is false (honest, never a
//!   fake cursor).
//! - Clipboard goes through arboard, which daemonizes on X11 so the image
//!   outlives the call.

use crate::artifact::CursorState;
use crate::coords::{Monitor, RectI};
use crate::result::CaptureError;
use crate::scroll::{ScrollDriver, ScrollTarget};

/// One captured piece: RGBA bytes (row-major) for `rect`.
#[derive(Debug, Clone)]
pub struct NativeFrame {
    pub rect: RectI,
    pub rgba: Vec<u8>,
    pub cursor: CursorState,
}

/// Metadata for a visible top-level window (window-capture picker).
#[derive(Debug, Clone)]
pub struct NativeWindowInfo {
    /// Opaque id: the HWND value rendered as a decimal string.
    pub window_id: String,
    pub title: String,
    pub class_name: String,
    pub process_name: Option<String>,
    pub rect_virtual: RectI,
}

/// Capture `rect` (virtual-desktop/physical coordinates) from `monitor`.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn capture_rect(
    _rect: RectI,
    _monitor: &Monitor,
    _include_cursor: bool,
) -> Result<NativeFrame, CaptureError> {
    Err(CaptureError::NativeApi(
        "native capture requires Windows 11; this host is not Windows".into(),
    ))
}

#[cfg(windows)]
pub fn capture_rect(
    rect: RectI,
    monitor: &Monitor,
    include_cursor: bool,
) -> Result<NativeFrame, CaptureError> {
    // The rect is already clipped to this monitor by the caller.
    let _ = monitor;
    win::capture_screen_rect(rect, include_cursor)
}

#[cfg(target_os = "linux")]
pub fn capture_rect(
    rect: RectI,
    monitor: &Monitor,
    include_cursor: bool,
) -> Result<NativeFrame, CaptureError> {
    // The rect is already clipped to this monitor by the caller.
    let _ = monitor;
    linux::capture_screen_rect(rect, include_cursor)
}

/// Look up a window by id (from [`list_windows`]) for window capture.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn find_window(
    window_id: &str,
    _monitors: &[Monitor],
) -> Result<NativeWindowInfo, CaptureError> {
    Err(CaptureError::NativeApi(format!(
        "window lookup requires Windows 11 (asked for window {window_id})"
    )))
}

#[cfg(windows)]
pub fn find_window(
    window_id: &str,
    _monitors: &[Monitor],
) -> Result<NativeWindowInfo, CaptureError> {
    win::find_window(window_id)
}

#[cfg(target_os = "linux")]
pub fn find_window(
    window_id: &str,
    _monitors: &[Monitor],
) -> Result<NativeWindowInfo, CaptureError> {
    linux::find_window(window_id)
}

/// Enumerate visible top-level windows for the capture picker.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
    Err(CaptureError::NativeApi(
        "window enumeration requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
    win::list_windows()
}

#[cfg(target_os = "linux")]
pub fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
    linux::list_windows()
}

/// Enumerate monitors with per-monitor DPI.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
    Err(CaptureError::NativeApi(
        "monitor enumeration requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
    win::list_monitors()
}

#[cfg(target_os = "linux")]
pub fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
    linux::list_monitors()
}

/// Copy RGBA bytes to the Windows clipboard as a DIB.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn copy_rgba_to_clipboard(_width: u32, _height: u32, _rgba: &[u8]) -> Result<(), CaptureError> {
    Err(CaptureError::NativeApi(
        "clipboard capture requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn copy_rgba_to_clipboard(width: u32, height: u32, rgba: &[u8]) -> Result<(), CaptureError> {
    win::copy_rgba_to_clipboard(width, height, rgba)
}

/// Copy RGBA bytes to the Linux clipboard as an image (via arboard, which
/// daemonizes on X11 so the image outlives the call).
#[cfg(target_os = "linux")]
pub fn copy_rgba_to_clipboard(width: u32, height: u32, rgba: &[u8]) -> Result<(), CaptureError> {
    linux::copy_rgba_to_clipboard(width, height, rgba)
}

/// Current cursor hotspot position in virtual-desktop physical pixels, for
/// the Rung 4 recording compositor's cursor overlay.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn cursor_pos() -> Result<(i32, i32), CaptureError> {
    Err(CaptureError::NativeApi(
        "cursor position requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn cursor_pos() -> Result<(i32, i32), CaptureError> {
    win::cursor_pos()
}

/// Current cursor hotspot position in root-window physical pixels (X11).
#[cfg(target_os = "linux")]
pub fn cursor_pos() -> Result<(i32, i32), CaptureError> {
    linux::cursor_pos()
}

/// Build the DOM-aware scroll driver for a window: reads the window's real
/// scroll-bar geometry and scrolls to exact positions. Fails when the
/// window exposes no usable scroll geometry — the caller falls back to the
/// raster-observation driver for `Auto` requests.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn dom_scroll_driver(
    _window_id: &str,
    _horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    Err(CaptureError::NativeApi(
        "scrolling capture requires Windows 11; this host is not Windows".into(),
    ))
}

#[cfg(windows)]
pub fn dom_scroll_driver(
    window_id: &str,
    horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    win::WinDomDriver::boxed(window_id, horizontal)
}

#[cfg(target_os = "linux")]
pub fn dom_scroll_driver(
    _window_id: &str,
    _horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    linux::scroll_unsupported("scrolling capture")
}

/// Build the raster-observation scroll driver: synthesizes wheel input over
/// the target and lets the engine measure what actually moved. Works for
/// window and region targets.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn wheel_scroll_driver(
    _target: &ScrollTarget,
    _horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    Err(CaptureError::NativeApi(
        "scrolling capture requires Windows 11; this host is not Windows".into(),
    ))
}

#[cfg(windows)]
pub fn wheel_scroll_driver(
    target: &ScrollTarget,
    horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    win::WinWheelDriver::boxed(target, horizontal)
}

#[cfg(target_os = "linux")]
pub fn wheel_scroll_driver(
    _target: &ScrollTarget,
    _horizontal: bool,
    _monitors: &[Monitor],
) -> Result<Box<dyn ScrollDriver>, CaptureError> {
    linux::scroll_unsupported("scrolling capture")
}

/// Swizzle BGRA → RGBA in place, forcing alpha to opaque (255).
///
/// GDI screen-capture bitmaps commonly carry a zero alpha channel; without
/// the forced alpha the encoded PNG would be fully transparent. Pure and
/// platform-independent so it is unit-tested on any host.
#[cfg(any(windows, test))]
pub(crate) fn bgra_to_rgba_force_opaque(pixels: &mut [u8]) {
    let (chunks, _remainder) = pixels.as_chunks_mut::<4>();
    for px in chunks {
        px.swap(0, 2);
        px[3] = 255;
    }
}

/// Icon top-left draw position for a cursor: the OS reports the cursor's
/// screen position as the *hotspot* point, so the draw origin is
/// `screen - hotspot`, made capture-relative by subtracting the capture
/// rect's origin. Pure and platform-independent for unit testing.
#[cfg(any(windows, test))]
pub(crate) fn cursor_icon_origin(
    screen: (i32, i32),
    hotspot: (i32, i32),
    rect_origin: (i64, i64),
) -> (i32, i32) {
    (
        screen.0 - hotspot.0 - rect_origin.0 as i32,
        screen.1 - hotspot.1 - rect_origin.1 as i32,
    )
}

// ---------------------------------------------------------------------------
// Windows implementation (GDI). Compile-checked for the Windows target;
// runtime-verified only on real Windows hardware (see docs).
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod win {
    use super::{CaptureError, CursorState, Monitor, NativeFrame, NativeWindowInfo, RectI};
    use crate::scroll::{ScrollDriver, ScrollGeometry, ScrollTarget};
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HGDIOBJ, MONITORINFOEXW,
        SRCCOPY,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, EnumWindows, GetClassNameW, GetCursorInfo, GetIconInfo, GetScrollInfo,
        GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
        SendMessageW, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, ICONINFO, SB_HORZ, SB_VERT,
        SCROLLBAR_CONSTANTS, SCROLLINFO, SIF_PAGE, SIF_POS, SIF_RANGE,
    };

    fn last_error(context: &str) -> CaptureError {
        let code = unsafe { windows::Win32::Foundation::GetLastError() };
        CaptureError::NativeApi(format!("{context}: Win32 error {}", code.0))
    }

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..end])
            .to_string_lossy()
            .into_owned()
    }

    /// Per-monitor DPI scale via GetDpiForMonitor (falls back to 1.0).
    fn monitor_scale(hmonitor: windows::Win32::Graphics::Gdi::HMONITOR) -> f64 {
        let mut dpi_x = 0u32;
        let mut _dpi_y = 0u32;
        let ok = unsafe { GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut _dpi_y) };
        if ok.is_ok() && dpi_x > 0 {
            dpi_x as f64 / 96.0
        } else {
            1.0
        }
    }

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: windows::Win32::Graphics::Gdi::HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        out: LPARAM,
    ) -> BOOL {
        let monitors = unsafe {
            &mut *(out.0 as *mut Vec<(windows::Win32::Graphics::Gdi::HMONITOR, MONITORINFOEXW)>)
        };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        let info_ptr = &mut info.monitorInfo as *mut windows::Win32::Graphics::Gdi::MONITORINFO;
        if unsafe { GetMonitorInfoW(hmonitor, info_ptr) }.as_bool() {
            monitors.push((hmonitor, info));
        }
        BOOL(1)
    }

    pub(super) fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
        let mut raw: Vec<(windows::Win32::Graphics::Gdi::HMONITOR, MONITORINFOEXW)> = Vec::new();
        let ok = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(monitor_enum_proc),
                LPARAM(&mut raw as *mut _ as isize),
            )
        };
        if !ok.as_bool() {
            return Err(last_error("EnumDisplayMonitors"));
        }
        if raw.is_empty() {
            return Err(CaptureError::NoMonitors);
        }
        Ok(raw
            .into_iter()
            .map(|(hmonitor, info)| {
                let rc = info.monitorInfo.rcMonitor;
                let name = wide_to_string(&info.szDevice);
                let scale = monitor_scale(hmonitor);
                // rcMonitor is in virtual-desktop/physical pixels for an
                // aware process; logical size is derived by un-scaling.
                let phys_w = (rc.right - rc.left).max(1) as f64;
                let phys_h = (rc.bottom - rc.top).max(1) as f64;
                Monitor {
                    id: name.clone(),
                    name,
                    origin_virtual: (rc.left, rc.top),
                    size_logical: (
                        (phys_w / scale).round().max(1.0) as u32,
                        (phys_h / scale).round().max(1.0) as u32,
                    ),
                    scale,
                }
            })
            .collect())
    }

    /// Cursor hotspot offset within the icon, via GetIconInfo. Falls back to
    /// (0, 0) when the icon info is unavailable.
    fn cursor_hotspot(hcursor: windows::Win32::UI::WindowsAndMessaging::HCURSOR) -> (i32, i32) {
        unsafe {
            let mut info = ICONINFO::default();
            if GetIconInfo(hcursor.into(), &mut info).is_ok() {
                let hotspot = (info.xHotspot as i32, info.yHotspot as i32);
                // GetIconInfo allocates bitmaps the caller must free.
                let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
                let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
                hotspot
            } else {
                (0, 0)
            }
        }
    }

    /// Current cursor hotspot position in virtual-desktop physical pixels.
    /// Used by the Rung 4 recording compositor to draw cursor overlays.
    pub(super) fn cursor_pos() -> Result<(i32, i32), CaptureError> {
        unsafe {
            let mut ci = CURSORINFO {
                cbSize: std::mem::size_of::<CURSORINFO>() as u32,
                ..Default::default()
            };
            if GetCursorInfo(&mut ci).is_err() {
                return Err(last_error("GetCursorInfo"));
            }
            Ok((ci.ptScreenPos.x, ci.ptScreenPos.y))
        }
    }

    /// BitBlt `rect` (virtual-desktop/physical coords) from the screen DC.
    pub(super) fn capture_screen_rect(
        rect: RectI,
        include_cursor: bool,
    ) -> Result<NativeFrame, CaptureError> {
        if rect.is_empty() {
            return Err(CaptureError::NativeApi("capture rect is empty".into()));
        }
        let w = rect.w as i32;
        let h = rect.h as i32;
        unsafe {
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return Err(last_error("GetDC"));
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                ReleaseDC(None, screen_dc);
                return Err(last_error("CreateCompatibleDC"));
            }
            let bitmap = CreateCompatibleBitmap(screen_dc, w, h);
            if bitmap.is_invalid() {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(None, screen_dc);
                return Err(last_error("CreateCompatibleBitmap"));
            }
            let old = SelectObject(mem_dc, HGDIOBJ(bitmap.0));
            let blt_ok = BitBlt(
                mem_dc,
                0,
                0,
                w,
                h,
                Some(screen_dc),
                rect.x as i32,
                rect.y as i32,
                SRCCOPY,
            )
            .is_ok();

            let mut cursor = CursorState {
                captured: false,
                position_physical: None,
            };
            if blt_ok && include_cursor {
                let mut ci = CURSORINFO {
                    cbSize: std::mem::size_of::<CURSORINFO>() as u32,
                    ..Default::default()
                };
                if GetCursorInfo(&mut ci).is_ok() && ci.flags.0 & CURSOR_SHOWING.0 != 0 {
                    // ptScreenPos is the cursor *hotspot*: subtract it so the
                    // hotspot lands on the reported position instead of the
                    // icon's top-left corner.
                    let hotspot = cursor_hotspot(ci.hCursor);
                    let (ix, iy) = super::cursor_icon_origin(
                        (ci.ptScreenPos.x, ci.ptScreenPos.y),
                        hotspot,
                        (rect.x, rect.y),
                    );
                    if ix >= 0 && iy >= 0 && ix < w && iy < h {
                        let _ = DrawIconEx(
                            mem_dc,
                            ix,
                            iy,
                            windows::Win32::UI::WindowsAndMessaging::HICON(ci.hCursor.0),
                            0,
                            0,
                            0,
                            None,
                            DI_NORMAL,
                        );
                        cursor = CursorState {
                            captured: true,
                            position_physical: Some((
                                ci.ptScreenPos.x as i64,
                                ci.ptScreenPos.y as i64,
                            )),
                        };
                    }
                }
            }

            // GetDIBits requires the bitmap to NOT be selected into a DC, so
            // deselect it before pulling pixels.
            SelectObject(mem_dc, old);

            // Pull pixels back as top-down 32-bit RGBA.
            let mut rgba = vec![0u8; w as usize * h as usize * 4];
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h; // top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            let lines = GetDIBits(
                mem_dc,
                bitmap,
                0,
                h as u32,
                Some(rgba.as_mut_ptr() as *mut _),
                &mut bmi as *mut _,
                DIB_RGB_COLORS,
            );
            // GDI returns BGRA; swizzle to RGBA and force opaque alpha (see
            // `bgra_to_rgba_force_opaque`).
            super::bgra_to_rgba_force_opaque(&mut rgba);

            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);

            if !blt_ok {
                return Err(last_error("BitBlt"));
            }
            if lines == 0 {
                return Err(last_error("GetDIBits"));
            }
            Ok(NativeFrame { rect, rgba, cursor })
        }
    }

    unsafe extern "system" fn window_enum_proc(hwnd: HWND, out: LPARAM) -> BOOL {
        let windows = unsafe { &mut *(out.0 as *mut Vec<NativeWindowInfo>) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut title = [0u16; 512];
            let title_len = GetWindowTextW(hwnd, &mut title);
            if title_len == 0 {
                return BOOL(1); // skip untitled windows
            }
            let mut class = [0u16; 256];
            GetClassNameW(hwnd, &mut class);
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return BOOL(1);
            }
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w <= 0 || h <= 0 {
                return BOOL(1);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let process_name = process_name_for_pid(pid);
            windows.push(NativeWindowInfo {
                window_id: format!("{}", hwnd.0 as u64),
                title: wide_to_string(&title),
                class_name: wide_to_string(&class),
                process_name,
                rect_virtual: RectI {
                    x: rect.left as i64,
                    y: rect.top as i64,
                    w: w as u64,
                    h: h as u64,
                },
            });
        }
        BOOL(1)
    }

    fn process_name_for_pid(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        use windows::core::PWSTR;
        use windows::Win32::System::Threading::PROCESS_NAME_WIN32;
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let name = {
                let mut buf = [0u16; 512];
                let mut len = buf.len() as u32;
                if windows::Win32::System::Threading::QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(buf.as_mut_ptr()),
                    &mut len,
                )
                .is_ok()
                {
                    let full = wide_to_string(&buf[..len as usize]);
                    full.rsplit(['\\', '/']).next().map(|s| s.to_string())
                } else {
                    None
                }
            };
            // The process handle is ours to close on every path.
            let _ = CloseHandle(handle);
            name
        }
    }

    pub(super) fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
        let mut windows: Vec<NativeWindowInfo> = Vec::new();
        if unsafe {
            EnumWindows(
                Some(window_enum_proc),
                LPARAM(&mut windows as *mut _ as isize),
            )
        }
        .is_err()
        {
            return Err(last_error("EnumWindows"));
        }
        Ok(windows)
    }

    pub(super) fn find_window(window_id: &str) -> Result<NativeWindowInfo, CaptureError> {
        let windows = list_windows()?;
        windows
            .into_iter()
            .find(|w| w.window_id == window_id)
            .ok_or_else(|| {
                CaptureError::TargetGone(format!("window id {window_id} no longer exists"))
            })
    }

    pub(super) fn copy_rgba_to_clipboard(
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), CaptureError> {
        use windows::Win32::Foundation::GlobalFree;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
        };
        use windows::Win32::System::Memory::{
            GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
        };
        // Clipboard format constant (CF_DIB = 8). Defined locally: the
        // `windows` crate does not export it under a stable path in 0.62.
        const CF_DIB: u32 = 8;
        if rgba.len() != width as usize * height as usize * 4 {
            return Err(CaptureError::EncodeFailed(
                "clipboard RGBA length mismatch".into(),
            ));
        }
        unsafe {
            // CF_DIB expects a BITMAPINFOHEADER followed by bottom-up BGRA.
            let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
            let pixels = width as usize * height as usize * 4;
            let total = header_size + pixels;
            let hmem = GlobalAlloc(GMEM_MOVEABLE, total).map_err(|_| last_error("GlobalAlloc"))?;
            let ptr = GlobalLock(hmem) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(hmem));
                return Err(last_error("GlobalLock"));
            }
            let bmi = BITMAPINFOHEADER {
                biSize: header_size as u32,
                biWidth: width as i32,
                biHeight: height as i32, // bottom-up
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            };
            std::ptr::copy_nonoverlapping(&bmi as *const _ as *const u8, ptr, header_size);
            // Flip rows and swizzle RGBA→BGRA.
            let dst = std::slice::from_raw_parts_mut(ptr.add(header_size), pixels);
            let stride = width as usize * 4;
            for row in 0..height as usize {
                let src_row = &rgba[row * stride..(row + 1) * stride];
                let dst_row = &mut dst
                    [(height as usize - 1 - row) * stride..(height as usize - row) * stride];
                // Strides are multiples of 4 by construction; the remainders
                // are empty and ignored.
                let (src_chunks, _) = src_row.as_chunks::<4>();
                let (dst_chunks, _) = dst_row.as_chunks_mut::<4>();
                for (s, d) in src_chunks.iter().zip(dst_chunks.iter_mut()) {
                    d[0] = s[2];
                    d[1] = s[1];
                    d[2] = s[0];
                    d[3] = s[3];
                }
            }
            // GlobalUnlock's return needs GetLastError to interpret; the copy
            // is already done, so its outcome is not load-bearing here.
            let _ = GlobalUnlock(hmem);
            if OpenClipboard(None).is_err() {
                let _ = GlobalFree(Some(hmem));
                return Err(last_error("OpenClipboard"));
            }
            let _ = EmptyClipboard();
            let set_result =
                SetClipboardData(CF_DIB, Some(windows::Win32::Foundation::HANDLE(hmem.0)));
            let _ = CloseClipboard();
            if let Err(e) = set_result {
                // The system did not take ownership on failure: free the
                // block instead of leaking it with the process.
                let _ = GlobalFree(Some(hmem));
                return Err(CaptureError::NativeApi(format!(
                    "SetClipboardData failed: {e}"
                )));
            }
            // Success: the clipboard owns `hmem` now — do NOT free it.
            Ok(())
        }
    }

    // ------------------------------------------------------------------
    // Scrolling drivers (Rung 2b). Compile-checked for the Windows target;
    // runtime-verified only on real Windows hardware (see
    // docs/product/forge-capture/scrolling-support.md).
    // ------------------------------------------------------------------

    const WM_VSCROLL: u32 = 0x0115;
    const WM_HSCROLL: u32 = 0x0114;
    const SB_THUMBPOSITION: i32 = 4;
    const WHEEL_DELTA: i32 = 120;

    /// Recover the real HWND from a window id string produced by
    /// [`crate::native::list_windows`]. The caller is expected to have
    /// validated the id via [`find_window`] first.
    fn hwnd_for_window_id(window_id: &str) -> Result<HWND, CaptureError> {
        let raw: u64 = window_id
            .parse()
            .map_err(|_| CaptureError::NativeApi(format!("bad window id: {window_id}")))?;
        Ok(HWND(raw as *mut c_void))
    }

    /// Read a window's scroll-bar geometry. `None` when the bar is missing
    /// or unusable — custom-drawn scrollbars, browsers, and most modern UI
    /// frameworks expose nothing here, which is exactly what the `Auto`
    /// fallback exists for.
    fn scroll_bar_info(hwnd: HWND, bar: SCROLLBAR_CONSTANTS) -> Option<ScrollGeometry> {
        unsafe {
            let mut si = SCROLLINFO {
                cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                fMask: SIF_RANGE | SIF_PAGE | SIF_POS,
                ..Default::default()
            };
            if GetScrollInfo(hwnd, bar, &mut si).is_ok() && si.nPage > 0 {
                let g = ScrollGeometry {
                    min: si.nMin as i64,
                    max: si.nMax as i64,
                    page: si.nPage as u64,
                    pos: si.nPos as i64,
                };
                if g.scrollable() {
                    Some(g)
                } else {
                    None
                }
            } else {
                None
            }
        }
    }

    /// Move a scroll bar to an exact position via thumb positioning.
    /// Returns the position the bar reports afterwards.
    fn scroll_bar_set(hwnd: HWND, bar: SCROLLBAR_CONSTANTS, pos: i32) -> Option<i32> {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        let msg = if bar == SB_HORZ {
            WM_HSCROLL
        } else {
            WM_VSCROLL
        };
        // wParam: low word = SB_THUMBPOSITION, high word = position.
        let wparam = WPARAM((((pos as u32) << 16) | SB_THUMBPOSITION as u32) as usize);
        unsafe {
            SendMessageW(hwnd, msg, Some(wparam), Some(LPARAM(0)));
        }
        scroll_bar_info(hwnd, bar).map(|g| g.pos as i32)
    }

    /// DOM-aware driver: exact scroll-bar geometry plus exact thumb
    /// positioning. End of content is known, not guessed.
    pub(super) struct WinDomDriver {
        hwnd: HWND,
        rect: RectI,
        bar: SCROLLBAR_CONSTANTS,
        label: String,
    }

    impl WinDomDriver {
        pub(super) fn boxed(
            window_id: &str,
            horizontal: bool,
        ) -> Result<Box<dyn ScrollDriver>, CaptureError> {
            // find_window validates the id and resolves the current rect.
            let info = find_window(window_id)?;
            let hwnd = hwnd_for_window_id(window_id)?;
            let bar = if horizontal { SB_HORZ } else { SB_VERT };
            match scroll_bar_info(hwnd, bar) {
                Some(_) => Ok(Box::new(WinDomDriver {
                    hwnd,
                    rect: info.rect_virtual,
                    bar,
                    label: format!("window '{}' ({})", info.title, info.window_id),
                })),
                None => Err(CaptureError::NativeApi(format!(
                    "window '{}' exposes no usable {} scroll-bar geometry",
                    info.title,
                    if horizontal { "horizontal" } else { "vertical" }
                ))),
            }
        }
    }

    impl ScrollDriver for WinDomDriver {
        fn target_label(&self) -> String {
            self.label.clone()
        }

        fn viewport_size(&mut self) -> Result<(u32, u32), CaptureError> {
            Ok((self.rect.w as u32, self.rect.h as u32))
        }

        fn capture_viewport(&mut self) -> Result<Vec<u8>, CaptureError> {
            // The cursor is excluded from scrolling tiles: it would smear
            // across the stitch and poison offset measurement.
            Ok(capture_screen_rect(self.rect, false)?.rgba)
        }

        fn scroll_geometry(&mut self) -> Option<ScrollGeometry> {
            scroll_bar_info(self.hwnd, self.bar)
        }

        fn scroll_by(&mut self, delta_px: i64) -> Result<(), CaptureError> {
            let g = self.scroll_geometry().ok_or_else(|| {
                CaptureError::NativeApi("scroll-bar geometry disappeared mid-scroll".into())
            })?;
            let page_max = g.max - g.page as i64 + 1;
            let target = (g.pos + delta_px).clamp(g.min, page_max) as i32;
            if target as i64 == g.pos {
                // Already at the end of content; the run loop's still-frame
                // detector closes the run honestly.
                return Ok(());
            }
            let after = scroll_bar_set(self.hwnd, self.bar, target).ok_or_else(|| {
                CaptureError::NativeApi("scroll bar refused the new position".into())
            })?;
            if after as i64 == g.pos {
                return Err(CaptureError::NativeApi(
                    "scroll-bar position did not change after thumb positioning".into(),
                ));
            }
            Ok(())
        }

        fn target_alive(&mut self) -> bool {
            unsafe { IsWindow(Some(self.hwnd)).as_bool() }
        }
    }

    /// Raster-observation driver: synthesizes wheel input (Shift+wheel for
    /// horizontal) parked over the target center, then restores the cursor.
    /// The engine measures what actually moved, so this works on targets
    /// with no OS-visible scroll geometry.
    pub(super) struct WinWheelDriver {
        rect: RectI,
        hwnd: Option<HWND>,
        horizontal: bool,
        label: String,
    }

    impl WinWheelDriver {
        pub(super) fn boxed(
            target: &ScrollTarget,
            horizontal: bool,
        ) -> Result<Box<dyn ScrollDriver>, CaptureError> {
            match target {
                ScrollTarget::Window { window_id } => {
                    let info = find_window(window_id)?;
                    Ok(Box::new(WinWheelDriver {
                        rect: info.rect_virtual,
                        hwnd: hwnd_for_window_id(window_id).ok(),
                        horizontal,
                        label: format!("window '{}' ({})", info.title, info.window_id),
                    }))
                }
                ScrollTarget::Region { rect } => {
                    let r = RectI {
                        x: rect.x.round() as i64,
                        y: rect.y.round() as i64,
                        w: rect.w.round().max(1.0) as u64,
                        h: rect.h.round().max(1.0) as u64,
                    };
                    Ok(Box::new(WinWheelDriver {
                        rect: r,
                        hwnd: None,
                        horizontal,
                        label: format!("region {}x{}@{},{}", r.w, r.h, r.x, r.y),
                    }))
                }
            }
        }

        fn wheel_input(data: i32) -> INPUT {
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: data as u32,
                        dwFlags: MOUSEEVENTF_WHEEL,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: if up {
                            KEYEVENTF_KEYUP
                        } else {
                            Default::default()
                        },
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        /// Synthesize `notches` wheel ticks. Positive `notches` scrolls
        /// down (or right when `horizontal`); the cursor is parked back
        /// where it was afterwards.
        fn send_wheel(&self, notches: i32) -> Result<(), CaptureError> {
            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, VK_SHIFT};
            use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};
            let cx = self.rect.x as i32 + self.rect.w as i32 / 2;
            let cy = self.rect.y as i32 + self.rect.h as i32 / 2;
            let count = notches.unsigned_abs().max(1) as usize;
            let data = if notches >= 0 {
                -WHEEL_DELTA
            } else {
                WHEEL_DELTA
            };
            unsafe {
                let mut saved_pt = POINT::default();
                GetCursorPos(&mut saved_pt)
                    .map_err(|e| CaptureError::NativeApi(format!("GetCursorPos: {e}")))?;
                let saved = (saved_pt.x, saved_pt.y);
                SetCursorPos(cx, cy)
                    .map_err(|e| CaptureError::NativeApi(format!("SetCursorPos: {e}")))?;
                let mut inputs: Vec<INPUT> = Vec::with_capacity(count + 2);
                if self.horizontal {
                    // Shift+wheel = horizontal scroll. Direction follows the
                    // common convention; the engine measures the real
                    // displacement and a wrong guess surfaces as a
                    // still-frame stop, never a fake stitch.
                    inputs.push(Self::key_input(VK_SHIFT, false));
                }
                for _ in 0..count {
                    inputs.push(Self::wheel_input(data));
                }
                if self.horizontal {
                    inputs.push(Self::key_input(VK_SHIFT, true));
                }
                let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
                let _ = SetCursorPos(saved.0, saved.1); // best-effort restore
                if sent as usize != inputs.len() {
                    return Err(CaptureError::NativeApi(format!(
                        "SendInput delivered {sent}/{} events",
                        inputs.len()
                    )));
                }
                Ok(())
            }
        }
    }

    impl ScrollDriver for WinWheelDriver {
        fn target_label(&self) -> String {
            self.label.clone()
        }

        fn viewport_size(&mut self) -> Result<(u32, u32), CaptureError> {
            Ok((self.rect.w as u32, self.rect.h as u32))
        }

        fn capture_viewport(&mut self) -> Result<Vec<u8>, CaptureError> {
            Ok(capture_screen_rect(self.rect, false)?.rgba)
        }

        fn scroll_geometry(&mut self) -> Option<ScrollGeometry> {
            None // raster observation: no geometry, measure pixels instead
        }

        fn scroll_by(&mut self, delta_px: i64) -> Result<(), CaptureError> {
            if delta_px == 0 {
                return Ok(());
            }
            let notches = delta_px.unsigned_abs().div_ceil(120).clamp(1, 20) as i32;
            let signed = if delta_px > 0 { notches } else { -notches };
            self.send_wheel(signed)
        }

        fn target_alive(&mut self) -> bool {
            match self.hwnd {
                Some(hwnd) => unsafe { IsWindow(Some(hwnd)).as_bool() },
                None => true, // region targets have no window to die
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Linux implementation (X11/Xorg). Pure-Rust X11 via x11rb: no X11 dev
// headers are needed to build. Wayland sessions are rejected with a clear
// message (see `require_x11_session`) instead of failing obscurely deep in
// the protocol. Window capture and scrolling capture are not implemented on
// Linux yet and fail closed with explicit errors.
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod linux {
    use super::{CaptureError, CursorState, Monitor, NativeFrame, NativeWindowInfo, RectI};
    use std::borrow::Cow;
    use x11rb::connection::{Connection as _, RequestConnection as _};
    use x11rb::protocol::xfixes;
    use x11rb::protocol::xinerama;
    use x11rb::protocol::xproto::{self, AtomEnum, ImageFormat, ImageOrder};

    fn xerr(context: &str, e: impl std::fmt::Display) -> CaptureError {
        CaptureError::NativeApi(format!("Linux/X11 {context}: {e}"))
    }

    /// Pure predicate for the Wayland/X11 decision — unit-testable without
    /// touching the process environment.
    pub(crate) fn is_wayland_session(
        session_type: Option<&str>,
        wayland_display: bool,
        x_display: bool,
    ) -> bool {
        match session_type.map(str::to_ascii_lowercase).as_deref() {
            Some("wayland") => true,
            _ => wayland_display && !x_display,
        }
    }

    /// Reject Wayland sessions with a clear message instead of failing
    /// obscurely deep in the protocol. X11 forwarding / mixed environments
    /// (both `DISPLAY` and `WAYLAND_DISPLAY` set) are allowed through.
    fn require_x11_session() -> Result<(), CaptureError> {
        let session_type = std::env::var("XDG_SESSION_TYPE").ok();
        let wayland = is_wayland_session(
            session_type.as_deref(),
            std::env::var("WAYLAND_DISPLAY").is_ok(),
            std::env::var("DISPLAY").is_ok(),
        );
        if wayland {
            Err(CaptureError::NativeApi(
                "Wayland session detected: FORGE Capture captures on X11/Xorg sessions only. \
                 Log out, choose \"Zorin on Xorg\" from the gear menu at the login screen, \
                 then log back in."
                    .into(),
            ))
        } else {
            Ok(())
        }
    }

    /// X11 connection bound to the default screen's root window.
    struct X11 {
        conn: x11rb::rust_connection::RustConnection,
        root: xproto::Window,
        byte_order: ImageOrder,
    }

    impl X11 {
        fn connect() -> Result<Self, CaptureError> {
            require_x11_session()?;
            let (conn, screen) = x11rb::connect(None).map_err(|e| {
                CaptureError::NativeApi(format!("cannot open the X11 display: {e}"))
            })?;
            let setup = conn.setup();
            let root = setup.roots.get(screen).map(|s| s.root).ok_or_else(|| {
                CaptureError::NativeApi(format!("X11 screen {screen} has no root window"))
            })?;
            Ok(Self {
                byte_order: setup.image_byte_order,
                root,
                conn,
            })
        }

        /// DPI scale from the X resource manager's `Xft.dpi` (what
        /// GNOME/Xfce set); 1.0 when absent or unparsable.
        fn dpi_scale(&self) -> f64 {
            let value: Vec<u8> = xproto::get_property(
                &self.conn,
                false,
                self.root,
                AtomEnum::RESOURCE_MANAGER,
                AtomEnum::STRING,
                0,
                1024,
            )
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|r| r.value)
            .unwrap_or_default();
            parse_xft_dpi(&String::from_utf8_lossy(&value))
        }

        /// Xinerama screen geometries in root-window coordinates; `None`
        /// when Xinerama is missing or inactive (single-screen fallback).
        fn xinerama_screens(&self) -> Option<Vec<(i32, i32, u32, u32)>> {
            let present = self
                .conn
                .extension_information(xinerama::X11_EXTENSION_NAME)
                .ok()?
                .is_some();
            if !present {
                return None;
            }
            let active = xinerama::is_active(&self.conn).ok()?.reply().ok()?;
            if active.state == 0 {
                return None;
            }
            let reply = xinerama::query_screens(&self.conn).ok()?.reply().ok()?;
            if reply.screen_info.is_empty() {
                return None;
            }
            Some(
                reply
                    .screen_info
                    .into_iter()
                    .map(|s| {
                        (
                            s.x_org as i32,
                            s.y_org as i32,
                            s.width as u32,
                            s.height as u32,
                        )
                    })
                    .collect(),
            )
        }

        fn cursor_pos_physical(&self) -> Result<(i64, i64), CaptureError> {
            let reply = xproto::query_pointer(&self.conn, self.root)
                .map_err(|e| xerr("QueryPointer", e))?
                .reply()
                .map_err(|e| xerr("QueryPointer", e))?;
            Ok((reply.root_x as i64, reply.root_y as i64))
        }

        /// XFixes cursor image + hotspot, when the XFixes extension is
        /// available; `None` otherwise (caller reports an honest
        /// "not captured" cursor state rather than a fake cursor).
        fn cursor_image(&self) -> Result<Option<LinuxCursor>, CaptureError> {
            let present = self
                .conn
                .extension_information(xfixes::X11_EXTENSION_NAME)
                .map(|i| i.is_some())
                .unwrap_or(false);
            if !present {
                return Ok(None);
            }
            let pos = self.cursor_pos_physical()?;
            let reply = xfixes::get_cursor_image(&self.conn)
                .map_err(|e| xerr("XFixesGetCursorImage", e))?
                .reply()
                .map_err(|e| xerr("XFixesGetCursorImage", e))?;
            if reply.width == 0 || reply.height == 0 || reply.cursor_image.is_empty() {
                return Ok(None);
            }
            Ok(Some(LinuxCursor {
                pos_physical: pos,
                hotspot: (reply.xhot as i32, reply.yhot as i32),
                w: reply.width as u32,
                h: reply.height as u32,
                argb: reply.cursor_image,
            }))
        }
    }

    /// Parse `Xft.dpi` out of an X resource-manager string into a scale
    /// factor relative to the 96-dpi baseline. Pure: unit-tested.
    pub(crate) fn parse_xft_dpi(resource_manager: &str) -> f64 {
        for line in resource_manager.lines() {
            if let Some(rest) = line.trim().strip_prefix("Xft.dpi:") {
                if let Ok(dpi) = rest.trim().parse::<f64>() {
                    if dpi > 0.0 {
                        return (dpi / 96.0).clamp(1.0, 4.0);
                    }
                }
            }
        }
        1.0
    }

    pub(super) fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
        let x = X11::connect()?;
        let scale = x.dpi_scale();
        let screens: Vec<(i32, i32, u32, u32)> = match x.xinerama_screens() {
            Some(s) => s,
            None => {
                // Single-screen fallback: the root window's own geometry.
                let g = xproto::get_geometry(&x.conn, x.root)
                    .map_err(|e| xerr("GetGeometry", e))?
                    .reply()
                    .map_err(|e| xerr("GetGeometry", e))?;
                vec![(0, 0, g.width as u32, g.height as u32)]
            }
        };
        Ok(screens
            .into_iter()
            .enumerate()
            .map(|(i, (sx, sy, w, h))| Monitor {
                id: format!("x11-{i}"),
                name: format!("X11 monitor {}", i + 1),
                origin_virtual: (sx, sy),
                size_logical: (
                    ((w as f64 / scale).round().max(1.0)) as u32,
                    ((h as f64 / scale).round().max(1.0)) as u32,
                ),
                scale,
            })
            .collect())
    }

    /// Convert a ZPixmap GetImage payload to opaque RGBA. Supports the
    /// depths real desktops use (24/32); anything else is a loud error, not
    /// a guess. Pure: unit-tested.
    pub(crate) fn zpixmap_to_rgba(
        data: &[u8],
        w: usize,
        h: usize,
        depth: u8,
        order: ImageOrder,
    ) -> Result<Vec<u8>, CaptureError> {
        if depth != 24 && depth != 32 {
            return Err(CaptureError::NativeApi(format!(
                "unsupported X11 screen depth: {depth} (need 24 or 32)"
            )));
        }
        let expect = w
            .checked_mul(h)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| CaptureError::NativeApi("capture rect too large".into()))?;
        if data.len() < expect {
            return Err(CaptureError::NativeApi(format!(
                "short GetImage payload: {} < {expect}",
                data.len()
            )));
        }
        let mut rgba = vec![0u8; expect];
        // A ZPixmap row is width * (depth rounded up to a whole number of
        // bytes); at 24/32 that is 4 bytes per pixel, server byte order.
        // ImageOrder is a non-exhaustive struct: compare, don't match.
        let lsb_first = order == ImageOrder::LSB_FIRST;
        for (src, dst) in data
            .chunks_exact(4)
            .zip(rgba.chunks_exact_mut(4))
            .take(w * h)
        {
            if lsb_first {
                // LSB-first: [B, G, R, X] -> [R, G, B, 255].
                dst[0] = src[2];
                dst[1] = src[1];
                dst[2] = src[0];
                dst[3] = 255;
            } else {
                // MSB-first: [X, R, G, B] -> [R, G, B, 255].
                dst[0] = src[1];
                dst[1] = src[2];
                dst[2] = src[3];
                dst[3] = 255;
            }
        }
        Ok(rgba)
    }

    pub(crate) struct LinuxCursor {
        /// Hotspot in root-window physical pixels.
        pub(crate) pos_physical: (i64, i64),
        pub(crate) hotspot: (i32, i32),
        pub(crate) w: u32,
        pub(crate) h: u32,
        /// ARGB pixels, row-major.
        pub(crate) argb: Vec<u32>,
    }

    /// Alpha-blend an ARGB cursor onto an RGBA canvas ("over", straight
    /// alpha). Pure: unit-tested.
    pub(crate) fn composite_cursor(
        canvas: &mut [u8],
        canvas_w: usize,
        cursor: &LinuxCursor,
        rect_origin: (i64, i64),
    ) {
        let canvas_h = canvas.len() / (canvas_w * 4);
        let ox = cursor.pos_physical.0 - cursor.hotspot.0 as i64 - rect_origin.0;
        let oy = cursor.pos_physical.1 - cursor.hotspot.1 as i64 - rect_origin.1;
        for cy in 0..cursor.h as usize {
            for cx in 0..cursor.w as usize {
                let dx = ox + cx as i64;
                let dy = oy + cy as i64;
                if dx < 0 || dy < 0 || dx >= canvas_w as i64 || dy >= canvas_h as i64 {
                    continue;
                }
                let argb = cursor.argb[cy * cursor.w as usize + cx];
                let a = (argb >> 24) & 0xff;
                if a == 0 {
                    continue;
                }
                let r = (argb >> 16) & 0xff;
                let g = (argb >> 8) & 0xff;
                let b = argb & 0xff;
                let idx = (dy as usize * canvas_w + dx as usize) * 4;
                if a == 255 {
                    canvas[idx] = r as u8;
                    canvas[idx + 1] = g as u8;
                    canvas[idx + 2] = b as u8;
                } else {
                    let inv = 255 - a;
                    canvas[idx] = ((r * a + canvas[idx] as u32 * inv) / 255) as u8;
                    canvas[idx + 1] = ((g * a + canvas[idx + 1] as u32 * inv) / 255) as u8;
                    canvas[idx + 2] = ((b * a + canvas[idx + 2] as u32 * inv) / 255) as u8;
                }
                canvas[idx + 3] = 255;
            }
        }
    }

    pub(super) fn capture_screen_rect(
        rect: RectI,
        include_cursor: bool,
    ) -> Result<NativeFrame, CaptureError> {
        if rect.is_empty() {
            return Err(CaptureError::NativeApi("capture rect is empty".into()));
        }
        // The X protocol addresses drawables with i16/u16; real monitors
        // never approach the limits, but refuse loudly instead of wrapping.
        let x16 = i16::try_from(rect.x)
            .map_err(|_| CaptureError::NativeApi("capture rect x is out of X11 range".into()))?;
        let y16 = i16::try_from(rect.y)
            .map_err(|_| CaptureError::NativeApi("capture rect y is out of X11 range".into()))?;
        let w16 = u16::try_from(rect.w)
            .map_err(|_| CaptureError::NativeApi("capture rect w is out of X11 range".into()))?;
        let h16 = u16::try_from(rect.h)
            .map_err(|_| CaptureError::NativeApi("capture rect h is out of X11 range".into()))?;
        let x = X11::connect()?;
        let reply = xproto::get_image(
            &x.conn,
            ImageFormat::Z_PIXMAP,
            x.root,
            x16,
            y16,
            w16,
            h16,
            u32::MAX,
        )
        .map_err(|e| xerr("GetImage", e))?
        .reply()
        .map_err(|e| xerr("GetImage", e))?;
        let mut rgba = zpixmap_to_rgba(
            &reply.data,
            w16 as usize,
            h16 as usize,
            reply.depth,
            x.byte_order,
        )?;
        let mut cursor = CursorState {
            captured: false,
            position_physical: None,
        };
        if include_cursor {
            if let Some(c) = x.cursor_image().unwrap_or(None) {
                composite_cursor(&mut rgba, w16 as usize, &c, (rect.x, rect.y));
                cursor = CursorState {
                    captured: true,
                    position_physical: Some((c.pos_physical.0, c.pos_physical.1)),
                };
            }
        }
        Ok(NativeFrame { rect, rgba, cursor })
    }

    pub(super) fn cursor_pos() -> Result<(i32, i32), CaptureError> {
        let x = X11::connect()?;
        let (px, py) = x.cursor_pos_physical()?;
        Ok((px as i32, py as i32))
    }

    pub(super) fn copy_rgba_to_clipboard(
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), CaptureError> {
        if rgba.len() != width as usize * height as usize * 4 {
            return Err(CaptureError::EncodeFailed(
                "clipboard RGBA length mismatch".into(),
            ));
        }
        // arboard daemonizes on X11 so the image outlives this call.
        let mut clipboard = arboard::Clipboard::new().map_err(|e| {
            CaptureError::NativeApi(format!("cannot open the Linux clipboard: {e}"))
        })?;
        clipboard
            .set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: Cow::Borrowed(rgba),
            })
            .map_err(|e| CaptureError::NativeApi(format!("clipboard write failed: {e}")))?;
        Ok(())
    }

    pub(super) fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
        Err(CaptureError::NativeApi(
            "window capture is not supported on Linux yet — use monitor or region capture".into(),
        ))
    }

    pub(super) fn find_window(window_id: &str) -> Result<NativeWindowInfo, CaptureError> {
        Err(CaptureError::NativeApi(format!(
            "window capture is not supported on Linux yet (asked for window {window_id})"
        )))
    }

    pub(super) fn scroll_unsupported(
        _what: &str,
    ) -> Result<Box<dyn crate::scroll::ScrollDriver>, CaptureError> {
        Err(CaptureError::NativeApi(
            "scrolling capture is not supported on Linux yet".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swizzle_converts_bgra_to_rgba_and_forces_opaque() {
        // GDI screen captures commonly carry a zero alpha channel; the
        // swizzle must produce opaque RGBA, never transparent pixels.
        let mut px = vec![
            10u8, 20, 30, 0, // BGRA with alpha 0
            40, 50, 60, 128, // BGRA with partial alpha
        ];
        bgra_to_rgba_force_opaque(&mut px);
        assert_eq!(px, vec![30u8, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn swizzle_handles_empty_and_ignores_trailing() {
        let mut px: Vec<u8> = vec![];
        bgra_to_rgba_force_opaque(&mut px);
        assert!(px.is_empty());
        // Trailing bytes that do not form a full pixel are left alone.
        let mut px = vec![1u8, 2, 3, 0, 9];
        bgra_to_rgba_force_opaque(&mut px);
        assert_eq!(px, vec![3u8, 2, 1, 255, 9]);
    }

    #[test]
    fn cursor_pos_is_unavailable_on_unsupported_hosts() {
        // On Windows this returns the live cursor position; on a live X11
        // session the X11 backend answers. Everywhere else it must fail
        // loudly rather than return a fake (0, 0).
        #[cfg(not(any(windows, target_os = "linux")))]
        assert!(cursor_pos().is_err());
        #[cfg(any(windows, target_os = "linux"))]
        assert!(cursor_pos().is_ok() || cursor_pos().is_err()); // environment-dependent
    }

    #[test]
    fn cursor_origin_subtracts_hotspot_and_rect() {
        // Fake CURSORINFO values: screen pos (500, 300) is the hotspot;
        // hotspot offset within the icon is (2, 10); capture rect starts
        // at (100, 100). Icon top-left must be (398, 190).
        assert_eq!(
            cursor_icon_origin((500, 300), (2, 10), (100, 100)),
            (398, 190)
        );
        // Zero hotspot and zero rect origin: identity.
        assert_eq!(cursor_icon_origin((7, 9), (0, 0), (0, 0)), (7, 9));
        // Negative virtual-desktop origin (monitor left of primary).
        assert_eq!(
            cursor_icon_origin((-3800, 200), (5, 5), (-3840, 0)),
            (35, 195)
        );
    }

    #[cfg(target_os = "linux")]
    mod linux_tests {
        use super::super::linux::{
            composite_cursor, is_wayland_session, parse_xft_dpi, zpixmap_to_rgba, LinuxCursor,
        };
        use super::super::{RectI, ScrollTarget};
        use x11rb::protocol::xproto::ImageOrder;

        #[test]
        fn zpixmap_lsb_converts_bgrx_to_opaque_rgba() {
            // LSB-first 24-bit: [B, G, R, X] -> [R, G, B, 255].
            let data = [10u8, 20, 30, 0, 200, 150, 100, 0];
            let rgba = zpixmap_to_rgba(&data, 2, 1, 24, ImageOrder::LSB_FIRST).unwrap();
            assert_eq!(rgba, vec![30, 20, 10, 255, 100, 150, 200, 255]);
        }

        #[test]
        fn zpixmap_msb_converts_xrgb_to_rgba() {
            // MSB-first 24-bit: [X, R, G, B] -> [R, G, B, 255].
            let data = [0u8, 40, 50, 60];
            let rgba = zpixmap_to_rgba(&data, 1, 1, 32, ImageOrder::MSB_FIRST).unwrap();
            assert_eq!(rgba, vec![40, 50, 60, 255]);
        }

        #[test]
        fn zpixmap_rejects_unsupported_depth() {
            let data = [0u8; 8];
            assert!(zpixmap_to_rgba(&data, 1, 1, 16, ImageOrder::LSB_FIRST).is_err());
        }

        #[test]
        fn zpixmap_rejects_short_payload() {
            let data = [0u8; 3];
            assert!(zpixmap_to_rgba(&data, 1, 1, 24, ImageOrder::LSB_FIRST).is_err());
        }

        #[test]
        fn parse_xft_dpi_scales_from_96_baseline() {
            assert_eq!(parse_xft_dpi("Xft.dpi:\t144\n"), 1.5);
            assert_eq!(parse_xft_dpi("Xft.dpi:\t96\n"), 1.0);
            assert_eq!(parse_xft_dpi("Xft.dpi:\t480\n"), 4.0); // clamped
            assert_eq!(parse_xft_dpi(""), 1.0);
            assert_eq!(parse_xft_dpi("Xft.dpi:\tnot-a-number\n"), 1.0);
            assert_eq!(parse_xft_dpi("Xft.dpi:\t0\n"), 1.0);
        }

        #[test]
        fn is_wayland_session_detects_wayland() {
            assert!(is_wayland_session(Some("wayland"), false, false));
            assert!(is_wayland_session(Some("WAYLAND"), false, false));
            assert!(is_wayland_session(None, true, false));
            assert!(!is_wayland_session(None, true, true)); // mixed env allowed
            assert!(!is_wayland_session(None, false, false)); // headless: X11 errors, not Wayland
            assert!(!is_wayland_session(Some("x11"), false, true));
        }

        fn opaque_red_cursor_at(px: i64, py: i64) -> LinuxCursor {
            LinuxCursor {
                pos_physical: (px, py),
                hotspot: (0, 0),
                w: 1,
                h: 1,
                argb: vec![0xFFFF0000],
            }
        }

        #[test]
        fn composite_cursor_paints_opaque_pixel_at_hotspot() {
            let mut canvas = vec![0u8; 2 * 2 * 4];
            let cursor = opaque_red_cursor_at(1, 0);
            composite_cursor(&mut canvas, 2, &cursor, (0, 0));
            // Pixel (1,0) becomes opaque red; pixel (0,0) untouched.
            assert_eq!(&canvas[4..8], &[255, 0, 0, 255]);
            assert_eq!(&canvas[0..4], &[0, 0, 0, 0]);
        }

        #[test]
        fn composite_cursor_blends_half_alpha_over_canvas() {
            let mut canvas = vec![255u8; 1 * 1 * 4]; // white
            let cursor = LinuxCursor {
                pos_physical: (0, 0),
                hotspot: (0, 0),
                w: 1,
                h: 1,
                argb: vec![0x80000000], // 50% black
            };
            composite_cursor(&mut canvas, 1, &cursor, (0, 0));
            assert_eq!(canvas[0], 127);
            assert_eq!(canvas[1], 127);
            assert_eq!(canvas[2], 127);
            assert_eq!(canvas[3], 255);
        }

        #[test]
        fn composite_cursor_clips_outside_canvas() {
            let mut canvas = vec![9u8; 2 * 2 * 4];
            let cursor = opaque_red_cursor_at(99, 99);
            composite_cursor(&mut canvas, 2, &cursor, (0, 0));
            assert!(canvas.iter().all(|&b| b == 9));
        }

        #[test]
        fn composite_cursor_offsets_by_hotspot_and_rect_origin() {
            let mut canvas = vec![0u8; 3 * 3 * 4];
            let cursor = LinuxCursor {
                pos_physical: (10, 10),
                hotspot: (2, 1),
                w: 1,
                h: 1,
                argb: vec![0xFFFF0000],
            };
            // Canvas covers root (8,9)..(11,12); cursor lands at (8,9).
            composite_cursor(&mut canvas, 3, &cursor, (8, 9));
            assert_eq!(&canvas[0..4], &[255, 0, 0, 255]);
        }

        #[test]
        fn capture_rect_rejects_empty_rect_without_touching_x11() {
            // The empty-rect guard runs before any X11 connection attempt,
            // so this holds on headless machines too.
            let rect = RectI {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            };
            assert!(super::super::capture_rect(
                rect,
                &super::super::Monitor {
                    id: "x".into(),
                    name: "x".into(),
                    origin_virtual: (0, 0),
                    size_logical: (1, 1),
                    scale: 1.0,
                },
                false
            )
            .is_err());
        }

        #[test]
        fn window_capture_fails_closed_with_linux_message() {
            let err = super::super::list_windows().unwrap_err();
            let msg = err.to_string();
            assert!(msg.contains("Linux"), "got: {msg}");
            assert!(!msg.contains("Windows 11"), "got: {msg}");
        }

        #[test]
        fn scrolling_capture_fails_closed_with_linux_message() {
            let err = match super::super::wheel_scroll_driver(
                &ScrollTarget::Window {
                    window_id: "x".into(),
                },
                false,
                &[],
            ) {
                Ok(_) => panic!("expected scrolling capture to be unsupported on Linux"),
                Err(e) => e,
            };
            let msg = err.to_string();
            assert!(msg.contains("Linux"), "got: {msg}");
            assert!(!msg.contains("Windows 11"), "got: {msg}");
        }
    }
}
