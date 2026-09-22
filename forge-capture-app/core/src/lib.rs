//! FORGE Capture core — pure, platform-neutral logic for the Rung 2 native shell.
//!
//! Everything in this crate compiles and is tested on any host (the Linux CI
//! VM included). Windows-only native calls live behind `#[cfg(windows)]` in
//! [`native`]; every other module is pure logic with no OS dependencies.
//!
//! Module map (mirrors the ChatGPT Rung 2 architecture contracts):
//! - [`coords`] — the four coordinate spaces (WebView CSS, Windows logical,
//!   virtual-desktop, physical raster) and tested conversions between them.
//! - [`timestamp`] — ISO-8601 UTC timestamps from `SystemTime` (no deps).
//! - [`png`] — minimal dependency-free PNG encoder (stored deflate blocks).
//! - [`artifact`] — the normalized native → Rung 1 editor raster-artifact
//!   contract: dimensions, capture kind, monitor/window identity, DPI/scale,
//!   cursor state, plus the JSON sidecar format.
//! - [`result`] — first-class capture/scrolling results: Complete, Incomplete
//!   (with reasons + evidence), Failed (with evidence). Partial success is
//!   never silent.
//! - [`stitch`] — the shared stitch/result layer: tile-placement validation
//!   and coverage computation feeding the result types.
//! - [`scroll`] — Rung 2b scrolling orchestration: the [`scroll::ScrollDriver`]
//!   OS boundary, the shared scroll loop ([`scroll::run_scroll`]), scroll
//!   offset measurement, sticky-chrome detection, tile assembly, and result
//!   classification. Pure and fully unit-tested.
//! - [`engines`] — the [`engines::AcquisitionEngine`] trait, the 2a native
//!   raster engine, and the 2b scrolling engines (DOM-aware and
//!   raster-observation) built on [`scroll::run_scroll`].
//! - [`native`] — thin OS boundary: real GDI capture on Windows, an explicit
//!   error elsewhere.
//! - [`hotkey`] — Print Screen takeover contract: the accelerator string,
//!   the launch-not-shutter action, and the graceful-degradation status
//!   mapping. Pure logic; the Tauri shell performs the OS registration.

pub mod artifact;
pub mod coords;
pub mod engines;
pub mod hotkey;
pub mod native;
pub mod png;
pub mod result;
pub mod scroll;
pub mod stitch;
pub mod timestamp;
