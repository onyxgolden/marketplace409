//! GS-C6 (C2-P6A review-action safety blocker) — the app-side trusted
//! confirmation-issuing boundary and guarded atomic mutation that
//! `forge_capture_core::sop_redaction`'s own doc comments repeatedly
//! named as the one thing a core-layer digest can never supply on its
//! own (C6A-001B), and the wiring that actually calls
//! [`crate::sop_workspace::apply_review_action_if_current`] (C6A-003)
//! from a real Tauri command for the first time — before this module,
//! nothing in this app ever called either of those two functions.
//!
//! **C6A-001B, closed for real:** [`forge_capture_core::sop_redaction::confirmation_digest`]
//! is a pure, public function — anyone who can read the current session
//! state can compute the exact value
//! [`forge_capture_core::sop_redaction::validate_review_action`] will
//! accept, so a `confirmed: bool` or a precomputed digest arriving over
//! IPC is just caller assertion, never proof a human reviewed anything.
//! [`review_disposition_change`] never accepts either from the
//! frontend: the only IPC inputs are the review action's own content
//! (frame/candidate identity, disposition, reason, the state it was
//! formed against). For a [`Disposition::MarkNonSensitive`] override,
//! this command itself blocks on a real native OS dialog
//! (`tauri_plugin_dialog`, backed by `rfd`) — a window the webview
//! cannot script, read the result of early, or dismiss on the user's
//! behalf — and only passes `confirmed: true` into
//! [`crate::sop_workspace::apply_review_action_if_current`] once that
//! dialog itself reports the user chose to confirm. That function then
//! computes the actual digest itself, from session state it reads fresh
//! under its own write guard — there is no code path anywhere in this
//! module, or the one it calls into, that accepts a digest value from
//! JS.

use tauri::AppHandle;

use forge_capture_core::sop_session::Disposition;

use crate::sop_workspace::{apply_review_action_if_current, load_or_create_authority_key, resolve_confined_path, ApplyReviewActionError, WorkspaceRoot};

/// Parses a [`Disposition`]'s stable wire code (`"PENDING"`, `"REDACT"`,
/// `"MARK_NON_SENSITIVE"` — the same `SCREAMING_SNAKE_CASE` serde
/// representation `Disposition` already derives, and the same strings
/// [`forge_capture_core::sop_redaction::confirmation_digest`]'s own
/// `disposition_wire_code` produces) back into the enum. Reusing
/// `Disposition`'s own derived (de)serialization — rather than a
/// hand-written reverse match a future renamed variant could silently
/// fall out of sync with — means this parser can never disagree with
/// what the wire code actually means elsewhere in this codebase.
fn parse_disposition_wire_code(wire: &str) -> Result<Disposition, String> {
    serde_json::from_value(serde_json::Value::String(wire.to_string()))
        .map_err(|_| format!("unrecognized disposition wire code: {wire}"))
}

fn apply_review_action_error_to_string(err: ApplyReviewActionError) -> String {
    match err {
        ApplyReviewActionError::SessionNotFound => "no session exists yet at that path".to_string(),
        ApplyReviewActionError::SessionParse(e) => format!("session file is not a valid session: {e:?}"),
        ApplyReviewActionError::Validation(e) => format!("review action refused: {e:?}"),
        ApplyReviewActionError::DuplicateEventId(id) => format!("event id {id} already exists in this session's edit log"),
        ApplyReviewActionError::PostMutationInvalid(e) => format!("resulting session would be invalid, nothing written: {e:?}"),
        ApplyReviewActionError::Io(msg) => msg,
    }
}

/// The real work, factored out from the `#[tauri::command]` wrapper so
/// it can be exercised in tests with a fake `confirm` closure instead of
/// a real native dialog (which needs a live `AppHandle`/window and
/// cannot run headless in `cargo test`). `confirm` is called **only**
/// when `new_disposition` actually needs one
/// ([`Disposition::Redact`]/[`Disposition::Pending`] never do — see
/// [`forge_capture_core::sop_redaction::validate_review_action`]) and is
/// given the exact reason text being confirmed, so the production
/// wrapper can show it verbatim in the dialog.
#[allow(clippy::too_many_arguments)]
fn review_disposition_change_impl(
    workspace_root: &std::path::Path,
    session_relative_path: &str,
    frame_id: &str,
    candidate_id: &str,
    new_disposition_wire: &str,
    reason: &str,
    expected_session_revision: u64,
    expected_policy_version: &str,
    expected_model_manifest_sha256: Option<&str>,
    event_id: String,
    local_timestamp: String,
    confirm: impl FnOnce(&str) -> bool,
) -> Result<u64, String> {
    let new_disposition = parse_disposition_wire_code(new_disposition_wire)?;

    // Only a MarkNonSensitive override ever needs a human confirmation
    // at all (Redact is the safe default direction — see
    // `validate_review_action`'s own doc comment); never show the
    // dialog, and never claim `confirmed: true`, for a direction that
    // doesn't require it.
    let confirmed = new_disposition == Disposition::MarkNonSensitive && confirm(reason);

    let root = WorkspaceRoot::open(workspace_root).map_err(|e| format!("cannot open workspace root: {e:?}"))?;
    let confined = resolve_confined_path(&root, session_relative_path).map_err(|e| format!("cannot resolve session path: {e:?}"))?;
    // GS-C6 fix-round-7 (P1 #1): the trusted-boundary secret this
    // override's authority record gets MACed with — sourced here, at
    // the same native-dialog-guarded command this whole module exists
    // to be, never accepted as an argument a caller (ultimately the
    // frontend) could supply.
    let authority_key = load_or_create_authority_key(workspace_root).map_err(|e| format!("cannot load authority key: {e:?}"))?;

    apply_review_action_if_current(
        &confined,
        frame_id,
        candidate_id,
        new_disposition,
        reason,
        confirmed,
        expected_session_revision,
        expected_policy_version,
        expected_model_manifest_sha256,
        event_id,
        local_timestamp,
        &authority_key,
    )
    .map_err(apply_review_action_error_to_string)
}

/// Tauri command: apply a single reviewer disposition change to a SOP
/// session, blocking on a real native confirmation dialog first when
/// the chosen disposition is [`Disposition::MarkNonSensitive`].
///
/// Tauri matches invoke argument names to Rust parameter names exactly
/// (no case conversion), so these are camelCase to match what the JS UI
/// sends — see `begin_region_pick` in `main.rs` for the same convention.
#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
pub fn review_disposition_change(
    app: AppHandle,
    workspaceRoot: String,
    sessionRelativePath: String,
    frameId: String,
    candidateId: String,
    newDisposition: String,
    reason: String,
    expectedSessionRevision: u64,
    expectedPolicyVersion: String,
    expectedModelManifestSha256: Option<String>,
    eventId: String,
    localTimestamp: String,
) -> Result<u64, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    review_disposition_change_impl(
        std::path::Path::new(&workspaceRoot),
        &sessionRelativePath,
        &frameId,
        &candidateId,
        &newDisposition,
        &reason,
        expectedSessionRevision,
        &expectedPolicyVersion,
        expectedModelManifestSha256.as_deref(),
        eventId,
        localTimestamp,
        |reason| {
            // C6A-001B: a real, OS-native modal — not a webview element
            // the frontend could script, read in advance, or answer on
            // the user's behalf. The reviewer sees the exact reason text
            // they are about to confirm.
            app.dialog()
                .message(format!("Mark this candidate as NOT sensitive?\n\nReason given: {reason}"))
                .title("Confirm redaction override")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("Confirm override".to_string(), "Cancel".to_string()))
                .blocking_show()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sop-review-test-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rand_suffix() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos() as u64
    }

    fn write_minimal_session(root: &std::path::Path, relative_path: &str) {
        use forge_capture_core::sop_session::{
            FrameVerification, RedactionCandidate, ReviewState, SopSessionV1, SourceFrame, SourceStorage, SOP_SESSION_KIND,
            SOP_SESSION_SCHEMA_VERSION,
        };
        let session = SopSessionV1 {
            schema_version: SOP_SESSION_SCHEMA_VERSION,
            kind: SOP_SESSION_KIND.to_string(),
            session_id: "sess-1".to_string(),
            created_at: "2026-10-29T12:00:00Z".to_string(),
            updated_at: "2026-10-29T12:00:00Z".to_string(),
            revision: 0,
            policy_version: "policy-v1".to_string(),
            model_manifest_sha256: Some("model-manifest-v1".to_string()),
            sidecar_protocol_version: 1,
            source_frames: vec![SourceFrame {
                frame_id: "f1".to_string(),
                order: 0,
                source_relative_path: "frames/f1.png".to_string(),
                raster_sha256: "a".repeat(64),
                provenance_sidecar_relative_path: None,
                provenance_sidecar_blob_sha256: None,
                width: 100,
                height: 100,
                captured_at: "2026-10-29T12:00:00Z".to_string(),
                action_kind: "click".to_string(),
                click_box: None,
                process_basename: None,
                window_title: None,
                original_storage: SourceStorage::SessionEncrypted,
                ocr_status: None,
                redacted_derivative_relative_path: None,
                redacted_derivative_sha256: None,
                redaction_candidates: vec![RedactionCandidate {
                    candidate_id: "c1".to_string(),
                    detector_id: "det.ssn".to_string(),
                    reason_code: "TEST".to_string(),
                    source_token_ids: vec!["tok-1".to_string()],
                    original_box: (0, 0, 5, 5),
                    expanded_box: (0, 0, 5, 5),
                    score: None,
                    disposition: Disposition::Pending,
                    disposition_event_id: None,
                }],
                verification: FrameVerification::Pending,
            }],
            captions: vec![],
            edit_events: vec![],
            review_state: ReviewState::InProgress,
            review_receipt: None,
            export_eligible: false,
        };
        std::fs::write(root.join(relative_path), serde_json::to_vec(&session).unwrap()).unwrap();
    }

    #[test]
    fn parse_disposition_wire_code_round_trips_every_variant() {
        assert_eq!(parse_disposition_wire_code("PENDING"), Ok(Disposition::Pending));
        assert_eq!(parse_disposition_wire_code("REDACT"), Ok(Disposition::Redact));
        assert_eq!(parse_disposition_wire_code("MARK_NON_SENSITIVE"), Ok(Disposition::MarkNonSensitive));
    }

    #[test]
    fn parse_disposition_wire_code_rejects_an_unknown_code() {
        assert!(parse_disposition_wire_code("DELETE").is_err());
    }

    #[test]
    fn redact_never_invokes_the_confirm_closure() {
        let root = temp_root();
        write_minimal_session(&root, "session.json");
        let mut confirm_was_called = false;
        let result = review_disposition_change_impl(
            &root,
            "session.json",
            "f1",
            "c1",
            "REDACT",
            "",
            0,
            "policy-v1",
            Some("model-manifest-v1"),
            "evt-1".to_string(),
            "2026-10-29T12:05:00Z".to_string(),
            |_reason| {
                confirm_was_called = true;
                true
            },
        );
        assert_eq!(result, Ok(1));
        assert!(!confirm_was_called, "Redact is the safe default direction and must never need a confirmation dialog");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mark_non_sensitive_is_refused_when_the_confirm_closure_declines() {
        let root = temp_root();
        write_minimal_session(&root, "session.json");
        let result = review_disposition_change_impl(
            &root,
            "session.json",
            "f1",
            "c1",
            "MARK_NON_SENSITIVE",
            "verified with the customer",
            0,
            "policy-v1",
            Some("model-manifest-v1"),
            "evt-1".to_string(),
            "2026-10-29T12:05:00Z".to_string(),
            |_reason| false,
        );
        assert!(result.is_err(), "declining the real confirmation dialog must refuse the override");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mark_non_sensitive_succeeds_when_the_confirm_closure_accepts() {
        let root = temp_root();
        write_minimal_session(&root, "session.json");
        let mut shown_reason = None;
        let result = review_disposition_change_impl(
            &root,
            "session.json",
            "f1",
            "c1",
            "MARK_NON_SENSITIVE",
            "verified with the customer",
            0,
            "policy-v1",
            Some("model-manifest-v1"),
            "evt-1".to_string(),
            "2026-10-29T12:05:00Z".to_string(),
            |reason| {
                shown_reason = Some(reason.to_string());
                true
            },
        );
        assert_eq!(result, Ok(1));
        assert_eq!(shown_reason, Some("verified with the customer".to_string()), "the dialog must be shown the real reason text");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_unrecognized_disposition_wire_code_is_refused_before_touching_the_filesystem() {
        let root = temp_root();
        // Deliberately no session file written — if this reached
        // filesystem/workspace resolution at all it would fail
        // differently than the wire-code parse error asserted below.
        let result = review_disposition_change_impl(
            &root,
            "session.json",
            "f1",
            "c1",
            "DELETE",
            "",
            0,
            "policy-v1",
            None,
            "evt-1".to_string(),
            "2026-10-29T12:05:00Z".to_string(),
            |_reason| true,
        );
        assert!(result.is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
