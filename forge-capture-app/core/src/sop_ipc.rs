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

/// Brief §2.1 request shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct IpcResponse {
    pub request_id: String,
    pub schema_version: u32,
    pub echoed_input_digests_sha256: Vec<String>,
    pub result: IpcResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
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
    PathConfinement(PathConfinementError),
}

/// Validates a request's protocol-level shape: supported schema version,
/// non-empty request id, and every bounded path already lexically
/// confined (since [`BoundedPath`] can only be constructed via
/// [`BoundedPath::new`], a request built any other way than by hand
/// already satisfies this — this function exists for requests
/// deserialized from the wire, where a malformed/old client could have
/// sent something that bypasses the constructor).
pub fn validate_request(req: &IpcRequest) -> Result<(), RequestValidationError> {
    if req.schema_version > SIDECAR_PROTOCOL_VERSION {
        return Err(RequestValidationError::UnsupportedSchemaVersion {
            found: req.schema_version,
            max_supported: SIDECAR_PROTOCOL_VERSION,
        });
    }
    if req.request_id.is_empty() {
        return Err(RequestValidationError::EmptyRequestId);
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
