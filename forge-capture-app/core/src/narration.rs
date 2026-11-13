//! Narration-over-capture job contract — Phase 3 Slice A.
//!
//! Consent-gated local narration pipeline: a presenter clones their own
//! voice (OpenVoice V2, local iBUYPOWER GPU) to narrate a recorded
//! capture. No generated face, no cloud, no paid service in this slice.
//!
//! Same honest, local-first design as [`crate::ai_edit`] and
//! [`crate::meeting`]: this module owns the pure half of the contract —
//! consent receipts and their preflight gate, voice enrollment, the
//! narration script, deterministic job ids, render manifests, acceptance
//! receipts, and the revocation transaction. The local runner (documented
//! in the Phase 3 scope brief) performs the TTS generation and the FFmpeg
//! assembly; the Tauri shell owns the OS boundary and resolves the
//! narration root. This module also owns the two filesystem-bound,
//! fail-closed operations the Tauri commands wrap thinly — the revocation
//! transaction ([`execute_revocation`]) and the acceptance output
//! verification ([`verify_acceptance_output`]) — which operate on
//! `std::fs` paths under the narration root so their fault-injection
//! behaviour is testable in this crate. Nothing here touches the network
//! or a voice sample.
//!
//! Field names are contractual: the Python runner and the UI depend on
//! them exactly as written. Do not rename a field without updating both.
//!
//! Job status resolution reuses [`crate::ai_edit::status_from_presence`];
//! it is not reinvented here (see [`narration_status_from_presence`]).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

/// Spool subdirectory for narration jobs.
pub const NARRATION_DIR: &str = "narration";
/// Job-type discriminator written into every narration manifest.
pub const JOB_TYPE_NARRATE: &str = "narrate";

/// Pinned first local voice-cloning model (OpenVoice V2).
pub const MODEL_ID_OPENVOICE_V2: &str = "openvoice-v2";
/// Pinned OpenVoice V2 checkpoint bundle.
pub const MODEL_VERSION_V2: &str = "checkpoints_v2_0417";
/// Pinned OpenVoice source commit.
pub const OPENVOICE_CODE_COMMIT: &str = "74a1d147b17a8c3092dd5430504bd83ef6c7eb23";
/// Pinned MeloTTS (OpenVoice base TTS) source commit.
pub const MELOTTS_CODE_COMMIT: &str = "209145371cff8fc3bd60d7be902ea69cbdb7965a";
/// SHA-256 of the checkpoints zip.
///
/// The deterministic zip built from the official Hugging Face repos
/// (`myshell-ai/OpenVoice`, revision
/// `c70fc8b939bd1d8213994ff7c88e32be39708271`, for the nine files of
/// the `checkpoints/` tree; `myshell-ai/OpenVoiceV2`, revision
/// `f36e7edfe1684461a8343844af60babc2efbb727`, for the six English
/// `base_speakers/ses/` embeddings the V2 generation path loads) by
/// `narration-sidecar/build_checkpoints_zip.py`: the fifteen files
/// packed as `checkpoints_v2/...` with fixed timestamps, permissions,
/// and order. The upstream S3 zip this used to come from is gone
/// (bucket deleted); the setup script rebuilds the same bytes, so the
/// receipt's `checkpoints_v2_zip_sha256` equals this value. Any
/// receipt carrying a different value is not this pinned weights set.
pub const CHECKPOINTS_ZIP_SHA256: &str =
    "cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020";

/// Hard cap on narration segments accepted in one script.
pub const MAX_SEGMENTS: usize = 1000;
/// Hard cap on a single narration segment's text (chars).
pub const MAX_SEGMENT_TEXT_CHARS: usize = 5000;

/// True when `s` is exactly 64 lowercase hex characters (a SHA-256 digest).
pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64
        && s.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// One immutable audit event on a consent receipt or revocation receipt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConsentAuditEvent {
    pub event: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub at: String,
    pub by: String,
    pub detail: String,
}

/// A presenter's self-recorded consent, reviewed and versioned.
///
/// A filename or checkbox is not consent: the referenced self-recorded
/// statement must be readable and its hash must match
/// `artifact_sha256`. A typed consent check runs immediately before
/// enrollment and immediately before every generation job; a queued job
/// is rechecked at start.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConsentReceipt {
    pub version: u32,
    pub presenter_id: String,
    pub display_name: String,
    pub consent_artifact_path: String,
    pub artifact_sha256: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub recorded_at: String,
    pub reviewed_by: String,
    /// e.g. `["voice"]`, optionally also `"face"` (face is out of Slice A).
    pub scope: Vec<String>,
    /// `"active"` or `"revoked"`.
    pub status: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub granted_at: String,
    pub revoked_at: Option<String>,
    pub revoke_reason: Option<String>,
    pub audit_events: Vec<ConsentAuditEvent>,
}

/// A presenter's enrolled voice: derived assets + pinned model receipt.
///
/// It contains no reusable global "voice id" visible to unrelated users.
/// Access is limited to the presenter and specifically authorized
/// workspace administrators. Enrollment is zero-shot from a cleaned
/// reference segment in Slice A; no durable personalized model is trained.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoiceEnrollment {
    pub version: u32,
    pub presenter_id: String,
    pub consent_receipt_version: u32,
    pub consent_artifact_sha256: String,
    pub model_id: String,
    pub model_version: String,
    pub model_code_commit: String,
    pub weights_sha256: String,
    pub reference_audio_sha256: String,
    pub preprocessing_version: String,
    pub speaker_embedding_path: Option<String>,
    pub reference_clip_path: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub created_at: String,
    pub last_used_at: Option<String>,
    /// e.g. `"active"`, `"revoked"`.
    pub status: String,
}

/// One narrated step: stable step id bound to text, source evidence,
/// and the capture interval it speaks over.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NarrationSegment {
    pub step_id: String,
    pub text: String,
    pub source_evidence: String,
    pub capture_start_sec: f64,
    pub capture_end_sec: f64,
    pub audio_hash: Option<String>,
    pub correction: Option<String>,
}

/// A versioned narration script: segments plus the capture it narrates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NarrationScript {
    pub version: u32,
    pub job_id: String,
    pub presenter_id: String,
    pub capture_duration_sec: f64,
    pub segments: Vec<NarrationSegment>,
}

/// The `job.json` manifest written with every spooled narration job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NarrationJobManifest {
    pub version: u32,
    pub job_id: String,
    pub job_type: String,
    pub presenter_id: String,
    pub consent_receipt_version: u32,
    pub capture_file: String,
    pub capture_path: String,
    pub capture_sha256: String,
    pub model_id: String,
    pub model_version: String,
    pub script_sha256: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub created_at: String,
    pub status: String,
}

/// One TTS segment result: the generated per-step WAV and its timing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NarrationSegmentResult {
    pub step_id: String,
    pub audio_file: String,
    pub audio_sha256: String,
    pub duration_sec: f64,
    pub real_time_factor: f64,
}

/// The FFmpeg timeline-assembly result for a narration job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NarrationRenderResult {
    pub output_file: String,
    pub output_sha256: String,
    pub output_bytes: u64,
    pub ffmpeg_version: String,
    pub ffmpeg_command: String,
    pub captions_file: String,
    pub render_sec: f64,
}

/// Pinned model/license receipt attached to a narration result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NarrationModelReceipt {
    pub model_id: String,
    pub model_version: String,
    pub code_commit: String,
    pub weights_sha256: String,
    pub base_tts: String,
    pub base_tts_commit: String,
}

/// Measured local resource usage for a narration job (local-first proof).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NarrationResources {
    pub peak_vram_mib: Option<u64>,
    pub peak_ram_mib: Option<u64>,
    pub gpu: String,
}

/// A narration job's `result.json`: segments, render, resources, and the
/// local-first proof that no outbound model/voice/avatar request was made.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NarrationResult {
    pub version: u32,
    pub job_id: String,
    pub status: String,
    pub failure_reason: Option<String>,
    pub segments: Vec<NarrationSegmentResult>,
    pub render: Option<NarrationRenderResult>,
    pub resources: NarrationResources,
    pub outbound_requests: Vec<String>,
    pub model: NarrationModelReceipt,
    pub consent_receipt_version: u32,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub completed_at: String,
}

/// Provenance sidecar for a render: every input and model hash, the exact
/// FFmpeg invocation, the consent receipt version, and the output hash.
/// No evidence means no PASS.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderManifest {
    pub version: u32,
    pub job_id: String,
    pub input_hashes: BTreeMap<String, String>,
    pub model_hashes: BTreeMap<String, String>,
    pub ffmpeg_version: String,
    pub ffmpeg_command: String,
    pub consent_receipt_version: u32,
    pub output_hash: String,
    pub caption_path: String,
    pub acceptance_receipt: Option<String>,
    /// Path of the acceptance receipt artifact, relative to the job
    /// directory (`"acceptance.json"` once a human decision is recorded).
    /// `None` on manifests written before acceptance; old manifests
    /// without this field still parse.
    #[serde(default)]
    pub acceptance_receipt_path: Option<String>,
}

/// Human acceptance: presenter and reviewer decisions bound to the exact
/// output hash. A developer assertion is not evidence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptanceReceipt {
    pub version: u32,
    pub job_id: String,
    pub output_sha256: String,
    /// `"approved"` (or anything else = not approved).
    pub presenter_decision: String,
    pub presenter_by: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub presenter_at: String,
    pub reviewer_decision: String,
    pub reviewer_by: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub reviewer_at: String,
    pub notes: String,
    /// `"PASS"` or `"FAIL"` (see [`acceptance_verdict`]).
    pub verdict: String,
}

/// The immutable receipt left by a consent revocation transaction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevocationReceipt {
    pub version: u32,
    pub presenter_id: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub revoked_at: String,
    pub reason: String,
    pub deleted_assets: Vec<String>,
    pub blocked_jobs: Vec<String>,
    pub unpublished_outputs: Vec<String>,
    pub audit_events: Vec<ConsentAuditEvent>,
}

/// A managed generated output in the (opt-in) library, tracked so
/// revocation can unpublish it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagedOutputRecord {
    pub job_id: String,
    pub presenter_id: String,
    pub output_file: String,
    pub output_sha256: String,
    /// e.g. `"active"`, `"consent_revoked"`.
    pub status: String,
    pub published_at: Option<String>,
    pub saved_to_forge: bool,
}

/// Validate a consent receipt's shape and internal consistency.
///
/// Checks: `version == 1`; non-empty `presenter_id`, `display_name`, and
/// `consent_artifact_path`; `artifact_sha256` is 64 lowercase hex;
/// non-empty `recorded_at` and `granted_at`; `scope` contains `"voice"`;
/// `status` is `"active"` or `"revoked"`; a revoked receipt requires
/// `revoked_at` and `revoke_reason`, an active one requires both to be
/// `None`; `audit_events` is non-empty.
pub fn validate_consent_receipt(receipt: &ConsentReceipt) -> Result<(), &'static str> {
    if receipt.version != 1 {
        return Err("consent receipt version must be 1");
    }
    if receipt.presenter_id.trim().is_empty() {
        return Err("consent receipt presenter_id is empty");
    }
    if receipt.display_name.trim().is_empty() {
        return Err("consent receipt display_name is empty");
    }
    if receipt.consent_artifact_path.trim().is_empty() {
        return Err("consent receipt consent_artifact_path is empty");
    }
    if !is_sha256_hex(&receipt.artifact_sha256) {
        return Err("consent receipt artifact_sha256 must be 64 lowercase hex characters");
    }
    if receipt.recorded_at.trim().is_empty() {
        return Err("consent receipt recorded_at is empty");
    }
    if receipt.granted_at.trim().is_empty() {
        return Err("consent receipt granted_at is empty");
    }
    if !receipt.scope.iter().any(|s| s == "voice") {
        return Err("consent receipt scope must contain \"voice\"");
    }
    match receipt.status.as_str() {
        "active" => {
            if receipt.revoked_at.is_some() || receipt.revoke_reason.is_some() {
                return Err("active consent receipt must have no revoked_at or revoke_reason");
            }
        }
        "revoked" => {
            if receipt.revoked_at.as_ref().is_none_or(|s| s.trim().is_empty()) {
                return Err("revoked consent receipt must have revoked_at");
            }
            if receipt
                .revoke_reason
                .as_ref()
                .is_none_or(|s| s.trim().is_empty())
            {
                return Err("revoked consent receipt must have revoke_reason");
            }
        }
        _ => return Err("consent receipt status must be \"active\" or \"revoked\""),
    }
    if receipt.audit_events.is_empty() {
        return Err("consent receipt audit_events must not be empty");
    }
    Ok(())
}

/// Consent preflight: the hard gate run immediately before enrollment
/// and immediately before every generation job (a queued job is
/// rechecked at start).
///
/// The receipt must validate, its status must be `"active"`, its scope
/// must contain `"voice"`, and its recorded artifact hash must equal the
/// hash of the artifact actually on disk. A mismatch is a hard stop —
/// a filename or checkbox is not consent.
pub fn consent_preflight(
    receipt: &ConsentReceipt,
    artifact_sha256_actual: &str,
) -> Result<(), &'static str> {
    validate_consent_receipt(receipt)?;
    if receipt.status != "active" {
        return Err("consent receipt is not active");
    }
    if !receipt.scope.iter().any(|s| s == "voice") {
        return Err("consent receipt scope must contain \"voice\"");
    }
    if receipt.artifact_sha256 != artifact_sha256_actual {
        return Err("consent artifact hash mismatch");
    }
    Ok(())
}

/// Validate a narration script.
///
/// Checks: `version == 1`; segments non-empty and at most
/// [`MAX_SEGMENTS`]; each segment's text non-empty and at most
/// [`MAX_SEGMENT_TEXT_CHARS`] chars; `capture_start_sec >= 0`;
/// `capture_end_sec > capture_start_sec`;
/// `capture_end_sec <= capture_duration_sec`; step ids unique; segments
/// sorted by `capture_start_sec` with no overlaps (a segment's start
/// must be `>=` the previous segment's end).
pub fn validate_script(script: &NarrationScript) -> Result<(), String> {
    if script.version != 1 {
        return Err("narration script version must be 1".to_string());
    }
    if script.segments.is_empty() {
        return Err("narration script must have at least one segment".to_string());
    }
    if script.segments.len() > MAX_SEGMENTS {
        return Err(format!(
            "narration script has {} segments, over the {} cap",
            script.segments.len(),
            MAX_SEGMENTS
        ));
    }
    if !script.capture_duration_sec.is_finite() || script.capture_duration_sec < 0.0 {
        return Err("narration script capture_duration_sec must be a finite non-negative number"
            .to_string());
    }
    let mut seen_step_ids = std::collections::HashSet::new();
    let mut prev_end: Option<f64> = None;
    for (i, seg) in script.segments.iter().enumerate() {
        if seg.text.trim().is_empty() {
            return Err(format!("segment {i}: text is empty"));
        }
        if seg.text.chars().count() > MAX_SEGMENT_TEXT_CHARS {
            return Err(format!(
                "segment {i}: text exceeds the {MAX_SEGMENT_TEXT_CHARS}-character cap"
            ));
        }
        if !seg.capture_start_sec.is_finite() || !seg.capture_end_sec.is_finite() {
            return Err(format!("segment {i}: capture timestamps must be finite numbers"));
        }
        if seg.capture_start_sec < 0.0 {
            return Err(format!(
                "segment {i}: capture_start_sec ({}) must be >= 0",
                seg.capture_start_sec
            ));
        }
        if seg.capture_end_sec <= seg.capture_start_sec {
            return Err(format!(
                "segment {i}: capture_end_sec ({}) must be > capture_start_sec ({})",
                seg.capture_end_sec, seg.capture_start_sec
            ));
        }
        if seg.capture_end_sec > script.capture_duration_sec {
            return Err(format!(
                "segment {i}: capture_end_sec ({}) exceeds capture_duration_sec ({})",
                seg.capture_end_sec, script.capture_duration_sec
            ));
        }
        if !seen_step_ids.insert(seg.step_id.as_str()) {
            return Err(format!("segment {i}: duplicate step_id \"{}\"", seg.step_id));
        }
        if let Some(prev) = prev_end {
            if seg.capture_start_sec < prev {
                return Err(format!(
                    "segment {i}: capture_start_sec ({}) is before the previous segment's end ({prev}); segments must be sorted with no overlaps",
                    seg.capture_start_sec
                ));
            }
        }
        prev_end = Some(seg.capture_end_sec);
    }
    Ok(())
}

/// Deterministic job id: `"narr-"` + the first 16 hex chars of the
/// SHA-256 over a canonical string joining the seven inputs with `"\n"`
/// in this exact order: presenter id, consent receipt version, model id,
/// model version, weights SHA-256, capture SHA-256, script SHA-256.
///
/// Same inputs always produce the same id; changing any input changes
/// the id. Retrying a completed job with the same input/model/script
/// hashes therefore returns the same managed output record instead of
/// duplicating it (idempotency gate).
pub fn canonical_job_id(
    presenter_id: &str,
    consent_receipt_version: u32,
    model_id: &str,
    model_version: &str,
    weights_sha256: &str,
    capture_sha256: &str,
    script_sha256: &str,
) -> String {
    let canonical = [
        presenter_id,
        &consent_receipt_version.to_string(),
        model_id,
        model_version,
        weights_sha256,
        capture_sha256,
        script_sha256,
    ]
    .join("\n");
    let digest = Sha256::digest(canonical.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("narr-{}", &hex[..16])
}

/// SHA-256 hex of the script's canonical JSON
/// (`serde_json::to_string` bytes). Stable for a given script value, so
/// the job manifest can bind the exact script that was rendered.
pub fn script_sha256(script: &NarrationScript) -> String {
    let json = serde_json::to_string(script).unwrap_or_default();
    let digest = Sha256::digest(json.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Validate a render manifest.
///
/// Checks: `version == 1`; `output_hash` is 64 lowercase hex;
/// `ffmpeg_command` non-empty and starting with `"ffmpeg"`;
/// `consent_receipt_version >= 1`; `input_hashes` contains
/// `capture_sha256`, `script_sha256`, and `reference_audio_sha256`;
/// `model_hashes` contains `model_id`, `code_commit`, and
/// `weights_sha256`.
pub fn validate_render_manifest(manifest: &RenderManifest) -> Result<(), String> {
    if manifest.version != 1 {
        return Err("render manifest version must be 1".to_string());
    }
    if !is_sha256_hex(&manifest.output_hash) {
        return Err("render manifest output_hash must be 64 lowercase hex characters".to_string());
    }
    if manifest.ffmpeg_command.trim().is_empty() {
        return Err("render manifest ffmpeg_command is empty".to_string());
    }
    if !manifest.ffmpeg_command.starts_with("ffmpeg") {
        return Err("render manifest ffmpeg_command must start with \"ffmpeg\"".to_string());
    }
    if manifest.consent_receipt_version < 1 {
        return Err("render manifest consent_receipt_version must be >= 1".to_string());
    }
    for key in ["capture_sha256", "script_sha256", "reference_audio_sha256"] {
        if !manifest.input_hashes.contains_key(key) {
            return Err(format!("render manifest input_hashes is missing \"{key}\""));
        }
    }
    for key in ["model_id", "code_commit", "weights_sha256"] {
        if !manifest.model_hashes.contains_key(key) {
            return Err(format!("render manifest model_hashes is missing \"{key}\""));
        }
    }
    Ok(())
}

/// Acceptance verdict for a finished render: `"PASS"` only when the
/// presenter decision is `"approved"` AND the reviewer decision is
/// `"approved"` AND `output_sha256` is 64 lowercase hex; anything else
/// is `"FAIL"`. No evidence, no PASS.
pub fn acceptance_verdict(receipt: &AcceptanceReceipt) -> &'static str {
    if receipt.presenter_decision == "approved"
        && receipt.reviewer_decision == "approved"
        && is_sha256_hex(&receipt.output_sha256)
    {
        "PASS"
    } else {
        "FAIL"
    }
}

/// Resolve a narration job's status from which spool subdirectory holds
/// it, reusing [`crate::ai_edit::status_from_presence`] — the same
/// lifecycle priority (done > failed > imported > processing > queued).
/// Returns the status string (`"queued"`, `"processing"`, `"done"`,
/// `"failed"`, `"imported"`) or `None` when the job is in no spool
/// subdirectory.
pub fn narration_status_from_presence(
    in_pending: bool,
    in_processing: bool,
    in_done: bool,
    in_failed: bool,
    in_imported: bool,
) -> Option<&'static str> {
    crate::ai_edit::status_from_presence(
        in_pending,
        in_processing,
        in_done,
        in_failed,
        in_imported,
    )
    .map(|status| status.as_str())
}

/// Shared detail line for a `consent_revoked` audit event, naming the
/// confirmed effect counts. Used by the planner and by the transaction's
/// final receipt so both describe the same counts in the same words.
fn revocation_detail(
    presenter_id: &str,
    deleted: usize,
    blocked: usize,
    unpublished: usize,
) -> String {
    format!(
        "Revoked consent for presenter {presenter_id}: deleted {deleted} derived assets, blocked {blocked} queued jobs, unpublished {unpublished} managed outputs. Source capture and audit log retained."
    )
}

/// Build the revocation transaction for a presenter.
///
/// `deleted_assets` lists ONLY derived voice assets — the reference clip
/// and, when present, the speaker embedding. The consent artifact, the
/// source capture, and the audit log are explicitly NOT in
/// `deleted_assets`: revocation retains the minimum consent/revocation
/// audit and hashes, and deletion of instructional records may have
/// retention consequences, so the source capture is never silently
/// erased. `blocked_jobs` is every queued job id passed in (a queued job
/// revoked before start cannot run). `unpublished_outputs` is every
/// managed output for this presenter whose status is `"active"` — only
/// active outputs are unpublished; already-revoked ones are not listed
/// again. `audit_events` carries a single `"consent_revoked"` event
/// whose detail names the counts.
pub fn revocation_plan(
    presenter_id: &str,
    enrollment: &VoiceEnrollment,
    queued_job_ids: &[String],
    managed_outputs: &[ManagedOutputRecord],
    revoked_at: &str,
    reason: &str,
) -> RevocationReceipt {
    let mut deleted_assets = vec![enrollment.reference_clip_path.clone()];
    if let Some(embedding) = &enrollment.speaker_embedding_path {
        deleted_assets.push(embedding.clone());
    }
    let blocked_jobs = queued_job_ids.to_vec();
    let unpublished_outputs: Vec<String> = managed_outputs
        .iter()
        .filter(|o| o.presenter_id == presenter_id && o.status == "active")
        .map(|o| o.job_id.clone())
        .collect();
    let detail = revocation_detail(
        presenter_id,
        deleted_assets.len(),
        blocked_jobs.len(),
        unpublished_outputs.len(),
    );
    RevocationReceipt {
        version: 1,
        presenter_id: presenter_id.to_string(),
        revoked_at: revoked_at.to_string(),
        reason: reason.to_string(),
        deleted_assets,
        blocked_jobs,
        unpublished_outputs,
        audit_events: vec![ConsentAuditEvent {
            event: "consent_revoked".to_string(),
            at: revoked_at.to_string(),
            by: presenter_id.to_string(),
            detail,
        }],
    }
}

/// Durable pending state for a consent revocation transaction, written
/// to `presenters/<presenter_id>/revocation-pending.json` (two-phase)
/// BEFORE anything is mutated, so a crash or failed effect leaves a
/// recoverable record and a re-run of the command resumes instead of
/// starting over or reporting success with unconfirmed effects. The
/// file is removed only after the final receipt is published and the
/// audit event appended.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevocationState {
    pub version: u32,
    pub presenter_id: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub revoked_at: String,
    pub reason: String,
    pub planned_deleted_assets: Vec<String>,
    pub planned_blocked_jobs: Vec<String>,
    pub planned_unpublished_outputs: Vec<String>,
    /// Effects actually verified on disk (a missing asset counts as
    /// confirmed-absent: already gone is gone).
    pub confirmed_deleted_assets: Vec<String>,
    pub confirmed_blocked_jobs: Vec<String>,
    pub confirmed_unpublished_outputs: Vec<String>,
    /// Jobs already processing when revocation landed; recorded in the
    /// audit, not blocked (the runner's completion re-check handles
    /// them).
    pub processing_at_revocation: Vec<String>,
    /// `"pending"` while work remains; `"complete"` is never persisted —
    /// completion is the removal of this file.
    pub status: String,
    pub last_error: Option<String>,
    /// True once the final receipt file has been written AND the audit
    /// event appended; a resume with this set skips re-publishing so a
    /// retried run cannot append the audit event twice.
    pub receipt_published: bool,
    /// True once the final job/output inventory has been taken AFTER
    /// the consent gate was closed and the plan built from it
    /// persisted. A pending state with this false means the
    /// transaction crashed between recording the pending state and
    /// building the plan (or before closing the gate); a resume
    /// rebuilds the plan under the lock instead of trusting the empty
    /// lists. `#[serde(default)]` so pending states written before
    /// fix round 2 still parse.
    #[serde(default)]
    pub plan_ready: bool,
}

/// Pending-state filename inside a presenter directory.
pub const REVOCATION_PENDING_FILE: &str = "revocation-pending.json";
/// [`RevocationState::status`] while the transaction is unfinished.
pub const REVOCATION_STATE_PENDING: &str = "pending";

/// Lock filename inside a presenter directory. One lock per presenter
/// serializes the three consent-gated writers for that presenter —
/// job creation (Tauri `narration_create_job`), completion
/// publication (Python runner), and revocation (`execute_revocation`)
/// — across processes. The lock is an OS advisory lock on this file
/// (`fs2`: flock on Unix, LockFileEx on Windows); the Python runner
/// takes the same lock on the same path with `fcntl`/`msvcrt`, so the
/// two processes genuinely exclude each other. The OS releases the
/// lock if a holder dies, so a crashed process can never wedge the
/// presenter permanently. The file itself is never a derived asset and
/// is never deleted by revocation.
pub const NARRATION_LOCK_FILE: &str = ".narration-lock";
/// How long a lock acquisition waits before failing closed. The
/// critical sections are short filesystem writes (job creation,
/// completion publication, the revocation transaction); 30 s is far
/// beyond any of them, so a timeout means another process is wedged
/// or the spool is on a stalled filesystem — never wait forever.
pub const PRESENTER_LOCK_TIMEOUT_SECS: u64 = 30;

/// RAII guard for a presenter's narration lock. Dropping it releases
/// the OS lock (and closes the file, which releases it regardless),
/// so every return path — including `Err` — frees the presenter.
#[derive(Debug)]
pub struct PresenterLock {
    file: fs::File,
}

impl Drop for PresenterLock {
    fn drop(&mut self) {
        use fs2::FileExt;
        let _ = self.file.unlock();
    }
}

/// Path of a presenter's narration lock file.
pub fn presenter_lock_path(root: &Path, presenter_id: &str) -> std::path::PathBuf {
    root.join("presenters")
        .join(presenter_id)
        .join(NARRATION_LOCK_FILE)
}

/// Acquire a presenter's narration lock, waiting up to
/// `PRESENTER_LOCK_TIMEOUT_SECS`. Fails closed on timeout: the caller
/// must NOT proceed with the gated operation — a job must not be
/// created, a completion must not publish, a revocation must not
/// publish a receipt while another writer may be mid-flight.
pub fn acquire_presenter_lock(root: &Path, presenter_id: &str) -> Result<PresenterLock, String> {
    acquire_presenter_lock_with_timeout(
        root,
        presenter_id,
        std::time::Duration::from_secs(PRESENTER_LOCK_TIMEOUT_SECS),
    )
}

/// Acquire a presenter's narration lock with an explicit timeout
/// (the `acquire_presenter_lock` default is 30 s). Exposed so tests
/// can prove fail-closed contention with a short timeout instead of
/// waiting out the production one.
pub fn acquire_presenter_lock_with_timeout(
    root: &Path,
    presenter_id: &str,
    timeout: std::time::Duration,
) -> Result<PresenterLock, String> {
    if !presenter_id_valid(presenter_id) {
        return Err(format!("invalid presenter id: {presenter_id}"));
    }
    let presenter_dir = root.join("presenters").join(presenter_id);
    fs::create_dir_all(&presenter_dir)
        .map_err(|e| format!("cannot create presenter directory for lock: {e}"))?;
    let path = presenter_dir.join(NARRATION_LOCK_FILE);
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|e| format!("cannot open narration lock file: {e}"))?;
    use fs2::FileExt;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(PresenterLock { file }),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err(format!(
                        "timed out waiting {timeout:?} for the narration lock \
                         for presenter {presenter_id} (another process holds it)"
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                return Err(format!(
                    "cannot lock narration lock file for presenter {presenter_id}: {e}"
                ));
            }
        }
    }
}

/// Presenter ids are directory names: lowercase letters, digits, hyphens.
/// Anything else (including `/`, `\`, `..`) is rejected — a presenter id
/// must never escape its own directory. (Mirrors the Tauri shell's rule.)
pub fn presenter_id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && !id.ends_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Canonical narration job id: `narr-` + 16 lowercase hex chars.
/// (Mirrors the Tauri shell's rule.)
pub fn narration_job_id_valid(id: &str) -> bool {
    id.len() == 21
        && id.starts_with("narr-")
        && id[5..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Two-phase JSON write (temp file + rename) so a crash can never leave a
/// half-written receipt or manifest under a final name.
fn write_json_two_phase<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("cannot encode {}: {e}", path.display()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension(format!(
        "{}.part",
        path.extension().unwrap_or_default().to_string_lossy()
    ));
    fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot finalize {}: {e}", path.display())
    })?;
    Ok(())
}

/// Streamed SHA-256 hex of a file's live bytes.
fn sha256_file_hex(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut f =
        fs::File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Append one JSON line to the append-only audit log. The audit log is
/// never rewritten or deleted — not even by revocation.
fn append_audit(root: &Path, event: serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let audit_dir = root.join("audit");
    fs::create_dir_all(&audit_dir)
        .map_err(|e| format!("cannot create audit dir: {e}"))?;
    let mut line = serde_json::Map::new();
    line.insert(
        "at".to_string(),
        serde_json::Value::String(crate::timestamp::now_utc_iso8601()),
    );
    if let serde_json::Value::Object(map) = event {
        for (k, v) in map {
            line.insert(k, v);
        }
    }
    let text = serde_json::to_string(&serde_json::Value::Object(line))
        .map_err(|e| format!("cannot encode audit event: {e}"))?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(audit_dir.join("audit-log.jsonl"))
        .map_err(|e| format!("cannot open audit log: {e}"))?;
    f.write_all(text.as_bytes())
        .and_then(|_| f.write_all(b"\n"))
        .map_err(|e| format!("cannot append to audit log: {e}"))?;
    Ok(())
}

/// Job status from marker-file presence (`.done` > `.failed` >
/// `.processing` > `.queued`). `None` means no marker is present.
fn narration_job_status(job_dir: &Path) -> Option<String> {
    let has = |name: &str| job_dir.join(name).exists();
    narration_status_from_presence(
        has(".queued"),
        has(".processing"),
        has(".done"),
        has(".failed"),
        false,
    )
    .map(|s| s.to_string())
}

/// Read a presenter's enrollment when one exists. A present but corrupt
/// enrollment is a hard error, not a silent "never enrolled".
fn read_enrollment_opt(
    presenter_dir: &Path,
) -> Result<Option<VoiceEnrollment>, String> {
    let bytes = match fs::read(presenter_dir.join("enrollment.json")) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot read enrollment: {e}")),
    };
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("enrollment is corrupt: {e}"))
        .map(Some)
}

/// Scan the jobs spool for this presenter's queued and processing jobs.
/// A job directory whose manifest cannot be read or parsed is a hard
/// error: a queued job of this presenter could be hiding behind it, and
/// revocation must not claim success while a runnable job is unaccounted
/// for.
fn scan_jobs(
    root: &Path,
    presenter_id: &str,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut queued: Vec<String> = Vec::new();
    let mut processing: Vec<String> = Vec::new();
    let jobs_dir = root.join("jobs");
    let entries = match fs::read_dir(&jobs_dir) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok((queued, processing)),
        Err(e) => return Err(format!("cannot list narration jobs: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot list narration jobs: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !narration_job_id_valid(&name) {
            continue;
        }
        let job_dir = jobs_dir.join(&name);
        let bytes = fs::read(job_dir.join("job.json"))
            .map_err(|e| format!("cannot read job manifest for {name}: {e}"))?;
        let manifest: NarrationJobManifest = serde_json::from_slice(&bytes)
            .map_err(|e| format!("job manifest for {name} is corrupt: {e}"))?;
        if manifest.presenter_id != presenter_id {
            continue;
        }
        match narration_job_status(&job_dir).as_deref() {
            Some("queued") => queued.push(name),
            Some("processing") => processing.push(name),
            _ => {}
        }
    }
    queued.sort();
    processing.sort();
    Ok((queued, processing))
}

/// Read the managed-outputs index. Missing means no managed outputs;
/// present-but-corrupt is a hard error.
fn read_managed_outputs(root: &Path) -> Result<Vec<ManagedOutputRecord>, String> {
    let bytes = match fs::read(root.join("managed-outputs.json")) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("cannot read managed outputs: {e}")),
    };
    let doc: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("managed outputs are corrupt: {e}"))?;
    doc.get("outputs")
        .cloned()
        .map(|o| {
            serde_json::from_value::<Vec<ManagedOutputRecord>>(o)
                .map_err(|e| format!("managed outputs are corrupt: {e}"))
        })
        .transpose()?
        .ok_or_else(|| "managed outputs are corrupt: missing \"outputs\"".to_string())
}

/// Write the managed-outputs index (two-phase).
fn write_managed_outputs(
    root: &Path,
    outputs: &[ManagedOutputRecord],
) -> Result<(), String> {
    let doc = serde_json::json!({ "version": 1, "outputs": outputs });
    write_json_two_phase(&root.join("managed-outputs.json"), &doc)
}

/// Record a failure in the pending state (with `last_error`) and return
/// the message to surface. The state save itself is best-effort: if it
/// also fails, the save error is appended so the caller still sees the
/// original failure.
fn save_pending_error(
    pending_path: &Path,
    state: &mut RevocationState,
    msg: String,
) -> String {
    state.last_error = Some(msg.clone());
    state.status = REVOCATION_STATE_PENDING.to_string();
    match write_json_two_phase(pending_path, &*state) {
        Ok(()) => msg,
        Err(e) => format!("{msg}; could not save revocation pending state: {e}"),
    }
}

/// The `consent_revoked` failure result written into a blocked queued job.
fn failed_job_result(
    job_id: &str,
    consent_receipt_version: u32,
    revoked_at: &str,
) -> NarrationResult {
    NarrationResult {
        version: 1,
        job_id: job_id.to_string(),
        status: "failed".to_string(),
        failure_reason: Some("consent_revoked".to_string()),
        segments: Vec::new(),
        render: None,
        resources: NarrationResources {
            peak_vram_mib: None,
            peak_ram_mib: None,
            gpu: "unknown".to_string(),
        },
        outbound_requests: Vec::new(),
        model: NarrationModelReceipt {
            model_id: MODEL_ID_OPENVOICE_V2.to_string(),
            model_version: MODEL_VERSION_V2.to_string(),
            code_commit: OPENVOICE_CODE_COMMIT.to_string(),
            weights_sha256: CHECKPOINTS_ZIP_SHA256.to_string(),
            base_tts: "melotts".to_string(),
            base_tts_commit: MELOTTS_CODE_COMMIT.to_string(),
        },
        consent_receipt_version,
        completed_at: revoked_at.to_string(),
    }
}

/// Execute a consent revocation as a fail-closed, restartable
/// transaction (scope brief: "Revocation is a transaction, not a note").
///
/// `root` is the narration spool root (`.../narration`), holding
/// `presenters/<presenter_id>/`, `jobs/`, `managed-outputs.json`, and
/// `audit/`.
///
/// Serialization (fix round 2): the whole transaction runs under the
/// presenter's narration lock ([`acquire_presenter_lock`]) — the same
/// lock job creation and the runner's completion publication take.
/// Nothing can be created or published while this runs, so the
/// inventory below is final, not a snapshot that a concurrent writer
/// can outrun. The lock is released on every return path (RAII).
///
/// Order of effects, each verified before the next begins:
/// 1. The pending state is written (two-phase) BEFORE anything
///    mutates — a crash after this point is recoverable by re-running
///    the command. The plan is NOT built yet (its lists start empty).
/// 2. `consent.json` is marked revoked (validated first, as before).
///    The gate closes FIRST: from here on, no new job can be created
///    and no in-flight completion can publish (both re-check consent
///    under the lock).
/// 3. The plan is built from the FINAL inventory — jobs spool,
///    managed-outputs index, enrollment — taken after the gate closed
///    and while the lock is held, then persisted with
///    `plan_ready = true`. A resume whose plan was never built
///    rebuilds it here instead of trusting the empty lists.
/// 4. `enrollment.json` is marked revoked when present.
/// 5. Each planned derived asset is deleted and its absence verified
///    (a missing file counts as confirmed-absent).
/// 6. Each queued job is blocked: `.queued` removed (verified gone),
///    `result.json` written `failed`/`consent_revoked` (two-phase),
///    `.failed` written (verified present).
/// 7. Managed outputs are unpublished, the index re-read, and every
///    planned status change verified.
/// 8. Final verification sweep, still under the lock: the jobs spool
///    and managed-outputs index are re-read and must show no queued
///    job and no active managed output for this presenter. A
///    violation fails closed — the receipt is never published.
/// 9. The final receipt — built from CONFIRMED effects only, never the
///    plan — is written, and the audit event appended.
/// 10. Only then is the pending-state file removed and the receipt
///    returned.
///
/// On ANY failure the pending state is saved with `last_error` and an
/// `Err` is returned — a success receipt is never published with
/// unconfirmed effects. Re-running the command resumes: when consent is
/// already revoked AND a pending state exists, the stored
/// `revoked_at`/`reason` and confirmed lists are reused and the
/// remaining effects applied. Consent already revoked with NO pending
/// state is `Err("already revoked")`, as before.
///
/// The consent artifact, source captures, and audit log are never
/// deleted. Processing (in-flight) jobs are recorded in the audit but
/// not blocked. Re-enrollment after revocation still requires a new
/// consent receipt.
pub fn execute_revocation(
    root: &Path,
    presenter_id: &str,
    reason: &str,
) -> Result<RevocationReceipt, String> {
    if reason.trim().is_empty() {
        return Err("a revocation reason is required".to_string());
    }
    if !presenter_id_valid(presenter_id) {
        return Err(format!("invalid presenter id: {presenter_id}"));
    }
    let reason = reason.trim().to_string();
    let presenter_dir = root.join("presenters").join(presenter_id);
    let pending_path = presenter_dir.join(REVOCATION_PENDING_FILE);

    // Serialize against job creation and completion publication for
    // this presenter. The lock is held for the whole transaction
    // (RAII: every return path releases it), so no job can be created
    // and no completion can publish while the inventory below is
    // taken and applied.
    let _lock = acquire_presenter_lock(root, presenter_id)?;

    // Resume state, when a previous attempt left one behind.
    let mut state = match fs::read(&pending_path) {
        Ok(bytes) => Some(
            serde_json::from_slice::<RevocationState>(&bytes)
                .map_err(|e| format!("revocation pending state is corrupt: {e}"))?,
        ),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(format!("cannot read revocation pending state: {e}")),
    };
    if let Some(s) = &state {
        if s.presenter_id != presenter_id {
            return Err(
                "revocation pending state belongs to a different presenter".to_string(),
            );
        }
        if s.version != 1 {
            return Err("revocation pending state version must be 1".to_string());
        }
    }

    let consent_path = presenter_dir.join("consent.json");
    let mut receipt: ConsentReceipt = match fs::read(&consent_path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("consent receipt for {presenter_id} is corrupt: {e}"))?,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return Err(format!(
                "no consent receipt registered for presenter {presenter_id}"
            ));
        }
        Err(e) => {
            return Err(format!(
                "cannot read consent receipt for {presenter_id}: {e}"
            ));
        }
    };
    if receipt.status == "revoked" && state.is_none() {
        return Err(format!(
            "consent for presenter {presenter_id} is already revoked"
        ));
    }
    validate_consent_receipt(&receipt).map_err(|e| e.to_string())?;

    let revoked_at: String;
    let reason_owned: String;
    if let Some(s) = &state {
        // Resume: the stored revocation instant and reason are the
        // transaction's identity; the caller's reason is ignored.
        revoked_at = s.revoked_at.clone();
        reason_owned = s.reason.clone();
    } else {
        // Fresh transaction: durably record the pending state BEFORE
        // mutating anything — a crash after this point is recoverable
        // by re-running the command. The plan is deliberately NOT
        // built here: the inventory must be taken AFTER the consent
        // gate closes (step (a) below), so no in-flight completion
        // can escape it. The lists start empty with plan_ready false;
        // step (b) fills them.
        revoked_at = crate::timestamp::now_utc_iso8601();
        let fresh = RevocationState {
            version: 1,
            presenter_id: presenter_id.to_string(),
            revoked_at: revoked_at.clone(),
            reason: reason.clone(),
            planned_deleted_assets: Vec::new(),
            planned_blocked_jobs: Vec::new(),
            planned_unpublished_outputs: Vec::new(),
            confirmed_deleted_assets: Vec::new(),
            confirmed_blocked_jobs: Vec::new(),
            confirmed_unpublished_outputs: Vec::new(),
            processing_at_revocation: Vec::new(),
            status: REVOCATION_STATE_PENDING.to_string(),
            last_error: None,
            receipt_published: false,
            plan_ready: false,
        };
        write_json_two_phase(&pending_path, &fresh)
            .map_err(|e| format!("cannot record revocation pending state: {e}"))?;
        state = Some(fresh);
        reason_owned = reason.clone();
    }
    let mut state = state.unwrap();
    // Every failure below saves the pending state (with `last_error`)
    // and returns `Err` — never a success receipt with unconfirmed
    // effects.
    let fail = |state: &mut RevocationState, msg: String| -> String {
        save_pending_error(&pending_path, state, msg)
    };

    // (a) consent.json -> revoked. The gate closes FIRST, before any
    // inventory is taken: from this point on, no new job can be
    // created (creation checks consent under the lock) and no
    // in-flight completion can publish (publication re-checks consent
    // under the lock).
    if receipt.status != "revoked" {
        receipt.status = "revoked".to_string();
        receipt.revoked_at = Some(revoked_at.clone());
        receipt.revoke_reason = Some(reason_owned.clone());
        receipt.audit_events.push(ConsentAuditEvent {
            event: "consent_revoked".to_string(),
            at: revoked_at.clone(),
            by: "owner".to_string(),
            detail: reason_owned.clone(),
        });
        validate_consent_receipt(&receipt).map_err(|e| e.to_string())?;
        if let Err(e) = write_json_two_phase(&consent_path, &receipt) {
            return Err(fail(
                &mut state,
                format!("cannot write revoked consent receipt: {e}"),
            ));
        }
        if let Err(e) = write_json_two_phase(&pending_path, &state) {
            return Err(fail(
                &mut state,
                format!("cannot save revocation pending state: {e}"),
            ));
        }
    }

    // (b) Build the plan from the FINAL inventory, taken now that the
    // gate is closed and while the lock is held: no job can have been
    // created and no completion can have published since step (a), so
    // this inventory cannot miss an in-flight completion the way a
    // pre-gate snapshot could. A resume with plan_ready already set
    // keeps its plan (and its confirmed lists); a resume that crashed
    // before the plan was built — or a pre-fix-round-2 pending state,
    // which has no plan_ready flag — builds it here.
    if !state.plan_ready {
        let enrollment = match read_enrollment_opt(&presenter_dir) {
            Ok(e) => e,
            Err(e) => return Err(fail(&mut state, e)),
        };
        let (queued, processing) = match scan_jobs(root, presenter_id) {
            Ok(j) => j,
            Err(e) => return Err(fail(&mut state, e)),
        };
        let managed = match read_managed_outputs(root) {
            Ok(m) => m,
            Err(e) => return Err(fail(&mut state, e)),
        };
        // The plan needs an enrollment to name the derived assets. When
        // none exists yet (never enrolled), use the conventional paths —
        // the apply step below deletes only files that actually exist.
        let enrollment_for_plan = enrollment.clone().unwrap_or(VoiceEnrollment {
            version: 1,
            presenter_id: presenter_id.to_string(),
            consent_receipt_version: receipt.version,
            consent_artifact_sha256: receipt.artifact_sha256.clone(),
            model_id: MODEL_ID_OPENVOICE_V2.to_string(),
            model_version: MODEL_VERSION_V2.to_string(),
            model_code_commit: OPENVOICE_CODE_COMMIT.to_string(),
            weights_sha256: CHECKPOINTS_ZIP_SHA256.to_string(),
            reference_audio_sha256: String::new(),
            preprocessing_version: String::new(),
            speaker_embedding_path: None,
            reference_clip_path: "reference.wav".to_string(),
            created_at: receipt.granted_at.clone(),
            last_used_at: None,
            status: "pending".to_string(),
        });
        let plan = revocation_plan(
            presenter_id,
            &enrollment_for_plan,
            &queued,
            &managed,
            &revoked_at,
            &reason_owned,
        );
        state.planned_deleted_assets = plan.deleted_assets.clone();
        state.planned_blocked_jobs = plan.blocked_jobs.clone();
        state.planned_unpublished_outputs = plan.unpublished_outputs.clone();
        state.processing_at_revocation = processing;
        state.plan_ready = true;
        if let Err(e) = write_json_two_phase(&pending_path, &state) {
            return Err(fail(
                &mut state,
                format!("cannot save revocation pending state: {e}"),
            ));
        }
    }

    // (c) enrollment.json -> revoked when present.
    match read_enrollment_opt(&presenter_dir) {
        Ok(Some(mut enr)) => {
            if enr.status != "revoked" {
                enr.status = "revoked".to_string();
                if let Err(e) = write_json_two_phase(&presenter_dir.join("enrollment.json"), &enr) {
                    return Err(fail(
                        &mut state,
                        format!("cannot write revoked enrollment: {e}"),
                    ));
                }
            }
        }
        Ok(None) => {}
        Err(e) => return Err(fail(&mut state, e)),
    }
    if let Err(e) = write_json_two_phase(&pending_path, &state) {
        return Err(fail(
            &mut state,
            format!("cannot save revocation pending state: {e}"),
        ));
    }

    // (d) Delete each planned derived asset, verifying absence.
    let canon_dir = match presenter_dir.canonicalize() {
        Ok(d) => d,
        Err(e) => {
            return Err(fail(
                &mut state,
                format!("cannot resolve presenter directory: {e}"),
            ));
        }
    };
    let mut deleted = state.confirmed_deleted_assets.clone();
    for rel in state.planned_deleted_assets.clone() {
        if deleted.contains(&rel) {
            continue;
        }
        let target = presenter_dir.join(&rel);
        match fs::symlink_metadata(&target) {
            Err(e) if e.kind() == ErrorKind::NotFound => {
                // Already gone counts as confirmed-absent.
            }
            Err(e) => {
                return Err(fail(
                    &mut state,
                    format!("cannot inspect derived asset {rel}: {e}"),
                ));
            }
            Ok(_) => {
                let canon_target = match target.canonicalize() {
                    Ok(t) => t,
                    Err(e) => {
                        return Err(fail(
                            &mut state,
                            format!("cannot resolve derived asset {rel}: {e}"),
                        ));
                    }
                };
                if !canon_target.starts_with(&canon_dir) {
                    return Err(fail(
                        &mut state,
                        format!("derived asset {rel} escapes the presenter directory"),
                    ));
                }
                if let Err(e) = fs::remove_file(&canon_target) {
                    return Err(fail(
                        &mut state,
                        format!("cannot delete derived asset {rel}: {e}"),
                    ));
                }
                match fs::symlink_metadata(&target) {
                    Err(e) if e.kind() == ErrorKind::NotFound => {}
                    _ => {
                        return Err(fail(
                            &mut state,
                            format!("derived asset {rel} still exists after deletion"),
                        ));
                    }
                }
            }
        }
        deleted.push(rel);
    }
    state.confirmed_deleted_assets = deleted;
    if let Err(e) = write_json_two_phase(&pending_path, &state) {
        return Err(fail(
            &mut state,
            format!("cannot save revocation pending state: {e}"),
        ));
    }

    // (e) Block each queued job, verifying every write.
    let mut blocked = state.confirmed_blocked_jobs.clone();
    for job_id in state.planned_blocked_jobs.clone() {
        if blocked.contains(&job_id) {
            continue;
        }
        if !narration_job_id_valid(&job_id) {
            return Err(fail(
                &mut state,
                format!("planned blocked job {job_id} is not a valid narration job id"),
            ));
        }
        let job_dir = root.join("jobs").join(&job_id);
        match fs::remove_file(job_dir.join(".queued")) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => {
                return Err(fail(
                    &mut state,
                    format!("cannot remove .queued marker for job {job_id}: {e}"),
                ));
            }
        }
        if fs::symlink_metadata(job_dir.join(".queued")).is_ok() {
            return Err(fail(
                &mut state,
                format!(".queued marker for job {job_id} still exists after removal"),
            ));
        }
        let manifest_bytes = match fs::read(job_dir.join("job.json")) {
            Ok(b) => b,
            Err(e) => {
                return Err(fail(
                    &mut state,
                    format!("cannot read job manifest for {job_id}: {e}"),
                ));
            }
        };
        let manifest: NarrationJobManifest = match serde_json::from_slice(&manifest_bytes) {
            Ok(m) => m,
            Err(e) => {
                return Err(fail(
                    &mut state,
                    format!("job manifest for {job_id} is corrupt: {e}"),
                ));
            }
        };
        let failed = failed_job_result(
            &job_id,
            manifest.consent_receipt_version,
            &revoked_at,
        );
        if let Err(e) = write_json_two_phase(&job_dir.join("result.json"), &failed) {
            return Err(fail(
                &mut state,
                format!("cannot write failed result for job {job_id}: {e}"),
            ));
        }
        if let Err(e) = fs::write(job_dir.join(".failed"), b"") {
            return Err(fail(
                &mut state,
                format!("cannot write .failed marker for job {job_id}: {e}"),
            ));
        }
        if !job_dir.join(".failed").exists() {
            return Err(fail(
                &mut state,
                format!(".failed marker for job {job_id} is missing after write"),
            ));
        }
        blocked.push(job_id);
        state.confirmed_blocked_jobs = blocked.clone();
        if let Err(e) = write_json_two_phase(&pending_path, &state) {
            return Err(fail(
                &mut state,
                format!("cannot save revocation pending state: {e}"),
            ));
        }
    }

    // (f) Unpublish managed outputs, then re-read and verify.
    if !state.planned_unpublished_outputs.is_empty() {
        let mut outputs = match read_managed_outputs(root) {
            Ok(o) => o,
            Err(e) => return Err(fail(&mut state, e)),
        };
        let mut changed = false;
        for rec in outputs.iter_mut() {
            if state.planned_unpublished_outputs.contains(&rec.job_id)
                && rec.status != "consent_revoked"
            {
                rec.status = "consent_revoked".to_string();
                changed = true;
            }
        }
        if changed {
            if let Err(e) = write_managed_outputs(root, &outputs) {
                return Err(fail(
                    &mut state,
                    format!("cannot write managed outputs: {e}"),
                ));
            }
        }
        let verified = match read_managed_outputs(root) {
            Ok(o) => o,
            Err(e) => return Err(fail(&mut state, e)),
        };
        for job_id in state.planned_unpublished_outputs.clone() {
            match verified.iter().find(|r| r.job_id == job_id) {
                Some(rec) if rec.status == "consent_revoked" => {}
                Some(rec) => {
                    return Err(fail(
                        &mut state,
                        format!(
                            "managed output {job_id} still has status {}",
                            rec.status
                        ),
                    ));
                }
                None => {
                    return Err(fail(
                        &mut state,
                        format!("managed output {job_id} is missing after unpublish"),
                    ));
                }
            }
        }
        state.confirmed_unpublished_outputs = state.planned_unpublished_outputs.clone();
        if let Err(e) = write_json_two_phase(&pending_path, &state) {
            return Err(fail(
                &mut state,
                format!("cannot save revocation pending state: {e}"),
            ));
        }
    }

    // (g) Final verification sweep, still under the lock: re-read the
    // jobs spool and the managed-outputs index and prove that no
    // queued job and no active managed output for this presenter
    // remains. Nothing could have been created or published since
    // step (b) — creation and publication both need this lock — so a
    // violation here means a writer outside the protocol, and the
    // transaction fails closed instead of publishing a receipt that
    // claims completeness it does not have. Processing jobs may still
    // exist: their runners fail at the locked completion re-check
    // after this lock is released.
    {
        let (queued_now, _) = match scan_jobs(root, presenter_id) {
            Ok(j) => j,
            Err(e) => return Err(fail(&mut state, e)),
        };
        if !queued_now.is_empty() {
            return Err(fail(
                &mut state,
                format!(
                    "queued jobs for presenter {presenter_id} remain after blocking: {}",
                    queued_now.join(", ")
                ),
            ));
        }
        let outputs_now = match read_managed_outputs(root) {
            Ok(o) => o,
            Err(e) => return Err(fail(&mut state, e)),
        };
        let still_active: Vec<&str> = outputs_now
            .iter()
            .filter(|o| o.presenter_id == presenter_id && o.status == "active")
            .map(|o| o.job_id.as_str())
            .collect();
        if !still_active.is_empty() {
            return Err(fail(
                &mut state,
                format!(
                    "active managed outputs for presenter {presenter_id} remain after unpublish: {}",
                    still_active.join(", ")
                ),
            ));
        }
    }

    // (h) Publish the final receipt from CONFIRMED effects only, then
    // append the audit event. A resume with `receipt_published` set
    // skips this so the audit event is never appended twice.
    let final_receipt = RevocationReceipt {
        version: 1,
        presenter_id: presenter_id.to_string(),
        revoked_at: revoked_at.clone(),
        reason: reason_owned.clone(),
        deleted_assets: state.confirmed_deleted_assets.clone(),
        blocked_jobs: state.confirmed_blocked_jobs.clone(),
        unpublished_outputs: state.confirmed_unpublished_outputs.clone(),
        audit_events: vec![ConsentAuditEvent {
            event: "consent_revoked".to_string(),
            at: revoked_at.clone(),
            by: presenter_id.to_string(),
            detail: revocation_detail(
                presenter_id,
                state.confirmed_deleted_assets.len(),
                state.confirmed_blocked_jobs.len(),
                state.confirmed_unpublished_outputs.len(),
            ),
        }],
    };
    if !state.receipt_published {
        let stamp = revoked_at.replace(['-', ':'], "");
        if let Err(e) = write_json_two_phase(
            &presenter_dir.join(format!("revocation-{stamp}.json")),
            &final_receipt,
        ) {
            return Err(fail(
                &mut state,
                format!("cannot write revocation receipt: {e}"),
            ));
        }
        if let Err(e) = append_audit(
            root,
            serde_json::json!({
                "event": "consent_revoked",
                "presenter_id": presenter_id,
                "reason": reason_owned,
                "deleted_assets": final_receipt.deleted_assets.len(),
                "blocked_jobs": final_receipt.blocked_jobs,
                "unpublished_outputs": final_receipt.unpublished_outputs,
                "processing_at_revocation": state.processing_at_revocation,
            }),
        ) {
            return Err(fail(
                &mut state,
                format!("cannot append revocation to audit log: {e}"),
            ));
        }
        state.receipt_published = true;
        if let Err(e) = write_json_two_phase(&pending_path, &state) {
            return Err(fail(
                &mut state,
                format!("cannot save revocation pending state: {e}"),
            ));
        }
    }

    // (i) Only now remove the pending state and return the receipt.
    if let Err(e) = fs::remove_file(&pending_path) {
        return Err(fail(
            &mut state,
            format!("cannot remove revocation pending state: {e}"),
        ));
    }
    Ok(final_receipt)
}

/// Hash the live rendered output for a finished narration job and bind
/// the acceptance decision to those exact bytes (acceptance gate 10:
/// presenter and reviewer receipts on the exact output hash).
///
/// Reads and parses `render-manifest.json` from the job directory — a
/// done job without a readable, valid manifest fails closed — validates
/// it, resolves the render's `output_file` as a plain file name under
/// the job directory (any `/`, `\`, or absolute path is rejected, so a
/// tampered `result.json` can never make acceptance hash a file outside
/// the job), hashes the live bytes (streamed SHA-256), and requires the
/// live hash to equal BOTH `result.render.output_sha256` and the
/// manifest's `output_hash`. Returns the live hash and the parsed
/// manifest (so the caller can attach the acceptance receipt to it).
pub fn verify_acceptance_output(
    job_dir: &Path,
    result: &NarrationResult,
) -> Result<(String, RenderManifest), String> {
    let manifest_bytes = fs::read(job_dir.join("render-manifest.json")).map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            format!("job {} has no render-manifest.json", result.job_id)
        } else {
            format!("cannot read render manifest: {e}")
        }
    })?;
    let manifest: RenderManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("render manifest is corrupt: {e}"))?;
    validate_render_manifest(&manifest).map_err(|e| e)?;
    let render = result
        .render
        .as_ref()
        .ok_or_else(|| format!("job {} has no rendered output", result.job_id))?;
    let live = hash_render_output(job_dir, render)?;
    if live != render.output_sha256 {
        return Err(format!(
            "live output hash {live} does not match result.json output_sha256 {}",
            render.output_sha256
        ));
    }
    if live != manifest.output_hash {
        return Err(format!(
            "live output hash {live} does not match render manifest output_hash {}",
            manifest.output_hash
        ));
    }
    Ok((live, manifest))
}

/// Resolve a render's `output_file` under the job directory and hash the
/// live bytes. The file name is taken literally — never a path — so the
/// hash can only ever cover a file inside this job's directory.
fn hash_render_output(
    job_dir: &Path,
    render: &NarrationRenderResult,
) -> Result<String, String> {
    let name = render.output_file.as_str();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || Path::new(name).is_absolute()
    {
        return Err(format!(
            "render output_file {name:?} is not a plain file name under the job directory"
        ));
    }
    let file_name = Path::new(name).file_name().ok_or_else(|| {
        format!("render output_file {name:?} is not a plain file name under the job directory")
    })?;
    sha256_file_hex(&job_dir.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_64(ch: char) -> String {
        ch.to_string().repeat(64)
    }

    fn valid_receipt() -> ConsentReceipt {
        ConsentReceipt {
            version: 1,
            presenter_id: "tyler-welch".to_string(),
            display_name: "Tyler Welch".to_string(),
            consent_artifact_path: "consent/tyler-welch-consent.mp4".to_string(),
            artifact_sha256: hex_64('a'),
            recorded_at: "2026-11-11T10:00:00Z".to_string(),
            reviewed_by: "jason-morgan".to_string(),
            scope: vec!["voice".to_string()],
            status: "active".to_string(),
            granted_at: "2026-11-11T10:05:00Z".to_string(),
            revoked_at: None,
            revoke_reason: None,
            audit_events: vec![ConsentAuditEvent {
                event: "consent_granted".to_string(),
                at: "2026-11-11T10:05:00Z".to_string(),
                by: "tyler-welch".to_string(),
                detail: "Self-recorded consent statement reviewed.".to_string(),
            }],
        }
    }

    fn valid_script() -> NarrationScript {
        NarrationScript {
            version: 1,
            job_id: "narr-0123456789abcdef".to_string(),
            presenter_id: "tyler-welch".to_string(),
            capture_duration_sec: 45.0,
            segments: vec![
                NarrationSegment {
                    step_id: "step-1".to_string(),
                    text: "Open the valve slowly.".to_string(),
                    source_evidence: "capture step 1".to_string(),
                    capture_start_sec: 0.0,
                    capture_end_sec: 10.0,
                    audio_hash: None,
                    correction: None,
                },
                NarrationSegment {
                    step_id: "step-2".to_string(),
                    text: "Check the gauge reading.".to_string(),
                    source_evidence: "capture step 2".to_string(),
                    capture_start_sec: 10.0,
                    capture_end_sec: 20.0,
                    audio_hash: None,
                    correction: None,
                },
            ],
        }
    }

    fn valid_enrollment() -> VoiceEnrollment {
        VoiceEnrollment {
            version: 1,
            presenter_id: "tyler-welch".to_string(),
            consent_receipt_version: 1,
            consent_artifact_sha256: hex_64('a'),
            model_id: MODEL_ID_OPENVOICE_V2.to_string(),
            model_version: MODEL_VERSION_V2.to_string(),
            model_code_commit: OPENVOICE_CODE_COMMIT.to_string(),
            weights_sha256: hex_64('b'),
            reference_audio_sha256: hex_64('c'),
            preprocessing_version: "v1".to_string(),
            speaker_embedding_path: Some("enrollment/tyler-welch/embedding.pt".to_string()),
            reference_clip_path: "enrollment/tyler-welch/reference.wav".to_string(),
            created_at: "2026-11-11T11:00:00Z".to_string(),
            last_used_at: None,
            status: "active".to_string(),
        }
    }

    fn valid_render_manifest() -> RenderManifest {
        let mut input_hashes = BTreeMap::new();
        input_hashes.insert("capture_sha256".to_string(), hex_64('a'));
        input_hashes.insert("script_sha256".to_string(), hex_64('b'));
        input_hashes.insert("reference_audio_sha256".to_string(), hex_64('c'));
        let mut model_hashes = BTreeMap::new();
        model_hashes.insert("model_id".to_string(), MODEL_ID_OPENVOICE_V2.to_string());
        model_hashes.insert("code_commit".to_string(), OPENVOICE_CODE_COMMIT.to_string());
        model_hashes.insert("weights_sha256".to_string(), hex_64('d'));
        RenderManifest {
            version: 1,
            job_id: "narr-0123456789abcdef".to_string(),
            input_hashes,
            model_hashes,
            ffmpeg_version: "7.1".to_string(),
            ffmpeg_command: "ffmpeg -i capture.mp4 -i narration.wav -c:v copy out.mp4"
                .to_string(),
            consent_receipt_version: 1,
            output_hash: hex_64('e'),
            caption_path: "narration/captions.vtt".to_string(),
            acceptance_receipt: None,
            acceptance_receipt_path: None,
        }
    }

    fn valid_acceptance() -> AcceptanceReceipt {
        AcceptanceReceipt {
            version: 1,
            job_id: "narr-0123456789abcdef".to_string(),
            output_sha256: hex_64('e'),
            presenter_decision: "approved".to_string(),
            presenter_by: "tyler-welch".to_string(),
            presenter_at: "2026-11-12T09:00:00Z".to_string(),
            reviewer_decision: "approved".to_string(),
            reviewer_by: "jason-morgan".to_string(),
            reviewer_at: "2026-11-12T09:05:00Z".to_string(),
            notes: "Recognizably me, acceptable for this SOP.".to_string(),
            verdict: "PASS".to_string(),
        }
    }

    // --- consent validation ---

    #[test]
    fn consent_validation_happy_path() {
        assert!(validate_consent_receipt(&valid_receipt()).is_ok());
        let mut revoked = valid_receipt();
        revoked.status = "revoked".to_string();
        revoked.revoked_at = Some("2026-11-12T00:00:00Z".to_string());
        revoked.revoke_reason = Some("Presenter withdrew consent.".to_string());
        assert!(validate_consent_receipt(&revoked).is_ok());
    }

    #[test]
    fn consent_validation_rejects_bad_version() {
        let mut r = valid_receipt();
        r.version = 2;
        assert!(validate_consent_receipt(&r).is_err());
    }

    #[test]
    fn consent_validation_rejects_empty_identity_fields() {
        let mut r = valid_receipt();
        r.presenter_id = "".to_string();
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.display_name = "   ".to_string();
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.consent_artifact_path = "".to_string();
        assert!(validate_consent_receipt(&r).is_err());
    }

    #[test]
    fn consent_validation_rejects_bad_artifact_hash() {
        let mut r = valid_receipt();
        r.artifact_sha256 = "abc".to_string();
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.artifact_sha256 = hex_64('A'); // uppercase hex is not lowercase hex
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.artifact_sha256 = "g".repeat(64); // not hex at all
        assert!(validate_consent_receipt(&r).is_err());
    }

    #[test]
    fn consent_validation_rejects_empty_timestamps() {
        let mut r = valid_receipt();
        r.recorded_at = "".to_string();
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.granted_at = "".to_string();
        assert!(validate_consent_receipt(&r).is_err());
    }

    #[test]
    fn consent_validation_requires_voice_scope_and_valid_status() {
        let mut r = valid_receipt();
        r.scope = vec!["face".to_string()];
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.scope = vec![];
        assert!(validate_consent_receipt(&r).is_err());
        let mut r = valid_receipt();
        r.status = "pending".to_string();
        assert!(validate_consent_receipt(&r).is_err());
    }

    #[test]
    fn consent_validation_revoked_requires_fields_and_active_forbids_them() {
        let mut r = valid_receipt();
        r.status = "revoked".to_string();
        assert!(validate_consent_receipt(&r).is_err()); // no revoked_at/reason
        r.revoked_at = Some("2026-11-12T00:00:00Z".to_string());
        assert!(validate_consent_receipt(&r).is_err()); // reason still missing
        let mut r = valid_receipt();
        r.revoked_at = Some("2026-11-12T00:00:00Z".to_string());
        assert!(validate_consent_receipt(&r).is_err()); // active + revoked_at
        let mut r = valid_receipt();
        r.revoke_reason = Some("x".to_string());
        assert!(validate_consent_receipt(&r).is_err()); // active + reason
    }

    #[test]
    fn consent_validation_requires_audit_events() {
        let mut r = valid_receipt();
        r.audit_events = vec![];
        assert!(validate_consent_receipt(&r).is_err());
    }

    // --- preflight ---

    #[test]
    fn preflight_happy_path() {
        let actual = hex_64('a');
        assert!(consent_preflight(&valid_receipt(), &actual).is_ok());
    }

    #[test]
    fn preflight_denied_when_revoked() {
        let mut r = valid_receipt();
        r.status = "revoked".to_string();
        r.revoked_at = Some("2026-11-12T00:00:00Z".to_string());
        r.revoke_reason = Some("Withdrawn.".to_string());
        assert!(validate_consent_receipt(&r).is_ok()); // shape is fine
        assert!(consent_preflight(&r, &hex_64('a')).is_err()); // gate still denies
    }

    #[test]
    fn preflight_denied_when_artifact_hash_mismatches() {
        assert!(consent_preflight(&valid_receipt(), &hex_64('f')).is_err());
    }

    #[test]
    fn preflight_denied_when_scope_lacks_voice() {
        let mut r = valid_receipt();
        r.scope = vec!["face".to_string()];
        assert!(consent_preflight(&r, &hex_64('a')).is_err());
    }

    // --- script validation ---

    #[test]
    fn script_validation_happy_path() {
        assert!(validate_script(&valid_script()).is_ok());
    }

    #[test]
    fn script_validation_rejects_overlap() {
        let mut s = valid_script();
        s.segments[1].capture_start_sec = 9.0; // overlaps segment 0 (ends 10.0)
        assert!(validate_script(&s).is_err());
    }

    #[test]
    fn script_validation_rejects_out_of_range_end() {
        let mut s = valid_script();
        s.segments[1].capture_end_sec = 46.0; // beyond 45.0 duration
        assert!(validate_script(&s).is_err());
    }

    #[test]
    fn script_validation_rejects_empty_text() {
        let mut s = valid_script();
        s.segments[0].text = "   ".to_string();
        assert!(validate_script(&s).is_err());
    }

    #[test]
    fn script_validation_rejects_duplicate_step_id() {
        let mut s = valid_script();
        s.segments[1].step_id = "step-1".to_string();
        assert!(validate_script(&s).is_err());
    }

    #[test]
    fn script_validation_rejects_unsorted_segments() {
        let mut s = valid_script();
        s.segments.swap(0, 1);
        assert!(validate_script(&s).is_err());
    }

    #[test]
    fn script_validation_rejects_bad_version_empty_and_bad_bounds() {
        let mut s = valid_script();
        s.version = 2;
        assert!(validate_script(&s).is_err());
        let mut s = valid_script();
        s.segments = vec![];
        assert!(validate_script(&s).is_err());
        let mut s = valid_script();
        s.segments[0].capture_start_sec = -1.0;
        assert!(validate_script(&s).is_err());
        let mut s = valid_script();
        s.segments[0].capture_end_sec = 0.0; // end must be > start (0.0)
        assert!(validate_script(&s).is_err());
        let mut s = valid_script();
        s.segments[0].text = "x".repeat(MAX_SEGMENT_TEXT_CHARS + 1);
        assert!(validate_script(&s).is_err());
    }

    // --- job id + script hash ---

    #[test]
    fn job_id_is_deterministic_and_sensitive() {
        let a = canonical_job_id(
            "tyler-welch",
            1,
            MODEL_ID_OPENVOICE_V2,
            MODEL_VERSION_V2,
            &hex_64('b'),
            &hex_64('a'),
            &hex_64('c'),
        );
        let b = canonical_job_id(
            "tyler-welch",
            1,
            MODEL_ID_OPENVOICE_V2,
            MODEL_VERSION_V2,
            &hex_64('b'),
            &hex_64('a'),
            &hex_64('c'),
        );
        assert_eq!(a, b);
        assert!(a.starts_with("narr-"));
        assert_eq!(a.len(), "narr-".len() + 16);
        // Every single input changes the id.
        assert_ne!(
            a,
            canonical_job_id(
                "josh-morgan",
                1,
                MODEL_ID_OPENVOICE_V2,
                MODEL_VERSION_V2,
                &hex_64('b'),
                &hex_64('a'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                2,
                MODEL_ID_OPENVOICE_V2,
                MODEL_VERSION_V2,
                &hex_64('b'),
                &hex_64('a'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                1,
                "other-model",
                MODEL_VERSION_V2,
                &hex_64('b'),
                &hex_64('a'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                1,
                MODEL_ID_OPENVOICE_V2,
                "other-version",
                &hex_64('b'),
                &hex_64('a'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                1,
                MODEL_ID_OPENVOICE_V2,
                MODEL_VERSION_V2,
                &hex_64('d'),
                &hex_64('a'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                1,
                MODEL_ID_OPENVOICE_V2,
                MODEL_VERSION_V2,
                &hex_64('b'),
                &hex_64('e'),
                &hex_64('c')
            )
        );
        assert_ne!(
            a,
            canonical_job_id(
                "tyler-welch",
                1,
                MODEL_ID_OPENVOICE_V2,
                MODEL_VERSION_V2,
                &hex_64('b'),
                &hex_64('a'),
                &hex_64('f')
            )
        );
    }

    #[test]
    fn script_sha256_is_stable_and_hex() {
        let s = valid_script();
        let h1 = script_sha256(&s);
        let h2 = script_sha256(&s);
        assert_eq!(h1, h2);
        assert!(is_sha256_hex(&h1));
        let mut changed = valid_script();
        changed.segments[0].text = "Different words.".to_string();
        assert_ne!(script_sha256(&changed), h1);
    }

    /// Cross-language pin: the Python sidecar recomputes this exact hash
    /// from the same fixture (`narration_lib.canonical_script_sha256`,
    /// empty-`job_id` canonical form). If this test fails, the two sides
    /// disagree on the canonical JSON and the runner's binding gate will
    /// reject every job — fix the canonicalization, never the pin.
    /// Fixture note: the `source_evidence` strings contain a non-ASCII
    /// en dash (U+2013), exercising the UTF-8 (not `\uXXXX`) path.
    #[test]
    fn script_sha256_matches_python_canonicalization() {
        let script = NarrationScript {
            version: 1,
            job_id: String::new(),
            presenter_id: "tyler-welch".to_string(),
            capture_duration_sec: 45.0,
            segments: vec![
                NarrationSegment {
                    step_id: "s1".to_string(),
                    text: "Open the valve.".to_string(),
                    source_evidence: "transcript 00:00\u{2013}00:04".to_string(),
                    capture_start_sec: 0.0,
                    capture_end_sec: 4.2,
                    audio_hash: None,
                    correction: None,
                },
                NarrationSegment {
                    step_id: "s2".to_string(),
                    text: "Check the gauge.".to_string(),
                    source_evidence: "transcript 00:04\u{2013}00:12".to_string(),
                    capture_start_sec: 4.2,
                    capture_end_sec: 12.5,
                    audio_hash: None,
                    correction: None,
                },
            ],
        };
        assert_eq!(
            script_sha256(&script),
            "20365a7f6b97b835e373964a13e9498738ca347643f924db08eaf36161c1d34b"
        );
    }

    // --- render manifest ---

    #[test]
    fn render_manifest_validation_happy_path() {
        assert!(validate_render_manifest(&valid_render_manifest()).is_ok());
    }

    #[test]
    fn render_manifest_rejects_bad_ffmpeg_command() {
        let mut m = valid_render_manifest();
        m.ffmpeg_command = "".to_string();
        assert!(validate_render_manifest(&m).is_err());
        let mut m = valid_render_manifest();
        m.ffmpeg_command = "avconv -i in.mp4 out.mp4".to_string();
        assert!(validate_render_manifest(&m).is_err());
    }

    #[test]
    fn render_manifest_rejects_missing_hash_keys() {
        let mut m = valid_render_manifest();
        m.input_hashes.remove("script_sha256");
        assert!(validate_render_manifest(&m).is_err());
        let mut m = valid_render_manifest();
        m.model_hashes.remove("weights_sha256");
        assert!(validate_render_manifest(&m).is_err());
        let mut m = valid_render_manifest();
        m.output_hash = "short".to_string();
        assert!(validate_render_manifest(&m).is_err());
        let mut m = valid_render_manifest();
        m.version = 2;
        assert!(validate_render_manifest(&m).is_err());
        let mut m = valid_render_manifest();
        m.consent_receipt_version = 0;
        assert!(validate_render_manifest(&m).is_err());
    }

    // --- acceptance ---

    #[test]
    fn acceptance_pass_only_when_both_approve() {
        assert_eq!(acceptance_verdict(&valid_acceptance()), "PASS");
        let mut r = valid_acceptance();
        r.presenter_decision = "rejected".to_string();
        assert_eq!(acceptance_verdict(&r), "FAIL");
        let mut r = valid_acceptance();
        r.reviewer_decision = "rejected".to_string();
        assert_eq!(acceptance_verdict(&r), "FAIL");
        let mut r = valid_acceptance();
        r.output_sha256 = "not-a-hash".to_string();
        assert_eq!(acceptance_verdict(&r), "FAIL");
    }

    // --- revocation ---

    #[test]
    fn revocation_plan_deletes_only_derived_assets() {
        let enrollment = valid_enrollment();
        let queued = vec!["narr-aaa".to_string(), "narr-bbb".to_string()];
        let outputs = vec![
            ManagedOutputRecord {
                job_id: "narr-active-1".to_string(),
                presenter_id: "tyler-welch".to_string(),
                output_file: "out1.mp4".to_string(),
                output_sha256: hex_64('e'),
                status: "active".to_string(),
                published_at: Some("2026-11-12T08:00:00Z".to_string()),
                saved_to_forge: true,
            },
            ManagedOutputRecord {
                job_id: "narr-revoked-1".to_string(),
                presenter_id: "tyler-welch".to_string(),
                output_file: "out2.mp4".to_string(),
                output_sha256: hex_64('f'),
                status: "consent_revoked".to_string(),
                published_at: None,
                saved_to_forge: false,
            },
            ManagedOutputRecord {
                job_id: "narr-other-1".to_string(),
                presenter_id: "josh-morgan".to_string(),
                output_file: "out3.mp4".to_string(),
                output_sha256: hex_64('a'),
                status: "active".to_string(),
                published_at: None,
                saved_to_forge: false,
            },
        ];
        let receipt = revocation_plan(
            "tyler-welch",
            &enrollment,
            &queued,
            &outputs,
            "2026-11-12T12:00:00Z",
            "Presenter withdrew consent.",
        );
        assert_eq!(receipt.version, 1);
        assert_eq!(receipt.presenter_id, "tyler-welch");
        assert_eq!(receipt.revoked_at, "2026-11-12T12:00:00Z");
        assert_eq!(receipt.reason, "Presenter withdrew consent.");
        // Only the derived assets: reference clip + embedding.
        assert_eq!(
            receipt.deleted_assets,
            vec![
                "enrollment/tyler-welch/reference.wav".to_string(),
                "enrollment/tyler-welch/embedding.pt".to_string(),
            ]
        );
        // Never the consent artifact, source capture, or audit log.
        for forbidden in [
            "consent/tyler-welch-consent.mp4",
            "capture.mp4",
            "audit.log",
        ] {
            assert!(
                !receipt.deleted_assets.iter().any(|a| a.contains(forbidden)),
                "deleted_assets must never contain {forbidden}"
            );
        }
        assert_eq!(receipt.blocked_jobs, queued);
        // Only this presenter's ACTIVE outputs are unpublished.
        assert_eq!(receipt.unpublished_outputs, vec!["narr-active-1".to_string()]);
        assert_eq!(receipt.audit_events.len(), 1);
        assert_eq!(receipt.audit_events[0].event, "consent_revoked");
        assert_eq!(receipt.audit_events[0].at, "2026-11-12T12:00:00Z");
        assert!(receipt.audit_events[0].detail.contains('2')); // 2 deleted, 2 blocked
        assert!(receipt.audit_events[0].detail.contains('1')); // 1 unpublished
    }

    #[test]
    fn revocation_plan_without_embedding_deletes_only_clip() {
        let mut enrollment = valid_enrollment();
        enrollment.speaker_embedding_path = None;
        let receipt = revocation_plan(
            "tyler-welch",
            &enrollment,
            &[],
            &[],
            "2026-11-12T12:00:00Z",
            "Withdrawn.",
        );
        assert_eq!(
            receipt.deleted_assets,
            vec!["enrollment/tyler-welch/reference.wav".to_string()]
        );
        assert!(receipt.blocked_jobs.is_empty());
        assert!(receipt.unpublished_outputs.is_empty());
    }

    // --- status reuse + serialization ---

    #[test]
    fn narration_status_reuses_ai_edit_priority() {
        assert_eq!(
            narration_status_from_presence(true, false, false, false, false),
            Some("queued")
        );
        assert_eq!(
            narration_status_from_presence(true, false, true, false, false),
            Some("done")
        );
        assert_eq!(
            narration_status_from_presence(false, false, false, false, false),
            None
        );
    }

    #[test]
    fn structs_round_trip_through_json_with_exact_field_names() {
        let receipt = valid_receipt();
        let json = serde_json::to_string(&receipt).unwrap();
        assert!(json.contains("\"presenter_id\":\"tyler-welch\""));
        assert!(json.contains("\"consent_artifact_path\""));
        assert!(json.contains("\"artifact_sha256\""));
        let back: ConsentReceipt = serde_json::from_str(&json).unwrap();
        assert_eq!(receipt, back);

        let script = valid_script();
        let json = serde_json::to_string(&script).unwrap();
        assert!(json.contains("\"capture_start_sec\""));
        let back: NarrationScript = serde_json::from_str(&json).unwrap();
        assert_eq!(script, back);

        let manifest = NarrationJobManifest {
            version: 1,
            job_id: "narr-0123456789abcdef".to_string(),
            job_type: JOB_TYPE_NARRATE.to_string(),
            presenter_id: "tyler-welch".to_string(),
            consent_receipt_version: 1,
            capture_file: "capture.mp4".to_string(),
            capture_path: "library/capture.mp4".to_string(),
            capture_sha256: hex_64('a'),
            model_id: MODEL_ID_OPENVOICE_V2.to_string(),
            model_version: MODEL_VERSION_V2.to_string(),
            script_sha256: hex_64('b'),
            created_at: "2026-11-12T08:00:00Z".to_string(),
            status: "queued".to_string(),
        };
        let json = serde_json::to_string(&manifest).unwrap();
        let back: NarrationJobManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(manifest, back);
        assert_eq!(back.job_type, "narrate");
        assert_eq!(NARRATION_DIR, "narration");
    }

    #[test]
    fn constants_match_the_pinned_scope() {
        assert_eq!(MODEL_ID_OPENVOICE_V2, "openvoice-v2");
        assert_eq!(MODEL_VERSION_V2, "checkpoints_v2_0417");
        assert_eq!(
            OPENVOICE_CODE_COMMIT,
            "74a1d147b17a8c3092dd5430504bd83ef6c7eb23"
        );
        assert_eq!(
            MELOTTS_CODE_COMMIT,
            "209145371cff8fc3bd60d7be902ea69cbdb7965a"
        );
        assert_eq!(MAX_SEGMENTS, 1000);
        assert_eq!(MAX_SEGMENT_TEXT_CHARS, 5000);
        // Pinned weights hash: the deterministic checkpoints zip
        // (Hugging Face myshell-ai/OpenVoice @ c70fc8b9... + the six
        // English ses embeddings from myshell-ai/OpenVoiceV2 @
        // f36e7edf...; fifteen files, fix round 3).
        assert!(is_sha256_hex(CHECKPOINTS_ZIP_SHA256));
        assert_eq!(
            CHECKPOINTS_ZIP_SHA256,
            "cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020"
        );
    }

    // --- revocation transaction (P1-2) ---

    fn unique_suffix() -> u64 {
        static COUNTER: std::sync::atomic::AtomicU64 =
            std::sync::atomic::AtomicU64::new(0);
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "forge-narration-test-{}-{}",
            std::process::id(),
            unique_suffix()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_json<T: Serialize>(path: &Path, value: &T) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, serde_json::to_string_pretty(value).unwrap()).unwrap();
    }

    fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> T {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        digest.iter().map(|b| format!("{b:02x}")).collect()
    }

    struct RevocationFixture {
        root: std::path::PathBuf,
        presenter_dir: std::path::PathBuf,
        queued_job_id: String,
        processing_job_id: String,
        managed_job_id: String,
    }

    /// Full spool: active consent + enrollment (reference.wav +
    /// speaker_embedding.json), one queued job, one processing job, one
    /// active managed output.
    fn revocation_fixture() -> RevocationFixture {
        let root = temp_dir();
        let presenter_dir = root.join("presenters").join("tyler-welch");
        std::fs::create_dir_all(&presenter_dir).unwrap();
        write_json(&presenter_dir.join("consent.json"), &valid_receipt());
        let mut enrollment = valid_enrollment();
        enrollment.reference_clip_path = "reference.wav".to_string();
        enrollment.speaker_embedding_path = Some("speaker_embedding.json".to_string());
        write_json(&presenter_dir.join("enrollment.json"), &enrollment);
        std::fs::write(presenter_dir.join("reference.wav"), b"fake reference audio")
            .unwrap();
        std::fs::write(
            presenter_dir.join("speaker_embedding.json"),
            b"fake embedding",
        )
        .unwrap();
        let queued_job_id = "narr-aaaaaaaaaaaaaaaa".to_string();
        let processing_job_id = "narr-cccccccccccccccc".to_string();
        for (job_id, marker) in [
            (&queued_job_id, ".queued"),
            (&processing_job_id, ".processing"),
        ] {
            let job_dir = root.join("jobs").join(job_id);
            std::fs::create_dir_all(&job_dir).unwrap();
            write_json(
                &job_dir.join("job.json"),
                &NarrationJobManifest {
                    version: 1,
                    job_id: job_id.clone(),
                    job_type: JOB_TYPE_NARRATE.to_string(),
                    presenter_id: "tyler-welch".to_string(),
                    consent_receipt_version: 1,
                    capture_file: "capture.mp4".to_string(),
                    capture_path: "library/capture.mp4".to_string(),
                    capture_sha256: hex_64('a'),
                    model_id: MODEL_ID_OPENVOICE_V2.to_string(),
                    model_version: MODEL_VERSION_V2.to_string(),
                    script_sha256: hex_64('b'),
                    created_at: "2026-11-12T08:00:00Z".to_string(),
                    status: "queued".to_string(),
                },
            );
            std::fs::write(job_dir.join(marker), b"").unwrap();
        }
        let managed_job_id = "narr-bbbbbbbbbbbbbbbb".to_string();
        write_json(
            &root.join("managed-outputs.json"),
            &serde_json::json!({ "version": 1, "outputs": [ManagedOutputRecord {
                job_id: managed_job_id.clone(),
                presenter_id: "tyler-welch".to_string(),
                output_file: "out.mp4".to_string(),
                output_sha256: hex_64('e'),
                status: "active".to_string(),
                published_at: Some("2026-11-12T08:00:00Z".to_string()),
                saved_to_forge: true,
            }] }),
        );
        RevocationFixture {
            root,
            presenter_dir,
            queued_job_id,
            processing_job_id,
            managed_job_id,
        }
    }

    fn read_pending_state(presenter_dir: &Path) -> RevocationState {
        read_json(&presenter_dir.join(REVOCATION_PENDING_FILE))
    }

    fn read_consent(presenter_dir: &Path) -> ConsentReceipt {
        read_json(&presenter_dir.join("consent.json"))
    }

    fn read_managed_outputs_doc(root: &Path) -> Vec<ManagedOutputRecord> {
        let doc: serde_json::Value = read_json(&root.join("managed-outputs.json"));
        serde_json::from_value(doc["outputs"].clone()).unwrap()
    }

    #[test]
    fn revocation_transaction_happy_path() {
        let fx = revocation_fixture();
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Presenter withdrew consent.")
                .unwrap();
        // The receipt lists CONFIRMED effects only.
        assert_eq!(
            receipt.deleted_assets,
            vec![
                "reference.wav".to_string(),
                "speaker_embedding.json".to_string(),
            ]
        );
        assert_eq!(receipt.blocked_jobs, vec![fx.queued_job_id.clone()]);
        assert_eq!(
            receipt.unpublished_outputs,
            vec![fx.managed_job_id.clone()]
        );
        assert_eq!(receipt.presenter_id, "tyler-welch");
        assert_eq!(receipt.reason, "Presenter withdrew consent.");
        assert!(!receipt.revoked_at.is_empty());
        assert_eq!(receipt.audit_events.len(), 1);
        assert_eq!(receipt.audit_events[0].event, "consent_revoked");

        // Consent + enrollment are revoked; derived assets are gone.
        let consent = read_consent(&fx.presenter_dir);
        assert_eq!(consent.status, "revoked");
        assert_eq!(consent.revoked_at.as_deref(), Some(receipt.revoked_at.as_str()));
        assert_eq!(
            consent.revoke_reason.as_deref(),
            Some("Presenter withdrew consent.")
        );
        let enrollment: VoiceEnrollment = read_json(&fx.presenter_dir.join("enrollment.json"));
        assert_eq!(enrollment.status, "revoked");
        assert!(!fx.presenter_dir.join("reference.wav").exists());
        assert!(!fx.presenter_dir.join("speaker_embedding.json").exists());

        // Queued job is blocked with an explicit failure.
        let job_dir = fx.root.join("jobs").join(&fx.queued_job_id);
        assert!(!job_dir.join(".queued").exists());
        assert!(job_dir.join(".failed").exists());
        let failed: NarrationResult = read_json(&job_dir.join("result.json"));
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.failure_reason.as_deref(), Some("consent_revoked"));
        assert_eq!(failed.job_id, fx.queued_job_id);

        // The processing job is untouched (runner's completion re-check
        // handles it), and the managed output is unpublished.
        let processing_dir = fx.root.join("jobs").join(&fx.processing_job_id);
        assert!(processing_dir.join(".processing").exists());
        assert!(!processing_dir.join("result.json").exists());
        let outputs = read_managed_outputs_doc(&fx.root);
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].status, "consent_revoked");

        // Pending state removed; receipt file published and identical to
        // the returned receipt; audit appended with the processing job.
        assert!(!fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
        let stamp = receipt.revoked_at.replace(['-', ':'], "");
        let filed: RevocationReceipt =
            read_json(&fx.presenter_dir.join(format!("revocation-{stamp}.json")));
        assert_eq!(filed, receipt);
        let audit = std::fs::read_to_string(fx.root.join("audit").join("audit-log.jsonl"))
            .unwrap();
        assert!(audit.contains("consent_revoked"));
        assert!(audit.contains(&fx.processing_job_id));
        assert!(audit.contains("processing_at_revocation"));
    }

    #[test]
    fn revocation_transaction_deletion_fault_is_restartable() {
        let fx = revocation_fixture();
        // Make the reference clip undeletable: a directory in its place,
        // so remove_file fails.
        std::fs::remove_file(fx.presenter_dir.join("reference.wav")).unwrap();
        std::fs::create_dir(fx.presenter_dir.join("reference.wav")).unwrap();
        let err = execute_revocation(&fx.root, "tyler-welch", "Presenter withdrew consent.")
            .unwrap_err();
        assert!(
            err.contains("reference.wav"),
            "error names the failed asset: {err}"
        );
        // Pending state retained with the failure recorded; nothing is
        // confirmed deleted. Consent was already marked revoked before
        // the failure — the retry resumes from that state.
        let state = read_pending_state(&fx.presenter_dir);
        assert_eq!(state.status, "pending");
        assert!(state
            .last_error
            .as_ref()
            .is_some_and(|e| e.contains("reference.wav")));
        assert!(state.confirmed_deleted_assets.is_empty());
        assert_eq!(read_consent(&fx.presenter_dir).status, "revoked");
        assert!(fx.presenter_dir.join("reference.wav").is_dir());

        // Fix the fault and re-run: the transaction completes.
        std::fs::remove_dir(fx.presenter_dir.join("reference.wav")).unwrap();
        std::fs::write(fx.presenter_dir.join("reference.wav"), b"fake reference audio")
            .unwrap();
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Presenter withdrew consent.")
                .unwrap();
        assert_eq!(
            receipt.deleted_assets,
            vec![
                "reference.wav".to_string(),
                "speaker_embedding.json".to_string(),
            ]
        );
        assert_eq!(receipt.blocked_jobs, vec![fx.queued_job_id.clone()]);
        assert!(!fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
        assert!(!fx.presenter_dir.join("reference.wav").exists());
        assert!(!fx.presenter_dir.join("speaker_embedding.json").exists());
    }

    #[test]
    fn revocation_transaction_result_write_fault_is_restartable() {
        let fx = revocation_fixture();
        // A directory where the queued job's result.json must land, so
        // the two-phase write cannot finalize.
        let job_dir = fx.root.join("jobs").join(&fx.queued_job_id);
        std::fs::create_dir(job_dir.join("result.json")).unwrap();
        let err =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap_err();
        assert!(
            err.contains("result.json"),
            "error names the failed write: {err}"
        );
        // Pending state retained; the job is NOT confirmed blocked even
        // though its .queued marker was already removed.
        let state = read_pending_state(&fx.presenter_dir);
        assert!(state
            .last_error
            .as_ref()
            .is_some_and(|e| e.contains("result.json")));
        assert!(!state.confirmed_blocked_jobs.contains(&fx.queued_job_id));
        assert!(!job_dir.join(".queued").exists());

        // Fix the fault and re-run: the job is blocked.
        std::fs::remove_dir(job_dir.join("result.json")).unwrap();
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        assert_eq!(receipt.blocked_jobs, vec![fx.queued_job_id.clone()]);
        assert!(!fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
        let failed: NarrationResult = read_json(&job_dir.join("result.json"));
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.failure_reason.as_deref(), Some("consent_revoked"));
        assert!(job_dir.join(".failed").exists());
    }

    #[test]
    fn revocation_transaction_managed_outputs_fault_is_restartable() {
        let fx = revocation_fixture();
        // A directory where managed-outputs.json must be read, so the
        // plan cannot even be computed.
        std::fs::remove_file(fx.root.join("managed-outputs.json")).unwrap();
        std::fs::create_dir(fx.root.join("managed-outputs.json")).unwrap();
        let err =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap_err();
        assert!(
            err.contains("managed outputs"),
            "error names managed outputs: {err}"
        );
        // The pending state was recorded and the consent gate closed
        // BEFORE the plan was built (fix round 2: the inventory must
        // be taken after the gate closes), so the failed run leaves a
        // resumable pending state and a revoked consent — not a
        // pristine spool. The retry below rebuilds the plan instead
        // of trusting the empty lists.
        assert!(fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
        assert_eq!(read_consent(&fx.presenter_dir).status, "revoked");
        let pending = read_pending_state(&fx.presenter_dir);
        assert!(!pending.plan_ready);
        assert!(
            pending
                .last_error
                .as_deref()
                .unwrap_or("")
                .contains("managed outputs"),
            "pending state records the failure: {:?}",
            pending.last_error
        );

        // Fix the fault and re-run: the transaction completes.
        std::fs::remove_dir(fx.root.join("managed-outputs.json")).unwrap();
        write_json(
            &fx.root.join("managed-outputs.json"),
            &serde_json::json!({ "version": 1, "outputs": [ManagedOutputRecord {
                job_id: fx.managed_job_id.clone(),
                presenter_id: "tyler-welch".to_string(),
                output_file: "out.mp4".to_string(),
                output_sha256: hex_64('e'),
                status: "active".to_string(),
                published_at: Some("2026-11-12T08:00:00Z".to_string()),
                saved_to_forge: true,
            }] }),
        );
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        assert_eq!(
            receipt.unpublished_outputs,
            vec![fx.managed_job_id.clone()]
        );
        assert_eq!(read_managed_outputs_doc(&fx.root)[0].status, "consent_revoked");
    }

    #[test]
    fn revocation_transaction_audit_fault_is_restartable() {
        let fx = revocation_fixture();
        // A regular file where the audit directory must be, so the audit
        // append fails after the receipt file is written.
        std::fs::write(fx.root.join("audit"), b"not a directory").unwrap();
        let err =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap_err();
        assert!(err.contains("audit"), "error names the audit log: {err}");
        // Pending state retained with the failure recorded; the receipt
        // file was already written but the transaction is not complete.
        let state = read_pending_state(&fx.presenter_dir);
        assert!(state
            .last_error
            .as_ref()
            .is_some_and(|e| e.contains("audit")));
        assert!(!state.receipt_published);
        let stamp = state.revoked_at.replace(['-', ':'], "");
        assert!(fx
            .presenter_dir
            .join(format!("revocation-{stamp}.json"))
            .exists());

        // Fix the fault and re-run: the transaction completes, the audit
        // event is appended exactly once, and the pending state is gone.
        std::fs::remove_file(fx.root.join("audit")).unwrap();
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        assert!(!fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
        let audit = std::fs::read_to_string(fx.root.join("audit").join("audit-log.jsonl"))
            .unwrap();
        assert_eq!(audit.matches("consent_revoked").count(), 1);
        assert!(audit.contains(&receipt.revoked_at));
    }

    #[test]
    fn revocation_second_run_without_pending_errors_already_revoked() {
        let fx = revocation_fixture();
        execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        let err = execute_revocation(&fx.root, "tyler-welch", "Withdrawn again.")
            .unwrap_err();
        assert!(err.contains("already revoked"), "second revoke errors: {err}");
    }

    #[test]
    fn revocation_without_enrollment_still_revokes_consent() {
        let fx = revocation_fixture();
        std::fs::remove_file(fx.presenter_dir.join("enrollment.json")).unwrap();
        let receipt =
            execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        assert_eq!(read_consent(&fx.presenter_dir).status, "revoked");
        // The conventional reference.wav path is still deleted.
        assert_eq!(receipt.deleted_assets, vec!["reference.wav".to_string()]);
        assert!(!fx.presenter_dir.join("reference.wav").exists());
    }

    // --- presenter lock + revocation/concurrency (P1 fix round 2) ---

    #[test]
    fn presenter_lock_is_exclusive_and_released_on_drop() {
        let root = temp_dir();
        let lock = acquire_presenter_lock(&root, "tyler-welch").unwrap();
        // A second acquisition with a short timeout fails closed
        // instead of waiting out the production 30 s.
        let err = acquire_presenter_lock_with_timeout(
            &root,
            "tyler-welch",
            std::time::Duration::from_millis(200),
        )
        .unwrap_err();
        assert!(err.contains("timed out"), "error names the timeout: {err}");
        // Releasing the first guard frees the presenter.
        drop(lock);
        let _lock2 = acquire_presenter_lock(&root, "tyler-welch").unwrap();
    }

    #[test]
    fn presenter_lock_is_per_presenter() {
        let root = temp_dir();
        let _lock = acquire_presenter_lock(&root, "tyler-welch").unwrap();
        // Another presenter is unaffected by the first presenter's lock.
        let _lock2 = acquire_presenter_lock(&root, "josh-morgan").unwrap();
    }

    #[test]
    fn presenter_lock_rejects_invalid_presenter_id() {
        let root = temp_dir();
        let err = acquire_presenter_lock(&root, "../escape").unwrap_err();
        assert!(err.contains("invalid presenter id"), "{err}");
    }

    /// Simulate the Python runner's completion publication as the
    /// verdict describes it: the runner finished its render while
    /// consent was active, then publishes result.json + the managed
    /// output record + .done. The whole publication happens under the
    /// presenter lock, exactly as the runner does it.
    fn simulate_runner_publication(root: &Path, job_id: &str) {
        let job_dir = root.join("jobs").join(job_id);
        write_json(
            &job_dir.join("result.json"),
            &serde_json::json!({
                "version": 1,
                "job_id": job_id,
                "status": "done",
                "segments": [],
                "render": {
                    "output_file": "output.mp4",
                    "output_sha256": hex_64('e'),
                    "output_bytes": 1234,
                    "ffmpeg_version": "7.1",
                    "ffmpeg_command": "ffmpeg -i x -c:v copy out.mp4",
                    "captions_file": "captions.vtt",
                    "render_sec": 1.0,
                },
                "resources": {"peak_vram_mib": null, "peak_ram_mib": null, "gpu": "test"},
                "outbound_requests": [],
                "model": {
                    "model_id": MODEL_ID_OPENVOICE_V2,
                    "model_version": MODEL_VERSION_V2,
                    "code_commit": OPENVOICE_CODE_COMMIT,
                    "weights_sha256": CHECKPOINTS_ZIP_SHA256,
                    "base_tts": "melotts",
                    "base_tts_commit": MELOTTS_CODE_COMMIT,
                },
                "consent_receipt_version": 1,
                "completed_at": "2026-11-12T09:00:00Z",
            }),
        );
        let mut outputs = read_managed_outputs_doc(root);
        outputs.push(ManagedOutputRecord {
            job_id: job_id.to_string(),
            presenter_id: "tyler-welch".to_string(),
            output_file: "out.mp4".to_string(),
            output_sha256: hex_64('e'),
            status: "active".to_string(),
            published_at: Some("2026-11-12T09:00:00Z".to_string()),
            saved_to_forge: false,
        });
        write_json(
            &root.join("managed-outputs.json"),
            &serde_json::json!({ "version": 1, "outputs": outputs }),
        );
        std::fs::remove_file(job_dir.join(".processing")).unwrap();
        std::fs::write(job_dir.join(".done"), b"").unwrap();
    }

    /// Simulate `narration_create_job`'s locked section: write the job
    /// manifest + .queued marker while holding the presenter lock.
    fn simulate_job_creation(root: &Path, job_id: &str) {
        let job_dir = root.join("jobs").join(job_id);
        std::fs::create_dir_all(&job_dir).unwrap();
        write_json(
            &job_dir.join("job.json"),
            &NarrationJobManifest {
                version: 1,
                job_id: job_id.to_string(),
                job_type: JOB_TYPE_NARRATE.to_string(),
                presenter_id: "tyler-welch".to_string(),
                consent_receipt_version: 1,
                capture_file: "capture.mp4".to_string(),
                capture_path: "library/capture.mp4".to_string(),
                capture_sha256: hex_64('a'),
                model_id: MODEL_ID_OPENVOICE_V2.to_string(),
                model_version: MODEL_VERSION_V2.to_string(),
                script_sha256: hex_64('b'),
                created_at: "2026-11-12T09:00:00Z".to_string(),
                status: "queued".to_string(),
            },
        );
        std::fs::write(job_dir.join(".queued"), b"").unwrap();
    }

    #[test]
    fn revocation_catches_completion_published_while_revocation_waited() {
        let fx = revocation_fixture();
        let job_id = fx.processing_job_id.clone();
        // The "runner" thread takes the lock first, then publishes
        // after a delay — the exact interleaving the verdict names:
        // the completion consent check passed while consent was still
        // active, and publication lands while revocation is waiting.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::scope(|s| {
            let root_ref = &fx.root;
            let job_ref = &job_id;
            s.spawn(move || {
                let _lock = acquire_presenter_lock(root_ref, "tyler-welch").unwrap();
                tx.send(()).unwrap();
                // Hold the lock briefly so revocation (below) must wait.
                std::thread::sleep(std::time::Duration::from_millis(200));
                simulate_runner_publication(root_ref, job_ref);
                // Lock released on drop here.
            });
            // Wait until the runner holds the lock, then revoke: the
            // call must block on the lock, then take its inventory
            // AFTER the gate closes — after the publication landed.
            rx.recv().unwrap();
            let receipt = execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
            // The just-published output is in the receipt: it did not
            // escape the plan.
            assert!(
                receipt.unpublished_outputs.contains(&job_id),
                "receipt must unpublish the output published during revocation: {receipt:?}"
            );
            let outputs = read_managed_outputs_doc(&fx.root);
            let rec = outputs.iter().find(|o| o.job_id == job_id).unwrap();
            assert_eq!(rec.status, "consent_revoked");
        });
    }

    #[test]
    fn revocation_catches_job_created_while_revocation_waited() {
        let fx = revocation_fixture();
        let job_id = "narr-dddddddddddddddd".to_string();
        // The "creator" thread takes the lock first, then creates the
        // job after a delay — the create/revoke race the verdict
        // names. Revocation must block on the lock, then see the new
        // queued job in its post-gate inventory and block it.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::scope(|s| {
            let root_ref = &fx.root;
            let job_ref = &job_id;
            s.spawn(move || {
                let _lock = acquire_presenter_lock(root_ref, "tyler-welch").unwrap();
                tx.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(200));
                simulate_job_creation(root_ref, job_ref);
            });
            rx.recv().unwrap();
            let receipt = execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
            assert!(
                receipt.blocked_jobs.contains(&job_id),
                "receipt must block the job created during revocation: {receipt:?}"
            );
            let job_dir = fx.root.join("jobs").join(&job_id);
            assert!(job_dir.join(".failed").exists());
            assert!(!job_dir.join(".queued").exists());
        });
    }

    #[test]
    fn revocation_resumes_when_pending_state_has_no_plan_yet() {
        let fx = revocation_fixture();
        // Simulate a crash after the pending state was recorded but
        // before the gate closed or the plan was built: empty plan,
        // plan_ready false, consent still active.
        write_json(
            &fx.presenter_dir.join(REVOCATION_PENDING_FILE),
            &RevocationState {
                version: 1,
                presenter_id: "tyler-welch".to_string(),
                revoked_at: "2026-11-12T09:00:00Z".to_string(),
                reason: "Withdrawn.".to_string(),
                planned_deleted_assets: Vec::new(),
                planned_blocked_jobs: Vec::new(),
                planned_unpublished_outputs: Vec::new(),
                confirmed_deleted_assets: Vec::new(),
                confirmed_blocked_jobs: Vec::new(),
                confirmed_unpublished_outputs: Vec::new(),
                processing_at_revocation: Vec::new(),
                status: REVOCATION_STATE_PENDING.to_string(),
                last_error: None,
                receipt_published: false,
                plan_ready: false,
            },
        );
        let receipt = execute_revocation(&fx.root, "tyler-welch", "A different reason.").unwrap();
        // The stored transaction identity wins over the caller's reason.
        assert_eq!(receipt.reason, "Withdrawn.");
        assert_eq!(receipt.blocked_jobs, vec![fx.queued_job_id.clone()]);
        assert_eq!(receipt.unpublished_outputs, vec![fx.managed_job_id.clone()]);
        assert_eq!(read_consent(&fx.presenter_dir).status, "revoked");
    }

    #[test]
    fn revocation_resumes_when_gate_closed_but_plan_never_built() {
        let fx = revocation_fixture();
        // Simulate a crash after consent was revoked but before the
        // plan was written: consent already revoked, pending state
        // with plan_ready false. A re-run must NOT error "already
        // revoked" — the pending state proves the transaction is
        // unfinished — and must build the plan and finish.
        let mut consent = read_consent(&fx.presenter_dir);
        consent.status = "revoked".to_string();
        consent.revoked_at = Some("2026-11-12T09:00:00Z".to_string());
        consent.revoke_reason = Some("Withdrawn.".to_string());
        write_json(&fx.presenter_dir.join("consent.json"), &consent);
        write_json(
            &fx.presenter_dir.join(REVOCATION_PENDING_FILE),
            &serde_json::json!({
                "version": 1,
                "presenter_id": "tyler-welch",
                "revoked_at": "2026-11-12T09:00:00Z",
                "reason": "Withdrawn.",
                "planned_deleted_assets": [],
                "planned_blocked_jobs": [],
                "planned_unpublished_outputs": [],
                "confirmed_deleted_assets": [],
                "confirmed_blocked_jobs": [],
                "confirmed_unpublished_outputs": [],
                "processing_at_revocation": [],
                "status": "pending",
                "last_error": null,
                "receipt_published": false
                // NOTE: no "plan_ready" key — a pre-fix-round-2 pending
                // state. It must parse (serde default false) and the
                // plan must be rebuilt, not trusted as empty.
            }),
        );
        let receipt = execute_revocation(&fx.root, "tyler-welch", "Withdrawn.").unwrap();
        assert_eq!(receipt.blocked_jobs, vec![fx.queued_job_id.clone()]);
        assert_eq!(receipt.unpublished_outputs, vec![fx.managed_job_id.clone()]);
        assert!(!fx.presenter_dir.join(REVOCATION_PENDING_FILE).exists());
    }

    // --- acceptance output verification (P1-3) ---

    /// A done job directory: output.mp4 + result.json + render-manifest.json
    /// all agreeing on the live output hash.
    fn acceptance_fixture() -> (std::path::PathBuf, NarrationResult, RenderManifest, String) {
        let job_dir = temp_dir();
        let output_bytes = b"fake narrated mp4 bytes";
        std::fs::write(job_dir.join("output.mp4"), output_bytes).unwrap();
        let hash = sha256_hex(output_bytes);
        let result = NarrationResult {
            version: 1,
            job_id: "narr-0123456789abcdef".to_string(),
            status: "done".to_string(),
            failure_reason: None,
            segments: vec![],
            render: Some(NarrationRenderResult {
                output_file: "output.mp4".to_string(),
                output_sha256: hash.clone(),
                output_bytes: output_bytes.len() as u64,
                ffmpeg_version: "7.1".to_string(),
                ffmpeg_command: "ffmpeg -i capture.mp4 -i narration.wav -c:v copy out.mp4"
                    .to_string(),
                captions_file: "captions.vtt".to_string(),
                render_sec: 1.5,
            }),
            resources: NarrationResources {
                peak_vram_mib: None,
                peak_ram_mib: None,
                gpu: "test-gpu".to_string(),
            },
            outbound_requests: vec![],
            model: NarrationModelReceipt {
                model_id: MODEL_ID_OPENVOICE_V2.to_string(),
                model_version: MODEL_VERSION_V2.to_string(),
                code_commit: OPENVOICE_CODE_COMMIT.to_string(),
                weights_sha256: hex_64('b'),
                base_tts: "melotts".to_string(),
                base_tts_commit: MELOTTS_CODE_COMMIT.to_string(),
            },
            consent_receipt_version: 1,
            completed_at: "2026-11-12T09:00:00Z".to_string(),
        };
        let mut manifest = valid_render_manifest();
        manifest.output_hash = hash.clone();
        write_json(&job_dir.join("render-manifest.json"), &manifest);
        (job_dir, result, manifest, hash)
    }

    #[test]
    fn verify_acceptance_output_happy_path() {
        let (job_dir, result, manifest, hash) = acceptance_fixture();
        let (live, returned) = verify_acceptance_output(&job_dir, &result).unwrap();
        assert_eq!(live, hash);
        assert_eq!(returned, manifest);
    }

    #[test]
    fn verify_acceptance_output_rejects_replaced_output() {
        let (job_dir, result, _manifest, _hash) = acceptance_fixture();
        std::fs::write(job_dir.join("output.mp4"), b"a completely different render")
            .unwrap();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(err.contains("does not match"), "replacement rejected: {err}");
    }

    #[test]
    fn verify_acceptance_output_rejects_corrupted_output() {
        let (job_dir, result, _manifest, _hash) = acceptance_fixture();
        let mut bytes = std::fs::read(job_dir.join("output.mp4")).unwrap();
        bytes[0] ^= 0xff; // flip one byte
        std::fs::write(job_dir.join("output.mp4"), bytes).unwrap();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(err.contains("does not match"), "corruption rejected: {err}");
    }

    #[test]
    fn verify_acceptance_output_rejects_manifest_mismatch() {
        let (job_dir, result, mut manifest, _hash) = acceptance_fixture();
        manifest.output_hash = hex_64('f'); // valid hex, but not the live hash
        write_json(&job_dir.join("render-manifest.json"), &manifest);
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("render manifest"),
            "manifest mismatch rejected: {err}"
        );
    }

    #[test]
    fn verify_acceptance_output_rejects_missing_output_file() {
        let (job_dir, result, _manifest, _hash) = acceptance_fixture();
        std::fs::remove_file(job_dir.join("output.mp4")).unwrap();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(err.contains("cannot open"), "missing output rejected: {err}");
    }

    #[test]
    fn verify_acceptance_output_rejects_missing_and_corrupt_manifest() {
        let (job_dir, result, _manifest, _hash) = acceptance_fixture();
        std::fs::remove_file(job_dir.join("render-manifest.json")).unwrap();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("no render-manifest.json"),
            "missing manifest rejected: {err}"
        );
        std::fs::write(job_dir.join("render-manifest.json"), b"{not json").unwrap();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("render manifest is corrupt"),
            "corrupt manifest rejected: {err}"
        );
    }

    #[test]
    fn verify_acceptance_output_rejects_traversal() {
        let (job_dir, mut result, mut manifest, _hash) = acceptance_fixture();
        // An escape file OUTSIDE the job dir whose hash matches the
        // recorded hashes: if the verifier ever hashed it, this test
        // would pass by accident — it must refuse before hashing.
        let escape_name = format!(
            "forge-narration-escape-{}-{}.mp4",
            std::process::id(),
            unique_suffix()
        );
        let escape_path = job_dir.parent().unwrap().join(&escape_name);
        let escape_bytes = b"bytes that live outside the job dir";
        std::fs::write(&escape_path, escape_bytes).unwrap();
        let escape_hash = sha256_hex(escape_bytes);
        result.render.as_mut().unwrap().output_sha256 = escape_hash.clone();
        manifest.output_hash = escape_hash;
        write_json(&job_dir.join("render-manifest.json"), &manifest);
        result.render.as_mut().unwrap().output_file = format!("../{escape_name}");
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("not a plain file name"),
            "traversal rejected: {err}"
        );
        // An absolute path is rejected too, without reading the file.
        result.render.as_mut().unwrap().output_file = job_dir
            .join("output.mp4")
            .to_string_lossy()
            .into_owned();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("not a plain file name"),
            "absolute path rejected: {err}"
        );
        // A backslash separator is rejected too.
        result.render.as_mut().unwrap().output_file = "subdir\\output.mp4".to_string();
        let err = verify_acceptance_output(&job_dir, &result).unwrap_err();
        assert!(
            err.contains("not a plain file name"),
            "backslash path rejected: {err}"
        );
        std::fs::remove_file(&escape_path).unwrap();
    }

    #[test]
    fn render_manifest_acceptance_receipt_path_round_trips() {
        let mut m = valid_render_manifest();
        m.acceptance_receipt = Some("PASS".to_string());
        m.acceptance_receipt_path = Some("acceptance.json".to_string());
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"acceptance_receipt_path\":\"acceptance.json\""));
        let back: RenderManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.acceptance_receipt_path.as_deref(),
            Some("acceptance.json")
        );
        assert_eq!(back.acceptance_receipt.as_deref(), Some("PASS"));
        // Old manifests without the field still parse, with None.
        let old = serde_json::json!({
            "version": 1,
            "job_id": "narr-0123456789abcdef",
            "input_hashes": {
                "capture_sha256": hex_64('a'),
                "script_sha256": hex_64('b'),
                "reference_audio_sha256": hex_64('c'),
            },
            "model_hashes": {
                "model_id": MODEL_ID_OPENVOICE_V2,
                "code_commit": OPENVOICE_CODE_COMMIT,
                "weights_sha256": hex_64('d'),
            },
            "ffmpeg_version": "7.1",
            "ffmpeg_command": "ffmpeg -i capture.mp4 out.mp4",
            "consent_receipt_version": 1,
            "output_hash": hex_64('e'),
            "caption_path": "narration/captions.vtt",
            "acceptance_receipt": null,
        });
        let parsed: RenderManifest = serde_json::from_value(old).unwrap();
        assert_eq!(parsed.acceptance_receipt_path, None);
    }
}
