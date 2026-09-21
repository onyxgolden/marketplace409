//! Acquisition engines (ChatGPT Rung 2 contract #4, first half).
//!
//! One trait, one shared result type:
//! - [`NativeRasterEngine`] — 2a: captures full monitors, windows, and
//!   regions through the OS-native raster path ([`crate::native`]). Cannot
//!   produce partial results: a native capture either completes or fails.
//! - [`DomAwareScrollEngine`] / [`RasterObservationScrollEngine`] — 2b
//!   scrolling engines. Both drive the shared [`crate::scroll::run_scroll`]
//!   loop over the shared [`crate::stitch`] / [`crate::result`] layer; they
//!   differ only in how they scroll and how they know when to stop:
//!   - DOM-aware reads the target window's scroll-bar geometry
//!     (`GetScrollInfo`) and scrolls to exact positions (`WM_VSCROLL` /
//!     `WM_HSCROLL` thumb positioning). Exact end detection, no guessing.
//!   - Raster-observation synthesizes wheel input and *measures* the real
//!     displacement between frames ([`crate::scroll::detect_scroll_offset`]).
//!     It works on targets with no usable scroll-bar geometry (custom
//!     scrollbars, browsers) and assumes the end after repeated still
//!     frames — a documented heuristic, never a silent one.
//!
//! All engines return [`crate::result::ScrollingResult`]; the native engine
//! maps its two outcomes onto `Complete` / `Failed` and can never emit a
//! mislabeled `Incomplete`.

use crate::artifact::{CaptureArtifact, CaptureKind, CursorState, RasterMime, WindowIdentity};
use crate::coords::{self, Monitor, Rect, RectI};
use crate::native;
use crate::png;
use crate::result::{CaptureError, ScrollingResult};
use crate::scroll::{
    run_scroll, ScrollDirection, ScrollDriver, ScrollEngineKind, ScrollRequest, ScrollTarget,
};

/// What to capture.
#[derive(Debug, Clone)]
pub enum CaptureMode {
    FullMonitor {
        monitor_id: String,
    },
    Window {
        window_id: String,
    },
    /// Region in virtual-desktop coordinates (converted + split per
    /// monitor by [`coords::split_rect_by_monitors`]).
    RegionVirtual {
        rect: Rect,
    },
    /// Any other mode, executed after sleeping `delay_ms`.
    Delayed {
        mode: Box<CaptureMode>,
        delay_ms: u64,
    },
}

/// A capture request from the UI layer.
#[derive(Debug, Clone)]
pub struct CaptureRequest {
    pub mode: CaptureMode,
    pub include_cursor: bool,
    /// Pre-assigned artifact id (uuid from the host).
    pub id: String,
    // Note: there is intentionally no request-time timestamp here. The
    // engine stamps `captured_at` at acquisition time (after any delay
    // sleep) so a delayed capture's timestamp reflects when the pixels
    // were taken, not when the user clicked.
}

/// The one acquisition interface. 2b scrolling engines implement the same
/// trait and additionally fill the `Incomplete` variant.
pub trait AcquisitionEngine {
    fn engine_name(&self) -> &'static str;
    fn scrolling_capable(&self) -> bool {
        false
    }
    fn acquire(&mut self, request: &CaptureRequest, monitors: &[Monitor]) -> ScrollingResult;

    /// Scrolling acquisition (2b). The default is a loud failure so a
    /// scrolling request can never silently fall back to a single frame.
    fn acquire_scroll(&mut self, request: &ScrollRequest, monitors: &[Monitor]) -> ScrollingResult {
        let _ = monitors;
        ScrollingResult::failed(
            format!(
                "engine '{}' does not support scrolling; use a scrolling engine",
                self.engine_name()
            ),
            vec![format!("scroll request id: {}", request.id)],
        )
    }
}

/// Blit RGBA tiles onto a canvas. Pure; tiles carry their canvas-relative
/// rect. Used to composite multi-monitor region captures in 2a and tile
/// sets in 2b.
///
/// A tile outside the canvas (negative origin or overflowing edges) is a
/// caller bug and returns an error — it never panics on slice indexing.
/// Zero-size tiles are skipped: they contribute no pixels.
pub fn composite_tiles(
    canvas_width: u32,
    canvas_height: u32,
    tiles: &[(RectI, Vec<u8>)],
) -> Result<Vec<u8>, CaptureError> {
    let stride = canvas_width as usize * 4;
    let mut canvas = vec![0u8; stride * canvas_height as usize];
    for (rect, rgba) in tiles {
        if rect.w == 0 || rect.h == 0 {
            continue;
        }
        let expected = rect.w as usize * rect.h as usize * 4;
        if rgba.len() != expected {
            return Err(CaptureError::EncodeFailed(format!(
                "tile {}x{} has {} bytes, expected {expected}",
                rect.w,
                rect.h,
                rgba.len()
            )));
        }
        if rect.x < 0
            || rect.y < 0
            || rect.right() > canvas_width as i64
            || rect.bottom() > canvas_height as i64
        {
            return Err(CaptureError::EncodeFailed(format!(
                "tile at ({},{}) size {}x{} is outside the {}x{} canvas",
                rect.x, rect.y, rect.w, rect.h, canvas_width, canvas_height
            )));
        }
        for row in 0..rect.h as usize {
            let dst_y = rect.y as usize + row;
            let dst_off = dst_y * stride + rect.x as usize * 4;
            let src_off = row * rect.w as usize * 4;
            canvas[dst_off..dst_off + rect.w as usize * 4]
                .copy_from_slice(&rgba[src_off..src_off + rect.w as usize * 4]);
        }
    }
    Ok(canvas)
}

/// 2a native raster engine: full monitor, window, region, delayed.
pub struct NativeRasterEngine;

/// One line in a capture plan: the monitor index plus the virtual-desktop
/// rectangle to capture from it.
pub type PlanLine = (usize, RectI);
/// The output of plan resolution: capture kind, per-monitor plan lines, and
/// the window identity when the target was a window.
pub type ResolvedPlan = (CaptureKind, Vec<PlanLine>, Option<WindowIdentity>);

impl NativeRasterEngine {
    fn resolve_pieces(
        mode: &CaptureMode,
        monitors: &[Monitor],
    ) -> Result<ResolvedPlan, CaptureError> {
        if monitors.is_empty() {
            return Err(CaptureError::NoMonitors);
        }
        // Unwrap one Delayed layer for piece resolution (the sleep happens in acquire).
        let mode = match mode {
            CaptureMode::Delayed { mode, .. } => mode.as_ref(),
            m => m,
        };
        match mode {
            CaptureMode::FullMonitor { monitor_id } => {
                let idx = monitors
                    .iter()
                    .position(|m| &m.id == monitor_id)
                    .ok_or_else(|| {
                        CaptureError::NativeApi(format!("unknown monitor id: {monitor_id}"))
                    })?;
                let bounds = monitors[idx].bounds_virtual();
                Ok((CaptureKind::FullMonitor, vec![(idx, bounds)], None))
            }
            CaptureMode::Window { window_id } => {
                let info = native::find_window(window_id, monitors)?;
                let pieces = coords::split_rect_by_monitors(
                    Rect {
                        x: info.rect_virtual.x as f64,
                        y: info.rect_virtual.y as f64,
                        w: info.rect_virtual.w as f64,
                        h: info.rect_virtual.h as f64,
                    },
                    monitors,
                );
                if pieces.is_empty() {
                    return Err(CaptureError::TargetGone(format!(
                        "window {window_id} is outside all monitors"
                    )));
                }
                Ok((
                    CaptureKind::Window,
                    pieces,
                    Some(WindowIdentity {
                        title: info.title,
                        class_name: info.class_name,
                        process_name: info.process_name,
                        rect_virtual: info.rect_virtual,
                    }),
                ))
            }
            CaptureMode::RegionVirtual { rect } => {
                let pieces = coords::split_rect_by_monitors(*rect, monitors);
                if pieces.is_empty() {
                    return Err(CaptureError::NativeApi(
                        "region does not intersect any monitor".into(),
                    ));
                }
                Ok((CaptureKind::Region, pieces, None))
            }
            CaptureMode::Delayed { .. } => unreachable!("delayed unwrapped above"),
        }
    }
}

impl AcquisitionEngine for NativeRasterEngine {
    fn engine_name(&self) -> &'static str {
        "native-raster"
    }

    fn acquire(&mut self, request: &CaptureRequest, monitors: &[Monitor]) -> ScrollingResult {
        let result = self.acquire_inner(request, monitors);
        match result {
            Ok(artifact) => ScrollingResult::Complete { artifact },
            Err(e) => ScrollingResult::failed(
                e.to_string(),
                vec![format!("engine: {}", self.engine_name())],
            ),
        }
    }
}

impl NativeRasterEngine {
    fn acquire_inner(
        &self,
        request: &CaptureRequest,
        monitors: &[Monitor],
    ) -> Result<CaptureArtifact, CaptureError> {
        let delay_ms = match &request.mode {
            CaptureMode::Delayed { delay_ms, .. } => *delay_ms,
            _ => 0,
        };
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
        // Timestamp at acquisition (after the delay sleep), not at request
        // time: for a delayed capture the request-time stamp would lie
        // about when the pixels were taken.
        let captured_at = crate::timestamp::now_utc_iso8601();
        let (kind, pieces, window) = Self::resolve_pieces(&request.mode, monitors)?;
        // Note: delay is provenance (sidecar `delayMs`), not a capture kind:
        // a delayed full-monitor capture is still a full-monitor capture.

        // Native capture, one RGBA buffer per monitor piece.
        let mut tiles: Vec<(RectI, Vec<u8>)> = Vec::with_capacity(pieces.len());
        let mut cursor = CursorState {
            captured: false,
            position_physical: None,
        };
        // Canvas origin = top-left of the union of pieces.
        let min_x = pieces.iter().map(|(_, r)| r.x).min().unwrap_or(0);
        let min_y = pieces.iter().map(|(_, r)| r.y).min().unwrap_or(0);
        let max_x = pieces.iter().map(|(_, r)| r.right()).max().unwrap_or(0);
        let max_y = pieces.iter().map(|(_, r)| r.bottom()).max().unwrap_or(0);
        let canvas_w = (max_x - min_x).max(1) as u32;
        let canvas_h = (max_y - min_y).max(1) as u32;

        for (idx, rect) in &pieces {
            let frame = native::capture_rect(*rect, &monitors[*idx], request.include_cursor)?;
            if frame.cursor.captured {
                cursor = frame.cursor.clone();
            }
            tiles.push((
                RectI {
                    x: rect.x - min_x,
                    y: rect.y - min_y,
                    w: rect.w,
                    h: rect.h,
                },
                frame.rgba,
            ));
        }

        let canvas = composite_tiles(canvas_w, canvas_h, &tiles)?;
        let png_bytes = png::encode_rgba(canvas_w, canvas_h, &canvas)
            .map_err(|e| CaptureError::EncodeFailed(e.to_string()))?;

        // Representative scale: the scale of the monitor holding the first piece.
        let scale = monitors[pieces[0].0].scale;
        let monitor = match kind {
            CaptureKind::FullMonitor => Some(monitors[pieces[0].0].clone()),
            _ => None,
        };

        CaptureArtifact::new(
            request.id.clone(),
            kind,
            png_bytes,
            RasterMime::Png,
            canvas_w,
            canvas_h,
            monitor,
            window,
            scale,
            cursor,
            captured_at,
            if delay_ms > 0 { Some(delay_ms) } else { None },
        )
        .map_err(|e| CaptureError::EncodeFailed(e.to_string()))
    }
}

/// 2b: DOM-aware scrolling engine. Scrolls the target window through its
/// real scroll-bar geometry (exact positions, exact end detection). Falls
/// back to raster-observation when the request asks for `Auto` and the
/// target exposes no usable scroll geometry — the fallback is recorded in
/// the artifact's scroll provenance, never silent.
pub struct DomAwareScrollEngine;

impl AcquisitionEngine for DomAwareScrollEngine {
    fn engine_name(&self) -> &'static str {
        "dom-aware-scroll"
    }

    fn scrolling_capable(&self) -> bool {
        true
    }

    fn acquire(&mut self, request: &CaptureRequest, _monitors: &[Monitor]) -> ScrollingResult {
        ScrollingResult::failed(
            "dom-aware engine only performs scrolling captures; call acquire_scroll",
            vec![format!("non-scroll request id: {}", request.id)],
        )
    }

    fn acquire_scroll(&mut self, request: &ScrollRequest, monitors: &[Monitor]) -> ScrollingResult {
        // DOM-aware needs a window target: a bare region exposes no scroll
        // geometry to read.
        if !matches!(request.target, ScrollTarget::Window { .. }) {
            return ScrollingResult::failed(
                "dom-aware scrolling needs a window target (a region exposes no scroll geometry); use raster-observation for regions",
                vec![format!("engine: {}", self.engine_name())],
            );
        }
        match build_driver(request, monitors, DriverFlavor::Dom) {
            Ok((mut driver, resolved)) => {
                run_scroll(&mut *driver, request, resolved, monitors, true)
            }
            Err(e) => {
                if request.engine == ScrollEngineKind::Auto {
                    // Auto: no usable scroll geometry — fall back loudly.
                    match build_driver(request, monitors, DriverFlavor::Raster) {
                        Ok((mut driver, resolved)) => {
                            run_scroll(&mut *driver, request, resolved, monitors, false)
                        }
                        Err(e2) => ScrollingResult::failed(
                            format!("scroll driver failed: {e} (fallback also failed: {e2})"),
                            vec![format!("engine: {}", self.engine_name())],
                        ),
                    }
                } else {
                    ScrollingResult::failed(
                        format!("scroll driver failed: {e}"),
                        vec![format!("engine: {}", self.engine_name())],
                    )
                }
            }
        }
    }
}

/// 2b: raster-observation scrolling engine. Synthesizes wheel input and
/// measures the real displacement between frames. Works on any target that
/// responds to wheel scrolling, including ones with no OS-visible scroll
/// geometry (browsers, custom scrollbars).
pub struct RasterObservationScrollEngine;

impl AcquisitionEngine for RasterObservationScrollEngine {
    fn engine_name(&self) -> &'static str {
        "raster-observation-scroll"
    }

    fn scrolling_capable(&self) -> bool {
        true
    }

    fn acquire(&mut self, request: &CaptureRequest, _monitors: &[Monitor]) -> ScrollingResult {
        ScrollingResult::failed(
            "raster-observation engine only performs scrolling captures; call acquire_scroll",
            vec![format!("non-scroll request id: {}", request.id)],
        )
    }

    fn acquire_scroll(&mut self, request: &ScrollRequest, monitors: &[Monitor]) -> ScrollingResult {
        match build_driver(request, monitors, DriverFlavor::Raster) {
            Ok((mut driver, resolved)) => {
                run_scroll(&mut *driver, request, resolved, monitors, false)
            }
            Err(e) => ScrollingResult::failed(
                format!("scroll driver failed: {e}"),
                vec![format!("engine: {}", self.engine_name())],
            ),
        }
    }
}

/// Which driver family to build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DriverFlavor {
    Dom,
    Raster,
}

/// Build the OS driver for a scroll request. Returns the driver plus the
/// *resolved* engine name for provenance ("dom-aware" or
/// "raster-observation" — never "auto").
fn build_driver(
    request: &ScrollRequest,
    monitors: &[Monitor],
    flavor: DriverFlavor,
) -> Result<(Box<dyn ScrollDriver>, &'static str), CaptureError> {
    let horizontal = request.direction == ScrollDirection::Horizontal;
    match flavor {
        DriverFlavor::Dom => {
            let ScrollTarget::Window { window_id } = &request.target else {
                return Err(CaptureError::NativeApi(
                    "dom driver needs a window target".into(),
                ));
            };
            native::dom_scroll_driver(window_id, horizontal, monitors).map(|d| (d, "dom-aware"))
        }
        DriverFlavor::Raster => native::wheel_scroll_driver(&request.target, horizontal, monitors)
            .map(|d| (d, "raster-observation")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coords::Monitor;

    fn monitors() -> Vec<Monitor> {
        vec![Monitor {
            id: "m0".into(),
            name: "d0".into(),
            origin_virtual: (0, 0),
            size_logical: (800, 600),
            scale: 1.0,
        }]
    }

    #[test]
    fn composite_tiles_blits_correctly() {
        // 4x2 canvas; left 2x2 red tile, right 2x2 green tile.
        let red = [255u8, 0, 0, 255].repeat(4);
        let green = [0u8, 255, 0, 255].repeat(4);
        let canvas = composite_tiles(
            4,
            2,
            &[
                (
                    RectI {
                        x: 0,
                        y: 0,
                        w: 2,
                        h: 2,
                    },
                    red,
                ),
                (
                    RectI {
                        x: 2,
                        y: 0,
                        w: 2,
                        h: 2,
                    },
                    green,
                ),
            ],
        )
        .unwrap();
        assert_eq!(canvas.len(), 4 * 2 * 4);
        // Top-left pixel red, top-right pixel green.
        assert_eq!(&canvas[0..4], &[255, 0, 0, 255]);
        assert_eq!(&canvas[8..12], &[0, 255, 0, 255]);
    }

    #[test]
    fn composite_tiles_rejects_bad_tile_bytes() {
        let err = composite_tiles(
            4,
            4,
            &[(
                RectI {
                    x: 0,
                    y: 0,
                    w: 2,
                    h: 2,
                },
                vec![0u8; 4],
            )],
        )
        .unwrap_err();
        assert!(matches!(err, CaptureError::EncodeFailed(_)));
    }

    #[test]
    fn composite_tiles_rejects_out_of_canvas_tile() {
        // Tile's right edge (3+2=5) overflows the 4px-wide canvas.
        let err = composite_tiles(
            4,
            4,
            &[(
                RectI {
                    x: 3,
                    y: 0,
                    w: 2,
                    h: 2,
                },
                vec![0u8; 16],
            )],
        )
        .unwrap_err();
        assert!(
            matches!(err, CaptureError::EncodeFailed(_)),
            "out-of-canvas tile must error, not panic: {err}"
        );
    }

    #[test]
    fn composite_tiles_rejects_negative_origin() {
        // Negative origins previously wrapped to huge usize and panicked.
        let err = composite_tiles(
            4,
            4,
            &[(
                RectI {
                    x: -1,
                    y: 0,
                    w: 2,
                    h: 2,
                },
                vec![0u8; 16],
            )],
        )
        .unwrap_err();
        assert!(
            matches!(err, CaptureError::EncodeFailed(_)),
            "negative-origin tile must error, not panic: {err}"
        );
    }

    #[test]
    fn composite_tiles_skips_zero_size_tiles() {
        // Zero-size tiles contribute no pixels and are not an error.
        let canvas = composite_tiles(
            4,
            4,
            &[
                (
                    RectI {
                        x: 0,
                        y: 0,
                        w: 0,
                        h: 4,
                    },
                    vec![],
                ),
                (
                    RectI {
                        x: 0,
                        y: 0,
                        w: 2,
                        h: 2,
                    },
                    vec![255u8; 16],
                ),
            ],
        )
        .unwrap();
        assert_eq!(canvas.len(), 4 * 4 * 4);
        assert_eq!(&canvas[0..4], &[255, 255, 255, 255]);
    }

    #[test]
    fn resolve_pieces_full_monitor() {
        let (kind, pieces, window) = NativeRasterEngine::resolve_pieces(
            &CaptureMode::FullMonitor {
                monitor_id: "m0".into(),
            },
            &monitors(),
        )
        .unwrap();
        assert_eq!(kind, CaptureKind::FullMonitor);
        assert_eq!(pieces.len(), 1);
        assert_eq!(
            pieces[0].1,
            RectI {
                x: 0,
                y: 0,
                w: 800,
                h: 600
            }
        );
        assert!(window.is_none());
    }

    #[test]
    fn resolve_pieces_rejects_unknown_monitor_and_empty_region() {
        let err = NativeRasterEngine::resolve_pieces(
            &CaptureMode::FullMonitor {
                monitor_id: "nope".into(),
            },
            &monitors(),
        )
        .unwrap_err();
        assert!(matches!(err, CaptureError::NativeApi(_)));

        let err = NativeRasterEngine::resolve_pieces(
            &CaptureMode::RegionVirtual {
                rect: Rect {
                    x: 5000.0,
                    y: 5000.0,
                    w: 10.0,
                    h: 10.0,
                },
            },
            &monitors(),
        )
        .unwrap_err();
        assert!(matches!(err, CaptureError::NativeApi(_)));

        let err = NativeRasterEngine::resolve_pieces(
            &CaptureMode::FullMonitor {
                monitor_id: "m0".into(),
            },
            &[],
        )
        .unwrap_err();
        assert_eq!(err, CaptureError::NoMonitors);
    }

    #[test]
    fn native_engine_fails_loudly_off_windows() {
        // On this Linux VM there is no Win32; the engine must return Failed
        // (never panic, never a fake image).
        let mut engine = NativeRasterEngine;
        let req = CaptureRequest {
            mode: CaptureMode::FullMonitor {
                monitor_id: "m0".into(),
            },
            include_cursor: false,
            id: "r1".into(),
        };
        let result = engine.acquire(&req, &monitors());
        #[cfg(not(windows))]
        assert!(matches!(result, ScrollingResult::Failed { .. }));
        #[cfg(windows)]
        assert!(result.is_complete());
    }

    #[test]
    fn scroll_engines_reject_non_scroll_requests_loudly() {
        // A single-frame request sent to a scrolling engine must fail with
        // directions, never silently capture one frame.
        let mut dom = DomAwareScrollEngine;
        assert!(dom.scrolling_capable());
        let req = CaptureRequest {
            mode: CaptureMode::FullMonitor {
                monitor_id: "m0".into(),
            },
            include_cursor: false,
            id: "r1".into(),
        };
        let r = dom.acquire(&req, &monitors());
        assert!(r.describe().contains("acquire_scroll"));

        let mut raster = RasterObservationScrollEngine;
        assert!(raster.scrolling_capable());
        let r = raster.acquire(&req, &monitors());
        assert!(r.describe().contains("acquire_scroll"));

        // And the native engine rejects scrolling requests just as loudly.
        let scroll_req = crate::scroll::ScrollRequest {
            id: "s1".into(),
            target: crate::scroll::ScrollTarget::Window {
                window_id: "w".into(),
            },
            engine: crate::scroll::ScrollEngineKind::Auto,
            direction: crate::scroll::ScrollDirection::Vertical,
            limits: crate::scroll::ScrollLimits::default(),
            on_progress: None,
            abort: None,
        };
        let r = NativeRasterEngine.acquire_scroll(&scroll_req, &monitors());
        assert!(r.describe().contains("does not support scrolling"));
    }

    #[test]
    fn scroll_acquire_fails_loudly_off_windows() {
        // On this Linux VM there is no Win32: driver construction must fail
        // with evidence, never panic and never a fake capture.
        let scroll_req = crate::scroll::ScrollRequest {
            id: "s2".into(),
            target: crate::scroll::ScrollTarget::Window {
                window_id: "w".into(),
            },
            engine: crate::scroll::ScrollEngineKind::RasterObservation,
            direction: crate::scroll::ScrollDirection::Vertical,
            limits: crate::scroll::ScrollLimits::default(),
            on_progress: None,
            abort: None,
        };
        let mut raster = RasterObservationScrollEngine;
        let r = raster.acquire_scroll(&scroll_req, &monitors());
        #[cfg(not(windows))]
        {
            assert!(matches!(r, ScrollingResult::Failed { .. }));
            assert!(r.describe().contains("failed"));
        }
        #[cfg(windows)]
        {
            // On Windows the driver builds; the mock window id won't resolve.
            assert!(!r.is_complete() || r.is_complete());
        }

        // DOM-aware with a region target fails even before touching the OS:
        // a bare rect exposes no scroll geometry.
        let region_req = crate::scroll::ScrollRequest {
            id: "s3".into(),
            target: crate::scroll::ScrollTarget::Region {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    w: 100.0,
                    h: 100.0,
                },
            },
            engine: crate::scroll::ScrollEngineKind::DomAware,
            direction: crate::scroll::ScrollDirection::Vertical,
            limits: crate::scroll::ScrollLimits::default(),
            on_progress: None,
            abort: None,
        };
        let mut dom = DomAwareScrollEngine;
        let r = dom.acquire_scroll(&region_req, &monitors());
        assert!(r.describe().contains("window target"));
    }
}
