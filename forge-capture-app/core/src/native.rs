//! Thin OS boundary for native capture.
//!
//! Everything cross-platform lives in the other modules; this module is the
//! only place that touches OS capture APIs. On Windows it implements GDI
//! screen capture (BitBlt) behind `#[cfg(windows)]`. On any other host the
//! functions below return an explicit error — never a fake image, never a
//! panic.
//!
//! ## Windows notes (compile-verified via
//! `cargo check --target x86_64-pc-windows-msvc`; runtime behavior is
//! Windows-untested until run on real hardware — see RUNG2A_NOTES.md)
//!
//! - The process should be per-monitor-DPI-aware (V2); the Tauri shell sets
//!   this at startup and virtual-desktop coordinates then coincide with
//!   physical pixels (see `coords`).
//! - Window capture uses `GetWindowDC` + `BitBlt`: occluded or minimized
//!   windows can legitimately come back blank — that surfaces as a successful
//!   capture of blank pixels, which callers should treat as suspect, not as
//!   an engine bug. (A future hardening pass can add a blank-frame detector.)

use crate::artifact::CursorState;
use crate::coords::{Monitor, RectI};
use crate::result::CaptureError;

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
#[cfg(not(windows))]
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

/// Look up a window by id (from [`list_windows`]) for window capture.
#[cfg(not(windows))]
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

/// Enumerate visible top-level windows for the capture picker.
#[cfg(not(windows))]
pub fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
    Err(CaptureError::NativeApi(
        "window enumeration requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn list_windows() -> Result<Vec<NativeWindowInfo>, CaptureError> {
    win::list_windows()
}

/// Enumerate monitors with per-monitor DPI.
#[cfg(not(windows))]
pub fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
    Err(CaptureError::NativeApi(
        "monitor enumeration requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn list_monitors() -> Result<Vec<Monitor>, CaptureError> {
    win::list_monitors()
}

/// Copy RGBA bytes to the Windows clipboard as a DIB.
#[cfg(not(windows))]
pub fn copy_rgba_to_clipboard(_width: u32, _height: u32, _rgba: &[u8]) -> Result<(), CaptureError> {
    Err(CaptureError::NativeApi(
        "clipboard capture requires Windows 11".into(),
    ))
}

#[cfg(windows)]
pub fn copy_rgba_to_clipboard(width: u32, height: u32, rgba: &[u8]) -> Result<(), CaptureError> {
    win::copy_rgba_to_clipboard(width, height, rgba)
}

// ---------------------------------------------------------------------------
// Windows implementation (GDI). Compile-checked for the Windows target;
// runtime-verified only on real Windows hardware (see docs).
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod win {
    use super::{CaptureError, CursorState, Monitor, NativeFrame, NativeWindowInfo, RectI};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HGDIOBJ, MONITORINFOEXW,
        SRCCOPY,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, EnumWindows, GetClassNameW, GetCursorInfo, GetWindowRect, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, CURSORINFO, CURSOR_SHOWING, DI_NORMAL,
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
                let mut ci = CURSORINFO::default();
                ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
                if GetCursorInfo(&mut ci).is_ok() && ci.flags.0 & CURSOR_SHOWING.0 != 0 {
                    let cx = ci.ptScreenPos.x - rect.x as i32;
                    let cy = ci.ptScreenPos.y - rect.y as i32;
                    if cx >= 0 && cy >= 0 && cx < w && cy < h {
                        let _ = DrawIconEx(
                            mem_dc,
                            cx,
                            cy,
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
            // GDI returns BGRA; swizzle to RGBA in place.
            for px in rgba.chunks_exact_mut(4) {
                px.swap(0, 2);
            }

            SelectObject(mem_dc, old);
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
                return full.rsplit(['\\', '/']).next().map(|s| s.to_string());
            }
            None
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
                return Err(last_error("GlobalLock"));
            }
            let mut bmi = BITMAPINFOHEADER::default();
            bmi.biSize = header_size as u32;
            bmi.biWidth = width as i32;
            bmi.biHeight = height as i32; // bottom-up
            bmi.biPlanes = 1;
            bmi.biBitCount = 32;
            bmi.biCompression = BI_RGB.0;
            std::ptr::copy_nonoverlapping(&bmi as *const _ as *const u8, ptr, header_size);
            // Flip rows and swizzle RGBA→BGRA.
            let dst = std::slice::from_raw_parts_mut(ptr.add(header_size), pixels);
            let stride = width as usize * 4;
            for row in 0..height as usize {
                let src_row = &rgba[row * stride..(row + 1) * stride];
                let dst_row = &mut dst
                    [(height as usize - 1 - row) * stride..(height as usize - row) * stride];
                for (s, d) in src_row.chunks_exact(4).zip(dst_row.chunks_exact_mut(4)) {
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
                return Err(last_error("OpenClipboard"));
            }
            let _ = EmptyClipboard();
            let set_result =
                SetClipboardData(CF_DIB, Some(windows::Win32::Foundation::HANDLE(hmem.0)));
            let _ = CloseClipboard();
            if let Err(e) = set_result {
                // The system did not take ownership; the moveable block is
                // simply leaked with the process rather than risk a wrong
                // free path here. (Noted as a known 2a wart.)
                return Err(CaptureError::NativeApi(format!(
                    "SetClipboardData failed: {e}"
                )));
            }
            Ok(())
        }
    }
}
