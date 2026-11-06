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

mod ocr_engine;

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use forge_capture_core::model_pack::{self, ModelManifest};
use forge_capture_core::sop_ipc::{
    decode_framed, encode_framed, validate_request, FrameDecodeError, IpcRequest, IpcResponse,
    IpcResult, SidecarOperation, SIDECAR_PROTOCOL_VERSION,
};
use forge_capture_core::sop_ocr_ipc::{RecognitionOutcome, UNDETERMINED_LANGUAGE, UNKNOWN_TEXT_SENTINEL};
use forge_capture_core::sop_session::sha256_hex;
use ocr_engine::OcrRegionResult;

/// Stable identity string stamped on every `OcrToken.engineIdentity` this
/// build produces — brief §4's `OcrToken.engine_identity` field.
const OCR_ENGINE_IDENTITY: &str = "forge-capture-ppocr-en-latin-v1";

/// Loaded, verified OCR runtime: both ONNX sessions, the decoded
/// character table, and the exact manifest digest they were verified
/// against (so a later request naming a *different* manifest digest
/// forces a fresh reload-and-reverify rather than silently reusing a
/// stale pack — see [`load_ocr_runtime`]'s caller in [`handle_ocr_request`]).
struct OcrRuntime {
    det_session: ort::session::Session,
    rec_session: ort::session::Session,
    character_table: Vec<Option<String>>,
    manifest_sha256: String,
    #[allow(dead_code)] // kept for future NER/caption slices' own pack reuse
    manifest: ModelManifest,
}

/// The model pack directory this build reads from. A real installed
/// build's packaging/location policy is C2-P7's job (brief §6 row); this
/// is the pack's known-on-disk location in this repository and dev/CI
/// checkout, the same division `include_bytes!("../model-pack/en_dict.txt")`
/// in `ocr_engine`'s own tests already relies on.
fn model_pack_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("model-pack")
}

fn load_ocr_runtime(expected_manifest_sha256: &str) -> Result<OcrRuntime, String> {
    let dir = model_pack_dir();
    let manifest = model_pack::verify_model_pack(&dir, expected_manifest_sha256, SIDECAR_PROTOCOL_VERSION).map_err(|e| format!("{e:?}"))?;

    let det_path = model_pack::resolve_asset_path(&dir, &manifest, "det_en_ppocrv3_mobile.onnx")
        .ok_or_else(|| "manifest does not declare det_en_ppocrv3_mobile.onnx".to_string())?;
    let rec_path = model_pack::resolve_asset_path(&dir, &manifest, "rec_en_ppocrv4_mobile.onnx")
        .ok_or_else(|| "manifest does not declare rec_en_ppocrv4_mobile.onnx".to_string())?;
    let dict_path =
        model_pack::resolve_asset_path(&dir, &manifest, "en_dict.txt").ok_or_else(|| "manifest does not declare en_dict.txt".to_string())?;

    let det_session = ocr_engine::load_session(&det_path).map_err(|e| format!("{e:?}"))?;
    let rec_session = ocr_engine::load_session(&rec_path).map_err(|e| format!("{e:?}"))?;
    let dict_bytes = std::fs::read(&dict_path).map_err(|e| e.to_string())?;
    let character_table = ocr_engine::load_character_table(&dict_bytes).map_err(|e| format!("{e:?}"))?;

    Ok(OcrRuntime { det_session, rec_session, character_table, manifest_sha256: expected_manifest_sha256.to_string(), manifest })
}

fn region_results_to_json(results: Vec<OcrRegionResult>, line_prefix: &str) -> Vec<serde_json::Value> {
    results
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            let (text, language, confidence) = match r.outcome {
                RecognitionOutcome::Recognized { text, confidence, language } => (text, language, confidence),
                RecognitionOutcome::Unknown { confidence } => (UNKNOWN_TEXT_SENTINEL.to_string(), UNDETERMINED_LANGUAGE.to_string(), confidence),
            };
            serde_json::json!({
                "tokenId": format!("{line_prefix}-{i}"),
                "text": text,
                "boxX": r.source_box.x,
                "boxY": r.source_box.y,
                "boxW": r.source_box.w,
                "boxH": r.source_box.h,
                "lineId": format!("{line_prefix}-{i}"),
                "language": language,
                "confidence": confidence,
                "engineIdentity": OCR_ENGINE_IDENTITY,
            })
        })
        .collect()
}

/// The real OCR dispatch (brief §6, C2-P2 row): reads the full frame
/// named by the request's first bounded path under `session_root`,
/// verifies its digest, verifies/loads the model pack (caching the
/// loaded runtime across requests in this one process, but reverifying
/// from scratch whenever a request names a different manifest digest
/// than what's currently loaded), runs full-frame OCR, and — when
/// `click_crop_box` is present — a second OCR pass scoped to that crop.
/// Every failure mode (missing session root, missing/mismatched frame,
/// invalid/corrupt model pack, image decode failure, inference failure)
/// returns a typed `IpcResult::Err`, never a panic and never a silent
/// empty-tokens success.
fn handle_ocr_request(req: &IpcRequest, session_root: Option<&Path>, runtime_cache: &mut Option<OcrRuntime>) -> IpcResponse {
    let err = |code: &str, message: String| IpcResponse {
        request_id: req.request_id.clone(),
        schema_version: SIDECAR_PROTOCOL_VERSION,
        echoed_input_digests_sha256: req.input_digests_sha256.clone(),
        result: IpcResult::Err { code: code.to_string(), message },
    };

    let Some(session_root) = session_root else {
        return err("NO_SESSION_ROOT", "sidecar was not launched with a session root; cannot resolve bounded paths".to_string());
    };
    let Some(bounded_path) = req.bounded_paths.first() else {
        return err("MISSING_BOUNDED_PATH", "an OCR request requires at least one bounded path naming the frame to read".to_string());
    };

    let frame_path = session_root.join(bounded_path.as_str());
    let frame_bytes = match std::fs::read(&frame_path) {
        Ok(b) => b,
        Err(e) => return err("FRAME_IO", format!("cannot read frame at {frame_path:?}: {e}")),
    };

    if let Some(expected_digest) = req.input_digests_sha256.first() {
        let found = sha256_hex(&frame_bytes);
        if !found.eq_ignore_ascii_case(expected_digest) {
            return err("FRAME_DIGEST_MISMATCH", format!("frame on disk does not match the declared digest (expected {expected_digest}, found {found})"));
        }
    }

    let need_reload = match runtime_cache {
        Some(rt) => rt.manifest_sha256 != req.model_manifest_sha256,
        None => true,
    };
    if need_reload {
        match load_ocr_runtime(&req.model_manifest_sha256) {
            Ok(rt) => *runtime_cache = Some(rt),
            Err(e) => return err("MODEL_PACK_INVALID", e),
        }
    }
    let runtime = runtime_cache.as_mut().expect("just loaded or already present");

    let (frame_w, frame_h, frame_rgb) = match ocr_engine::decode_image_rgb8(&frame_bytes) {
        Ok(v) => v,
        Err(e) => return err("IMAGE_DECODE_FAILED", format!("{e:?}")),
    };

    let full_results = match ocr_engine::run_ocr_on_region(
        &mut runtime.det_session,
        &mut runtime.rec_session,
        &runtime.character_table,
        &frame_rgb,
        frame_w,
        frame_h,
        (0, 0),
    ) {
        Ok(r) => r,
        Err(e) => return err("INFERENCE_FAILED", format!("full-frame OCR failed: {e:?}")),
    };

    let crop_results = match req.click_crop_box {
        None => None,
        Some((cx, cy, cw, ch)) => match ocr_engine::crop_rgb8(&frame_rgb, frame_w, frame_h, cx, cy, cw, ch) {
            None => Some(Vec::new()),
            Some((crop_w, crop_h, crop_rgb)) => match ocr_engine::run_ocr_on_region(
                &mut runtime.det_session,
                &mut runtime.rec_session,
                &runtime.character_table,
                &crop_rgb,
                crop_w,
                crop_h,
                (cx, cy),
            ) {
                Ok(r) => Some(r),
                Err(e) => return err("INFERENCE_FAILED", format!("click-crop OCR failed: {e:?}")),
            },
        },
    };

    let payload = serde_json::json!({
        "tokens": region_results_to_json(full_results, "tok"),
        "cropTokens": crop_results.map(|r| region_results_to_json(r, "crop")),
    });

    IpcResponse {
        request_id: req.request_id.clone(),
        schema_version: SIDECAR_PROTOCOL_VERSION,
        echoed_input_digests_sha256: req.input_digests_sha256.clone(),
        result: IpcResult::Ok { payload },
    }
}

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

/// Dispatches a protocol-valid request to its operation handler.
/// [`SidecarOperation::Ocr`] now runs the real PP-OCR pipeline
/// ([`handle_ocr_request`]) — NER/caption remain the typed
/// `OPERATION_NOT_IMPLEMENTED` stub response until their own separately
/// authorized slices (C2-P4/C2-P5) add a runtime for them. Every branch
/// still echoes the request's own identity fields exactly as every other
/// response must (brief §2.1) — a stub answer is not an excuse to break
/// the echo contract a real caller's [`forge_capture_core::sop_ipc::validate_response`]
/// depends on.
fn handle_request(req: &IpcRequest, session_root: Option<&Path>, ocr_runtime: &mut Option<OcrRuntime>) -> IpcResponse {
    match req.operation {
        SidecarOperation::Ocr => handle_ocr_request(req, session_root, ocr_runtime),
        SidecarOperation::Ner | SidecarOperation::Caption => IpcResponse {
            request_id: req.request_id.clone(),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            echoed_input_digests_sha256: req.input_digests_sha256.clone(),
            result: IpcResult::Err {
                code: "OPERATION_NOT_IMPLEMENTED".to_string(),
                message: format!("{:?} is not implemented in this build — only OCR has a runtime so far", req.operation),
            },
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

    // Set by the client at spawn time (brief §2.1's "bounded paths under
    // the session root" need an absolute root to resolve against; the
    // IPC protocol itself only ever carries the relative half). Absent
    // in every scaffolding-only test that never issues a real OCR
    // request - those are unaffected, since `handle_ocr_request` only
    // reads this when it actually needs to resolve a path.
    let session_root: Option<PathBuf> = std::env::var("FORGE_SIDECAR_SESSION_ROOT").ok().map(PathBuf::from);
    let mut ocr_runtime: Option<OcrRuntime> = None;

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
                Ok(()) => handle_request(&req, session_root.as_deref(), &mut ocr_runtime),
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
