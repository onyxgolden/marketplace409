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
//! - [`ai_edit`] — AI Edit job contract: the local spool layout, the
//!   `job.json` manifest schema, job-id validation, status resolution, and
//!   versioned result stems. Pure logic; the shell owns the filesystem and
//!   the runner contract lives in `docs/ai-edit.md`.
//! - [`meeting`] — Meeting-mode transcription job contract: the
//!   `transcribe` job manifest, the `result.json` transcript schema with
//!   validated parsing, language-hint validation, and transcript
//!   text/search helpers. Pure logic; the shell owns the filesystem and
//!   the runner contract lives in `docs/meeting-mode.md`.
//! - [`annotations`] — Annotation sidecar contract (Slice 1 of the
//!   annotation/blur/callouts/library program): schema/version, per-kind
//!   geometry in source-image pixel coordinates, structural validation, and
//!   SHA-256 source binding/staleness. The **one authoritative** definition
//!   of what a valid annotation sidecar is — the JS/webview renderer
//!   consumes an already-validated shape via the Tauri commands in
//!   `app/src/main.rs`, never parsing or validating a sidecar on its own.
//!   Pure logic; it draws no pixels (see its own doc comment for why) and
//!   owns no filesystem, same division as [`ai_edit`] and [`meeting`].
//! - [`capture_meta`] — durable per-capture tags (Slice 4): a sidecar
//!   separate from both [`artifact`]'s provenance sidecar and
//!   [`annotations`]'s annotation sidecar. The source of truth
//!   [`library_index`] projects from; never the other way round.
//! - [`library_index`] — the rebuildable local library index (Slice 4): a
//!   derived cache only, never a source of truth. Window-title indexing is
//!   opt-in and off by default; search works fully without it.

/// AI Edit job contract: the local spool layout, manifest schema, job-id
/// validation, status resolution, and versioned result stems. Pure logic;
/// the Tauri shell owns the filesystem, the runner contract lives in docs.
pub mod ai_edit;
pub mod annotations;
pub mod artifact;
pub mod capture_meta;
pub mod coords;
pub mod engines;
pub mod hotkey;
pub mod library_index;
pub mod meeting;
pub mod native;
pub mod png;
pub mod result;
pub mod scroll;
pub mod stitch;
pub mod timestamp;
