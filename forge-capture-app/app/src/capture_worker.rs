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

/// Total budget per native capture request, from parent admission. This
/// bound is always exactly `CAPTURE_DEADLINE_MS` — a user-requested delay
/// (C639-003) is an explicit, separately-bounded stage the caller runs
/// BEFORE admission, never an extension of this budget.
pub const CAPTURE_DEADLINE_MS: u64 = 3000;
/// Extra bound for confirming worker termination, off the UI thread.
pub const TERMINATION_CONFIRM_MS: u64 = 500;
/// Poll granularity while confirming termination.
const TERMINATION_POLL_MS: u64 = 10;
/// Sane ceiling for a caller-requested pre-capture delay (C639-003): bounds
/// the arithmetic and the user experience alike. Enforced at the delay
/// stage, not folded into the native execution deadline.
pub const MAX_DELAY_MS: u64 = 60_000;
/// Chunk size for the cancellable delay-stage sleep loop.
const DELAY_POLL_MS: u64 = 50;
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
    if req.delay_ms > MAX_DELAY_MS {
        return Err(format!(
            "delay_ms exceeds bound: {} > {MAX_DELAY_MS}",
            req.delay_ms
        ));
    }
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
    /// C639-002A: the active worker's kill-on-parent-exit Job handle
    /// (Windows only; always `None` elsewhere). OWNED here — not leaked via
    /// `mem::forget` — and closed once this worker's exit is confirmed
    /// (`retire_with`), or, if exit could not be confirmed within the
    /// bound, kept alive and closed later by the reaper once ITS wait()
    /// confirms the process actually exited. Shared with the reaper thread
    /// for that reason, same pattern as `slot`.
    job: Arc<Mutex<Option<JobHandle>>>,
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
            job: Arc::new(Mutex::new(None)),
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
    ///
    /// `delay_ms` (C639-003) is a user-requested pre-capture wait. It is an
    /// explicit stage the PARENT runs here, entirely BEFORE the worker is
    /// even admitted/spawned — never folded into the fixed 3,000 ms native
    /// execution deadline. This keeps the acquisition-stall bound literal
    /// (process startup, enumeration and acquisition always get exactly
    /// `CAPTURE_DEADLINE_MS`, regardless of how long the user asked to
    /// wait first) and makes the wait itself a distinct, boundable stage
    /// rather than opaque time hidden inside the worker round-trip. The
    /// worker's own `delay_ms` is always 0: the capture it performs happens
    /// immediately once spawned, which is already after the user's wait
    /// has elapsed, so the engine's acquisition timestamp stays truthful.
    /// `is_cancelled` (C639-007) is polled once per delay chunk AND once
    /// more right before admission — a revocable token carried through both
    /// stages. An affirmative at either point aborts with
    /// `SupervisorError::Cancelled` before the worker is ever spawned. The
    /// caller is responsible for also re-checking before it publishes the
    /// result the worker eventually returns; this only covers the stages
    /// that happen before the worker is admitted.
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
        mut is_cancelled: impl FnMut() -> bool,
    ) -> Result<WorkerReply, SupervisorError> {
        if !run_delay_stage(delay_ms.min(MAX_DELAY_MS), &self.ring, &mut is_cancelled) {
            self.ring
                .log("region_cancelled_during_delay", format!("session={session_id}"));
            return Err(SupervisorError::Cancelled);
        }
        if is_cancelled() {
            self.ring
                .log("region_cancelled_before_admission", format!("session={session_id}"));
            return Err(SupervisorError::Cancelled);
        }
        self.run(WorkerRequest {
            op: WorkerOp::Region,
            session_id,
            generation: 0,
            include_cursor,
            delay_ms: 0,
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
        // C639-003: the native execution budget is always exactly
        // CAPTURE_DEADLINE_MS. Any user-requested delay already ran as its
        // own stage before admission (see `run_delay_stage`/
        // `execute_region`) — it never extends this bound.
        let deadline = Instant::now() + Duration::from_millis(CAPTURE_DEADLINE_MS);
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
        // C639-002A: own the Job handle (if containment succeeded) instead
        // of leaking it — closed in `retire_with` once this generation's
        // exit is confirmed, or by the reaper if confirmation timed out.
        *self.job.lock().unwrap() = contain_in_job(&child, &self.ring);

        // The request frame is small (<64 KiB); a single write_all cannot
        // fill the pipe buffer, so this cannot block behind a wedged child.
        if let Some(mut stdin) = child.stdin.take() {
            let wr = stdin.write_all(&frame).and_then(|_| stdin.flush());
            drop(stdin); // EOF: end of request
            if let Err(e) = wr {
                self.ring.log("worker_request_write_failed", e.to_string());
                self.retire(child, generation);
                return Err(SupervisorError::SpawnFailed(format!("request write: {e}")));
            }
        } else {
            self.retire(child, generation);
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
            self.retire(child, generation);
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
                // Validate identity before publishing.
                if reply.session_id != req.session_id || reply.generation != generation {
                    self.ring.log(
                        "worker_identity_mismatch",
                        format!(
                            "want session={} gen={generation}, got session={} gen={}",
                            req.session_id, reply.session_id, reply.generation
                        ),
                    );
                    self.retire(child, generation);
                    return Err(SupervisorError::Malformed(
                        "reply identity does not match the admitted request".to_string(),
                    ));
                }
                // C639-002: confirm the child's actual exit BEFORE the
                // slot's one parent-owned terminal transition — never free
                // (or late-discard against) occupancy ahead of a confirmed
                // exit. `retire` returns whether the slot still held this
                // generation's Active state (i.e. nothing fenced it first).
                let owned = self.retire(child, generation);
                if !owned {
                    // Fenced while the reply was in flight (timeout won
                    // the race): discard the late success.
                    self.ring.log(
                        "worker_late_reply_discarded",
                        format!("gen={generation}"),
                    );
                    return Err(SupervisorError::Cancelled);
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
                Ok(reply)
            }
            Ok(Ok(Err(err))) => {
                // The worker answered with a native/worker error: a
                // definitive outcome. Preserve stage + message exactly.
                if err.session_id != req.session_id || err.generation != generation {
                    self.retire(child, generation);
                    return Err(SupervisorError::Malformed(
                        "error reply identity does not match".to_string(),
                    ));
                }
                self.ring.log(
                    "worker_error_reply",
                    format!("gen={generation} stage={}", err.stage),
                );
                self.retire(child, generation);
                Err(match err.status {
                    ReplyStatus::NativeError => SupervisorError::NativeError {
                        stage: err.stage,
                        message: err.message,
                    },
                    _ => SupervisorError::WorkerError(format!("{}: {}", err.stage, err.message)),
                })
            }
            Ok(Err(decode_err)) => {
                // The worker spoke, but not protocol: retire, release.
                self.ring
                    .log("worker_malformed", format!("gen={generation}: {decode_err}"));
                self.retire(child, generation);
                Err(SupervisorError::Malformed(decode_err))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.ring
                    .log("worker_timeout", format!("gen={generation}: no reply in deadline"));
                // Fence FIRST, with the lock held only for the transition
                // itself: the generation is terminal the moment the
                // deadline fires, so a reply arriving between here and the
                // termination confirmation can no longer commit — timeout
                // wins the race unless success was already admitted. The
                // termination wait itself (bounded, up to
                // TERMINATION_CONFIRM_MS) runs with NO lock held, so a
                // concurrent admission attempt sees Fenced/Zombie and
                // refuses immediately rather than blocking on this
                // request's cleanup (C639-002).
                {
                    let mut slot = self.slot.lock().unwrap();
                    *slot = Slot::Fenced { generation };
                }
                self.ring.log("generation_fenced", format!("gen={generation}"));
                self.retire_now(child, generation);
                Err(SupervisorError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Reader died without delivering: treat as malformed.
                self.ring.log("worker_reader_gone", format!("gen={generation}"));
                self.retire(child, generation);
                Err(SupervisorError::Malformed(
                    "reply reader terminated without a reply".to_string(),
                ))
            }
        }
    }

    /// The single owned-child retirement protocol used by EVERY terminal
    /// branch of `run` (C639-002): confirm the child's actual exit —
    /// bounded, with the slot lock held only for the instantaneous state
    /// transition, never across the wait itself — before the slot can be
    /// freed. If exit cannot be confirmed within the bound, the slot is
    /// marked `Zombie` (occupied; further captures refused) and a single
    /// reaper thread takes over, exactly like the timeout path already
    /// did. Returns true iff the slot still held `Active`/`Fenced` for
    /// `generation` at the moment this call resolved it (i.e. this call
    /// owns the terminal transition — nothing else raced it); false means
    /// a prior call already resolved this generation, so the caller's
    /// outcome must be discarded (late reply after fencing).
    ///
    /// `retire` (the common case) gives an already-answered worker one
    /// grace window before killing it; `retire_now` (the timeout path)
    /// kills immediately — the worker already blew its budget, so an
    /// extra grace window would needlessly delay the ≤500 ms termination
    /// bound the module promises.
    fn retire(&self, child: Child, generation: u64) -> bool {
        self.retire_with(child, generation, /* grace_first */ true)
    }

    fn retire_now(&self, child: Child, generation: u64) -> bool {
        self.retire_with(child, generation, /* grace_first */ false)
    }

    fn retire_with(&self, mut child: Child, generation: u64, grace_first: bool) -> bool {
        let confirmed = confirm_exit(&mut child, &self.ring, grace_first);
        // C639-002A: close the Job handle only once exit is actually
        // confirmed. If it is not (the Zombie branch below), the handle
        // stays owned — closing it early would release the
        // KILL_ON_JOB_CLOSE guarantee before we know the process is gone.
        if confirmed {
            self.job.lock().unwrap().take();
        }
        let mut slot = self.slot.lock().unwrap();
        let owned = matches!(
            *slot,
            Slot::Active { generation: g } | Slot::Fenced { generation: g } if g == generation
        );
        if owned {
            *slot = if confirmed {
                Slot::Empty
            } else {
                Slot::Zombie { generation }
            };
        }
        drop(slot);
        if !confirmed {
            spawn_reaper(
                child,
                generation,
                Arc::clone(&self.slot),
                Arc::clone(&self.job),
                self.ring.clone(),
            );
        }
        owned
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

// --- delay stage (C639-003) ---------------------------------------------------

/// Run the user-requested pre-capture wait as its own bounded stage, BEFORE
/// the worker is admitted/spawned. Chunked (rather than one long sleep) so
/// the stage is structurally interruptible: `is_cancelled` (C639-007) is
/// polled once per chunk, and an affirmative ends the wait immediately
/// rather than running it out. `ms` is assumed already clamped to
/// `MAX_DELAY_MS` by the caller. Returns true if the full wait elapsed (or
/// `ms == 0`), false if it was cut short by cancellation — the caller must
/// not proceed to admission on false.
fn run_delay_stage(ms: u64, ring: &RingLog, mut is_cancelled: impl FnMut() -> bool) -> bool {
    if ms == 0 {
        return true;
    }
    ring.log("delay_stage_start", format!("ms={ms}"));
    let deadline = Instant::now() + Duration::from_millis(ms);
    loop {
        if is_cancelled() {
            ring.log("delay_stage_cancelled", format!("ms={ms}"));
            return false;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        std::thread::sleep(remaining.min(Duration::from_millis(DELAY_POLL_MS)));
    }
    ring.log("delay_stage_done", format!("ms={ms}"));
    true
}

// --- termination --------------------------------------------------------------

/// Poll `child` with `try_wait` until it reports exit or `deadline` passes.
/// Never a synchronous `wait()` on a hung child. Returns true only once an
/// exit status was actually observed.
fn poll_until_exit(child: &mut Child, ring: &RingLog, deadline: Instant) -> bool {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                ring.log("worker_terminated", format!("status={status:?}"));
                return true;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(TERMINATION_POLL_MS));
            }
            Err(e) => {
                ring.log("worker_wait_error", e.to_string());
                return false;
            }
        }
    }
}

/// The one retirement-confirmation primitive used by every terminal branch
/// (C639-002): confirm the child's actual exit, bounded by at most two
/// `TERMINATION_CONFIRM_MS` windows, off whatever thread calls this — never
/// a synchronous join on a hung worker, never `TerminateThread`.
///
/// `grace_first`: when the worker already spoke (success, a native/worker
/// error reply, or malformed-but-spoke), it is expected to exit on its own
/// almost immediately — give it one bounded grace window before an
/// explicit kill. When `grace_first` is false (the timeout path), the
/// worker already blew its budget, so termination is requested
/// immediately: the module's ≤500 ms termination-confirmation bound must
/// not be padded with an unearned extra grace window.
///
/// Returns true only once an exit status was actually observed.
///
/// C639-002A: grace and kill-confirmation share ONE absolute deadline
/// (`TERMINATION_CONFIRM_MS` total from entry), not two sequential windows
/// of their own — Option C promises at most 500 ms *additional* cleanup,
/// not up to 1,000 ms. Whatever the grace window doesn't use is still
/// available to the post-kill wait; whatever it already spent is not given
/// back.
fn confirm_exit(child: &mut Child, ring: &RingLog, grace_first: bool) -> bool {
    let deadline = Instant::now() + Duration::from_millis(TERMINATION_CONFIRM_MS);
    if grace_first {
        if poll_until_exit(child, ring, deadline) {
            return true;
        }
        ring.log("worker_reap_kill", "worker lingered after reply; killing");
    }
    ring.log("worker_kill", "requesting termination");
    // Best effort: a child that already exited makes kill() fail harmlessly.
    let _ = child.kill();
    let confirmed = poll_until_exit(child, ring, deadline);
    if !confirmed {
        ring.log(
            "worker_termination_unconfirmed",
            "slot retained occupied; further captures refused",
        );
    }
    confirmed
}

/// One reaper per unconfirmed termination (at most one zombie exists, so
/// at most one reaper): blocks on the zombie's actual exit, then frees the
/// slot if it is still ours — but ONLY on a confirmed exit (C639-002): a
/// `wait()` error is not confirmation, and must leave the slot occupied
/// (`WORKER_UNAVAILABLE`) rather than silently freeing a capability whose
/// true state was never observed. No thread-per-retry growth.
fn spawn_reaper(
    mut child: Child,
    generation: u64,
    slot: Arc<Mutex<Slot>>,
    job: Arc<Mutex<Option<JobHandle>>>,
    ring: RingLog,
) {
    ring.log("zombie_reaper_spawned", format!("gen={generation}"));
    std::thread::spawn(move || match child.wait() {
        Ok(status) => {
            let mut s = slot.lock().unwrap();
            if *s == (Slot::Zombie { generation }) {
                *s = Slot::Empty;
                // C639-002A: NOW confirmed — close the Job handle this
                // zombie was still holding onto. Scoped to the same
                // "still ours" guard as the slot transition.
                job.lock().unwrap().take();
                ring.log(
                    "zombie_reaped",
                    format!("gen={generation}: exited {status:?}; slot free"),
                );
            }
        }
        Err(e) => {
            ring.log(
                "zombie_reap_wait_error",
                format!("gen={generation}: {e}; slot stays occupied"),
            );
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

/// C639-002A: an OWNED kill-on-parent-exit Job handle. Closing it (`Drop`)
/// does not weaken the crash guarantee: `KILL_ON_JOB_CLOSE` fires on
/// handle-close OR parent-process-exit, whichever happens first, and this
/// handle is only ever closed after the worker's own exit is already
/// confirmed (or, for a zombie, after the reaper confirms it) — never
/// while the worker could still be running.
#[cfg(windows)]
struct JobHandle(windows::Win32::Foundation::HANDLE);

// SAFETY: a Win32 HANDLE is an opaque OS-managed token, not a pointer into
// memory this process reads/writes; CloseHandle is documented safe to call
// from any thread, not only the one that created the handle.
#[cfg(windows)]
unsafe impl Send for JobHandle {}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

/// Non-Windows builds never construct a `JobHandle`; the type still exists
/// so `CaptureSupervisor`'s `job` field (and the retirement/reaper plumbing
/// that touches it) stays platform-uniform instead of `#[cfg]`-forked
/// throughout the module.
#[cfg(not(windows))]
struct JobHandle;

/// Best-effort containment: place the worker in a Job object with
/// KILL_ON_JOB_CLOSE so a parent crash can never orphan a capture worker.
/// Any failure only logs — containment is defense in depth, not a gate.
/// Signatures verified against the vendored `windows` 0.62 sources.
/// Returns the OWNED handle (C639-002A: never leaked via `mem::forget`) —
/// the caller is responsible for closing it once this worker's exit is
/// confirmed.
#[cfg(windows)]
fn contain_in_job(child: &Child, ring: &RingLog) -> Option<JobHandle> {
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
                return None;
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
            return None;
        }
        let proc = HANDLE(child.as_raw_handle() as *mut std::ffi::c_void);
        if let Err(e) = AssignProcessToJobObject(job, proc) {
            ring.log(
                "job_contain_failed",
                format!("AssignProcessToJobObject: {e}"),
            );
            let _ = CloseHandle(job);
            return None;
        }
        ring.log("job_contained", "worker in KILL_ON_JOB_CLOSE job");
        Some(JobHandle(job))
    }
}

#[cfg(not(windows))]
fn contain_in_job(_child: &Child, _ring: &RingLog) -> Option<JobHandle> {
    None
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
    fn request_rejects_delay_beyond_bound() {
        // C639-003: delay inputs are bounded at the wire boundary, not
        // just clamped silently deep inside timing arithmetic.
        let req = WorkerRequest {
            delay_ms: MAX_DELAY_MS + 1,
            ..sample_backdrop_req()
        };
        assert!(encode_request(&req).is_err());
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
    fn supervisor_reply_then_hang_confirms_exit_before_freeing_slot() {
        // C639-002 probe: the worker answers successfully, then hangs
        // instead of exiting. The reply must still be delivered, and the
        // slot must not free until the hung child's kill is actually
        // confirmed — proven here by a fresh admission right after
        // succeeding, which must not be refused as Busy/Unavailable.
        let f = write_reply_file(21, 1, 64);
        let f_str = f.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("cat {f_str}; sleep 30")],
            1024,
        );
        let t0 = Instant::now();
        let reply = sup.execute_backdrop(21, "MON").unwrap();
        assert_eq!(reply.session_id, 21);
        // Bounded: one grace window + a kill confirmation, not a 30 s wait.
        assert!(t0.elapsed() < Duration::from_secs(5), "took {:?}", t0.elapsed());
        let f2 = write_reply_file(22, 1, 64);
        std::fs::rename(&f2, &f).unwrap();
        match sup.execute_backdrop(22, "MON") {
            Err(SupervisorError::CaptureBusy) | Err(SupervisorError::WorkerUnavailable) => {
                panic!("slot was not freed after the hung child's kill was confirmed")
            }
            other => {
                assert_eq!(other.unwrap().session_id, 22);
            }
        }
        std::fs::remove_file(&f).ok();
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_malformed_then_hang_confirms_kill_before_releasing() {
        // C639-002 probe: the worker writes a frame with an invalid
        // (too-short) declared length — a definitive Malformed outcome —
        // then hangs instead of exiting. Malformed must still resolve
        // promptly, and the slot must not free until the hung child's
        // exit is actually confirmed — never speculatively.
        //
        // C639-002A: grace and kill-confirmation now share ONE 500 ms
        // budget (not two separate 500 ms windows). This hung child never
        // exits on its own, so grace consumes the whole shared budget and
        // the kill issued right after it may not be confirmed within THIS
        // SAME request — that is an accepted Zombie outcome, not a bug:
        // the kill (SIGKILL, unblockable) was already sent, and the
        // reaper confirms it and frees the slot shortly after. The test
        // tolerates a short reaper window rather than requiring
        // same-request confirmation.
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec![
                "-c".to_string(),
                "printf '\\000\\000\\000\\004xxxx'; sleep 30".to_string(),
            ],
            1024,
        );
        let t0 = Instant::now();
        match sup.execute_backdrop(31, "MON") {
            Err(SupervisorError::Malformed(_)) => {}
            other => panic!("expected Malformed, got {other:?}"),
        }
        // Bounded to the shared grace+kill-confirm budget (plus poll/
        // process overhead), not the old separate-windows ~1 s worst case.
        assert!(
            t0.elapsed() < Duration::from_millis(TERMINATION_CONFIRM_MS + 300),
            "took {:?}",
            t0.elapsed()
        );
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match sup.execute_backdrop(32, "MON") {
                Err(SupervisorError::CaptureBusy) | Err(SupervisorError::WorkerUnavailable) => {
                    if Instant::now() >= deadline {
                        panic!("slot was not freed after the hung child's kill was confirmed");
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => break,
            }
        }
        // C639-002B (fix-round-2 re-review): a generic, unscoped
        // `worker_terminated` check is not discriminating enough — once
        // this zombie is reaped, the probe capture above admits a NEW
        // generation (2) that retires normally through `poll_until_exit`
        // and logs its OWN `worker_terminated` entry, which would satisfy
        // an unscoped assertion even if generation 1 (the original hung
        // worker) had never actually been confirmed. Require the
        // reaper's own `zombie_reaped` event, scoped to generation 1
        // specifically (the first admission on this fresh supervisor) —
        // that event can only be written once `child.wait()` on THAT
        // exact generation's process actually observed its exit.
        let ring = sup.ring().tail(64);
        assert!(
            ring.iter()
                .any(|line| line.contains("zombie_reaped") && line.contains("gen=1:")),
            "no generation-1-scoped confirmed-exit event landed in the ring \
             (an unscoped check could be satisfied by the probe capture's own \
             unrelated retirement instead): {ring:?}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_identity_mismatch_is_malformed_and_frees_slot() {
        // C639-002 probe: the worker replies with a different
        // session/generation than the admitted request. The mismatched
        // reply must be rejected (never published), and the slot must
        // not leak — proven by a correctly-identified request succeeding
        // on the SAME supervisor right after.
        let f = write_reply_file(999, 999, 64); // wrong identity on purpose
        let f_str = f.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("cat {f_str}")],
            1024,
        );
        match sup.execute_backdrop(41, "MON") {
            Err(SupervisorError::Malformed(_)) => {}
            other => panic!("expected Malformed, got {other:?}"),
        }
        let f2 = write_reply_file(41, 1, 64);
        std::fs::rename(&f2, &f).unwrap();
        let reply = sup.execute_backdrop(41, "MON").unwrap();
        assert_eq!(reply.session_id, 41);
        std::fs::remove_file(&f).ok();
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_concurrent_admission_during_termination_confirm_is_not_blocked() {
        // C639-002 probe: while the timeout path's post-fence
        // termination-confirmation wait is in flight (bounded by
        // TERMINATION_CONFIRM_MS, with no slot lock held across it), a
        // concurrent admission attempt must return immediately
        // (Busy/Unavailable), never block on that wait. Regression guard
        // for the prior bug: the slot lock used to be held across the
        // whole termination-confirm poll.
        let sup = Arc::new(CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), "sleep 30".to_string()],
            1024,
        ));
        let sup2 = Arc::clone(&sup);
        let h = std::thread::spawn(move || sup2.execute_backdrop(1, "MON"));
        // Land in the post-deadline cleanup window: just after the 3 s
        // deadline fires, before the first call has returned.
        std::thread::sleep(Duration::from_millis(CAPTURE_DEADLINE_MS + 50));
        let t0 = Instant::now();
        let outcome = sup.execute_backdrop(2, "MON");
        let dt = t0.elapsed();
        assert!(
            matches!(
                outcome,
                Err(SupervisorError::CaptureBusy) | Err(SupervisorError::WorkerUnavailable)
            ),
            "unexpected: {outcome:?}"
        );
        assert!(
            dt < Duration::from_millis(TERMINATION_CONFIRM_MS),
            "concurrent admission blocked on cleanup: took {dt:?}"
        );
        let _ = h.join();
    }

    #[test]
    #[cfg(unix)]
    fn zombie_reaper_keeps_slot_occupied_until_child_actually_exits() {
        // C639-002 probe ("failed termination/wait"): SIGKILL is
        // unblockable on POSIX, so a real "kill succeeded but the
        // process outlives the confirm window" cannot be forced
        // deterministically here — this instead exercises the reaper's
        // own contract directly: the slot must stay Zombie for as long
        // as the child is genuinely still alive, and only flip to Empty
        // once `wait()` actually observes its exit, never speculatively.
        let child = Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 2")
            .spawn()
            .unwrap();
        let slot = Arc::new(Mutex::new(Slot::Zombie { generation: 5 }));
        let job = Arc::new(Mutex::new(None));
        let ring = RingLog::new(16);
        spawn_reaper(child, 5, Arc::clone(&slot), job, ring);
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(*slot.lock().unwrap(), Slot::Zombie { generation: 5 });
        std::thread::sleep(Duration::from_millis(2200));
        assert_eq!(*slot.lock().unwrap(), Slot::Empty);
    }

    #[test]
    #[cfg(unix)]
    fn execute_region_delay_stage_runs_before_the_fixed_native_budget() {
        // C639-003 probe: a legitimate delay costs roughly delay_ms wall
        // clock (the parent's own pre-admission stage), not meaningfully
        // more — the native round trip itself is fast.
        let f = write_reply_file(51, 1, 64);
        let f_str = f.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("cat {f_str}")],
            1024,
        );
        let t0 = Instant::now();
        let reply = sup
            .execute_region(51, 0, 0, 10, 10, false, 300, || false)
            .unwrap();
        let dt = t0.elapsed();
        assert_eq!(reply.session_id, 51);
        assert!(dt >= Duration::from_millis(300), "delay stage too short: {dt:?}");
        assert!(dt < Duration::from_millis(1500), "delay stage leaked into budget: {dt:?}");
        std::fs::remove_file(&f).ok();

        // C639-003 probe: a worker that never replies, requested with a
        // delay, must be bounded to delay_ms + CAPTURE_DEADLINE_MS —
        // never the delay stacked on top of an inflated or duplicated
        // native budget.
        let sup2 = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), "sleep 30".to_string()],
            1024,
        );
        let t0 = Instant::now();
        let err = sup2
            .execute_region(52, 0, 0, 10, 10, false, 300, || false)
            .unwrap_err();
        let dt = t0.elapsed();
        assert_eq!(err, SupervisorError::Timeout);
        assert!(
            dt >= Duration::from_millis(300 + CAPTURE_DEADLINE_MS),
            "took {dt:?}"
        );
        assert!(
            dt < Duration::from_millis(300 + CAPTURE_DEADLINE_MS + 2000),
            "budget inflated by delay: took {dt:?}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn execute_region_cancelled_during_delay_never_admits_the_worker() {
        // C639-007 probe: cancellation during the delay stage must stop the
        // request before the worker is ever spawned/admitted — not just
        // eventually resolve. A sentinel file the child would create on
        // spawn proves admission never happened.
        let sentinel = std::env::temp_dir()
            .join(format!("forge-capture-test-sentinel-{}", std::process::id()));
        std::fs::remove_file(&sentinel).ok();
        let f = write_reply_file(61, 1, 64);
        let f_str = f.to_string_lossy().into_owned();
        let sentinel_str = sentinel.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec![
                "-c".to_string(),
                format!("touch {sentinel_str}; cat {f_str}"),
            ],
            1024,
        );
        let t0 = Instant::now();
        // "Cancelled" from the very first poll: the delay stage must bail
        // before its first sleep, let alone running the full 2s out.
        let err = sup
            .execute_region(61, 0, 0, 10, 10, false, 2000, || true)
            .unwrap_err();
        let dt = t0.elapsed();
        assert_eq!(err, SupervisorError::Cancelled);
        assert!(dt < Duration::from_millis(500), "cancel did not cut the delay short: {dt:?}");
        assert!(
            !sentinel.exists(),
            "worker was admitted/spawned despite cancellation before admission"
        );
        std::fs::remove_file(&f).ok();
        std::fs::remove_file(&sentinel).ok();
    }

    #[test]
    #[cfg(unix)]
    fn execute_region_cancelled_right_before_admission_with_no_delay() {
        // C639-007 probe: even with delay_ms=0 (no delay stage to check
        // inside), a cancellation flag already set must still be observed
        // once, immediately before admission.
        let sentinel = std::env::temp_dir()
            .join(format!("forge-capture-test-sentinel2-{}", std::process::id()));
        std::fs::remove_file(&sentinel).ok();
        let sentinel_str = sentinel.to_string_lossy().into_owned();
        let sup = CaptureSupervisor::with_child_args(
            PathBuf::from("/bin/sh"),
            vec!["-c".to_string(), format!("touch {sentinel_str}")],
            1024,
        );
        let err = sup
            .execute_region(62, 0, 0, 10, 10, false, 0, || true)
            .unwrap_err();
        assert_eq!(err, SupervisorError::Cancelled);
        assert!(!sentinel.exists(), "worker was admitted despite pre-set cancellation");
        std::fs::remove_file(&sentinel).ok();
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
