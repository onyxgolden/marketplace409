//! Durable per-capture metadata contract — Slice 4 of 4 (durable tags and a
//! rebuildable local library index).
//!
//! Design, per the approved plan
//! (`forge-ai-drop`'s `commands/chatgpt/forge-capture-annotation-plan-rereview.md`):
//!
//! - **User-authored tags are not stored only in the index.** They live
//!   here, in a durable per-capture sidecar (`<stem>.meta.json`), separate
//!   from the capture's own `.forge.json` provenance sidecar
//!   ([`crate::artifact`]) and from the annotation sidecar
//!   ([`crate::annotations`]) — three sidecars, three different lifetimes
//!   and owners, never conflated. `library_index` *projects* these tags
//!   into the rebuildable index; it never originates them.
//! - Same schema-versioning and fail-closed discipline as
//!   [`crate::annotations`]: an unsupported `schemaVersion` is rejected,
//!   not guessed at.
//!
//! Pure logic only; the Tauri shell owns the filesystem, same division as
//! every other module here.

use serde::{Deserialize, Serialize};

/// Current schema version. [`parse_meta`] rejects anything else.
pub const CAPTURE_META_SCHEMA_VERSION: u32 = 1;

/// Fixed `kind` discriminator, mirroring every other sidecar in this program.
pub const CAPTURE_META_KIND: &str = "capture-meta";

/// Per-capture cap on the number of tags. Generous for real use, cheap insurance against an
/// unbounded sidecar (hand-edited or corrupt) forcing unbounded index/search work.
pub const MAX_TAGS: usize = 50;

/// Per-tag character cap.
pub const MAX_TAG_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMeta {
    pub schema_version: u32,
    pub kind: String,
    pub tags: Vec<String>,
}

impl CaptureMeta {
    /// A new, empty metadata sidecar.
    pub fn new() -> Self {
        CaptureMeta {
            schema_version: CAPTURE_META_SCHEMA_VERSION,
            kind: CAPTURE_META_KIND.to_string(),
            tags: Vec::new(),
        }
    }

    /// Validates, then serializes. A caller can never write out metadata this module itself
    /// considers invalid.
    pub fn to_json(&self) -> Result<String, CaptureMetaError> {
        validate_meta(self)?;
        serde_json::to_string(self).map_err(|e| CaptureMetaError::Json(e.to_string()))
    }
}

impl Default for CaptureMeta {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureMetaError {
    KindMismatch { found: String },
    UnsupportedSchemaVersion { found: u32 },
    MissingSchemaVersion,
    EmptyTag,
    TagTooLong { chars: usize },
    DuplicateTag(String),
    TooManyTags { count: usize },
    Json(String),
}

impl std::fmt::Display for CaptureMetaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureMetaError::KindMismatch { found } => {
                write!(
                    f,
                    "capture-meta kind mismatch: expected {CAPTURE_META_KIND}, found {found}"
                )
            }
            CaptureMetaError::UnsupportedSchemaVersion { found } => {
                write!(f, "unsupported capture-meta schema version {found} (this build reads {CAPTURE_META_SCHEMA_VERSION})")
            }
            CaptureMetaError::MissingSchemaVersion => {
                write!(f, "capture-meta is missing schemaVersion")
            }
            CaptureMetaError::EmptyTag => write!(f, "a tag must not be empty"),
            CaptureMetaError::TagTooLong { chars } => {
                write!(
                    f,
                    "a tag is {chars} characters, exceeding the {MAX_TAG_CHARS} cap"
                )
            }
            CaptureMetaError::DuplicateTag(t) => write!(f, "duplicate tag: {t}"),
            CaptureMetaError::TooManyTags { count } => {
                write!(f, "{count} tags exceeds the {MAX_TAGS} cap")
            }
            CaptureMetaError::Json(e) => write!(f, "capture-meta JSON error: {e}"),
        }
    }
}

impl std::error::Error for CaptureMetaError {}

pub fn validate_meta(meta: &CaptureMeta) -> Result<(), CaptureMetaError> {
    if meta.tags.len() > MAX_TAGS {
        return Err(CaptureMetaError::TooManyTags {
            count: meta.tags.len(),
        });
    }
    let mut seen = std::collections::HashSet::with_capacity(meta.tags.len());
    for tag in &meta.tags {
        if tag.is_empty() {
            return Err(CaptureMetaError::EmptyTag);
        }
        let chars = tag.chars().count();
        if chars > MAX_TAG_CHARS {
            return Err(CaptureMetaError::TagTooLong { chars });
        }
        if !seen.insert(tag.as_str()) {
            return Err(CaptureMetaError::DuplicateTag(tag.clone()));
        }
    }
    Ok(())
}

/// Strict parse: the schema version is checked against the raw JSON value before attempting to
/// deserialize the rest, same reasoning as [`crate::annotations::parse_sidecar`] -- a newer,
/// structurally-different schema is reported as unsupported rather than silently misparsed.
pub fn parse_meta(input: &str) -> Result<CaptureMeta, CaptureMetaError> {
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|e| CaptureMetaError::Json(e.to_string()))?;
    let version = value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or(CaptureMetaError::MissingSchemaVersion)?;
    if version != CAPTURE_META_SCHEMA_VERSION as u64 {
        return Err(CaptureMetaError::UnsupportedSchemaVersion {
            found: version as u32,
        });
    }
    let meta: CaptureMeta =
        serde_json::from_value(value).map_err(|e| CaptureMetaError::Json(e.to_string()))?;
    if meta.kind != CAPTURE_META_KIND {
        return Err(CaptureMetaError::KindMismatch {
            found: meta.kind.clone(),
        });
    }
    validate_meta(&meta)?;
    Ok(meta)
}

/// A tag as the caller typed it, trimmed. Pure normalization step a caller runs before adding a
/// tag to a [`CaptureMeta`] -- not applied automatically by `validate_meta`, which only checks
/// what it is given, so a caller cannot be surprised by silent rewriting.
pub fn normalize_tag(raw: &str) -> String {
    raw.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_meta_round_trips() {
        let m = CaptureMeta::new();
        let json = m.to_json().unwrap();
        let back = parse_meta(&json).unwrap();
        assert_eq!(back, m);
        assert_eq!(back.schema_version, CAPTURE_META_SCHEMA_VERSION);
        assert_eq!(back.kind, CAPTURE_META_KIND);
    }

    #[test]
    fn meta_with_tags_round_trips() {
        let mut m = CaptureMeta::new();
        m.tags = vec!["work-order".to_string(), "safety".to_string()];
        let json = m.to_json().unwrap();
        assert_eq!(parse_meta(&json).unwrap(), m);
    }

    #[test]
    fn to_json_is_deterministic() {
        let mut m = CaptureMeta::new();
        m.tags = vec!["a".to_string()];
        assert_eq!(m.to_json().unwrap(), m.to_json().unwrap());
    }

    #[test]
    fn unsupported_schema_version_fails_closed_both_directions() {
        let newer = r#"{"schemaVersion":2,"kind":"capture-meta","tags":[]}"#;
        assert_eq!(
            parse_meta(newer).unwrap_err(),
            CaptureMetaError::UnsupportedSchemaVersion { found: 2 }
        );
        let zero = r#"{"schemaVersion":0,"kind":"capture-meta","tags":[]}"#;
        assert_eq!(
            parse_meta(zero).unwrap_err(),
            CaptureMetaError::UnsupportedSchemaVersion { found: 0 }
        );
    }

    #[test]
    fn missing_schema_version_fails_closed() {
        assert_eq!(
            parse_meta(r#"{"kind":"capture-meta","tags":[]}"#).unwrap_err(),
            CaptureMetaError::MissingSchemaVersion
        );
    }

    #[test]
    fn wrong_kind_is_rejected() {
        let bad = r#"{"schemaVersion":1,"kind":"something-else","tags":[]}"#;
        assert_eq!(
            parse_meta(bad).unwrap_err(),
            CaptureMetaError::KindMismatch {
                found: "something-else".to_string()
            }
        );
    }

    #[test]
    fn empty_tag_is_rejected() {
        let mut m = CaptureMeta::new();
        m.tags = vec![String::new()];
        assert_eq!(m.to_json().unwrap_err(), CaptureMetaError::EmptyTag);
    }

    #[test]
    fn overlong_tag_is_rejected() {
        let mut m = CaptureMeta::new();
        m.tags = vec!["x".repeat(MAX_TAG_CHARS + 1)];
        assert_eq!(
            m.to_json().unwrap_err(),
            CaptureMetaError::TagTooLong {
                chars: MAX_TAG_CHARS + 1
            }
        );
    }

    #[test]
    fn duplicate_tag_is_rejected() {
        let mut m = CaptureMeta::new();
        m.tags = vec!["a".to_string(), "a".to_string()];
        assert_eq!(
            m.to_json().unwrap_err(),
            CaptureMetaError::DuplicateTag("a".to_string())
        );
    }

    #[test]
    fn too_many_tags_is_rejected() {
        let mut m = CaptureMeta::new();
        m.tags = (0..MAX_TAGS + 1).map(|i| format!("t{i}")).collect();
        assert_eq!(
            m.to_json().unwrap_err(),
            CaptureMetaError::TooManyTags {
                count: MAX_TAGS + 1
            }
        );
    }

    #[test]
    fn normalize_tag_trims_whitespace_only() {
        assert_eq!(normalize_tag("  work order  "), "work order");
        assert_eq!(normalize_tag("safety"), "safety");
    }
}
