//! Meeting-mode transcription job contract — the local spool side of
//! "Meeting mode".
//!
//! Same honest, local-first design as [`crate::ai_edit`]: the Tauri app
//! never touches the network. Recording happens in the webview with the
//! platform MediaRecorder; the backend writes the audio bytes to the
//! library directory and spools a *transcription* job to the local
//! ai-spool. An *external* runner (documented in
//! `forge-capture-app/docs/meeting-mode.md`) carries jobs to the AI team
//! (local Whisper) and drops `result.json` back. This module owns the pure
//! half of that contract:
//!
//! - the `transcribe` job manifest (`job.json`) schema
//! - the `result.json` transcript schema + validated parsing
//! - language-hint validation
//! - transcript text assembly (timestamps + search)
//!
//! The Tauri shell (`app/src/main.rs`) performs the filesystem moves and
//! the chunked audio upload; the runner contract lives in docs. Nothing
//! here invents credentials. The transcriber itself is Koe Jr's lane —
//! this crate only defines what the runner must read and write.

use crate::ai_edit;
use serde::{Deserialize, Serialize};

/// Job-type discriminator written into every meeting manifest so the
/// runner (and any future job kinds sharing the spool) can tell
/// transcription jobs apart from AI Edit jobs.
pub const JOB_TYPE_TRANSCRIBE: &str = "transcribe";

/// Audio file carried inside the job directory (the runner's input).
pub const JOB_INPUT_AUDIO: &str = "input";
/// Transcript produced by the runner.
pub const JOB_RESULT_JSON: &str = "result.json";

/// Language hint meaning "let the model detect the language".
pub const LANGUAGE_AUTO: &str = "auto";

/// Hard cap on transcript segments accepted from a runner result.
pub const MAX_SEGMENTS: usize = 100_000;
/// Hard cap on a single segment's text (chars).
pub const MAX_SEGMENT_TEXT_CHARS: usize = 10_000;

/// The `job.json` manifest written with every spooled transcription job.
/// The runner reads `input.<ext>` + this manifest; the app resolves
/// `status` from directory presence via [`ai_edit::status_from_presence`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscribeJobManifest {
    pub job_id: String,
    pub job_type: String,
    pub meeting_id: String,
    /// Library-relative audio filename (e.g. `meeting-20260925-000500.webm`)
    /// — provenance for the app and the runner alike.
    pub audio_file: String,
    /// "auto" or a 2-3 letter language code ("en", "es", …).
    pub language_hint: String,
    /// ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub created_at: String,
    pub status: String,
}

impl TranscribeJobManifest {
    pub fn new(
        job_id: &str,
        meeting_id: &str,
        audio_file: &str,
        language_hint: &str,
        created_at: &str,
    ) -> Self {
        TranscribeJobManifest {
            job_id: job_id.to_string(),
            job_type: JOB_TYPE_TRANSCRIBE.to_string(),
            meeting_id: meeting_id.to_string(),
            audio_file: audio_file.to_string(),
            language_hint: language_hint.to_string(),
            created_at: created_at.to_string(),
            status: ai_edit::AiJobStatus::Queued.as_str().to_string(),
        }
    }
}

/// Validate a language hint: "auto" or 2-3 lowercase ASCII letters.
pub fn validate_language_hint(hint: &str) -> Result<(), &'static str> {
    if hint == LANGUAGE_AUTO {
        return Ok(());
    }
    let ok = (2..=3).contains(&hint.len())
        && hint.chars().all(|c| c.is_ascii_lowercase());
    if ok {
        Ok(())
    } else {
        Err("language hint must be \"auto\" or a 2-3 letter code like \"en\"")
    }
}

/// One transcript segment, as produced by the runner.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptSegment {
    /// Seconds from the start of the audio.
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// The runner's `result.json`, validated on import.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptResult {
    pub job_id: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub duration_sec: Option<f64>,
    pub segments: Vec<TranscriptSegment>,
    #[serde(default)]
    pub model: Option<String>,
}

/// Parse and validate a runner-produced `result.json`.
///
/// Validation is strict but honest: a silent meeting may legitimately
/// produce zero segments, so an empty array is accepted. Every segment
/// must have finite, non-negative timestamps with `start <= end`, and
/// text within the length cap. Anything else fails closed with a reason.
pub fn parse_transcript_result(
    job_id: &str,
    bytes: &[u8],
) -> Result<TranscriptResult, String> {
    let result: TranscriptResult = serde_json::from_slice(bytes)
        .map_err(|e| format!("transcript result.json is not valid JSON: {e}"))?;
    if result.job_id != job_id {
        return Err(format!(
            "transcript job_id mismatch: expected {job_id}, got {}",
            result.job_id
        ));
    }
    if !ai_edit::validate_job_id(&result.job_id) {
        return Err("transcript job_id is not a valid job id".to_string());
    }
    if result.segments.len() > MAX_SEGMENTS {
        return Err(format!(
            "transcript has {} segments, over the {} cap",
            result.segments.len(),
            MAX_SEGMENTS
        ));
    }
    if let Some(d) = result.duration_sec {
        if !d.is_finite() || d < 0.0 {
            return Err("transcript duration_sec must be a finite non-negative number".to_string());
        }
    }
    for (i, seg) in result.segments.iter().enumerate() {
        if !seg.start.is_finite() || !seg.end.is_finite() {
            return Err(format!("segment {i}: timestamps must be finite numbers"));
        }
        if seg.start < 0.0 || seg.end < 0.0 {
            return Err(format!("segment {i}: timestamps must be non-negative"));
        }
        if seg.end < seg.start {
            return Err(format!("segment {i}: end ({}) is before start ({})", seg.end, seg.start));
        }
        if seg.text.chars().count() > MAX_SEGMENT_TEXT_CHARS {
            return Err(format!(
                "segment {i}: text exceeds the {MAX_SEGMENT_TEXT_CHARS}-character cap"
            ));
        }
    }
    Ok(result)
}

/// Format seconds as `m:ss` (or `h:mm:ss` past an hour) for segment
/// timestamps in the transcript view.
pub fn format_timestamp(total_sec: f64) -> String {
    let s = total_sec.max(0.0).floor() as u64;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let rest = s % 60;
    if h > 0 {
        format!("{h}:{m:02}:{rest:02}")
    } else {
        format!("{m}:{rest:02}")
    }
}

/// Assemble the transcript's plain text: one `[m:ss] text` line per
/// segment. Used for copy-to-clipboard and search indexing.
pub fn transcript_text(result: &TranscriptResult) -> String {
    result
        .segments
        .iter()
        .map(|s| format!("[{}] {}", format_timestamp(s.start), s.text.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Case-insensitive substring search over segments. Returns the indices
/// of matching segments; an empty query matches everything.
pub fn search_segments(result: &TranscriptResult, query: &str) -> Vec<usize> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return (0..result.segments.len()).collect();
    }
    result
        .segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.text.to_lowercase().contains(&q))
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_marks_job_type_transcribe() {
        let m = TranscribeJobManifest::new(
            "tr-1",
            "mtg-2",
            "meeting-20260925-000500.webm",
            "en",
            "2026-09-25T05:00:00Z",
        );
        assert_eq!(m.job_type, "transcribe");
        assert_eq!(m.status, "queued");
        let json = serde_json::to_string(&m).unwrap();
        let back: TranscribeJobManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn language_hint_validation() {
        assert!(validate_language_hint("auto").is_ok());
        assert!(validate_language_hint("en").is_ok());
        assert!(validate_language_hint("es").is_ok());
        assert!(validate_language_hint("eng").is_ok());
        assert!(validate_language_hint("").is_err());
        assert!(validate_language_hint("e").is_err());
        assert!(validate_language_hint("engl").is_err());
        assert!(validate_language_hint("EN").is_err());
        assert!(validate_language_hint("en-US").is_err());
    }

    fn sample_result_json(job_id: &str) -> String {
        format!(
            r#"{{"job_id":"{job_id}","language":"en","duration_sec":12.5,
                "segments":[{{"start":0.0,"end":4.2,"text":"Hello everyone"}},
                            {{"start":4.2,"end":12.5,"text":"Let's review."}}],
                "model":"faster-whisper large-v3"}}"#
        )
    }

    #[test]
    fn result_parses_and_validates() {
        let r = parse_transcript_result("tr-9", sample_result_json("tr-9").as_bytes()).unwrap();
        assert_eq!(r.segments.len(), 2);
        assert_eq!(r.language, "en");
        assert_eq!(r.duration_sec, Some(12.5));
    }

    #[test]
    fn result_rejects_job_id_mismatch() {
        let err = parse_transcript_result("tr-9", sample_result_json("tr-OTHER").as_bytes())
            .unwrap_err();
        assert!(err.contains("mismatch"), "{err}");
    }

    #[test]
    fn result_rejects_bad_segments() {
        // end before start
        let bad = r#"{"job_id":"tr-1","segments":[{"start":5.0,"end":2.0,"text":"x"}]}"#;
        assert!(parse_transcript_result("tr-1", bad.as_bytes()).is_err());
        // NaN timestamp
        let nan = r#"{"job_id":"tr-1","segments":[{"start":"NaN","end":2.0,"text":"x"}]}"#;
        assert!(parse_transcript_result("tr-1", nan.as_bytes()).is_err());
        // negative
        let neg = r#"{"job_id":"tr-1","segments":[{"start":-1.0,"end":2.0,"text":"x"}]}"#;
        assert!(parse_transcript_result("tr-1", neg.as_bytes()).is_err());
        // not JSON at all
        assert!(parse_transcript_result("tr-1", b"nope").is_err());
    }

    #[test]
    fn empty_segments_are_a_valid_silent_meeting() {
        let r = parse_transcript_result("tr-1", br#"{"job_id":"tr-1","segments":[]}"#).unwrap();
        assert!(r.segments.is_empty());
        assert_eq!(transcript_text(&r), "");
    }

    #[test]
    fn timestamp_formatting() {
        assert_eq!(format_timestamp(0.0), "0:00");
        assert_eq!(format_timestamp(4.2), "0:04");
        assert_eq!(format_timestamp(65.0), "1:05");
        assert_eq!(format_timestamp(3723.0), "1:02:03");
        assert_eq!(format_timestamp(-3.0), "0:00");
    }

    #[test]
    fn transcript_text_and_search() {
        let r = parse_transcript_result("tr-9", sample_result_json("tr-9").as_bytes()).unwrap();
        let text = transcript_text(&r);
        assert!(text.contains("[0:00] Hello everyone"));
        assert!(text.contains("[0:04] Let's review."));
        assert_eq!(search_segments(&r, ""), vec![0, 1]);
        assert_eq!(search_segments(&r, "hello"), vec![0]);
        assert_eq!(search_segments(&r, "REVIEW"), vec![1]);
        assert!(search_segments(&r, "nothing here").is_empty());
    }

    #[test]
    fn segment_text_cap_is_enforced() {
        let long = "x".repeat(MAX_SEGMENT_TEXT_CHARS + 1);
        let json = format!(r#"{{"job_id":"tr-1","segments":[{{"start":0.0,"end":1.0,"text":"{long}"}}]}}"#);
        assert!(parse_transcript_result("tr-1", json.as_bytes()).is_err());
    }
}
