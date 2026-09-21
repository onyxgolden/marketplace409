//! Coordinate spaces and conversions for capture.
//!
//! Four spaces are modeled explicitly (ChatGPT Rung 2 contract #2):
//!
//! - **WebViewCss** — CSS pixels inside the Tauri webview. `css_px * dpr`
//!   gives device pixels on the monitor hosting the webview, where `dpr`
//!   (devicePixelRatio) equals that monitor's DPI scale for a per-monitor
//!   DPI-aware process.
//! - **WindowsLogical** — DPI-virtualized Windows coordinates: the space a
//!   DPI-*unaware* process sees. 96 logical px == 1 inch by definition, so
//!   `physical = logical * scale`.
//! - **VirtualDesktop** — the spanning coordinate space of all monitors as
//!   reported by the OS. Origins may be **negative** (a monitor left of or
//!   above the primary). For a per-monitor-DPI-aware process (which the
//!   FORGE Capture shell is), virtual-desktop coordinates coincide with
//!   physical pixels; the space is modeled separately because callers such
//!   as region-picker overlays or unaware APIs may hand us these.
//! - **PhysicalRaster** — actual device pixels: the space of the capture
//!   bitmap. Integer coordinates; the bottom-right pixel of a W×H capture is
//!   at (W-1, H-1).
//!
//! Rounding rule: float → physical pixel uses round-half-away-from-zero
//! (`f64::round`). Rectangles are converted by their corners and re-derived
//! (`w = x2 - x1`) so width/height never drift from the edges.

use serde::{Deserialize, Serialize};

/// A point in a floating-point coordinate space (CSS, logical, virtual).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A rectangle in a floating-point coordinate space.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    /// Normalize a possibly inverted rect (e.g. from a drag that went
    /// up-left): negative w/h are flipped into the origin.
    pub fn normalize(self) -> Rect {
        let (x, w) = if self.w < 0.0 {
            (self.x + self.w, -self.w)
        } else {
            (self.x, self.w)
        };
        let (y, h) = if self.h < 0.0 {
            (self.y + self.h, -self.h)
        } else {
            (self.y, self.h)
        };
        Rect { x, y, w, h }
    }

    pub fn is_empty(self) -> bool {
        self.w <= 0.0 || self.h <= 0.0
    }
}

/// An integer rectangle in physical-raster space.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RectI {
    pub x: i64,
    pub y: i64,
    pub w: u64,
    pub h: u64,
}

impl RectI {
    pub fn is_empty(self) -> bool {
        self.w == 0 || self.h == 0
    }

    pub fn right(self) -> i64 {
        self.x.saturating_add(self.w as i64)
    }

    pub fn bottom(self) -> i64 {
        self.y.saturating_add(self.h as i64)
    }

    pub fn contains_point(self, x: i64, y: i64) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }

    pub fn contains_rect(self, other: RectI) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }

    /// Intersection of two rects; `None` when they do not overlap.
    pub fn intersect(self, other: RectI) -> Option<RectI> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let r = self.right().min(other.right());
        let b = self.bottom().min(other.bottom());
        if r > x && b > y {
            Some(RectI {
                x,
                y,
                w: (r - x) as u64,
                h: (b - y) as u64,
            })
        } else {
            None
        }
    }

    pub fn area(self) -> u64 {
        self.w.saturating_mul(self.h)
    }
}

/// One display monitor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Monitor {
    /// Opaque stable-ish id (e.g. `\\.\DISPLAY1` or an index fallback).
    pub id: String,
    /// Human label for UI/errors. Never auto-collects more than the OS gives.
    pub name: String,
    /// Top-left of this monitor in virtual-desktop coordinates. May be
    /// negative when the monitor sits left of / above the primary.
    pub origin_virtual: (i32, i32),
    /// Size in Windows logical pixels.
    pub size_logical: (u32, u32),
    /// DPI scale factor: 1.0 = 96 DPI, 1.25, 1.5, 2.0, …
    pub scale: f64,
}

impl Monitor {
    /// Physical (device-pixel) size, derived from logical size × scale.
    pub fn size_physical(&self) -> (u64, u64) {
        (
            (self.size_logical.0 as f64 * self.scale).round() as u64,
            (self.size_logical.1 as f64 * self.scale).round() as u64,
        )
    }

    /// This monitor's bounds in virtual-desktop/physical coordinates.
    /// (For a per-monitor-aware process the two coincide; see module docs.)
    pub fn bounds_virtual(&self) -> RectI {
        let (w, h) = self.size_physical();
        RectI {
            x: self.origin_virtual.0 as i64,
            y: self.origin_virtual.1 as i64,
            w,
            h,
        }
    }

    /// Windows-logical point (relative to this monitor's top-left) →
    /// virtual-desktop/physical pixel.
    pub fn logical_to_physical(&self, p: Point) -> (i64, i64) {
        (
            (self.origin_virtual.0 as f64 + p.x * self.scale).round() as i64,
            (self.origin_virtual.1 as f64 + p.y * self.scale).round() as i64,
        )
    }

    /// Inverse of [`Monitor::logical_to_physical`].
    pub fn physical_to_logical(&self, x: i64, y: i64) -> Point {
        Point {
            x: (x as f64 - self.origin_virtual.0 as f64) / self.scale,
            y: (y as f64 - self.origin_virtual.1 as f64) / self.scale,
        }
    }

    /// Virtual-desktop (physical-pixel) point → logical point for window
    /// placement APIs (e.g. Tauri's `position`/`inner_size`), which
    /// interpret values in logical units and scale them by the containing
    /// monitor's DPI. Passing physical coordinates directly misplaces and
    /// mis-sizes windows on mixed-DPI setups; `physical_to_logical` is the
    /// wrong helper here because it is monitor-*relative* (it subtracts the
    /// origin), while placement APIs want virtual-desktop-*absolute*
    /// logical coordinates.
    pub fn virtual_to_logical_placement(&self, x: i64, y: i64) -> Point {
        Point {
            x: x as f64 / self.scale,
            y: y as f64 / self.scale,
        }
    }
}

/// WebView CSS rect → physical raster rect.
///
/// `webview_origin_virtual` is the webview content area's top-left in
/// virtual-desktop coordinates; `dpr` is the devicePixelRatio of the monitor
/// hosting the webview (equals its DPI scale for an aware process).
pub fn css_to_physical(rect: Rect, webview_origin_virtual: (i32, i32), dpr: f64) -> RectI {
    let rect = rect.normalize();
    let x1 = (webview_origin_virtual.0 as f64 + rect.x * dpr).round() as i64;
    let y1 = (webview_origin_virtual.1 as f64 + rect.y * dpr).round() as i64;
    let x2 = (webview_origin_virtual.0 as f64 + (rect.x + rect.w) * dpr).round() as i64;
    let y2 = (webview_origin_virtual.1 as f64 + (rect.y + rect.h) * dpr).round() as i64;
    RectI {
        x: x1,
        y: y1,
        w: x2.saturating_sub(x1).max(0) as u64,
        h: y2.saturating_sub(y1).max(0) as u64,
    }
}

/// Virtual-desktop point → physical pixel.
///
/// Assumes a per-monitor-DPI-aware caller (true for the Tauri shell), so the
/// mapping is the identity; returns `None` when the point falls in dead space
/// between monitors rather than silently snapping it somewhere.
pub fn virtual_point_to_physical(x: i64, y: i64, monitors: &[Monitor]) -> Option<(i64, i64)> {
    for m in monitors {
        if m.bounds_virtual().contains_point(x, y) {
            return Some((x, y));
        }
    }
    None
}

/// Split a virtual-desktop rect across monitors into per-monitor physical
/// rects. This is the cross-monitor region primitive: one selected region may
/// cover pieces of several monitors at different DPI scales.
///
/// Returns `(monitor_index, physical_rect)` pairs, skipping monitors the
/// rect does not touch. An empty vec means the rect hits no monitor at all.
pub fn split_rect_by_monitors(rect: Rect, monitors: &[Monitor]) -> Vec<(usize, RectI)> {
    let rect = rect.normalize();
    if rect.is_empty() {
        return Vec::new();
    }
    // Work in integer virtual/physical space: convert the float rect's
    // corners once, then clip per monitor.
    let x1 = rect.x.round() as i64;
    let y1 = rect.y.round() as i64;
    let x2 = (rect.x + rect.w).round() as i64;
    let y2 = (rect.y + rect.h).round() as i64;
    let want = RectI {
        x: x1.min(x2),
        y: y1.min(y2),
        w: (x1.max(x2) - x1.min(x2)).max(0) as u64,
        h: (y1.max(y2) - y1.min(y2)).max(0) as u64,
    };
    if want.is_empty() {
        return Vec::new();
    }
    monitors
        .iter()
        .enumerate()
        .filter_map(|(i, m)| want.intersect(m.bounds_virtual()).map(|piece| (i, piece)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Primary 1920×1080 @100% at (0,0); secondary 2560×1440 logical @150%
    /// sitting LEFT of the primary → negative virtual origin, mixed DPI.
    fn fixture() -> Vec<Monitor> {
        vec![
            Monitor {
                id: "primary".into(),
                name: "\\\\.\\DISPLAY1".into(),
                origin_virtual: (0, 0),
                size_logical: (1920, 1080),
                scale: 1.0,
            },
            Monitor {
                id: "secondary".into(),
                name: "\\\\.\\DISPLAY2".into(),
                origin_virtual: (-3840, 0),
                size_logical: (2560, 1440),
                scale: 1.5,
            },
        ]
    }

    #[test]
    fn physical_size_derives_from_logical_times_scale() {
        let m = &fixture()[1];
        assert_eq!(m.size_physical(), (3840, 2160));
        assert_eq!(
            m.bounds_virtual(),
            RectI {
                x: -3840,
                y: 0,
                w: 3840,
                h: 2160
            }
        );
    }

    #[test]
    fn logical_to_physical_on_scaled_monitor() {
        let m = &fixture()[1];
        // Bottom-right logical corner → physical bottom-right.
        assert_eq!(
            m.logical_to_physical(Point {
                x: 2560.0,
                y: 1440.0
            }),
            (0, 2160)
        );
        // Logical (100,100) on the secondary → physical (-3840+150, 150).
        assert_eq!(
            m.logical_to_physical(Point { x: 100.0, y: 100.0 }),
            (-3690, 150)
        );
    }

    #[test]
    fn logical_round_trip() {
        let m = &fixture()[1];
        let (px, py) = m.logical_to_physical(Point { x: 123.0, y: 456.0 });
        let back = m.physical_to_logical(px, py);
        // Integer raster pixels cannot round-trip sub-pixel logical coords
        // exactly; the error is bounded by half a physical pixel.
        assert!((back.x - 123.0).abs() <= 0.5 / m.scale);
        assert!((back.y - 456.0).abs() <= 0.5 / m.scale);
        // Integer logical coords on a 1.0-scale monitor round-trip exactly.
        let m0 = &fixture()[0];
        let (qx, qy) = m0.logical_to_physical(Point { x: 123.0, y: 456.0 });
        let qback = m0.physical_to_logical(qx, qy);
        assert!((qback.x - 123.0).abs() < 1e-9);
        assert!((qback.y - 456.0).abs() < 1e-9);
    }

    #[test]
    fn virtual_point_rejects_dead_space() {
        let monitors = fixture();
        // (-3840,0) is the secondary's top-left: inside.
        assert_eq!(
            virtual_point_to_physical(-3840, 0, &monitors),
            Some((-3840, 0))
        );
        // (500, 3000) is below both monitors: dead space → None, not a snap.
        assert_eq!(virtual_point_to_physical(500, 3000, &monitors), None);
    }

    #[test]
    fn cross_monitor_region_splits_per_monitor() {
        let monitors = fixture();
        // Region from x=-100 (secondary) to x=300 (primary), y 100..300.
        let pieces = split_rect_by_monitors(
            Rect {
                x: -100.0,
                y: 100.0,
                w: 400.0,
                h: 200.0,
            },
            &monitors,
        );
        assert_eq!(pieces.len(), 2);
        assert_eq!(
            pieces[0],
            (
                0,
                RectI {
                    x: 0,
                    y: 100,
                    w: 300,
                    h: 200
                }
            )
        );
        assert_eq!(
            pieces[1],
            (
                1,
                RectI {
                    x: -100,
                    y: 100,
                    w: 100,
                    h: 200
                }
            )
        );
    }

    #[test]
    fn region_outside_all_monitors_yields_nothing() {
        let monitors = fixture();
        let pieces = split_rect_by_monitors(
            Rect {
                x: 5000.0,
                y: 5000.0,
                w: 100.0,
                h: 100.0,
            },
            &monitors,
        );
        assert!(pieces.is_empty());
    }

    #[test]
    fn empty_and_inverted_rects_are_safe() {
        let monitors = fixture();
        assert!(split_rect_by_monitors(
            Rect {
                x: 10.0,
                y: 10.0,
                w: 0.0,
                h: 50.0
            },
            &monitors
        )
        .is_empty());
        // Dragged up-left: normalized before splitting.
        let pieces = split_rect_by_monitors(
            Rect {
                x: 300.0,
                y: 300.0,
                w: -400.0,
                h: -200.0,
            },
            &monitors,
        );
        assert_eq!(pieces.len(), 2);
    }

    #[test]
    fn css_to_physical_uses_dpr_and_origin() {
        // Webview content starts at virtual (100, 50) on a 150% monitor.
        let r = css_to_physical(
            Rect {
                x: 10.0,
                y: 20.0,
                w: 200.0,
                h: 100.0,
            },
            (100, 50),
            1.5,
        );
        assert_eq!(
            r,
            RectI {
                x: 115,
                y: 80,
                w: 300,
                h: 150
            }
        );
    }

    #[test]
    fn rect_intersect_edge_cases() {
        let a = RectI {
            x: 0,
            y: 0,
            w: 100,
            h: 100,
        };
        let touching = RectI {
            x: 100,
            y: 0,
            w: 50,
            h: 50,
        };
        assert_eq!(a.intersect(touching), None); // edge-touch is not overlap
        let b = RectI {
            x: 50,
            y: 50,
            w: 100,
            h: 100,
        };
        assert_eq!(
            a.intersect(b),
            Some(RectI {
                x: 50,
                y: 50,
                w: 50,
                h: 50
            })
        );
    }

    #[test]
    fn negative_origin_monitor_contains_its_points() {
        let m = &fixture()[1];
        assert!(m.bounds_virtual().contains_point(-1, 100));
        assert!(!m.bounds_virtual().contains_point(0, 100)); // x=0 is exclusive edge
        assert!(m.bounds_virtual().contains_point(-3840, 0));
    }

    #[test]
    fn virtual_to_logical_placement_divides_by_scale() {
        // 100% primary: identity.
        let m0 = &fixture()[0];
        let p = m0.virtual_to_logical_placement(1920, 1080);
        assert_eq!((p.x, p.y), (1920.0, 1080.0));
        // 150% secondary at virtual origin (-3840, 0): placement origin is
        // (-2560, 0) logical, and the physical size (3840, 2160) maps to the
        // logical size (2560, 1440).
        let m1 = &fixture()[1];
        let p = m1.virtual_to_logical_placement(-3840, 0);
        assert_eq!((p.x, p.y), (-2560.0, 0.0));
        let size = m1.virtual_to_logical_placement(3840, 2160);
        assert_eq!(
            (size.x as u32, size.y as u32),
            m1.size_logical,
            "physical size / scale must equal the logical size used for inner_size"
        );
    }
}
