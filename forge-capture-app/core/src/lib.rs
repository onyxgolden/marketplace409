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
//! - [`engines`] — the [`engines::AcquisitionEngine`] trait plus the 2a native
//!   raster engine; DOM-aware and raster-observation scrolling engines are
//!   defined as 2b stubs so the layering compiles now.
//! - [`native`] — thin OS boundary: real GDI capture on Windows, an explicit
//!   error elsewhere.

pub mod artifact;
pub mod coords;
pub mod engines;
pub mod native;
pub mod png;
pub mod result;
pub mod stitch;
pub mod timestamp;
