//! Scrolling capture machinery (Rung 2b).
//!
//! Pure, platform-neutral orchestration for the two scrolling acquisition
//! engines ([`crate::engines::DomAwareScrollEngine`] and
//! [`crate::engines::RasterObservationScrollEngine`]). The OS-thin part is
//! the [`ScrollDriver`] trait: real drivers live behind `#[cfg(windows)]` in
//! [`crate::native`]; tests drive [`run_scroll`] with [`MockScrollDriver`].
//!
//! Algorithm (vertical; horizontal runs the same code on transposed tiles):
//! 1. Capture tile 0 (the viewport).
//! 2. Scroll by one viewport-minus-overlap step, settle, capture the next
//!    tile.
//! 3. Detect sticky chrome (identical leading/trailing rows across frames)
//!    and measure the real content displacement with
//!    [`detect_scroll_offset`] on the chrome-excluded row profiles.
//! 4. Repeat until the end is reached (DOM-aware: scroll geometry says so;
//!    raster: commanded scrolls stop moving the content), a safeguard trips,
//!    the target dies, or the user aborts.
//! 5. Assemble tiles on a canvas with chrome trimmed, composite, encode,
//!    and classify into [`crate::result::ScrollingResult`].
//!
//! Honesty rules enforced here, not just documented:
//! - A target that never moves is a loud `Failed`, never a one-tile
//!   "complete" (the raster engine cannot tell "fits in viewport" from
//!   "refuses to scroll").
//! - Any gap, stall, overshoot, or mid-run failure becomes `Incomplete`
//!   with missing regions and reasons, or `Failed` with evidence. Partial
//!   success is never silent.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::artifact::{self, CaptureArtifact, CaptureKind, CursorState, RasterMime, ScrollSection};
use crate::coords::{Monitor, Rect, RectI};
use crate::engines::composite_tiles;
use crate::png;
use crate::result::{
    CaptureError, CapturedRegion, MissingRegion, ScrollIncompleteReason, ScrollingResult,
};
use crate::timestamp;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Fraction of the viewport kept as overlap between consecutive tiles.
pub const SCROLL_OVERLAP_FRACTION: f64 = 0.15;
/// Default ceiling on total scrolled distance (px). Trips `EngineLimit`,
/// which is also what stops runaway infinite-scroll targets.
pub const DEFAULT_MAX_DISTANCE_PX: u64 = 16384;
/// Default ceiling on tile count (memory safeguard).
pub const DEFAULT_MAX_TILES: u32 = 48;
/// Consecutive no-movement frames before the raster engine assumes the end.
pub const DEFAULT_STILL_LIMIT: u32 = 3;
/// Pause after each scroll so the target settles before capture.
pub const DEFAULT_SETTLE_MS: u64 = 250;
/// Requested wheel step per raster iteration (the engine measures what
/// actually happened; this is only the request).
pub const WHEEL_STEP_PX: i64 = 240;

/// Scroll axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScrollDirection {
    Vertical,
    Horizontal,
}

impl ScrollDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            ScrollDirection::Vertical => "vertical",
            ScrollDirection::Horizontal => "horizontal",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "vertical" => Ok(ScrollDirection::Vertical),
            "horizontal" => Ok(ScrollDirection::Horizontal),
            other => Err(format!("unknown scroll direction: {other}")),
        }
    }
}

/// What to scroll.
#[derive(Debug, Clone)]
pub enum ScrollTarget {
    /// Scroll the given window (from `native::list_windows`).
    Window { window_id: String },
    /// Scroll the content under this virtual-desktop rect (physical px).
    /// Raster-observation only: a bare rect exposes no scroll geometry.
    Region { rect: Rect },
}

/// Which engine family to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrollEngineKind {
    DomAware,
    RasterObservation,
    /// Try DOM-aware; fall back to raster-observation when the target
    /// exposes no usable scroll geometry.
    Auto,
}

impl ScrollEngineKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ScrollEngineKind::DomAware => "dom-aware",
            ScrollEngineKind::RasterObservation => "raster-observation",
            ScrollEngineKind::Auto => "auto",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "dom-aware" => Ok(ScrollEngineKind::DomAware),
            "raster-observation" => Ok(ScrollEngineKind::RasterObservation),
            "auto" => Ok(ScrollEngineKind::Auto),
            other => Err(format!("unknown scrolling engine: {other}")),
        }
    }
}

/// Scroll-bar geometry as exposed by the OS (DOM-aware engine only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollGeometry {
    pub min: i64,
    pub max: i64,
    pub page: u64,
    pub pos: i64,
}

impl ScrollGeometry {
    /// True when the geometry describes a genuinely scrollable control.
    pub fn scrollable(&self) -> bool {
        self.page > 0 && (self.max - self.min) as u64 > self.page
    }

    /// Positions remaining before the end: `max - page + 1` is the last
    /// valid scroll position for Win32-style scroll bars.
    pub fn remaining(&self) -> i64 {
        (self.max - self.page as i64 + 1) - self.pos
    }
}

/// Safeguard limits for a scroll run.
#[derive(Debug, Clone)]
pub struct ScrollLimits {
    pub max_distance_px: u64,
    pub max_tiles: u32,
    pub still_limit: u32,
    pub settle_ms: u64,
}

impl Default for ScrollLimits {
    fn default() -> Self {
        ScrollLimits {
            max_distance_px: DEFAULT_MAX_DISTANCE_PX,
            max_tiles: DEFAULT_MAX_TILES,
            still_limit: DEFAULT_STILL_LIMIT,
            settle_ms: DEFAULT_SETTLE_MS,
        }
    }
}

/// Progress snapshot for the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ScrollProgress {
    pub tiles_captured: u32,
    pub distance_px: u64,
    pub tiles_expected: Option<u32>,
}

/// Progress callback invoked after every captured tile.
pub type ProgressCallback = Arc<dyn Fn(ScrollProgress) + Send + Sync>;
/// Cooperative cancellation flag, checked between tiles.
pub type AbortFlag = Arc<AtomicBool>;

/// One scrolling capture request.
pub struct ScrollRequest {
    pub id: String,
    pub target: ScrollTarget,
    pub engine: ScrollEngineKind,
    pub direction: ScrollDirection,
    pub limits: ScrollLimits,
    pub on_progress: Option<ProgressCallback>,
    pub abort: Option<AbortFlag>,
}

impl ScrollRequest {
    pub fn aborted(&self) -> bool {
        self.abort
            .as_ref()
            .map(|f| f.load(Ordering::Relaxed))
            .unwrap_or(false)
    }

    fn progress(&self, tiles_captured: u32, distance_px: u64, tiles_expected: Option<u32>) {
        if let Some(cb) = &self.on_progress {
            cb(ScrollProgress {
                tiles_captured,
                distance_px,
                tiles_expected,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Driver trait (the OS boundary)
// ---------------------------------------------------------------------------

/// OS-thin scrolling driver. Real implementations live behind
/// `#[cfg(windows)]` in [`crate::native`]; tests use [`MockScrollDriver`].
///
/// All pixel buffers are viewport-sized RGBA, row-major. For horizontal
/// scrolls the caller transposes tiles, so drivers always think vertically.
pub trait ScrollDriver {
    /// Human-readable target description for logs and evidence.
    fn target_label(&self) -> String;
    /// Viewport size in physical px.
    fn viewport_size(&mut self) -> Result<(u32, u32), CaptureError>;
    /// Capture the current viewport. The cursor is always excluded from
    /// scrolling tiles (it would smear across the stitch).
    fn capture_viewport(&mut self) -> Result<Vec<u8>, CaptureError>;
    /// Scroll-bar geometry, when the target exposes it. `None` selects the
    /// raster-observation path (measure, don't trust).
    fn scroll_geometry(&mut self) -> Option<ScrollGeometry>;
    /// Scroll by `delta_px` along the axis (positive = down/right).
    fn scroll_by(&mut self, delta_px: i64) -> Result<(), CaptureError>;
    /// False when the target went away (window closed, …).
    fn target_alive(&mut self) -> bool;
}

// ---------------------------------------------------------------------------
// Pure pixel analysis
// ---------------------------------------------------------------------------

/// Per-row mean luminance (ITU-R BT.601), scaled by 256 to stay integral.
/// Range per row: 0..=65280.
pub fn luminance_rows(rgba: &[u8], w: u32, h: u32) -> Vec<u32> {
    assert_eq!(rgba.len(), w as usize * h as usize * 4);
    let mut rows = Vec::with_capacity(h as usize);
    for y in 0..h as usize {
        let mut sum: u64 = 0;
        for x in 0..w as usize {
            let o = (y * w as usize + x) * 4;
            sum += 77 * rgba[o] as u64 + 150 * rgba[o + 1] as u64 + 29 * rgba[o + 2] as u64;
        }
        rows.push((sum / w as u64) as u32);
    }
    rows
}

/// Measure content displacement between two consecutive frames from their
/// row-luminance profiles. Returns the shift `dy` such that `curr`'s row 0
/// matches `prev`'s row `dy`; positive means the content moved up (the view
/// scrolled down). `None` when no shift in `[-max_search, max_search]` wins
/// confidently — the caller treats that as a still frame.
///
/// Confidence requires the winner to beat the runner-up by >25% *and* an
/// absolute per-row SAD below ~6% of the luminance range, so uniform or
/// noisy frames report `None` instead of a hallucinated offset.
pub fn detect_scroll_offset(prev: &[u32], curr: &[u32], max_search: u32) -> Option<i64> {
    let h = prev.len();
    if h == 0 || curr.len() != h || max_search == 0 {
        return None;
    }
    let max_search = (max_search as usize).min(h / 2) as i64;
    if max_search == 0 {
        return None;
    }
    let mut best: Option<(i64, u64)> = None;
    let mut second_best = u64::MAX;
    for dy in -max_search..=max_search {
        let (p0, c0, len) = if dy >= 0 {
            (dy as usize, 0, h - dy as usize)
        } else {
            (0, (-dy) as usize, h - (-dy) as usize)
        };
        if len < h / 2 {
            continue;
        }
        let mut sad: u64 = 0;
        for i in 0..len {
            sad += (prev[p0 + i] as i64 - curr[c0 + i] as i64).unsigned_abs();
        }
        match best {
            None => best = Some((dy, sad)),
            Some((_, b)) if sad < b => {
                second_best = b;
                best = Some((dy, sad));
            }
            _ => {
                if sad < second_best {
                    second_best = sad;
                }
            }
        }
    }
    let (dy, sad) = best?;
    // Margin over the runner-up: the winner must beat it by >25%.
    if second_best != u64::MAX && second_best <= sad + second_best / 4 {
        return None;
    }
    // Absolute quality: mean per-row SAD below ~6% of the 0..=65280 range.
    if sad / h as u64 > 4000 {
        return None;
    }
    Some(dy)
}

/// Detect sticky chrome: leading rows identical across frames (a header that
/// did not scroll) and trailing rows identical (a footer). Returns
/// `(header_rows, footer_rows)`, each capped at a quarter of the height so a
/// pathological full-frame match can never eat the content.
///
/// Tolerance is ~3/255 mean channel deviation per row: enough for real
/// pixels, far below what scrolled content produces.
pub fn detect_chrome(prev: &[u8], curr: &[u8], w: u32, h: u32) -> (u32, u32) {
    if prev.len() != curr.len() || w == 0 || h == 0 || prev.len() != w as usize * h as usize * 4 {
        return (0, 0);
    }
    let stride = w as usize * 4;
    let tol = w as u64 * 4 * 3;
    let row_diff = |r: usize| -> u64 {
        let mut d: u64 = 0;
        for x in 0..w as usize {
            let o = r * stride + x * 4;
            d += (prev[o] as i64 - curr[o] as i64).unsigned_abs()
                + (prev[o + 1] as i64 - curr[o + 1] as i64).unsigned_abs()
                + (prev[o + 2] as i64 - curr[o + 2] as i64).unsigned_abs()
                + (prev[o + 3] as i64 - curr[o + 3] as i64).unsigned_abs();
        }
        d
    };
    let cap = h / 4;
    let mut header = 0u32;
    while header < cap && row_diff(header as usize) <= tol {
        header += 1;
    }
    let mut footer = 0u32;
    while header + footer < h / 2
        && footer < cap
        && row_diff(h as usize - 1 - footer as usize) <= tol
    {
        footer += 1;
    }
    (header, footer)
}

/// Transpose an RGBA buffer (w×h → h×w). Lets the horizontal path reuse the
/// vertical algorithm verbatim.
pub fn transpose_rgba(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    assert_eq!(rgba.len(), w as usize * h as usize * 4);
    let mut out = vec![0u8; rgba.len()];
    for y in 0..h as usize {
        for x in 0..w as usize {
            let src = (y * w as usize + x) * 4;
            let dst = (x * h as usize + y) * 4;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/// One captured tile in axis-normalized space (transposed for horizontal).
#[derive(Clone)]
struct RawTile {
    id: String,
    /// RGBA in normalized orientation: width = viewport width (transposed
    /// for horizontal), height = axis length.
    rgba: Vec<u8>,
    w: u32,
    h: u32,
    /// Canvas position of this tile's first *content* row (after the
    /// header trim). Tile 0 is 0 by definition; later tiles accumulate the
    /// measured content displacements.
    axis_pos: i64,
    /// Sticky chrome, in rows of the normalized orientation.
    header: u32,
    footer: u32,
}

/// Assemble tiles into a canvas: trim chrome (sticky bands are
/// viewport-fixed, so every tile trims its own detected header/footer),
/// place by measured content positions, composite in z-order. Returns
/// `(rgba, width, height)` in normalized orientation.
fn assemble_tiles(tiles: &[RawTile], dir: ScrollDirection) -> Result<(Vec<u8>, u32, u32), String> {
    if tiles.is_empty() {
        return Err("no tiles to assemble".to_string());
    }
    let w = tiles[0].w;
    let mut placements: Vec<(RectI, Vec<u8>)> = Vec::with_capacity(tiles.len());
    let mut canvas_h: i64 = 0;
    for t in tiles.iter() {
        if t.w != w {
            return Err(format!(
                "tile {} width {} differs from first tile width {w}",
                t.id, t.w
            ));
        }
        let top_trim = t.header;
        let bot_trim = t.footer;
        if top_trim + bot_trim >= t.h {
            return Err(format!("tile {} chrome trims exceed tile height", t.id));
        }
        let rows = t.h - top_trim - bot_trim;
        // axis_pos is the canvas position of the first content row, so the
        // trimmed content lands exactly there.
        let y = t.axis_pos;
        let mut bytes = Vec::with_capacity(w as usize * rows as usize * 4);
        let stride = w as usize * 4;
        for r in top_trim..t.h - bot_trim {
            let o = r as usize * stride;
            bytes.extend_from_slice(&t.rgba[o..o + stride]);
        }
        placements.push((
            RectI {
                x: 0,
                y,
                w: w as u64,
                h: rows as u64,
            },
            bytes,
        ));
        canvas_h = canvas_h.max(y + rows as i64);
    }
    if canvas_h <= 0 {
        return Err("assembled canvas has no height".to_string());
    }
    if canvas_h > artifact::MAX_ARTIFACT_DIMENSION as i64 {
        return Err(format!(
            "assembled canvas height {canvas_h} exceeds the {}px cap",
            artifact::MAX_ARTIFACT_DIMENSION
        ));
    }
    let canvas_w = w;
    let canvas_h = canvas_h as u32;
    let mut canvas = composite_tiles(canvas_w, canvas_h, &placements).map_err(|e| e.to_string())?;
    if dir == ScrollDirection::Horizontal {
        canvas = transpose_rgba(&canvas, canvas_w, canvas_h);
        Ok((canvas, canvas_h, canvas_w))
    } else {
        Ok((canvas, canvas_w, canvas_h))
    }
}

/// Normalize a tile for the axis: transpose when horizontal so the rest of
/// the pipeline always works "vertically".
fn normalize_tile(rgba: Vec<u8>, w: u32, h: u32, dir: ScrollDirection) -> (Vec<u8>, u32, u32) {
    if dir == ScrollDirection::Horizontal {
        (transpose_rgba(&rgba, w, h), h, w)
    } else {
        (rgba, w, h)
    }
}

/// Complete immediately with exactly one tile: the DOM-aware geometry proved
/// the content fits in the viewport. `content_rows`, when `Some`, crops the
/// tile to the geometry-proven content extent so desktop background behind
/// a short document is not presented as document.
fn complete_single_tile(
    req: &ScrollRequest,
    tiles: &[RawTile],
    engine_name: &str,
    monitors: &[Monitor],
    dir: ScrollDirection,
    content_rows: Option<u32>,
) -> ScrollingResult {
    let mut tiles = tiles.to_vec();
    if let (Some(rows), Some(t)) = (content_rows, tiles.first_mut()) {
        // Normalized space is always "vertical": the axis is the height.
        if rows > 0 && rows < t.h {
            let stride = t.w as usize * 4;
            t.rgba.truncate(rows as usize * stride);
            t.h = rows;
        }
    }
    let (canvas_rgba, cw, ch) = match assemble_tiles(&tiles, dir) {
        Ok(t) => t,
        Err(e) => {
            return ScrollingResult::failed("scrolling stitch failed", vec![format!("stitch: {e}")])
        }
    };
    let png_bytes = match png::encode_rgba(cw, ch, &canvas_rgba) {
        Ok(b) => b,
        Err(e) => {
            return ScrollingResult::failed(
                "scrolling encode failed",
                vec![format!("png encode: {e}")],
            )
        }
    };
    let scale = monitor_scale_for_target(req, monitors);
    let (window, monitor) = target_provenance(req, monitors);
    match CaptureArtifact::new(
        req.id.clone(),
        CaptureKind::Scrolling,
        png_bytes,
        RasterMime::Png,
        cw,
        ch,
        monitor,
        window,
        scale,
        CursorState {
            captured: false,
            position_physical: None,
        },
        timestamp::now_utc_iso8601(),
        None,
    ) {
        Ok(a) => ScrollingResult::Complete {
            artifact: a.with_scroll_info(ScrollSection {
                engine: engine_name.to_string(),
                direction: dir.as_str().to_string(),
                tiles_captured: 1,
                distance_px: 0,
                complete: true,
                reason: None,
            }),
        },
        Err(e) => ScrollingResult::failed(
            "scrolling artifact failed validation",
            vec![format!("artifact: {e}")],
        ),
    }
}

/// End-of-run classification shared by both engines.
#[allow(clippy::too_many_arguments)]
fn finish_incomplete(
    req: &ScrollRequest,
    tiles: &[RawTile],
    completed: Vec<CapturedRegion>,
    missing: Vec<MissingRegion>,
    reason: ScrollIncompleteReason,
    dir: ScrollDirection,
    engine_name: &str,
) -> ScrollingResult {
    let partial_artifact = if tiles.is_empty() {
        None
    } else {
        assemble_tiles(tiles, dir).ok().and_then(|(rgba, w, h)| {
            png::encode_rgba(w, h, &rgba)
                .ok()
                .and_then(|png_bytes| {
                    CaptureArtifact::new(
                        format!("{}-partial", req.id),
                        CaptureKind::Scrolling,
                        png_bytes,
                        RasterMime::Png,
                        w,
                        h,
                        None,
                        None,
                        1.0,
                        CursorState {
                            captured: false,
                            position_physical: None,
                        },
                        timestamp::now_utc_iso8601(),
                        None,
                    )
                    .ok()
                })
                .map(|a| {
                    a.with_scroll_info(ScrollSection {
                        engine: engine_name.to_string(),
                        direction: dir.as_str().to_string(),
                        tiles_captured: tiles.len() as u32,
                        distance_px: tiles.last().map(|t| t.axis_pos.max(0) as u64).unwrap_or(0),
                        complete: false,
                        reason: Some(reason.to_string()),
                    })
                })
        })
    };
    // `incomplete` rejects a missing-less result; every caller here passes
    // at least one missing region or this is a bug — fall back to Failed
    // rather than panicking.
    match ScrollingResult::incomplete(partial_artifact, completed, missing, reason.clone()) {
        Ok(r) => r,
        Err(e) => ScrollingResult::failed(
            format!("scrolling incomplete but no missing regions recorded ({e}): {reason}"),
            vec!["internal classification error".to_string()],
        ),
    }
}

/// The shared scroll loop. `engine_name` is the *resolved* engine
/// ("dom-aware" or "raster-observation") for provenance.
/// Run a scrolling capture against `driver`, returning Complete, Incomplete,
/// or Failed — never a silent partial.
///
/// `use_geometry` selects the engine mode: DOM-aware trusts the driver's
/// scroll geometry for end detection (and overshoot detection); the
/// raster-observation engine passes false and measures everything in
/// pixels, even if the driver happens to expose geometry.
pub fn run_scroll(
    driver: &mut dyn ScrollDriver,
    req: &ScrollRequest,
    engine_name: &str,
    monitors: &[Monitor],
    use_geometry: bool,
) -> ScrollingResult {
    let dir = req.direction;
    let horizontal = dir == ScrollDirection::Horizontal;
    let mut evidence = vec![
        format!("target: {}", driver.target_label()),
        format!("engine: {engine_name}"),
        format!("direction: {}", dir.as_str()),
    ];

    if !driver.target_alive() {
        evidence.push("target disappeared before the first tile".to_string());
        return ScrollingResult::failed("scroll target is gone", evidence);
    }
    let (vw, vh) = match driver.viewport_size() {
        Ok((w, h)) if w > 0 && h > 0 => (w, h),
        Ok(_) => {
            evidence.push("viewport reported zero size".to_string());
            return ScrollingResult::failed("scroll viewport has zero size", evidence);
        }
        Err(e) => {
            evidence.push(format!("viewport_size: {e}"));
            return ScrollingResult::failed("cannot determine scroll viewport", evidence);
        }
    };
    let axis_len = if horizontal { vw } else { vh } as i64;
    let overlap = ((axis_len as f64 * SCROLL_OVERLAP_FRACTION).round() as i64).max(1);
    let max_search = (axis_len / 2).max(16) as u32;

    let dom_aware = use_geometry;

    // Phase 0: rewind to the top so the capture covers the whole document,
    // not "wherever the scrollbar happened to be".
    if dom_aware {
        // Exact: one positioning command via the scroll-bar geometry.
        if let Some(g) = driver.scroll_geometry() {
            if g.pos > g.min {
                evidence.push(format!("rewound from scroll position {} to top", g.pos));
                if let Err(e) = driver.scroll_by(g.min - g.pos) {
                    evidence.push(format!("rewind failed: {e}"));
                    return ScrollingResult::failed("could not rewind to top of target", evidence);
                }
                std::thread::sleep(Duration::from_millis(req.limits.settle_ms));
            }
        }
    } else {
        // Best effort: scroll up until two consecutive frames are identical.
        // GDI captures of a static window are bit-identical, so equality
        // here is a reliable "at top" signal, not a guess.
        // Proceed on error; the tile-0 capture reports real errors.
        let mut top = driver.capture_viewport().unwrap_or_default();
        let mut ups = 0u32;
        for _ in 0..64 {
            if driver.scroll_by(-axis_len).is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(req.limits.settle_ms));
            match driver.capture_viewport() {
                Ok(f) => {
                    if f == top {
                        break;
                    }
                    top = f;
                    ups += 1;
                }
                Err(_) => break,
            }
        }
        if ups > 0 {
            evidence.push(format!(
                "raster top-seek rewound {ups} viewports to reach the top"
            ));
        }
    }

    // Tile 0.
    let first = match driver.capture_viewport() {
        Ok(px) => px,
        Err(e) => {
            evidence.push(format!("first tile capture: {e}"));
            return ScrollingResult::failed("first scroll tile failed to capture", evidence);
        }
    };
    let (nrgba0, nw0, nh0) = normalize_tile(first, vw, vh, dir);
    let mut tiles = vec![RawTile {
        id: "tile-0".to_string(),
        rgba: nrgba0,
        w: nw0,
        h: nh0,
        axis_pos: 0,
        header: 0,
        footer: 0,
    }];
    req.progress(1, 0, None);

    let mut tiles_expected: Option<u32> = None;
    if dom_aware {
        if let Some(g) = driver.scroll_geometry() {
            if !g.scrollable() {
                // DOM-aware and exact: the content fits in the viewport.
                // A single tile is the complete capture; crop it to the
                // content extent (max+1) so desktop background behind a
                // short document is not presented as document.
                let content_rows = (g.max - g.min + 1).max(0) as u32;
                return complete_single_tile(
                    req,
                    &tiles,
                    engine_name,
                    monitors,
                    dir,
                    Some(content_rows),
                );
            }
            if g.remaining() > 0 {
                let step0 = (axis_len - overlap).max(1).min(axis_len / 2).max(1);
                tiles_expected = Some(((g.remaining() + step0 - 1) / step0 + 1).max(1) as u32);
            } else {
                tiles_expected = Some(1);
            }
        }
    }

    let mut completed = vec![CapturedRegion {
        rect: RectI {
            x: 0,
            y: 0,
            w: nw0 as u64,
            h: nh0 as u64,
        },
        tile_id: "tile-0".to_string(),
    }];
    let mut missing: Vec<MissingRegion> = vec![];
    let mut axis_pos: i64 = 0;
    let mut stills: u32 = 0;
    let mut moved_once = false;
    let mut tile_failures: u32 = 0;
    // Largest chrome band seen so far; keeps the step inside the
    // correlator's measurable range as chrome is discovered.
    let mut bands_est: u32 = 0;

    loop {
        if req.aborted() {
            missing.push(MissingRegion {
                rect: RectI {
                    x: 0,
                    y: axis_pos + axis_len,
                    w: nw0 as u64,
                    h: axis_len.max(0) as u64,
                },
                attempts: 1,
                last_error: "aborted by user".to_string(),
            });
            return finish_incomplete(
                req,
                &tiles,
                completed,
                missing,
                ScrollIncompleteReason::UserAborted,
                dir,
                engine_name,
            );
        }
        if tiles.len() as u32 >= req.limits.max_tiles {
            let limit = format!("max tiles ({})", req.limits.max_tiles);
            missing.push(MissingRegion {
                rect: RectI {
                    x: 0,
                    y: axis_pos + axis_len,
                    w: nw0 as u64,
                    h: axis_len.max(0) as u64,
                },
                attempts: 1,
                last_error: "tile budget exhausted; target may scroll forever".to_string(),
            });
            evidence.push(format!("stopped: {limit}"));
            return finish_incomplete(
                req,
                &tiles,
                completed,
                missing,
                ScrollIncompleteReason::EngineLimit { limit },
                dir,
                engine_name,
            );
        }
        if axis_pos as u64 > req.limits.max_distance_px {
            let limit = format!("max distance ({}px)", req.limits.max_distance_px);
            missing.push(MissingRegion {
                rect: RectI {
                    x: 0,
                    y: axis_pos,
                    w: nw0 as u64,
                    h: axis_len.max(0) as u64,
                },
                attempts: 1,
                last_error: "distance budget exhausted; target may scroll forever".to_string(),
            });
            return finish_incomplete(
                req,
                &tiles,
                completed,
                missing,
                ScrollIncompleteReason::EngineLimit { limit },
                dir,
                engine_name,
            );
        }
        if !driver.target_alive() {
            missing.push(MissingRegion {
                rect: RectI {
                    x: 0,
                    y: axis_pos + axis_len,
                    w: nw0 as u64,
                    h: axis_len.max(0) as u64,
                },
                attempts: 1,
                last_error: "target window closed or moved mid-scroll".to_string(),
            });
            return finish_incomplete(
                req,
                &tiles,
                completed,
                missing,
                ScrollIncompleteReason::TargetChanged,
                dir,
                engine_name,
            );
        }

        // Decide the step. The correlator needs at least 50% frame overlap
        // to measure a shift, so the step is capped at half the
        // chrome-adjusted content length; a larger step would be
        // unmeasurable and alias to a wrong displacement. The very first
        // scroll is extra conservative (quarter viewport): chrome is still
        // unknown, and this keeps the first shift measurable against any
        // chrome up to the detection cap.
        let mut step: i64 = if tiles.len() == 1 {
            (axis_len / 4).max(1)
        } else {
            let content_len = (axis_len - bands_est as i64).max(axis_len / 2);
            (axis_len - overlap).max(1).min(content_len / 2).max(1)
        };
        // DOM-aware: exact end detection and overshoot detection from the
        // geometry the driver reports.
        let pos_before = driver.scroll_geometry().map(|g| g.pos);
        if dom_aware {
            if let Some(g) = driver.scroll_geometry() {
                if g.scrollable() {
                    let remaining = g.remaining();
                    if remaining <= 0 {
                        break; // Geometry says we are at the end.
                    }
                    step = step.min(remaining);
                }
            }
        }

        if let Err(e) = driver.scroll_by(step) {
            missing.push(MissingRegion {
                rect: RectI {
                    x: 0,
                    y: axis_pos + axis_len,
                    w: nw0 as u64,
                    h: axis_len.max(0) as u64,
                },
                attempts: 1,
                last_error: format!("scroll input failed: {e}"),
            });
            return finish_incomplete(
                req,
                &tiles,
                completed,
                missing,
                ScrollIncompleteReason::PartialTileFailure,
                dir,
                engine_name,
            );
        }
        std::thread::sleep(Duration::from_millis(req.limits.settle_ms));

        // DOM-aware overshoot check: the geometry reports the true scroll
        // position, so a step that moved further than one viewport is
        // caught exactly — the rows between are genuinely missing and no
        // correlator could align the frames.
        if dom_aware {
            if let (Some(before), Some(after)) =
                (pos_before, driver.scroll_geometry().map(|g| g.pos))
            {
                let actual = after - before;
                if actual > axis_len {
                    missing.push(MissingRegion {
                        rect: RectI {
                            x: 0,
                            y: axis_pos + axis_len,
                            w: nw0 as u64,
                            h: (actual - axis_len).max(0) as u64,
                        },
                        attempts: 1,
                        last_error: format!(
                            "scroll step moved {actual}px, more than the {axis_len}px viewport"
                        ),
                    });
                    return finish_incomplete(
                        req,
                        &tiles,
                        completed,
                        missing,
                        ScrollIncompleteReason::ScrollOvershoot,
                        dir,
                        engine_name,
                    );
                }
            }
        }

        let raw = match driver.capture_viewport() {
            Ok(px) => px,
            Err(first_err) => {
                // One retry after a settle; then the tile is declared lost.
                std::thread::sleep(Duration::from_millis(req.limits.settle_ms));
                match driver.capture_viewport() {
                    Ok(px) => px,
                    Err(second_err) => {
                        tile_failures += 1;
                        evidence.push(format!(
                            "tile {} capture failed twice: {first_err} / {second_err}",
                            tiles.len()
                        ));
                        missing.push(MissingRegion {
                            rect: RectI {
                                x: 0,
                                y: axis_pos + step,
                                w: nw0 as u64,
                                h: axis_len.max(0) as u64,
                            },
                            attempts: 2,
                            last_error: second_err.to_string(),
                        });
                        if tile_failures >= 2 {
                            return finish_incomplete(
                                req,
                                &tiles,
                                completed,
                                missing,
                                ScrollIncompleteReason::PartialTileFailure,
                                dir,
                                engine_name,
                            );
                        }
                        // Single lost tile: keep going; the gap is recorded.
                        continue;
                    }
                }
            }
        };
        let (nrgba, nw, nh) = normalize_tile(raw, vw, vh, dir);
        if nw != nw0 || nh != nh0 {
            evidence.push(format!(
                "tile {} size {nw}x{nh} differs from first tile {nw0}x{nh0}",
                tiles.len()
            ));
            return ScrollingResult::failed("scroll viewport changed size mid-run", evidence);
        }

        let prev = tiles.last().expect("at least tile 0");
        let (header, footer) = detect_chrome(&prev.rgba, &nrgba, nw, nh);
        // Measure displacement on the chrome-excluded middle band.
        let band_top = header as usize;
        let band_bottom = nh as usize - footer as usize;
        let measured = if band_bottom > band_top + (nh as usize / 4) {
            let stride = nw as usize * 4;
            let prev_band: Vec<u8> = prev.rgba[band_top * stride..band_bottom * stride].to_vec();
            let curr_band: Vec<u8> = nrgba[band_top * stride..band_bottom * stride].to_vec();
            let band_h = (band_bottom - band_top) as u32;
            detect_scroll_offset(
                &luminance_rows(&prev_band, nw, band_h),
                &luminance_rows(&curr_band, nw, band_h),
                max_search,
            )
        } else {
            None
        };

        match measured {
            Some(dy) if dy > 0 => {
                axis_pos += dy;
                moved_once = true;
                stills = 0;
                let tile_id = format!("tile-{}", tiles.len());
                completed.push(CapturedRegion {
                    rect: RectI {
                        x: 0,
                        y: axis_pos,
                        w: nw as u64,
                        h: nh as u64,
                    },
                    tile_id: tile_id.clone(),
                });
                tiles.push(RawTile {
                    id: tile_id,
                    rgba: nrgba,
                    w: nw,
                    h: nh,
                    axis_pos,
                    header,
                    footer,
                });
                if tiles.len() == 2 {
                    // The first cross-frame comparison reveals tile 0's
                    // chrome too: sticky bands are viewport-fixed, so tile
                    // 0's are identical to tile 1's.
                    tiles[0].header = header;
                    tiles[0].footer = footer;
                }
                bands_est = bands_est.max(header + footer);
                req.progress(tiles.len() as u32, axis_pos.max(0) as u64, tiles_expected);
            }
            _ => {
                // No confident movement: still frame.
                stills += 1;
                if stills >= req.limits.still_limit {
                    break; // Assume the end (raster heuristic — documented).
                }
            }
        }
    }

    // Classification.
    if !moved_once {
        // The target never moved. The raster engine cannot distinguish "the
        // content fits in the viewport" from "the target refuses to scroll",
        // so this is a loud failure pointing at the right tool — never a
        // one-tile "complete" that might be hiding a missed capture.
        evidence.push(format!(
            "{} commanded scrolls produced no measured movement",
            req.limits.still_limit
        ));
        if dom_aware {
            // DOM-aware with zero movement and geometry already at the end:
            // the content genuinely fits — but reaching here means geometry
            // claimed scrollable earlier and then stalled, which is
            // contradictory; fail loudly rather than guess.
            evidence.push("scroll geometry was inconsistent".to_string());
        } else {
            evidence.push(
                "hint: if the content fits in the viewport, use window capture instead".to_string(),
            );
        }
        return ScrollingResult::failed("scroll target did not move", evidence);
    }

    let (canvas_rgba, cw, ch) = match assemble_tiles(&tiles, dir) {
        Ok(t) => t,
        Err(e) => {
            evidence.push(format!("stitch: {e}"));
            return ScrollingResult::failed("scrolling stitch failed", evidence);
        }
    };
    let png_bytes = match png::encode_rgba(cw, ch, &canvas_rgba) {
        Ok(b) => b,
        Err(e) => {
            evidence.push(format!("png encode: {e}"));
            return ScrollingResult::failed("scrolling encode failed", evidence);
        }
    };

    let scale = monitor_scale_for_target(req, monitors);
    let (window, monitor) = target_provenance(req, monitors);
    let artifact = match CaptureArtifact::new(
        req.id.clone(),
        CaptureKind::Scrolling,
        png_bytes,
        RasterMime::Png,
        cw,
        ch,
        monitor,
        window,
        scale,
        CursorState {
            captured: false,
            position_physical: None,
        },
        timestamp::now_utc_iso8601(),
        None,
    ) {
        Ok(a) => a.with_scroll_info(ScrollSection {
            engine: engine_name.to_string(),
            direction: dir.as_str().to_string(),
            tiles_captured: tiles.len() as u32,
            distance_px: axis_pos.max(0) as u64,
            complete: true,
            reason: None,
        }),
        Err(e) => {
            evidence.push(format!("artifact: {e}"));
            return ScrollingResult::failed("scrolling artifact failed validation", evidence);
        }
    };
    ScrollingResult::Complete { artifact }
}

/// Best-effort monitor scale for provenance: the monitor containing the
/// target's center, else 1.0.
fn monitor_scale_for_target(req: &ScrollRequest, monitors: &[Monitor]) -> f64 {
    target_center(req)
        .and_then(|(x, y)| {
            monitors.iter().find(|m| {
                let (ox, oy) = m.origin_virtual;
                let (pw, ph) = m.size_physical();
                x >= ox as i64
                    && y >= oy as i64
                    && x < ox as i64 + pw as i64
                    && y < oy as i64 + ph as i64
            })
        })
        .map(|m| m.scale)
        .unwrap_or(1.0)
}

fn target_center(req: &ScrollRequest) -> Option<(i64, i64)> {
    match &req.target {
        ScrollTarget::Region { rect } => Some((
            rect.x as i64 + rect.w as i64 / 2,
            rect.y as i64 + rect.h as i64 / 2,
        )),
        ScrollTarget::Window { .. } => None,
    }
}

fn target_provenance(
    req: &ScrollRequest,
    monitors: &[Monitor],
) -> (Option<crate::artifact::WindowIdentity>, Option<Monitor>) {
    match &req.target {
        ScrollTarget::Window { window_id } => {
            let info = crate::native::find_window(window_id, monitors).ok();
            let monitor = info.as_ref().and_then(|i| {
                let cx = i.rect_virtual.x + i.rect_virtual.w as i64 / 2;
                let cy = i.rect_virtual.y + i.rect_virtual.h as i64 / 2;
                monitors
                    .iter()
                    .find(|m| {
                        let (ox, oy) = m.origin_virtual;
                        let (pw, ph) = m.size_physical();
                        cx >= ox as i64
                            && cy >= oy as i64
                            && cx < ox as i64 + pw as i64
                            && cy < oy as i64 + ph as i64
                    })
                    .cloned()
            });
            (
                info.map(|i| crate::artifact::WindowIdentity {
                    title: i.title,
                    class_name: i.class_name,
                    process_name: i.process_name,
                    rect_virtual: i.rect_virtual,
                }),
                monitor,
            )
        }
        ScrollTarget::Region { .. } => (None, None),
    }
}

// ---------------------------------------------------------------------------
// Mock driver (tests)
// ---------------------------------------------------------------------------

/// Scripted scroll target for tests: a synthetic document with a row-varying
/// pattern and programmable misbehaviors.
///
/// The sticky-chrome model is faithful: `header_bands`/`footer_bands` rows
/// are painted *fixed in the viewport* (top/bottom, or left/right when
/// horizontal), exactly like a real sticky header/footer, while the
/// document content scrolls behind them. `expected_pixels` returns the pure
/// document so stitches can be verified pixel-exact.
#[cfg(test)]
pub struct MockScrollDriver {
    pub doc_w: u32,
    pub doc_h: u32,
    pub viewport_w: u32,
    pub viewport_h: u32,
    pub horizontal: bool,
    pub header_bands: u32,
    pub footer_bands: u32,
    pub doc: Vec<u8>,
    pub offset: i64,
    pub geometry: Option<ScrollGeometry>,
    /// After this many *successful* captures, capture_viewport fails.
    pub fail_after: Option<u32>,
    captures: u32,
    /// scroll_by becomes a no-op (target refuses to scroll).
    pub frozen: bool,
    /// Multiplies the requested scroll delta (overshoot simulation).
    pub overshoot_factor: i64,
    /// Become !alive after this many scroll_by calls.
    pub die_after: Option<u32>,
    scrolls: u32,
    pub alive: bool,
    pub label: String,
}

/// Uniform sticky-chrome color: flat so it is trivially detectable, far
/// from the content pattern.
#[cfg(test)]
const MOCK_CHROME: (u8, u8, u8) = (235, 235, 235);

#[cfg(test)]
impl MockScrollDriver {
    /// Vertical document `doc_h` rows tall, viewport `viewport_h` tall.
    pub fn new(doc_w: u32, viewport_h: u32, doc_h: u32, header_h: u32, footer_h: u32) -> Self {
        Self::build(doc_w, doc_h, doc_w, viewport_h, false, header_h, footer_h)
    }

    /// Horizontal document `doc_w` columns wide, viewport `viewport_w` wide
    /// and `viewport_h` tall. Chrome bands become left/right bars.
    pub fn new_horizontal(
        doc_w: u32,
        viewport_w: u32,
        viewport_h: u32,
        header_w: u32,
        footer_w: u32,
    ) -> Self {
        Self::build(
            doc_w, viewport_h, viewport_w, viewport_h, true, header_w, footer_w,
        )
    }

    fn build(
        doc_w: u32,
        doc_h: u32,
        viewport_w: u32,
        viewport_h: u32,
        horizontal: bool,
        hb: u32,
        fb: u32,
    ) -> Self {
        assert!(doc_w >= 1 && doc_h >= 1 && viewport_w >= 1 && viewport_h >= 1);
        let axis_vp = if horizontal { viewport_w } else { viewport_h };
        assert!(
            hb + fb < axis_vp,
            "chrome must leave at least one content row visible"
        );
        let mut doc = vec![0u8; doc_w as usize * doc_h as usize * 4];
        for y in 0..doc_h as usize {
            for x in 0..doc_w as usize {
                let o = (y * doc_w as usize + x) * 4;
                // Varying in both axes so horizontal and vertical offsets
                // are both measurable.
                doc[o] = ((x * 3 + y * 7 + x * y) % 251) as u8;
                doc[o + 1] = ((x * 5 + y * 11) % 251) as u8;
                doc[o + 2] = ((x * 13 + y * 17) % 251) as u8;
                doc[o + 3] = 255;
            }
        }
        let doc_axis = if horizontal { doc_w } else { doc_h } as i64;
        MockScrollDriver {
            doc_w,
            doc_h,
            viewport_w,
            viewport_h,
            horizontal,
            header_bands: hb,
            footer_bands: fb,
            doc,
            offset: 0,
            geometry: Some(ScrollGeometry {
                // Content-extent semantics (see ScrollGeometry::remaining):
                // max = last content index, page = content rows visible
                // per viewport (viewport minus chrome).
                min: 0,
                max: doc_axis - 1,
                page: (axis_vp - hb - fb) as u64,
                pos: 0,
            }),
            fail_after: None,
            captures: 0,
            frozen: false,
            overshoot_factor: 1,
            die_after: None,
            scrolls: 0,
            alive: true,
            label: "mock".to_string(),
        }
    }

    fn content_len(&self) -> u32 {
        let axis_vp = if self.horizontal {
            self.viewport_w
        } else {
            self.viewport_h
        };
        axis_vp - self.header_bands - self.footer_bands
    }

    fn max_offset(&self) -> i64 {
        let doc_axis = if self.horizontal {
            self.doc_w
        } else {
            self.doc_h
        } as i64;
        (doc_axis - self.content_len() as i64).max(0)
    }

    /// The exact expected stitch: the pure document, for assertions.
    pub fn expected_pixels(&self) -> Vec<u8> {
        self.doc.clone()
    }
}

#[cfg(test)]
impl ScrollDriver for MockScrollDriver {
    fn target_label(&self) -> String {
        self.label.clone()
    }

    fn viewport_size(&mut self) -> Result<(u32, u32), CaptureError> {
        Ok((self.viewport_w, self.viewport_h))
    }

    fn capture_viewport(&mut self) -> Result<Vec<u8>, CaptureError> {
        if let Some(limit) = self.fail_after {
            if self.captures >= limit {
                return Err(CaptureError::NativeApi("mock tile failure".into()));
            }
        }
        self.captures += 1;
        let vw = self.viewport_w as usize;
        let vh = self.viewport_h as usize;
        let hb = self.header_bands as usize;
        let fb = self.footer_bands as usize;
        let mut out = vec![0u8; vw * vh * 4];
        if self.horizontal {
            for y in 0..vh {
                for x in 0..vw {
                    let o = (y * vw + x) * 4;
                    let (r, g, b) = if x < hb || x >= vw - fb {
                        MOCK_CHROME
                    } else {
                        let dx = self.offset as usize + (x - hb);
                        if dx < self.doc_w as usize {
                            let s = (y * self.doc_w as usize + dx) * 4;
                            (self.doc[s], self.doc[s + 1], self.doc[s + 2])
                        } else {
                            (16, 16, 16) // past-end pad; never part of a stitch
                        }
                    };
                    out[o] = r;
                    out[o + 1] = g;
                    out[o + 2] = b;
                    out[o + 3] = 255;
                }
            }
        } else {
            let stride = self.doc_w as usize * 4;
            for y in 0..vh {
                for x in 0..vw.min(self.doc_w as usize) {
                    let o = (y * vw + x) * 4;
                    let (r, g, b) = if y < hb || y >= vh - fb {
                        MOCK_CHROME
                    } else {
                        let dy = self.offset as usize + (y - hb);
                        if dy < self.doc_h as usize {
                            let s = dy * stride + x * 4;
                            (self.doc[s], self.doc[s + 1], self.doc[s + 2])
                        } else {
                            (16, 16, 16) // past-end pad; never part of a stitch
                        }
                    };
                    out[o] = r;
                    out[o + 1] = g;
                    out[o + 2] = b;
                    out[o + 3] = 255;
                }
            }
        }
        Ok(out)
    }

    fn scroll_geometry(&mut self) -> Option<ScrollGeometry> {
        self.geometry.map(|mut g| {
            g.pos = self.offset;
            g
        })
    }

    fn scroll_by(&mut self, delta_px: i64) -> Result<(), CaptureError> {
        self.scrolls += 1;
        if let Some(die) = self.die_after {
            if self.scrolls > die {
                self.alive = false;
            }
        }
        if !self.frozen {
            let max_off = self.max_offset();
            self.offset = (self.offset + delta_px * self.overshoot_factor).clamp(0, max_off);
        }
        Ok(())
    }

    fn target_alive(&mut self) -> bool {
        self.alive
    }
}

#[cfg(test)]
fn test_request(id: &str, engine: ScrollEngineKind) -> ScrollRequest {
    ScrollRequest {
        id: id.to_string(),
        target: ScrollTarget::Window {
            window_id: "mock".to_string(),
        },
        engine,
        direction: ScrollDirection::Vertical,
        limits: ScrollLimits {
            max_distance_px: 1 << 20,
            max_tiles: 64,
            still_limit: 3,
            settle_ms: 0,
        },
        on_progress: None,
        abort: None,
    }
}

#[cfg(test)]
fn decode_artifact_png(artifact: &CaptureArtifact) -> (Vec<u8>, u32, u32) {
    let (w, h, rgba) = crate::png::decode_own(&artifact.raster_bytes).expect("decode own png");
    assert_eq!(w, artifact.raster_width);
    assert_eq!(h, artifact.raster_height);
    (rgba, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_frame(doc_w: u32, doc_h: u32, header_h: u32, footer_h: u32) -> Vec<u8> {
        MockScrollDriver::new(doc_w, 100, doc_h, header_h, footer_h).doc
    }

    #[test]
    fn offset_detects_exact_shift() {
        let doc = doc_frame(32, 300, 0, 0);
        let stride = 32 * 4;
        // prev = rows [0,100), curr = rows [40,140): content moved up 40.
        let prev_rows = luminance_rows(&doc[0..100 * stride], 32, 100);
        let curr_rows = luminance_rows(&doc[40 * stride..140 * stride], 32, 100);
        assert_eq!(detect_scroll_offset(&prev_rows, &curr_rows, 60), Some(40));
    }

    #[test]
    fn offset_detects_zero_shift() {
        let doc = doc_frame(32, 300, 0, 0);
        let stride = 32 * 4;
        let rows = luminance_rows(&doc[0..100 * stride], 32, 100);
        assert_eq!(detect_scroll_offset(&rows, &rows, 60), Some(0));
    }

    #[test]
    fn offset_rejects_garbage() {
        // Two unrelated random frames: no confident match allowed.
        let mut prev = vec![0u32; 100];
        let mut curr = vec![0u32; 100];
        let mut s: u64 = 0x12345678;
        for v in prev.iter_mut().chain(curr.iter_mut()) {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            *v = (s >> 33) as u32 % 65281;
        }
        assert_eq!(detect_scroll_offset(&prev, &curr, 50), None);
    }

    #[test]
    fn offset_rejects_uniform_frames() {
        // Identical uniform frames match at every shift with zero margin —
        // the detector must refuse to hallucinate.
        let rows = vec![32768u32; 100];
        assert_eq!(detect_scroll_offset(&rows, &rows, 50), None);
    }

    #[test]
    fn chrome_detected_on_sticky_header_footer() {
        // Sticky chrome is viewport-fixed: identical across scrolled frames
        // while the content behind it moves.
        let mut driver = MockScrollDriver::new(32, 100, 400, 12, 8);
        let a = driver.capture_viewport().expect("tile a");
        driver.scroll_by(50).expect("scroll");
        let b = driver.capture_viewport().expect("tile b");
        let (header, footer) = detect_chrome(&a, &b, 32, 100);
        assert_eq!(header, 12, "sticky header not detected");
        assert_eq!(footer, 8, "sticky footer not detected");
    }

    #[test]
    fn chrome_absent_when_nothing_sticky() {
        let mut driver = MockScrollDriver::new(32, 100, 400, 0, 0);
        let a = driver.capture_viewport().expect("tile a");
        driver.scroll_by(50).expect("scroll");
        let b = driver.capture_viewport().expect("tile b");
        assert_eq!(detect_chrome(&a, &b, 32, 100), (0, 0));
    }

    #[test]
    fn dom_aware_run_is_pixel_exact() {
        let mut driver = MockScrollDriver::new(32, 100, 350, 12, 8);
        let req = test_request("t-dom", ScrollEngineKind::DomAware);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        let artifact = result.require_complete().expect("dom run must complete");
        assert_eq!(artifact.kind, CaptureKind::Scrolling);
        let (rgba, w, h) = decode_artifact_png(&artifact);
        assert_eq!((w, h), (32, 350));
        assert_eq!(
            rgba,
            driver.expected_pixels(),
            "stitched pixels must equal the document"
        );
        let info = artifact.scroll_info.expect("scroll provenance");
        assert!(info.complete);
        assert_eq!(info.engine, "dom-aware");
        assert_eq!(info.direction, "vertical");
        assert_eq!(info.distance_px, 270); // 350 - 80 content rows per tile
    }

    #[test]
    fn raster_run_completes_via_stills_and_is_pixel_exact() {
        let mut driver = MockScrollDriver::new(32, 100, 350, 0, 0);
        driver.geometry = None; // no DOM geometry: pure raster path
        let req = test_request("t-raster", ScrollEngineKind::RasterObservation);
        let result = run_scroll(&mut driver, &req, "raster-observation", &[], false);
        let artifact = result.require_complete().expect("raster run must complete");
        let (rgba, w, h) = decode_artifact_png(&artifact);
        assert_eq!((w, h), (32, 350));
        assert_eq!(rgba, driver.expected_pixels());
        assert_eq!(artifact.scroll_info.unwrap().engine, "raster-observation");
    }

    #[test]
    fn fits_in_viewport_dom_completes_single_tile() {
        let mut driver = MockScrollDriver::new(32, 100, 80, 0, 0);
        let req = test_request("t-fit", ScrollEngineKind::DomAware);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        let artifact = result.require_complete().expect("must complete");
        let (_, _, h) = decode_artifact_png(&artifact);
        assert_eq!(h, 80);
        assert_eq!(artifact.scroll_info.unwrap().tiles_captured, 1);
    }

    #[test]
    fn unscrollable_target_fails_loudly() {
        // Frozen target, no geometry: the raster engine must NOT return a
        // one-tile "complete".
        let mut driver = MockScrollDriver::new(32, 100, 400, 0, 0);
        driver.geometry = None;
        driver.frozen = true;
        let req = test_request("t-frozen", ScrollEngineKind::RasterObservation);
        let result = run_scroll(&mut driver, &req, "raster-observation", &[], false);
        assert!(!result.is_complete());
        assert!(result.describe().contains("did not move"));
    }

    #[test]
    fn infinite_target_hits_tile_limit_as_incomplete() {
        // Endless document: the tile budget must stop it, loudly.
        let mut driver = MockScrollDriver::new(32, 100, 20000, 0, 0);
        driver.geometry = None;
        let mut req = test_request("t-inf", ScrollEngineKind::RasterObservation);
        req.limits.max_tiles = 6;
        let result = run_scroll(&mut driver, &req, "raster-observation", &[], false);
        match result {
            ScrollingResult::Incomplete {
                reason,
                missing,
                partial_artifact,
                completed,
                ..
            } => {
                assert!(matches!(reason, ScrollIncompleteReason::EngineLimit { .. }));
                assert!(!missing.is_empty());
                assert_eq!(completed.len(), 6);
                assert!(partial_artifact.is_some(), "partial pixels must be kept");
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
    }

    #[test]
    fn tile_failure_mid_run_is_incomplete_with_evidence() {
        let mut driver = MockScrollDriver::new(32, 100, 400, 0, 0);
        driver.fail_after = Some(2); // tile 0, tile 1 ok; tile 2 fails twice
        let req = test_request("t-fail", ScrollEngineKind::DomAware);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        match result {
            ScrollingResult::Incomplete {
                reason,
                missing,
                completed,
                ..
            } => {
                assert!(matches!(reason, ScrollIncompleteReason::PartialTileFailure));
                assert_eq!(completed.len(), 2);
                assert!(!missing.is_empty());
                assert!(missing.iter().all(|m| m.attempts == 2));
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
    }

    #[test]
    fn target_dying_mid_run_is_incomplete_target_changed() {
        let mut driver = MockScrollDriver::new(32, 100, 600, 0, 0);
        driver.die_after = Some(1); // dies during the second scroll
        let req = test_request("t-die", ScrollEngineKind::DomAware);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        match result {
            ScrollingResult::Incomplete { reason, .. } => {
                assert!(matches!(reason, ScrollIncompleteReason::TargetChanged));
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
    }

    #[test]
    fn user_abort_is_incomplete_not_failed() {
        let mut driver = MockScrollDriver::new(32, 100, 900, 0, 0);
        let abort: AbortFlag = Arc::new(AtomicBool::new(false));
        let abort2 = abort.clone();
        let mut req = test_request("t-abort", ScrollEngineKind::DomAware);
        let calls = Arc::new(std::sync::Mutex::new(0u32));
        let calls2 = calls.clone();
        req.on_progress = Some(Arc::new(move |p: ScrollProgress| {
            *calls2.lock().unwrap() += 1;
            if p.tiles_captured >= 2 {
                abort2.store(true, Ordering::Relaxed);
            }
        }));
        req.abort = Some(abort);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        match result {
            ScrollingResult::Incomplete {
                reason, completed, ..
            } => {
                assert!(matches!(reason, ScrollIncompleteReason::UserAborted));
                assert_eq!(completed.len(), 2);
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
        assert!(*calls.lock().unwrap() >= 2, "progress must fire per tile");
    }

    #[test]
    fn overshoot_is_loud_incomplete() {
        // DOM-aware: the geometry reports the true scroll position, so a
        // step that jumps further than one viewport is caught exactly.
        // (The raster correlator can only see half a viewport, so a pure
        // raster overshoot surfaces as still frames instead.)
        let mut driver = MockScrollDriver::new(32, 100, 900, 0, 0);
        driver.overshoot_factor = 5; // first scroll jumps 5x the command
        let req = test_request("t-over", ScrollEngineKind::DomAware);
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        match result {
            ScrollingResult::Incomplete {
                reason, missing, ..
            } => {
                assert!(matches!(reason, ScrollIncompleteReason::ScrollOvershoot));
                assert!(!missing.is_empty());
                assert_eq!(missing[0].rect.h, 25); // 125 - 100 viewport
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
    }

    #[test]
    fn horizontal_scroll_is_pixel_exact() {
        // Wide document, horizontal axis: the transpose normalization must
        // round-trip pixel-exact.
        let doc_w = 420u32;
        let vw = 120u32;
        let vh = 60u32;
        let mut driver = MockScrollDriver::new_horizontal(doc_w, vw, vh, 0, 0);
        let mut req = test_request("t-horiz", ScrollEngineKind::RasterObservation);
        req.direction = ScrollDirection::Horizontal;
        let result = run_scroll(&mut driver, &req, "raster-observation", &[], false);
        let artifact = result.require_complete().expect("horizontal must complete");
        let (rgba, w, h) = decode_artifact_png(&artifact);
        assert_eq!((w, h), (doc_w, vh));
        assert_eq!(
            rgba,
            driver.expected_pixels(),
            "horizontal stitch must equal the document"
        );
        assert_eq!(artifact.scroll_info.unwrap().direction, "horizontal");
    }

    #[test]
    fn horizontal_chrome_side_bars_are_trimmed() {
        // Sticky left/right bars behave exactly like header/footer once
        // the tile is transposed into normalized space.
        let doc_w = 420u32;
        let mut driver = MockScrollDriver::new_horizontal(doc_w, 120, 60, 10, 6);
        let mut req = test_request("t-hchrome", ScrollEngineKind::RasterObservation);
        req.direction = ScrollDirection::Horizontal;
        let result = run_scroll(&mut driver, &req, "raster-observation", &[], false);
        let artifact = result
            .require_complete()
            .expect("horizontal chrome must complete");
        let (rgba, w, h) = decode_artifact_png(&artifact);
        assert_eq!((w, h), (doc_w, 60));
        assert_eq!(rgba, driver.expected_pixels());
    }

    #[test]
    fn max_distance_guard_trips() {
        let mut driver = MockScrollDriver::new(32, 100, 5000, 0, 0);
        let mut req = test_request("t-dist", ScrollEngineKind::DomAware);
        req.limits.max_distance_px = 100;
        let result = run_scroll(&mut driver, &req, "dom-aware", &[], true);
        match result {
            ScrollingResult::Incomplete { reason, .. } => {
                assert!(matches!(reason, ScrollIncompleteReason::EngineLimit { .. }));
            }
            other => panic!("expected Incomplete, got {}", other.describe()),
        }
    }

    #[test]
    fn transpose_round_trips() {
        let w = 7u32;
        let h = 5u32;
        let px: Vec<u8> = (0..w * h * 4).map(|i| (i % 251) as u8).collect();
        let t = transpose_rgba(&px, w, h);
        let back = transpose_rgba(&t, h, w);
        assert_eq!(back, px);
    }

    #[test]
    fn scroll_direction_parses() {
        assert_eq!(
            ScrollDirection::parse("vertical"),
            Ok(ScrollDirection::Vertical)
        );
        assert!(ScrollDirection::parse("diagonal").is_err());
        assert_eq!(ScrollEngineKind::parse("auto"), Ok(ScrollEngineKind::Auto));
        assert!(ScrollEngineKind::parse("telepathy").is_err());
    }
}
