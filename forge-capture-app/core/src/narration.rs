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
//! in the Phase 3 scope brief) performs the filesystem moves, the TTS
//! generation, and the FFmpeg assembly; the Tauri shell owns the OS
//! boundary. Nothing here touches the network, the filesystem, or a
//! voice sample.
//!
//! Field names are contractual: the Python runner and the UI depend on
//! them exactly as written. Do not rename a field without updating both.
//!
//! Job status resolution reuses [`crate::ai_edit::status_from_presence`];
//! it is not reinvented here (see [`narration_status_from_presence`]).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

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
/// PLACEHOLDER — the live weights hash is not known yet: the environment
/// setup is still running on the iBUYPOWER and no verified weights file
/// exists to hash. Replace this exact string with the real 64-char
/// lowercase hex digest once the weights are downloaded and hashed on
/// the iBUYPOWER. Until then, any receipt carrying this value is
/// unverified and must not be treated as a pinned-weights proof.
pub const CHECKPOINTS_ZIP_SHA256: &str = "<FILL-FROM-RECEIPT>";

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
    let detail = format!(
        "Revoked consent for presenter {presenter_id}: deleted {} derived assets, blocked {} queued jobs, unpublished {} managed outputs. Source capture and audit log retained.",
        deleted_assets.len(),
        blocked_jobs.len(),
        unpublished_outputs.len()
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
        // Placeholder until the live weights hash is known.
        assert_eq!(CHECKPOINTS_ZIP_SHA256, "<FILL-FROM-RECEIPT>");
    }
}
