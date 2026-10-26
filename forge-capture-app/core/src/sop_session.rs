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
///
/// C2P1-002/003 fix round: this enum grew substantially because the prior
/// version only checked a small structural subset (schema/kind/id, frame
/// count, ID uniqueness) and left the actually safety-relevant invariants
/// — review/export state being *derived* rather than trusted, every
/// persisted path being confined, and the edit-event log being a real,
/// chain-validated history — entirely unchecked. A deserialized document
/// could claim `reviewState=VERIFIED`/`exportEligible=true` while still
/// having unresolved redactions or pending frames, or carry a path like
/// `../outside`. Every new variant below closes one specific gap named in
/// `results/chatgpt/capture-c2-p1-review-2026-10-26.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    UnsupportedSchemaVersion { found: u32, min_supported: u32, max_supported: u32 },
    WrongKind { found: String },
    TooManyFrames { found: usize, max: usize },
    DuplicateFrameId { frame_id: String },
    DuplicateStepId { step_id: String },
    TooManyOcrTokens { found: usize, max: usize },
    OcrJsonTooLarge { found_bytes: usize, max_bytes: usize },
    EmptySessionId,
    EmptyFrameId,
    EmptyStepId,
    /// A persisted relative path (source/provenance-sidecar/redacted-
    /// derivative) is not confined to the session root — the exact same
    /// grammar [`crate::sop_ipc::confine_relative_path`] enforces at the
    /// IPC boundary, applied here too so a session file itself can never
    /// carry an escaping path regardless of how it was produced.
    InvalidRelativePath { frame_id: String, field: &'static str },
    /// A digest field isn't a well-formed 64-char lowercase/uppercase hex
    /// SHA-256 string.
    InvalidDigestFormat { frame_id: String, field: &'static str },
    InvalidFrameDimensions { frame_id: String },
    InvalidClickBox { frame_id: String },
    /// A `CaptionDraft.source_frame_ids` entry names a frame id that
    /// doesn't exist in `source_frames`.
    CaptionReferencesUnknownFrame { step_id: String, frame_id: String },
    EmptyRedactionCandidateId { frame_id: String },
    DuplicateRedactionCandidateId { frame_id: String, candidate_id: String },
    InvalidRedactionCandidateBox { frame_id: String, candidate_id: String },
    InvalidRedactionCandidateScore { frame_id: String, candidate_id: String },
    /// The session claims a review/export state its actual frame
    /// verification + redaction disposition data doesn't support — the
    /// core fix for "a session can self-assert VERIFIED/exportable."
    ReviewStateNotSatisfied { reason: &'static str },
    ExportEligibleNotSatisfied { reason: &'static str },
    DuplicateEditEventId { event_id: String },
    DuplicateEditEventSequence { sequence: u64 },
    /// The event chain isn't contiguous starting at the first event's own
    /// `sequence` (a gap, or not sorted into a contiguous run at all).
    EditEventSequenceGap { expected: u64, found: u64 },
    /// `session_revision_before` doesn't equal the running revision the
    /// chain had reached, or `session_revision_after` isn't exactly
    /// `session_revision_before + 1`.
    EditEventRevisionMismatch { event_id: String },
}

/// Parses and validates a session document from JSON bytes. Schema
/// version is checked *before* full deserialization is attempted (a
/// `schemaVersion` field alone is read first), mirroring
/// [`crate::annotations::parse_sidecar`] — a newer, unrecognized schema is
/// reported as unsupported rather than silently misparsed. `0` is refused
/// the same as anything above the max — it is never a real version
/// (C2P1-001/002 fix round: the original check only rejected ABOVE the
/// max, leaving a lower-bound hole).
pub fn parse_session(json: &[u8]) -> Result<SopSessionV1, SessionError> {
    #[derive(Deserialize)]
    struct VersionProbe {
        #[serde(rename = "schemaVersion")]
        schema_version: u32,
    }
    let unsupported_probe_err = SessionError::UnsupportedSchemaVersion {
        found: 0,
        min_supported: 1,
        max_supported: SOP_SESSION_SCHEMA_VERSION,
    };
    let probe: VersionProbe = serde_json::from_slice(json).map_err(|_| unsupported_probe_err.clone())?;
    if probe.schema_version == 0 || probe.schema_version > SOP_SESSION_SCHEMA_VERSION {
        return Err(SessionError::UnsupportedSchemaVersion {
            found: probe.schema_version,
            min_supported: 1,
            max_supported: SOP_SESSION_SCHEMA_VERSION,
        });
    }
    let session: SopSessionV1 = serde_json::from_slice(json).map_err(|_| SessionError::UnsupportedSchemaVersion {
        found: probe.schema_version,
        min_supported: 1,
        max_supported: SOP_SESSION_SCHEMA_VERSION,
    })?;
    validate_session(&session)?;
    Ok(session)
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn all_frames_verified(session: &SopSessionV1) -> bool {
    !session.source_frames.is_empty()
        && session.source_frames.iter().all(|f| f.verification == FrameVerification::Verified)
}

fn all_redactions_resolved(session: &SopSessionV1) -> bool {
    session
        .source_frames
        .iter()
        .all(|f| f.redaction_candidates.iter().all(|c| c.disposition != Disposition::Pending))
}

/// Structural + limit + cross-reference validation on an already-
/// deserialized session. Separate from [`parse_session`] so in-memory
/// sessions built by the shell (not round-tripped through JSON) can still
/// be validated before being written.
///
/// This is the single place `reviewState`/`exportEligible` are checked
/// against the data that's supposed to justify them — nothing downstream
/// should re-derive or re-trust those two fields independently. A session
/// claiming `VERIFIED` while any frame isn't
/// [`FrameVerification::Verified`], any redaction candidate is still
/// [`Disposition::Pending`], or no `review_receipt` is present is
/// refused outright; a session claiming `export_eligible` without
/// `review_state == Verified` is refused the same way.
pub fn validate_session(session: &SopSessionV1) -> Result<(), SessionError> {
    if session.schema_version == 0 || session.schema_version > SOP_SESSION_SCHEMA_VERSION {
        return Err(SessionError::UnsupportedSchemaVersion {
            found: session.schema_version,
            min_supported: 1,
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
    for frame in &session.source_frames {
        if frame.frame_id.is_empty() {
            return Err(SessionError::EmptyFrameId);
        }
        if !seen_frame_ids.insert(frame.frame_id.clone()) {
            return Err(SessionError::DuplicateFrameId { frame_id: frame.frame_id.clone() });
        }

        crate::sop_ipc::confine_relative_path(&frame.source_relative_path)
            .map_err(|_| SessionError::InvalidRelativePath { frame_id: frame.frame_id.clone(), field: "source_relative_path" })?;
        if let Some(p) = &frame.provenance_sidecar_relative_path {
            crate::sop_ipc::confine_relative_path(p)
                .map_err(|_| SessionError::InvalidRelativePath { frame_id: frame.frame_id.clone(), field: "provenance_sidecar_relative_path" })?;
        }
        if let Some(p) = &frame.redacted_derivative_relative_path {
            crate::sop_ipc::confine_relative_path(p)
                .map_err(|_| SessionError::InvalidRelativePath { frame_id: frame.frame_id.clone(), field: "redacted_derivative_relative_path" })?;
        }

        if !is_sha256_hex(&frame.raster_sha256) {
            return Err(SessionError::InvalidDigestFormat { frame_id: frame.frame_id.clone(), field: "raster_sha256" });
        }
        if let Some(d) = &frame.provenance_sidecar_blob_sha256 {
            if !is_sha256_hex(d) {
                return Err(SessionError::InvalidDigestFormat { frame_id: frame.frame_id.clone(), field: "provenance_sidecar_blob_sha256" });
            }
        }
        if let Some(d) = &frame.redacted_derivative_sha256 {
            if !is_sha256_hex(d) {
                return Err(SessionError::InvalidDigestFormat { frame_id: frame.frame_id.clone(), field: "redacted_derivative_sha256" });
            }
        }

        if frame.width == 0 || frame.height == 0 {
            return Err(SessionError::InvalidFrameDimensions { frame_id: frame.frame_id.clone() });
        }
        if let Some((x, y, w, h)) = frame.click_box {
            let in_bounds = x >= 0
                && y >= 0
                && w > 0
                && h > 0
                && (x as i128 + w as i128) <= frame.width as i128
                && (y as i128 + h as i128) <= frame.height as i128;
            if !in_bounds {
                return Err(SessionError::InvalidClickBox { frame_id: frame.frame_id.clone() });
            }
        }

        let mut seen_candidate_ids = std::collections::HashSet::new();
        for candidate in &frame.redaction_candidates {
            if candidate.candidate_id.is_empty() {
                return Err(SessionError::EmptyRedactionCandidateId { frame_id: frame.frame_id.clone() });
            }
            if !seen_candidate_ids.insert(candidate.candidate_id.clone()) {
                return Err(SessionError::DuplicateRedactionCandidateId {
                    frame_id: frame.frame_id.clone(),
                    candidate_id: candidate.candidate_id.clone(),
                });
            }
            let (_, _, ow, oh) = candidate.original_box;
            let (_, _, ew, eh) = candidate.expanded_box;
            if ow == 0 || oh == 0 || ew == 0 || eh == 0 {
                return Err(SessionError::InvalidRedactionCandidateBox {
                    frame_id: frame.frame_id.clone(),
                    candidate_id: candidate.candidate_id.clone(),
                });
            }
            if let Some(score) = candidate.score {
                if !(0.0..=1.0).contains(&score) || !score.is_finite() {
                    return Err(SessionError::InvalidRedactionCandidateScore {
                        frame_id: frame.frame_id.clone(),
                        candidate_id: candidate.candidate_id.clone(),
                    });
                }
            }
        }
    }

    let mut seen_step_ids = std::collections::HashSet::new();
    for caption in &session.captions {
        if caption.step_id.is_empty() {
            return Err(SessionError::EmptyStepId);
        }
        if !seen_step_ids.insert(caption.step_id.clone()) {
            return Err(SessionError::DuplicateStepId { step_id: caption.step_id.clone() });
        }
        for frame_id in &caption.source_frame_ids {
            if !seen_frame_ids.contains(frame_id) {
                return Err(SessionError::CaptionReferencesUnknownFrame {
                    step_id: caption.step_id.clone(),
                    frame_id: frame_id.clone(),
                });
            }
        }
    }

    validate_edit_event_chain(&session.edit_events)?;

    // The review/export derivation gate: checked last, after every
    // underlying fact it depends on (frame verification, redaction
    // disposition) is already known to be structurally valid.
    if session.review_state == ReviewState::Verified {
        if !all_frames_verified(session) {
            return Err(SessionError::ReviewStateNotSatisfied { reason: "not every source frame is FrameVerification::Verified" });
        }
        if !all_redactions_resolved(session) {
            return Err(SessionError::ReviewStateNotSatisfied { reason: "a redaction candidate is still Disposition::Pending" });
        }
        if session.review_receipt.is_none() {
            return Err(SessionError::ReviewStateNotSatisfied { reason: "VERIFIED requires a review_receipt" });
        }
    }
    if session.export_eligible && session.review_state != ReviewState::Verified {
        return Err(SessionError::ExportEligibleNotSatisfied { reason: "export_eligible requires review_state == Verified" });
    }

    Ok(())
}

/// Structural validation of the append-only edit-event log (C2P1-003):
/// every `sequence` is unique and forms a contiguous run (no gaps) from
/// the first event's own starting sequence; every `event_id` is unique;
/// and each event's `session_revision_before`/`session_revision_after`
/// chains exactly — `before` must equal the running revision the prior
/// event left behind (or the first event's own claimed starting
/// revision), and `after` must be exactly `before + 1`. Events are
/// checked in `sequence` order regardless of the log's on-disk array
/// order, matching [`project_steps`]'s own replay order.
pub fn validate_edit_event_chain(events: &[EditEvent]) -> Result<(), SessionError> {
    let mut sorted: Vec<&EditEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.sequence);

    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_sequences = std::collections::HashSet::new();
    let mut expected_sequence: Option<u64> = None;
    let mut expected_revision: Option<u64> = None;

    for event in &sorted {
        if !seen_ids.insert(event.event_id.clone()) {
            return Err(SessionError::DuplicateEditEventId { event_id: event.event_id.clone() });
        }
        if !seen_sequences.insert(event.sequence) {
            return Err(SessionError::DuplicateEditEventSequence { sequence: event.sequence });
        }
        if let Some(expected) = expected_sequence {
            if event.sequence != expected {
                return Err(SessionError::EditEventSequenceGap { expected, found: event.sequence });
            }
        } else {
            expected_revision = Some(event.session_revision_before);
        }
        if Some(event.session_revision_before) != expected_revision {
            return Err(SessionError::EditEventRevisionMismatch { event_id: event.event_id.clone() });
        }
        if event.session_revision_after != event.session_revision_before + 1 {
            return Err(SessionError::EditEventRevisionMismatch { event_id: event.event_id.clone() });
        }
        expected_sequence = Some(event.sequence + 1);
        expected_revision = Some(event.session_revision_after);
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
                if order.contains(new_step_id) {
                    // Colliding with an existing id is a no-op, same
                    // reasoning as every other invalid-target case here.
                } else {
                    // C2P1-003: an unknown `after_step_id` must be a
                    // no-op (the documented contract for every other
                    // operation's unknown-target case), not silently
                    // fall back to appending at the end.
                    let insert_at = match after_step_id {
                        Some(after) => order.iter().position(|s| s == after).map(|i| i + 1),
                        None => Some(0),
                    };
                    if let Some(insert_at) = insert_at {
                        order.insert(insert_at.min(order.len()), new_step_id.clone());
                        text.insert(new_step_id.clone(), new_text.clone());
                    }
                }
            }
            EditOperation::Delete { step_id } => {
                order.retain(|s| s != step_id);
                text.remove(step_id);
            }
            EditOperation::Reorder { new_order } => {
                // Must be an exact PERMUTATION of the current step list:
                // same length as the actual Vec (not just the same SET —
                // a HashSet silently dedupes, so `[s1, s1, s2]` has the
                // same set as `{s1, s2}` but is not a valid permutation
                // and would otherwise plant a literal duplicate into
                // `order`), every id distinct, and the same set of ids as
                // current. A reorder naming unknown/missing/duplicated
                // steps is ignored rather than corrupting the list.
                let no_duplicates_in_new_order = {
                    let as_set: std::collections::HashSet<&String> = new_order.iter().collect();
                    as_set.len() == new_order.len()
                };
                let current: std::collections::HashSet<&String> = order.iter().collect();
                let proposed: std::collections::HashSet<&String> = new_order.iter().collect();
                if new_order.len() == order.len() && no_duplicates_in_new_order && current == proposed {
                    order = new_order.clone();
                }
            }
            EditOperation::Split { step_id, into } => {
                if let Some(pos) = order.iter().position(|s| s == step_id) {
                    let replacement_ids: Vec<String> = into.iter().map(|(id, _)| id.clone()).collect();
                    // Every replacement id must be distinct from every
                    // OTHER existing step (the one being split is exempt
                    // — it's being replaced) and from each other, or the
                    // split is refused outright rather than silently
                    // overwriting/colliding with unrelated steps.
                    let replacement_ids_distinct = {
                        let as_set: std::collections::HashSet<&String> = replacement_ids.iter().collect();
                        as_set.len() == replacement_ids.len()
                    };
                    let collides_with_other_existing_step = replacement_ids
                        .iter()
                        .any(|id| id != step_id && order.iter().any(|existing| existing == id));
                    if replacement_ids_distinct && !collides_with_other_existing_step {
                        order.splice(pos..=pos, replacement_ids.clone());
                        text.remove(step_id);
                        for (id, step_text) in into {
                            text.insert(id.clone(), step_text.clone());
                        }
                    }
                }
            }
            EditOperation::Merge { step_ids, into_step_id, text: merged_text } => {
                // Every named step must exist, be mutually distinct, and
                // occupy a CONSECUTIVE run in the current order — merging
                // non-adjacent or repeated/missing steps is refused
                // rather than silently merging whatever subset happened
                // to resolve. The destination id must not collide with a
                // step that survives the merge.
                let all_distinct = {
                    let as_set: std::collections::HashSet<&String> = step_ids.iter().collect();
                    as_set.len() == step_ids.len()
                };
                let positions: Option<Vec<usize>> =
                    step_ids.iter().map(|id| order.iter().position(|s| s == id)).collect();
                let consecutive = positions.as_ref().is_some_and(|ps| {
                    if ps.is_empty() {
                        return false;
                    }
                    let mut sorted = ps.clone();
                    sorted.sort_unstable();
                    sorted.iter().enumerate().all(|(i, &p)| p == sorted[0] + i)
                });
                let destination_collides =
                    order.iter().any(|existing| existing == into_step_id && !step_ids.contains(existing));
                if !step_ids.is_empty() && all_distinct && positions.is_some() && consecutive && !destination_collides {
                    let first_pos = *positions.unwrap().iter().min().unwrap();
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

/// C2P1-003 repair: "a redaction change does not invalidate captions/
/// review eligibility, while no other enforced state transition supplies
/// that protection." Returns every caption `step_id` whose text should be
/// treated as stale because a [`EditOperation::RedactionChange`] event
/// exists for one of that step's `source_frame_ids` — a caller (the shell
/// or the review-state check) uses this to force re-review/re-caption
/// rather than keep showing a caption that was generated against a
/// redaction state that has since changed. This does not mutate
/// `review_state`/`export_eligible` itself — [`validate_session`]'s own
/// `all_redactions_resolved`/`all_frames_verified` checks are what
/// actually block a stale session from claiming `VERIFIED`; this function
/// is the UI/caption-facing half of the same guarantee.
pub fn invalidated_step_ids(captions: &[CaptionDraft], edit_events: &[EditEvent]) -> std::collections::HashSet<String> {
    let redacted_frame_ids: std::collections::HashSet<&String> = edit_events
        .iter()
        .filter_map(|e| match &e.operation {
            EditOperation::RedactionChange { frame_id, .. } => Some(frame_id),
            _ => None,
        })
        .collect();
    if redacted_frame_ids.is_empty() {
        return std::collections::HashSet::new();
    }
    captions
        .iter()
        .filter(|c| c.source_frame_ids.iter().any(|f| redacted_frame_ids.contains(f)))
        .map(|c| c.step_id.clone())
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
            SessionError::UnsupportedSchemaVersion {
                found: SOP_SESSION_SCHEMA_VERSION + 1,
                min_supported: 1,
                max_supported: SOP_SESSION_SCHEMA_VERSION
            }
        );
    }

    #[test]
    fn rejects_schema_version_zero() {
        let mut s = base_session();
        s.schema_version = 0;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::UnsupportedSchemaVersion { found: 0, min_supported: 1, max_supported: SOP_SESSION_SCHEMA_VERSION }
        );
    }

    #[test]
    fn parse_session_checks_version_before_full_deserialization() {
        let json = br#"{"schemaVersion": 99, "kind": "wrong"}"#;
        let err = parse_session(json).unwrap_err();
        assert_eq!(
            err,
            SessionError::UnsupportedSchemaVersion { found: 99, min_supported: 1, max_supported: SOP_SESSION_SCHEMA_VERSION }
        );
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

    // ============================================================
    // C2P1-002/003 fix-round tests (2026-10-26 re-review)
    // ============================================================

    fn redaction_candidate(id: &str, disposition: Disposition) -> RedactionCandidate {
        RedactionCandidate {
            candidate_id: id.to_string(),
            detector_id: "rule.email".to_string(),
            reason_code: "EMAIL".to_string(),
            source_token_ids: vec![],
            original_box: (0, 0, 10, 10),
            expanded_box: (0, 0, 14, 14),
            score: Some(0.9),
            disposition,
            disposition_event_id: None,
        }
    }

    // --- C2P1-002: path/digest/dimension/box/cross-reference validation ---

    #[test]
    fn rejects_a_source_relative_path_that_escapes_the_session_root() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.source_relative_path = "../outside.png".to_string();
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::InvalidRelativePath { frame_id: "f1".to_string(), field: "source_relative_path" }
        );
    }

    #[test]
    fn rejects_a_malformed_raster_digest() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.raster_sha256 = "not-hex".to_string();
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::InvalidDigestFormat { frame_id: "f1".to_string(), field: "raster_sha256" }
        );
    }

    #[test]
    fn rejects_a_zero_width_frame() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.width = 0;
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidFrameDimensions { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_click_box_that_extends_past_the_frame_bounds() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.click_box = Some((90, 90, 50, 50)); // 90+50=140 > width 100
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidClickBox { frame_id: "f1".to_string() });
    }

    #[test]
    fn accepts_a_click_box_exactly_at_the_frame_edge() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.click_box = Some((90, 90, 10, 10)); // 90+10=100, exactly at bound
        s.source_frames.push(f);
        assert!(validate_session(&s).is_ok());
    }

    #[test]
    fn rejects_a_caption_referencing_an_unknown_frame() {
        let mut s = base_session();
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        let mut c = caption("s1", "text");
        c.source_frame_ids = vec!["ghost-frame".to_string()];
        s.captions.push(c);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::CaptionReferencesUnknownFrame { step_id: "s1".to_string(), frame_id: "ghost-frame".to_string() }
        );
    }

    #[test]
    fn rejects_duplicate_redaction_candidate_ids_on_the_same_frame() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.redaction_candidates = vec![redaction_candidate("c1", Disposition::Redact), redaction_candidate("c1", Disposition::Redact)];
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::DuplicateRedactionCandidateId { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_a_redaction_candidate_score_outside_zero_to_one() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        let mut c = redaction_candidate("c1", Disposition::Redact);
        c.score = Some(1.5);
        f.redaction_candidates = vec![c];
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::InvalidRedactionCandidateScore { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    // --- C2P1-002: the core fix — review_state/export_eligible must be earned, not trusted ---

    #[test]
    fn rejects_verified_review_state_when_a_frame_is_not_verified() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.verification = FrameVerification::Pending; // not Verified
        s.source_frames.push(f);
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-1".to_string());
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ReviewStateNotSatisfied { reason: "not every source frame is FrameVerification::Verified" }
        );
    }

    #[test]
    fn rejects_verified_review_state_when_a_redaction_candidate_is_still_pending() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.verification = FrameVerification::Verified;
        f.redaction_candidates = vec![redaction_candidate("c1", Disposition::Pending)];
        s.source_frames.push(f);
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-1".to_string());
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ReviewStateNotSatisfied { reason: "a redaction candidate is still Disposition::Pending" }
        );
    }

    #[test]
    fn rejects_verified_review_state_with_no_review_receipt() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.verification = FrameVerification::Verified;
        s.source_frames.push(f);
        s.review_state = ReviewState::Verified;
        s.review_receipt = None;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ReviewStateNotSatisfied { reason: "VERIFIED requires a review_receipt" }
        );
    }

    #[test]
    fn rejects_export_eligible_without_a_verified_review_state() {
        let mut s = base_session();
        s.review_state = ReviewState::InProgress;
        s.export_eligible = true;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ExportEligibleNotSatisfied { reason: "export_eligible requires review_state == Verified" }
        );
    }

    #[test]
    fn accepts_a_genuinely_verified_and_export_eligible_session_end_to_end() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.verification = FrameVerification::Verified;
        f.redaction_candidates = vec![redaction_candidate("c1", Disposition::Redact)];
        s.source_frames.push(f);
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-1".to_string());
        s.export_eligible = true;
        assert!(validate_session(&s).is_ok());
    }

    #[test]
    fn a_pending_session_with_no_frames_cannot_claim_verified() {
        // Guards against the vacuous-truth hole: Iterator::all on an empty
        // collection is true, so a session with zero frames must not be
        // able to claim VERIFIED just because "every frame (of none) is
        // verified" is trivially satisfied.
        let mut s = base_session();
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-1".to_string());
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ReviewStateNotSatisfied { reason: "not every source frame is FrameVerification::Verified" }
        );
    }

    // --- C2P1-003: edit-event chain structural validation ---

    #[test]
    fn rejects_a_duplicate_edit_event_id() {
        let mut e2 = event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "y".to_string() });
        e2.event_id = "ev-0".to_string(); // collides with event(0, ..)'s id
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() }), e2];
        assert_eq!(
            validate_edit_event_chain(&events).unwrap_err(),
            SessionError::DuplicateEditEventId { event_id: "ev-0".to_string() }
        );
    }

    #[test]
    fn rejects_a_duplicate_sequence_number() {
        let e1 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() });
        let mut e2 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "y".to_string() });
        e2.event_id = "ev-distinct".to_string();
        assert_eq!(
            validate_edit_event_chain(&[e1, e2]).unwrap_err(),
            SessionError::DuplicateEditEventSequence { sequence: 0 }
        );
    }

    #[test]
    fn rejects_a_gap_in_the_sequence() {
        let e1 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() });
        let e2 = event(2, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "y".to_string() }); // skips 1
        assert_eq!(
            validate_edit_event_chain(&[e1, e2]).unwrap_err(),
            SessionError::EditEventSequenceGap { expected: 1, found: 2 }
        );
    }

    #[test]
    fn rejects_a_revision_chain_that_does_not_follow_from_the_prior_event() {
        let e1 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() }); // before=0,after=1
        let mut e2 = event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "y".to_string() });
        e2.session_revision_before = 5; // should be 1, continuing from e1's after
        assert_eq!(
            validate_edit_event_chain(&[e1, e2]).unwrap_err(),
            SessionError::EditEventRevisionMismatch { event_id: "ev-1".to_string() }
        );
    }

    #[test]
    fn rejects_an_after_revision_that_is_not_exactly_before_plus_one() {
        let mut e1 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() });
        e1.session_revision_after = 5; // should be before(0)+1=1
        assert_eq!(
            validate_edit_event_chain(&[e1]).unwrap_err(),
            SessionError::EditEventRevisionMismatch { event_id: "ev-0".to_string() }
        );
    }

    #[test]
    fn accepts_a_well_formed_contiguous_event_chain_in_any_array_order() {
        let e0 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() });
        let e1 = event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() });
        let e2 = event(2, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "c".to_string() });
        // Deliberately out of array order.
        assert!(validate_edit_event_chain(&[e2, e0, e1]).is_ok());
    }

    #[test]
    fn validate_session_rejects_a_broken_edit_event_chain() {
        let mut s = base_session();
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        let mut e2 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "y".to_string() });
        e2.event_id = "ev-dup".to_string();
        e2.event_id = "ev-0".to_string(); // deliberate duplicate id
        s.edit_events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() }), e2];
        assert!(matches!(validate_session(&s), Err(SessionError::DuplicateEditEventId { .. })));
    }

    // --- C2P1-003: projector bug fixes ---

    #[test]
    fn reorder_rejects_a_list_with_a_duplicate_even_though_the_set_matches() {
        // The exact C2P1-003 bug: [s1, s1, s2] has the same SET as
        // {s1, s2} but is not a valid permutation - must be ignored, not
        // planted into `order` as a literal duplicate.
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Reorder { new_order: vec!["s1".to_string(), "s1".to_string(), "s2".to_string()] })];
        let projected = project_steps(&captions, &events);
        let ids: Vec<&String> = projected.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["s1", "s2"]); // unchanged, no duplicate
    }

    #[test]
    fn insert_with_an_unknown_after_step_id_is_a_no_op_not_an_append() {
        // The exact C2P1-003 bug: an unknown after_step_id used to fall
        // back to appending at the end instead of no-op'ing like every
        // other invalid-target case.
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(
            0,
            EditOperation::Insert { after_step_id: Some("ghost".to_string()), new_step_id: "new".to_string(), text: "X".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        let ids: Vec<&String> = projected.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["s1", "s2"]); // "new" never inserted
    }

    #[test]
    fn split_refuses_when_a_replacement_id_collides_with_another_existing_step() {
        let captions = vec![caption("s1", "Click and drag"), caption("s2", "Next")];
        let events = vec![event(
            0,
            EditOperation::Split { step_id: "s1".to_string(), into: vec![("s2".to_string(), "Click".to_string())] }, // collides with existing s2
        )];
        let projected = project_steps(&captions, &events);
        // Split refused entirely: original two steps, unchanged text.
        assert_eq!(projected, vec![("s1".to_string(), "Click and drag".to_string()), ("s2".to_string(), "Next".to_string())]);
    }

    #[test]
    fn merge_refuses_non_consecutive_steps() {
        let captions = vec![caption("s1", "A"), caption("s2", "B"), caption("s3", "C")];
        let events = vec![event(
            0,
            EditOperation::Merge { step_ids: vec!["s1".to_string(), "s3".to_string()], into_step_id: "merged".to_string(), text: "AC".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        let ids: Vec<&String> = projected.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["s1", "s2", "s3"]); // merge refused, nothing changed
    }

    #[test]
    fn merge_refuses_a_duplicated_source_step_id() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(
            0,
            EditOperation::Merge { step_ids: vec!["s1".to_string(), "s1".to_string()], into_step_id: "merged".to_string(), text: "AA".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        let ids: Vec<&String> = projected.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["s1", "s2"]);
    }

    #[test]
    fn merge_refuses_when_the_destination_id_collides_with_a_surviving_step() {
        let captions = vec![caption("s1", "A"), caption("s2", "B"), caption("s3", "C")];
        let events = vec![event(
            0,
            EditOperation::Merge { step_ids: vec!["s1".to_string(), "s2".to_string()], into_step_id: "s3".to_string(), text: "AB".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        let ids: Vec<&String> = projected.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["s1", "s2", "s3"]); // refused: "s3" survives and would collide
    }

    #[test]
    fn merge_still_accepts_a_valid_consecutive_merge() {
        let captions = vec![caption("s1", "Click"), caption("s2", "Drag"), caption("s3", "Release")];
        let events = vec![event(
            0,
            EditOperation::Merge { step_ids: vec!["s1".to_string(), "s2".to_string()], into_step_id: "s1-2".to_string(), text: "Click and drag".to_string() },
        )];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected, vec![("s1-2".to_string(), "Click and drag".to_string()), ("s3".to_string(), "Release".to_string())]);
    }

    // --- C2P1-003: redaction-invalidates-caption ---

    #[test]
    fn invalidated_step_ids_is_empty_with_no_redaction_change_events() {
        let captions = vec![caption("s1", "A")];
        assert!(invalidated_step_ids(&captions, &[]).is_empty());
    }

    #[test]
    fn invalidated_step_ids_flags_a_caption_whose_frame_had_a_redaction_change() {
        let mut c = caption("s1", "A");
        c.source_frame_ids = vec!["f1".to_string()];
        let captions = vec![c, caption("s2", "B")]; // s2 references no frame
        let events = vec![event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact })];
        let invalidated = invalidated_step_ids(&captions, &events);
        assert!(invalidated.contains("s1"));
        assert!(!invalidated.contains("s2"));
    }
}
