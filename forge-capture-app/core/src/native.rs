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
    use std::ffi::OsString;
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
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, EnumWindows, GetClassNameW, GetCursorInfo, GetIconInfo, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, CURSORINFO, CURSOR_SHOWING,
        DI_NORMAL, ICONINFO,
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
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
        };
        use windows::Win32::Foundation::GlobalFree;
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
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
}
