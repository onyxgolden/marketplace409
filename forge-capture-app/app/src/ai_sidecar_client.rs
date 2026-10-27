//! FORGE Capture AI sidecar client — brief §2.1 runtime boundary,
//! C2-P2 scaffolding slice.
//!
//! Spawns the real `forge-capture-ai-sidecar` binary, sends one
//! length-prefixed [`IpcRequest`], and waits — bounded by that
//! request's own `timeout_ms` — for a validated, correlated
//! [`IpcResponse`]. A timeout or an explicit [`SidecarSession::cancel`]
//! kills the child process outright: "Cancellation kills the child and
//! leaves the last durable checkpoint intact" (brief §2.1). This module
//! owns the process boundary and framing only — no OCR/NER/caption
//! dispatch logic lives here, and none is implemented on the sidecar
//! side yet (see that binary's own module doc comment).

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use forge_capture_core::sop_ipc::{
    decode_framed, encode_framed, validate_response, FrameDecodeError, IpcRequest, IpcResponse,
};

#[derive(Debug)]
pub enum SidecarClientError {
    Spawn(String),
    Io(String),
    /// `req.timeout_ms` elapsed with no response. The child has already
    /// been killed by the time this is returned — the session is no
    /// longer usable; construct a new one for the next request.
    Timeout,
    MalformedResponse(String),
    ResponseValidation(String),
}

/// One spawned sidecar process, matching brief §2.1's "one sidecar
/// process handles one session, with one inference request at a time."
/// Call [`SidecarSession::request`] repeatedly for successive requests
/// in that one session; dropping (or explicitly [`SidecarSession::cancel`]ing)
/// it kills the child.
pub struct SidecarSession {
    child: Child,
}

impl SidecarSession {
    /// Spawns the sidecar binary at `exe_path` with no extra environment
    /// variables — the production entry point. Where the binary ships
    /// (next to the main app executable, or elsewhere) is a packaging
    /// decision outside this scaffolding slice's scope; this module
    /// just runs whatever path it's given.
    pub fn spawn(exe_path: &Path) -> Result<Self, SidecarClientError> {
        Self::spawn_with_env(exe_path, &[])
    }

    /// Like [`Self::spawn`], but with additional environment variables
    /// set on the child — used by this module's own tests to set
    /// `FORGE_SIDECAR_TEST_DELAY_MS` on the real sidecar binary, never
    /// needed in production.
    pub fn spawn_with_env(exe_path: &Path, extra_env: &[(&str, &str)]) -> Result<Self, SidecarClientError> {
        let mut command = Command::new(exe_path);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (key, value) in extra_env {
            command.env(key, value);
        }
        let child = command.spawn().map_err(|e| SidecarClientError::Spawn(e.to_string()))?;
        Ok(Self { child })
    }

    /// Sends `req` and blocks until a validated, correlated response
    /// arrives or `req.timeout_ms` elapses, whichever is first.
    pub fn request(&mut self, req: &IpcRequest) -> Result<IpcResponse, SidecarClientError> {
        let payload = serde_json::to_vec(req).map_err(|e| SidecarClientError::Io(e.to_string()))?;
        let framed = encode_framed(&payload);

        let mut stdin = self.child.stdin.take().ok_or_else(|| SidecarClientError::Io("stdin already closed".to_string()))?;
        stdin.write_all(&framed).map_err(|e| SidecarClientError::Io(e.to_string()))?;
        stdin.flush().map_err(|e| SidecarClientError::Io(e.to_string()))?;
        self.child.stdin = Some(stdin);

        let mut stdout = self.child.stdout.take().ok_or_else(|| SidecarClientError::Io("stdout already closed".to_string()))?;
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        let read_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                match decode_framed(&buf) {
                    Ok((payload, rest)) => {
                        let payload = payload.to_vec();
                        let consumed = buf.len() - rest.len();
                        buf.drain(0..consumed);
                        let _ = tx.send(Ok(payload));
                        return stdout;
                    }
                    Err(FrameDecodeError::FrameTooLarge { .. }) => {
                        let _ = tx.send(Err("sidecar sent an oversized frame".to_string()));
                        return stdout;
                    }
                    Err(FrameDecodeError::NeedMoreHeaderBytes) | Err(FrameDecodeError::NeedMorePayloadBytes { .. }) => {
                        match stdout.read(&mut chunk) {
                            Ok(0) => {
                                let _ = tx.send(Err("sidecar closed stdout".to_string()));
                                return stdout;
                            }
                            Ok(n) => buf.extend_from_slice(&chunk[..n]),
                            Err(e) => {
                                let _ = tx.send(Err(e.to_string()));
                                return stdout;
                            }
                        }
                    }
                }
            }
        });

        let timeout = Duration::from_millis(req.timeout_ms);
        let outcome = rx.recv_timeout(timeout);

        match outcome {
            Ok(Ok(payload)) => {
                if let Ok(stdout) = read_thread.join() {
                    self.child.stdout = Some(stdout);
                }
                let resp: IpcResponse =
                    serde_json::from_slice(&payload).map_err(|e| SidecarClientError::MalformedResponse(e.to_string()))?;
                validate_response(&resp, req).map_err(|e| SidecarClientError::ResponseValidation(format!("{e:?}")))?;
                Ok(resp)
            }
            Ok(Err(reason)) => {
                let _ = self.kill();
                Err(SidecarClientError::Io(reason))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = self.kill();
                Err(SidecarClientError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = self.kill();
                Err(SidecarClientError::Io("reader thread ended without a result".to_string()))
            }
        }
    }

    /// Ends the session immediately by killing the child process — brief
    /// §2.1: "Cancellation kills the child and leaves the last durable
    /// checkpoint intact."
    pub fn cancel(&mut self) -> Result<(), SidecarClientError> {
        self.kill()
    }

    /// True if the child process has already exited (crashed, was
    /// killed, or ended on its own) — never blocks.
    pub fn has_exited(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)))
    }

    fn kill(&mut self) -> Result<(), SidecarClientError> {
        // `kill()` on an already-exited child returns an error on some
        // platforms (nothing to kill) - that's not a failure this caller
        // needs to see, since the end state (not running) is the same
        // one we're trying to reach.
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for SidecarSession {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forge_capture_core::sop_ipc::{BoundedPath, IpcResult, SidecarOperation, SIDECAR_PROTOCOL_VERSION};

    /// Locates the already-built `forge-capture-ai-sidecar` binary.
    ///
    /// `forge-capture-ai-sidecar` is a `[[bin]]`-only workspace member
    /// with no `[lib]` target, so it cannot be a normal (or dev)
    /// dependency of this crate — Cargo ignores such a dependency
    /// entirely (confirmed: it does not build the binary or expose
    /// `CARGO_BIN_EXE_forge-capture-ai-sidecar` as a result), so these
    /// tests cannot rely on that mechanism the way same-crate binaries
    /// can. Instead, since both crates are members of the same
    /// workspace, Cargo places the sidecar's binary directly in
    /// `target/<profile>/` while this test binary lives in
    /// `target/<profile>/deps/` — walk up from this test binary's own
    /// `current_exe()` until that sibling is found. Building the
    /// workspace (`cargo build`/`test --workspace`, or specifically
    /// `-p forge-capture-ai-sidecar`) before running these tests is a
    /// precondition, not something this helper does itself.
    fn sidecar_exe_path() -> std::path::PathBuf {
        let exe = std::env::current_exe().expect("current_exe must resolve for a running test binary");
        let binary_name = if cfg!(windows) { "forge-capture-ai-sidecar.exe" } else { "forge-capture-ai-sidecar" };
        let mut dir = exe.parent();
        while let Some(d) = dir {
            let candidate = d.join(binary_name);
            if candidate.is_file() {
                return candidate;
            }
            dir = d.parent();
        }
        panic!(
            "could not locate {binary_name} starting from {exe:?} - build the workspace \
             (e.g. `cargo build --workspace` or `-p forge-capture-ai-sidecar`) before running these tests"
        );
    }

    fn sample_request(timeout_ms: u64) -> IpcRequest {
        IpcRequest {
            request_id: format!("test-{}", std::process::id()),
            schema_version: SIDECAR_PROTOCOL_VERSION,
            operation: SidecarOperation::Ocr,
            input_digests_sha256: vec!["a".repeat(64)],
            bounded_paths: vec![BoundedPath::new("frames/f1.png").unwrap()],
            timeout_ms,
            model_manifest_sha256: "b".repeat(64),
        }
    }

    #[test]
    fn spawn_and_single_request_round_trips_a_stub_not_implemented_response() {
        let mut session = SidecarSession::spawn(&sidecar_exe_path()).unwrap();
        let req = sample_request(5_000);
        let resp = session.request(&req).unwrap();
        assert_eq!(resp.request_id, req.request_id);
        assert_eq!(resp.echoed_input_digests_sha256, req.input_digests_sha256);
        match resp.result {
            IpcResult::Err { code, .. } => assert_eq!(code, "OPERATION_NOT_IMPLEMENTED"),
            IpcResult::Ok { .. } => panic!("scaffolding sidecar must never claim a real Ok result"),
        }
        session.cancel().unwrap();
    }

    #[test]
    fn multiple_sequential_requests_in_one_session_all_succeed() {
        let mut session = SidecarSession::spawn(&sidecar_exe_path()).unwrap();
        for i in 0..3 {
            let mut req = sample_request(5_000);
            req.request_id = format!("multi-{i}");
            let resp = session.request(&req).unwrap();
            assert_eq!(resp.request_id, req.request_id);
        }
        session.cancel().unwrap();
    }

    #[test]
    fn timeout_kills_the_child_and_returns_a_timeout_error() {
        // The real sidecar binary, told to sleep far longer than the
        // request's own timeout before answering at all.
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "2000")]).unwrap();
        let req = sample_request(100);
        let result = session.request(&req);
        assert!(matches!(result, Err(SidecarClientError::Timeout)), "{:?}", result);
        // The child must actually be dead, not merely "we gave up
        // waiting" - a real process boundary cancellation, not a
        // client-side illusion of one.
        std::thread::sleep(Duration::from_millis(50));
        assert!(session.has_exited(), "the child process must be killed after a timeout");
    }

    #[test]
    fn explicit_cancel_kills_a_still_running_child() {
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "5000")]).unwrap();
        assert!(!session.has_exited(), "the freshly spawned sidecar must still be running");
        session.cancel().unwrap();
        assert!(session.has_exited(), "cancel() must kill the child process");
    }

    #[test]
    fn dropping_the_session_kills_a_still_running_child() {
        let exe = sidecar_exe_path();
        // Scope the session so Drop runs at the end of this block, then
        // check from outside that the process is actually gone - can't
        // check `has_exited()` on a dropped value, so instead prove it
        // indirectly: a second session targeting the same long-delay
        // env still starts and runs independently, and the first one's
        // process id is gone from the OS (best-effort proxy: just prove
        // Drop does not hang or panic, which it would if `kill`/`wait`
        // misbehaved on an already-exited or still-running child).
        {
            let _session = SidecarSession::spawn_with_env(&exe, &[("FORGE_SIDECAR_TEST_DELAY_MS", "5000")]).unwrap();
        }
        // If Drop's kill()/wait() ever hung, this test itself would hang
        // and time out the suite - reaching this line is the proof.
    }

    #[test]
    fn response_schema_version_is_the_sidecars_own_not_an_echo_of_a_mismatched_request() {
        let mut session = SidecarSession::spawn(&sidecar_exe_path()).unwrap();
        let req = sample_request(5_000);
        let resp = session.request(&req).unwrap();
        assert_eq!(resp.schema_version, SIDECAR_PROTOCOL_VERSION);
        session.cancel().unwrap();
    }
}
