//! FORGE Capture AI sidecar client — brief §2.1 runtime boundary,
//! C2-P2 scaffolding slice.
//!
//! Spawns the real `forge-capture-ai-sidecar` binary, sends one
//! length-prefixed [`IpcRequest`], and waits — bounded by that
//! request's own `timeout_ms` — for a validated, correlated
//! [`IpcResponse`]. A timeout or an explicit cancellation
//! ([`SidecarCancelHandle::cancel`]) kills the child process outright:
//! "Cancellation kills the child and leaves the last durable checkpoint
//! intact" (brief §2.1). This module owns the process boundary and
//! framing only — no OCR/NER/caption dispatch logic lives here, and
//! none is implemented on the sidecar side yet.
//!
//! **C2P2-001/002/003/004 fix round**, in one coherent design:
//!
//! - The child is held in `Arc<Mutex<Child>>`, shared between
//!   [`SidecarSession`] and any [`SidecarCancelHandle`]s cloned from it.
//!   [`SidecarSession::request`] only holds that lock briefly, to take
//!   `stdin`/`stdout` out — it releases the lock *before* blocking on
//!   the actual exchange, so a cancel handle on another thread can
//!   always acquire the lock and kill the child while a request is
//!   in-flight (closes C2P2-002: cancellation no longer needs the same
//!   exclusive borrow a blocking request holds).
//! - The write and the read both happen inside one worker thread, and
//!   the deadline derived from `req.timeout_ms` starts *before* that
//!   thread is spawned, covering both — not just the read (closes
//!   C2P2-001's "timeout is not an end-to-end deadline": a child that
//!   is alive but not reading can no longer block the call past its
//!   stated timeout).
//! - Every non-success outcome — timeout, cancellation, a write/read
//!   error, a malformed response, or a correlation/version validation
//!   failure — funnels through one `retire` path that kills the child
//!   with its *own* bounded cleanup window (closes C2P2-001's unbounded
//!   `kill`/`wait`) and permanently marks the session unusable (closes
//!   C2P2-003: no failure leaves the child alive with the session
//!   looking reusable). The worker thread is joined through its own
//!   bounded wrapper as part of that same retirement rather than left
//!   detached or joined unconditionally (closes C2P2-004).
//!
//! **C2P2-007 fix**: `request()`'s failure paths used to call retirement
//! and discard its result, then unconditionally `.join()` the worker
//! with no bound at all. Both are real bugs on their own: a discarded
//! retirement result let a stale `Timeout`/`Io` error stand in for "the
//! child is confirmed dead" when retirement itself might have failed to
//! confirm that (e.g. the process lock was contended past the bound);
//! and an unconditional join could then hang forever on a worker that
//! might still be genuinely blocked against a still-live child/pipe.
//! `retire_now`/[`SidecarCancelHandle::cancel`] now return their real
//! result, `request()` propagates `RetirementFailed` instead of the
//! original error whenever retirement itself couldn't be confirmed, and
//! the worker is always joined through [`join_worker_bounded`], never
//! a bare `.join()`.
//!
//! **C2P2-005 fix**: a dedicated thread drains the child's stderr
//! continuously from the moment it's spawned, so a filled stderr pipe
//! can never block the child and masquerade as a request timeout.
//!
//! **C2P2-004A fix**: the first version of [`join_worker_bounded`]
//! closed the caller-hang risk but reopened the underlying lifecycle
//! problem a different way — on timeout it spawned a second thread to
//! finish the join and then discarded both handles entirely, an
//! unowned, untracked, permanent leak with no later way to reap them;
//! and on the *success* path for retirement, a worker-join timeout was
//! still silently swallowed, letting the original request error stand
//! in for "cleanup fully confirmed" when it hadn't been. Fixed by
//! polling [`std::thread::JoinHandle::is_finished`] (bounded, no second
//! wrapper thread needed) and, only if the worker genuinely hasn't
//! finished within the bound, retaining it (see the C2P2-004B note just
//! below for where) rather than detaching it —
//! [`SidecarSession::request`] opportunistically reaps any now-finished
//! entries at the start of every call (and [`pending_worker_count`] does
//! the same on demand), so a worker that was merely *slow* to unblock still gets reaped once it
//! actually does, rather than being forgotten the moment the bound
//! elapsed. A worker-join timeout now also surfaces its own
//! [`SidecarClientError::WorkerCleanupFailed`] rather than ever being
//! hidden behind a request error that already returned `Ok`-shaped
//! retirement.
//!
//! **C2P2-004B fix**: C2P2-004A's `pending_workers` lived on
//! `SidecarSession` itself, owned only by that one `Arc`. That looked
//! like a durable reaping owner, but it wasn't one: the ordinary caller
//! pattern after a failed request is to drop the retired session and
//! spawn a new one, and [`std::thread::JoinHandle`]'s own contract is
//! that dropping a handle detaches its thread and permanently removes
//! the ability to join it — so dropping the session dropped its
//! `pending_workers` vector, detached every handle inside it, and threw
//! away the one thing [`Self::pending_worker_count`] needed to ever
//! observe completion again. Fixed by moving ownership out of
//! `SidecarSession` entirely, into [`pending_worker_reaper`] — a
//! process-wide registry that outlives every individual session by
//! construction, so no session's `Drop` can ever discard a handle still
//! inside it. [`pending_worker_count`] is now a free function for the
//! same reason: there is no meaningful "this session's" pending count
//! once ownership is process-wide, only the true count.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use forge_capture_core::sop_ipc::{
    decode_framed, encode_framed, validate_response, FrameDecodeError, IpcRequest, IpcResponse,
};

/// How long [`kill_and_wait_bounded`] (and [`join_worker_bounded`]) wait
/// before giving up and reporting failure instead of hanging
/// indefinitely. Generous for a process that was just sent a kill
/// signal (which should be reaped almost immediately in practice),
/// small enough that a genuinely stuck OS-level wait, or lock
/// contention, cannot silently turn a bounded API into an unbounded one.
const RETIREMENT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug)]
pub enum SidecarClientError {
    Spawn(String),
    Io(String),
    /// `req.timeout_ms` elapsed with no response. The child has already
    /// been killed (bounded) by the time this is returned.
    Timeout,
    /// A prior failure already retired this session — construct a new
    /// [`SidecarSession`] for the next request.
    SessionRetired,
    /// The child could not be confirmed dead within [`RETIREMENT_TIMEOUT`]
    /// after being killed. The session is still marked retired; this
    /// surfaces that cleanup itself did not complete cleanly rather than
    /// silently reporting a different error as if cleanup had succeeded.
    RetirementFailed(String),
    /// The request's write/read worker did not finish within
    /// [`RETIREMENT_TIMEOUT`] after being given the chance to — distinct
    /// from [`Self::RetirementFailed`] (the *process*), this is about
    /// the worker *thread* specifically, surfaced even when process
    /// retirement itself reported success (C2P2-004A).
    WorkerCleanupFailed(String),
    MalformedResponse(String),
    ResponseValidation(String),
}

/// Confirms `child` is dead, with the *entire* operation — acquiring
/// the session's process lock, checking whether it already exited,
/// `kill()`, and `wait()` alike — bounded by [`RETIREMENT_TIMEOUT`]. All
/// of that runs on one spawned thread so this function itself never
/// blocks past that bound: whether the lock is contended, `wait()`
/// itself hangs at the OS level, or anything in between, it all shows
/// up the same way — a timed-out `recv_timeout` here — never an
/// unbounded step the caller has no way to observe (C2P2-007: a prior
/// version checked "already exited?" *outside* this bounded thread,
/// which could itself block unboundedly on a contended lock before ever
/// reaching the parts that were actually bounded).
///
/// **The caller must trust this function's result, not assume success.**
/// [`SidecarSession::request`] and [`SidecarCancelHandle::cancel`] both
/// propagate it rather than discarding it (C2P2-007's other half: a
/// discarded retirement failure let a stale `Timeout`/`Io` error stand
/// in for "the child is confirmed dead" when it might not be).
fn kill_and_wait_bounded(child: &Arc<Mutex<Child>>) -> Result<(), SidecarClientError> {
    let child = Arc::clone(child);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut guard = child.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(guard.try_wait(), Ok(Some(_))) {
            let _ = tx.send(Ok(()));
            return;
        }
        let _ = guard.kill(); // "already exited" is not a failure here
        let result = guard.wait().map(|_| ()).map_err(|e| e.to_string());
        let _ = tx.send(result.map_err(SidecarClientError::RetirementFailed));
    });
    match rx.recv_timeout(RETIREMENT_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err(SidecarClientError::RetirementFailed(
            "retirement (lock acquisition, exit check, kill, or wait) did not complete within the bounded cleanup period".to_string(),
        )),
    }
}

/// Process-wide registry for request workers that couldn't be confirmed
/// finished within [`RETIREMENT_TIMEOUT`] (C2P2-004B). This is
/// deliberately *not* a field on [`SidecarSession`]: a session is
/// routinely dropped right after the failure that leaves a worker
/// pending, and [`std::thread::JoinHandle`]'s own contract says dropping
/// a handle detaches its thread — so any owner that doesn't outlive
/// every session can silently lose the ability to ever observe or join
/// one again. A `static` is the simplest owner that is guaranteed to
/// outlive every session by construction.
///
/// Tests in this module share this registry (there is only one process),
/// so every test that reads [`pending_worker_count`] does so as a
/// *relative* delta against a baseline captured before it runs, never an
/// absolute zero — a different test's own not-yet-reaped entry is not
/// this test's business. This is unaffected by `--test-threads`: even
/// run in parallel, each test's own entries still resolve independently
/// once that test's own child is actually killed.
fn pending_worker_reaper() -> &'static Mutex<Vec<std::thread::JoinHandle<()>>> {
    static REAPER: OnceLock<Mutex<Vec<std::thread::JoinHandle<()>>>> = OnceLock::new();
    REAPER.get_or_init(|| Mutex::new(Vec::new()))
}

/// Polls `worker` (via [`std::thread::JoinHandle::is_finished`], which
/// never blocks) until it finishes or [`RETIREMENT_TIMEOUT`] elapses —
/// bounded without needing a second wrapper thread. On success, joins
/// and reports `Ok` (the join itself is then instant, since the worker
/// has already finished). On timeout, the worker has *not* been shown
/// to be done: rather than detach and forget it (C2P2-004A — a prior
/// version did exactly that, converting a bounded-caller fix into an
/// untracked, unreapable leak), it is pushed onto [`pending_worker_reaper`]
/// so a later opportunistic pass (see [`reap_finished_pending_workers`])
/// can still reap it once it actually finishes, and `WorkerCleanupFailed`
/// is returned so the caller never mistakes a merely-slow worker for a
/// confirmed one.
fn join_worker_bounded(worker: std::thread::JoinHandle<()>) -> Result<(), SidecarClientError> {
    let deadline = Instant::now() + RETIREMENT_TIMEOUT;
    loop {
        if worker.is_finished() {
            let _ = worker.join();
            return Ok(());
        }
        if Instant::now() >= deadline {
            pending_worker_reaper().lock().unwrap_or_else(|e| e.into_inner()).push(worker);
            return Err(SidecarClientError::WorkerCleanupFailed(
                "request worker did not finish within the bounded cleanup period; retained for later reaping".to_string(),
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Removes and joins every entry in [`pending_worker_reaper`] that has
/// since finished, leaving genuinely-still-running ones in place for a
/// future pass. Never blocks on anything that hasn't already finished —
/// `is_finished()` is non-blocking, and joining an already-finished
/// handle returns immediately.
fn reap_finished_pending_workers() {
    let mut pending = pending_worker_reaper().lock().unwrap_or_else(|e| e.into_inner());
    let mut i = 0;
    while i < pending.len() {
        if pending[i].is_finished() {
            let handle = pending.remove(i);
            let _ = handle.join();
        } else {
            i += 1;
        }
    }
}

/// The number of request workers, across every session this process has
/// ever created, that have not yet been confirmed finished (C2P2-004A/B)
/// — reaps any that have since finished before counting, so this
/// reflects only genuinely still-pending ones. A free function, not a
/// method on [`SidecarSession`]: ownership is process-wide (see
/// [`pending_worker_reaper`]), so there is no meaningful "this session's"
/// count, only the true one. Zero in ordinary operation; only ever
/// nonzero after a [`SidecarClientError::WorkerCleanupFailed`], and only
/// until that worker actually finishes.
pub fn pending_worker_count() -> usize {
    reap_finished_pending_workers();
    pending_worker_reaper().lock().unwrap_or_else(|e| e.into_inner()).len()
}

/// Reads and discards from `stderr` until the child exits and closes
/// it. C2P2-005: today's sidecar only emits small diagnostics, so plain
/// discard is sufficient for this scaffolding slice — a later slice
/// that might emit anything sensitive on stderr must revisit this
/// rather than assume discard is still the right policy.
fn drain_stderr(mut stderr: ChildStderr) {
    let mut buf = [0u8; 4096];
    loop {
        match stderr.read(&mut buf) {
            Ok(0) => return,
            Ok(_) => continue,
            Err(_) => return,
        }
    }
}

/// One spawned sidecar process, matching brief §2.1's "one sidecar
/// process handles one session, with one inference request at a time."
/// Call [`SidecarSession::request`] repeatedly for successive requests
/// in that one session — each call either succeeds (the session stays
/// usable) or retires the session permanently (any further call returns
/// [`SidecarClientError::SessionRetired`]).
pub struct SidecarSession {
    child: Arc<Mutex<Child>>,
    retired: Arc<AtomicBool>,
}

/// A cheaply-cloneable handle that can kill a [`SidecarSession`]'s child
/// from any thread, independent of whether a `request()` call is
/// currently blocked holding `&mut SidecarSession` — see this module's
/// doc comment for why that independence is what makes in-flight
/// cancellation possible (C2P2-002).
#[derive(Clone)]
pub struct SidecarCancelHandle {
    child: Arc<Mutex<Child>>,
    retired: Arc<AtomicBool>,
}

impl SidecarCancelHandle {
    /// Kills the child immediately — brief §2.1: "cancellation kills the
    /// child and leaves the last durable checkpoint intact." Safe to
    /// call more than once (each call independently, truthfully
    /// confirms the child's state rather than trusting a flag from an
    /// earlier call that might itself have failed — C2P2-007).
    pub fn cancel(&self) -> Result<(), SidecarClientError> {
        self.retired.store(true, Ordering::SeqCst);
        kill_and_wait_bounded(&self.child)
    }

    /// True if the child has already exited — never blocks.
    pub fn has_exited(&self) -> bool {
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        matches!(guard.try_wait(), Ok(Some(_)))
    }
}

impl SidecarSession {
    /// Spawns the sidecar binary at `exe_path` with no extra environment
    /// variables — the production entry point.
    pub fn spawn(exe_path: &Path) -> Result<Self, SidecarClientError> {
        Self::spawn_with_env(exe_path, &[])
    }

    /// Like [`Self::spawn`], but with additional environment variables
    /// set on the child — used by this module's own tests to drive the
    /// sidecar's test-only hooks; never needed in production.
    pub fn spawn_with_env(exe_path: &Path, extra_env: &[(&str, &str)]) -> Result<Self, SidecarClientError> {
        let mut command = Command::new(exe_path);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (key, value) in extra_env {
            command.env(key, value);
        }
        let mut child = command.spawn().map_err(|e| SidecarClientError::Spawn(e.to_string()))?;

        // C2P2-005: drain stderr continuously from the moment this
        // process exists, so its pipe can never fill and block the
        // child regardless of what the child writes to it or when.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || drain_stderr(stderr));
        }

        Ok(Self { child: Arc::new(Mutex::new(child)), retired: Arc::new(AtomicBool::new(false)) })
    }

    /// A cancel handle for this session, independently killable from
    /// any thread even while [`Self::request`] is blocked elsewhere.
    pub fn cancel_handle(&self) -> SidecarCancelHandle {
        SidecarCancelHandle { child: Arc::clone(&self.child), retired: Arc::clone(&self.retired) }
    }

    /// Convenience wrapper equivalent to `self.cancel_handle().cancel()`.
    pub fn cancel(&self) -> Result<(), SidecarClientError> {
        self.cancel_handle().cancel()
    }

    /// True if the child has already exited — never blocks.
    pub fn has_exited(&self) -> bool {
        self.cancel_handle().has_exited()
    }

    /// Sends `req` and blocks until a validated, correlated response
    /// arrives, `req.timeout_ms` elapses, or the session is cancelled
    /// from another thread — whichever is first. The deadline covers
    /// the entire exchange (write, read, and — on any non-success
    /// outcome — bounded child retirement), not merely the wait for a
    /// response.
    pub fn request(&mut self, req: &IpcRequest) -> Result<IpcResponse, SidecarClientError> {
        // C2P2-004A: opportunistically reap any previously-unconfirmed
        // workers that have since finished, so the process-wide registry
        // (C2P2-004B) doesn't carry a handle forever once it's actually
        // done.
        reap_finished_pending_workers();

        if self.retired.load(Ordering::SeqCst) {
            return Err(SidecarClientError::SessionRetired);
        }

        let deadline = Instant::now() + Duration::from_millis(req.timeout_ms);
        let payload = serde_json::to_vec(req).map_err(|e| SidecarClientError::Io(e.to_string()))?;
        let framed = encode_framed(&payload);

        let (stdin, stdout) = {
            let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            match (guard.stdin.take(), guard.stdout.take()) {
                (Some(i), Some(o)) => (i, o),
                _ => {
                    drop(guard);
                    return match self.retire_now() {
                        Ok(()) => Err(SidecarClientError::Io("session's stdin/stdout already unavailable".to_string())),
                        Err(retirement_err) => Err(retirement_err),
                    };
                }
            }
        };

        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut stdin = stdin;
            let mut stdout = stdout;
            if let Err(e) = stdin.write_all(&framed).and_then(|_| stdin.flush()) {
                let _ = tx.send(Err(e.to_string()));
                return;
            }
            let mut buf = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                match decode_framed(&buf) {
                    Ok((payload, rest)) => {
                        let payload = payload.to_vec();
                        let consumed = buf.len() - rest.len();
                        buf.drain(0..consumed);
                        let _ = tx.send(Ok((payload, stdin, stdout)));
                        return;
                    }
                    Err(FrameDecodeError::FrameTooLarge { .. }) => {
                        let _ = tx.send(Err("sidecar sent an oversized frame".to_string()));
                        return;
                    }
                    Err(FrameDecodeError::NeedMoreHeaderBytes) | Err(FrameDecodeError::NeedMorePayloadBytes { .. }) => {
                        match stdout.read(&mut chunk) {
                            Ok(0) => {
                                let _ = tx.send(Err("sidecar closed stdout".to_string()));
                                return;
                            }
                            Ok(n) => buf.extend_from_slice(&chunk[..n]),
                            Err(e) => {
                                let _ = tx.send(Err(e.to_string()));
                                return;
                            }
                        }
                    }
                }
            }
        });

        let remaining = deadline.saturating_duration_since(Instant::now());
        let outcome = rx.recv_timeout(remaining);

        let (needs_retire, outcome_result): (bool, Result<IpcResponse, SidecarClientError>) = match outcome {
            Ok(Ok((payload, stdin, stdout))) => match self.finish_success(&payload, req, stdin, stdout) {
                Ok(resp) => (false, Ok(resp)),
                Err(e) => (true, Err(e)),
            },
            Ok(Err(reason)) => (true, Err(SidecarClientError::Io(reason))),
            Err(mpsc::RecvTimeoutError::Timeout) => (true, Err(SidecarClientError::Timeout)),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                (true, Err(SidecarClientError::Io("worker thread ended without a result".to_string())))
            }
        };

        if !needs_retire {
            // Success path: the worker already sent its result and is
            // finishing up on its own - an ordinary join is fine here,
            // it should return immediately, and there is nothing to
            // retire.
            let _ = worker.join();
            return outcome_result;
        }

        // C2P2-007: trust retirement's own, real result rather than the
        // original timeout/I/O error - that error does not by itself
        // mean the child is confirmed dead. C2P2-004A: and trust the
        // worker join's own real result too - a worker-join timeout
        // must surface its own error, never hide behind a request
        // error that already returned as if cleanup were fully
        // confirmed. The bounded join itself (never a bare `.join()`)
        // means neither path risks hanging on a worker that might still
        // be blocked against a still-live child/pipe; on timeout the
        // worker is retained in the process-wide registry (C2P2-004B)
        // for later reaping rather than detached and forgotten.
        match self.retire_now() {
            Ok(()) => match join_worker_bounded(worker) {
                Ok(()) => outcome_result,
                Err(worker_err) => Err(worker_err),
            },
            Err(retirement_err) => {
                let _ = join_worker_bounded(worker);
                Err(retirement_err)
            }
        }
    }

    /// Validates the response and, only on full success, restores
    /// `stdin`/`stdout` into the shared child so the session remains
    /// usable for a further request — any validation failure here
    /// still counts as a non-success outcome for the caller (`request`
    /// retires the session on `Err`, same as every other failure path).
    fn finish_success(
        &self,
        payload: &[u8],
        req: &IpcRequest,
        stdin: std::process::ChildStdin,
        stdout: std::process::ChildStdout,
    ) -> Result<IpcResponse, SidecarClientError> {
        let resp: IpcResponse =
            serde_json::from_slice(payload).map_err(|e| SidecarClientError::MalformedResponse(e.to_string()))?;
        validate_response(&resp, req).map_err(|e| SidecarClientError::ResponseValidation(format!("{e:?}")))?;
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        guard.stdin = Some(stdin);
        guard.stdout = Some(stdout);
        Ok(resp)
    }

    /// Centralized retirement (C2P2-003): called from every non-success
    /// path in [`Self::request`] as well as from [`Drop`]. Returns the
    /// real, truthful result (C2P2-007) rather than assuming success —
    /// callers that need to know whether the child is actually
    /// confirmed dead must check it, not infer it from the original
    /// request error.
    fn retire_now(&self) -> Result<(), SidecarClientError> {
        self.retired.store(true, Ordering::SeqCst);
        kill_and_wait_bounded(&self.child)
    }
}

impl Drop for SidecarSession {
    fn drop(&mut self) {
        let _ = self.retire_now();
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
    /// `CARGO_BIN_EXE_forge-capture-ai-sidecar`), so these tests can't
    /// rely on that mechanism. Instead, resolve the *exact* expected
    /// sibling: a test binary lives at `target/<profile>/deps/<name>`,
    /// while a package's own `[[bin]]` lives directly in
    /// `target/<profile>/` — exactly two directories up, never an
    /// open-ended ancestor search (C2P2-006: an unbounded walk could
    /// silently accept an unrelated binary higher in the tree if the
    /// intended sibling were ever missing, producing false-positive
    /// coverage by running the wrong artifact).
    fn sidecar_exe_path() -> std::path::PathBuf {
        let exe = std::env::current_exe().expect("current_exe must resolve for a running test binary");
        let binary_name = if cfg!(windows) { "forge-capture-ai-sidecar.exe" } else { "forge-capture-ai-sidecar" };
        let profile_dir = exe
            .parent()
            .and_then(Path::parent)
            .expect("test binary path must have target/<profile>/deps ancestors");
        let candidate = profile_dir.join(binary_name);
        assert!(
            candidate.is_file(),
            "expected the sidecar binary at the exact profile sibling {candidate:?} - build it first \
             with `cargo build -p forge-capture-ai-sidecar` or `--workspace`, not found via any wider search"
        );
        candidate
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

    /// A request padded with enough bounded paths to exceed any
    /// ordinary OS pipe buffer once serialized - used by the
    /// non-reading-child test (C2P2-001) to force `write_all` itself to
    /// block, not merely the read that follows it.
    fn oversized_request(timeout_ms: u64) -> IpcRequest {
        let mut req = sample_request(timeout_ms);
        req.bounded_paths = (0..64)
            .map(|i| BoundedPath::new(&format!("frames/{}{}.png", "f".repeat(4000), i)).unwrap())
            .collect();
        req
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
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "2000")]).unwrap();
        let req = sample_request(100);
        let result = session.request(&req);
        assert!(matches!(result, Err(SidecarClientError::Timeout)), "{:?}", result);
        assert!(session.has_exited(), "the child process must be killed after a timeout");
    }

    #[test]
    fn a_non_reading_child_times_out_the_write_phase_itself_not_just_the_read() {
        // C2P2-001's exact named gap: the prior design started the
        // timeout clock only after the write had already completed, so
        // a child that never reads at all could block `write_all` past
        // the stated timeout with no bound whatsoever. This child never
        // touches stdin; the request is padded past any ordinary pipe
        // buffer so the write genuinely blocks, not merely "would
        // block in theory."
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_NEVER_READ", "1")]).unwrap();
        let req = oversized_request(500);
        let started = Instant::now();
        let result = session.request(&req);
        let elapsed = started.elapsed();
        assert!(matches!(result, Err(SidecarClientError::Timeout)), "{:?}", result);
        assert!(
            elapsed < Duration::from_secs(5),
            "the write-phase timeout must be bounded by something close to req.timeout_ms, not hang indefinitely (took {elapsed:?})"
        );
        assert!(session.has_exited(), "the child must be killed once the write-phase deadline is reached");
    }

    #[test]
    fn a_retirement_that_cannot_complete_within_the_bound_surfaces_a_distinct_error() {
        // C2P2-001's other named gap: "surface a distinct retirement
        // failure if the child cannot be terminated in a bounded
        // cleanup period." A real OS-level kill/wait can't be made to
        // hang deterministically in a portable test - SIGKILL and
        // TerminateProcess aren't interceptable by the child, and a
        // reaped process's wait() is fast. What *is* under this crate's
        // own control is `kill_and_wait_bounded`'s own deadline, so this
        // simulates "cannot complete within the bound" the same way:
        // hold the session's process lock from another thread for
        // longer than RETIREMENT_TIMEOUT, so retirement's kill()+wait()
        // cannot even start before its own deadline elapses. That proves
        // the function returns `RetirementFailed` within its bound
        // rather than blocking on whatever is holding retirement up -
        // exactly the property the finding named, regardless of whether
        // the holdup is a stuck OS wait() or lock contention.
        let session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "5000")]).unwrap();
        let child = Arc::clone(&session.child);
        let (ready_tx, ready_rx) = mpsc::channel::<()>();
        let blocker = std::thread::spawn(move || {
            let _guard = child.lock().unwrap_or_else(|e| e.into_inner());
            let _ = ready_tx.send(());
            std::thread::sleep(RETIREMENT_TIMEOUT + Duration::from_secs(1));
        });
        ready_rx.recv().expect("blocker must signal once it holds the lock");

        let started = Instant::now();
        let result = session.cancel();
        let elapsed = started.elapsed();

        assert!(matches!(result, Err(SidecarClientError::RetirementFailed(_))), "{:?}", result);
        assert!(
            elapsed < RETIREMENT_TIMEOUT + Duration::from_millis(500),
            "retirement must report failure within its own bound, not block on whatever is holding it up (took {elapsed:?})"
        );

        blocker.join().expect("blocker thread must not panic");
    }

    #[test]
    fn retirement_lock_contention_during_a_blocked_request_surfaces_a_bounded_retirement_failed() {
        // C2P2-007's exact required test: force retirement itself to
        // fail to confirm the child dead (lock contention) while the
        // worker thread is genuinely blocked (the child never reads,
        // so the worker sits in its read loop forever), through the
        // real `request()` path - not the lower-level primitive
        // directly. Must prove two things: `request()` returns
        // `RetirementFailed` (not a stale `Timeout` masking a cleanup
        // that never actually happened), and it does so within a
        // bounded time despite the worker potentially still being
        // blocked against a live child.
        //
        // Timing matters here: the lock must become contended *after*
        // request() has already taken stdin/stdout for its own worker
        // (an early, uncontended step) but *before* retirement is
        // attempted once the 300ms deadline fires - contention at the
        // wrong moment proves nothing about retirement specifically.
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_NEVER_READ", "1")]).unwrap();
        let child = Arc::clone(&session.child);

        let started = Instant::now();
        let request_thread = std::thread::spawn(move || {
            // Small request: write_all succeeds immediately (fits any
            // ordinary pipe buffer even with nobody reading), so the
            // worker ends up genuinely blocked in the *read* loop,
            // waiting for a response the child (which never reads at
            // all) can never send.
            let result = session.request(&sample_request(300));
            (result, started.elapsed())
        });

        // Let request() get well past its own initial, uncontended
        // lock use before we take it away from under it.
        std::thread::sleep(Duration::from_millis(100));
        let blocker = std::thread::spawn(move || {
            let _guard = child.lock().unwrap_or_else(|e| e.into_inner());
            std::thread::sleep(RETIREMENT_TIMEOUT + Duration::from_secs(2));
        });

        let (result, elapsed) = request_thread.join().unwrap();
        assert!(matches!(result, Err(SidecarClientError::RetirementFailed(_))), "{:?}", result);
        assert!(
            elapsed < Duration::from_millis(300) + RETIREMENT_TIMEOUT + Duration::from_secs(2),
            "request() must return a bounded RetirementFailed, not hang on the contended lock or an \
             unbounded join of the still-blocked worker (took {elapsed:?})"
        );

        blocker.join().expect("blocker thread must not panic");
    }

    #[test]
    fn repeated_retirement_failures_eventually_reap_their_pending_workers_without_accumulating() {
        // C2P2-004A's exact required test: "a repeated retirement-failure
        // resource test that proves thread/handle counts do not
        // accumulate after cleanup eventually becomes possible." This
        // one specifically keeps each session alive past the failure
        // (returns it from the worker thread) - the companion test
        // `dropping_a_session_with_a_pending_worker_does_not_lose_the_reaping_owner`
        // covers the lifecycle gap C2P2-004B found (the session dropped
        // *before* its pending worker could be confirmed), which this
        // one does not exercise.
        //
        // Reuses the lock-contention timing from
        // `retirement_lock_contention_during_a_blocked_request_surfaces_a_bounded_retirement_failed`,
        // but holds the lock for three full `RETIREMENT_TIMEOUT`s - long
        // enough that *both* `retire_now`'s own bound and the subsequent
        // `join_worker_bounded`'s own bound each expire before the lock
        // is released, so the worker is genuinely retained in the
        // process-wide registry rather than confirmed finished by
        // coincidental timing. Once the blocker releases, the long-stuck
        // retirement thread (still blocked on the same lock, inside
        // `retire_now`) finally runs its real `kill()`/`wait()`, the
        // child actually dies, the worker's blocked read unblocks, and
        // the retained worker must then be reaped rather than
        // accumulate forever. Run across two independent sessions to
        // show the property holds more than once, not as a one-off.
        //
        // `pending_worker_count()` is process-wide (C2P2-004B), shared
        // with every other test in this file, so every check here is a
        // *relative* delta against a baseline captured just before this
        // iteration's own failure - never an absolute zero.
        for iteration in 0..2 {
            let baseline = pending_worker_count();
            let mut session =
                SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_NEVER_READ", "1")]).unwrap();
            let child = Arc::clone(&session.child);

            let request_thread = std::thread::spawn(move || {
                let result = session.request(&sample_request(300));
                (session, result)
            });

            std::thread::sleep(Duration::from_millis(100));
            let hold_for = RETIREMENT_TIMEOUT * 3;
            let blocker = std::thread::spawn(move || {
                let _guard = child.lock().unwrap_or_else(|e| e.into_inner());
                std::thread::sleep(hold_for);
            });

            let (session, result) = request_thread.join().unwrap();
            assert!(
                matches!(result, Err(SidecarClientError::RetirementFailed(_))),
                "iteration {iteration}: {:?}",
                result
            );

            // Neither retirement nor the worker join could be confirmed
            // within their own bounds while the lock is still held - the
            // worker must be retained for later reaping, not silently
            // detached and forgotten.
            assert!(
                pending_worker_count() > baseline,
                "iteration {iteration}: an unconfirmed worker must be retained for later reaping"
            );

            blocker.join().expect("blocker thread must not panic");

            // The lock is free now, so the stuck retirement thread can
            // finally kill the child, which unblocks the worker's read.
            // Poll briefly for that to actually happen, then require the
            // pending count to drain back to this iteration's own
            // baseline rather than stay stuck above it.
            let reap_deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if pending_worker_count() <= baseline {
                    break;
                }
                assert!(
                    Instant::now() < reap_deadline,
                    "iteration {iteration}: a retained worker must eventually be reaped once it \
                     actually finishes, not accumulate permanently"
                );
                std::thread::sleep(Duration::from_millis(50));
            }
            drop(session);
        }
    }

    #[test]
    fn dropping_a_session_with_a_pending_worker_does_not_lose_the_reaping_owner() {
        // C2P2-004B's exact required test: force genuine pending cleanup,
        // drop the session *before* releasing the blocker, then release
        // it and prove a surviving owner - never the destroyed session -
        // still joins/drains the worker. `session` is moved into and
        // used by the spawned thread, then dropped on a *further*
        // throwaway thread (see the comment at that `drop` call for why
        // it can't just be dropped inline) - so by the time this test
        // observes anything, the session that owned the original
        // (pre-fix) `pending_workers` field no longer exists at all -
        // exactly the "ordinary caller path of dropping/replacing that
        // retired session" the finding named.
        let baseline = pending_worker_count();
        let hold_for = RETIREMENT_TIMEOUT * 3;

        let session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_NEVER_READ", "1")]).unwrap();
        let child = Arc::clone(&session.child);

        let request_thread = std::thread::spawn(move || {
            let mut session = session;
            let result = session.request(&sample_request(300));
            // Drop the session on its own throwaway thread rather than
            // inline here: `SidecarSession::drop` itself calls the
            // bounded (but still synchronous, still contended-on-this-
            // same-lock) `retire_now`, so dropping inline would block
            // *this* thread - and therefore `request_thread.join()`
            // below - until that second retirement attempt resolves,
            // which (once the blocker eventually releases) quietly
            // kills the child and reaps the worker all on its own,
            // defeating the point of this test: observing the worker
            // still pending *before* anything resolves, with the
            // session already gone.
            std::thread::spawn(move || drop(session));
            result
        });

        std::thread::sleep(Duration::from_millis(100));
        let blocker = std::thread::spawn(move || {
            let _guard = child.lock().unwrap_or_else(|e| e.into_inner());
            std::thread::sleep(hold_for);
        });

        let result = request_thread.join().unwrap();
        assert!(matches!(result, Err(SidecarClientError::RetirementFailed(_))), "{:?}", result);

        // The session is already dropped (inside the thread above) at
        // this point, yet the worker it spawned must still be tracked by
        // a surviving owner.
        assert!(pending_worker_count() > baseline, "the pending worker must survive its owning session's drop");

        blocker.join().expect("blocker thread must not panic");

        // Only once the blocker releases can the real kill/wait finally
        // happen and the worker's blocked read unblock. Nothing in this
        // test calls anything on the dropped session - the drain must
        // come from the process-wide registry alone.
        let reap_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if pending_worker_count() <= baseline {
                break;
            }
            assert!(
                Instant::now() < reap_deadline,
                "a worker orphaned by its owning session's drop must still eventually be reaped"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn explicit_cancel_kills_a_still_running_child() {
        let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "5000")]).unwrap();
        assert!(!session.has_exited(), "the freshly spawned sidecar must still be running");
        session.cancel().unwrap();
        assert!(session.has_exited(), "cancel() must kill the child process");
    }

    #[test]
    fn cancel_from_another_thread_interrupts_a_genuinely_in_flight_request() {
        // C2P2-002's exact named gap: `cancel` used to require the same
        // `&mut self` a blocking `request()` call holds, so nothing
        // could cancel a request that was actually in flight — only an
        // idle session. This proves the real thing: a request blocked
        // waiting for a slow response is interrupted by a cancel call
        // issued from a *different* thread while it's still blocked,
        // and completes promptly rather than waiting out its full
        // (much longer) timeout.
        let session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "10000")]).unwrap();
        let cancel_handle = session.cancel_handle();
        let mut session = session;

        let request_thread = std::thread::spawn(move || {
            let req = sample_request(30_000);
            let started = Instant::now();
            let result = session.request(&req);
            (result, started.elapsed())
        });

        std::thread::sleep(Duration::from_millis(200));
        cancel_handle.cancel().unwrap();

        let (result, elapsed) = request_thread.join().unwrap();
        assert!(result.is_err(), "a cancelled in-flight request must not report success");
        assert!(
            elapsed < Duration::from_secs(5),
            "cancellation must interrupt the in-flight request promptly, not wait out its full 30s timeout (took {elapsed:?})"
        );
        assert!(cancel_handle.has_exited(), "the child must actually be dead after cancellation");
    }

    #[test]
    fn a_malformed_response_retires_the_session_and_refuses_further_requests() {
        // C2P2-003: a sidecar that sends back bytes that don't even
        // deserialize as an IpcResponse must not leave the session
        // looking reusable - the first request fails, the child is
        // retired, and a second request on the *same* session is
        // refused outright rather than attempting more I/O against a
        // session whose protocol state is no longer trustworthy.
        let mut session =
            SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_RAW_RESPONSE_OVERRIDE", "not valid json")]).unwrap();
        let first = session.request(&sample_request(5_000));
        assert!(matches!(first, Err(SidecarClientError::MalformedResponse(_))), "{:?}", first);
        assert!(session.has_exited(), "a malformed response must retire (kill) the child");

        let second = session.request(&sample_request(5_000));
        assert!(matches!(second, Err(SidecarClientError::SessionRetired)), "{:?}", second);
    }

    #[test]
    fn a_response_with_the_wrong_request_id_is_rejected_and_retires_the_session() {
        let override_json = serde_json::json!({
            "requestId": "some-other-request-entirely",
            "schemaVersion": SIDECAR_PROTOCOL_VERSION,
            "echoedInputDigestsSha256": ["a".repeat(64)],
            "result": {"status": "err", "code": "X", "message": "x"}
        })
        .to_string();
        let mut session =
            SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_RAW_RESPONSE_OVERRIDE", override_json.as_str())]).unwrap();
        let result = session.request(&sample_request(5_000));
        assert!(matches!(result, Err(SidecarClientError::ResponseValidation(_))), "{:?}", result);
        assert!(session.has_exited(), "a response correlation failure must retire the child");
    }

    #[test]
    fn a_response_with_an_unsupported_schema_version_is_rejected_and_retires_the_session() {
        let req = sample_request(5_000);
        let override_json = serde_json::json!({
            "requestId": req.request_id,
            "schemaVersion": SIDECAR_PROTOCOL_VERSION + 1,
            "echoedInputDigestsSha256": req.input_digests_sha256,
            "result": {"status": "err", "code": "X", "message": "x"}
        })
        .to_string();
        let mut session =
            SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_RAW_RESPONSE_OVERRIDE", override_json.as_str())]).unwrap();
        let result = session.request(&req);
        assert!(matches!(result, Err(SidecarClientError::ResponseValidation(_))), "{:?}", result);
        assert!(session.has_exited());
    }

    #[test]
    fn repeated_timeouts_across_several_sessions_do_not_accumulate_delay() {
        // C2P2-004: if a prior round's detached, unjoined reader thread
        // ever leaked or accumulated, repeated timeout/retire cycles
        // would tend to get *slower*, not just be uniformly slow.
        // Measured per-iteration rather than against an absolute wall-
        // clock ceiling: on this machine, spawning this freshly-built
        // binary costs ~26s *every* time regardless of this code
        // (confirmed independently with a bare spawn+kill microbenchmark
        // with no IPC/threading at all - kill+wait itself took ~1.5ms),
        // almost certainly antivirus/Defender real-time scanning of an
        // unsigned binary - an absolute-seconds assertion would be
        // measuring that environmental cost, not this design. What
        // matters here is that the request/retire logic itself adds no
        // growing overhead on top of that fixed cost.
        let mut durations = Vec::new();
        for _ in 0..3 {
            let started = Instant::now();
            let mut session = SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_DELAY_MS", "2000")]).unwrap();
            let result = session.request(&sample_request(100));
            assert!(matches!(result, Err(SidecarClientError::Timeout)));
            durations.push(started.elapsed());
        }
        let first = durations[0];
        let last = *durations.last().unwrap();
        assert!(
            last < first * 2 + Duration::from_secs(1),
            "later cycles must not be meaningfully slower than the first - a growing trend would indicate \
             accumulating leaked threads/handles, not just fixed per-spawn cost (durations: {durations:?})"
        );
    }

    #[test]
    fn stderr_saturation_does_not_block_a_normal_response() {
        // C2P2-005: without draining, filling the stderr pipe can block
        // the child's own writes/scheduling, which looks indistinguishable
        // from a hung inference call. With draining, a child that floods
        // stderr at startup still answers a normal request promptly.
        let mut session =
            SidecarSession::spawn_with_env(&sidecar_exe_path(), &[("FORGE_SIDECAR_TEST_STDERR_FLOOD_BYTES", "2000000")]).unwrap();
        let started = Instant::now();
        let result = session.request(&sample_request(5_000));
        assert!(result.is_ok(), "{:?}", result);
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "a drained stderr must not delay an otherwise-instant stub response (took {:?})",
            started.elapsed()
        );
        session.cancel().unwrap();
    }

    #[test]
    fn dropping_the_session_kills_a_still_running_child() {
        let exe = sidecar_exe_path();
        {
            let _session = SidecarSession::spawn_with_env(&exe, &[("FORGE_SIDECAR_TEST_DELAY_MS", "5000")]).unwrap();
        }
        // If Drop's retirement ever hung, this test itself would hang -
        // reaching this line is the proof.
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
