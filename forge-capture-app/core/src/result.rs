//! First-class capture and scrolling results (ChatGPT Rung 2 contract #3).
//!
//! The core rule: **partial success is never silent**. A scrolling capture
//! that did not finish is not a `Complete` with fewer pixels — it is an
//! `Incomplete` carrying the completed regions, the missing regions, and the
//! reason; a failure is a `Failed` carrying reasons plus evidence. The type
//! system (plus `#[must_use]`) forces every consumer to handle all three.
//!
//! 2a implements these types and the native (non-scrolling) path, which can
//! only produce `Complete` or `Failed`. 2b implements the scrolling
//! acquisition engines that produce `Incomplete`.

use crate::artifact::CaptureArtifact;
use crate::coords::RectI;

/// Why a single native capture failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    /// The OS capture API returned an error (message included, no PII).
    NativeApi(String),
    /// The OS denied capture (permissions, secure desktop, …).
    AccessDenied(String),
    /// No monitors were reported by the OS.
    NoMonitors,
    /// The raster could not be encoded for saving.
    EncodeFailed(String),
    /// The user cancelled (e.g. dismissed the region picker).
    CancelledByUser,
    /// The capture target disappeared mid-capture.
    TargetGone(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::NativeApi(m) => write!(f, "native capture API error: {m}"),
            CaptureError::AccessDenied(m) => write!(f, "capture access denied: {m}"),
            CaptureError::NoMonitors => write!(f, "no monitors reported by the OS"),
            CaptureError::EncodeFailed(m) => write!(f, "raster encode failed: {m}"),
            CaptureError::CancelledByUser => write!(f, "cancelled by user"),
            CaptureError::TargetGone(m) => write!(f, "capture target disappeared: {m}"),
        }
    }
}

impl std::error::Error for CaptureError {}

/// Result of a 2a native (non-scrolling) capture.
pub type CaptureResult = Result<CaptureArtifact, CaptureError>;

/// Why a scrolling capture stopped before covering everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScrollIncompleteReason {
    /// The target stopped yielding new content (stall detector tripped).
    StallDetected { stills: u32 },
    /// The page content changed mid-scroll (infinite feed, animation).
    ContentChanged,
    /// One or more tiles failed after retries; the rest are usable.
    PartialTileFailure,
    /// The user aborted the scroll.
    UserAborted,
    /// A documented engine limit was hit (e.g. max scroll distance).
    EngineLimit { limit: String },
    /// A scroll step moved further than one viewport, leaving a gap no tile
    /// covers. The missing rows are recorded as [`MissingRegion`]s.
    ScrollOvershoot,
    /// The target window moved, resized, or closed mid-scroll, invalidating
    /// tile placements.
    TargetChanged,
}

impl std::fmt::Display for ScrollIncompleteReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScrollIncompleteReason::StallDetected { stills } => {
                write!(f, "scroll stalled after {stills} unchanged frames")
            }
            ScrollIncompleteReason::ContentChanged => {
                write!(f, "target content changed mid-scroll")
            }
            ScrollIncompleteReason::PartialTileFailure => {
                write!(f, "some tiles failed after retries")
            }
            ScrollIncompleteReason::UserAborted => write!(f, "scroll aborted by user"),
            ScrollIncompleteReason::EngineLimit { limit } => {
                write!(f, "engine limit reached: {limit}")
            }
            ScrollIncompleteReason::ScrollOvershoot => {
                write!(f, "a scroll step overshot the viewport, leaving a gap")
            }
            ScrollIncompleteReason::TargetChanged => {
                write!(f, "the target moved, resized, or closed mid-scroll")
            }
        }
    }
}

/// A tile that was captured during scrolling, in physical-raster coordinates
/// of the final stitched canvas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedRegion {
    pub rect: RectI,
    pub tile_id: String,
}

/// A region of the final canvas that has no pixels, with the evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingRegion {
    pub rect: RectI,
    pub attempts: u32,
    pub last_error: String,
}

/// The result of a scrolling capture. `#[must_use]` so discarding it is a
/// loud compiler warning, not a silent drop.
#[derive(Debug, Clone, PartialEq)]
#[must_use = "scrolling results must be handled: Complete, Incomplete, and Failed are all meaningful"]
pub enum ScrollingResult {
    Complete {
        artifact: CaptureArtifact,
    },
    Incomplete {
        /// Best-effort stitched raster, when at least one tile landed.
        partial_artifact: Option<CaptureArtifact>,
        completed: Vec<CapturedRegion>,
        missing: Vec<MissingRegion>,
        reason: ScrollIncompleteReason,
    },
    Failed {
        reason: String,
        /// Human-readable evidence trail (what was tried, what the OS said).
        /// Never empty: the constructor backfills a marker rather than
        /// allowing a silent failure.
        evidence: Vec<String>,
    },
}

impl ScrollingResult {
    pub fn is_complete(&self) -> bool {
        matches!(self, ScrollingResult::Complete { .. })
    }

    /// Build a `Failed` that can never be evidence-free.
    pub fn failed(reason: impl Into<String>, evidence: Vec<String>) -> ScrollingResult {
        let mut evidence = evidence;
        if evidence.is_empty() {
            evidence.push("no further evidence recorded by the engine".to_string());
        }
        ScrollingResult::Failed {
            reason: reason.into(),
            evidence,
        }
    }

    /// Build an `Incomplete`. Requires at least one missing region or the
    /// reason to explain itself — an "incomplete" with nothing missing is a
    /// `Complete` and is rejected here so engines cannot mislabel success.
    pub fn incomplete(
        partial_artifact: Option<CaptureArtifact>,
        completed: Vec<CapturedRegion>,
        missing: Vec<MissingRegion>,
        reason: ScrollIncompleteReason,
    ) -> Result<ScrollingResult, &'static str> {
        if missing.is_empty() {
            return Err("incomplete results must name at least one missing region");
        }
        Ok(ScrollingResult::Incomplete {
            partial_artifact,
            completed,
            missing,
            reason,
        })
    }

    /// Extract the artifact only when the capture truly completed; otherwise
    /// return the structured failure so the caller must confront it.
    pub fn require_complete(self) -> Result<CaptureArtifact, ScrollingFailure> {
        match self {
            ScrollingResult::Complete { artifact } => Ok(artifact),
            ScrollingResult::Incomplete {
                reason, missing, ..
            } => Err(ScrollingFailure::Incomplete {
                reason,
                missing_count: missing.len(),
            }),
            ScrollingResult::Failed { reason, evidence } => {
                Err(ScrollingFailure::Failed { reason, evidence })
            }
        }
    }

    /// One-line human summary for logs and the UI status line.
    pub fn describe(&self) -> String {
        match self {
            ScrollingResult::Complete { artifact } => {
                format!(
                    "complete: {} ({}x{})",
                    artifact.id, artifact.raster_width, artifact.raster_height
                )
            }
            ScrollingResult::Incomplete {
                completed,
                missing,
                reason,
                ..
            } => {
                format!(
                    "incomplete: {} tiles ok, {} regions missing ({})",
                    completed.len(),
                    missing.len(),
                    reason
                )
            }
            ScrollingResult::Failed { reason, evidence } => {
                format!("failed: {reason} ({} evidence lines)", evidence.len())
            }
        }
    }
}

/// The error side of [`ScrollingResult::require_complete`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScrollingFailure {
    Incomplete {
        reason: ScrollIncompleteReason,
        missing_count: usize,
    },
    Failed {
        reason: String,
        evidence: Vec<String>,
    },
}

impl std::fmt::Display for ScrollingFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScrollingFailure::Incomplete {
                reason,
                missing_count,
            } => {
                write!(
                    f,
                    "scrolling incomplete ({missing_count} regions missing): {reason}"
                )
            }
            ScrollingFailure::Failed { reason, .. } => write!(f, "scrolling failed: {reason}"),
        }
    }
}

impl std::error::Error for ScrollingFailure {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifact::{CaptureArtifact, CaptureKind, CursorState, RasterMime};

    fn sample_artifact(id: &str) -> CaptureArtifact {
        CaptureArtifact::new(
            id.into(),
            CaptureKind::Region,
            vec![0u8; 16],
            RasterMime::Png,
            2,
            2,
            None,
            None,
            1.0,
            CursorState {
                captured: false,
                position_physical: None,
            },
            "2026-09-21T13:30:00Z".into(),
            None,
        )
        .unwrap()
    }

    #[test]
    fn failed_always_carries_evidence() {
        let r = ScrollingResult::failed("boom", vec![]);
        match r {
            ScrollingResult::Failed { evidence, .. } => assert!(!evidence.is_empty()),
            _ => panic!("expected Failed"),
        }
        let r = ScrollingResult::failed("boom", vec!["tried X".into()]);
        assert_eq!(r.describe(), "failed: boom (1 evidence lines)");
    }

    #[test]
    fn incomplete_requires_missing_regions() {
        let err =
            ScrollingResult::incomplete(None, vec![], vec![], ScrollIncompleteReason::UserAborted)
                .unwrap_err();
        assert_eq!(
            err,
            "incomplete results must name at least one missing region"
        );
    }

    #[test]
    fn incomplete_carries_evidence_and_describes() {
        let r = ScrollingResult::incomplete(
            Some(sample_artifact("p1")),
            vec![CapturedRegion {
                rect: RectI {
                    x: 0,
                    y: 0,
                    w: 100,
                    h: 100,
                },
                tile_id: "t0".into(),
            }],
            vec![MissingRegion {
                rect: RectI {
                    x: 0,
                    y: 100,
                    w: 100,
                    h: 100,
                },
                attempts: 3,
                last_error: "timeout".into(),
            }],
            ScrollIncompleteReason::StallDetected { stills: 5 },
        )
        .unwrap();
        assert!(!r.is_complete());
        assert!(r.describe().contains("1 tiles ok, 1 regions missing"));
        assert!(r.describe().contains("stalled after 5 unchanged frames"));
    }

    #[test]
    fn require_complete_forces_handling() {
        let ok = ScrollingResult::Complete {
            artifact: sample_artifact("a"),
        };
        assert!(ok.is_complete());
        assert_eq!(ok.require_complete().unwrap().id, "a");

        let inc = ScrollingResult::incomplete(
            None,
            vec![],
            vec![MissingRegion {
                rect: RectI {
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 10,
                },
                attempts: 1,
                last_error: "x".into(),
            }],
            ScrollIncompleteReason::ContentChanged,
        )
        .unwrap();
        let err = inc.require_complete().unwrap_err();
        assert!(matches!(
            err,
            ScrollingFailure::Incomplete {
                missing_count: 1,
                ..
            }
        ));
        assert!(err.to_string().contains("content changed mid-scroll"));

        let failed = ScrollingResult::failed("nope", vec!["e1".into()]);
        let err = failed.require_complete().unwrap_err();
        assert!(matches!(err, ScrollingFailure::Failed { .. }));
    }

    #[test]
    fn capture_error_displays() {
        assert_eq!(
            CaptureError::NoMonitors.to_string(),
            "no monitors reported by the OS"
        );
        assert!(CaptureError::NativeApi("0x123".into())
            .to_string()
            .contains("0x123"));
    }
}
