//! Annotation sidecar contract — Capture annotation layer, Slice 1 of 4.
//!
//! Plan and review trail: forge-ai-drop's
//! `commands/chatgpt/forge-capture-annotation-plan-rereview.md` and
//! `results/chatgpt/forge-capture-annotation-plan-rereview.md` (GO). This
//! module is the pure half of that contract — schema, geometry validation,
//! and source-binding. It owns no filesystem and draws no pixels, mirroring
//! how [`crate::artifact`] owns the capture sidecar contract without doing
//! any of the capturing, and how [`crate::ai_edit`] owns the spool contract
//! without touching the filesystem itself.
//!
//! Design, per the approved plan:
//!
//! - **Sidecar, never the source.** Annotations live in
//!   `<capture-stem>.annotations.json`, a sidecar next to the PNG. Nothing
//!   in this module, or anywhere downstream that respects this contract,
//!   ever modifies the original capture bytes.
//! - **Geometry is in source-image pixel coordinates** — the same integer
//!   pixel grid as [`crate::coords`]'s `PhysicalRaster` space (origin
//!   top-left, the bottom-right pixel of a W×H image is at (W-1, H-1)).
//!   Never display/CSS/zoom-dependent coordinates: the UI converts at the
//!   view boundary, so nothing persisted here can drift when the window is
//!   resized or the view is zoomed. Rectangle geometry reuses
//!   [`crate::coords::RectI`] directly rather than inventing a parallel
//!   type for the same space.
//! - **SHA-256 source binding.** A sidecar records the SHA-256 of the exact
//!   source bytes it was drawn against ([`source_sha256_hex`]). A mismatch
//!   ([`check_source_binding`] returning [`SourceBinding::Stale`]) must
//!   block automatic render/export against the new pixels; a caller may
//!   still show the stale sidecar for inspection/recovery, but never apply
//!   it silently. Race safety is a calling-convention guarantee this module
//!   enables but cannot enforce by itself: a caller must compute the hash
//!   from the *same* byte slice it is about to use for the read/write that
//!   follows, never from a second, separately-timed read of the file.
//! - **Atomic persistence is the Tauri shell's job** (temp-write-then-
//!   rename, mirroring the finalize pattern already used for capture
//!   uploads in `app/src/main.rs`); this module validates and serializes
//!   only, so it stays pure and testable without the filesystem.
//! - **Schema versioning fails closed.** [`parse_sidecar`] checks
//!   `schemaVersion` against [`ANNOTATIONS_SCHEMA_VERSION`] before
//!   attempting to deserialize the rest of the document, so a newer,
//!   unrecognized schema is reported as unsupported rather than silently
//!   misparsed or truncated.
//!
//! Rendering (turning a sidecar plus source pixels into a flattened image)
//! and interactive drawing are explicitly out of scope for this module: the
//! PNG decoder in [`crate::png`] only round-trips this crate's own encoder
//! output (see its doc comment — "foreign PNGs continue to flow through the
//! Rung 1 editor's decoder"), so general image compositing already belongs
//! in the webview layer, which has a real image decoder and a 2D canvas for
//! free. The renderer and flatten/export primitive live there, consuming
//! this module's validated sidecar shape as their input contract.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::coords::RectI;

/// Current sidecar schema version. [`parse_sidecar`] rejects anything newer.
pub const ANNOTATIONS_SCHEMA_VERSION: u32 = 1;

/// Fixed `kind` discriminator for the sidecar envelope, mirroring
/// [`crate::artifact`]'s sidecar `kind` field convention.
pub const ANNOTATIONS_KIND: &str = "annotations";

/// Per-sidecar cap on the number of annotations. Generous for real use, and
/// cheap insurance against an unbounded sidecar (hand-edited or corrupt)
/// forcing an unbounded render/validate pass.
pub const MAX_ITEMS: usize = 500;

/// Per-annotation text cap, matching [`crate::ai_edit::MAX_PROMPT_CHARS`]'s
/// reasoning: generous for a caption, cheap insurance against abuse.
pub const MAX_TEXT_CHARS: usize = 2000;

/// An integer point in source-image pixel coordinates (the same space as
/// [`crate::coords::RectI`] — `PhysicalRaster`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PointI {
    pub x: i64,
    pub y: i64,
}

/// RGBA color, 0-255 per channel. Defined here rather than reused from a UI
/// framework type, so the sidecar format has no UI-layer dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

/// The sidecar's canvas size: the source image's own pixel dimensions.
/// Every annotation's geometry must fall within `[0, w] x [0, h]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Canvas {
    pub w: u32,
    pub h: u32,
}

/// Per-kind geometry and style. Each variant's shape is exactly what that
/// kind needs, validated on parse by [`validate_sidecar`] — never inferred,
/// never shared beyond what two kinds genuinely have in common.
///
/// `Callout` persists no displayed number. Per the approved plan's fix to
/// the original schema contradiction: the displayed 1..N numbering is
/// always *derived*, never stored. The stable, persisted order is each
/// callout's position among callout-kind items in the sidecar's `items`
/// array — array order is already a durable, explicit order, so no
/// parallel "order" integer is needed. Deleting or reordering an item can
/// therefore never leave a gap or a stale persisted number, because no
/// number is ever written down.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AnnotationBody {
    #[serde(rename_all = "camelCase")]
    Rect {
        geometry: RectI,
        color: Rgba,
        stroke_width: u32,
    },
    #[serde(rename_all = "camelCase")]
    Arrow {
        from: PointI,
        to: PointI,
        color: Rgba,
        stroke_width: u32,
    },
    #[serde(rename_all = "camelCase")]
    Line {
        from: PointI,
        to: PointI,
        color: Rgba,
        stroke_width: u32,
    },
    /// A translucent fill, drawn without a stroke — distinct from `Rect`
    /// (which always has a visible border) rather than overloading one
    /// variant with an optional stroke.
    #[serde(rename_all = "camelCase")]
    Highlight { geometry: RectI, color: Rgba },
    #[serde(rename_all = "camelCase")]
    Text {
        anchor: PointI,
        max_width: u32,
        color: Rgba,
        text: String,
    },
    /// A region to blur. Reversible while editing (it is just another
    /// sidecar item); see `docs/annotations.md` for how Slice 2's
    /// irreversible redaction differs from this.
    #[serde(rename_all = "camelCase")]
    Blur { geometry: RectI },
    #[serde(rename_all = "camelCase")]
    Callout { anchor: PointI, color: Rgba },
}

/// One annotation: a stable identity plus its kind-specific body. `id` is
/// caller-assigned (the UI mints it, e.g. a UUID) and is how the UI selects,
/// edits, or deletes a specific annotation across sidecar reads/writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    #[serde(flatten)]
    pub body: AnnotationBody,
}

/// The on-disk sidecar. Field order is the serialized order, matching
/// [`crate::artifact::Sidecar`]'s convention.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationsSidecar {
    pub schema_version: u32,
    pub kind: String,
    pub source_sha256: String,
    pub canvas: Canvas,
    pub items: Vec<Annotation>,
}

impl AnnotationsSidecar {
    /// A new, empty sidecar bound to `source_sha256` (see
    /// [`source_sha256_hex`]) and sized to `canvas`.
    pub fn new(source_sha256: String, canvas: Canvas) -> Self {
        AnnotationsSidecar {
            schema_version: ANNOTATIONS_SCHEMA_VERSION,
            kind: ANNOTATIONS_KIND.to_string(),
            source_sha256,
            canvas,
            items: Vec::new(),
        }
    }

    /// Validates, then serializes. A caller can never write out a sidecar
    /// this module itself considers invalid.
    pub fn to_json(&self) -> Result<String, AnnotationsError> {
        validate_sidecar(self)?;
        serde_json::to_string(self).map_err(|e| AnnotationsError::Json(e.to_string()))
    }

    /// The displayed callout numbers, 1..N in array order, for this
    /// sidecar's current `items` — the one place numbering is computed.
    /// Never persisted (see [`AnnotationBody::Callout`]'s doc comment).
    pub fn callout_numbers(&self) -> Vec<(String, u32)> {
        self.items
            .iter()
            .filter(|item| matches!(item.body, AnnotationBody::Callout { .. }))
            .enumerate()
            .map(|(i, item)| (item.id.clone(), i as u32 + 1))
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnnotationsError {
    KindMismatch { found: String },
    UnsupportedSchemaVersion { found: u32 },
    MissingSchemaVersion,
    BadCanvas { w: u32, h: u32 },
    EmptyId,
    DuplicateId(String),
    TooManyItems { count: usize },
    GeometryOutOfBounds(String),
    DegenerateGeometry(String),
    ZeroStrokeWidth,
    EmptyText,
    TextTooLong { chars: usize },
    Json(String),
}

impl std::fmt::Display for AnnotationsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AnnotationsError::KindMismatch { found } => {
                write!(
                    f,
                    "sidecar kind mismatch: expected {ANNOTATIONS_KIND}, found {found}"
                )
            }
            AnnotationsError::UnsupportedSchemaVersion { found } => {
                write!(f, "unsupported annotations schema version {found} (this build reads {ANNOTATIONS_SCHEMA_VERSION})")
            }
            AnnotationsError::MissingSchemaVersion => {
                write!(f, "sidecar is missing schemaVersion")
            }
            AnnotationsError::BadCanvas { w, h } => {
                write!(f, "canvas dimensions {w}x{h} must be positive")
            }
            AnnotationsError::EmptyId => write!(f, "annotation id must not be empty"),
            AnnotationsError::DuplicateId(id) => write!(f, "duplicate annotation id: {id}"),
            AnnotationsError::TooManyItems { count } => {
                write!(f, "{count} annotations exceeds the {MAX_ITEMS} cap")
            }
            AnnotationsError::GeometryOutOfBounds(detail) => {
                write!(f, "annotation geometry is outside the canvas: {detail}")
            }
            AnnotationsError::DegenerateGeometry(detail) => {
                write!(f, "annotation geometry is degenerate: {detail}")
            }
            AnnotationsError::ZeroStrokeWidth => write!(f, "stroke width must be positive"),
            AnnotationsError::EmptyText => write!(f, "text annotation must not be empty"),
            AnnotationsError::TextTooLong { chars } => {
                write!(
                    f,
                    "text is {chars} characters, exceeding the {MAX_TEXT_CHARS} cap"
                )
            }
            AnnotationsError::Json(e) => write!(f, "sidecar JSON error: {e}"),
        }
    }
}

impl std::error::Error for AnnotationsError {}

fn check_canvas(canvas: Canvas) -> Result<(), AnnotationsError> {
    if canvas.w == 0 || canvas.h == 0 {
        return Err(AnnotationsError::BadCanvas {
            w: canvas.w,
            h: canvas.h,
        });
    }
    Ok(())
}

/// A point must fall within the canvas, inclusive of its edges (a point
/// exactly on the right/bottom edge is valid — it is the boundary of the
/// last pixel, not past it).
fn check_point_in_canvas(p: PointI, canvas: Canvas) -> Result<(), AnnotationsError> {
    if p.x < 0 || p.y < 0 || p.x > canvas.w as i64 || p.y > canvas.h as i64 {
        return Err(AnnotationsError::GeometryOutOfBounds(format!(
            "point ({}, {}) outside {}x{} canvas",
            p.x, p.y, canvas.w, canvas.h
        )));
    }
    Ok(())
}

fn check_rect_in_canvas(r: RectI, canvas: Canvas) -> Result<(), AnnotationsError> {
    if r.is_empty() {
        return Err(AnnotationsError::DegenerateGeometry(format!(
            "rect {}x{} at ({}, {}) has zero area",
            r.w, r.h, r.x, r.y
        )));
    }
    if r.x < 0 || r.y < 0 || r.right() > canvas.w as i64 || r.bottom() > canvas.h as i64 {
        return Err(AnnotationsError::GeometryOutOfBounds(format!(
            "rect {}x{} at ({}, {}) outside {}x{} canvas",
            r.w, r.h, r.x, r.y, canvas.w, canvas.h
        )));
    }
    Ok(())
}

fn check_stroke_width(w: u32) -> Result<(), AnnotationsError> {
    if w == 0 {
        return Err(AnnotationsError::ZeroStrokeWidth);
    }
    Ok(())
}

fn check_text(text: &str) -> Result<(), AnnotationsError> {
    if text.is_empty() {
        return Err(AnnotationsError::EmptyText);
    }
    let chars = text.chars().count();
    if chars > MAX_TEXT_CHARS {
        return Err(AnnotationsError::TextTooLong { chars });
    }
    Ok(())
}

fn validate_body(body: &AnnotationBody, canvas: Canvas) -> Result<(), AnnotationsError> {
    match body {
        AnnotationBody::Rect {
            geometry,
            stroke_width,
            ..
        } => {
            check_rect_in_canvas(*geometry, canvas)?;
            check_stroke_width(*stroke_width)?;
        }
        AnnotationBody::Highlight { geometry, .. } => {
            check_rect_in_canvas(*geometry, canvas)?;
        }
        AnnotationBody::Arrow {
            from,
            to,
            stroke_width,
            ..
        }
        | AnnotationBody::Line {
            from,
            to,
            stroke_width,
            ..
        } => {
            check_point_in_canvas(*from, canvas)?;
            check_point_in_canvas(*to, canvas)?;
            check_stroke_width(*stroke_width)?;
            if from == to {
                return Err(AnnotationsError::DegenerateGeometry(format!(
                    "line/arrow endpoints coincide at ({}, {})",
                    from.x, from.y
                )));
            }
        }
        AnnotationBody::Text {
            anchor,
            max_width,
            text,
            ..
        } => {
            check_point_in_canvas(*anchor, canvas)?;
            if *max_width == 0 {
                return Err(AnnotationsError::DegenerateGeometry(
                    "text max_width must be positive".to_string(),
                ));
            }
            check_text(text)?;
        }
        AnnotationBody::Blur { geometry } => {
            check_rect_in_canvas(*geometry, canvas)?;
        }
        AnnotationBody::Callout { anchor, .. } => {
            check_point_in_canvas(*anchor, canvas)?;
        }
    }
    Ok(())
}

/// Full structural validation: canvas, item count, id uniqueness, and every
/// item's geometry against the canvas. Called by [`AnnotationsSidecar::to_json`]
/// (a caller can never write an invalid sidecar) and by [`parse_sidecar`] (a
/// caller can never read one back as valid either — corruption or a
/// hand-edit cannot slip past both ends of the contract).
pub fn validate_sidecar(sidecar: &AnnotationsSidecar) -> Result<(), AnnotationsError> {
    check_canvas(sidecar.canvas)?;
    if sidecar.items.len() > MAX_ITEMS {
        return Err(AnnotationsError::TooManyItems {
            count: sidecar.items.len(),
        });
    }
    let mut seen: HashSet<&str> = HashSet::with_capacity(sidecar.items.len());
    for item in &sidecar.items {
        if item.id.is_empty() {
            return Err(AnnotationsError::EmptyId);
        }
        if !seen.insert(item.id.as_str()) {
            return Err(AnnotationsError::DuplicateId(item.id.clone()));
        }
        validate_body(&item.body, sidecar.canvas)?;
    }
    Ok(())
}

/// Strict sidecar parse: the schema version is checked against the raw JSON
/// value *before* attempting to deserialize into [`AnnotationsSidecar`], so
/// a newer, structurally-different schema is reported as unsupported rather
/// than silently misparsed, truncated, or defaulted. Then full structural
/// validation (`validate_sidecar`) runs, so a parsed sidecar is always one
/// this module itself considers valid.
pub fn parse_sidecar(input: &str) -> Result<AnnotationsSidecar, AnnotationsError> {
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|e| AnnotationsError::Json(e.to_string()))?;
    let version = value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or(AnnotationsError::MissingSchemaVersion)?;
    if version > ANNOTATIONS_SCHEMA_VERSION as u64 {
        return Err(AnnotationsError::UnsupportedSchemaVersion {
            found: version as u32,
        });
    }
    let sidecar: AnnotationsSidecar =
        serde_json::from_value(value).map_err(|e| AnnotationsError::Json(e.to_string()))?;
    if sidecar.kind != ANNOTATIONS_KIND {
        return Err(AnnotationsError::KindMismatch {
            found: sidecar.kind.clone(),
        });
    }
    validate_sidecar(&sidecar)?;
    Ok(sidecar)
}

/// SHA-256 of `bytes`, lowercase hex. The caller must compute this from the
/// *exact* byte slice it is about to read or write against immediately
/// after — see the module doc's race-safety note. No file I/O here; this
/// module never reads a file twice on a caller's behalf.
pub fn source_sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Whether a sidecar's recorded source hash matches the source bytes a
/// caller is about to use it against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceBinding {
    /// The sidecar's `sourceSha256` matches: safe to render/export.
    Fresh,
    /// The source bytes do not match what the sidecar was drawn against.
    /// The caller may still show the sidecar for inspection/recovery, but
    /// must refuse to render/export it against these bytes until the user
    /// (or an explicit, logged decision) accepts the mismatch.
    Stale,
}

pub fn check_source_binding(sidecar: &AnnotationsSidecar, source_bytes: &[u8]) -> SourceBinding {
    if source_sha256_hex(source_bytes) == sidecar.source_sha256 {
        SourceBinding::Fresh
    } else {
        SourceBinding::Stale
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canvas() -> Canvas {
        Canvas { w: 800, h: 600 }
    }

    fn red() -> Rgba {
        Rgba {
            r: 255,
            g: 0,
            b: 0,
            a: 255,
        }
    }

    fn sample_rect() -> Annotation {
        Annotation {
            id: "a1".to_string(),
            body: AnnotationBody::Rect {
                geometry: RectI {
                    x: 10,
                    y: 10,
                    w: 100,
                    h: 50,
                },
                color: red(),
                stroke_width: 2,
            },
        }
    }

    fn sidecar_with(items: Vec<Annotation>) -> AnnotationsSidecar {
        let mut s = AnnotationsSidecar::new("a".repeat(64), canvas());
        s.items = items;
        s
    }

    #[test]
    fn empty_sidecar_round_trips() {
        let s = AnnotationsSidecar::new("b".repeat(64), canvas());
        let json = s.to_json().unwrap();
        let back = parse_sidecar(&json).unwrap();
        assert_eq!(back, s);
        assert_eq!(back.schema_version, ANNOTATIONS_SCHEMA_VERSION);
        assert_eq!(back.kind, ANNOTATIONS_KIND);
    }

    #[test]
    fn a_sidecar_with_one_of_each_kind_round_trips() {
        let items = vec![
            sample_rect(),
            Annotation {
                id: "a2".to_string(),
                body: AnnotationBody::Arrow {
                    from: PointI { x: 0, y: 0 },
                    to: PointI { x: 50, y: 50 },
                    color: red(),
                    stroke_width: 3,
                },
            },
            Annotation {
                id: "a3".to_string(),
                body: AnnotationBody::Line {
                    from: PointI { x: 0, y: 0 },
                    to: PointI { x: 10, y: 0 },
                    color: red(),
                    stroke_width: 1,
                },
            },
            Annotation {
                id: "a4".to_string(),
                body: AnnotationBody::Highlight {
                    geometry: RectI {
                        x: 0,
                        y: 0,
                        w: 20,
                        h: 20,
                    },
                    color: red(),
                },
            },
            Annotation {
                id: "a5".to_string(),
                body: AnnotationBody::Text {
                    anchor: PointI { x: 5, y: 5 },
                    max_width: 200,
                    color: red(),
                    text: "note".to_string(),
                },
            },
            Annotation {
                id: "a6".to_string(),
                body: AnnotationBody::Blur {
                    geometry: RectI {
                        x: 0,
                        y: 0,
                        w: 30,
                        h: 30,
                    },
                },
            },
            Annotation {
                id: "a7".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 1, y: 1 },
                    color: red(),
                },
            },
        ];
        let s = sidecar_with(items);
        let json = s.to_json().unwrap();
        let back = parse_sidecar(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn to_json_is_deterministic() {
        let s = sidecar_with(vec![sample_rect()]);
        assert_eq!(s.to_json().unwrap(), s.to_json().unwrap());
    }

    #[test]
    fn unsupported_newer_schema_version_fails_closed() {
        let future = r#"{"schemaVersion":2,"kind":"annotations","sourceSha256":"x","canvas":{"w":1,"h":1},"items":[]}"#;
        let err = parse_sidecar(future).unwrap_err();
        assert_eq!(err, AnnotationsError::UnsupportedSchemaVersion { found: 2 });
    }

    #[test]
    fn missing_schema_version_fails_closed() {
        let bad = r#"{"kind":"annotations","sourceSha256":"x","canvas":{"w":1,"h":1},"items":[]}"#;
        assert_eq!(
            parse_sidecar(bad).unwrap_err(),
            AnnotationsError::MissingSchemaVersion
        );
    }

    #[test]
    fn wrong_kind_is_rejected() {
        let bad = r#"{"schemaVersion":1,"kind":"something-else","sourceSha256":"x","canvas":{"w":1,"h":1},"items":[]}"#;
        assert_eq!(
            parse_sidecar(bad).unwrap_err(),
            AnnotationsError::KindMismatch {
                found: "something-else".to_string()
            }
        );
    }

    #[test]
    fn corrupt_json_is_rejected() {
        assert!(matches!(
            parse_sidecar("{not json"),
            Err(AnnotationsError::Json(_))
        ));
    }

    #[test]
    fn zero_canvas_is_rejected() {
        let s = AnnotationsSidecar::new("c".repeat(64), Canvas { w: 0, h: 10 });
        assert_eq!(
            s.to_json().unwrap_err(),
            AnnotationsError::BadCanvas { w: 0, h: 10 }
        );
    }

    #[test]
    fn empty_id_is_rejected() {
        let mut item = sample_rect();
        item.id = String::new();
        let s = sidecar_with(vec![item]);
        assert_eq!(s.to_json().unwrap_err(), AnnotationsError::EmptyId);
    }

    #[test]
    fn duplicate_id_is_rejected() {
        let s = sidecar_with(vec![sample_rect(), sample_rect()]);
        assert_eq!(
            s.to_json().unwrap_err(),
            AnnotationsError::DuplicateId("a1".to_string())
        );
    }

    #[test]
    fn too_many_items_is_rejected() {
        let items: Vec<Annotation> = (0..MAX_ITEMS + 1)
            .map(|i| Annotation {
                id: format!("a{i}"),
                body: AnnotationBody::Rect {
                    geometry: RectI {
                        x: 0,
                        y: 0,
                        w: 1,
                        h: 1,
                    },
                    color: red(),
                    stroke_width: 1,
                },
            })
            .collect();
        let s = sidecar_with(items);
        assert_eq!(
            s.to_json().unwrap_err(),
            AnnotationsError::TooManyItems {
                count: MAX_ITEMS + 1
            }
        );
    }

    #[test]
    fn rect_geometry_outside_canvas_is_rejected() {
        let mut item = sample_rect();
        item.body = AnnotationBody::Rect {
            geometry: RectI {
                x: 750,
                y: 10,
                w: 100,
                h: 50,
            },
            color: red(),
            stroke_width: 2,
        };
        let s = sidecar_with(vec![item]);
        assert!(matches!(
            s.to_json().unwrap_err(),
            AnnotationsError::GeometryOutOfBounds(_)
        ));
    }

    #[test]
    fn a_rect_exactly_on_the_canvas_edge_is_accepted() {
        let mut item = sample_rect();
        item.body = AnnotationBody::Rect {
            geometry: RectI {
                x: 700,
                y: 500,
                w: 100,
                h: 100,
            },
            color: red(),
            stroke_width: 2,
        };
        let s = sidecar_with(vec![item]);
        assert!(s.to_json().is_ok());
    }

    #[test]
    fn zero_area_rect_is_rejected() {
        let mut item = sample_rect();
        item.body = AnnotationBody::Rect {
            geometry: RectI {
                x: 10,
                y: 10,
                w: 0,
                h: 50,
            },
            color: red(),
            stroke_width: 2,
        };
        let s = sidecar_with(vec![item]);
        assert!(matches!(
            s.to_json().unwrap_err(),
            AnnotationsError::DegenerateGeometry(_)
        ));
    }

    #[test]
    fn coincident_arrow_endpoints_are_rejected() {
        let item = Annotation {
            id: "a2".to_string(),
            body: AnnotationBody::Arrow {
                from: PointI { x: 5, y: 5 },
                to: PointI { x: 5, y: 5 },
                color: red(),
                stroke_width: 1,
            },
        };
        let s = sidecar_with(vec![item]);
        assert!(matches!(
            s.to_json().unwrap_err(),
            AnnotationsError::DegenerateGeometry(_)
        ));
    }

    #[test]
    fn zero_stroke_width_is_rejected() {
        let mut item = sample_rect();
        item.body = AnnotationBody::Rect {
            geometry: RectI {
                x: 10,
                y: 10,
                w: 10,
                h: 10,
            },
            color: red(),
            stroke_width: 0,
        };
        let s = sidecar_with(vec![item]);
        assert_eq!(s.to_json().unwrap_err(), AnnotationsError::ZeroStrokeWidth);
    }

    #[test]
    fn empty_text_is_rejected() {
        let item = Annotation {
            id: "a2".to_string(),
            body: AnnotationBody::Text {
                anchor: PointI { x: 0, y: 0 },
                max_width: 100,
                color: red(),
                text: String::new(),
            },
        };
        let s = sidecar_with(vec![item]);
        assert_eq!(s.to_json().unwrap_err(), AnnotationsError::EmptyText);
    }

    #[test]
    fn text_over_the_cap_is_rejected() {
        let item = Annotation {
            id: "a2".to_string(),
            body: AnnotationBody::Text {
                anchor: PointI { x: 0, y: 0 },
                max_width: 100,
                color: red(),
                text: "x".repeat(MAX_TEXT_CHARS + 1),
            },
        };
        let s = sidecar_with(vec![item]);
        assert_eq!(
            s.to_json().unwrap_err(),
            AnnotationsError::TextTooLong {
                chars: MAX_TEXT_CHARS + 1
            }
        );
    }

    #[test]
    fn callout_numbers_are_derived_in_array_order_and_never_stored() {
        let items = vec![
            Annotation {
                id: "c1".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 1, y: 1 },
                    color: red(),
                },
            },
            sample_rect(), // not a callout; must not consume a number
            Annotation {
                id: "c2".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 2, y: 2 },
                    color: red(),
                },
            },
        ];
        let s = sidecar_with(items);
        assert_eq!(
            s.callout_numbers(),
            vec![("c1".to_string(), 1), ("c2".to_string(), 2)]
        );
        // The serialized form must never contain a step/number field for a callout.
        let json = s.to_json().unwrap();
        assert!(!json.contains("\"step\""));
        assert!(!json.contains("\"number\""));
        assert!(!json.contains("\"order\""));
    }

    #[test]
    fn deleting_a_callout_renumbers_the_rest_with_no_gap() {
        let items = vec![
            Annotation {
                id: "c1".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 1, y: 1 },
                    color: red(),
                },
            },
            Annotation {
                id: "c2".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 2, y: 2 },
                    color: red(),
                },
            },
            Annotation {
                id: "c3".to_string(),
                body: AnnotationBody::Callout {
                    anchor: PointI { x: 3, y: 3 },
                    color: red(),
                },
            },
        ];
        let mut s = sidecar_with(items);
        s.items.retain(|item| item.id != "c2"); // delete the middle one
        assert_eq!(
            s.callout_numbers(),
            vec![("c1".to_string(), 1), ("c3".to_string(), 2)]
        );
    }

    #[test]
    fn source_sha256_matches_a_known_vector() {
        // SHA-256("") — the standard empty-string test vector.
        assert_eq!(
            source_sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"[..64]
        );
    }

    #[test]
    fn source_binding_is_fresh_for_the_exact_bytes_and_stale_for_any_other() {
        let bytes = b"pretend png bytes";
        let sidecar = AnnotationsSidecar::new(source_sha256_hex(bytes), canvas());
        assert_eq!(check_source_binding(&sidecar, bytes), SourceBinding::Fresh);
        assert_eq!(
            check_source_binding(&sidecar, b"different bytes"),
            SourceBinding::Stale
        );
    }

    #[test]
    fn a_single_byte_difference_in_the_source_is_detected_as_stale() {
        let mut bytes = b"pretend png bytes".to_vec();
        let sidecar = AnnotationsSidecar::new(source_sha256_hex(&bytes), canvas());
        bytes[0] ^= 0x01;
        assert_eq!(check_source_binding(&sidecar, &bytes), SourceBinding::Stale);
    }
}
