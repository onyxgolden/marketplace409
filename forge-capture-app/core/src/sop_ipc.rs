//! FORGE Capture Phase 2 — sidecar IPC protocol types (build slice C2-P1).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §2.1: "IPC is length-prefixed JSON over inherited stdin/stdout. Each
//! request has request_id, schema_version, operation enum, input digests,
//! bounded paths under the session root, timeout, and model-manifest
//! digest. Responses echo the request and input identities. Unknown
//! fields/versions and paths outside the session root fail closed."
//!
//! This module owns the message *shapes* and the length-prefix framing,
//! plus the lexical half of path confinement (no `..`, not absolute, no
//! embedded NUL — checkable without touching a filesystem, so it's pure
//! and testable on any host, same as the rest of this crate). The other
//! half — defeating a symlink planted inside an otherwise-lexically-valid
//! relative path — needs real `std::fs` calls against the actual session
//! root and lives in the Tauri shell (`app/src/sop_workspace.rs`), same
//! division as [`crate::sop_session`]'s atomic write. No OCR/NER/caption
//! inference logic lives here — this slice (C2-P1) is protocol/contract
//! only, per the brief's own slice boundary.

use serde::{Deserialize, Serialize};

/// Current IPC protocol version. A request/response naming a newer
/// version than this fails closed (see [`SIDECAR_PROTOCOL_VERSION`] and
/// [`SopSessionV1::sidecar_protocol_version`](crate::sop_session::SopSessionV1::sidecar_protocol_version)).
pub const SIDECAR_PROTOCOL_VERSION: u32 = 1;

/// Which inference operation a request asks the sidecar to run. Listing
/// these is a protocol-contract decision (what operations exist, what
/// each one's bounded inputs/outputs are shaped like) independent of
/// actually implementing any of them — the implementations arrive in
/// C2-P2 (OCR), C2-P4 (NER), C2-P5 (captioning); this enum is their
/// shared vocabulary from slice 1 onward so later slices don't redefine
/// the wire contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarOperation {
    Ocr,
    Ner,
    Caption,
}

/// Maximum byte length of a single bounded relative path string. Generous
/// enough for any real session path, small enough that a malicious request
/// cannot smuggle megabytes of string data through a path field.
pub const MAX_BOUNDED_PATH_LEN: usize = 4096;

/// A request's bounded path — always relative to the session root,
/// already lexically validated by [`confine_relative_path`] before this
/// type is constructed (the constructor is the only way to get one, see
/// [`BoundedPath::new`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BoundedPath(String);

impl BoundedPath {
    pub fn new(relative: &str) -> Result<Self, PathConfinementError> {
        confine_relative_path(relative)?;
        Ok(Self(relative.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Reasons a candidate relative path is refused. Every variant is a
/// distinct, machine-checkable failure — never a single bare "invalid
/// path" the caller has to string-match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathConfinementError {
    Empty,
    Absolute,
    ContainsParentTraversal,
    ContainsNulByte,
    /// A bare drive-letter-prefixed path (`C:\...` or `C:/...`) — not
    /// caught by [`PathConfinementError::Absolute`] on every platform's
    /// naive check, so it gets its own explicit reason.
    ContainsDriveLetter,
    /// Longer than [`MAX_BOUNDED_PATH_LEN`] — refused before any
    /// allocation-heavy use, independent of whether it would otherwise be
    /// lexically safe.
    TooLong { found: usize, max: usize },
}

/// Lexical path confinement: rejects anything that could resolve outside
/// the session root *without* touching the filesystem. This is
/// necessary-but-not-sufficient — see the module doc comment on why
/// symlink defeat is a separate, app-side check — but it is what makes a
/// request path safe to even pass to that second check in the first
/// place (a `..`-laden path would never reach a sane canonicalize
/// comparison safely).
pub fn confine_relative_path(relative: &str) -> Result<(), PathConfinementError> {
    if relative.is_empty() {
        return Err(PathConfinementError::Empty);
    }
    if relative.len() > MAX_BOUNDED_PATH_LEN {
        return Err(PathConfinementError::TooLong { found: relative.len(), max: MAX_BOUNDED_PATH_LEN });
    }
    if relative.contains('\0') {
        return Err(PathConfinementError::ContainsNulByte);
    }
    if relative.starts_with('/') || relative.starts_with('\\') {
        return Err(PathConfinementError::Absolute);
    }
    // `C:\...`, `C:/...`, or a bare `C:` component anywhere in the path.
    let drive_letter_prefix = relative.len() >= 2
        && relative.as_bytes()[0].is_ascii_alphabetic()
        && relative.as_bytes()[1] == b':';
    if drive_letter_prefix {
        return Err(PathConfinementError::ContainsDriveLetter);
    }
    for component in relative.split(['/', '\\']) {
        if component == ".." {
            return Err(PathConfinementError::ContainsParentTraversal);
        }
    }
    Ok(())
}

/// Upper bound on `request_id` length — generous for any real UUID/ULID,
/// small enough to refuse an attacker trying to pass megabytes of string.
pub const MAX_REQUEST_ID_LEN: usize = 128;
/// Upper bound on how many input digests / bounded paths a single request
/// may carry. The pipeline processes at most a handful of inputs per call;
/// anything near this ceiling is already a protocol misuse.
pub const MAX_DIGESTS_PER_REQUEST: usize = 64;
pub const MAX_BOUNDED_PATHS_PER_REQUEST: usize = 64;
/// Timeout bounds, matching brief §7's multi-second-scale operations —
/// zero would hang forever as "already expired," multi-minute values are
/// refused rather than silently honored.
pub const MIN_TIMEOUT_MS: u64 = 1;
pub const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// Validates that `s` is exactly 64 lowercase ASCII hex characters — the
/// canonical shape every SHA-256 digest field in this protocol and in
/// [`crate::sop_session`] must take. Case-sensitive on purpose: callers
/// that need case-insensitive comparison (e.g.
/// [`crate::sop_session::check_source_binding`]) do their own
/// `eq_ignore_ascii_case`; *accepting* mixed case here would let two
/// different-looking strings both pass validation while meaning the same
/// digest, which is exactly the kind of ambiguity a fail-closed identity
/// field must not have.
pub fn is_valid_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Brief §2.1 request shape. `deny_unknown_fields` on every wire type in
/// this module is load-bearing: an older/newer/malformed client sending an
/// extra field must fail closed, never be silently ignored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcRequest {
    pub request_id: String,
    pub schema_version: u32,
    pub operation: SidecarOperation,
    pub input_digests_sha256: Vec<String>,
    pub bounded_paths: Vec<BoundedPath>,
    pub timeout_ms: u64,
    pub model_manifest_sha256: String,
}

/// Brief §2.1: "Responses echo the request and input identities."
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcResponse {
    pub request_id: String,
    pub schema_version: u32,
    pub echoed_input_digests_sha256: Vec<String>,
    pub result: IpcResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum IpcResult {
    Ok { payload: serde_json::Value },
    Err { code: String, message: String },
}

/// Reasons a request is refused before it's ever dispatched to an
/// operation handler. "Unknown fields/versions and paths outside the
/// session root fail closed" (brief §2.1) — this is the fail-closed gate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestValidationError {
    UnsupportedSchemaVersion { found: u32, max_supported: u32 },
    EmptyRequestId,
    RequestIdTooLong { found: usize, max: usize },
    TooManyDigests { found: usize, max: usize },
    InvalidDigest,
    TooManyBoundedPaths { found: usize, max: usize },
    PathConfinement(PathConfinementError),
    TimeoutOutOfRange { found: u64, min: u64, max: u64 },
    InvalidModelManifestDigest,
}

/// Validates a request's protocol-level shape: an *exact* supported
/// schema version (not just an upper bound — version `0` or any other
/// non-current value fails closed exactly like a too-new one, per brief
/// §2.1's "unknown... versions... fail closed"), non-empty bounded
/// request id, bounded/well-formed digest and path collections, a
/// bounded timeout, and every bounded path already lexically confined
/// (since [`BoundedPath`] can only be constructed via [`BoundedPath::new`],
/// a request built any other way than by hand already satisfies this —
/// this function exists for requests deserialized from the wire, where a
/// malformed/old client could have sent something that bypasses the
/// constructor via `#[serde(transparent)]`).
pub fn validate_request(req: &IpcRequest) -> Result<(), RequestValidationError> {
    if req.schema_version != SIDECAR_PROTOCOL_VERSION {
        return Err(RequestValidationError::UnsupportedSchemaVersion {
            found: req.schema_version,
            max_supported: SIDECAR_PROTOCOL_VERSION,
        });
    }
    if req.request_id.is_empty() {
        return Err(RequestValidationError::EmptyRequestId);
    }
    if req.request_id.len() > MAX_REQUEST_ID_LEN {
        return Err(RequestValidationError::RequestIdTooLong { found: req.request_id.len(), max: MAX_REQUEST_ID_LEN });
    }
    if req.input_digests_sha256.len() > MAX_DIGESTS_PER_REQUEST {
        return Err(RequestValidationError::TooManyDigests {
            found: req.input_digests_sha256.len(),
            max: MAX_DIGESTS_PER_REQUEST,
        });
    }
    for digest in &req.input_digests_sha256 {
        if !is_valid_sha256_hex(digest) {
            return Err(RequestValidationError::InvalidDigest);
        }
    }
    if !is_valid_sha256_hex(&req.model_manifest_sha256) {
        return Err(RequestValidationError::InvalidModelManifestDigest);
    }
    if req.bounded_paths.len() > MAX_BOUNDED_PATHS_PER_REQUEST {
        return Err(RequestValidationError::TooManyBoundedPaths {
            found: req.bounded_paths.len(),
            max: MAX_BOUNDED_PATHS_PER_REQUEST,
        });
    }
    for path in &req.bounded_paths {
        confine_relative_path(path.as_str()).map_err(RequestValidationError::PathConfinement)?;
    }
    if req.timeout_ms < MIN_TIMEOUT_MS || req.timeout_ms > MAX_TIMEOUT_MS {
        return Err(RequestValidationError::TimeoutOutOfRange {
            found: req.timeout_ms,
            min: MIN_TIMEOUT_MS,
            max: MAX_TIMEOUT_MS,
        });
    }
    Ok(())
}

/// Upper bounds on response-side fields (C2P1-RR-001): a response is just
/// as untrusted as a request — it comes from an external sidecar process,
/// not from code this crate controls — so it needs the same fail-closed
/// treatment, not just `deny_unknown_fields` on the struct shape.
pub const MAX_ERROR_CODE_LEN: usize = 128;
pub const MAX_ERROR_MESSAGE_LEN: usize = 2000;
/// Generous enough for any legitimate `Ok` payload this protocol carries
/// in C2-P1 (no OCR/NER/caption payloads exist yet — this slice has no
/// operation implementations), small enough to refuse an oversized/
/// runaway response before it's used for anything.
pub const MAX_RESULT_PAYLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponseValidationError {
    UnsupportedSchemaVersion { found: u32, expected: u32 },
    /// The response's own `request_id` doesn't match the request it's
    /// supposedly answering — brief §2.1: "Responses echo the request and
    /// input identities." A mismatch here means either a misrouted
    /// response or a confused/hostile sidecar; either way it must never
    /// be silently accepted as this request's answer.
    RequestIdMismatch,
    /// `echoed_input_digests_sha256` doesn't match the request's own
    /// `input_digests_sha256` exactly (same set, same order) — the other
    /// half of "echo the... input identities."
    EchoedDigestsMismatch,
    ErrorCodeEmpty,
    ErrorCodeTooLong { found: usize, max: usize },
    ErrorMessageTooLong { found: usize, max: usize },
    ResultPayloadTooLarge { found_bytes: usize, max_bytes: usize },
}

/// Validates a sidecar response against the exact request it's answering:
/// exact protocol version, request-id/digest correlation, and bounded
/// result-specific fields (error code/message length, `Ok` payload byte
/// size). A caller must run this on every response **before** doing
/// anything with `result` — never trust `deny_unknown_fields` alone to
/// make an externally-produced response safe to consume.
pub fn validate_response(resp: &IpcResponse, req: &IpcRequest) -> Result<(), ResponseValidationError> {
    if resp.schema_version != SIDECAR_PROTOCOL_VERSION {
        return Err(ResponseValidationError::UnsupportedSchemaVersion {
            found: resp.schema_version,
            expected: SIDECAR_PROTOCOL_VERSION,
        });
    }
    if resp.request_id != req.request_id {
        return Err(ResponseValidationError::RequestIdMismatch);
    }
    if resp.echoed_input_digests_sha256 != req.input_digests_sha256 {
        return Err(ResponseValidationError::EchoedDigestsMismatch);
    }
    match &resp.result {
        IpcResult::Ok { payload } => {
            let size = serde_json::to_vec(payload).map(|v| v.len()).unwrap_or(usize::MAX);
            if size > MAX_RESULT_PAYLOAD_BYTES {
                return Err(ResponseValidationError::ResultPayloadTooLarge { found_bytes: size, max_bytes: MAX_RESULT_PAYLOAD_BYTES });
            }
        }
        IpcResult::Err { code, message } => {
            if code.is_empty() {
                return Err(ResponseValidationError::ErrorCodeEmpty);
            }
            if code.len() > MAX_ERROR_CODE_LEN {
                return Err(ResponseValidationError::ErrorCodeTooLong { found: code.len(), max: MAX_ERROR_CODE_LEN });
            }
            if message.len() > MAX_ERROR_MESSAGE_LEN {
                return Err(ResponseValidationError::ErrorMessageTooLong { found: message.len(), max: MAX_ERROR_MESSAGE_LEN });
            }
        }
    }
    Ok(())
}

/// Encodes one message with a 4-byte big-endian length prefix, matching
/// brief §2.1's "length-prefixed JSON over inherited stdin/stdout."
pub fn encode_framed(payload: &[u8]) -> Vec<u8> {
    let len = payload.len() as u32;
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Maximum declared frame payload size. An external sidecar process's
/// own write timing is untrusted input; without this cap a malicious or
/// corrupted length header could direct the caller's read loop to buffer
/// gigabytes before ever reaching a JSON parser. 64 MiB comfortably
/// covers the largest legitimate payload this protocol carries (bounded
/// OCR JSON per brief §4 is already capped at 10 MiB) with headroom.
pub const MAX_FRAME_BYTES: u32 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameDecodeError {
    /// Fewer than 4 bytes buffered — not enough to even read a length yet.
    NeedMoreHeaderBytes,
    /// The declared length exceeds [`MAX_FRAME_BYTES`] — refused before
    /// the caller's read loop is told to buffer that many bytes at all.
    FrameTooLarge { declared_len: u32, max: u32 },
    /// Length header read, but the full payload hasn't arrived yet.
    NeedMorePayloadBytes { declared_len: u32, have: usize },
}

/// Decodes exactly one length-prefixed message from the front of `buf`.
/// Returns the message bytes and the remaining, unconsumed tail of
/// `buf` — callers read in a loop, feeding more bytes and retrying on
/// `NeedMore*` until a full message is available. This function never
/// panics or reads past what `buf` actually contains, which matters for
/// a boundary driven by an external process's own write timing.
pub fn decode_framed(buf: &[u8]) -> Result<(&[u8], &[u8]), FrameDecodeError> {
    if buf.len() < 4 {
        return Err(FrameDecodeError::NeedMoreHeaderBytes);
    }
    let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if len > MAX_FRAME_BYTES {
        return Err(FrameDecodeError::FrameTooLarge { declared_len: len, max: MAX_FRAME_BYTES });
    }
    let total_needed = 4 + len as usize;
    if buf.len() < total_needed {
        return Err(FrameDecodeError::NeedMorePayloadBytes { declared_len: len, have: buf.len() - 4 });
    }
    Ok((&buf[4..total_needed], &buf[total_needed..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- lexical path confinement ---

    #[test]
    fn accepts_an_ordinary_relative_path() {
        assert!(confine_relative_path("frames/f1.png").is_ok());
    }

    #[test]
    fn rejects_an_empty_path() {
        assert_eq!(confine_relative_path(""), Err(PathConfinementError::Empty));
    }

    #[test]
    fn rejects_a_leading_slash_as_absolute() {
        assert_eq!(confine_relative_path("/etc/passwd"), Err(PathConfinementError::Absolute));
    }

    #[test]
    fn rejects_a_leading_backslash_as_absolute() {
        assert_eq!(confine_relative_path("\\Windows\\System32"), Err(PathConfinementError::Absolute));
    }

    #[test]
    fn rejects_a_drive_letter_prefix() {
        assert_eq!(confine_relative_path("C:\\Windows\\System32"), Err(PathConfinementError::ContainsDriveLetter));
    }

    #[test]
    fn rejects_a_simple_parent_traversal() {
        assert_eq!(confine_relative_path("../secrets.txt"), Err(PathConfinementError::ContainsParentTraversal));
    }

    #[test]
    fn rejects_a_parent_traversal_buried_mid_path() {
        assert_eq!(
            confine_relative_path("frames/../../outside.png"),
            Err(PathConfinementError::ContainsParentTraversal)
        );
    }

    #[test]
    fn rejects_a_parent_traversal_using_backslash_separators() {
        assert_eq!(confine_relative_path("frames\\..\\..\\outside.png"), Err(PathConfinementError::ContainsParentTraversal));
    }

    #[test]
    fn rejects_an_embedded_nul_byte() {
        assert_eq!(confine_relative_path("frames/f1.png\0.exe"), Err(PathConfinementError::ContainsNulByte));
    }

    #[test]
    fn a_filename_that_merely_contains_dotdot_as_a_substring_is_fine() {
        // "a..b" is not the ".." component - must not be over-rejected.
        assert!(confine_relative_path("frames/a..b.png").is_ok());
    }

    #[test]
    fn bounded_path_new_refuses_to_construct_from_an_unsafe_path() {
        assert!(BoundedPath::new("../escape.png").is_err());
    }

    #[test]
    fn bounded_path_new_succeeds_for_a_safe_path_and_preserves_it() {
        let p = BoundedPath::new("frames/f1.png").unwrap();
        assert_eq!(p.as_str(), "frames/f1.png");
    }

    // --- request validation ---

    fn valid_request() -> IpcRequest {
        IpcRequest {
            request_id: "req-1".to_string(),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            operation: SidecarOperation::Ocr,
            input_digests_sha256: vec!["a".repeat(64)],
            bounded_paths: vec![BoundedPath::new("frames/f1.png").unwrap()],
            timeout_ms: 5000,
            model_manifest_sha256: "b".repeat(64),
        }
    }

    #[test]
    fn validate_request_accepts_a_well_formed_request() {
        assert!(validate_request(&valid_request()).is_ok());
    }

    #[test]
    fn validate_request_fails_closed_on_a_newer_schema_version() {
        let mut req = valid_request();
        req.schema_version = SIDECAR_PROTOCOL_VERSION + 1;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::UnsupportedSchemaVersion { found: SIDECAR_PROTOCOL_VERSION + 1, max_supported: SIDECAR_PROTOCOL_VERSION })
        );
    }

    #[test]
    fn validate_request_rejects_an_empty_request_id() {
        let mut req = valid_request();
        req.request_id = String::new();
        assert_eq!(validate_request(&req), Err(RequestValidationError::EmptyRequestId));
    }

    #[test]
    fn validate_request_rejects_schema_version_zero() {
        let mut req = valid_request();
        req.schema_version = 0;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::UnsupportedSchemaVersion { found: 0, max_supported: SIDECAR_PROTOCOL_VERSION })
        );
    }

    #[test]
    fn validate_request_rejects_an_oversized_request_id() {
        let mut req = valid_request();
        req.request_id = "x".repeat(MAX_REQUEST_ID_LEN + 1);
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::RequestIdTooLong { found: MAX_REQUEST_ID_LEN + 1, max: MAX_REQUEST_ID_LEN })
        );
    }

    #[test]
    fn validate_request_rejects_too_many_digests() {
        let mut req = valid_request();
        req.input_digests_sha256 = (0..=MAX_DIGESTS_PER_REQUEST).map(|_| "a".repeat(64)).collect();
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TooManyDigests { found: MAX_DIGESTS_PER_REQUEST + 1, max: MAX_DIGESTS_PER_REQUEST })
        );
    }

    #[test]
    fn validate_request_rejects_a_malformed_digest() {
        let mut req = valid_request();
        req.input_digests_sha256 = vec!["not-a-digest".to_string()];
        assert_eq!(validate_request(&req), Err(RequestValidationError::InvalidDigest));
    }

    #[test]
    fn validate_request_rejects_an_uppercase_digest() {
        let mut req = valid_request();
        req.input_digests_sha256 = vec!["A".repeat(64)];
        assert_eq!(validate_request(&req), Err(RequestValidationError::InvalidDigest));
    }

    #[test]
    fn validate_request_rejects_a_malformed_model_manifest_digest() {
        let mut req = valid_request();
        req.model_manifest_sha256 = "short".to_string();
        assert_eq!(validate_request(&req), Err(RequestValidationError::InvalidModelManifestDigest));
    }

    #[test]
    fn validate_request_rejects_too_many_bounded_paths() {
        let mut req = valid_request();
        req.bounded_paths = (0..=MAX_BOUNDED_PATHS_PER_REQUEST)
            .map(|i| BoundedPath::new(&format!("frames/f{i}.png")).unwrap())
            .collect();
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TooManyBoundedPaths { found: MAX_BOUNDED_PATHS_PER_REQUEST + 1, max: MAX_BOUNDED_PATHS_PER_REQUEST })
        );
    }

    #[test]
    fn validate_request_rejects_a_zero_timeout() {
        let mut req = valid_request();
        req.timeout_ms = 0;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TimeoutOutOfRange { found: 0, min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS })
        );
    }

    #[test]
    fn validate_request_rejects_an_excessive_timeout() {
        let mut req = valid_request();
        req.timeout_ms = MAX_TIMEOUT_MS + 1;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TimeoutOutOfRange { found: MAX_TIMEOUT_MS + 1, min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS })
        );
    }

    #[test]
    fn validate_request_accepts_boundary_timeout_values() {
        let mut req = valid_request();
        req.timeout_ms = MIN_TIMEOUT_MS;
        assert!(validate_request(&req).is_ok());
        req.timeout_ms = MAX_TIMEOUT_MS;
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn confine_relative_path_rejects_an_oversized_path() {
        let too_long = "a".repeat(MAX_BOUNDED_PATH_LEN + 1);
        assert_eq!(
            confine_relative_path(&too_long),
            Err(PathConfinementError::TooLong { found: too_long.len(), max: MAX_BOUNDED_PATH_LEN })
        );
    }

    #[test]
    fn ipc_request_rejects_an_unknown_field() {
        let json = serde_json::json!({
            "requestId": "req-1",
            "schemaVersion": 1,
            "operation": "ocr",
            "inputDigestsSha256": [],
            "boundedPaths": [],
            "timeoutMs": 1000,
            "modelManifestSha256": "b".repeat(64),
            "unexpectedField": "surprise",
        });
        let result: Result<IpcRequest, _> = serde_json::from_value(json);
        assert!(result.is_err());
    }

    #[test]
    fn ipc_response_rejects_an_unknown_field() {
        let json = serde_json::json!({
            "requestId": "req-1",
            "schemaVersion": 1,
            "echoedInputDigestsSha256": [],
            "result": {"status": "ok", "payload": {}},
            "unexpectedField": "surprise",
        });
        let result: Result<IpcResponse, _> = serde_json::from_value(json);
        assert!(result.is_err());
    }

    #[test]
    fn is_valid_sha256_hex_accepts_exactly_64_lowercase_hex_chars() {
        assert!(is_valid_sha256_hex(&"a".repeat(64)));
        assert!(!is_valid_sha256_hex(&"a".repeat(63)));
        assert!(!is_valid_sha256_hex(&"a".repeat(65)));
        assert!(!is_valid_sha256_hex(&"A".repeat(64)));
        assert!(!is_valid_sha256_hex(&"g".repeat(64)));
    }

    // --- C2P1-RR-001: response validation ---

    fn ok_response_for(req: &IpcRequest) -> IpcResponse {
        IpcResponse {
            request_id: req.request_id.clone(),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            echoed_input_digests_sha256: req.input_digests_sha256.clone(),
            result: IpcResult::Ok { payload: serde_json::json!({}) },
        }
    }

    #[test]
    fn validate_response_accepts_a_well_formed_correlated_response() {
        let req = valid_request();
        assert!(validate_response(&ok_response_for(&req), &req).is_ok());
    }

    #[test]
    fn validate_response_rejects_an_unsupported_schema_version() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.schema_version = SIDECAR_PROTOCOL_VERSION + 1;
        assert_eq!(
            validate_response(&resp, &req),
            Err(ResponseValidationError::UnsupportedSchemaVersion { found: SIDECAR_PROTOCOL_VERSION + 1, expected: SIDECAR_PROTOCOL_VERSION })
        );
    }

    #[test]
    fn validate_response_rejects_schema_version_zero() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.schema_version = 0;
        assert_eq!(
            validate_response(&resp, &req),
            Err(ResponseValidationError::UnsupportedSchemaVersion { found: 0, expected: SIDECAR_PROTOCOL_VERSION })
        );
    }

    #[test]
    fn validate_response_rejects_a_request_id_that_does_not_match_the_originating_request() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.request_id = "some-other-request".to_string();
        assert_eq!(validate_response(&resp, &req), Err(ResponseValidationError::RequestIdMismatch));
    }

    #[test]
    fn validate_response_rejects_echoed_digests_that_do_not_match_the_request() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.echoed_input_digests_sha256 = vec!["c".repeat(64)]; // differs from req's "a"*64
        assert_eq!(validate_response(&resp, &req), Err(ResponseValidationError::EchoedDigestsMismatch));
    }

    #[test]
    fn validate_response_rejects_an_empty_error_code() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.result = IpcResult::Err { code: String::new(), message: "x".to_string() };
        assert_eq!(validate_response(&resp, &req), Err(ResponseValidationError::ErrorCodeEmpty));
    }

    #[test]
    fn validate_response_rejects_an_oversized_error_code() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.result = IpcResult::Err { code: "x".repeat(MAX_ERROR_CODE_LEN + 1), message: "x".to_string() };
        assert_eq!(
            validate_response(&resp, &req),
            Err(ResponseValidationError::ErrorCodeTooLong { found: MAX_ERROR_CODE_LEN + 1, max: MAX_ERROR_CODE_LEN })
        );
    }

    #[test]
    fn validate_response_rejects_an_oversized_error_message() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        resp.result = IpcResult::Err { code: "TIMEOUT".to_string(), message: "x".repeat(MAX_ERROR_MESSAGE_LEN + 1) };
        assert_eq!(
            validate_response(&resp, &req),
            Err(ResponseValidationError::ErrorMessageTooLong { found: MAX_ERROR_MESSAGE_LEN + 1, max: MAX_ERROR_MESSAGE_LEN })
        );
    }

    #[test]
    fn validate_response_rejects_an_oversized_ok_payload() {
        let req = valid_request();
        let mut resp = ok_response_for(&req);
        let huge = "x".repeat(MAX_RESULT_PAYLOAD_BYTES + 1);
        resp.result = IpcResult::Ok { payload: serde_json::json!({ "data": huge }) };
        assert!(matches!(validate_response(&resp, &req), Err(ResponseValidationError::ResultPayloadTooLarge { .. })));
    }

    // --- framing ---

    #[test]
    fn decode_framed_rejects_a_frame_declaring_more_than_the_maximum_bytes() {
        let mut framed = Vec::new();
        framed.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_be_bytes());
        assert_eq!(
            decode_framed(&framed),
            Err(FrameDecodeError::FrameTooLarge { declared_len: MAX_FRAME_BYTES + 1, max: MAX_FRAME_BYTES })
        );
    }

    #[test]
    fn decode_framed_rejects_an_oversized_frame_before_requesting_more_payload_bytes() {
        // Even with zero payload bytes buffered yet, an oversized declared
        // length must be refused immediately rather than becoming a
        // `NeedMorePayloadBytes` that would tell the caller to keep
        // buffering towards that huge size.
        let mut framed = Vec::new();
        framed.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_be_bytes());
        let err = decode_framed(&framed).unwrap_err();
        assert!(matches!(err, FrameDecodeError::FrameTooLarge { .. }));
    }

    #[test]
    fn encode_then_decode_roundtrips_exactly() {
        let payload = br#"{"hello":"world"}"#;
        let framed = encode_framed(payload);
        let (decoded, rest) = decode_framed(&framed).unwrap();
        assert_eq!(decoded, payload);
        assert!(rest.is_empty());
    }

    #[test]
    fn decode_framed_reports_need_more_header_bytes_for_a_short_buffer() {
        assert_eq!(decode_framed(&[0, 0]), Err(FrameDecodeError::NeedMoreHeaderBytes));
    }

    #[test]
    fn decode_framed_reports_need_more_payload_bytes_when_the_body_is_incomplete() {
        let framed = encode_framed(b"hello world");
        // Header says 11 bytes of payload; only give it 5.
        let partial = &framed[..9];
        assert_eq!(
            decode_framed(partial),
            Err(FrameDecodeError::NeedMorePayloadBytes { declared_len: 11, have: 5 })
        );
    }

    #[test]
    fn decode_framed_leaves_the_correct_remainder_for_a_second_message() {
        let a = encode_framed(b"first");
        let b = encode_framed(b"second");
        let mut combined = a.clone();
        combined.extend_from_slice(&b);
        let (first, rest) = decode_framed(&combined).unwrap();
        assert_eq!(first, b"first");
        let (second, rest2) = decode_framed(rest).unwrap();
        assert_eq!(second, b"second");
        assert!(rest2.is_empty());
    }

    #[test]
    fn decode_framed_never_panics_on_a_zero_length_message() {
        let framed = encode_framed(b"");
        let (decoded, rest) = decode_framed(&framed).unwrap();
        assert!(decoded.is_empty());
        assert!(rest.is_empty());
    }

    #[test]
    fn ipc_response_result_ok_and_err_both_round_trip_through_json() {
        let ok = IpcResponse {
            request_id: "r1".to_string(),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            echoed_input_digests_sha256: vec!["a".repeat(64)],
            result: IpcResult::Ok { payload: serde_json::json!({"k": "v"}) },
        };
        let json = serde_json::to_vec(&ok).unwrap();
        let back: IpcResponse = serde_json::from_slice(&json).unwrap();
        assert_eq!(back.request_id, "r1");

        let err = IpcResponse {
            request_id: "r2".to_string(),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            echoed_input_digests_sha256: vec![],
            result: IpcResult::Err { code: "TIMEOUT".to_string(), message: "exceeded bound".to_string() },
        };
        let json2 = serde_json::to_vec(&err).unwrap();
        let back2: IpcResponse = serde_json::from_slice(&json2).unwrap();
        match back2.result {
            IpcResult::Err { code, .. } => assert_eq!(code, "TIMEOUT"),
            _ => panic!("expected Err variant"),
        }
    }
}
