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

use crate::sop_ipc::{confine_relative_path, is_valid_sha256_hex};

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

/// GS-C6 fix-round-6: the durable, versioned on-disk record of a
/// [`Disposition::MarkNonSensitive`] override's reason/confirmation
/// authority content — the gap [`crate::sop_redaction::verify_coverage_proof`]
/// previously could never close, because [`EditOperation::RedactionChange`]
/// had nowhere to persist either field (`OverrideAuthorityContentUnsupported`
/// fired unconditionally on every resolved override). `None` on
/// [`EditOperation::RedactionChange::authority`] means either "this is not
/// an override that needed one" (any disposition other than
/// `MarkNonSensitive`) or "this event predates this schema" — both are
/// still unsupported for coverage purposes, same as today. Tagged by
/// `schema_version` so `V1`/`V2` can never be confused with each other even
/// if their remaining fields happened to coincide — the same domain-
/// separation discipline `CONFIRMATION_DIGEST_DOMAIN_V1` already uses one
/// level down.
///
/// GS-C6 fix-round-7 re-review (`results/chatgpt/capture-c2-p6a-fix-round-6-rereview-2026-10-30.md`):
/// `V1`'s `confirmation_digest` is an ordinary public SHA-256 recomputed
/// from fields stored beside it — a party able to edit the session file
/// can alter the reason or any bound identity, call the public
/// [`crate::sop_redaction::confirmation_digest`] function, and store a
/// matching digest; `V1` is therefore self-mintable, not proof of a real
/// trusted confirmation (C6A-001B recreated at the durable layer). `V1` is
/// kept only as a dead, permanently-untrusted schema tag — any session
/// still carrying one still parses, but
/// [`crate::sop_redaction::verify_coverage_proof`] never accepts it (see
/// that function's own doc comment). `V2` is the superseding, trustworthy
/// shape: [`V2::authority_mac`] is an HMAC-SHA256 over every other field,
/// keyed with a secret only the trusted confirmation boundary holds (the
/// DPAPI-protected authority key in `app/src/sop_workspace.rs`) — a party
/// without that key cannot forge a passing record no matter what public
/// digest they recompute. A verifier first checks `authority_mac` (record
/// origin), then recomputes [`crate::sop_redaction::confirmation_digest`]
/// against the **current** session/frame state supplied by the caller
/// (never against this record's own stored copies of that state) and
/// checks it against the stored `confirmation_digest` — so a `V2` record
/// that is perfectly authentic for a now-stale derivative, policy, model,
/// session, or revision is still refused.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "schema_version", rename_all = "kebab-case")]
pub enum OverrideAuthority {
    /// GS-C6 fix-round-6 schema. Self-mintable (see this enum's doc
    /// comment) — never accepted by `verify_coverage_proof`. Retained only
    /// so a session file written by that round still deserializes instead
    /// of failing to load at all.
    V1 {
        session_id: String,
        reason: String,
        confirmation_digest: String,
        source_raster_sha256: String,
        derivative_sha256: Option<String>,
        policy_version: String,
        model_manifest_sha256: Option<String>,
        session_revision: u64,
    },
    /// GS-C6 fix-round-7 schema — see this enum's doc comment.
    V2 {
        /// The session this confirmation was computed against — part of
        /// the digest's own canonical input (C6A-001C), so this record
        /// can never be replayed as if it belonged to a different session.
        session_id: String,
        reason: String,
        /// The confirmation digest [`validate_review_action`] actually
        /// accepted for this exact override at the moment it was applied.
        confirmation_digest: String,
        /// The frame's `raster_sha256`/`redacted_derivative_sha256`, the
        /// session's `policy_version`/`model_manifest_sha256`, and
        /// `session_revision` at the moment this record was minted —
        /// forensic/audit history only. A verifier's freshness check
        /// (fix-round-7) recomputes the digest against the **current**
        /// live session/frame state a caller supplies, never against
        /// these stored copies — see this enum's doc comment for why
        /// trusting the stored copies alone was the fix-round-6 gap.
        source_raster_sha256: String,
        derivative_sha256: Option<String>,
        policy_version: String,
        model_manifest_sha256: Option<String>,
        session_revision: u64,
        /// HMAC-SHA256 (hex) over every field above, keyed with a secret
        /// only the trusted confirmation boundary holds — see
        /// [`crate::sop_redaction::build_redaction_change_event`]/
        /// [`crate::sop_redaction::verify_coverage_proof`]. Proves this
        /// record's origin; a party who can edit the session file but
        /// does not hold the key cannot produce a value that passes.
        authority_mac: String,
    },
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
    RedactionChange {
        frame_id: String,
        candidate_id: String,
        disposition: Disposition,
        /// GS-C6 fix-round-6: see [`OverrideAuthority`]. `#[serde(default)]`
        /// so a session file written before this field existed still
        /// parses (as `None`), rather than failing to load at all.
        #[serde(default)]
        authority: Option<OverrideAuthority>,
    },
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
    UnsupportedSidecarProtocolVersion { found: u32, max_supported: u32 },
    WrongKind { found: String },
    TooManyFrames { found: usize, max: usize },
    DuplicateFrameId { frame_id: String },
    DuplicateStepId { step_id: String },
    TooManyOcrTokens { found: usize, max: usize },
    OcrJsonTooLarge { found_bytes: usize, max_bytes: usize },
    EmptySessionId,
    EmptyFrameId,
    EmptyStepId,
    InvalidFrameSourcePath { frame_id: String },
    InvalidFrameDigest { frame_id: String },
    InvalidProvenancePath { frame_id: String },
    InvalidProvenanceDigest { frame_id: String },
    InvalidRedactedDerivativePath { frame_id: String },
    InvalidRedactedDerivativeDigest { frame_id: String },
    ZeroFrameDimension { frame_id: String },
    InvalidClickBox { frame_id: String },
    EmptyCandidateId { frame_id: String },
    DuplicateCandidateId { frame_id: String, candidate_id: String },
    InvalidCandidateBox { frame_id: String, candidate_id: String },
    ExpandedBoxDoesNotContainOriginal { frame_id: String, candidate_id: String },
    InvalidCandidateScore { frame_id: String, candidate_id: String },
    EmptySourceTokenIds { frame_id: String, candidate_id: String },
    UnresolvedCandidateOnVerifiedFrame { frame_id: String, candidate_id: String },
    DanglingDispositionEvent { frame_id: String, candidate_id: String, event_id: String },
    /// C2P1-RR-002: a non-pending disposition on a `Verified` frame with
    /// no `disposition_event_id` at all — i.e. the disposition could have
    /// been pre-populated directly in the document rather than set by an
    /// actual user-authenticated `RedactionChange` event. A candidate
    /// must never be treated as resolved on hearsay.
    MissingDispositionEvidence { frame_id: String, candidate_id: String },
    /// C2P1-RR-002: at least one candidate on this `Verified` frame has
    /// `disposition == Redact`, but the frame has no (confined,
    /// well-formed) redacted derivative path+digest recorded — there is
    /// no proof the redaction was ever actually rendered into pixels.
    MissingRedactedDerivativeOnVerifiedFrame { frame_id: String },
    EmptyCaptionSourceFrameIds { step_id: String },
    UnknownCaptionSourceFrame { step_id: String, frame_id: String },
    CaptionSuggestionDigestMismatch { step_id: String },
    SessionVerifiedWithUnverifiedFrame { frame_id: String },
    /// C2P1-RR-002: `review_state == Verified` with no `review_receipt` —
    /// previously only checked when `export_eligible` was also true,
    /// which let a session claim `VERIFIED` with zero receipt evidence as
    /// long as it didn't also claim exportability.
    VerifiedWithoutReviewReceipt,
    ExportEligibleWithoutVerifiedReview,
    ExportEligibleWithoutReviewReceipt,
    VerifiedWithInvalidatedCaption { step_id: String },
    InvalidEditChain(EditChainError),
}

/// Reasons [`validate_edit_chain`] refuses an append-only [`EditEvent`]
/// log. Every variant is distinct and machine-checkable — same convention
/// as [`SessionError`] and [`crate::sop_ipc::RequestValidationError`].
/// Raised at the write-time validation gate ([`validate_session`]); the
/// read-time projector [`project_steps`] stays total/permissive for logs
/// that already passed this gate (see that function's doc comment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditChainError {
    DuplicateEventId { event_id: String },
    DuplicateSequence { sequence: u64 },
    NonContiguousSequence { expected: u64, found: u64 },
    RevisionNotIncrementing { event_id: String, before: u64, after: u64 },
    RevisionChainBroken { event_id: String, expected_before: u64, found_before: u64 },
    FinalRevisionMismatch { chain_end: u64, session_revision: u64 },
    DigestChainBroken { event_id: String },
    UnknownRewriteTarget { event_id: String, step_id: String },
    UnknownDeleteTarget { event_id: String, step_id: String },
    UnknownInsertAfterTarget { event_id: String, after_step_id: String },
    DuplicateInsertStepId { event_id: String, step_id: String },
    InvalidReorderPermutation { event_id: String },
    UnknownSplitTarget { event_id: String, step_id: String },
    SplitProducesNoSteps { event_id: String },
    SplitIdCollision { event_id: String, step_id: String },
    DuplicateSplitIds { event_id: String },
    EmptyMergeStepIds { event_id: String },
    UnknownMergeSource { event_id: String, step_id: String },
    DuplicateMergeSource { event_id: String, step_id: String },
    NonConsecutiveMergeSources { event_id: String },
    MergeDestinationCollision { event_id: String, step_id: String },
    UnknownRedactionChangeFrame { event_id: String, frame_id: String },
    UnknownRedactionChangeCandidate { event_id: String, candidate_id: String },
    UnknownRevertTarget { event_id: String, step_id: String },
    /// C2P1-RR-003: a non-empty chain whose first event's
    /// `session_revision_before` isn't `0` — nothing anchors the chain to
    /// a real genesis state, so e.g. a one-event log from revision 99 to
    /// 100 used to pass with no history behind it at all.
    ChainDoesNotStartAtGenesisRevision { found: u64 },
    /// C2P1-RR-003: an empty edit-event log whose session `revision`
    /// isn't `0` — an empty log can only mean "nothing has ever been
    /// edited," which is revision 0 by definition; any other claimed
    /// revision with zero supporting events is unaccounted for.
    NonZeroRevisionWithEmptyChain { session_revision: u64 },
    /// C2P1-RR-003: an event is missing `before_digest` or `after_digest`
    /// — both are now required on every event (previously optional,
    /// which let digest continuity be silently skipped whenever either
    /// side was absent).
    MissingDigestLink { event_id: String },
    /// C2P1-RR-003: the first event's `before_digest` doesn't match the
    /// genesis digest (the hash of the session's captions with zero
    /// edits applied) — the chain doesn't actually start from the real
    /// pre-edit state.
    ChainDoesNotStartAtGenesisDigest { event_id: String },
    /// C2P1-RR-003: an event's `after_digest` doesn't match the real
    /// digest of the state you get by replaying the chain up to and
    /// including that event — the strongest form of "digest-bound":
    /// not just neighbor-to-neighbor agreement (which a forged chain
    /// could fake), but agreement with the actual content.
    AfterDigestDoesNotMatchReplayedState { event_id: String },
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
///
/// This is the fail-closed gate for the whole persisted contract: every
/// path field is re-confined with the same grammar
/// [`crate::sop_ipc::confine_relative_path`] uses at the IPC boundary,
/// every digest field must be a well-formed SHA-256 hex string, every
/// cross-reference (caption-to-frame, redaction-candidate-to-disposition-
/// event) must resolve, the append-only edit log must be a valid chain
/// (see [`validate_edit_chain`]), and the review/export state machine
/// must be *derived true* rather than merely self-consistent — a session
/// cannot declare `VERIFIED`/`exportEligible` while any frame, candidate,
/// or caption it actually contains contradicts that claim.
pub fn validate_session(session: &SopSessionV1) -> Result<(), SessionError> {
    if session.schema_version != SOP_SESSION_SCHEMA_VERSION {
        return Err(SessionError::UnsupportedSchemaVersion {
            found: session.schema_version,
            max_supported: SOP_SESSION_SCHEMA_VERSION,
        });
    }
    if session.sidecar_protocol_version != crate::sop_ipc::SIDECAR_PROTOCOL_VERSION {
        return Err(SessionError::UnsupportedSidecarProtocolVersion {
            found: session.sidecar_protocol_version,
            max_supported: crate::sop_ipc::SIDECAR_PROTOCOL_VERSION,
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
        validate_frame(frame)?;
    }

    let mut seen_step_ids = std::collections::HashSet::new();
    for caption in &session.captions {
        if caption.step_id.is_empty() {
            return Err(SessionError::EmptyStepId);
        }
        if !seen_step_ids.insert(caption.step_id.clone()) {
            return Err(SessionError::DuplicateStepId { step_id: caption.step_id.clone() });
        }
        if caption.source_frame_ids.is_empty() {
            return Err(SessionError::EmptyCaptionSourceFrameIds { step_id: caption.step_id.clone() });
        }
        for frame_id in &caption.source_frame_ids {
            if !seen_frame_ids.contains(frame_id) {
                return Err(SessionError::UnknownCaptionSourceFrame {
                    step_id: caption.step_id.clone(),
                    frame_id: frame_id.clone(),
                });
            }
        }
        if caption.suggestion_digest != sha256_hex(caption.model_suggestion.as_bytes()) {
            return Err(SessionError::CaptionSuggestionDigestMismatch { step_id: caption.step_id.clone() });
        }
    }

    validate_edit_chain(session).map_err(SessionError::InvalidEditChain)?;

    for frame in &session.source_frames {
        if frame.verification == FrameVerification::Verified {
            let mut any_redact = false;
            for candidate in &frame.redaction_candidates {
                if candidate.disposition == Disposition::Pending {
                    return Err(SessionError::UnresolvedCandidateOnVerifiedFrame {
                        frame_id: frame.frame_id.clone(),
                        candidate_id: candidate.candidate_id.clone(),
                    });
                }
                // C2P1-RR-002: a resolved disposition with no
                // `disposition_event_id` at all could have been
                // pre-populated directly in the document rather than set
                // by an actual user-authenticated RedactionChange event —
                // `validate_edit_chain` already proves a PRESENT
                // disposition_event_id is correctly bound to a matching
                // event; this proves one is present in the first place.
                if candidate.disposition_event_id.is_none() {
                    return Err(SessionError::MissingDispositionEvidence {
                        frame_id: frame.frame_id.clone(),
                        candidate_id: candidate.candidate_id.clone(),
                    });
                }
                if candidate.disposition == Disposition::Redact {
                    any_redact = true;
                }
            }
            // C2P1-RR-002: at least one candidate was actually redacted —
            // require proof it was rendered: a confined derivative path
            // and its digest (both already shape-validated by
            // `validate_frame` if present; here we require them to be
            // present at all on a Verified frame).
            if any_redact
                && (frame.redacted_derivative_relative_path.is_none() || frame.redacted_derivative_sha256.is_none())
            {
                return Err(SessionError::MissingRedactedDerivativeOnVerifiedFrame { frame_id: frame.frame_id.clone() });
            }
        }
    }

    if session.review_state == ReviewState::Verified {
        for frame in &session.source_frames {
            if frame.verification != FrameVerification::Verified {
                return Err(SessionError::SessionVerifiedWithUnverifiedFrame { frame_id: frame.frame_id.clone() });
            }
        }
        let invalidated = invalidated_step_ids(&session.captions, &session.edit_events);
        if let Some(step_id) = session.captions.iter().map(|c| c.step_id.clone()).find(|id| invalidated.contains(id)) {
            return Err(SessionError::VerifiedWithInvalidatedCaption { step_id });
        }
        // C2P1-RR-002: a receipt is required for VERIFIED itself, not
        // only when also claiming export_eligible — previously a session
        // could claim review_state == Verified with zero receipt
        // evidence as long as it didn't also claim exportability.
        if session.review_receipt.as_deref().unwrap_or("").is_empty() {
            return Err(SessionError::VerifiedWithoutReviewReceipt);
        }
    }

    if session.export_eligible && session.review_state != ReviewState::Verified {
        return Err(SessionError::ExportEligibleWithoutVerifiedReview);
    }

    Ok(())
}

/// Per-frame structural validation: confined paths, well-formed digests,
/// nonzero dimensions, in-bounds boxes, and every redaction candidate's
/// own shape — the brief §4 fields a session-level cross-reference check
/// cannot verify without first knowing each frame's own data is well
/// formed.
fn validate_frame(frame: &SourceFrame) -> Result<(), SessionError> {
    if confine_relative_path(&frame.source_relative_path).is_err() {
        return Err(SessionError::InvalidFrameSourcePath { frame_id: frame.frame_id.clone() });
    }
    if !is_valid_sha256_hex(&frame.raster_sha256) {
        return Err(SessionError::InvalidFrameDigest { frame_id: frame.frame_id.clone() });
    }
    if let Some(path) = &frame.provenance_sidecar_relative_path {
        if confine_relative_path(path).is_err() {
            return Err(SessionError::InvalidProvenancePath { frame_id: frame.frame_id.clone() });
        }
    }
    if let Some(digest) = &frame.provenance_sidecar_blob_sha256 {
        if !is_valid_sha256_hex(digest) {
            return Err(SessionError::InvalidProvenanceDigest { frame_id: frame.frame_id.clone() });
        }
    }
    if let Some(path) = &frame.redacted_derivative_relative_path {
        if confine_relative_path(path).is_err() {
            return Err(SessionError::InvalidRedactedDerivativePath { frame_id: frame.frame_id.clone() });
        }
    }
    if let Some(digest) = &frame.redacted_derivative_sha256 {
        if !is_valid_sha256_hex(digest) {
            return Err(SessionError::InvalidRedactedDerivativeDigest { frame_id: frame.frame_id.clone() });
        }
    }
    if frame.width == 0 || frame.height == 0 {
        return Err(SessionError::ZeroFrameDimension { frame_id: frame.frame_id.clone() });
    }
    if let Some(box_) = frame.click_box {
        if !box_in_bounds(box_, frame.width, frame.height) {
            return Err(SessionError::InvalidClickBox { frame_id: frame.frame_id.clone() });
        }
    }

    let mut seen_candidate_ids = std::collections::HashSet::new();
    for candidate in &frame.redaction_candidates {
        if candidate.candidate_id.is_empty() {
            return Err(SessionError::EmptyCandidateId { frame_id: frame.frame_id.clone() });
        }
        if !seen_candidate_ids.insert(candidate.candidate_id.clone()) {
            return Err(SessionError::DuplicateCandidateId {
                frame_id: frame.frame_id.clone(),
                candidate_id: candidate.candidate_id.clone(),
            });
        }
        if candidate_requires_source_tokens(&candidate.detector_id) && candidate.source_token_ids.is_empty() {
            return Err(SessionError::EmptySourceTokenIds {
                frame_id: frame.frame_id.clone(),
                candidate_id: candidate.candidate_id.clone(),
            });
        }
        if !box_in_bounds(candidate.original_box, frame.width, frame.height)
            || !box_in_bounds(candidate.expanded_box, frame.width, frame.height)
        {
            return Err(SessionError::InvalidCandidateBox {
                frame_id: frame.frame_id.clone(),
                candidate_id: candidate.candidate_id.clone(),
            });
        }
        if !box_contains(candidate.expanded_box, candidate.original_box) {
            return Err(SessionError::ExpandedBoxDoesNotContainOriginal {
                frame_id: frame.frame_id.clone(),
                candidate_id: candidate.candidate_id.clone(),
            });
        }
        if let Some(score) = candidate.score {
            if !(0.0..=1.0).contains(&score) || score.is_nan() {
                return Err(SessionError::InvalidCandidateScore {
                    frame_id: frame.frame_id.clone(),
                    candidate_id: candidate.candidate_id.clone(),
                });
            }
        }
    }
    Ok(())
}

/// Detector IDs for structural/UI evidence that is never bound to OCR
/// tokens by construction — it has no text-recognition step at all, so
/// there is no token list to be empty or non-empty (brief §3.3's UIA
/// password-field and image-only input-rectangle passes:
/// `sop_redaction::structural_candidates_from_uia`,
/// `sop_redaction::structural_candidates_from_image_rects`). Kept here
/// as a short, explicitly named exception list rather than relaxing the
/// token-backed validation every other candidate kind still needs —
/// `sop_redaction` (a higher-level module) cannot be imported from this
/// lower-level one, so this list is duplicated by convention, not
/// shared code: keep the two in sync if either detector's id ever
/// changes.
const STRUCTURAL_EVIDENCE_DETECTOR_IDS: &[&str] = &["det.uia_password_field", "det.image_rect_input_field"];

/// Whether a candidate from `detector_id` is required to carry a
/// nonempty `source_token_ids` list — true for every OCR-token-bound
/// detector (the default), false only for the explicitly named
/// structural/UI evidence detectors above.
fn candidate_requires_source_tokens(detector_id: &str) -> bool {
    !STRUCTURAL_EVIDENCE_DETECTOR_IDS.contains(&detector_id)
}

/// A box is well-formed (nonzero area, non-negative origin) and does not
/// extend past the frame raster it is claimed to be drawn on.
fn box_in_bounds(box_: (i64, i64, u64, u64), frame_width: u32, frame_height: u32) -> bool {
    let (x, y, w, h) = box_;
    if w == 0 || h == 0 || x < 0 || y < 0 {
        return false;
    }
    let Some(right) = x.checked_add_unsigned(w) else { return false };
    let Some(bottom) = y.checked_add_unsigned(h) else { return false };
    right <= frame_width as i64 && bottom <= frame_height as i64
}

/// `expanded` must fully contain `original` — brief §3.1: "Candidate boxes
/// expand by at least 4 source pixels," never shrink or move away from
/// the detection they claim to cover.
fn box_contains(expanded: (i64, i64, u64, u64), original: (i64, i64, u64, u64)) -> bool {
    let (ex, ey, ew, eh) = expanded;
    let (ox, oy, ow, oh) = original;
    let Some(e_right) = ex.checked_add_unsigned(ew) else { return false };
    let Some(e_bottom) = ey.checked_add_unsigned(eh) else { return false };
    let Some(o_right) = ox.checked_add_unsigned(ow) else { return false };
    let Some(o_bottom) = oy.checked_add_unsigned(oh) else { return false };
    ex <= ox && ey <= oy && e_right >= o_right && e_bottom >= o_bottom
}

/// Validates the append-only [`EditEvent`] log as a contiguous,
/// unique, revision/digest-bound chain, then strictly replays every
/// operation against the live step/frame/candidate state at the point it
/// occurs — rejecting (not silently skipping) any invalid target or
/// collision. This is the write-time gate; [`project_steps`] is the
/// separate, deliberately permissive read-time replay for logs that
/// already passed this gate (see its doc comment for why the two must
/// not be merged into one function).
/// Digest of a projected step sequence — the "content" half of the
/// edit-chain's digest binding. A plain JSON array of `[stepId, text]`
/// pairs in display order; the array's own order already carries the
/// sequence, so nothing beyond `serde_json`'s default encoding is needed
/// for this to be a stable, deterministic representation.
pub(crate) fn canonical_state_digest(steps: &[(String, String)]) -> String {
    let json = serde_json::to_string(steps).unwrap_or_default();
    sha256_hex(json.as_bytes())
}

pub fn validate_edit_chain(session: &SopSessionV1) -> Result<(), EditChainError> {
    let events = &session.edit_events;

    let mut seen_event_ids = std::collections::HashSet::new();
    let mut seen_sequences = std::collections::HashSet::new();
    for event in events {
        if !seen_event_ids.insert(event.event_id.clone()) {
            return Err(EditChainError::DuplicateEventId { event_id: event.event_id.clone() });
        }
        if !seen_sequences.insert(event.sequence) {
            return Err(EditChainError::DuplicateSequence { sequence: event.sequence });
        }
    }

    let mut sorted: Vec<&EditEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.sequence);

    // C2P1-RR-003: an empty log can only ever mean genesis - revision 0.
    // Previously an empty log with a nonzero `session.revision` passed
    // silently. This does NOT early-return — a session can still carry a
    // dangling `disposition_event_id` with zero actual events, which the
    // cross-reference check after this block must still catch; only the
    // chain-walk itself (meaningless with no events) is skipped.
    if sorted.is_empty() && session.revision != 0 {
        return Err(EditChainError::NonZeroRevisionWithEmptyChain { session_revision: session.revision });
    }

    if !sorted.is_empty() {
        // C2P1-RR-003: the chain must start from the real genesis state -
        // by revision (must be exactly 0; previously unchecked, so e.g. a
        // one-event log from revision 99 to 100 passed) and by digest
        // (the actual hash of the captions' own model_suggestion text
        // with zero edits applied yet).
        if sorted[0].session_revision_before != 0 {
            return Err(EditChainError::ChainDoesNotStartAtGenesisRevision { found: sorted[0].session_revision_before });
        }
        let genesis_digest = canonical_state_digest(&project_steps(&session.captions, &[]));

        let mut applied: Vec<EditEvent> = Vec::with_capacity(sorted.len());
        for (i, event) in sorted.iter().enumerate() {
            if event.sequence != i as u64 {
                return Err(EditChainError::NonContiguousSequence { expected: i as u64, found: event.sequence });
            }
            if event.session_revision_after != event.session_revision_before + 1 {
                return Err(EditChainError::RevisionNotIncrementing {
                    event_id: event.event_id.clone(),
                    before: event.session_revision_before,
                    after: event.session_revision_after,
                });
            }
            if i > 0 {
                let prev = sorted[i - 1];
                if event.session_revision_before != prev.session_revision_after {
                    return Err(EditChainError::RevisionChainBroken {
                        event_id: event.event_id.clone(),
                        expected_before: prev.session_revision_after,
                        found_before: event.session_revision_before,
                    });
                }
            }

            // C2P1-RR-003: both digests are now REQUIRED on every event
            // (previously optional, so digest continuity was silently
            // skipped whenever either neighboring field was absent).
            let (Some(before_digest), Some(after_digest)) = (&event.before_digest, &event.after_digest) else {
                return Err(EditChainError::MissingDigestLink { event_id: event.event_id.clone() });
            };

            if i == 0 {
                if before_digest != &genesis_digest {
                    return Err(EditChainError::ChainDoesNotStartAtGenesisDigest { event_id: event.event_id.clone() });
                }
            } else {
                let prev_after = sorted[i - 1]
                    .after_digest
                    .as_ref()
                    .expect("the previous iteration already required this to be Some");
                if before_digest != prev_after {
                    return Err(EditChainError::DigestChainBroken { event_id: event.event_id.clone() });
                }
            }

            // The strongest form of "digest-bound": `after_digest` must
            // match the REAL content produced by actually replaying the
            // chain up to and including this event — not just "whatever
            // the previous event claimed," which a forged-but-internally-
            // consistent chain of matching neighbor digests could
            // otherwise fake.
            applied.push((*event).clone());
            let actual_after = canonical_state_digest(&project_steps(&session.captions, &applied));
            if after_digest != &actual_after {
                return Err(EditChainError::AfterDigestDoesNotMatchReplayedState { event_id: event.event_id.clone() });
            }
        }

        if let Some(last) = sorted.last() {
            if last.session_revision_after != session.revision {
                return Err(EditChainError::FinalRevisionMismatch {
                    chain_end: last.session_revision_after,
                    session_revision: session.revision,
                });
            }
        }
    }

    let known_frame_ids: std::collections::HashSet<&str> =
        session.source_frames.iter().map(|f| f.frame_id.as_str()).collect();
    let known_candidate_ids: std::collections::HashMap<&str, std::collections::HashSet<&str>> = session
        .source_frames
        .iter()
        .map(|f| (f.frame_id.as_str(), f.redaction_candidates.iter().map(|c| c.candidate_id.as_str()).collect()))
        .collect();

    let mut order: Vec<String> = session.captions.iter().map(|c| c.step_id.clone()).collect();

    for event in sorted {
        match &event.operation {
            EditOperation::Rewrite { step_id, .. } => {
                if !order.contains(step_id) {
                    return Err(EditChainError::UnknownRewriteTarget { event_id: event.event_id.clone(), step_id: step_id.clone() });
                }
            }
            EditOperation::Insert { after_step_id, new_step_id, .. } => {
                if let Some(after) = after_step_id {
                    if !order.contains(after) {
                        return Err(EditChainError::UnknownInsertAfterTarget {
                            event_id: event.event_id.clone(),
                            after_step_id: after.clone(),
                        });
                    }
                }
                if order.contains(new_step_id) {
                    return Err(EditChainError::DuplicateInsertStepId {
                        event_id: event.event_id.clone(),
                        step_id: new_step_id.clone(),
                    });
                }
                let insert_at = match after_step_id {
                    Some(after) => order.iter().position(|s| s == after).map(|i| i + 1).unwrap_or(order.len()),
                    None => 0,
                };
                order.insert(insert_at, new_step_id.clone());
            }
            EditOperation::Delete { step_id } => {
                if !order.contains(step_id) {
                    return Err(EditChainError::UnknownDeleteTarget { event_id: event.event_id.clone(), step_id: step_id.clone() });
                }
                order.retain(|s| s != step_id);
            }
            EditOperation::Reorder { new_order } => {
                let mut seen = std::collections::HashSet::new();
                for id in new_order {
                    if !seen.insert(id.clone()) {
                        return Err(EditChainError::InvalidReorderPermutation { event_id: event.event_id.clone() });
                    }
                }
                let current: std::collections::HashSet<&String> = order.iter().collect();
                let proposed: std::collections::HashSet<&String> = new_order.iter().collect();
                if new_order.len() != order.len() || current != proposed {
                    return Err(EditChainError::InvalidReorderPermutation { event_id: event.event_id.clone() });
                }
                order = new_order.clone();
            }
            EditOperation::Split { step_id, into } => {
                let Some(pos) = order.iter().position(|s| s == step_id) else {
                    return Err(EditChainError::UnknownSplitTarget { event_id: event.event_id.clone(), step_id: step_id.clone() });
                };
                if into.is_empty() {
                    return Err(EditChainError::SplitProducesNoSteps { event_id: event.event_id.clone() });
                }
                let mut new_ids = std::collections::HashSet::new();
                for (id, _) in into {
                    if !new_ids.insert(id.clone()) {
                        return Err(EditChainError::DuplicateSplitIds { event_id: event.event_id.clone() });
                    }
                    if id != step_id && order.contains(id) {
                        return Err(EditChainError::SplitIdCollision { event_id: event.event_id.clone(), step_id: id.clone() });
                    }
                }
                let replacement_ids: Vec<String> = into.iter().map(|(id, _)| id.clone()).collect();
                order.splice(pos..=pos, replacement_ids);
            }
            EditOperation::Merge { step_ids, into_step_id, .. } => {
                if step_ids.is_empty() {
                    return Err(EditChainError::EmptyMergeStepIds { event_id: event.event_id.clone() });
                }
                let mut seen = std::collections::HashSet::new();
                let mut positions = Vec::with_capacity(step_ids.len());
                for id in step_ids {
                    if !seen.insert(id.clone()) {
                        return Err(EditChainError::DuplicateMergeSource { event_id: event.event_id.clone(), step_id: id.clone() });
                    }
                    let Some(pos) = order.iter().position(|s| s == id) else {
                        return Err(EditChainError::UnknownMergeSource { event_id: event.event_id.clone(), step_id: id.clone() });
                    };
                    positions.push(pos);
                }
                positions.sort_unstable();
                for w in positions.windows(2) {
                    if w[1] != w[0] + 1 {
                        return Err(EditChainError::NonConsecutiveMergeSources { event_id: event.event_id.clone() });
                    }
                }
                if !step_ids.contains(into_step_id) && order.contains(into_step_id) {
                    return Err(EditChainError::MergeDestinationCollision {
                        event_id: event.event_id.clone(),
                        step_id: into_step_id.clone(),
                    });
                }
                let first_pos = positions[0];
                order.retain(|s| !step_ids.contains(s));
                let insert_at = first_pos.min(order.len());
                order.insert(insert_at, into_step_id.clone());
            }
            EditOperation::RedactionChange { frame_id, candidate_id, .. } => {
                if !known_frame_ids.contains(frame_id.as_str()) {
                    return Err(EditChainError::UnknownRedactionChangeFrame {
                        event_id: event.event_id.clone(),
                        frame_id: frame_id.clone(),
                    });
                }
                if !known_candidate_ids.get(frame_id.as_str()).is_some_and(|c| c.contains(candidate_id.as_str())) {
                    return Err(EditChainError::UnknownRedactionChangeCandidate {
                        event_id: event.event_id.clone(),
                        candidate_id: candidate_id.clone(),
                    });
                }
            }
            EditOperation::Revert { step_id } => {
                if !order.contains(step_id) {
                    return Err(EditChainError::UnknownRevertTarget { event_id: event.event_id.clone(), step_id: step_id.clone() });
                }
            }
        }
    }

    for frame in &session.source_frames {
        for candidate in &frame.redaction_candidates {
            if let Some(event_id) = &candidate.disposition_event_id {
                let bound = events.iter().any(|e| {
                    &e.event_id == event_id
                        && matches!(
                            &e.operation,
                            EditOperation::RedactionChange { frame_id, candidate_id, disposition, .. }
                                if frame_id == &frame.frame_id
                                    && candidate_id == &candidate.candidate_id
                                    && *disposition == candidate.disposition
                        )
                });
                if !bound {
                    return Err(EditChainError::UnknownRedactionChangeCandidate {
                        event_id: event_id.clone(),
                        candidate_id: candidate.candidate_id.clone(),
                    });
                }
            }
        }
    }

    Ok(())
}

/// Step IDs whose caption text must be treated as stale because a
/// [`EditOperation::RedactionChange`] touching one of that caption's
/// `source_frame_ids` happened more recently (by `sequence`) than the
/// most recent text-affecting edit to that same step — brief §3.5/§4:
/// "any mask/disposition change invalidates caption and verification."
/// A caption that has never been touched by a text-affecting edit is
/// invalidated by *any* redaction change on one of its frames (there is
/// nothing later than "never" to supersede it).
pub fn invalidated_step_ids(captions: &[CaptionDraft], edit_events: &[EditEvent]) -> std::collections::HashSet<String> {
    let mut sorted: Vec<&EditEvent> = edit_events.iter().collect();
    sorted.sort_by_key(|e| e.sequence);

    let mut last_text_edit: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut last_redaction_change: std::collections::HashMap<String, u64> = std::collections::HashMap::new();

    for event in &sorted {
        match &event.operation {
            EditOperation::Rewrite { step_id, .. } | EditOperation::Revert { step_id, .. } => {
                last_text_edit.insert(step_id.clone(), event.sequence);
            }
            EditOperation::Insert { new_step_id, .. } => {
                last_text_edit.insert(new_step_id.clone(), event.sequence);
            }
            EditOperation::Split { into, .. } => {
                for (id, _) in into {
                    last_text_edit.insert(id.clone(), event.sequence);
                }
            }
            EditOperation::Merge { into_step_id, .. } => {
                last_text_edit.insert(into_step_id.clone(), event.sequence);
            }
            EditOperation::RedactionChange { frame_id, .. } => {
                last_redaction_change.insert(frame_id.clone(), event.sequence);
            }
            EditOperation::Delete { .. } | EditOperation::Reorder { .. } => {}
        }
    }

    let mut invalidated = std::collections::HashSet::new();
    for caption in captions {
        let latest_redaction_change = caption
            .source_frame_ids
            .iter()
            .filter_map(|frame_id| last_redaction_change.get(frame_id).copied())
            .max();
        if let Some(redaction_seq) = latest_redaction_change {
            let text_seq = last_text_edit.get(&caption.step_id).copied();
            let stale = match text_seq {
                Some(text_seq) => redaction_seq > text_seq,
                None => true,
            };
            if stale {
                invalidated.insert(caption.step_id.clone());
            }
        }
    }
    invalidated
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
                // No-op (never append) when `new_step_id` already exists,
                // OR when `after_step_id` is Some but names a step that
                // isn't in the current order — the documented contract
                // for an unknown reference is a no-op, not "append at
                // the end" (the previous bug: a dangling `after_step_id`
                // silently fell through to `unwrap_or(order.len())`).
                let after_target_known = match after_step_id {
                    Some(after) => order.contains(after),
                    None => true,
                };
                if !order.contains(new_step_id) && after_target_known {
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
                // Only accept a reorder that's an exact permutation of
                // the CURRENT step set: same length, no duplicate IDs
                // within `new_order` itself, and the same set of IDs —
                // comparing sets alone (the previous bug) let a
                // duplicate-containing list like `[s1, s1, s2]` pass for
                // `{s1, s2}` and silently drop a step.
                let mut dedup = std::collections::HashSet::new();
                let no_internal_duplicates = new_order.iter().all(|id| dedup.insert(id));
                let current: std::collections::HashSet<&String> = order.iter().collect();
                let proposed: std::collections::HashSet<&String> = new_order.iter().collect();
                if no_internal_duplicates && new_order.len() == order.len() && current == proposed {
                    order = new_order.clone();
                }
            }
            EditOperation::Split { step_id, into } => {
                // No-op the whole split when any produced ID collides
                // with another produced ID, or with an existing step ID
                // other than the one being replaced — the previous bug
                // let a split silently overwrite/merge with an unrelated
                // existing or duplicated step.
                let mut new_ids = std::collections::HashSet::new();
                let no_internal_duplicates = into.iter().all(|(id, _)| new_ids.insert(id.clone()));
                let no_collision_with_existing =
                    into.iter().all(|(id, _)| id == step_id || !order.contains(id));
                if let Some(pos) = order.iter().position(|s| s == step_id) {
                    if !into.is_empty() && no_internal_duplicates && no_collision_with_existing {
                        let replacement_ids: Vec<String> = into.iter().map(|(id, _)| id.clone()).collect();
                        order.splice(pos..=pos, replacement_ids.clone());
                        text.remove(step_id);
                        for (id, step_text) in into {
                            text.insert(id.clone(), step_text.clone());
                        }
                    }
                }
            }
            EditOperation::Merge { step_ids, into_step_id, text: merged_text } => {
                // Require every source ID to exist, be distinct, and be
                // consecutive in the current order, and the destination
                // ID to be collision-free (not an existing step other
                // than one of the sources) — the previous bug checked
                // only the first source ID's existence and nothing else,
                // so a merge naming a missing/duplicated/non-adjacent
                // source, or colliding with an unrelated existing step,
                // was silently accepted.
                let mut positions = Vec::with_capacity(step_ids.len());
                let mut seen = std::collections::HashSet::new();
                let mut all_known_and_distinct = !step_ids.is_empty();
                for id in step_ids {
                    if !seen.insert(id) {
                        all_known_and_distinct = false;
                        break;
                    }
                    match order.iter().position(|s| s == id) {
                        Some(pos) => positions.push(pos),
                        None => {
                            all_known_and_distinct = false;
                            break;
                        }
                    }
                }
                let consecutive = all_known_and_distinct && {
                    positions.sort_unstable();
                    positions.windows(2).all(|w| w[1] == w[0] + 1)
                };
                let destination_free = step_ids.contains(into_step_id) || !order.contains(into_step_id);
                if all_known_and_distinct && consecutive && destination_free {
                    let first_pos = positions[0];
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
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        let mut c1 = caption("s1", "a");
        c1.source_frame_ids = vec!["f1".to_string()];
        let mut c2 = caption("s1", "b");
        c2.source_frame_ids = vec!["f1".to_string()];
        s.captions.push(c1);
        s.captions.push(c2);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::DuplicateStepId { step_id: "s1".to_string() });
    }

    #[test]
    fn rejects_an_empty_frame_id() {
        let mut s = base_session();
        s.source_frames.push(frame("", SourceStorage::SessionEncrypted));
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::EmptyFrameId);
    }

    // --- per-frame structural validation: paths, digests, boxes ---

    fn candidate(id: &str, original: (i64, i64, u64, u64), expanded: (i64, i64, u64, u64), disposition: Disposition) -> RedactionCandidate {
        RedactionCandidate {
            candidate_id: id.to_string(),
            detector_id: "det-1".to_string(),
            reason_code: "EMAIL".to_string(),
            source_token_ids: vec!["tok-1".to_string()],
            original_box: original,
            expanded_box: expanded,
            score: Some(0.9),
            disposition,
            disposition_event_id: None,
        }
    }

    #[test]
    fn rejects_a_frame_source_path_that_escapes_the_session_root() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.source_relative_path = "../outside.png".to_string();
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidFrameSourcePath { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_malformed_raster_digest() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.raster_sha256 = "not-hex".to_string();
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidFrameDigest { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_provenance_sidecar_path_that_escapes_the_session_root() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.provenance_sidecar_relative_path = Some("../../outside.sidecar".to_string());
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidProvenancePath { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_malformed_redacted_derivative_digest() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.redacted_derivative_relative_path = Some("frames/f1-redacted.png".to_string());
        f.redacted_derivative_sha256 = Some("bad".to_string());
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidRedactedDerivativeDigest { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_zero_width_frame() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.width = 0;
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::ZeroFrameDimension { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_click_box_that_extends_past_the_frame_raster() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.click_box = Some((90, 90, 50, 50)); // frame is 100x100
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::InvalidClickBox { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_an_empty_candidate_id() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.redaction_candidates.push(candidate("", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending));
        s.source_frames.push(f);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::EmptyCandidateId { frame_id: "f1".to_string() });
    }

    #[test]
    fn rejects_a_duplicate_candidate_id_within_a_frame() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.redaction_candidates.push(candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending));
        f.redaction_candidates.push(candidate("c1", (20, 20, 10, 10), (16, 16, 18, 18), Disposition::Pending));
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::DuplicateCandidateId { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_a_candidate_box_that_extends_past_the_frame_raster() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        f.redaction_candidates.push(candidate("c1", (90, 90, 50, 50), (90, 90, 50, 50), Disposition::Pending));
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::InvalidCandidateBox { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_an_expanded_box_that_does_not_contain_the_original() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        // Expanded box is smaller than / offset from the original it
        // supposedly expands - must contain it, never shrink away.
        f.redaction_candidates.push(candidate("c1", (10, 10, 20, 20), (12, 12, 10, 10), Disposition::Pending));
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::ExpandedBoxDoesNotContainOriginal { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_a_candidate_score_outside_zero_to_one() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending);
        c.score = Some(1.5);
        f.redaction_candidates.push(c);
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::InvalidCandidateScore { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_empty_source_token_ids_on_a_candidate() {
        let mut s = base_session();
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending);
        c.source_token_ids = vec![];
        f.redaction_candidates.push(c);
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::EmptySourceTokenIds { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn allows_empty_source_token_ids_on_a_named_structural_evidence_candidate() {
        // C691-002: a UIA password-field or image-only input-rectangle
        // candidate has no OCR step at all, so it can never carry
        // source token ids - that must not be conflated with the real
        // bug `rejects_empty_source_token_ids_on_a_candidate` guards
        // against (a token-bound detector that lost its tokens).
        for detector_id in ["det.uia_password_field", "det.image_rect_input_field"] {
            let mut s = base_session();
            let mut f = frame("f1", SourceStorage::SessionEncrypted);
            let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending);
            c.detector_id = detector_id.to_string();
            c.source_token_ids = vec![];
            f.redaction_candidates.push(c);
            s.source_frames.push(f);
            assert!(validate_session(&s).is_ok(), "{detector_id}: {:?}", validate_session(&s));
        }
    }

    // --- caption-to-frame cross-reference ---

    #[test]
    fn rejects_a_caption_with_no_source_frame_ids() {
        let mut s = base_session();
        s.captions.push(caption("s1", "A"));
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::EmptyCaptionSourceFrameIds { step_id: "s1".to_string() });
    }

    #[test]
    fn rejects_a_caption_referencing_an_unknown_frame() {
        let mut s = base_session();
        let mut c = caption("s1", "A");
        c.source_frame_ids = vec!["ghost-frame".to_string()];
        s.captions.push(c);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::UnknownCaptionSourceFrame { step_id: "s1".to_string(), frame_id: "ghost-frame".to_string() }
        );
    }

    #[test]
    fn rejects_a_caption_whose_suggestion_digest_does_not_match_its_text() {
        let mut s = base_session();
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        let mut c = caption("s1", "A");
        c.source_frame_ids = vec!["f1".to_string()];
        c.suggestion_digest = "a".repeat(64);
        s.captions.push(c);
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::CaptionSuggestionDigestMismatch { step_id: "s1".to_string() });
    }

    // --- review/export state machine: derived, not self-asserted ---

    fn verified_frame(id: &str) -> SourceFrame {
        let mut f = frame(id, SourceStorage::SessionEncrypted);
        f.verification = FrameVerification::Verified;
        f
    }

    fn valid_caption_for(step_id: &str, frame_id: &str, text: &str) -> CaptionDraft {
        let mut c = caption(step_id, text);
        c.source_frame_ids = vec![frame_id.to_string()];
        c
    }

    #[test]
    fn rejects_a_verified_frame_with_an_unresolved_pending_candidate() {
        let mut s = base_session();
        let mut f = verified_frame("f1");
        f.redaction_candidates.push(candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Pending));
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::UnresolvedCandidateOnVerifiedFrame { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn accepts_a_verified_frame_whose_candidates_are_all_resolved() {
        let mut s = base_session();
        let mut f = verified_frame("f1");
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        // C2P1-RR-002: a resolved disposition on a Verified frame now
        // requires proof - an actual user-authenticated RedactionChange
        // event (disposition_event_id) and, since this candidate is
        // Redact, a recorded derivative.
        c.disposition_event_id = Some("ev-0".to_string());
        f.redaction_candidates.push(c);
        f.redacted_derivative_relative_path = Some("derivatives/f1.png".to_string());
        f.redacted_derivative_sha256 = Some("c".repeat(64));
        s.source_frames.push(f);
        let redaction_event = event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None });
        s.edit_events = with_correct_digests(&s.captions, vec![redaction_event]);
        s.revision = 1;
        assert!(validate_session(&s).is_ok(), "{:?}", validate_session(&s));
    }

    #[test]
    fn rejects_a_verified_frame_whose_resolved_candidate_has_no_disposition_evidence() {
        // Pre-populated disposition (Redact) with NO disposition_event_id
        // at all - exactly the C2P1-RR-002 hole: could have been set
        // directly in the document rather than by a real user action.
        let mut s = base_session();
        let mut f = verified_frame("f1");
        f.redaction_candidates.push(candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact));
        f.redacted_derivative_relative_path = Some("derivatives/f1.png".to_string());
        f.redacted_derivative_sha256 = Some("c".repeat(64));
        s.source_frames.push(f);
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::MissingDispositionEvidence { frame_id: "f1".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn rejects_a_verified_frame_with_a_redacted_candidate_but_no_recorded_derivative() {
        let mut s = base_session();
        let mut f = verified_frame("f1");
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        c.disposition_event_id = Some("ev-0".to_string());
        f.redaction_candidates.push(c);
        // Deliberately no redacted_derivative_relative_path/sha256.
        s.source_frames.push(f);
        let redaction_event = event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None });
        s.edit_events = with_correct_digests(&s.captions, vec![redaction_event]);
        s.revision = 1;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::MissingRedactedDerivativeOnVerifiedFrame { frame_id: "f1".to_string() }
        );
    }

    #[test]
    fn rejects_a_session_claiming_verified_while_a_frame_is_still_pending() {
        let mut s = base_session();
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted)); // defaults to Pending
        s.review_state = ReviewState::Verified;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::SessionVerifiedWithUnverifiedFrame { frame_id: "f1".to_string() }
        );
    }

    #[test]
    fn rejects_a_session_claiming_export_eligible_without_verified_review() {
        let mut s = base_session();
        s.review_state = ReviewState::InProgress;
        s.export_eligible = true;
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::ExportEligibleWithoutVerifiedReview);
    }

    #[test]
    fn rejects_a_session_claiming_export_eligible_without_a_review_receipt() {
        let mut s = base_session();
        s.source_frames.push(verified_frame("f1")); // no candidates, so no disposition/derivative check fires
        s.review_state = ReviewState::Verified;
        s.export_eligible = true;
        s.review_receipt = None;
        // C2P1-RR-002: a receipt is now required for VERIFIED itself
        // (checked before export_eligible is even reached), not only when
        // also claiming export_eligible.
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::VerifiedWithoutReviewReceipt);
    }

    #[test]
    fn rejects_a_session_claiming_verified_with_a_caption_invalidated_by_a_later_redaction_change() {
        let mut s = base_session();
        let mut f = verified_frame("f1");
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        c.disposition_event_id = Some("ev-0".to_string());
        f.redaction_candidates.push(c);
        f.redacted_derivative_relative_path = Some("derivatives/f1.png".to_string());
        f.redacted_derivative_sha256 = Some("c".repeat(64));
        s.source_frames.push(f);
        s.captions.push(valid_caption_for("s1", "f1", "Click Save"));
        // The redaction mask changed (sequence 0) after the caption was
        // generated, and nothing re-affirmed the caption's text since.
        let redaction_event = event(0, EditOperation::RedactionChange {
            frame_id: "f1".to_string(),
            candidate_id: "c1".to_string(),
            disposition: Disposition::Redact,
            authority: None,
        });
        s.edit_events = with_correct_digests(&s.captions, vec![redaction_event]);
        s.revision = 1;
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-1".to_string());
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::VerifiedWithInvalidatedCaption { step_id: "s1".to_string() });
    }

    #[test]
    fn accepts_a_fully_valid_verified_exportable_session_end_to_end() {
        let mut s = base_session();
        let mut f = verified_frame("f1");
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        c.disposition_event_id = Some("ev-0".to_string());
        f.redaction_candidates.push(c);
        f.redacted_derivative_relative_path = Some("derivatives/f1.png".to_string());
        f.redacted_derivative_sha256 = Some("c".repeat(64));
        s.source_frames.push(f);
        s.captions.push(valid_caption_for("s1", "f1", "Click Save"));
        // A rewrite AFTER the redaction change re-affirms the caption, so
        // it is no longer treated as invalidated.
        let events = vec![
            event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None }),
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Click Save (reviewed)".to_string() }),
        ];
        s.edit_events = with_correct_digests(&s.captions, events);
        s.revision = 2;
        s.review_state = ReviewState::Verified;
        s.review_receipt = Some("receipt-digest-bound-to-derivatives".to_string());
        s.export_eligible = true;
        assert!(validate_session(&s).is_ok(), "{:?}", validate_session(&s));
    }

    #[test]
    fn rejects_a_session_with_an_unsupported_sidecar_protocol_version() {
        let mut s = base_session();
        s.sidecar_protocol_version = crate::sop_ipc::SIDECAR_PROTOCOL_VERSION + 1;
        assert_eq!(
            validate_session(&s).unwrap_err(),
            SessionError::UnsupportedSidecarProtocolVersion {
                found: crate::sop_ipc::SIDECAR_PROTOCOL_VERSION + 1,
                max_supported: crate::sop_ipc::SIDECAR_PROTOCOL_VERSION,
            }
        );
    }

    #[test]
    fn rejects_schema_version_zero_without_misparsing_it() {
        let mut s = base_session();
        s.schema_version = 0;
        assert_eq!(validate_session(&s).unwrap_err(), SessionError::UnsupportedSchemaVersion { found: 0, max_supported: SOP_SESSION_SCHEMA_VERSION });
    }

    // --- append-only edit chain validation (write-time gate) ---

    fn session_with_captions(step_ids: &[&str]) -> SopSessionV1 {
        let mut s = base_session();
        for id in step_ids {
            s.captions.push(caption(id, "text"));
        }
        s
    }

    #[test]
    fn edit_chain_accepts_a_single_well_formed_event() {
        let mut s = session_with_captions(&["s1"]);
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() })];
        s.edit_events = with_correct_digests(&s.captions, events);
        s.revision = 1;
        assert!(validate_edit_chain(&s).is_ok(), "{:?}", validate_edit_chain(&s));
    }

    #[test]
    fn edit_chain_rejects_a_duplicate_event_id() {
        let mut s = session_with_captions(&["s1"]);
        let mut e0 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() });
        let mut e1 = event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() });
        e1.event_id = e0.event_id.clone();
        e0.session_revision_before = 0;
        e0.session_revision_after = 1;
        e1.session_revision_before = 1;
        e1.session_revision_after = 2;
        s.edit_events.push(e0.clone());
        s.edit_events.push(e1);
        s.revision = 2;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DuplicateEventId { event_id: e0.event_id });
    }

    #[test]
    fn edit_chain_rejects_a_duplicate_sequence() {
        let mut s = session_with_captions(&["s1"]);
        s.edit_events.push(event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() }));
        let mut e1 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() });
        e1.event_id = "ev-dup-seq".to_string();
        s.edit_events.push(e1);
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DuplicateSequence { sequence: 0 });
    }

    #[test]
    fn edit_chain_rejects_a_gap_in_sequence() {
        let mut s = session_with_captions(&["s1"]);
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() }),
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() }),
        ];
        let mut events = with_correct_digests(&s.captions, events);
        events[1].sequence = 2; // gap: should be 1
        events[1].session_revision_before = 1;
        events[1].session_revision_after = 2;
        s.edit_events = events;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::NonContiguousSequence { expected: 1, found: 2 });
    }

    #[test]
    fn edit_chain_rejects_a_revision_that_does_not_increment_by_one() {
        let mut s = session_with_captions(&["s1"]);
        let mut e0 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() });
        e0.session_revision_after = 5;
        let event_id = e0.event_id.clone();
        s.edit_events.push(e0);
        assert_eq!(
            validate_edit_chain(&s).unwrap_err(),
            EditChainError::RevisionNotIncrementing { event_id, before: 0, after: 5 }
        );
    }

    #[test]
    fn edit_chain_rejects_a_broken_revision_chain_between_events() {
        let mut s = session_with_captions(&["s1"]);
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() }),
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() }),
        ];
        let mut events = with_correct_digests(&s.captions, events);
        events[1].session_revision_before = 9; // should be 1 (event 0's after)
        events[1].session_revision_after = 10;
        let event_id = events[1].event_id.clone();
        s.edit_events = events;
        assert_eq!(
            validate_edit_chain(&s).unwrap_err(),
            EditChainError::RevisionChainBroken { event_id, expected_before: 1, found_before: 9 }
        );
    }

    #[test]
    fn edit_chain_rejects_a_broken_digest_chain_between_events() {
        // Both events individually correct (genesis-anchored, content-
        // authentic) via with_correct_digests - then deliberately break
        // ONLY the neighbor link (e1's before_digest no longer matches
        // e0's real after_digest), isolating DigestChainBroken from the
        // separate AfterDigestDoesNotMatchReplayedState check.
        let mut s = session_with_captions(&["s1"]);
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() }),
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "b".to_string() }),
        ];
        let mut events = with_correct_digests(&s.captions, events);
        events[1].before_digest = Some("deliberately-wrong-but-present-digest".to_string());
        let event_id = events[1].event_id.clone();
        s.edit_events = events;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DigestChainBroken { event_id });
    }

    #[test]
    fn edit_chain_rejects_an_after_digest_that_does_not_match_the_actual_replayed_content() {
        // The event's before_digest correctly chains, but its claimed
        // after_digest is a forgery that doesn't match what replaying the
        // chain actually produces - must be caught distinctly from a
        // neighbor-link break.
        let mut s = session_with_captions(&["s1"]);
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() })];
        let mut events = with_correct_digests(&s.captions, events);
        events[0].after_digest = Some("forged-digest-not-matching-real-content".to_string());
        let event_id = events[0].event_id.clone();
        s.edit_events = events;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::AfterDigestDoesNotMatchReplayedState { event_id });
    }

    #[test]
    fn edit_chain_rejects_a_chain_not_starting_at_genesis_revision() {
        let mut s = session_with_captions(&["s1"]);
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() })];
        let mut events = with_correct_digests(&s.captions, events);
        events[0].session_revision_before = 99;
        events[0].session_revision_after = 100;
        s.edit_events = events;
        s.revision = 100;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::ChainDoesNotStartAtGenesisRevision { found: 99 });
    }

    #[test]
    fn edit_chain_rejects_an_empty_log_with_a_nonzero_session_revision() {
        let mut s = session_with_captions(&["s1"]);
        s.revision = 5;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::NonZeroRevisionWithEmptyChain { session_revision: 5 });
    }

    #[test]
    fn edit_chain_accepts_an_empty_log_with_revision_zero() {
        let s = session_with_captions(&["s1"]);
        assert!(validate_edit_chain(&s).is_ok());
    }

    #[test]
    fn edit_chain_rejects_a_missing_digest_on_an_event() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() }); // digests still None
        let event_id = e0.event_id.clone();
        s.edit_events.push(e0);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::MissingDigestLink { event_id });
    }

    #[test]
    fn edit_chain_rejects_a_final_revision_that_does_not_match_the_session_revision() {
        let mut s = session_with_captions(&["s1"]);
        let events = vec![event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "a".to_string() })];
        s.edit_events = with_correct_digests(&s.captions, events);
        s.revision = 99;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::FinalRevisionMismatch { chain_end: 1, session_revision: 99 });
    }

    #[test]
    fn edit_chain_rejects_a_rewrite_targeting_an_unknown_step() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Rewrite { step_id: "ghost".to_string(), new_text: "a".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownRewriteTarget { event_id, step_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_an_insert_whose_after_step_id_is_unknown() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Insert { after_step_id: Some("ghost".to_string()), new_step_id: "s2".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(
            validate_edit_chain(&s).unwrap_err(),
            EditChainError::UnknownInsertAfterTarget { event_id, after_step_id: "ghost".to_string() }
        );
    }

    #[test]
    fn edit_chain_rejects_an_insert_whose_new_step_id_already_exists() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Insert { after_step_id: None, new_step_id: "s1".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DuplicateInsertStepId { event_id, step_id: "s1".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_reorder_with_an_internal_duplicate() {
        let mut s = session_with_captions(&["s1", "s2"]);
        let e0 = event(0, EditOperation::Reorder { new_order: vec!["s1".to_string(), "s1".to_string()] });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::InvalidReorderPermutation { event_id });
    }

    #[test]
    fn edit_chain_rejects_a_split_targeting_an_unknown_step() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Split { step_id: "ghost".to_string(), into: vec![("a".to_string(), "x".to_string())] });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownSplitTarget { event_id, step_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_split_whose_produced_ids_collide_with_an_existing_step() {
        let mut s = session_with_captions(&["s1", "s2"]);
        let e0 = event(0, EditOperation::Split { step_id: "s1".to_string(), into: vec![("s2".to_string(), "x".to_string())] });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::SplitIdCollision { event_id, step_id: "s2".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_split_with_duplicate_produced_ids() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Split {
            step_id: "s1".to_string(),
            into: vec![("a".to_string(), "x".to_string()), ("a".to_string(), "y".to_string())],
        });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DuplicateSplitIds { event_id });
    }

    #[test]
    fn edit_chain_rejects_a_merge_with_a_missing_source() {
        let mut s = session_with_captions(&["s1", "s2"]);
        let e0 = event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "ghost".to_string()], into_step_id: "s1-2".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownMergeSource { event_id, step_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_merge_with_a_duplicate_source() {
        let mut s = session_with_captions(&["s1", "s2"]);
        let e0 = event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "s1".to_string()], into_step_id: "s1-2".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::DuplicateMergeSource { event_id, step_id: "s1".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_merge_of_non_consecutive_sources() {
        let mut s = session_with_captions(&["s1", "s2", "s3"]);
        let e0 = event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "s3".to_string()], into_step_id: "s1-3".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::NonConsecutiveMergeSources { event_id });
    }

    #[test]
    fn edit_chain_rejects_a_merge_destination_colliding_with_an_unrelated_step() {
        let mut s = session_with_captions(&["s1", "s2", "s3"]);
        let e0 = event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "s2".to_string()], into_step_id: "s3".to_string(), text: "x".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::MergeDestinationCollision { event_id, step_id: "s3".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_redaction_change_on_an_unknown_frame() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::RedactionChange { frame_id: "ghost".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownRedactionChangeFrame { event_id, frame_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_redaction_change_on_an_unknown_candidate() {
        let mut s = session_with_captions(&["s1"]);
        s.source_frames.push(frame("f1", SourceStorage::SessionEncrypted));
        let e0 = event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "ghost".to_string(), disposition: Disposition::Redact, authority: None });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownRedactionChangeCandidate { event_id, candidate_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_revert_targeting_an_unknown_step() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Revert { step_id: "ghost".to_string() });
        let event_id = e0.event_id.clone();
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s).unwrap_err(), EditChainError::UnknownRevertTarget { event_id, step_id: "ghost".to_string() });
    }

    #[test]
    fn edit_chain_rejects_a_disposition_event_id_not_bound_to_a_matching_redaction_change() {
        let mut s = session_with_captions(&["s1"]);
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        c.disposition_event_id = Some("ev-never-happened".to_string());
        f.redaction_candidates.push(c);
        s.source_frames.push(f);
        assert_eq!(
            validate_edit_chain(&s).unwrap_err(),
            EditChainError::UnknownRedactionChangeCandidate { event_id: "ev-never-happened".to_string(), candidate_id: "c1".to_string() }
        );
    }

    #[test]
    fn edit_chain_accepts_a_disposition_event_id_bound_to_a_matching_redaction_change() {
        let mut s = session_with_captions(&["s1"]);
        let mut f = frame("f1", SourceStorage::SessionEncrypted);
        let mut c = candidate("c1", (0, 0, 10, 10), (0, 0, 14, 14), Disposition::Redact);
        c.disposition_event_id = Some("ev-0".to_string());
        f.redaction_candidates.push(c);
        s.source_frames.push(f);
        let redaction_event = event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None });
        s.edit_events = with_correct_digests(&s.captions, vec![redaction_event]);
        s.revision = 1;
        assert!(validate_edit_chain(&s).is_ok(), "{:?}", validate_edit_chain(&s));
    }

    #[test]
    fn replaying_the_same_valid_log_twice_yields_identical_projection() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "A edited".to_string() }),
            event(1, EditOperation::Insert { after_step_id: Some("s1".to_string()), new_step_id: "s1b".to_string(), text: "inserted".to_string() }),
        ];
        let first = project_steps(&captions, &events);
        let second = project_steps(&captions, &events);
        assert_eq!(first, second);
    }

    #[test]
    fn validating_the_same_valid_chain_twice_yields_the_same_result() {
        let mut s = session_with_captions(&["s1"]);
        let e0 = event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "x".to_string() });
        s.edit_events = with_correct_digests(&s.captions, vec![e0]);
        s.revision = 1;
        assert_eq!(validate_edit_chain(&s), validate_edit_chain(&s));
        assert!(validate_edit_chain(&s).is_ok());
    }

    // --- project_steps (read-time, permissive) bug-fix regressions ---

    #[test]
    fn project_steps_insert_with_an_unknown_after_step_id_is_a_total_no_op() {
        let captions = vec![caption("s1", "A")];
        let events = vec![event(0, EditOperation::Insert { after_step_id: Some("ghost".to_string()), new_step_id: "s2".to_string(), text: "B".to_string() })];
        let projected = project_steps(&captions, &events);
        // Previously this fell through to appending at the end instead
        // of being a no-op.
        assert_eq!(projected, vec![("s1".to_string(), "A".to_string())]);
    }

    #[test]
    fn project_steps_reorder_with_a_duplicate_entry_is_ignored() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Reorder { new_order: vec!["s1".to_string(), "s1".to_string()] })];
        let projected = project_steps(&captions, &events);
        // Previously a set-based comparison let `[s1, s1]` pass for
        // `{s1, s2}` and silently dropped s2.
        assert_eq!(projected.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(), vec!["s1", "s2"]);
    }

    #[test]
    fn project_steps_split_colliding_with_an_existing_step_is_a_total_no_op() {
        let captions = vec![caption("s1", "A"), caption("s2", "B")];
        let events = vec![event(0, EditOperation::Split { step_id: "s1".to_string(), into: vec![("s2".to_string(), "x".to_string())] })];
        let projected = project_steps(&captions, &events);
        assert_eq!(projected, vec![("s1".to_string(), "A".to_string()), ("s2".to_string(), "B".to_string())]);
    }

    #[test]
    fn project_steps_merge_of_non_consecutive_sources_is_a_total_no_op() {
        let captions = vec![caption("s1", "A"), caption("s2", "B"), caption("s3", "C")];
        let events = vec![event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "s3".to_string()], into_step_id: "s1-3".to_string(), text: "merged".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(
            projected,
            vec![("s1".to_string(), "A".to_string()), ("s2".to_string(), "B".to_string()), ("s3".to_string(), "C".to_string())]
        );
    }

    #[test]
    fn project_steps_merge_destination_colliding_with_an_unrelated_step_is_a_total_no_op() {
        let captions = vec![caption("s1", "A"), caption("s2", "B"), caption("s3", "C")];
        let events = vec![event(0, EditOperation::Merge { step_ids: vec!["s1".to_string(), "s2".to_string()], into_step_id: "s3".to_string(), text: "merged".to_string() })];
        let projected = project_steps(&captions, &events);
        assert_eq!(
            projected,
            vec![("s1".to_string(), "A".to_string()), ("s2".to_string(), "B".to_string()), ("s3".to_string(), "C".to_string())]
        );
    }

    // --- redaction-invalidation of captions ---

    #[test]
    fn a_redaction_change_invalidates_the_caption_bound_to_that_frame() {
        let captions = vec![valid_caption_for("s1", "f1", "Click Save")];
        let events = vec![event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None })];
        let invalidated = invalidated_step_ids(&captions, &events);
        assert!(invalidated.contains("s1"));
    }

    #[test]
    fn a_rewrite_after_a_redaction_change_un_invalidates_the_caption() {
        let captions = vec![valid_caption_for("s1", "f1", "Click Save")];
        let events = vec![
            event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None }),
            event(1, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Click the Save button".to_string() }),
        ];
        let invalidated = invalidated_step_ids(&captions, &events);
        assert!(!invalidated.contains("s1"));
    }

    #[test]
    fn a_redaction_change_after_a_rewrite_still_invalidates_the_caption() {
        let captions = vec![valid_caption_for("s1", "f1", "Click Save")];
        let events = vec![
            event(0, EditOperation::Rewrite { step_id: "s1".to_string(), new_text: "Click the Save button".to_string() }),
            event(1, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None }),
        ];
        let invalidated = invalidated_step_ids(&captions, &events);
        assert!(invalidated.contains("s1"));
    }

    #[test]
    fn a_caption_bound_to_an_untouched_frame_is_never_invalidated() {
        let captions = vec![valid_caption_for("s1", "f1", "Click Save")];
        let events = vec![event(0, EditOperation::RedactionChange { frame_id: "f2".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None })];
        let invalidated = invalidated_step_ids(&captions, &events);
        assert!(invalidated.is_empty());
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

    /// C2P1-RR-003 fix-round helper: fills in real, correctly-chained
    /// `before_digest`/`after_digest` values for a sequence of events
    /// (sorted by `sequence`), by actually replaying them against
    /// `captions` the same way `validate_edit_chain` itself does. Lets
    /// edit-chain tests built around `event()` (which leaves digests
    /// `None`) keep testing exactly the ONE structural defect each is
    /// about, without each test having to hand-compute real digests.
    /// Tests that are specifically ABOUT digest correctness build their
    /// fixture through this helper too, then deliberately corrupt one
    /// digest field afterward.
    fn with_correct_digests(captions: &[CaptionDraft], mut events: Vec<EditEvent>) -> Vec<EditEvent> {
        events.sort_by_key(|e| e.sequence);
        let mut applied: Vec<EditEvent> = Vec::new();
        let mut running = canonical_state_digest(&project_steps(captions, &[]));
        for event in &mut events {
            event.before_digest = Some(running.clone());
            applied.push(event.clone());
            running = canonical_state_digest(&project_steps(captions, &applied));
            event.after_digest = Some(running.clone());
            applied.last_mut().unwrap().after_digest = Some(running.clone());
        }
        events
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
        let events = vec![event(0, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact, authority: None })];
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
