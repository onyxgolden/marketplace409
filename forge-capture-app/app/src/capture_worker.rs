//! Bounded capture worker — parent-side supervisor, wire protocol, ring log.
//!
//! Implements the ChatGPT design verdict of 2026-10-23 (Capture #639,
//! Option C): potentially blocking native acquisition runs in a child
//! *process* — the installed EXE re-entered with `--capture-worker` before
//! any Tauri/window initialization — never on the UI thread, never as a
//! bare in-process thread, and never behind a mere async timeout (a
//! non-yielding native call ignores those).
//!
//! Contract enforced here:
//! - One capture worker maximum, zero queued jobs. A second admission while
//!   a worker is live returns `CAPTURE_BUSY` immediately.
//! - 3,000 ms total deadline per request, measured from parent admission
//!   (worker start + enumeration/acquisition + encoding + bounded transfer;
//!   no per-stage reset), on a monotonic clock.
//! - Worker termination confirmation gets at most 500 ms *additional*, off
//!   the UI thread. The request is already terminal at timeout.
//! - Generation fencing: the parent owns one terminal transition per
//!   admission. Timeout (or any terminal outcome) fences the generation
//!   *before* the worker is asked to terminate, so a late reply can never
//!   update a session, show a window, persist a capture, overwrite an error,
//!   or resurrect a cancelled picker.
//! - If termination cannot be confirmed promptly, the slot stays occupied
//!   and further captures are refused (`WORKER_UNAVAILABLE`); a single
//!   reaper thread frees the slot when the zombie finally exits. No
//!   thread-per-retry growth: at most one zombie (and one reaper) exists.
//! - No `TerminateThread`, no synchronous joins on the hung worker, no
//!   fallback thread calling back into UI while its caller waits, no
//!   termination by a reused PID alone (the owned `Child` handle is used).
//! - Private IPC only: length-prefixed fixed-binary frames over the
//!   child's stdin/stdout. No caller-supplied paths, no shell, no network.
//!   The parent validates identity, dimensions, lengths and success before
//!   anything is published.
//!
//! This module is std-only (no tokio, no serde) so the protocol, framing,
//! deadline math, generation fencing and ring log are unit-testable with a
//! bare `rustc --test`. The Windows-only kill-on-parent-exit job
//! containment is `#[cfg(windows)]` and verified against the vendored
//! `windows` 0.62 sources; it is best-effort (a failure only logs).

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------------------
// Policy constants (design verdict §3 — initial UX policy, not measured
// hardware claims)
// ---------------------------------------------------------------------------

/// Total budget per native capture request, from parent admission.
pub const CAPTURE_DEADLINE_MS: u64 = 3000;
/// Extra bound for confirming worker termination, off the UI thread.
pub const TERMINATION_CONFIRM_MS: u64 = 500;
/// Poll granularity while confirming termination.
const TERMINATION_POLL_MS: u64 = 10;
/// Worker requests are small descriptors; anything larger is malformed.
pub const MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Error text (stage + message) is bounded; success payloads are bounded
/// by the artifact raster limit supplied at construction.
pub const MAX_ERROR_TEXT_BYTES: usize = 64 * 1024;
/// Monitor ids are short opaque strings.
pub const MAX_MONITOR_ID_BYTES: usize = 512;
/// Reply headers are fixed-size; error metadata is bounded.
pub const MAX_META_BYTES: usize = 128 * 1024;
/// Ring-log capacity (drop-oldest).
pub const RING_CAP: usize = 512;
/// Sanity bounds for returned raster dimensions.
pub const MAX_DIMENSION: u32 = 16384;

// Wire opcodes.
pub const OP_BACKDROP: u8 = 1;
pub const OP_REGION: u8 = 2;

// Wire status codes.
pub const STATUS_OK: u8 = 0;
pub const STATUS_NATIVE_ERROR: u8 = 1;
pub const STATUS_WORKER_ERROR: u8 = 2;

// Fixed reply header: u64 session + u64 generation + u8 status
// + u32 width + u32 height + u32 payload_len = 29 bytes.
const REPLY_HEADER_LEN: usize = 8 + 8 + 1 + 4 + 4 + 4;

// ---------------------------------------------------------------------------
// Ring log
// ---------------------------------------------------------------------------

/// Small bounded local ring log (drop-oldest). Entries carry a monotonic
/// millisecond offset plus a wall-clock second for correlation. Shared
/// across threads via `Arc`; never logs pixels, titles, or credentials —
/// callers only pass stage names and scalar metadata.
#[derive(Clone)]
pub struct RingLog {
    inner: Arc<Mutex<VecDeque<String>>>,
    cap: usize,
    boot: Instant,
}

impl RingLog {
    pub fn new(cap: usize) -> Self {
        RingLog {
            inner: Arc::new(Mutex::new(VecDeque::new())),
            cap,
            boot: Instant::now(),
        }
    }

    pub fn log(&self, stage: &str, detail: impl AsRef<str>) {
        let elapsed_ms = self.boot.elapsed().as_millis();
        let wall_s = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut q = self.inner.lock().unwrap();
        while q.len() >= self.cap {
            q.pop_front();
        }
        q.push_back(format!(
            "[+{elapsed_ms}ms|{wall_s}] {stage}: {}",
            detail.as_ref()
        ));
    }

    /// Newest-first tail, at most `n` entries.
    pub fn tail(&self, n: usize) -> Vec<String> {
        let q = self.inner.lock().unwrap();
        q.iter().rev().take(n).cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ---------------------------------------------------------------------------
// Wire protocol — fixed binary frames, length-prefixed, strictly validated
// ---------------------------------------------------------------------------
//
// REQUEST  (parent -> worker stdin):
//   u32 BE total_len                    (of everything after this field; <= MAX_REQUEST_BYTES)
//   u8     op                            (1 = backdrop, 2 = region)
//   u64 BE session_id
//   u64 BE generation
//   u8     include_cursor                (0/1)
//   u64 BE delay_ms
//   backdrop: u16 BE id_len (1..=MAX_MONITOR_ID_BYTES) | id bytes (UTF-8)
//   region:   i64 BE x | i64 BE y | u64 BE w | u64 BE h
//             (physical px, virtual-desktop coords; x/y may be negative;
//              w/h must be 1..=MAX_DIMENSION)
//
// REPLY (worker -> parent stdout):
//   u32 BE total_len                    (29 + payload_len + meta_len, bounded)
//   u64 BE session_id | u64 BE generation | u8 status
//   u32 BE width | u32 BE height         (ok: 1..=MAX_DIMENSION; error: 0)
//   u32 BE payload_len | payload bytes   (ok: PNG bytes, 1..=max_png; error: 0)
//   META, status == ok:
//     u8 cursor_captured | i64 cursor_x | i64 cursor_y
//     u64 BE scale_bits | u16 BE ts_len | captured_at bytes (<=64, UTF-8)
//     u16 BE nwarn (<=16) | per warning: u16 BE len (<=4096) | bytes (UTF-8)
//   META, status != ok:
//     u16 BE stage_len (<=4096) | stage bytes (UTF-8)
//     u16 BE msg_len (<=MAX_ERROR_TEXT_BYTES) | message bytes (UTF-8)
//
// The worker echoes session_id/generation; the parent rejects any reply
// whose identity does not match the admitted request.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerOp {
    Backdrop,
    Region,
}

impl WorkerOp {
    fn opcode(self) -> u8 {
        match self {
            WorkerOp::Backdrop => OP_BACKDROP,
            WorkerOp::Region => OP_REGION,
        }
    }

    fn from_opcode(b: u8) -> Option<WorkerOp> {
        match b {
            OP_BACKDROP => Some(WorkerOp::Backdrop),
            OP_REGION => Some(WorkerOp::Region),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum RequestTarget {
    Backdrop { monitor_id: String },
    Region { x: i64, y: i64, w: u64, h: u64 },
}

#[derive(Debug, Clone)]
pub struct WorkerRequest {
    pub op: WorkerOp,
    pub session_id: u64,
    pub generation: u64,
    pub include_cursor: bool,
    pub delay_ms: u64,
    pub target: RequestTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyStatus {
    Ok,
    NativeError,
    WorkerError,
}

impl ReplyStatus {
    fn code(self) -> u8 {
        match self {
            ReplyStatus::Ok => STATUS_OK,
            ReplyStatus::NativeError => STATUS_NATIVE_ERROR,
            ReplyStatus::WorkerError => STATUS_WORKER_ERROR,
        }
    }

    fn from_code(b: u8) -> Option<ReplyStatus> {
        match b {
            STATUS_OK => Some(ReplyStatus::Ok),
            STATUS_NATIVE_ERROR => Some(ReplyStatus::NativeError),
            STATUS_WORKER_ERROR => Some(ReplyStatus::WorkerError),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReplyMeta {
    pub cursor_captured: bool,
    pub cursor_pos: Option<(i64, i64)>,
    pub scale: f64,
    pub captured_at: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct WorkerReply {
    pub session_id: u64,
    pub generation: u64,
    pub status: ReplyStatus,
    pub width: u32,
    pub height: u32,
    pub png_bytes: Vec<u8>,
    pub meta: ReplyMeta,
}

#[derive(Debug, Clone)]
pub struct ReplyError {
    pub session_id: u64,
    pub generation: u64,
    pub status: ReplyStatus,
    pub stage: String,
    pub message: String,
}

// --- little helpers ---------------------------------------------------------

fn be_u16(v: u16, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}
fn be_u32(v: u32, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}
fn be_u64(v: u64, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}
fn be_i64(v: i64, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}

struct Cursor<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(b: &'a [u8]) -> Self {
        Cursor { b, pos: 0 }
    }
    fn rest_len(&self) -> usize {
        self.b.len().saturating_sub(self.pos)
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.rest_len() < n {
            return Err(format!(
                "frame truncated: need {n} bytes, {} remain",
                self.rest_len()
            ));
        }
        let s = &self.b[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let b = self.take(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
    fn i64(&mut self) -> Result<i64, String> {
        Ok(self.u64()? as i64)
    }
    fn utf8(&mut self, n: usize, what: &str) -> Result<String, String> {
        let b = self.take(n)?;
        String::from_utf8(b.to_vec())
            .map_err(|_| format!("{what} is not valid UTF-8"))
    }
    fn end(&self) -> Result<(), String> {
        if self.rest_len() == 0 {
            Ok(())
        } else {
            Err(format!("{} trailing bytes after frame", self.rest_len()))
        }
    }
}

// --- request encode/decode ---------------------------------------------------

/// Encode + validate a worker request into one framed byte vector.
pub fn encode_request(req: &WorkerRequest) -> Result<Vec<u8>, String> {
    let mut body = Vec::with_capacity(64);
    body.push(req.op.opcode());
    be_u64(req.session_id, &mut body);
    be_u64(req.generation, &mut body);
    body.push(u8::from(req.include_cursor));
    be_u64(req.delay_ms, &mut body);
    match (&req.op, &req.target) {
        (WorkerOp::Backdrop, RequestTarget::Backdrop { monitor_id }) => {
            let id = monitor_id.as_bytes();
            if id.is_empty() || id.len() > MAX_MONITOR_ID_BYTES {
                return Err(format!("monitor id length out of bounds: {}", id.len()));
            }
            be_u16(id.len() as u16, &mut body);
            body.extend_from_slice(id);
        }
        (WorkerOp::Region, RequestTarget::Region { x, y, w, h }) => {
            if *w == 0 || *w > MAX_DIMENSION as u64 || *h == 0 || *h > MAX_DIMENSION as u64 {
                return Err(format!("region dimensions out of bounds: {w}x{h}"));
            }
            be_i64(*x, &mut body);
            be_i64(*y, &mut body);
            be_u64(*w, &mut body);
            be_u64(*h, &mut body);
        }
        _ => return Err("op/target mismatch".to_string()),
    }
    if body.len() > MAX_REQUEST_BYTES {
        return Err("request exceeds maximum frame size".to_string());
    }
    let mut frame = Vec::with_capacity(4 + body.len());
    be_u32(body.len() as u32, &mut frame);
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// Read one framed request from `r` (worker side). Strict: the declared
/// length must match the bytes consumed exactly.
pub fn decode_request_frame(r: impl Read) -> Result<WorkerRequest, String> {
    let mut r = r;
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)
        .map_err(|e| format!("request length read failed: {e}"))?;
    let total = u32::from_be_bytes(len_buf) as usize;
    if total == 0 || total > MAX_REQUEST_BYTES {
        return Err(format!("request frame length out of bounds: {total}"));
    }
    let mut body = vec![0u8; total];
    r.read_exact(&mut body)
        .map_err(|e| format!("request body read failed: {e}"))?;
    // Strict framing: exactly one request per worker invocation. Trailing
    // bytes mean a buggy or hostile caller.
    let mut extra = [0u8; 1];
    match r.read_exact(&mut extra) {
        Ok(()) => return Err("trailing bytes after request frame".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {}
        Err(e) => return Err(format!("request trailer read failed: {e}")),
    }
    decode_request_body(&body)
}

fn decode_request_body(body: &[u8]) -> Result<WorkerRequest, String> {
    let mut c = Cursor::new(body);
    let op = WorkerOp::from_opcode(c.u8()?).ok_or("unknown op code")?;
    let session_id = c.u64()?;
    let generation = c.u64()?;
    let include_cursor = match c.u8()? {
        0 => false,
        1 => true,
        b => return Err(format!("include_cursor not 0/1: {b}")),
    };
    let delay_ms = c.u64()?;
    let target = match op {
        WorkerOp::Backdrop => {
            let id_len = c.u16()? as usize;
            if id_len == 0 || id_len > MAX_MONITOR_ID_BYTES {
                return Err(format!("monitor id length out of bounds: {id_len}"));
            }
            RequestTarget::Backdrop {
                monitor_id: c.utf8(id_len, "monitor id")?,
            }
        }
        WorkerOp::Region => {
            let x = c.i64()?;
            let y = c.i64()?;
            let w = c.u64()?;
            let h = c.u64()?;
            if w == 0 || w > MAX_DIMENSION as u64 || h == 0 || h > MAX_DIMENSION as u64 {
                return Err(format!("region dimensions out of bounds: {w}x{h}"));
            }
            RequestTarget::Region { x, y, w, h }
        }
    };
    c.end()?;
    Ok(WorkerRequest {
        op,
        session_id,
        generation,
        include_cursor,
        delay_ms,
        target,
    })
}

// --- reply encode/decode -----------------------------------------------------

fn encode_meta_ok(meta: &ReplyMeta) -> Result<Vec<u8>, String> {
    if meta.captured_at.len() > 64 {
        return Err("captured_at too long".to_string());
    }
    if meta.warnings.len() > 16 {
        return Err("too many warnings".to_string());
    }
    let mut m = Vec::new();
    m.push(u8::from(meta.cursor_captured));
    let (cx, cy) = meta.cursor_pos.unwrap_or((-1, -1));
    be_i64(cx, &mut m);
    be_i64(cy, &mut m);
    be_u64(meta.scale.to_bits(), &mut m);
    be_u16(meta.captured_at.len() as u16, &mut m);
    m.extend_from_slice(meta.captured_at.as_bytes());
    be_u16(meta.warnings.len() as u16, &mut m);
    for w in &meta.warnings {
        if w.len() > 4096 {
            return Err("warning too long".to_string());
        }
        be_u16(w.len() as u16, &mut m);
        m.extend_from_slice(w.as_bytes());
    }
    Ok(m)
}

/// Encode a successful reply frame (worker side).
pub fn encode_reply_ok(
    session_id: u64,
    generation: u64,
    width: u32,
    height: u32,
    png_bytes: &[u8],
    meta: &ReplyMeta,
) -> Result<Vec<u8>, String> {
    if width == 0 || width > MAX_DIMENSION || height == 0 || height > MAX_DIMENSION {
        return Err(format!("reply dimensions out of bounds: {width}x{height}"));
    }
    if png_bytes.is_empty() {
        return Err("empty PNG payload".to_string());
    }
    let meta_bytes = encode_meta_ok(meta)?;
    let mut frame = Vec::with_capacity(4 + REPLY_HEADER_LEN + png_bytes.len() + meta_bytes.len());
    let total = REPLY_HEADER_LEN + png_bytes.len() + meta_bytes.len();
    be_u32(total as u32, &mut frame);
    be_u64(session_id, &mut frame);
    be_u64(generation, &mut frame);
    frame.push(STATUS_OK);
    be_u32(width, &mut frame);
    be_u32(height, &mut frame);
    be_u32(png_bytes.len() as u32, &mut frame);
    frame.extend_from_slice(png_bytes);
    frame.extend_from_slice(&meta_bytes);
    Ok(frame)
}

/// Encode an error reply frame (worker side). The native error is
/// preserved as stage + message — never replaced with a fabricated frame.
pub fn encode_reply_err(
    session_id: u64,
    generation: u64,
    status: ReplyStatus,
    stage: &str,
    message: &str,
) -> Result<Vec<u8>, String> {
    if status == ReplyStatus::Ok {
        return Err("ok status needs the ok encoder".to_string());
    }
    if stage.len() > 4096 || message.len() > MAX_ERROR_TEXT_BYTES {
        return Err("error text too long".to_string());
    }
    let mut meta = Vec::new();
    be_u16(stage.len() as u16, &mut meta);
    meta.extend_from_slice(stage.as_bytes());
    be_u16(message.len() as u16, &mut meta);
    // message can exceed u16; length-prefix it with u32 instead.
    let mut frame = Vec::with_capacity(4 + REPLY_HEADER_LEN + meta.len() + 4);
    // Rebuild with an explicit u32 message length: stage(u16+bytes) |
    // u32 msg_len | msg bytes.
    meta.clear();
    be_u16(stage.len() as u16, &mut meta);
    meta.extend_from_slice(stage.as_bytes());
    be_u32(message.len() as u32, &mut meta);
    meta.extend_from_slice(message.as_bytes());
    let total = REPLY_HEADER_LEN + meta.len();
    be_u32(total as u32, &mut frame);
    be_u64(session_id, &mut frame);
    be_u64(generation, &mut frame);
    frame.push(status.code());
    be_u32(0, &mut frame); // width
    be_u32(0, &mut frame); // height
    be_u32(0, &mut frame); // payload_len
    frame.extend_from_slice(&meta);
    Ok(frame)
}

fn decode_meta_ok(c: &mut Cursor) -> Result<ReplyMeta, String> {
    let cursor_captured = match c.u8()? {
        0 => false,
        1 => true,
        b => return Err(format!("cursor_captured not 0/1: {b}")),
    };
    let cx = c.i64()?;
    let cy = c.i64()?;
    let scale = f64::from_bits(c.u64()?);
    if !scale.is_finite() || scale <= 0.0 {
        return Err("non-finite scale in reply".to_string());
    }
    let ts_len = c.u16()? as usize;
    if ts_len > 64 {
        return Err("captured_at too long".to_string());
    }
    let captured_at = c.utf8(ts_len, "captured_at")?;
    let nwarn = c.u16()? as usize;
    if nwarn > 16 {
        return Err("too many warnings".to_string());
    }
    let mut warnings = Vec::with_capacity(nwarn);
    for _ in 0..nwarn {
        let wl = c.u16()? as usize;
        if wl > 4096 {
            return Err("warning too long".to_string());
        }
        warnings.push(c.utf8(wl, "warning")?);
    }
    Ok(ReplyMeta {
        cursor_captured,
        cursor_pos: if cursor_captured { Some((cx, cy)) } else { None },
        scale,
        captured_at,
        warnings,
    })
}

fn decode_meta_err(c: &mut Cursor) -> Result<(String, String), String> {
    let sl = c.u16()? as usize;
    if sl > 4096 {
        return Err("stage too long".to_string());
    }
    let stage = c.utf8(sl, "stage")?;
    let ml = c.u32()? as usize;
    if ml > MAX_ERROR_TEXT_BYTES {
        return Err("message too long".to_string());
    }
    let message = c.utf8(ml, "message")?;
    Ok((stage, message))
}

/// Decode one framed reply (parent side). `max_png_bytes` is the artifact
/// raster limit; success payloads larger than it are rejected.
pub fn decode_reply_frame(
    r: impl Read,
    max_png_bytes: usize,
) -> Result<Result<WorkerReply, ReplyError>, String> {
    let mut r = r;
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)
        .map_err(|e| format!("reply length read failed: {e}"))?;
    let total = u32::from_be_bytes(len_buf) as usize;
    let max_total = REPLY_HEADER_LEN + max_png_bytes.max(MAX_ERROR_TEXT_BYTES) + MAX_META_BYTES;
    if total < REPLY_HEADER_LEN || total > max_total {
        return Err(format!("reply frame length out of bounds: {total}"));
    }
    let mut body = vec![0u8; total];
    r.read_exact(&mut body)
        .map_err(|e| format!("reply body read failed: {e}"))?;
    let mut c = Cursor::new(&body);
    let session_id = c.u64()?;
    let generation = c.u64()?;
    let status = ReplyStatus::from_code(c.u8()?).ok_or("unknown status code")?;
    let width = c.u32()?;
    let height = c.u32()?;
    let payload_len = c.u32()? as usize;
    if status == ReplyStatus::Ok {
        if width == 0 || width > MAX_DIMENSION || height == 0 || height > MAX_DIMENSION {
            return Err(format!("reply dimensions out of bounds: {width}x{height}"));
        }
        if payload_len == 0 || payload_len > max_png_bytes {
            return Err(format!("reply payload length out of bounds: {payload_len}"));
        }
        let png_bytes = c.take(payload_len)?.to_vec();
        let meta = decode_meta_ok(&mut c)?;
        c.end()?;
        Ok(Ok(WorkerReply {
            session_id,
            generation,
            status,
            width,
            height,
            png_bytes,
            meta,
        }))
    } else {
        if width != 0 || height != 0 || payload_len != 0 {
            return Err("error reply must carry zero dimensions/payload".to_string());
        }
        let (stage, message) = decode_meta_err(&mut c)?;
        c.end()?;
        Ok(Err(ReplyError {
            session_id,
            generation,
            status,
            stage,
            message,
        }))
    }
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

/// Errors surfaced to the Tauri commands. The commands map these to
/// user-facing strings; `CAPTURE_BUSY` / `WORKER_UNAVAILABLE` keep the
/// verdict's named states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorError {
    /// A worker is already live — zero queue, immediate refusal.
    CaptureBusy,
    /// A previous worker's termination could not be confirmed; the slot is
    /// retained occupied until the zombie is reaped.
    WorkerUnavailable,
    /// The 3,000 ms deadline fired. Says nothing about deadlock — only that
    /// the worker did not finish in time.
    Timeout,
    /// The worker ran and reported a native failure. Stage + message are
    /// the worker's own words, preserved exactly.
    NativeError { stage: String, message: String },
    /// The worker process itself failed (protocol misuse, crash before any
    /// framed reply).
    WorkerError(String),
    /// A reply failed validation (identity, dimensions, lengths).
    Malformed(String),
    /// The worker could not be spawned or the request could not be written.
    SpawnFailed(String),
    /// The generation was fenced (timeout/cancel won) before this outcome.
    Cancelled,
}

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SupervisorError::CaptureBusy => {
                write!(f, "CAPTURE_BUSY: a capture worker is already running")
            }
            SupervisorError::WorkerUnavailable => write!(
                f,
                "WORKER_UNAVAILABLE: the previous worker did not terminate cleanly; \
                 capture is refused until it is reaped"
            ),
            SupervisorError::Timeout => {
                write!(f, "TIMEOUT: capture worker did not finish within 3 seconds")
            }
            SupervisorError::NativeError { stage, message } => {
                write!(f, "native capture failed at stage '{stage}': {message}")
            }
            SupervisorError::WorkerError(m) => write!(f, "capture worker failed: {m}"),
            SupervisorError::Malformed(m) => {
                write!(f, "capture worker reply failed validation: {m}")
            }
            SupervisorError::SpawnFailed(m) => {
                write!(f, "capture worker could not start: {m}")
            }
            SupervisorError::Cancelled => {
                write!(f, "capture was superseded before the worker replied")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    Empty,
    Active { generation: u64 },
    /// Fenced: the generation is terminal (timeout won). A late reply can
    /// no longer commit. Transient — the termination path resolves it to
    /// Empty or Zombie immediately after.
    Fenced { generation: u64 },
    /// Termination unconfirmed: the slot stays occupied until the reaper
    /// confirms the zombie exited.
    Zombie { generation: u64 },
}

/// Parent-side supervisor. Owns admission, the single worker slot, the
/// deadline, generation fencing, and the phase ring log.
///
/// The blocking `execute_*` calls run on the caller's thread — in the app
/// that is a Tauri command-pool thread, never the UI thread — for at most
/// ~3.5 s (deadline + termination confirmation). Native code itself always
/// runs in the child process.
pub struct CaptureSupervisor {
    exe: PathBuf,
    /// Extra argv for the child. Production: `["--capture-worker"]`.
    /// Tests substitute a stand-in (e.g. `/bin/sh -c ...`).
    child_args: Vec<String>,
    max_png_bytes: usize,
    ring: RingLog,
    /// Shared with the at-most-one reaper thread so it can free the slot
    /// when a zombie finally exits.
    slot: Arc<Mutex<Slot>>,
    generation: Mutex<u64>,
}

impl CaptureSupervisor {
    pub fn new(exe: PathBuf, max_png_bytes: usize) -> Self {
        Self::with_child_args(exe, vec!["--capture-worker".to_string()], max_png_bytes)
    }

    pub fn with_child_args(
        exe: PathBuf,
        child_args: Vec<String>,
        max_png_bytes: usize,
    ) -> Self {
        let ring = RingLog::new(RING_CAP);
        let build_sha = option_env!("FORGE_BUILD_GIT_SHA").unwrap_or("unknown");
        let exe_desc = match std::fs::metadata(&exe) {
            Ok(m) => format!("{} ({} bytes)", exe.display(), m.len()),
            Err(_) => format!("{} (unstatable)", exe.display()),
        };
        ring.log(
            "supervisor_init",
            format!("exe={exe_desc} build_sha={build_sha}"),
        );
        CaptureSupervisor {
            exe,
            child_args,
            max_png_bytes,
            ring,
            slot: Arc::new(Mutex::new(Slot::Empty)),
            generation: Mutex::new(0),
        }
    }

    pub fn ring(&self) -> &RingLog {
        &self.ring
    }

    /// Frozen fullscreen backdrop for region picking.
    pub fn execute_backdrop(
        &self,
        session_id: u64,
        monitor_id: &str,
    ) -> Result<WorkerReply, SupervisorError> {
        self.run(WorkerRequest {
            op: WorkerOp::Backdrop,
            session_id,
            generation: 0, // assigned at admission
            include_cursor: false,
            delay_ms: 0,
            target: RequestTarget::Backdrop {
                monitor_id: monitor_id.to_string(),
            },
        })
    }

    /// Final live region read (physical px, virtual-desktop coords).
    /// `delay_ms` is a user-requested pre-capture wait: it runs inside the
    /// worker (so the acquisition timestamp stays truthful) and the parent
    /// deadline below is extended by it — a legitimate wait must not read
    /// as a stall. The 3 s acquisition bound itself is never extended.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_region(
        &self,
        session_id: u64,
        x: i64,
        y: i64,
        w: u64,
        h: u64,
        include_cursor: bool,
        delay_ms: u64,
    ) -> Result<WorkerReply, SupervisorError> {
        // NOTE: the deadline below covers the worker round-trip. The delay
        // itself is worker-side (it preserves acquisition-time stamping);
        // callers must add delay_ms to their own patience, or — as the
        // region-overlay path does — keep delay_ms small. A large delay
        // would trip the parent deadline by design: the deadline bounds the
        // *worker*, not the user's requested wait. To keep the contract
        // literal, the parent deadline below is extended by delay_ms.
        self.run(WorkerRequest {
            op: WorkerOp::Region,
            session_id,
            generation: 0,
            include_cursor,
            delay_ms,
            target: RequestTarget::Region { x, y, w, h },
        })
    }

    // --- slot ---------------------------------------------------------------

    /// Admit one request. Assigns the next generation and marks the slot
    /// active. Fails fast when the slot is occupied — zero queue.
    fn admit(&self) -> Result<u64, SupervisorError> {
        let mut slot = self.slot.lock().unwrap();
        match *slot {
            Slot::Empty => {
                let mut gen = self.generation.lock().unwrap();
                *gen = gen.wrapping_add(1);
                let g = *gen;
                *slot = Slot::Active { generation: g };
                Ok(g)
            }
            Slot::Active { .. } => Err(SupervisorError::CaptureBusy),
            // Fenced is transient (the termination path resolves it
            // microseconds later); fail closed while it stands.
            Slot::Fenced { .. } => Err(SupervisorError::CaptureBusy),
            Slot::Zombie { .. } => Err(SupervisorError::WorkerUnavailable),
        }
    }

    fn release_if(&self, generation: u64) {
        let mut slot = self.slot.lock().unwrap();
        if *slot == (Slot::Active { generation }) {
            *slot = Slot::Empty;
        }
    }

    // --- execution ------------------------------------------------------------

    fn run(&self, req: WorkerRequest) -> Result<WorkerReply, SupervisorError> {
        let generation = self.admit()?;
        let req = WorkerRequest { generation, ..req };
        // The user-requested delay runs inside the worker; the parent's
        // deadline bounds the worker round-trip, so extend it by the delay
        // rather than letting a legitimate wait read as a stall.
        let deadline =
            Instant::now() + Duration::from_millis(CAPTURE_DEADLINE_MS + req.delay_ms);
        self.ring.log(
            "worker_admit",
            format!(
                "op={:?} session={} gen={generation} delay_ms={}",
                req.op, req.session_id, req.delay_ms
            ),
        );

        let frame = encode_request(&req).map_err(|e| {
            self.release_if(generation);
            SupervisorError::Malformed(format!("request encode: {e}"))
        })?;

        let mut child = match self.spawn_child() {
            Ok(c) => c,
            Err(e) => {
                self.release_if(generation);
                return Err(SupervisorError::SpawnFailed(e));
            }
        };
        #[cfg(windows)]
        contain_in_job(&child, &self.ring);

        // The request frame is small (<64 KiB); a single write_all cannot
        // fill the pipe buffer, so this cannot block behind a wedged child.
        if let Some(mut stdin) = child.stdin.take() {
            let wr = stdin.write_all(&frame).and_then(|_| stdin.flush());
            drop(stdin); // EOF: end of request
            if let Err(e) = wr {
                let _ = child.kill();
                self.release_if(generation);
                self.ring.log("worker_request_write_failed", e.to_string());
                return Err(SupervisorError::SpawnFailed(format!("request write: {e}")));
            }
        } else {
            let _ = child.kill();
            self.release_if(generation);
            return Err(SupervisorError::SpawnFailed("no stdin pipe".to_string()));
        }
        self.ring.log("worker_request_written", format!("gen={generation}"));

        // Reader thread: owns stdout, delivers exactly one outcome. Its
        // lifetime is bounded by the child's: every parent path that gives
        // up on the child kills it, which closes the pipe and unblocks the
        // read. No thread-per-retry growth.
        let (tx, rx) = mpsc::sync_channel::<Result<Result<WorkerReply, ReplyError>, String>>(1);
        let max_png = self.max_png_bytes;
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                let res = decode_reply_frame(stdout, max_png);
                let _ = tx.send(res);
            });
        } else {
            let _ = child.kill();
            self.release_if(generation);
            return Err(SupervisorError::SpawnFailed("no stdout pipe".to_string()));
        }
        // Stderr drain: worker phase markers -> ring log. Same lifetime
        // bound as the reader (dies with the child).
        if let Some(stderr) = child.stderr.take() {
            let ring = self.ring.clone();
            std::thread::spawn(move || drain_stderr(stderr, &ring));
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining) {
            Ok(Ok(Ok(reply))) => {
                // Validate identity + fence the generation before publishing.
                if reply.session_id != req.session_id || reply.generation != generation {
                    self.ring.log(
                        "worker_identity_mismatch",
                        format!(
                            "want session={} gen={generation}, got session={} gen={}",
                            req.session_id, reply.session_id, reply.generation
                        ),
                    );
                    let _ = child.kill();
                    self.release_if(generation);
                    return Err(SupervisorError::Malformed(
                        "reply identity does not match the admitted request".to_string(),
                    ));
                }
                // One parent-owned terminal transition.
                {
                    let mut slot = self.slot.lock().unwrap();
                    if *slot != (Slot::Active { generation }) {
                        // Fenced while the reply was in flight (timeout won
                        // the race): discard the late success.
                        self.ring.log(
                            "worker_late_reply_discarded",
                            format!("gen={generation}"),
                        );
                        let _ = child.kill();
                        return Err(SupervisorError::Cancelled);
                    }
                    *slot = Slot::Empty;
                }
                self.ring.log(
                    "worker_reply_admitted",
                    format!(
                        "gen={generation} {}x{} {} bytes",
                        reply.width,
                        reply.height,
                        reply.png_bytes.len()
                    ),
                );
                reap_gracefully(child, &self.ring);
                Ok(reply)
            }
            Ok(Ok(Err(err))) => {
                // The worker answered with a native/worker error: a
                // definitive outcome. Preserve stage + message exactly.
                if err.session_id != req.session_id || err.generation != generation {
                    let _ = child.kill();
                    self.release_if(generation);
                    return Err(SupervisorError::Malformed(
                        "error reply identity does not match".to_string(),
                    ));
                }
                self.release_if(generation);
                self.ring.log(
                    "worker_error_reply",
                    format!("gen={generation} stage={}", err.stage),
                );
                reap_gracefully(child, &self.ring);
                Err(match err.status {
                    ReplyStatus::NativeError => SupervisorError::NativeError {
                        stage: err.stage,
                        message: err.message,
                    },
                    _ => SupervisorError::WorkerError(format!("{}: {}", err.stage, err.message)),
                })
            }
            Ok(Err(decode_err)) => {
                // The worker spoke, but not protocol: kill, release.
                self.ring
                    .log("worker_malformed", format!("gen={generation}: {decode_err}"));
                let _ = child.kill();
                self.release_if(generation);
                reap_gracefully(child, &self.ring);
                Err(SupervisorError::Malformed(decode_err))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.ring
                    .log("worker_timeout", format!("gen={generation}: no reply in deadline"));
                // Fence FIRST: the generation is terminal the moment the
                // deadline fires. A reply arriving between here and the
                // termination confirmation can no longer commit — timeout
                // wins the race unless success was already admitted.
                let zombied = {
                    let mut slot = self.slot.lock().unwrap();
                    *slot = Slot::Fenced { generation };
                    self.ring.log("generation_fenced", format!("gen={generation}"));
                    let confirmed = terminate_promptly(&mut child, &self.ring);
                    if confirmed {
                        *slot = Slot::Empty;
                        false
                    } else {
                        // Termination unconfirmed: retain the occupied slot
                        // and refuse further captures until the reaper
                        // confirms the zombie exited.
                        *slot = Slot::Zombie { generation };
                        true
                    }
                };
                if zombied {
                    spawn_reaper(child, generation, Arc::clone(&self.slot), self.ring.clone());
                }
                Err(SupervisorError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Reader died without delivering: treat as malformed.
                self.ring.log("worker_reader_gone", format!("gen={generation}"));
                let _ = child.kill();
                self.release_if(generation);
                reap_gracefully(child, &self.ring);
                Err(SupervisorError::Malformed(
                    "reply reader terminated without a reply".to_string(),
                ))
            }
        }
    }

    fn spawn_child(&self) -> Result<Child, String> {
        if self.exe.as_os_str().is_empty() {
            return Err("worker executable path is not set".to_string());
        }
        Command::new(&self.exe)
            .args(&self.child_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // No window, no console for the worker on Windows: it must
            // never flash UI or steal focus.
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", self.exe.display()))
    }
}

// --- termination --------------------------------------------------------------

/// Ask the worker to terminate and wait at most TERMINATION_CONFIRM_MS
/// for confirmation, off the UI thread. `Child::kill` is asynchronous by
/// nature (TerminateProcess / SIGKILL); pending I/O can delay exit, hence
/// the occupied-slot rule when confirmation fails. Returns true when the
/// exit was confirmed.
fn terminate_promptly(child: &mut Child, ring: &RingLog) -> bool {
    ring.log("worker_kill", "requesting termination");
    // Best effort: a child that already exited makes kill() fail harmlessly.
    let _ = child.kill();
    let deadline = Instant::now() + Duration::from_millis(TERMINATION_CONFIRM_MS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                ring.log("worker_terminated", format!("status={status:?}"));
                return true;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(TERMINATION_POLL_MS));
            }
            Err(e) => {
                ring.log("worker_wait_error", e.to_string());
                return false;
            }
        }
    }
    ring.log(
        "worker_termination_unconfirmed",
        "slot retained occupied; further captures refused",
    );
    false
}

/// Reap a well-behaved child after a definitive outcome: bounded grace
/// wait, then kill. Never a synchronous join on a hung worker — this is
/// only called when the worker already answered.
fn reap_gracefully(mut child: Child, ring: &RingLog) {
    let deadline = Instant::now() + Duration::from_millis(TERMINATION_CONFIRM_MS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(TERMINATION_POLL_MS));
            }
            Err(_) => return,
        }
    }
    let _ = child.kill();
    ring.log("worker_reap_kill", "worker lingered after reply; killed");
}

/// One reaper per unconfirmed termination (at most one zombie exists, so
/// at most one reaper): waits for the zombie's actual exit, then frees the
/// slot if it is still ours. No thread-per-retry growth.
fn spawn_reaper(
    mut child: Child,
    generation: u64,
    slot: Arc<Mutex<Slot>>,
    ring: RingLog,
) {
    ring.log("zombie_reaper_spawned", format!("gen={generation}"));
    std::thread::spawn(move || {
        let _ = child.wait(); // bounded by the zombie's actual exit
        let mut s = slot.lock().unwrap();
        if *s == (Slot::Zombie { generation }) {
            *s = Slot::Empty;
            ring.log("zombie_reaped", format!("gen={generation}: slot free"));
        }
    });
}

// --- stderr drain -----------------------------------------------------------------

fn drain_stderr(stderr: ChildStderr, ring: &RingLog) {
    use std::io::BufRead;
    let reader = std::io::BufReader::new(stderr);
    for line in reader.lines() {
        match line {
            Ok(l) => {
                // Worker phase markers are already bracketed; keep them
                // verbatim but capped.
                let mut l = l;
                l.truncate(512);
                ring.log("worker", l);
            }
            Err(_) => break,
        }
    }
}

// ---------------------------------------------------------------------------
// Windows: kill-on-parent-exit job containment (best effort)
// ---------------------------------------------------------------------------

/// Best-effort containment: place the worker in a Job object with
/// KILL_ON_JOB_CLOSE so a parent crash can never orphan a capture worker.
/// Any failure only logs — containment is defense in depth, not a gate.
/// Signatures verified against the vendored `windows` 0.62 sources.
#[cfg(windows)]
fn contain_in_job(child: &Child, ring: &RingLog) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOBOBJECTINFOCLASS,
        JOBOBJECT_BASIC_LIMIT_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    // SAFETY: all calls are Win32 FFI with validated handles; failures are
    // non-fatal (we just skip containment).
    unsafe {
        // `Param<PCWSTR>` is implemented for `Option<&PCWSTR>` (not
        // `Option<PCWSTR>`) — hence the reference in the type.
        let name: Option<&PCWSTR> = None;
        let job = match CreateJobObjectW(None, name) {
            Ok(h) => h,
            Err(e) => {
                ring.log("job_contain_failed", format!("CreateJobObjectW: {e}"));
                return;
            }
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.0);
        let class: JOBOBJECTINFOCLASS = JobObjectExtendedLimitInformation;
        if let Err(e) = SetInformationJobObject(
            job,
            class,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&info) as u32,
        ) {
            ring.log("job_contain_failed", format!("SetInformationJobObject: {e}"));
            let _ = CloseHandle(job);
            return;
        }
        let proc = HANDLE(child.as_raw_handle() as *mut std::ffi::c_void);
        if let Err(e) = AssignProcessToJobObject(job, proc) {
            ring.log(
                "job_contain_failed",
                format!("AssignProcessToJobObject: {e}"),
            );
            let _ = CloseHandle(job);
            return;
        }
        // Intentionally leaked: the job must outlive this function so the
        // worker stays contained for the whole request. The OS reaps the
        // job object when the parent process exits (KILL_ON_JOB_CLOSE).
        std::mem::forget(job);
        ring.log("job_contained", "worker in KILL_ON_JOB_CLOSE job");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor as IoCursor;

    fn sample_meta() -> ReplyMeta {
        ReplyMeta {
            cursor_captured: true,
            cursor_pos: Some((10, -20)),
            scale: 1.5,
            captured_at: "2026-10-23T12:00:00Z".to_string(),
            warnings: vec!["w1".to_string(), "w2".to_string()],
        }
    }

    fn sample_backdrop_req() -> WorkerRequest {
        WorkerRequest {
            op: WorkerOp::Backdrop,
            session_id: 7,
            generation: 42,
            include_cursor: false,
            delay_ms: 0,
            target: RequestTarget::Backdrop {
                monitor_id: "\\\\.\\DISPLAY5".to_string(),
            },
        }
    }

    fn sample_region_req() -> WorkerRequest {
        WorkerRequest {
            op: WorkerOp::Region,
            session_id: 9,
            generation: 43,
            include_cursor: true,
            delay_ms: 250,
            target: RequestTarget::Region {
                x: -1920,
                y: 0,
                w: 2560,
                h: 1440,
            },
        }
    }

    #[test]
    fn request_round_trip_backdrop() {
        let req = sample_backdrop_req();
        let frame = encode_request(&req).unwrap();
        let back = decode_request_frame(IoCursor::new(&frame)).unwrap();
        assert_eq!(back.session_id, 7);
        assert_eq!(back.generation, 42);
        assert_eq!(back.op, WorkerOp::Backdrop);
        match back.target {
            RequestTarget::Backdrop { monitor_id } => {
                assert_eq!(monitor_id, "\\\\.\\DISPLAY5")
            }
            _ => panic!("wrong target"),
        }
    }

    #[test]
    fn request_round_trip_region_negative_origin() {
        // Geometry fixture: secondary monitor left of primary.
        let req = sample_region_req();
        let frame = encode_request(&req).unwrap();
        let back = decode_request_frame(IoCursor::new(&frame)).unwrap();
        match back.target {
            RequestTarget::Region { x, y, w, h } => {
                assert_eq!((x, y, w, h), (-1920, 0, 2560, 1440))
            }
            _ => panic!("wrong target"),
        }
        assert!(back.include_cursor);
        assert_eq!(back.delay_ms, 250);
    }

    #[test]
    fn request_rejects_zero_region() {
        let mut req = sample_region_req();
        req.target = RequestTarget::Region { x: 0, y: 0, w: 0, h: 100 };
        assert!(encode_request(&req).is_err());
    }

    #[test]
    fn request_rejects_op_target_mismatch() {
        let mut req = sample_backdrop_req();
        req.op = WorkerOp::Region; // target still Backdrop
        assert!(encode_request(&req).is_err());
    }

    #[test]
    fn request_decode_rejects_unknown_opcode() {
        let mut frame = encode_request(&sample_backdrop_req()).unwrap();
        frame[4] = 0x7F; // op byte
        assert!(decode_request_frame(IoCursor::new(&frame)).is_err());
    }

    #[test]
    fn request_decode_rejects_trailing_bytes() {
        let mut frame = encode_request(&sample_backdrop_req()).unwrap();
        frame.extend_from_slice(&[0u8; 8]); // trailing garbage, length lies
        assert!(decode_request_frame(IoCursor::new(&frame)).is_err());
    }

    #[test]
    fn request_decode_rejects_empty_monitor_id() {
        let req = WorkerRequest {
            target: RequestTarget::Backdrop {
                monitor_id: "".to_string(),
            },
            ..sample_backdrop_req()
        };
        assert!(encode_request(&req).is_err());
    }

    #[test]
    fn reply_ok_round_trip() {
        let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
        let frame = encode_reply_ok(7, 42, 2560, 1440, &png, &sample_meta()).unwrap();
        match decode_reply_frame(IoCursor::new(&frame), 128 * 1024 * 1024).unwrap() {
            Ok(reply) => {
                assert_eq!((reply.session_id, reply.generation), (7, 42));
                assert_eq!((reply.width, reply.height), (2560, 1440));
                assert_eq!(reply.png_bytes, png);
                assert_eq!(reply.meta.captured_at, "2026-10-23T12:00:00Z");
                assert_eq!(reply.meta.warnings.len(), 2);
                assert_eq!(reply.meta.cursor_pos, Some((10, -20)));
                assert_eq!(reply.meta.scale, 1.5);
            }
            Err(_) => panic!("expected ok"),
        }
    }

    #[test]
    fn reply_ok_rejects_oversize_payload() {
        let png = vec![1u8; 100];
        let frame = encode_reply_ok(1, 1, 10, 10, &png, &sample_meta()).unwrap();
        // max_png smaller than the payload: must reject.
        assert!(decode_reply_frame(IoCursor::new(&frame), 10).is_err());
    }

    #[test]
    fn reply_err_round_trip_preserves_stage_and_message() {
        let frame =
            encode_reply_err(3, 9, ReplyStatus::NativeError, "BitBlt", "gdi error 6: invalid handle")
                .unwrap();
        match decode_reply_frame(IoCursor::new(&frame), 1024).unwrap() {
            Err(e) => {
                assert_eq!(e.stage, "BitBlt");
                assert_eq!(e.message, "gdi error 6: invalid handle");
                assert_eq!(e.status, ReplyStatus::NativeError);
                assert_eq!((e.session_id, e.generation), (3, 9));
            }
            Ok(_) => panic!("expected error"),
        }
    }

    #[test]
    fn reply_rejects_unknown_status() {
        let mut frame =
            encode_reply_err(1, 1, ReplyStatus::WorkerError, "s", "m").unwrap();
        // status byte is at offset 4 + 8 + 8 = 20
        frame[20] = 0x7F;
        assert!(decode_reply_frame(IoCursor::new(&frame), 1024).is_err());
    }

    #[test]
    fn reply_rejects_error_with_dimensions() {
        // An error reply smuggling dimensions/payload is malformed.
        let mut frame =
            encode_reply_err(1, 1, ReplyStatus::NativeError, "s", "m").unwrap();
        // width field at offset 21..25
        frame[21..25].copy_from_slice(&100u32.to_be_bytes());
        assert!(decode_reply_frame(IoCursor::new(&frame), 1024).is_err());
    }

    #[test]
    fn reply_rejects_non_finite_scale() {
        let mut meta = sample_meta();
        meta.scale = f64::NAN;
        let png = vec![1u8; 8];
        // encode succeeds (worker side is dumb); decode must reject.
        let frame = encode_reply_ok(1, 1, 8, 1, &png, &meta).unwrap();
        assert!(decode_reply_frame(IoCursor::new(&frame), 1024).is_err());
    }

    #[test]
    fn ring_log_caps_and_orders_newest_first() {
        let ring = RingLog::new(4);
        for i in 0..6 {
            ring.log("stage", format!("n{i}"));
        }
        assert_eq!(ring.len(), 4);
        let tail = ring.tail(4);
        assert!(tail[0].ends_with("n5"));
        assert!(tail[3].ends_with("n2"));
        assert!(tail[0].contains("stage: n5"));
    }

    #[test]
    fn supervisor_error_display_names_states() {
        assert!(SupervisorError::CaptureBusy.to_string().contains("CAPTURE_BUSY"));
        assert!(SupervisorError::WorkerUnavailable
            .to_string()
            .contains("WORKER_UNAVAILABLE"));
        // Timeout wording must not claim a deadlock.
        let t = SupervisorError::Timeout.to_string();
        assert!(t.contains("3 seconds"));
        assert!(!t.to_lowercase().contains("deadlock"));
    }

    // --- process-level fixtures (Unix) ---------------------------------------
    //
    // These drive the REAL supervisor entrypoints against stand-in child
    // processes. They run on Linux/macOS CI; the Windows worker path is
    // exercised on Jason's hardware gate.

    #[cfg(unix)]
    fn write_reply_file(session: u64, generation: u64, png_len: usize) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let png: Vec<u8> = (0..png_len).map(|i| (i % 251) as u8).collect();
        let frame = encode_reply_ok(session, generation, 64, 48, &png, &sample_meta()).unwrap();
        let mut p = std::env::temp_dir();
        p.push(format!("cw_reply_{}_{}.bin", std::process::id(), n));
        std::fs::write(&p, &frame).unwrap();
        p
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_success_round_trip() {
        // The stand-in is `sh -c "cat <file>"`: the file is rewritten
        // between admissions so each canned reply carries the generation
        // the supervisor actually assigned (1, then 2).
        let f = write_reply_file(11, 1, 4096);
        let f_str = f.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("cat {f_str}")],
            128 * 1024 * 1024,
        );
        let reply = sup.execute_backdrop(11, "MON").unwrap();
        assert_eq!((reply.width, reply.height), (64, 48));
        assert_eq!(reply.png_bytes.len(), 4096);
        assert_eq!(reply.session_id, 11);
        assert_eq!(reply.generation, 1);
        assert_eq!(reply.meta.warnings.len(), 2);
        // Slot freed: a second admission works and the generation advanced.
        let f2 = write_reply_file(12, 2, 4096);
        std::fs::rename(&f2, &f).unwrap();
        let reply2 = sup.execute_backdrop(12, "MON").unwrap();
        assert_eq!(reply2.session_id, 12);
        assert_eq!(reply2.generation, 2);
        assert_ne!(reply.generation, reply2.generation);
        std::fs::remove_file(&f).ok();
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_never_reply_times_out_and_frees_slot() {
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), "sleep 30".to_string()],
            1024,
        );
        let t0 = Instant::now();
        let err = sup.execute_backdrop(1, "MON").unwrap_err();
        let dt = t0.elapsed();
        assert_eq!(err, SupervisorError::Timeout);
        // Deadline respected (3 s + termination-confirm grace, not 30 s).
        assert!(dt < Duration::from_secs(10), "took {dt:?}");
        assert!(dt >= Duration::from_millis(CAPTURE_DEADLINE_MS));
        // Slot freed after confirmed kill: the next request is admitted
        // (it times out again against the fresh `sleep`, proving admission
        // succeeded — a stuck slot would refuse with Busy/Unavailable).
        match sup.execute_backdrop(2, "MON") {
            Err(SupervisorError::Timeout) => {}
            other => panic!("expected Timeout (admitted, then timed out), got {other:?}"),
        }
    }

    // Helper: SupervisorError has no Clone derive on purpose (kept minimal);
    // compare discriminants instead.
    #[test]
    #[cfg(unix)]
    fn supervisor_crash_discriminant() {
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), "exit 3".to_string()],
            1024,
        );
        match sup.execute_backdrop(1, "MON") {
            Err(SupervisorError::Malformed(_)) => {}
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_garbage_reply_is_malformed() {
        // The stand-in stays alive long enough to receive the request,
        // then emits non-protocol bytes: the supervisor must report
        // Malformed, never hang, never publish.
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec![
                "-c".to_string(),
                "sleep 0.5; printf 'this is not a frame'".to_string(),
            ],
            1024,
        );
        match sup.execute_backdrop(1, "MON") {
            Err(SupervisorError::Malformed(_)) => {}
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_late_reply_is_discarded_timeout_wins() {
        // The stand-in replies at ~4 s, after the 3 s deadline: the parent
        // must report Timeout, fence the generation, and discard the late
        // reply — then admit the next request cleanly.
        let f = write_reply_file(77, 1, 32);
        let f_str = f.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("sleep 4; cat {f_str}")],
            1024,
        );
        let t0 = Instant::now();
        match sup.execute_backdrop(77, "MON") {
            Err(SupervisorError::Timeout) => {}
            other => panic!("expected Timeout, got {other:?}"),
        }
        assert!(t0.elapsed() < Duration::from_secs(10));
        // The late reply must not have committed anything: the slot is free
        // and a fresh request is admitted (proves the fence held).
        let f2 = write_reply_file(78, 1, 32);
        let f2_str = f2.to_string_lossy().into_owned();
        let sup2 = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("cat {f2_str}")],
            1024,
        );
        let reply = sup2.execute_backdrop(78, "MON").unwrap();
        assert_eq!(reply.session_id, 78);
        std::fs::remove_file(&f).ok();
        std::fs::remove_file(&f2).ok();
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_second_admission_while_active_is_busy() {
        // Hold the slot with a slow worker on one thread; a second
        // admission from another thread must fail fast with CaptureBusy
        // (zero queue), not wait.
        let sup = Arc::new(CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), "sleep 5".to_string()],
            1024,
        ));
        let sup2 = Arc::clone(&sup);
        let h = std::thread::spawn(move || sup2.execute_backdrop(1, "MON"));
        // Give the first admission a moment to occupy the slot.
        std::thread::sleep(Duration::from_millis(300));
        let t0 = Instant::now();
        match sup.execute_backdrop(2, "MON") {
            Err(SupervisorError::CaptureBusy) => {}
            other => panic!("expected CaptureBusy, got {other:?}"),
        }
        assert!(t0.elapsed() < Duration::from_secs(1), "must refuse immediately");
        let _ = h.join();
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_spawn_failure_is_not_a_hang() {
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/nonexistent/capture-worker"),
            vec!["--capture-worker".to_string()],
            1024,
        );
        match sup.execute_backdrop(1, "MON") {
            Err(SupervisorError::SpawnFailed(_)) => {}
            other => panic!("expected SpawnFailed, got {other:?}"),
        }
        // Slot released: a (also failing) second attempt is not Busy.
        match sup.execute_backdrop(1, "MON") {
            Err(SupervisorError::SpawnFailed(_)) => {}
            other => panic!("expected SpawnFailed, got {other:?}"),
        }
    }
}
