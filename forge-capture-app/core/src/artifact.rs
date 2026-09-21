//! Normalized native Rust/Tauri → Rung 1 editor raster-artifact contract
//! (ChatGPT Rung 2 contract #1).
//!
//! Every capture the native shell produces is a [`CaptureArtifact`]:
//! raster bytes plus structured provenance — dimensions, capture kind,
//! monitor/window identity where applicable, DPI/scale, and cursor state.
//!
//! Two representations exist:
//! - **In memory**: [`CaptureArtifact`] (raster bytes included).
//! - **On disk / over the local bridge**: a PNG/JPEG/WebP raster file plus a
//!   JSON sidecar ([`Sidecar`]). The sidecar is the *normalized* contract the
//!   Rung 1 editor's `native-artifact.js` bridge parses; the raster file
//!   flows through the editor's existing `decodeSourceImage` import path
//!   unchanged ("import as-is").
//!
//! Limits mirror the Rung 1 editor (`src/domains/capture-editor/limits.js`):
//! 16384 px per side, 128 MiB encoded raster bytes, 128 MiB decoded RGBA,
//! PNG/JPEG/WebP only. Both byte checks are enforced: the encoded check
//! bounds what we write to disk, the decoded check (`check_decoded_len`)
//! bounds decode memory — a small JPEG/WebP can decode to gigabytes, so the
//! encoded check alone does not satisfy the safety intent.

use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::coords::{Monitor, RectI};

/// Current sidecar schema version. Readers reject anything newer.
pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
/// Fixed `kind` discriminator for the sidecar envelope.
pub const ARTIFACT_KIND: &str = "forge-capture-artifact";

/// Mirrors the Rung 1 editor caps.
pub const MAX_ARTIFACT_DIMENSION: u32 = 16384;
pub const MAX_ARTIFACT_BYTES: usize = 128 * 1024 * 1024;

/// How the capture was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureKind {
    FullMonitor,
    Window,
    Region,
    /// Rung 2b: a stitched scrolling capture (vertical or horizontal).
    Scrolling,
}

impl CaptureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureKind::FullMonitor => "full-monitor",
            CaptureKind::Window => "window",
            CaptureKind::Region => "region",
            CaptureKind::Scrolling => "scrolling",
        }
    }
}

/// Raster encodings the editor can import (mirrors
/// `SUPPORTED_SOURCE_MIME_TYPES` in the Rung 1 editor).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RasterMime {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/webp")]
    WebP,
}

impl RasterMime {
    pub fn as_str(self) -> &'static str {
        match self {
            RasterMime::Png => "image/png",
            RasterMime::Jpeg => "image/jpeg",
            RasterMime::WebP => "image/webp",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            RasterMime::Png => "png",
            RasterMime::Jpeg => "jpg",
            RasterMime::WebP => "webp",
        }
    }
}

impl std::str::FromStr for RasterMime {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, ()> {
        match s {
            "image/png" => Ok(RasterMime::Png),
            "image/jpeg" => Ok(RasterMime::Jpeg),
            "image/webp" => Ok(RasterMime::WebP),
            _ => Err(()),
        }
    }
}

/// Identity of the window a [`CaptureKind::Window`] capture came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowIdentity {
    pub title: String,
    pub class_name: String,
    pub process_name: Option<String>,
    /// Window rect in virtual-desktop coordinates at capture time.
    pub rect_virtual: RectI,
}

/// Cursor state at capture time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorState {
    pub captured: bool,
    /// Cursor position in physical-raster coordinates, when known.
    pub position_physical: Option<(i64, i64)>,
}

/// A complete capture: provenance + raster bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureArtifact {
    pub id: String,
    pub kind: CaptureKind,
    /// Raster bytes in `mime` encoding; dimensions must equal
    /// `raster_width`/`raster_height`.
    pub raster_bytes: Vec<u8>,
    pub raster_mime: RasterMime,
    pub raster_width: u32,
    pub raster_height: u32,
    /// Monitor the capture belongs to (full-monitor, and region/window
    /// captures note the primary monitor for provenance).
    pub monitor: Option<Monitor>,
    pub window: Option<WindowIdentity>,
    /// DPI scale the raster was captured at.
    pub scale: f64,
    pub cursor: CursorState,
    /// ISO-8601 UTC, e.g. `2026-09-21T13:30:00Z`.
    pub captured_at: String,
    /// Requested pre-capture delay, if any.
    pub delay_ms: Option<u64>,
    /// Scrolling provenance (Rung 2b). `None` for single-frame captures.
    pub scroll_info: Option<ScrollSection>,
}

/// Scrolling provenance carried by [`CaptureKind::Scrolling`] artifacts and
/// their sidecars. Serialized camelCase to match the sidecar envelope's
/// field convention.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollSection {
    /// Resolved engine: "dom-aware" | "raster-observation".
    pub engine: String,
    /// "vertical" | "horizontal".
    pub direction: String,
    pub tiles_captured: u32,
    pub distance_px: u64,
    /// False for partial artifacts kept from an `Incomplete` run.
    pub complete: bool,
    /// Set when `complete` is false: the human-readable stop reason.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtifactError {
    EmptyId,
    EmptyRaster,
    BadDimensions { width: u32, height: u32 },
    DimensionTooLarge { width: u32, height: u32 },
    TooManyBytes { bytes: usize },
    DecodedTooLarge { bytes: u64 },
    UnsupportedMime(String),
    BadTimestamp(String),
    BadScale,
    WindowKindWithoutWindow,
    SchemaMismatch { expected: String, found: String },
    UnsupportedVersion { found: u32 },
    CorruptSidecar(String),
    Json(String),
}

impl std::fmt::Display for ArtifactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArtifactError::EmptyId => write!(f, "artifact id must not be empty"),
            ArtifactError::EmptyRaster => write!(f, "raster bytes must not be empty"),
            ArtifactError::BadDimensions { width, height } => {
                write!(f, "raster dimensions {width}x{height} must be positive")
            }
            ArtifactError::DimensionTooLarge { width, height } => {
                write!(
                    f,
                    "raster dimensions {width}x{height} exceed the {MAX_ARTIFACT_DIMENSION}px cap"
                )
            }
            ArtifactError::TooManyBytes { bytes } => {
                write!(f, "raster is {bytes} bytes, exceeding the 128 MiB cap")
            }
            ArtifactError::DecodedTooLarge { bytes } => {
                write!(
                    f,
                    "decoded raster would be {bytes} bytes, exceeding the 128 MiB cap"
                )
            }
            ArtifactError::UnsupportedMime(m) => write!(f, "unsupported raster mime: {m}"),
            ArtifactError::BadTimestamp(t) => write!(f, "captured_at is not ISO-8601 UTC: {t}"),
            ArtifactError::BadScale => write!(f, "scale must be a positive finite number"),
            ArtifactError::WindowKindWithoutWindow => {
                write!(
                    f,
                    "capture kind is window but no window identity was provided"
                )
            }
            ArtifactError::SchemaMismatch { expected, found } => {
                write!(
                    f,
                    "sidecar kind mismatch: expected {expected}, found {found}"
                )
            }
            ArtifactError::UnsupportedVersion { found } => {
                write!(f, "unsupported artifact schema version {found} (this build reads {ARTIFACT_SCHEMA_VERSION})")
            }
            ArtifactError::CorruptSidecar(r) => write!(f, "corrupt artifact sidecar: {r}"),
            ArtifactError::Json(e) => write!(f, "sidecar JSON error: {e}"),
        }
    }
}

impl std::error::Error for ArtifactError {}

/// Dimension checks shared by constructors and sidecar parsing; testable
/// without allocating a 128 MiB buffer.
pub fn check_dimensions(width: u32, height: u32) -> Result<(), ArtifactError> {
    if width == 0 || height == 0 {
        return Err(ArtifactError::BadDimensions { width, height });
    }
    if width > MAX_ARTIFACT_DIMENSION || height > MAX_ARTIFACT_DIMENSION {
        return Err(ArtifactError::DimensionTooLarge { width, height });
    }
    Ok(())
}

pub fn check_byte_len(len: usize) -> Result<(), ArtifactError> {
    if len == 0 {
        return Err(ArtifactError::EmptyRaster);
    }
    if len > MAX_ARTIFACT_BYTES {
        return Err(ArtifactError::TooManyBytes { bytes: len });
    }
    Ok(())
}

/// Bound on *decoded* RGBA bytes (`width × height × 4`). The encoded-raster
/// check alone does not bound decode memory: a small JPEG/WebP can decode
/// to gigabytes. This is the check that matches the documented "128 MiB
/// decoded RGBA" safety intent.
pub fn check_decoded_len(width: u32, height: u32) -> Result<(), ArtifactError> {
    let decoded = width as u64 * height as u64 * 4;
    if decoded > MAX_ARTIFACT_BYTES as u64 {
        return Err(ArtifactError::DecodedTooLarge { bytes: decoded });
    }
    Ok(())
}

fn check_timestamp(ts: &str) -> Result<(), ArtifactError> {
    // Strict `YYYY-MM-DDTHH:MM:SSZ`, exactly 20 chars.
    let b = ts.as_bytes();
    let ok = b.len() == 20
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b[16] == b':'
        && b[19] == b'Z'
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..10].iter().all(|c| c.is_ascii_digit())
        && b[11..13].iter().all(|c| c.is_ascii_digit())
        && b[14..16].iter().all(|c| c.is_ascii_digit())
        && b[17..19].iter().all(|c| c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(ArtifactError::BadTimestamp(ts.to_string()))
    }
}

impl CaptureArtifact {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        kind: CaptureKind,
        raster_bytes: Vec<u8>,
        raster_mime: RasterMime,
        raster_width: u32,
        raster_height: u32,
        monitor: Option<Monitor>,
        window: Option<WindowIdentity>,
        scale: f64,
        cursor: CursorState,
        captured_at: String,
        delay_ms: Option<u64>,
    ) -> Result<CaptureArtifact, ArtifactError> {
        if id.is_empty() {
            return Err(ArtifactError::EmptyId);
        }
        check_dimensions(raster_width, raster_height)?;
        check_byte_len(raster_bytes.len())?;
        check_decoded_len(raster_width, raster_height)?;
        check_timestamp(&captured_at)?;
        if !(scale.is_finite() && scale > 0.0) {
            return Err(ArtifactError::BadScale);
        }
        if kind == CaptureKind::Window && window.is_none() {
            return Err(ArtifactError::WindowKindWithoutWindow);
        }
        Ok(CaptureArtifact {
            id,
            kind,
            raster_bytes,
            raster_mime,
            raster_width,
            raster_height,
            monitor,
            window,
            scale,
            cursor,
            captured_at,
            delay_ms,
            scroll_info: None,
        })
    }

    /// Attach scrolling provenance (Rung 2b). Builder-style so the 2a
    /// call sites are untouched.
    pub fn with_scroll_info(mut self, info: ScrollSection) -> Self {
        self.scroll_info = Some(info);
        self
    }

    /// File stem for local save: `forge-capture-20260921-083000-full-monitor`.
    /// Derived from `captured_at`, never from the local clock (deterministic).
    pub fn file_stem(&self) -> String {
        let t = &self.captured_at;
        // `YYYY-MM-DDTHH:MM:SSZ` → `YYYYMMDD-HHMMSS` by fixed positions.
        let date = format!("{}{}{}", &t[0..4], &t[5..7], &t[8..10]);
        let time = format!("{}{}{}", &t[11..13], &t[14..16], &t[17..19]);
        format!("forge-capture-{date}-{time}-{}", self.kind.as_str())
    }

    /// Serialize the normalized sidecar (field order is declaration order —
    /// deterministic for the same artifact).
    pub fn to_sidecar_json(&self) -> Result<String, ArtifactError> {
        let sidecar = Sidecar {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            kind: ARTIFACT_KIND.to_string(),
            id: self.id.clone(),
            capture_kind: self.kind,
            raster: RasterSection {
                mime: self.raster_mime.as_str().to_string(),
                width: self.raster_width,
                height: self.raster_height,
                byte_length: self.raster_bytes.len(),
                crc32: crate::png::crc32(&self.raster_bytes),
            },
            monitor: self.monitor.clone(),
            window: self.window.clone(),
            scale: self.scale,
            cursor: self.cursor.clone(),
            captured_at: self.captured_at.clone(),
            delay_ms: self.delay_ms,
            scroll: self.scroll_info.clone(),
        };
        serde_json::to_string(&sidecar).map_err(|e| ArtifactError::Json(e.to_string()))
    }
}

/// The on-disk sidecar. Field order is the serialized order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sidecar {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub kind: String,
    pub id: String,
    #[serde(rename = "captureKind")]
    pub capture_kind: CaptureKind,
    pub raster: RasterSection,
    pub monitor: Option<Monitor>,
    pub window: Option<WindowIdentity>,
    pub scale: f64,
    pub cursor: CursorState,
    #[serde(rename = "capturedAt")]
    pub captured_at: String,
    #[serde(rename = "delayMs")]
    pub delay_ms: Option<u64>,
    /// Scrolling provenance (Rung 2b). Optional so 2a sidecars keep parsing;
    /// the Rung 1 editor ignores it (provenance only, never trusted).
    #[serde(default)]
    pub scroll: Option<ScrollSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RasterSection {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "byteLength")]
    pub byte_length: usize,
    pub crc32: u32,
}

/// Strict sidecar parse: unknown/newer versions and corrupt envelopes are
/// rejected, never partially applied (same invariant as the Rung 1 editor's
/// `deserializeProject`).
pub fn parse_sidecar(input: &str) -> Result<Sidecar, ArtifactError> {
    let raw: serde_json::Value =
        serde_json::from_str(input).map_err(|e| ArtifactError::Json(e.to_string()))?;
    let version = raw
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| ArtifactError::CorruptSidecar("missing schemaVersion".into()))?
        as u32;
    if version > ARTIFACT_SCHEMA_VERSION {
        return Err(ArtifactError::UnsupportedVersion { found: version });
    }
    if version < 1 {
        return Err(ArtifactError::CorruptSidecar(format!(
            "schemaVersion out of range: {version}"
        )));
    }
    let kind = raw
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ArtifactError::CorruptSidecar("missing kind".into()))?;
    if kind != ARTIFACT_KIND {
        return Err(ArtifactError::SchemaMismatch {
            expected: ARTIFACT_KIND.to_string(),
            found: kind.to_string(),
        });
    }
    let sidecar: Sidecar =
        serde_json::from_value(raw).map_err(|e| ArtifactError::CorruptSidecar(e.to_string()))?;
    if sidecar.id.is_empty() {
        return Err(ArtifactError::CorruptSidecar("id must not be empty".into()));
    }
    if RasterMime::from_str(&sidecar.raster.mime).is_err() {
        return Err(ArtifactError::UnsupportedMime(sidecar.raster.mime.clone()));
    }
    check_dimensions(sidecar.raster.width, sidecar.raster.height)?;
    check_byte_len(sidecar.raster.byte_length)?;
    check_decoded_len(sidecar.raster.width, sidecar.raster.height)?;
    check_timestamp(&sidecar.captured_at)?;
    if !(sidecar.scale.is_finite() && sidecar.scale > 0.0) {
        return Err(ArtifactError::BadScale);
    }
    if sidecar.capture_kind == CaptureKind::Window && sidecar.window.is_none() {
        return Err(ArtifactError::WindowKindWithoutWindow);
    }
    Ok(sidecar)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coords::{Monitor, RectI};

    fn sample_monitor() -> Monitor {
        Monitor {
            id: "primary".into(),
            name: "\\\\.\\DISPLAY1".into(),
            origin_virtual: (0, 0),
            size_logical: (1920, 1080),
            scale: 1.0,
        }
    }

    fn sample_artifact() -> CaptureArtifact {
        CaptureArtifact::new(
            "test-id-1".into(),
            CaptureKind::FullMonitor,
            vec![1, 2, 3, 4],
            RasterMime::Png,
            1920,
            1080,
            Some(sample_monitor()),
            None,
            1.0,
            CursorState {
                captured: true,
                position_physical: Some((100, 200)),
            },
            "2026-09-21T13:30:00Z".into(),
            None,
        )
        .unwrap()
    }

    #[test]
    fn sidecar_round_trip() {
        let a = sample_artifact();
        let json = a.to_sidecar_json().unwrap();
        let back = parse_sidecar(&json).unwrap();
        assert_eq!(back.schema_version, ARTIFACT_SCHEMA_VERSION);
        assert_eq!(back.kind, ARTIFACT_KIND);
        assert_eq!(back.id, "test-id-1");
        assert_eq!(back.capture_kind, CaptureKind::FullMonitor);
        assert_eq!(back.raster.mime, "image/png");
        assert_eq!(back.raster.width, 1920);
        assert_eq!(back.raster.height, 1080);
        assert_eq!(back.raster.byte_length, 4);
        assert_eq!(back.raster.crc32, crate::png::crc32(&[1, 2, 3, 4]));
        assert_eq!(back.monitor.unwrap().id, "primary");
        assert!(back.window.is_none());
        assert_eq!(back.scale, 1.0);
        assert_eq!(
            back.cursor,
            CursorState {
                captured: true,
                position_physical: Some((100, 200))
            }
        );
        assert_eq!(back.captured_at, "2026-09-21T13:30:00Z");
        assert_eq!(back.delay_ms, None);
    }

    #[test]
    fn serialization_is_deterministic() {
        let a = sample_artifact();
        assert_eq!(a.to_sidecar_json().unwrap(), a.to_sidecar_json().unwrap());
    }

    #[test]
    fn scrolling_sidecar_carries_camel_case_scroll_section() {
        // The Rung 1 JS bridge allowlists captureKind "scrolling" and
        // tolerates an optional `scroll` object; pin the exact JSON shape
        // it consumes so the two sides cannot drift apart.
        let mut a = sample_artifact();
        a.kind = CaptureKind::Scrolling;
        let a = a.with_scroll_info(ScrollSection {
            engine: "dom-aware".into(),
            direction: "vertical".into(),
            tiles_captured: 7,
            distance_px: 540,
            complete: true,
            reason: None,
        });
        let json = a.to_sidecar_json().unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["captureKind"], "scrolling");
        let scroll = &v["scroll"];
        assert_eq!(scroll["engine"], "dom-aware");
        assert_eq!(scroll["direction"], "vertical");
        assert_eq!(scroll["tilesCaptured"], 7);
        assert_eq!(scroll["distancePx"], 540);
        assert_eq!(scroll["complete"], true);
        assert!(scroll.get("reason").is_none() || scroll["reason"].is_null());
        // Sidecars written before the scroll section existed (scroll None)
        // still parse, with scroll absent.
        let legacy_json = sample_artifact().to_sidecar_json().unwrap();
        assert!(parse_sidecar(&legacy_json).unwrap().scroll.is_none());
    }

    #[test]
    fn file_stem_format() {
        assert_eq!(
            sample_artifact().file_stem(),
            "forge-capture-20260921-133000-full-monitor"
        );
    }

    #[test]
    fn constructor_rejects_bad_inputs() {
        let good = sample_artifact();
        let mk = |id: String,
                  w: u32,
                  h: u32,
                  bytes: Vec<u8>,
                  ts: String,
                  scale: f64,
                  kind: CaptureKind,
                  window: Option<WindowIdentity>| {
            CaptureArtifact::new(
                id,
                kind,
                bytes,
                RasterMime::Png,
                w,
                h,
                None,
                window,
                scale,
                CursorState {
                    captured: false,
                    position_physical: None,
                },
                ts,
                None,
            )
        };
        assert_eq!(
            mk(
                "".into(),
                10,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                1.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::EmptyId
        );
        assert_eq!(
            mk(
                "x".into(),
                0,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                1.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::BadDimensions {
                width: 0,
                height: 10
            }
        );
        assert_eq!(
            mk(
                "x".into(),
                16385,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                1.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::DimensionTooLarge {
                width: 16385,
                height: 10
            }
        );
        assert_eq!(
            mk(
                "x".into(),
                10,
                10,
                vec![],
                "2026-09-21T13:30:00Z".into(),
                1.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::EmptyRaster
        );
        assert!(matches!(
            mk(
                "x".into(),
                10,
                10,
                vec![1],
                "not-a-time".into(),
                1.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::BadTimestamp(_)
        ));
        assert_eq!(
            mk(
                "x".into(),
                10,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                0.0,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::BadScale
        );
        assert_eq!(
            mk(
                "x".into(),
                10,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                f64::NAN,
                CaptureKind::Region,
                None
            )
            .unwrap_err(),
            ArtifactError::BadScale
        );
        // Window kind without window identity is rejected.
        assert_eq!(
            mk(
                "x".into(),
                10,
                10,
                vec![1],
                "2026-09-21T13:30:00Z".into(),
                1.0,
                CaptureKind::Window,
                None
            )
            .unwrap_err(),
            ArtifactError::WindowKindWithoutWindow
        );
        // But accepted with one.
        let w = WindowIdentity {
            title: "t".into(),
            class_name: "c".into(),
            process_name: None,
            rect_virtual: RectI {
                x: 0,
                y: 0,
                w: 10,
                h: 10,
            },
        };
        assert!(mk(
            "x".into(),
            10,
            10,
            vec![1],
            "2026-09-21T13:30:00Z".into(),
            1.0,
            CaptureKind::Window,
            Some(w)
        )
        .is_ok());
        let _ = good;
    }

    #[test]
    fn byte_cap_checked_without_big_alloc() {
        assert_eq!(
            check_byte_len(MAX_ARTIFACT_BYTES + 1).unwrap_err(),
            ArtifactError::TooManyBytes {
                bytes: MAX_ARTIFACT_BYTES + 1
            }
        );
        assert!(check_byte_len(MAX_ARTIFACT_BYTES).is_ok());
    }

    #[test]
    fn decoded_len_bound_matches_safety_intent() {
        // 16384x16384 RGBA decodes to 1 GiB: within the per-side cap but
        // over the 128 MiB decoded-RGBA cap.
        assert_eq!(
            check_decoded_len(16384, 16384).unwrap_err(),
            ArtifactError::DecodedTooLarge {
                bytes: 16384u64 * 16384 * 4
            }
        );
        // 1920x1080 is fine.
        assert!(check_decoded_len(1920, 1080).is_ok());
        // The constructor enforces it too.
        let err = CaptureArtifact::new(
            "x".into(),
            CaptureKind::Region,
            vec![1, 2, 3],
            RasterMime::Png,
            16384,
            16384,
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
        .unwrap_err();
        assert!(matches!(err, ArtifactError::DecodedTooLarge { .. }));
    }

    /// Cross-language CRC fixture (ChatGPT review proof): this exact byte
    /// vector and its CRC-32 are also asserted in
    /// `src/domains/capture-editor/__tests__/native-artifact.test.js`
    /// (`crc32Ieee`). Both sides implement IEEE 0xEDB88320; if either side
    /// ever changes polynomial, both tests fail together.
    #[test]
    fn crc32_cross_language_fixture() {
        // Fixed vector: bytes 0x00..0x0F.
        let v: Vec<u8> = (0u8..16).collect();
        assert_eq!(crate::png::crc32(&v), 0xcecee288);
    }

    #[test]
    fn parse_rejects_newer_version() {
        let json = sample_artifact()
            .to_sidecar_json()
            .unwrap()
            .replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        assert_eq!(
            parse_sidecar(&json).unwrap_err(),
            ArtifactError::UnsupportedVersion { found: 2 }
        );
    }

    #[test]
    fn parse_rejects_wrong_kind_and_corrupt() {
        let json = sample_artifact().to_sidecar_json().unwrap().replace(
            "\"kind\":\"forge-capture-artifact\"",
            "\"kind\":\"something-else\"",
        );
        assert!(matches!(
            parse_sidecar(&json).unwrap_err(),
            ArtifactError::SchemaMismatch { .. }
        ));
        assert!(matches!(
            parse_sidecar("not json").unwrap_err(),
            ArtifactError::Json(_)
        ));
        assert!(matches!(
            parse_sidecar("{}").unwrap_err(),
            ArtifactError::CorruptSidecar(_)
        ));
    }

    #[test]
    fn parse_rejects_unknown_capture_kind_and_mime() {
        let json = sample_artifact().to_sidecar_json().unwrap().replace(
            "\"captureKind\":\"full-monitor\"",
            "\"captureKind\":\"teleport\"",
        );
        assert!(matches!(
            parse_sidecar(&json).unwrap_err(),
            ArtifactError::CorruptSidecar(_)
        ));
        let json = sample_artifact()
            .to_sidecar_json()
            .unwrap()
            .replace("\"mime\":\"image/png\"", "\"mime\":\"image/gif\"");
        assert!(matches!(
            parse_sidecar(&json).unwrap_err(),
            ArtifactError::UnsupportedMime(_)
        ));
    }

    #[test]
    fn mime_helpers() {
        assert_eq!(RasterMime::from_str("image/webp"), Ok(RasterMime::WebP));
        assert_eq!(RasterMime::from_str("image/gif"), Err(()));
        assert_eq!(RasterMime::Jpeg.extension(), "jpg");
    }
}
