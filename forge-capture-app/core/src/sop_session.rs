//! FORGE Capture Phase 2 — SOP session contract (build slice C2-P1).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! in forge-ai-drop, §4 (data model) and §3.5 (verification/review state
//! machine). This module is the pure half of that contract — schema,
//! session/frame/edit-event shapes, SHA-256 digest binding, revision/
//! staleness checks, and deterministic edit-event replay — mirroring how
//! [`crate::annotations`] owns the annotation sidecar contract without
//! touching the filesystem, and [`crate::artifact`] owns the capture
//! provenance contract the same way. The actual filesystem workspace,
//! atomic write, and DPAPI vault live in the Tauri shell
//! (`app/src/sop_workspace.rs`); the sidecar IPC protocol types live in
//! [`crate::sop_ipc`].
//!
//! **Not this module's job**, per the brief: OCR, redaction detection,
//! captioning, or any ML inference (§2.1 — that's the sidecar process,
//! C2-P2 onward). This slice is session state/contracts only.
//!
//! Design notes carried over from [`crate::annotations`]'s established
//! pattern:
//! - **Schema versioning fails closed**: [`parse_session`] checks
//!   `schema_version` against [`SOP_SESSION_SCHEMA_VERSION`] before
//!   attempting to deserialize the rest.
//! - **SHA-256 source binding**: [`check_source_binding`] mirrors
//!   [`crate::annotations::check_source_binding`] exactly — a derivative
//!   or caption bound to a stale source digest must never be presented as
//!   current.
//! - **The model's suggestion is immutable** (brief §4, `CaptionDraft`):
//!   current displayed text is always *projected* from the append-only
//!   [`EditEvent`] log by [`project_steps`], never stored as a separate
//!   mutable field — this is what makes "revert to AI suggestion"
//!   ([`EditOperation::Revert`]) deterministic and race-free the same way
//!   annotation numbering is always derived, never persisted (see that
//!   module's own doc comment on why).
//! - **External sources are never deletable by session discard** (brief
//!   §4: "existing imported captures are not falsely described as
//!   temporary... deletion of the session never deletes them") —
//!   [`SourceStorage::ExternalUserOwned`] vs. [`SourceStorage::SessionEncrypted`]
//!   is the one field [`session_discard_deletes_frame`] consults, and nothing
//!   else can override it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Current session schema version. [`parse_session`] rejects anything newer.
pub const SOP_SESSION_SCHEMA_VERSION: u32 = 1;
/// Fixed `kind` discriminator for the session envelope, mirroring
/// [`crate::artifact::ARTIFACT_KIND`] / [`crate::annotations::ANNOTATIONS_KIND`].
pub const SOP_SESSION_KIND: &str = "forge-capture-sop-session";

/// Brief §7: "sequences up to 50 frames; larger sequences require explicit
/// batching and show an incomplete status."
pub const MAX_FRAMES_PER_SESSION: usize = 50;
/// Brief §4 `OcrToken`: "Bound totals: <=50,000 tokens... per session."
pub const MAX_OCR_TOKENS_PER_SESSION: usize = 50_000;
/// Brief §4 `OcrToken`: "...and <=10 MiB OCR JSON per session."
pub const MAX_OCR_JSON_BYTES_PER_SESSION: usize = 10 * 1024 * 1024;

/// SHA-256 of `bytes`, lowercase hex — same convention as
/// [`crate::annotations::source_sha256_hex`] / [`crate::artifact`]'s own
/// digest fields.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Brief §4 `SourceFrame.originalStorage`: the one field that decides
/// whether discarding a session is allowed to delete the frame's raw
/// pixels. Nothing else ([`ReviewState`], age, user intent expressed any
/// other way) may override this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStorage {
    /// A raw frame captured specifically for this SOP session — encrypted
    /// at rest (DPAPI, see `app/src/sop_workspace.rs`), deletable when the
    /// session is explicitly discarded or its retention expires.
    SessionEncrypted,
    /// An existing capture the user imported — a user-owned file on disk
    /// that predates and outlives this session. Brief §4: discarding the
    /// session must never delete it.
    ExternalUserOwned,
}

/// Brief §3.5's verification/review state machine. `Verified` is a
/// terminal state only [`FrameVerification::Verified`] feeds into — see
/// [`session_discard_deletes_frame`] and the sidecar IPC layer for how
/// export/cloud eligibility consumes this (not duplicated as a second
/// source of truth here).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FrameVerification {
    Pending,
    ReviewRequired,
    Blocked,
    Verified,
}

/// Session-level review gate (brief §3.5: "cloud enhancement and
/// share/export remain disabled until every included frame is VERIFIED
/// and the user performs a final... confirmation").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewState {
    NotStarted,
    InProgress,
    ReviewRequired,
    Blocked,
    Verified,
}

/// A redaction candidate's disposition — brief §3.5: "require a
/// disposition for each unresolved region: REDACT or MARK_NON_SENSITIVE."
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Disposition {
    Pending,
    Redact,
    MarkNonSensitive,
}

/// Brief §4 `OcrToken`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrToken {
    pub token_id: String,
    pub text: String,
    pub box_x: i64,
    pub box_y: i64,
    pub box_w: u64,
    pub box_h: u64,
    pub line_id: String,
    pub language: String,
    pub confidence: f32,
    pub engine_identity: String,
}

/// Brief §4 `RedactionCandidate`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionCandidate {
    pub candidate_id: String,
    pub detector_id: String,
    pub reason_code: String,
    pub source_token_ids: Vec<String>,
    pub original_box: (i64, i64, u64, u64),
    pub expanded_box: (i64, i64, u64, u64),
    pub score: Option<f32>,
    pub disposition: Disposition,
    /// The [`EditEvent::event_id`] that set the current disposition, if
    /// any — `None` means still at its detector-assigned default.
    pub disposition_event_id: Option<String>,
}

/// Brief §4 `SourceFrame`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFrame {
    pub frame_id: String,
    pub order: u32,
    /// Path relative to the approved session/capture root — never an
    /// absolute path, never containing `..`. [`crate::sop_ipc`] enforces
    /// confinement at the IPC boundary; this field is just the validated
    /// shape.
    pub source_relative_path: String,
    pub raster_sha256: String,
    pub provenance_sidecar_relative_path: Option<String>,
    pub provenance_sidecar_blob_sha256: Option<String>,
    pub width: u32,
    pub height: u32,
    pub captured_at: String,
    pub action_kind: String,
    pub click_box: Option<(i64, i64, u64, u64)>,
    pub process_basename: Option<String>,
    /// Omitted (`None`) unless the user has explicitly opted in — brief
    /// §2.4: "Window titles are excluded by default."
    pub window_title: Option<String>,
    pub original_storage: SourceStorage,
    pub ocr_status: Option<String>,
    pub redacted_derivative_relative_path: Option<String>,
    pub redacted_derivative_sha256: Option<String>,
    pub redaction_candidates: Vec<RedactionCandidate>,
    pub verification: FrameVerification,
}

/// Brief §4 `CaptionDraft`. `model_suggestion`/`suggestion_digest` are
/// immutable once set; current displayed text is never stored here — see
/// [`project_steps`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionDraft {
    pub step_id: String,
    pub source_frame_ids: Vec<String>,
    pub model_suggestion: String,
    pub suggestion_digest: String,
    pub model_identity: String,
    pub provider_used: String,
    pub generated_at: String,
    pub status: String,
    pub expected_result_or_notes: Option<String>,
}

/// Brief §4 `EditEvent` operation enum: "rewrite/insert/delete/reorder/
/// split/merge/redaction-change/revert".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case")]
pub enum EditOperation {
    Rewrite { step_id: String, new_text: String },
    Insert { after_step_id: Option<String>, new_step_id: String, text: String },
    Delete { step_id: String },
    Reorder { new_order: Vec<String> },
    Split { step_id: String, into: Vec<(String, String)> },
    Merge { step_ids: Vec<String>, into_step_id: String, text: String },
    /// A redaction mask change invalidates the affected frame's caption —
    /// brief §4: "When the user changes redaction masks, the system
    /// invalidates the corresponding caption." This event records the
    /// fact; it carries no step text itself.
    RedactionChange { frame_id: String, candidate_id: String, disposition: Disposition },
    /// Resets a step's text back to its original, immutable model
    /// suggestion. Brief §4: "revert to AI suggestion remains possible."
    Revert { step_id: String },
}

/// Brief §4 `EditEvent`: "monotonically increasing sequence... session
/// revision-before/after... Atomic write is temp + fsync + rename; stale
/// revisions reject instead of overwriting concurrent edits." The atomic
/// write itself is the shell's job (`app/src/sop_workspace.rs`); this
/// struct is the append-only log entry shape plus [`check_expected_revision`]
/// for the optimistic-concurrency check that write sits behind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditEvent {
    pub sequence: u64,
    pub event_id: String,
    pub session_revision_before: u64,
    pub session_revision_after: u64,
    pub operation: EditOperation,
    pub before_digest: Option<String>,
    pub after_digest: Option<String>,
    pub local_timestamp: String,
}

/// Brief §4 `SopSessionV1`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SopSessionV1 {
    pub schema_version: u32,
    pub kind: String,
    pub session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: u64,
    pub policy_version: String,
    pub model_manifest_sha256: Option<String>,
    pub sidecar_protocol_version: u32,
    pub source_frames: Vec<SourceFrame>,
    pub captions: Vec<CaptionDraft>,
    pub edit_events: Vec<EditEvent>,
    pub review_state: ReviewState,
    pub review_receipt: Option<String>,
    pub export_eligible: bool,
}

/// Reasons [`validate_session`]/[`parse_session`] can refuse a session.
/// Every variant carries a stable, machine-readable shape (no bare
/// strings) so callers/tests assert the exact failure, same convention as
/// [`crate::annotations`]'s validation errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    UnsupportedSchemaVersion { found: u32, max_supported: u32 },
    WrongKind { found: String },
    TooManyFrames { found: usize, max: usize },
    DuplicateFrameId { frame_id: String },
    DuplicateStepId { step_id: String },
    TooManyOcrTokens { found: usize, max: usize },
    OcrJsonTooLarge { found_bytes: usize, max_bytes: usize },
    EmptySessionId,
    EmptyFrameId,
    EmptyStepId,
}

/// Parses and validates a session document from JSON bytes. Schema
/// version is checked *before* full deserialization is attempted (a
/// `schemaVersion` field alone is read first), mirroring
/// [`crate::annotations::parse_sidecar`] — a newer, unrecognized schema is
/// reported as unsupported rather than silently misparsed.
pub fn parse_session(json: &[u8]) -> Result<SopSessionV1, SessionError> {
    #[derive(Deserialize)]
    struct VersionProbe {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
    }
    let probe: VersionProbe = serde_json::from_slice(json).map_err(|_| SessionError::UnsupportedSchemaVersion {
        found: 0,
        max_supported: SOP_SESSION_SCHEMA_VERSION,
    })?;
    if probe.schema_version > SOP_SESSION_SCHEMA_VERSION {
        return Err(SessionError::UnsupportedSchemaVersion {
            found: probe.schema_version,
            max_supported: SOP_SESSION_SCHEMA_VERSION,
        });
    }
    let session: SopSessionV1 =
        serde_json::from_slice(json).map_err(|_| SessionError::UnsupportedSchemaVersion {
            found: probe.schema_version,
            max_supported: SOP_SESSION_SCHEMA_VERSION,
        })?;
    validate_session(&session)?;
    Ok(session)
}

/// Structural + limit validation on an already-deserialized session.
/// Separate from [`parse_session`] so in-memory sessions built by the
/// shell (not round-tripped through JSON) can still be validated before
/// being written.
pub fn validate_session(session: &SopSessionV1) -> Result<(), SessionError> {
    if session.schema_version > SOP_SESSION_SCHEMA_VERSION {
        return Err(SessionError::UnsupportedSchemaVersion {
            found: session.schema_version,
            max_supported: SOP_SESSION_SCHEMA_VERSION,
        });
    }
    if session.kind != SOP_SESSION_KIND {
        return Err(SessionError::WrongKind { found: session.kind.clone() });
    }
    if session.session_id.is_empty() {
        return Err(SessionError::EmptySessionId);
    }
    if session.source_frames.len() > MAX_FRAMES_PER_SESSION {
        return Err(SessionError::TooManyFrames {
            found: session.source_frames.len(),
            max: MAX_FRAMES_PER_SESSION,
        });
    }

    let mut seen_frame_ids = std::collections::HashSet::new();
    let mut total_ocr_tokens = 0usize;
    let mut total_ocr_json_bytes = 0usize;
    for frame in &session.source_frames {
        if frame.frame_id.is_empty() {
            return Err(SessionError::EmptyFrameId);
        }
        if !seen_frame_ids.insert(frame.frame_id.clone()) {
            return Err(SessionError::DuplicateFrameId { frame_id: frame.frame_id.clone() });
        }
        // OCR token accounting happens against a session-level pool in
        // the real pipeline (tokens live alongside the frame's OCR
        // result, not inline on SourceFrame in this slice's shape) — this
        // slice validates the CAP mechanics against synthetic counts a
        // caller supplies via `validate_ocr_budget`, kept separate so
        // this function stays independent of how/where OCR tokens are
        // actually stored once C2-P2 adds that.
        let _ = &mut total_ocr_tokens;
        let _ = &mut total_ocr_json_bytes;
    }

    let mut seen_step_ids = std::collections::HashSet::new();
    for caption in &session.captions {
        if caption.step_id.is_empty() {
            return Err(SessionError::EmptyStepId);
        }
        if !seen_step_ids.insert(caption.step_id.clone()) {
            return Err(SessionError::DuplicateStepId { step_id: caption.step_id.clone() });
        }
    }

    Ok(())
}

/// Brief §4 `OcrToken`: `<=50,000 tokens` and `<=10 MiB OCR JSON` per
/// session, checked independently of [`validate_session`] so a caller
/// building up a session incrementally (as OCR results arrive from the
/// sidecar) can check the budget at the point of adding tokens, not only
/// at a final whole-document parse.
pub fn validate_ocr_budget(token_count: usize, ocr_json_bytes: usize) -> Result<(), SessionError> {
    if token_count > MAX_OCR_TOKENS_PER_SESSION {
        return Err(SessionError::TooManyOcrTokens {
            found: token_count,
            max: MAX_OCR_TOKENS_PER_SESSION,
        });
    }
    if ocr_json_bytes > MAX_OCR_JSON_BYTES_PER_SESSION {
        return Err(SessionError::OcrJsonTooLarge {
            found_bytes: ocr_json_bytes,
            max_bytes: MAX_OCR_JSON_BYTES_PER_SESSION,
        });
    }
    Ok(())
}

/// Source-binding result — exact mirror of
/// [`crate::annotations::SourceBinding`]'s shape and meaning: a
/// freshly-computed digest that doesn't match what a frame/derivative
/// claims is stale, and a caller must never apply/present it silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceBinding {
    Fresh,
    Stale,
}

/// Compares a freshly-computed SHA-256 (computed by the caller from the
/// *same* byte slice it is about to use) against a frame's recorded
/// `raster_sha256`.
pub fn check_source_binding(frame: &SourceFrame, actual_source_sha256_hex: &str) -> SourceBinding {
    if frame.raster_sha256.eq_ignore_ascii_case(actual_source_sha256_hex) {
        SourceBinding::Fresh
    } else {
        SourceBinding::Stale
    }
}

/// Optimistic-concurrency check for a write: the writer must have read
/// `expected_revision` from the version it is about to overwrite. Mirrors
/// the brief's "stale revisions reject instead of overwriting concurrent
/// edits" — this is the pure comparison; the atomic temp+fsync+rename
/// sits in `app/src/sop_workspace.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaleRevisionError {
    pub expected: u64,
    pub current: u64,
}

pub fn check_expected_revision(current_revision: u64, expected_revision: u64) -> Result<(), StaleRevisionError> {
    if current_revision != expected_revision {
        return Err(StaleRevisionError { expected: expected_revision, current: current_revision });
    }
    Ok(())
}

/// Brief §4: "deletion of the session never deletes" an
/// [`SourceStorage::ExternalUserOwned`] frame. This is the single
/// authoritative check — nothing in the shell should implement its own
/// parallel "is this frame safe to delete" logic.
pub fn session_discard_deletes_frame(frame: &SourceFrame) -> bool {
    matches!(frame.original_storage, SourceStorage::SessionEncrypted)
}

/// Replays a session's [`EditEvent`] log, in `sequence` order, over the
/// initial step list derived from `captions` (each caption's
/// `model_suggestion`, in `captions` array order), and returns the
/// current ordered `(step_id, text)` pairs. This is the *only* way
/// current step text is ever computed — brief §4: "revert to AI
/// suggestion remains possible" because nothing ever overwrites
/// `model_suggestion` itself; only this projection changes what's
/// displayed.
///
/// Events are applied in `sequence` order regardless of the order they
/// appear in `edit_events` (the log is append-only but a caller must not
/// be required to keep it pre-sorted). An operation referencing an
/// unknown `step_id` is a no-op here — rejecting malformed event streams
/// at write time is `app/src/sop_workspace.rs`'s job (atomic write +
/// expected-revision check); replay itself stays total and crash-safe to
/// read even over a log a stricter writer would have refused.
pub fn project_steps(captions: &[CaptionDraft], edit_events: &[EditEvent]) -> Vec<(String, String)> {
    let mut order: Vec<String> = captions.iter().map(|c| c.step_id.clone()).collect();
    let mut text: std::collections::HashMap<String, String> = captions
        .iter()
        .map(|c| (c.step_id.clone(), c.model_suggestion.clone()))
        .collect();
    let original: std::collections::HashMap<String, String> = text.clone();

    let mut sorted_events: Vec<&EditEvent> = edit_events.iter().collect();
    sorted_events.sort_by_key(|e| e.sequence);

    for event in sorted_events {
        match &event.operation {
            EditOperation::Rewrite { step_id, new_text } => {
                if text.contains_key(step_id) {
                    text.insert(step_id.clone(), new_text.clone());
                }
            }
            EditOperation::Insert { after_step_id, new_step_id, text: new_text } => {
                if !order.contains(new_step_id) {
                    let insert_at = match after_step_id {
                        Some(after) => order.iter().position(|s| s == after).map(|i| i + 1).unwrap_or(order.len()),
                        None => 0,
                    };
                    order.insert(insert_at.min(order.len()), new_step_id.clone());
                    text.insert(new_step_id.clone(), new_text.clone());
                }
            }
            EditOperation::Delete { step_id } => {
                order.retain(|s| s != step_id);
                text.remove(step_id);
            }
            EditOperation::Reorder { new_order } => {
                // Only accept a reorder that's a permutation of the
                // CURRENT step set — a reorder naming unknown/missing
                // steps is ignored rather than silently dropping steps
                // from the visible sequence.
                let current: std::collections::HashSet<&String> = order.iter().collect();
                let proposed: std::collections::HashSet<&String> = new_order.iter().collect();
                if current.len() == proposed.len() && current == proposed {
                    order = new_order.clone();
                }
            }
            EditOperation::Split { step_id, into } => {
                if let Some(pos) = order.iter().position(|s| s == step_id) {
                    let replacement_ids: Vec<String> = into.iter().map(|(id, _)| id.clone()).collect();
                    order.splice(pos..=pos, replacement_ids.clone());
                    text.remove(step_id);
                    for (id, step_text) in into {
                        text.insert(id.clone(), step_text.clone());
                    }
                }
            }
            EditOperation::Merge { step_ids, into_step_id, text: merged_text } => {
                if let Some(first_pos) = step_ids.first().and_then(|first| order.iter().position(|s| s == first)) {
                    order.retain(|s| !step_ids.contains(s));
                    let insert_at = first_pos.min(order.len());
                    order.insert(insert_at, into_step_id.clone());
                    for id in step_ids {
                        text.remove(id);
                    }
                    text.insert(into_step_id.clone(), merged_text.clone());
                }
            }
            EditOperation::RedactionChange { .. } => {
                // Carries no step text; caption invalidation on a
                // redaction-mask change is a session-level status flag,
                // not a projection concern — out of this function's
                // scope by design (see the module doc comment).
            }
            EditOperation::Revert { step_id } => {
                if let Some(original_text) = original.get(step_id) {
                    text.insert(step_id.clone(), original_text.clone());
                }
            }
        }
    }

    order
        .into_iter()
        .filter_map(|id| text.get(&id).cloned().map(|t| (id, t)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: &str, storage: SourceStorage) -> SourceFrame {
        SourceFrame {
            frame_id: id.to_string(),
            order: 0,
            source_relative_path: format!("frames/{id}.png"),
            raster_sha256: "a".repeat(64),
            provenance_sidecar_relative_path: None,
            provenance_sidecar_blob_sha256: None,
            width: 100,
            height: 100,
            captured_at: "2026-10-26T12:00:00Z".to_string(),
            action_kind: "click".to_string(),
            click_box: None,
            process_basename: None,
            window_title: None,
            original_storage: storage,
            ocr_status: None,
            redacted_derivative_relative_path: None,
            redacted_derivative_sha256: None,
            redaction_candidates: vec![],
            verification: FrameVerification::Pending,
        }
    }

    fn base_session() -> SopSessionV1 {
        SopSessionV1 {
            schema_version: SOP_SESSION_SCHEMA_VERSION,
            kind: SOP_SESSION_KIND.to_string(),
            session_id: "sess-1".to_string(),
            created_at: "2026-10-26T12:00:00Z".to_string(),
            updated_at: "2026-10-26T12:00:00Z".to_string(),
            revision: 0,
            policy_version: "1".to_string(),
            model_manifest_sha256: None,
            sidecar_protocol_version: 1,
            source_frames: vec![],
            captions: vec![],
            edit_events: vec![],
            review_state: ReviewState::NotStarted,
            review_receipt: None,
            export_eligible: false,
        }
    }

    fn caption(step_id: &str, text: &str) -> CaptionDraft {
        CaptionDraft {
            step_id: step_id.to_string(),
            source_frame_ids: vec![],
            model_suggestion: text.to_string(),
            suggestion_digest: sha256_hex(text.as_bytes()),
            model_identity: "florence-2-base-ft".to_string(),
            provider_used: "directml".to_string(),
            generated_at: "2026-10-26T12:00:00Z".to_string(),
            status: "draft".to_string(),
            expected_result_or_notes: None,
        }
    }

    // --- schema / version / limits ---

    #[test]
    fn rejects_a_newer_schema_version_without_misparsing_it() {
        let mut s = base_session();
        s.schema_version = SOP_SESSION_SCHEMA_VERSION + 1;
        let err = validate_session(&s).unwrap_err();
        assert_eq!(
            err,
            SessionError::UnsupportedSchemaVersion { found: SOP_SESSION_SCHEMA_VERSION + 1, max_supported: SOP_SESSION_SCHEMA_VERSION }
        );
    }

    #[test]
    fn parse_session_checks_version_before_full_deserialization() {
        let json = br#"{"schemaVersion": 99, "kind": "wrong"}"#;
        let err = parse_session(json).unwrap_err();
        assert_eq!(err, SessionError::UnsupportedSchemaVersion { found: 99, max_supported: SOP_SESSION_SCHEMA_VERSION });
    }

    #[test]
    fn rejects_the_wrong_kind_discriminator() {
        let mut s = base_session();
        s.kind = "not-a-sop-session".to_string();
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::WrongKind { found: "not-a-sop-session".to_string() });
    }

    #[test]
    fn rejects_an_empty_session_id() {
        let mut s = base_session();
        s.session_id = String::new();
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::EmptySessionId);
    }

    #[test]
    fn rejects_more_than_the_max_frames_per_session() {
        let mut s = base_session();
        for i in 0..(MAX_FRAMES_PER_SESSION + 1) {
            s.source_frames.push(frame(&format!("f{i}"), SourceStorage::SessionEncrypted));
        }
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::TooManyFrames { found: MAX_FRAMES_PER_SESSION + 1, max: MAX_FRAMES_PER_SESSION }
        );
    }

    #[test]
    fn accepts_exactly_the_max_frame_count() {
        let mut s = base_session();
        for i in 0..MAX_FRAMES_PER_SESSION {
            s.source_frames.push(frame(&format!("f{i}"), SourceStorage::SessionEncrypted));
        }
        assert!(validate_session(&s).is_ok());
    }

    #[test]
    fn rejects_duplicate_frame_ids() {
        let mut s = base_session();
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::DuplicateFrameId { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_duplicate_step_ids() {
        let mut s = base_session();
        s.captions.push(caption("s1", "a"));
        s.captions.push(caption("s1", "b"));
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::DuplicateStepId { step_id: "s1".to_string() });
    }

    #[test]
    fn rejects_an_empty_frame_id() {
        let mut s = base_session();
        s.source_frames.push(frame("", SourceStorage::SessionEncrypted));
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::EmptyFrameId);
    }

    #[test]
    fn ocr_budget_rejects_too_many_tokens() {
        assert_eq!(
            validate_ocr_budget(MAX_OCR_TOKENS_PER_SESSION + 1, 0).unwrap_err(),
            SessionError::TooManyOcrTokens { found: MAX_OCR_TOKENS_PER_SESSION + 1, max: MAX_OCR_TOKENS_PER_SESSION }
        );
    }

    #[test]
    fn ocr_budget_accepts_exactly_the_max() {
        assert!(validate_ocr_budget(MAX_OCR_TOKENS_PER_SESSION, MAX_OCR_JSON_BYTES_PER_SESSION).is_ok());
    }

    #[test]
    fn ocr_budget_rejects_oversized_json() {
        assert_eq!(
            validate_ocr_budget(0, MAX_OCR_JSON_BYTES_PER_SESSION + 1).unwrap_err(),
            SessionError::OcrJsonTooLarge { found_bytes: MAX_OCR_JSON_BYTES_PER_SESSION + 1, max_bytes: MAX_OCR_JSON_BYTES_PER_SESSION }
        );
    }

    // --- source binding (stale source) ---

    #[test]
    fn source_binding_is_fresh_when_the_digest_matches() {
        let f = frame("f1", SourceStorage::SessionEncrypted);
        let actual = f.raster_sha256.clone();
        assert_eq!(check_source_binding(&f, &actual), SourceBinding::Fresh);
    }

    #[test]
    fn source_binding_is_stale_when_the_digest_does_not_match() {
        let f = frame("f1", SourceStorage::SessionEncrypted);
        assert_eq!(check_source_binding(&f, &"b".repeat(64)), SourceBinding::Stale);
    }

    #[test]
    fn source_binding_is_case_insensitive_on_hex() {
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.raster_sha256 = "ABCD".to_string() + &"0".repeat(60);
        assert_eq!(check_source_binding(&f, &("abcd".to_string() + &"0".repeat(60))), SourceBinding::Fresh);
    }

    // --- stale revision ---

    #[test]
    fn expected_revision_matching_current_succeeds() {
        assert!(check_expected_revision(5, 5).is_ok());
    }

    #[test]
    fn expected_revision_behind_current_is_rejected() {
        assert_eq!(check_expected_revision(5, 3).unwrap_err(), StaleRevisionError { expected: 3, current: 5 });
    }

    #[test]
    fn expected_revision_ahead_of_current_is_also_rejected() {
        // A caller claiming to have read a revision that doesn't exist
        // yet is just as wrong as a stale read - never treated as "close
        // enough."
        assert_eq!(check_expected_revision(2, 9).unwrap_err(), StaleRevisionError { expected: 9, current: 2 });
    }

    // --- external-source retention truth ---

    #[test]
    fn session_discard_may_delete_a_session_encrypted_frame() {
        assert!(session_discard_deletes_frame(&frame("f1", SourceStorage::SessionEncrypted)));
    }

    #[test]
    fn session_discard_never_deletes_an_external_user_owned_frame() {
        assert!(!session_discard_deletes_frame(&frame("f1", SourceStorage::ExternalUserOwned)));
    }

    // --- edit replay: rewrite / insert / delete / reorder / split / merge / revert ---

    fn event(seq: u64, op: EditOperation) -> EditEvent {
        EditEvent {
            sequence: seq,
            event_id: format!("ev-{seq}"),
            session_revision_before: seq,
            session_revision_after: seq + 1,
            operation: op,
            before_digest: None,
            after_digest: None,
            local_timestamp: "2026-10-26T12:00:00Z".to_string(),
        }
    }

    #[test]
    fn project_steps_with_no_events_returns_the_original_model_suggestions_in_order() {
        let captions = vec![caption("s1", "Click Save"), caption("s2", "Click Close")];
        let projected = project_steps(&captions, &[]);
        assert_eq!(projected, vec![("s1".to_string(), "Click Save".to_string()), ("s2".to_string(), "Click Close".to_string())]);
    }

    #[test]
    fn rewrite_changes_only_the_targeted_step() {
        let captions = vec![caption("s1", "Click Save"), caption("s2", "Click Close")];
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Click the Save button".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected[0].1, "Click the Save button");
        assert_eq!(projected[1].1, "Click Close");
    }

    #[test]
    fn insert_adds_a_new_step_after_the_named_one() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Insert { after_step_id: Some("s1".to_string()), new_step_id: "s1b".to_string(), text: "Inserted".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(), vec!["s1", "s1b", "s2"]);
    }

    #[test]
    fn insert_with_no_after_step_prepends() {
        let captions = vec![caption("s1", "A")];
        let events = vec![event(0, EditOperation::Insert { after_step_id: None, new_step_id: "s0".to_string(), text: "First".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected[0].0, "s0");
    }

    #[test]
    fn delete_removes_the_step_from_both_order_and_text() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Delete { step_id: "s1".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0].0, "s2");
    }

    #[test]
    fn reorder_accepts_a_valid_permutation() {
        let captions = vec![caption("s1", "A"), caption("s2", "B"), caption("s3", "C")];
        let events = vec![event(0, EditOperation::Reorder { new_order: vec!["s3".to_string(), "s1".to_string(), "s2".to_string()] })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(), vec!["s3", "s1", "s2"]);
    }

    #[test]
    fn reorder_naming_an_unknown_step_is_ignored_rather_than_dropping_steps() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Reorder { new_order: vec!["s1".to_string(), "ghost".to_string()] })];
        let projected = project_steps(&captions, &events);
        // Invalid reorder ignored: original order/step set preserved, no
        // step silently vanished.
        assert_eq!(projected.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(), vec!["s1", "s2"]);
    }

    #[test]
    fn split_replaces_one_step_with_several_in_place() {
        let captions = vec![caption("s1", "Click and drag"), caption("s2", "Next")];
        let events = vec![event(
            0,
            EditOperation::Split {
                step_id: "s1".to_string(),
                into: vec![("s1a".to_string(), "Click".to_string()), ("s1b".to_string(), "Drag".to_string())],
            },
        )];
        let projected = project_steps(&captions, &events);
        assert_eq!(
            projected,
            vec![
                ("s1a".to_string(), "Click".to_string()),
                ("s1b".to_string(), "Drag".to_string()),
                ("s2".to_string(), "Next".to_string())
            ]
        );
    }

    #[test]
    fn merge_combines_several_steps_into_one_at_the_first_steps_position() {
        let captions = vec![caption("s1", "Click"), caption("s2", "Drag"), caption("s3", "Release")];
        let events = vec![event(
            0,
            EditOperation::Merge { step_ids: vec!["s1".to_string(), "s2".to_string()], into_step_id: "s1-2".to_string(), text: "Click and drag".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected, vec![("s1-2".to_string(), "Click and drag".to_string()), ("s3".to_string(), "Release".to_string())]);
    }

    #[test]
    fn revert_restores_the_original_immutable_model_suggestion_after_a_rewrite() {
        let captions = vec![caption("s1", "Click Save")];
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Totally different text".to_string() }),
            event(1, EditOperation::Revert { step_id: "s1".to_string() }),
        ];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected[0].1, "Click Save");
    }

    #[test]
    fn events_are_applied_in_sequence_order_regardless_of_array_order() {
        let captions = vec![caption("s1", "Original")];
        // Deliberately out of array order: sequence 1 appears before sequence 0.
        let events = vec![
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Second edit".to_string() }),
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "First edit".to_string() }),
        ];
        let projected = project_steps(&captions, &events);
        // If sequence order were ignored, "First edit" would win (array
        // order) - sequence order must win instead.
        assert_eq!(projected[0].1, "Second edit");
    }

    #[test]
    fn a_rewrite_targeting_an_unknown_step_is_a_no_op_not_a_crash() {
        let captions = vec![caption("s1", "A")];
        let events = vec![event(0, EditOperation::Rewrite { step_id: "ghost".to_string(), new_text: "x".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected, vec![("s1".to_string(), "A".to_string())]);
    }

    #[test]
    fn redaction_change_event_carries_no_step_text_and_leaves_projection_unaffected() {
        let captions = vec![caption("s1", "A")];
        let events = vec![event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact })];
        assert_eq!(project_steps(&captions, &events), vec![("s1".to_string(), "A".to_string())]);
    }

    #[test]
    fn sha256_hex_is_deterministic_and_lowercase() {
        let h = sha256_hex(b"hello");
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(h, sha256_hex(b"hello"));
    }

    #[test]
    fn sha256_hex_changes_with_the_input() {
        assert_ne!(sha256_hex(b"a"), sha256_hex(b"b"));
    }
}
