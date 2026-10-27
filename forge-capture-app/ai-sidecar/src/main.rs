//! FORGE Capture AI sidecar — brief §2.1 runtime boundary.
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §2.1: "The sidecar owns OCR and ONNX inference. It has no network
//! capability and no authority to export, upload, delete source
//! captures, or mark a session verified. IPC is length-prefixed JSON
//! over inherited stdin/stdout... Responses echo the request and input
//! identities. Unknown fields/versions and paths outside the session
//! root fail closed... One sidecar process handles one session, with
//! one inference request at a time... Cancellation kills the child and
//! leaves the last durable checkpoint intact."
//!
//! **This build is the C2-P2 scaffolding slice only**: it proves the
//! real process boundary and the length-prefixed IPC framing work end
//! to end, using the pure protocol types [`forge_capture_core::sop_ipc`]
//! already defined in C2-P1. It links no OCR/NER/caption model runtime
//! at all — adding one (PP-OCR ONNX Runtime, per brief §2.2) is a
//! separate new-dependency/model-download decision
//! (`results/claude/capture-c2-p2-authorization-needed-2026-10-27.md`),
//! not something this binary does on its own authority. Every request
//! that passes protocol-level validation is answered with a typed
//! `OPERATION_NOT_IMPLEMENTED` error — never silently dropped, never an
//! ad-hoc payload shape — so the process boundary, framing, and
//! validation are real and testable today, and the only thing left for
//! a later slice to add is the actual inference dispatch inside
//! [`handle_request`].

use std::io::{self, Read, Write};

use forge_capture_core::sop_ipc::{
    decode_framed, encode_framed, validate_request, FrameDecodeError, IpcRequest, IpcResponse,
    IpcResult, SIDECAR_PROTOCOL_VERSION,
};

/// Reads from `reader` into `buf`, consuming already-buffered bytes
/// first, until one complete length-prefixed frame is available. Returns
/// `Ok(None)` only on a clean EOF between messages (no partial frame in
/// flight) — the ordinary "the client closed the session" exit. Any
/// other condition (an oversized declared length, or EOF mid-frame) is
/// `Err`, so the caller can end this process cleanly rather than hang or
/// panic on a corrupted/malicious stream.
fn read_one_frame<R: Read>(mut reader: R, buf: &mut Vec<u8>) -> io::Result<Option<Vec<u8>>> {
    let mut chunk = [0u8; 8192];
    loop {
        match decode_framed(buf) {
            Ok((payload, rest)) => {
                let payload = payload.to_vec();
                let consumed = buf.len() - rest.len();
                buf.drain(0..consumed);
                return Ok(Some(payload));
            }
            Err(FrameDecodeError::FrameTooLarge { declared_len, max }) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("declared frame length {declared_len} exceeds max {max}"),
                ));
            }
            Err(FrameDecodeError::NeedMoreHeaderBytes) | Err(FrameDecodeError::NeedMorePayloadBytes { .. }) => {
                let n = reader.read(&mut chunk)?;
                if n == 0 {
                    if buf.is_empty() {
                        return Ok(None);
                    }
                    return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "stdin closed mid-frame"));
                }
                buf.extend_from_slice(&chunk[..n]);
            }
        }
    }
}

/// The one response this scaffolding slice can give for any
/// protocol-valid request: a typed, structured "not implemented" error.
/// Still echoes the request's own identity fields exactly as every other
/// response must (brief §2.1) — a stub answer is not an excuse to break
/// the echo contract a real caller's [`forge_capture_core::sop_ipc::validate_response`]
/// depends on.
fn handle_request(req: &IpcRequest) -> IpcResponse {
    IpcResponse {
        request_id: req.request_id.clone(),
        schema_version: SIDECAR_PROTOCOL_VERSION,
        echoed_input_digests_sha256: req.input_digests_sha256.clone(),
        result: IpcResult::Err {
            code: "OPERATION_NOT_IMPLEMENTED".to_string(),
            message: format!(
                "{:?} is not implemented in this build — C2-P2 scaffolding carries no inference runtime",
                req.operation
            ),
        },
    }
}

/// A response for a request that deserialized but failed protocol-level
/// validation (bad schema version, malformed digest, path escaping the
/// session root, out-of-range timeout, ...). Still a well-formed,
/// typed `IpcResponse`, echoing whatever identity the raw struct carried
/// even though it's invalid — never a crash, never a dropped frame with
/// no explanation.
fn invalid_request_response(req: &IpcRequest, reason: String) -> IpcResponse {
    IpcResponse {
        request_id: req.request_id.clone(),
        schema_version: SIDECAR_PROTOCOL_VERSION,
        echoed_input_digests_sha256: req.input_digests_sha256.clone(),
        result: IpcResult::Err { code: "INVALID_REQUEST".to_string(), message: reason },
    }
}

fn main() {
    // Test hook only (never read from untrusted request input): lets a
    // client-side timeout/cancel test deterministically force this
    // process to delay before answering, instead of racing real
    // wall-clock timing against an instant stub reply. Zero effect
    // unless a test sets it.
    let test_delay_ms: u64 = std::env::var("FORGE_SIDECAR_TEST_DELAY_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Test hook only (C2P2-005's client-side fix needs a real sidecar
    // that writes enough to stderr to fill its pipe buffer if nothing
    // drains it, to prove the client's stderr-draining thread actually
    // prevents that from blocking the child and masquerading as a
    // request timeout). Written once at startup, before the main loop.
    if let Ok(n) = std::env::var("FORGE_SIDECAR_TEST_STDERR_FLOOD_BYTES").map(|s| s.parse::<usize>().unwrap_or(0)) {
        let line = "x".repeat(4096);
        let mut written = 0usize;
        while written < n {
            eprintln!("{line}");
            written += line.len() + 1;
        }
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut lock_in = stdin.lock();
    let mut lock_out = stdout.lock();
    let mut buf = Vec::new();

    // Test hook only (C2P2-001's client-side fix needs a real child that
    // is alive but never reads, to prove the client's write phase — not
    // just its read phase — is bounded by the request timeout). Blocks
    // forever without ever touching stdin, so a client writing a
    // request larger than the OS pipe buffer genuinely blocks on
    // `write_all`, exactly the scenario the finding named.
    if std::env::var("FORGE_SIDECAR_TEST_NEVER_READ").is_ok() {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    }

    loop {
        let frame = match read_one_frame(&mut lock_in, &mut buf) {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                eprintln!("forge-capture-ai-sidecar: ending session: {e}");
                break;
            }
        };

        if test_delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(test_delay_ms));
        }

        // Test hook only (C2P2-003's client-side fix needs a real
        // sidecar that deliberately sends back malformed/incorrect-
        // identity/wrong-version bytes, to prove the client rejects
        // them and retires the session rather than trusting them). The
        // override is raw bytes, framed exactly as a normal response
        // would be, sent once in place of the real stub answer for
        // *this* request only; never read from untrusted request input.
        if let Ok(raw) = std::env::var("FORGE_SIDECAR_TEST_RAW_RESPONSE_OVERRIDE") {
            let framed = encode_framed(raw.as_bytes());
            let _ = lock_out.write_all(&framed);
            let _ = lock_out.flush();
            continue;
        }

        let response = match serde_json::from_slice::<IpcRequest>(&frame) {
            Ok(req) => match validate_request(&req) {
                Ok(()) => handle_request(&req),
                Err(e) => invalid_request_response(&req, format!("{e:?}")),
            },
            Err(e) => {
                // No identity to honestly echo — there is nothing safe
                // to send back. Log and keep the session alive for the
                // next, hopefully well-formed request rather than
                // tearing down the whole process over one bad message.
                eprintln!("forge-capture-ai-sidecar: dropping malformed request frame: {e}");
                continue;
            }
        };

        let payload = serde_json::to_vec(&response).expect("IpcResponse must always serialize");
        let framed = encode_framed(&payload);
        if lock_out.write_all(&framed).is_err() {
            break;
        }
        if lock_out.flush().is_err() {
            break;
        }
    }
}
