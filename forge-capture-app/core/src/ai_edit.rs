//! AI Edit job contract — the local spool side of the "AI plugin".
//!
//! Design (honest, local-first): the Tauri app never touches the network.
//! An "AI Edit" request is spooled to a local directory; an *external*
//! runner (documented in `forge-capture-app/docs/ai-edit.md`) carries jobs
//! to the AI team and drops results back. This module owns the pure half of
//! that contract:
//!
//! - spool layout: `<base>/pending/<job>/`, `processing/`, `done/`, `failed/`
//! - job manifest (`job.json`) schema
//! - job-id validation (path-traversal safe)
//! - status resolution from directory presence
//! - versioned result stems (`<stem>-ai-edit`, `<stem>-ai-edit-2`, …)
//!
//! The Tauri shell (`app/src/main.rs`) performs the filesystem moves; the
//! AI runner contract lives in docs. Nothing here invents credentials.

use serde::{Deserialize, Serialize};

/// Spool subdirectories, in job lifecycle order.
pub const SPOOL_PENDING: &str = "pending";
pub const SPOOL_PROCESSING: &str = "processing";
pub const SPOOL_DONE: &str = "done";
pub const SPOOL_FAILED: &str = "failed";
pub const SPOOL_IMPORTED: &str = "imported";

/// Files inside each job directory.
pub const JOB_INPUT_PNG: &str = "input.png";
pub const JOB_PROMPT_TXT: &str = "prompt.txt";
pub const JOB_MANIFEST: &str = "job.json";
pub const JOB_RESULT_PNG: &str = "result.png";
pub const JOB_RESULT_JSON: &str = "result.json";
pub const JOB_ERROR_TXT: &str = "error.txt";

/// Maximum prompt length the spool accepts (chars).
pub const MAX_PROMPT_CHARS: usize = 2000;

/// Job lifecycle status, resolved from which spool subdirectory holds the job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiJobStatus {
    Queued,
    Processing,
    Done,
    Failed,
    Imported,
}

impl AiJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AiJobStatus::Queued => "queued",
            AiJobStatus::Processing => "processing",
            AiJobStatus::Done => "done",
            AiJobStatus::Failed => "failed",
            AiJobStatus::Imported => "imported",
        }
    }
}

/// The `job.json` manifest written with every spooled job. The runner reads
/// `prompt` and `input.png`; the app reads `status` transitions by directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiJobManifest {
    pub job_id: String,
    pub capture_id: String,
    pub prompt: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub created_at: String,
    pub status: String,
    /// The source capture's kind string (`"full-monitor"`, `"window"`,
    /// `"region"`, `"scrolling"`), recorded at submit time so the import
    /// can stamp honest provenance even after the in-memory capture store
    /// is gone (the store does not survive an app restart).
    pub source_kind: String,
}

impl AiJobManifest {
    pub fn new(
        job_id: &str,
        capture_id: &str,
        prompt: &str,
        created_at: &str,
        source_kind: &str,
    ) -> Self {
        AiJobManifest {
            job_id: job_id.to_string(),
            capture_id: capture_id.to_string(),
            prompt: prompt.to_string(),
            created_at: created_at.to_string(),
            status: AiJobStatus::Queued.as_str().to_string(),
            source_kind: source_kind.to_string(),
        }
    }
}

/// Job ids are `ai-<millis>-<counter>`: letters, digits, dashes only.
/// Anything else is rejected so a job id can never escape the spool
/// directory (`../` traversal is impossible by construction).
pub fn validate_job_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Validate an AI Edit prompt: non-blank, within the length cap.
pub fn validate_prompt(prompt: &str) -> Result<(), &'static str> {
    if prompt.trim().is_empty() {
        return Err("prompt is blank");
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("prompt exceeds the 2000-character cap");
    }
    Ok(())
}

/// Resolve a job's status from which spool subdirectory contains it.
/// Priority mirrors the lifecycle: a job found in `done` counts as done
/// even if a stale `pending` copy lingers.
pub fn status_from_presence(
    in_pending: bool,
    in_processing: bool,
    in_done: bool,
    in_failed: bool,
    in_imported: bool,
) -> Option<AiJobStatus> {
    if in_done {
        Some(AiJobStatus::Done)
    } else if in_failed {
        Some(AiJobStatus::Failed)
    } else if in_imported {
        Some(AiJobStatus::Imported)
    } else if in_processing {
        Some(AiJobStatus::Processing)
    } else if in_pending {
        Some(AiJobStatus::Queued)
    } else {
        None
    }
}

/// Versioned result stem for an imported AI edit: the source capture's stem
/// plus `-ai-edit`, with a numeric suffix when that stem is taken.
pub fn versioned_stem(source_stem: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let base = format!("{source_stem}-ai-edit");
    if !taken(&base) {
        return base;
    }
    let mut n = 2u32;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_id_validation_blocks_traversal() {
        assert!(validate_job_id("ai-1234567890-1"));
        assert!(validate_job_id("ai_1-2"));
        assert!(!validate_job_id(""));
        assert!(!validate_job_id("../evil"));
        assert!(!validate_job_id("ai/1"));
        assert!(!validate_job_id("ai\\1"));
        assert!(!validate_job_id("ai 1"));
        assert!(!validate_job_id("ai.1"));
        assert!(!validate_job_id(&"a".repeat(65)));
        assert!(validate_job_id(&"a".repeat(64)));
    }

    #[test]
    fn prompt_validation_rejects_blank_and_oversize() {
        assert!(validate_prompt("blur the address").is_ok());
        assert_eq!(validate_prompt("   ").unwrap_err(), "prompt is blank");
        assert_eq!(validate_prompt("").unwrap_err(), "prompt is blank");
        let long = "x".repeat(MAX_PROMPT_CHARS + 1);
        assert!(validate_prompt(&long).is_err());
        assert!(validate_prompt(&"x".repeat(MAX_PROMPT_CHARS)).is_ok());
    }

    #[test]
    fn status_resolution_follows_lifecycle_priority() {
        assert_eq!(
            status_from_presence(true, false, false, false, false),
            Some(AiJobStatus::Queued)
        );
        assert_eq!(
            status_from_presence(false, true, false, false, false),
            Some(AiJobStatus::Processing)
        );
        assert_eq!(
            status_from_presence(false, false, true, false, false),
            Some(AiJobStatus::Done)
        );
        assert_eq!(
            status_from_presence(false, false, false, true, false),
            Some(AiJobStatus::Failed)
        );
        assert_eq!(
            status_from_presence(false, false, false, false, true),
            Some(AiJobStatus::Imported)
        );
        // Stale pending copy does not shadow a terminal state.
        assert_eq!(
            status_from_presence(true, false, true, false, false),
            Some(AiJobStatus::Done)
        );
        assert_eq!(
            status_from_presence(false, false, false, false, false),
            None
        );
    }

    #[test]
    fn versioned_stem_appends_suffix_only_when_taken() {
        let taken_none = |_: &str| false;
        assert_eq!(
            versioned_stem("forge-capture-20260924-120000-region", &taken_none),
            "forge-capture-20260924-120000-region-ai-edit"
        );
        let taken_first = |s: &str| s.ends_with("-ai-edit");
        assert_eq!(versioned_stem("stem", &taken_first), "stem-ai-edit-2");
        let taken_two = |s: &str| s == "stem-ai-edit" || s == "stem-ai-edit-2";
        assert_eq!(versioned_stem("stem", &taken_two), "stem-ai-edit-3");
    }

    #[test]
    fn manifest_round_trips_through_json() {
        let m = AiJobManifest::new(
            "ai-1",
            "cap-2",
            "crop to the dialog",
            "2026-09-24T21:00:00Z",
            "region",
        );
        let json = serde_json::to_string(&m).unwrap();
        let back: AiJobManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
        assert_eq!(back.status, "queued");
        assert_eq!(back.source_kind, "region");
    }

    #[test]
    fn status_strings_are_stable_contracts() {
        assert_eq!(AiJobStatus::Queued.as_str(), "queued");
        assert_eq!(AiJobStatus::Processing.as_str(), "processing");
        assert_eq!(AiJobStatus::Done.as_str(), "done");
        assert_eq!(AiJobStatus::Failed.as_str(), "failed");
        assert_eq!(AiJobStatus::Imported.as_str(), "imported");
    }
}
