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

/// C2P1-001 fix-round bounds. Every one of these is enforced by
/// [`validate_request`]/[`decode_framed`] — never just documented. Chosen
/// generously for real use (a session caps at 50 frames per
/// [`crate::sop_session::MAX_FRAMES_PER_SESSION`], so these are well
/// above anything a legitimate request needs) and cheap insurance against
/// an unbounded/attacker-controlled sidecar boundary, same reasoning as
/// [`crate::annotations::MAX_ITEMS`]/`MAX_TEXT_CHARS`.
pub const MAX_REQUEST_ID_CHARS: usize = 128;
pub const MAX_TIMEOUT_MS: u64 = 5 * 60 * 1000; // 5 minutes
pub const MAX_DIGESTS_PER_REQUEST: usize = 64;
pub const MAX_PATHS_PER_REQUEST: usize = 64;
/// Hard ceiling on one framed IPC message, checked by [`decode_framed`]
/// **before** the payload is ever buffered/allocated — a declared length
/// above this is refused immediately rather than causing an unbounded
/// read.
pub const MAX_FRAME_BYTES: u32 = 16 * 1024 * 1024;

/// True only for a lowercase-or-uppercase 64-character hex string (a
/// SHA-256 digest's canonical text form). Used for every digest/
/// model-manifest identity field at the IPC boundary — never accepted as
/// a bare non-empty string.
fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Brief §2.1 request shape. `deny_unknown_fields`: an unrecognized field
/// on the wire is refused at deserialization, never silently ignored —
/// brief §2.1's "unknown fields... fail closed."
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
    UnsupportedSchemaVersion { found: u32, min_supported: u32, max_supported: u32 },
    EmptyRequestId,
    RequestIdTooLong { found: usize, max: usize },
    TimeoutOutOfBounds { found_ms: u64, max_ms: u64 },
    TooManyDigests { found: usize, max: usize },
    TooManyPaths { found: usize, max: usize },
    InvalidDigest { field: &'static str, value: String },
    PathConfinement(PathConfinementError),
}

/// Validates a request's protocol-level shape: supported schema version
/// (exactly in `[1, SIDECAR_PROTOCOL_VERSION]` — `0` is refused, not just
/// anything above the max), bounded request id, bounded/well-formed
/// digests, bounded timeout, bounded path count, and every bounded path
/// already lexically confined (since [`BoundedPath`] can only be
/// constructed via [`BoundedPath::new`], a request built any other way
/// than by hand already satisfies that specific check — this function
/// exists for requests deserialized from the wire, where a malformed/old
/// client could have sent something that bypasses the constructor).
pub fn validate_request(req: &IpcRequest) -> Result<(), RequestValidationError> {
    if req.schema_version == 0 || req.schema_version > SIDECAR_PROTOCOL_VERSION {
        return Err(RequestValidationError::UnsupportedSchemaVersion {
            found: req.schema_version,
            min_supported: 1,
            max_supported: SIDECAR_PROTOCOL_VERSION,
        });
    }
    if req.request_id.is_empty() {
        return Err(RequestValidationError::EmptyRequestId);
    }
    if req.request_id.chars().count() > MAX_REQUEST_ID_CHARS {
        return Err(RequestValidationError::RequestIdTooLong {
            found: req.request_id.chars().count(),
            max: MAX_REQUEST_ID_CHARS,
        });
    }
    if req.timeout_ms == 0 || req.timeout_ms > MAX_TIMEOUT_MS {
        return Err(RequestValidationError::TimeoutOutOfBounds { found_ms: req.timeout_ms, max_ms: MAX_TIMEOUT_MS });
    }
    if req.input_digests_sha256.len() > MAX_DIGESTS_PER_REQUEST {
        return Err(RequestValidationError::TooManyDigests {
            found: req.input_digests_sha256.len(),
            max: MAX_DIGESTS_PER_REQUEST,
        });
    }
    if req.bounded_paths.len() > MAX_PATHS_PER_REQUEST {
        return Err(RequestValidationError::TooManyPaths { found: req.bounded_paths.len(), max: MAX_PATHS_PER_REQUEST });
    }
    for digest in &req.input_digests_sha256 {
        if !is_sha256_hex(digest) {
            return Err(RequestValidationError::InvalidDigest { field: "input_digests_sha256", value: digest.clone() });
        }
    }
    if !is_sha256_hex(&req.model_manifest_sha256) {
        return Err(RequestValidationError::InvalidDigest {
            field: "model_manifest_sha256",
            value: req.model_manifest_sha256.clone(),
        });
    }
    for path in &req.bounded_paths {
        confine_relative_path(path.as_str()).map_err(RequestValidationError::PathConfinement)?;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameDecodeError {
    /// Fewer than 4 bytes buffered — not enough to even read a length yet.
    NeedMoreHeaderBytes,
    /// Length header read, but the full payload hasn't arrived yet.
    NeedMorePayloadBytes { declared_len: u32, have: usize },
    /// The declared length exceeds [`MAX_FRAME_BYTES`] — refused
    /// immediately, before any attempt to buffer or wait for that many
    /// bytes, so a corrupt/hostile length header can never force an
    /// unbounded read.
    FrameTooLarge { declared_len: u32, max: u32 },
}

/// Decodes exactly one length-prefixed message from the front of `buf`.
/// Returns the message bytes and the remaining, unconsumed tail of
/// `buf` — callers read in a loop, feeding more bytes and retrying on
/// `NeedMore*` until a full message is available. This function never
/// panics or reads past what `buf` actually contains, which matters for
/// a boundary driven by an external process's own write timing. A
/// declared length above [`MAX_FRAME_BYTES`] is refused before the
/// `have < total_needed` check, so a hostile 4 GiB header can never be
/// used to stall this function waiting on bytes that will never arrive in
/// a legitimate message.
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
            Err(RequestValidationError::UnsupportedSchemaVersion {
                found: SIDECAR_PROTOCOL_VERSION + 1,
                min_supported: 1,
                max_supported: SIDECAR_PROTOCOL_VERSION
            })
        );
    }

    #[test]
    fn validate_request_fails_closed_on_schema_version_zero() {
        // C2P1-001: the original version check only rejected ABOVE the
        // max, so 0 (never a real version) slipped through.
        let mut req = valid_request();
        req.schema_version = 0;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::UnsupportedSchemaVersion { found: 0, min_supported: 1, max_supported: SIDECAR_PROTOCOL_VERSION })
        );
    }

    #[test]
    fn validate_request_rejects_an_empty_request_id() {
        let mut req = valid_request();
        req.request_id = String::new();
        assert_eq!(validate_request(&req), Err(RequestValidationError::EmptyRequestId));
    }

    #[test]
    fn validate_request_rejects_an_oversized_request_id() {
        let mut req = valid_request();
        req.request_id = "x".repeat(MAX_REQUEST_ID_CHARS + 1);
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::RequestIdTooLong { found: MAX_REQUEST_ID_CHARS + 1, max: MAX_REQUEST_ID_CHARS })
        );
    }

    #[test]
    fn validate_request_accepts_exactly_the_max_request_id_length() {
        let mut req = valid_request();
        req.request_id = "x".repeat(MAX_REQUEST_ID_CHARS);
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn validate_request_rejects_a_zero_timeout() {
        let mut req = valid_request();
        req.timeout_ms = 0;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TimeoutOutOfBounds { found_ms: 0, max_ms: MAX_TIMEOUT_MS })
        );
    }

    #[test]
    fn validate_request_rejects_an_excessive_timeout() {
        let mut req = valid_request();
        req.timeout_ms = MAX_TIMEOUT_MS + 1;
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TimeoutOutOfBounds { found_ms: MAX_TIMEOUT_MS + 1, max_ms: MAX_TIMEOUT_MS })
        );
    }

    #[test]
    fn validate_request_accepts_exactly_the_max_timeout() {
        let mut req = valid_request();
        req.timeout_ms = MAX_TIMEOUT_MS;
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn validate_request_rejects_too_many_digests() {
        let mut req = valid_request();
        req.input_digests_sha256 = (0..MAX_DIGESTS_PER_REQUEST + 1).map(|_| "a".repeat(64)).collect();
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TooManyDigests { found: MAX_DIGESTS_PER_REQUEST + 1, max: MAX_DIGESTS_PER_REQUEST })
        );
    }

    #[test]
    fn validate_request_rejects_too_many_paths() {
        let mut req = valid_request();
        req.bounded_paths = (0..MAX_PATHS_PER_REQUEST + 1).map(|i| BoundedPath::new(&format!("f{i}.png")).unwrap()).collect();
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::TooManyPaths { found: MAX_PATHS_PER_REQUEST + 1, max: MAX_PATHS_PER_REQUEST })
        );
    }

    #[test]
    fn validate_request_rejects_a_malformed_input_digest() {
        let mut req = valid_request();
        req.input_digests_sha256 = vec!["not-a-hex-digest".to_string()];
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::InvalidDigest { field: "input_digests_sha256", value: "not-a-hex-digest".to_string() })
        );
    }

    #[test]
    fn validate_request_rejects_a_digest_of_the_wrong_length() {
        let mut req = valid_request();
        req.input_digests_sha256 = vec!["a".repeat(63)]; // one short
        assert!(matches!(validate_request(&req), Err(RequestValidationError::InvalidDigest { .. })));
    }

    #[test]
    fn validate_request_rejects_a_malformed_model_manifest_digest() {
        let mut req = valid_request();
        req.model_manifest_sha256 = "zz".repeat(32); // right length, not hex
        assert_eq!(
            validate_request(&req),
            Err(RequestValidationError::InvalidDigest { field: "model_manifest_sha256", value: "zz".repeat(32) })
        );
    }

    #[test]
    fn ipc_request_deserialization_rejects_an_unknown_field() {
        let json = r#"{
            "requestId": "r1", "schemaVersion": 1, "operation": "ocr",
            "inputDigestsSha256": [], "boundedPaths": [], "timeoutMs": 1000,
            "modelManifestSha256": "a",
            "unknownExtraField": "should fail closed"
        }"#;
        let result: Result<IpcRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn ipc_response_deserialization_rejects_an_unknown_field() {
        let json = r#"{
            "requestId": "r1", "schemaVersion": 1, "echoedInputDigestsSha256": [],
            "result": {"status": "ok", "payload": {}}, "unknownExtraField": "x"
        }"#;
        let result: Result<IpcResponse, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // --- framing ---

    #[test]
    fn encode_then_decode_roundtrips_exactly() {
        let payload = br#"{"hello":"world"}"#;
        let framed = encode_framed(payload);
        let (decoded, rest) = decode_framed(&framed).unwrap();
        assert_eq!(decoded, payload);
        assert!(rest.is_empty());
    }

    #[test]
    fn decode_framed_refuses_a_declared_length_over_the_cap_before_waiting_for_the_bytes() {
        // C2P1-001: a hostile/corrupt 4-byte length header claiming
        // slightly more than MAX_FRAME_BYTES must be refused immediately
        // - never treated as "need more bytes" and left waiting on a
        // payload that would exceed the bound even if it arrived.
        let mut framed = Vec::new();
        framed.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_be_bytes());
        assert_eq!(
            decode_framed(&framed),
            Err(FrameDecodeError::FrameTooLarge { declared_len: MAX_FRAME_BYTES + 1, max: MAX_FRAME_BYTES })
        );
    }

    #[test]
    fn decode_framed_accepts_exactly_the_max_frame_bytes_declared_length() {
        let mut framed = Vec::new();
        framed.extend_from_slice(&MAX_FRAME_BYTES.to_be_bytes());
        // Declared length is at the cap but the actual buffer doesn't
        // carry that many bytes yet - must be NeedMorePayloadBytes, not
        // FrameTooLarge (the cap itself is a valid, acceptable size).
        assert_eq!(
            decode_framed(&framed),
            Err(FrameDecodeError::NeedMorePayloadBytes { declared_len: MAX_FRAME_BYTES, have: 0 })
        );
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
