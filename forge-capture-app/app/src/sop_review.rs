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

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use forge_capture_core::sop_ipc::{BoundedPath, IpcRequest, IpcResult, SidecarOperation, SIDECAR_PROTOCOL_VERSION};
use forge_capture_core::sop_session::{sha256_hex, Disposition, OcrToken};

use crate::ai_sidecar_client::SidecarSession;
use crate::sop_workspace::{
    apply_review_action_if_current, populate_review_candidates_if_current, read_review_candidates_snapshot, resolve_confined_path,
    ApplyReviewActionError, IngestedReviewCandidates, PopulateReviewCandidatesError, ReadReviewCandidatesError, ReviewCandidatesSnapshot,
    WorkspaceRoot,
};

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
        ApplyReviewActionError::AuthorityKey(e) => format!("cannot load or mint workspace authority key: {e:?}"),
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

    // GS-C6 fix-round-8 (P1 #2): the trusted-boundary secret this
    // override's authority record gets MACed with is no longer sourced
    // here, outside any lock. `load_or_create_authority_key` itself
    // does a read-if-present / else generate+atomic-replace with no
    // locking of its own — two concurrent first calls on a brand-new
    // workspace, each calling it before taking any session lock, could
    // generate and durably persist two different keys, so whichever
    // caller's event got MACed with the loser key would fail every
    // later verification. `apply_review_action_if_current` now loads
    // (or mints) this same key itself, from `confined`'s own
    // `workspace_root()`, after it has acquired both the in-process and
    // cross-process session locks — the one place in this whole chain
    // where only a single caller is ever inside the critical section
    // per workspace.
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
    )
    .map_err(apply_review_action_error_to_string)
}

fn get_review_candidates_error_to_string(err: ReadReviewCandidatesError) -> String {
    match err {
        ReadReviewCandidatesError::SessionNotFound => "no session exists yet at that path".to_string(),
        ReadReviewCandidatesError::Oversized { found_bytes, max_bytes } => {
            format!("session file is too large to read ({found_bytes} bytes, max {max_bytes})")
        }
        ReadReviewCandidatesError::SessionParse(e) => format!("session file is not a valid session: {e:?}"),
        ReadReviewCandidatesError::FrameNotFound(id) => format!("no frame with id {id} in this session"),
        ReadReviewCandidatesError::TooManyCandidates { found, max } => {
            format!("review-limit refused: this frame has too many candidates to review here ({found}, max {max})")
        }
        ReadReviewCandidatesError::ResponseTooLarge { max_bytes } => {
            format!("review-limit refused: this frame's candidates are too large to return in one review response (max {max_bytes} bytes)")
        }
        ReadReviewCandidatesError::Io(msg) => msg,
    }
}

/// The real work behind [`get_review_candidates`], factored out the same
/// way [`review_disposition_change_impl`] is — purely for a consistent
/// testable-without-Tauri shape; this command needs no `AppHandle` or
/// confirmation closure, since it never mutates anything.
fn get_review_candidates_impl(workspace_root: &std::path::Path, session_relative_path: &str, frame_id: &str) -> Result<ReviewCandidatesSnapshot, String> {
    let root = WorkspaceRoot::open(workspace_root).map_err(|e| format!("cannot open workspace root: {e:?}"))?;
    let confined = resolve_confined_path(&root, session_relative_path).map_err(|e| format!("cannot resolve session path: {e:?}"))?;
    read_review_candidates_snapshot(&confined, frame_id).map_err(get_review_candidates_error_to_string)
}

/// Tauri command: the read-only counterpart to [`review_disposition_change`]
/// — returns one frame's redaction candidates plus the exact
/// `sessionRevision`/`policyVersion`/`modelManifestSha256` binding the
/// mutation command's own `expected*` preconditions require, sourced from
/// the same validated read, so the frontend never has to guess or combine
/// them from a second, unbound call. Carries no raw OCR text, candidate
/// value, pixel data, or source path across IPC — see
/// [`crate::sop_workspace::ReviewCandidateView`]'s own doc comment for the
/// exact field list this projects down to.
///
/// Tauri matches invoke argument names to Rust parameter names exactly
/// (no case conversion), so these are camelCase to match what the JS UI
/// sends — see [`review_disposition_change`] for the same convention.
#[tauri::command]
#[allow(non_snake_case)]
pub fn get_review_candidates(workspaceRoot: String, sessionRelativePath: String, frameId: String) -> Result<ReviewCandidatesSnapshot, String> {
    get_review_candidates_impl(std::path::Path::new(&workspaceRoot), &sessionRelativePath, &frameId)
}

fn populate_review_candidates_error_to_string(err: PopulateReviewCandidatesError) -> String {
    match err {
        PopulateReviewCandidatesError::SessionNotFound => "no session exists yet at that path".to_string(),
        PopulateReviewCandidatesError::SessionParse(e) => format!("session file is not a valid session: {e:?}"),
        PopulateReviewCandidatesError::FrameNotFound(id) => format!("no frame with id {id} in this session"),
        PopulateReviewCandidatesError::StaleSessionRevision { expected, current } => {
            format!("stale: expected revision {expected}, session is actually at {current} — reload and try again")
        }
        PopulateReviewCandidatesError::AlreadyPopulated { frame_id, existing_count } => {
            format!("frame {frame_id} already has {existing_count} candidate(s) — ingestion only runs once per frame")
        }
        PopulateReviewCandidatesError::Binding(e) => format!("could not bind detected candidates to OCR tokens: {e:?}"),
        PopulateReviewCandidatesError::PostMutationInvalid(e) => format!("internal error: candidate ingestion produced an invalid session: {e:?}"),
        PopulateReviewCandidatesError::Io(msg) => msg,
    }
}

/// The real work behind [`ingest_review_candidates`], factored out the
/// same way [`get_review_candidates_impl`] is.
fn ingest_review_candidates_impl(
    workspace_root: &std::path::Path,
    session_relative_path: &str,
    frame_id: &str,
    ocr_tokens: &[forge_capture_core::sop_session::OcrToken],
    expected_session_revision: u64,
) -> Result<IngestedReviewCandidates, String> {
    let root = WorkspaceRoot::open(workspace_root).map_err(|e| format!("cannot open workspace root: {e:?}"))?;
    let confined = resolve_confined_path(&root, session_relative_path).map_err(|e| format!("cannot resolve session path: {e:?}"))?;
    populate_review_candidates_if_current(&confined, frame_id, ocr_tokens, expected_session_revision)
        .map_err(populate_review_candidates_error_to_string)
}

/// Tauri command (C4A-002): the real, non-test production path from one
/// frame's already-computed OCR tokens to persisted review candidates —
/// see [`crate::sop_workspace::populate_review_candidates_if_current`]'s
/// own doc comment for why this is "ingestion," not an edit, and why it
/// refuses rather than replaces when the frame already has candidates.
/// OCR model execution itself is not performed by this command or
/// anything it calls — it is a separate, not-yet-authorized dependency
/// decision; this command's job starts from tokens the caller already
/// has.
///
/// Tauri matches invoke argument names to Rust parameter names exactly
/// (no case conversion), so these are camelCase to match what a JS
/// caller sends — see [`get_review_candidates`] for the same convention.
#[tauri::command]
#[allow(non_snake_case)]
pub fn ingest_review_candidates(
    workspaceRoot: String,
    sessionRelativePath: String,
    frameId: String,
    ocrTokens: Vec<forge_capture_core::sop_session::OcrToken>,
    expectedSessionRevision: u64,
) -> Result<IngestedReviewCandidates, String> {
    ingest_review_candidates_impl(std::path::Path::new(&workspaceRoot), &sessionRelativePath, &frameId, &ocrTokens, expectedSessionRevision)
}

/// Resolves the sidecar binary's real production location: alongside
/// this app's own executable. Tauri sidecar/`externalBin` packaging
/// registration (so the bundled installer actually places the binary
/// there) is a packaging decision — brief §6's C2-P7 row — out of this
/// slice's scope; this is the resolution a packaged build needs once
/// that registration exists, and is exactly what a dev build's own
/// `target/<profile>/` layout already satisfies (the app and sidecar
/// binaries are siblings there too), so it needs no `#[cfg]` split.
fn production_sidecar_exe_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot resolve this app's own executable path: {e}"))?;
    let dir = exe.parent().ok_or_else(|| "this app's executable path has no parent directory".to_string())?;
    let name = if cfg!(windows) { "forge-capture-ai-sidecar.exe" } else { "forge-capture-ai-sidecar" };
    Ok(dir.join(name))
}

/// Builds the one [`IpcRequest`] a full-frame-plus-optional-click-crop
/// OCR call needs for `frame`, already bound to `frame`'s own
/// `click_box` (brief §6, "full-frame + click crop") and the session's
/// `model_manifest_sha256` the sidecar must verify the on-disk model
/// pack against.
fn build_ocr_request(frame: &forge_capture_core::sop_session::SourceFrame, frame_digest: &str, model_manifest_sha256: &str, request_id: String) -> Result<IpcRequest, String> {
    let bounded_path = BoundedPath::new(&frame.source_relative_path).map_err(|e| format!("frame source path is not a valid bounded path: {e:?}"))?;
    Ok(IpcRequest {
        request_id,
        schema_version: SIDECAR_PROTOCOL_VERSION,
        operation: SidecarOperation::Ocr,
        input_digests_sha256: vec![frame_digest.to_string()],
        bounded_paths: vec![bounded_path],
        timeout_ms: 30_000,
        model_manifest_sha256: model_manifest_sha256.to_string(),
        click_crop_box: frame.click_box,
    })
}

#[derive(Debug)]
enum RunOcrError {
    SessionNotFound,
    SessionParse(forge_capture_core::sop_session::SessionError),
    FrameNotFound(String),
    NoModelManifestConfigured,
    FrameIo(String),
    FrameDigestMismatch { expected: String, found: String },
    RequestBuild(String),
    SidecarSpawn(String),
    SidecarRequest(String),
    OcrFailed { code: String, message: String },
    MalformedOcrResponse(String),
    Ingest(PopulateReviewCandidatesError),
}

fn run_ocr_error_to_string(err: RunOcrError) -> String {
    match err {
        RunOcrError::SessionNotFound => "no session exists yet at that path".to_string(),
        RunOcrError::SessionParse(e) => format!("session file is not a valid session: {e:?}"),
        RunOcrError::FrameNotFound(id) => format!("no frame with id {id} in this session"),
        RunOcrError::NoModelManifestConfigured => "session has no model_manifest_sha256 configured; cannot run OCR without a verified model pack".to_string(),
        RunOcrError::FrameIo(msg) => format!("cannot read the frame's source file: {msg}"),
        RunOcrError::FrameDigestMismatch { expected, found } => {
            format!("frame file on disk no longer matches its recorded digest (expected {expected}, found {found}) - refusing to run OCR on it")
        }
        RunOcrError::RequestBuild(msg) => format!("cannot build the OCR request: {msg}"),
        RunOcrError::SidecarSpawn(msg) => format!("cannot start the OCR sidecar process: {msg}"),
        RunOcrError::SidecarRequest(msg) => format!("OCR request to the sidecar failed: {msg}"),
        RunOcrError::OcrFailed { code, message } => format!("OCR failed ({code}): {message}"),
        RunOcrError::MalformedOcrResponse(msg) => format!("OCR sidecar returned an unexpected response shape: {msg}"),
        RunOcrError::Ingest(e) => populate_review_candidates_error_to_string(e),
    }
}

/// The real work behind [`run_ocr_and_ingest_review_candidates`] — the
/// actual caller the brief's I4 gap named as missing: reads the current
/// session to find `frame_id`'s source image and the session's verified
/// model-pack digest, spawns the real OCR sidecar with this workspace as
/// its session root, runs full-frame-plus-click-crop OCR over the real
/// framed IPC wire, and feeds the resulting tokens into
/// [`populate_review_candidates_if_current`] exactly as a caller that
/// already had tokens from anywhere else would. The initial session
/// read is unguarded (no mutation happens from it) — the same read-then-
/// guarded-write split [`get_review_candidates_impl`]/
/// [`review_disposition_change_impl`] already use elsewhere in this
/// file; `populate_review_candidates_if_current` re-reads the session
/// fresh under its own lock and re-checks `expected_session_revision`
/// before writing anything, so a concurrent edit between this function's
/// read and its own write still fails closed as staleness, not a lost
/// update.
fn run_ocr_and_ingest_review_candidates_impl(
    workspace_root: &Path,
    session_relative_path: &str,
    frame_id: &str,
    expected_session_revision: u64,
    sidecar_exe_path: &Path,
) -> Result<IngestedReviewCandidates, RunOcrError> {
    let root = WorkspaceRoot::open(workspace_root).map_err(|e| RunOcrError::FrameIo(format!("cannot open workspace root: {e:?}")))?;
    let confined = resolve_confined_path(&root, session_relative_path)
        .map_err(|e| RunOcrError::FrameIo(format!("cannot resolve session path: {e:?}")))?;

    let session_bytes = match std::fs::read(confined.path()) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(RunOcrError::SessionNotFound),
        Err(e) => return Err(RunOcrError::FrameIo(e.to_string())),
    };
    let session = forge_capture_core::sop_session::parse_session(&session_bytes).map_err(RunOcrError::SessionParse)?;

    let frame = session.source_frames.iter().find(|f| f.frame_id == frame_id).ok_or_else(|| RunOcrError::FrameNotFound(frame_id.to_string()))?;
    let model_manifest_sha256 = session.model_manifest_sha256.clone().ok_or(RunOcrError::NoModelManifestConfigured)?;

    let frame_confined = resolve_confined_path(&root, &frame.source_relative_path)
        .map_err(|e| RunOcrError::FrameIo(format!("cannot resolve frame source path: {e:?}")))?;
    let frame_bytes = std::fs::read(frame_confined.path()).map_err(|e| RunOcrError::FrameIo(e.to_string()))?;
    let frame_digest = sha256_hex(&frame_bytes);
    if !frame_digest.eq_ignore_ascii_case(&frame.raster_sha256) {
        return Err(RunOcrError::FrameDigestMismatch { expected: frame.raster_sha256.clone(), found: frame_digest });
    }

    let request_id = format!("ocr-{frame_id}-{}", session.revision);
    let request = build_ocr_request(frame, &frame_digest, &model_manifest_sha256, request_id).map_err(RunOcrError::RequestBuild)?;

    let session_root_str = root
        .canonical_path()
        .to_str()
        .ok_or_else(|| RunOcrError::SidecarSpawn("workspace root path is not valid UTF-8".to_string()))?;
    let mut sidecar = SidecarSession::spawn_with_env(sidecar_exe_path, &[("FORGE_SIDECAR_SESSION_ROOT", session_root_str)])
        .map_err(|e| RunOcrError::SidecarSpawn(format!("{e:?}")))?;
    let response = sidecar.request(&request).map_err(|e| RunOcrError::SidecarRequest(format!("{e:?}")))?;

    let payload = match response.result {
        IpcResult::Ok { payload } => payload,
        IpcResult::Err { code, message } => return Err(RunOcrError::OcrFailed { code, message }),
    };
    let tokens: Vec<OcrToken> =
        serde_json::from_value(payload["tokens"].clone()).map_err(|e| RunOcrError::MalformedOcrResponse(e.to_string()))?;

    populate_review_candidates_if_current(&confined, frame_id, &tokens, expected_session_revision).map_err(RunOcrError::Ingest)
}

/// Tauri command (closes the I4 gap disclosed 2026-11-05: "the command
/// has no UI caller today because no OCR execution exists yet"): the
/// real, non-test production path from "a frame exists" all the way to
/// persisted review candidates, running actual PP-OCR inference itself
/// rather than requiring a caller to already have tokens from somewhere
/// else — see [`ingest_review_candidates`] for that lower-level,
/// tokens-already-computed command, which this one calls into after
/// computing them for real.
///
/// Tauri matches invoke argument names to Rust parameter names exactly
/// (no case conversion), so these are camelCase to match what a JS
/// caller sends — see [`get_review_candidates`] for the same convention.
#[tauri::command]
#[allow(non_snake_case)]
pub fn run_ocr_and_ingest_review_candidates(
    workspaceRoot: String,
    sessionRelativePath: String,
    frameId: String,
    expectedSessionRevision: u64,
) -> Result<IngestedReviewCandidates, String> {
    let sidecar_exe_path = production_sidecar_exe_path()?;
    run_ocr_and_ingest_review_candidates_impl(Path::new(&workspaceRoot), &sessionRelativePath, &frameId, expectedSessionRevision, &sidecar_exe_path)
        .map_err(run_ocr_error_to_string)
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

    #[test]
    fn get_review_candidates_impl_returns_the_snapshot_for_a_real_session() {
        let root = temp_root();
        write_minimal_session(&root, "session.json");
        let snapshot = get_review_candidates_impl(&root, "session.json", "f1").expect("a real session/frame must snapshot cleanly");
        assert_eq!(snapshot.frame_id, "f1");
        assert_eq!(snapshot.session_revision, 0);
        assert_eq!(snapshot.policy_version, "policy-v1");
        assert_eq!(snapshot.candidates.len(), 1);
        assert_eq!(snapshot.candidates[0].candidate_id, "c1");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_review_candidates_impl_refuses_an_unknown_frame_id() {
        let root = temp_root();
        write_minimal_session(&root, "session.json");
        let result = get_review_candidates_impl(&root, "session.json", "no-such-frame");
        assert!(result.is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_review_candidates_impl_refuses_when_no_session_exists_yet() {
        let root = temp_root();
        std::fs::create_dir_all(&root).ok();
        let result = get_review_candidates_impl(&root, "session.json", "f1");
        assert!(result.is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    // --- run_ocr_and_ingest_review_candidates (closes the I4 gap) ---

    /// Must match `ai-sidecar/model-pack/manifest.json`'s own SHA-256
    /// exactly - same constant as `ai_sidecar_client.rs`'s own tests.
    const REAL_MODEL_MANIFEST_SHA256: &str = "8d2fddf908d037c3e71a4cb1f8cc48a81bb6f7787e2ef99a9a43245c5652535b";

    /// Same exact-sibling resolution [`ai_sidecar_client`]'s own tests
    /// use - see that module's `sidecar_exe_path` for why this can't be
    /// a shared dependency between the two test modules.
    fn sidecar_exe_path() -> std::path::PathBuf {
        let exe = std::env::current_exe().expect("current_exe must resolve for a running test binary");
        let binary_name = if cfg!(windows) { "forge-capture-ai-sidecar.exe" } else { "forge-capture-ai-sidecar" };
        let profile_dir = exe.parent().and_then(std::path::Path::parent).expect("test binary path must have target/<profile>/deps ancestors");
        let candidate = profile_dir.join(binary_name);
        assert!(candidate.is_file(), "expected the sidecar binary at {candidate:?} - build it first with `cargo build -p forge-capture-ai-sidecar`");
        candidate
    }

    fn write_session_with_real_frame(root: &std::path::Path, frame_bytes: &[u8], model_manifest_sha256: Option<String>) {
        use forge_capture_core::sop_session::{
            FrameVerification, ReviewState, SopSessionV1, SourceFrame, SourceStorage, SOP_SESSION_KIND, SOP_SESSION_SCHEMA_VERSION,
        };
        std::fs::create_dir_all(root.join("frames")).unwrap();
        std::fs::write(root.join("frames/f1.png"), frame_bytes).unwrap();
        let raster_sha256 = forge_capture_core::sop_session::sha256_hex(frame_bytes);
        let session = SopSessionV1 {
            schema_version: SOP_SESSION_SCHEMA_VERSION,
            kind: SOP_SESSION_KIND.to_string(),
            session_id: "sess-1".to_string(),
            created_at: "2026-11-06T00:00:00Z".to_string(),
            updated_at: "2026-11-06T00:00:00Z".to_string(),
            revision: 0,
            policy_version: "policy-v1".to_string(),
            model_manifest_sha256,
            sidecar_protocol_version: 1,
            source_frames: vec![SourceFrame {
                frame_id: "f1".to_string(),
                order: 0,
                source_relative_path: "frames/f1.png".to_string(),
                raster_sha256,
                provenance_sidecar_relative_path: None,
                provenance_sidecar_blob_sha256: None,
                width: 400,
                height: 120,
                captured_at: "2026-11-06T00:00:00Z".to_string(),
                action_kind: "click".to_string(),
                click_box: None,
                process_basename: None,
                window_title: None,
                original_storage: SourceStorage::SessionEncrypted,
                ocr_status: None,
                redacted_derivative_relative_path: None,
                redacted_derivative_sha256: None,
                redaction_candidates: vec![],
                verification: FrameVerification::Pending,
            }],
            captions: vec![],
            edit_events: vec![],
            review_state: ReviewState::InProgress,
            review_receipt: None,
            export_eligible: false,
        };
        std::fs::write(root.join("session.json"), serde_json::to_vec(&session).unwrap()).unwrap();
    }

    #[test]
    fn run_ocr_and_ingest_review_candidates_impl_runs_real_ocr_and_ingests_candidates() {
        let root = temp_root();
        let frame_bytes = include_bytes!("../../ai-sidecar/test-fixtures/synthetic_hello_world.png");
        write_session_with_real_frame(&root, frame_bytes, Some(REAL_MODEL_MANIFEST_SHA256.to_string()));

        let result = run_ocr_and_ingest_review_candidates_impl(&root, "session.json", "f1", 0, &sidecar_exe_path());
        // The synthetic "HELLO WORLD" fixture contains no deterministic
        // hard-positive pattern, so a real, successful run here lands on
        // zero bound candidates - this test is about the real OCR ->
        // ingest wiring succeeding end to end, not about what this
        // particular fixture's text happens to match. `populate_review_
        // candidates_if_current`'s own "ingest once" refusal (via the
        // AlreadyPopulated guard on a *nonempty* candidate list) is
        // already covered by that function's own test suite in
        // `sop_workspace.rs` and is not re-tested here.
        match result {
            Ok(IngestedReviewCandidates { candidate_count: 0, unbound_count: 0 }) => {}
            other => panic!("expected a real, successful OCR->ingest run with zero bound candidates, got {other:?}"),
        }

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn run_ocr_and_ingest_review_candidates_impl_refuses_without_a_configured_model_manifest() {
        let root = temp_root();
        let frame_bytes = include_bytes!("../../ai-sidecar/test-fixtures/synthetic_hello_world.png");
        write_session_with_real_frame(&root, frame_bytes, None);

        // Must fail before ever spawning a sidecar - pass an
        // intentionally nonexistent exe path to prove this.
        let bogus_exe = root.join("no-such-sidecar.exe");
        let result = run_ocr_and_ingest_review_candidates_impl(&root, "session.json", "f1", 0, &bogus_exe);
        assert!(matches!(result, Err(RunOcrError::NoModelManifestConfigured)), "{result:?}");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn run_ocr_and_ingest_review_candidates_impl_refuses_a_tampered_frame_file() {
        let root = temp_root();
        let frame_bytes = include_bytes!("../../ai-sidecar/test-fixtures/synthetic_hello_world.png");
        write_session_with_real_frame(&root, frame_bytes, Some(REAL_MODEL_MANIFEST_SHA256.to_string()));
        // Tamper with the frame file after the session recorded its digest.
        std::fs::write(root.join("frames/f1.png"), b"not the same bytes anymore").unwrap();

        let bogus_exe = root.join("no-such-sidecar.exe");
        let result = run_ocr_and_ingest_review_candidates_impl(&root, "session.json", "f1", 0, &bogus_exe);
        assert!(matches!(result, Err(RunOcrError::FrameDigestMismatch { .. })), "{result:?}");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn run_ocr_and_ingest_review_candidates_impl_refuses_an_unknown_frame_id() {
        let root = temp_root();
        let frame_bytes = include_bytes!("../../ai-sidecar/test-fixtures/synthetic_hello_world.png");
        write_session_with_real_frame(&root, frame_bytes, Some(REAL_MODEL_MANIFEST_SHA256.to_string()));

        let bogus_exe = root.join("no-such-sidecar.exe");
        let result = run_ocr_and_ingest_review_candidates_impl(&root, "session.json", "no-such-frame", 0, &bogus_exe);
        assert!(matches!(result, Err(RunOcrError::FrameNotFound(_))), "{result:?}");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn run_ocr_and_ingest_review_candidates_impl_refuses_a_stale_session_revision() {
        let root = temp_root();
        let frame_bytes = include_bytes!("../../ai-sidecar/test-fixtures/synthetic_hello_world.png");
        write_session_with_real_frame(&root, frame_bytes, Some(REAL_MODEL_MANIFEST_SHA256.to_string()));

        // Session is at revision 0; ask for revision 5 - must fail
        // closed as staleness once it reaches the real ingest guard,
        // not silently ingest against the wrong expected revision.
        let result = run_ocr_and_ingest_review_candidates_impl(&root, "session.json", "f1", 5, &sidecar_exe_path());
        assert!(
            matches!(result, Err(RunOcrError::Ingest(PopulateReviewCandidatesError::StaleSessionRevision { expected: 5, current: 0 }))),
            "{result:?}"
        );

        std::fs::remove_dir_all(&root).ok();
    }
}
