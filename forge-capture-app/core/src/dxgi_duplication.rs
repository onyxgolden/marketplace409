//! DXGI Desktop Duplication backend — slice DXGI-1.
//!
//! Wrapper, lifecycle, and single-output acquisition, per the DXGI brief
//! (`results/chatgpt/capture-dxgi-duplication-implementation-brief-2026-10-26.md`).
//!
//! **No production dispatch change.** [`native`](crate::native) still owns
//! capture dispatch; nothing in this crate calls into this module yet.
//! DXGI-3 wires dispatch; DXGI-2 adds topology/rotation/multi-output.
//!
//! Layout note: the brief tentatively placed this at `native/dxgi_duplication.rs`.
//! It lives here as a sibling module instead, so DXGI-1 does not relocate the
//! large `native.rs` file; the module path can move in DXGI-3 wiring if
//! reviewers prefer the brief's path.
//!
//! Structure, so the acceptance floor is testable on any host:
//!
//! - Pure logic (limits, pitch-aware BGRA→RGBA conversion, HRESULT
//!   classification, the retry state machine, the RAII frame guard) compiles
//!   everywhere and is unit-tested here.
//! - The real COM/D3D11 backend lives behind `#[cfg(windows)]` in
//!   [`DxgiCaptureContext`]. On non-Windows hosts it does not exist; the
//!   pure pieces still compile and test.
//! - The retry loop runs over the [`DuplicationBackend`] trait, so tests use
//!   a scripted mock backend and the real backend is one implementation.
//!
//! Ordering guarantees (brief, "Acquire, copy, release, convert"):
//!
//! 1. `AcquireNextFrame` with a bounded timeout.
//! 2. Copy into a CPU-readable staging texture.
//! 3. `ReleaseFrame` immediately after the GPU copy is enqueued — before CPU
//!    mapping, conversion, or artifact I/O. [`FrameGuard`] calls it on every
//!    success/error/unwind path; the real backend also releases explicitly
//!    before mapping.
//! 4. Map, honor row pitch, convert BGRA→RGBA, unmap.
//!
//! Recovery (one bounded recreate, never unbounded):
//!
//! - `ACCESS_LOST` / device removed: invalidate, rebuild the full
//!   device/context/duplication set once, retry the whole request; a
//!   second loss is a terminal [`DxgiCaptureOutcome::Retryable`]. A
//!   removed device is never a valid recovery foundation, so a
//!   recreate that only rebuilt duplication on it could not recover
//!   (DXGI1-004A).
//! - `WAIT_TIMEOUT`: "no new desktop update yet," not failure. Retried until
//!   the total request deadline; DXGI-1 keeps no cached frame, so a deadline
//!   expiry is a terminal retryable, never a stale frame.
//! - Protected/secure content: explicit [`DxgiCaptureOutcome::ProtectedOrSecure`],
//!   never a bypass attempt, never black pixels labeled success.
//!
//! Limits (brief: no parallel limit model): at most 16,384 pixels per side
//! and 128 MiB decoded raster, enforced with checked arithmetic before any
//! allocation sized from the frame.
//!
//! Rotation: DXGI-1 captures identity-rotation outputs only. A non-identity
//! rotation is an explicit [`DxgiCaptureOutcome::Unavailable`] naming DXGI-2;
//! rotation handling is DXGI-2's scope and is never silently ignored.

use crate::coords::RectI;
use std::time::{Duration, Instant};

/// Artifact limits shared by every DXGI capture (brief: no parallel model).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DxgiLimits {
    /// Maximum pixels per side (brief: 16,384).
    pub max_side_px: u32,
    /// Maximum decoded raster bytes (brief: 128 MiB).
    pub max_raster_bytes: u64,
    /// Per-attempt `AcquireNextFrame` timeout.
    pub acquire_timeout_ms: u32,
    /// Total request deadline; `WAIT_TIMEOUT` retries stop here.
    pub total_deadline_ms: u32,
}

impl Default for DxgiLimits {
    fn default() -> Self {
        Self {
            max_side_px: 16_384,
            max_raster_bytes: 128 * 1024 * 1024,
            acquire_timeout_ms: 250,
            total_deadline_ms: 2_000,
        }
    }
}

/// Per-frame metadata from `DXGI_OUTDUPL_FRAME_INFO`, carried through
/// the capture outcome so hardware harnesses can log it per acquire.
///
/// DXGI1 fix round 3: the mask misfire (first capture Frame, later
/// captures ProtectedOrSecure while a raw probe reads mask 0) cannot be
/// root-caused from outcomes alone — the discriminating evidence is
/// these fields, per acquire, through the wrapper itself. They are
/// diagnostic only: they never change the fail-closed mask rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DxgiFrameMetadata {
    /// Raw `ProtectedContentMaskedOut` value (0 = unmasked).
    pub protected_content_masked_out: i32,
    /// Raw `AccumulatedFrames` count.
    pub accumulated_frames: u32,
    /// Raw `RectsCoalesced` value (0/1).
    pub rects_coalesced: i32,
    /// Raw `LastPresentTime` (QueryPerformanceCounter ticks; 0 = no
    /// present since the last acquire).
    pub last_present_time: i64,
    /// Raw `TotalMetadataBufferSize`.
    pub total_metadata_size: u32,
    /// Raw `PointerShapeBufferSize`.
    pub pointer_shape_size: u32,
}

/// One captured frame: RGBA bytes (row-major, no pitch padding).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DxgiFrame {
    pub width: u32,
    pub height: u32,
    /// Exactly `width * height * 4` bytes.
    pub rgba: Vec<u8>,
    /// Frame metadata from the acquire that produced this frame.
    pub frame_info: DxgiFrameMetadata,
}

/// DXGI rotation, as reported by the output descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DxgiRotation {
    Identity,
    Rotate90,
    Rotate180,
    Rotate270,
    Unspecified,
}

/// One attached desktop output, as enumerated (DXGI-1: single-output only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputInfo {
    /// Enumeration position (never used as monitor identity by callers).
    pub index: usize,
    /// OS device name for the output.
    pub device_name: String,
    /// Adapter LUID: (low part, high part).
    pub adapter_luid: (u32, i32),
    /// Physical desktop rectangle (may have a negative origin).
    pub rect: RectI,
    pub rotation: DxgiRotation,
}

/// Typed result of one capture attempt (brief's `DxgiCaptureOutcome`).
#[derive(Debug)]
pub enum DxgiCaptureOutcome {
    Frame(DxgiFrame),
    /// Backend unavailable for this session/mode (RDP, VM, no duplication
    /// support, ...). Callers fall back to GDI per the brief.
    Unavailable(String),
    /// Bounded retries exhausted or a transient failure the caller may
    /// retry/fall back on. Never a partial image.
    Retryable(String),
    /// Secure desktop / protected content. Never bypassed, never black
    /// pixels labeled success.
    ProtectedOrSecure(String),
}

/// Classified failure of one `AcquireNextFrame` attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DxgiAcquireError {
    AccessLost,
    WaitTimeout,
    Protected,
    SessionDisconnected,
    DeviceRemoved,
    Unavailable(String),
    /// A staging/copy/map stage failed after acquisition. The caller must
    /// invalidate device-dependent state and attempt at most one
    /// whole-request recreate — the same bounded budget as
    /// [`DxgiAcquireError::AccessLost`] / `DeviceRemoved`. A second
    /// stage failure is terminal. This keeps device-loss classification
    /// alive across create/copy/map stages instead of collapsing it to a
    /// bare `Other` that skips recovery.
    StageFailed(String),
    Other(String),
}

// DXGI HRESULT values (winerror.h / dxgi.h). A Windows-only test asserts
// these equal the `windows` crate's constants, so a wrong literal here
// fails loudly on the Windows target instead of silently misclassifying.
const DXGI_ERROR_DEVICE_REMOVED: u32 = 0x887A_0005;
const DXGI_ERROR_UNSUPPORTED: u32 = 0x887A_0004;
const DXGI_ERROR_ACCESS_LOST: u32 = 0x887A_0026;
const DXGI_ERROR_WAIT_TIMEOUT: u32 = 0x887A_0027;
const DXGI_ERROR_SESSION_DISCONNECTED: u32 = 0x887A_0028;
const DXGI_ERROR_NOT_CURRENTLY_AVAILABLE: u32 = 0x887A_0022;

/// Classify a staging/copy/map-stage HRESULT, preserving device-loss
/// classification across stages.
///
/// Device-loss, session, protected, and unavailable classifications pass
/// through unchanged so the caller can recreate (or classify) correctly.
/// Any other HRESULT becomes [`DxgiAcquireError::StageFailed`] — never a
/// bare `Other` that would skip the one bounded recreate.
pub fn classify_stage_error(code: i32) -> DxgiAcquireError {
    match classify_hresult(code) {
        DxgiAcquireError::Other(msg) => DxgiAcquireError::StageFailed(msg),
        classified => classified,
    }
}

/// Fail-closed protected-content rule for a real acquired frame.
///
/// `DXGI_OUTDUPL_FRAME_INFO::ProtectedContentMaskedOut` is a BOOL: any
/// nonzero value means masked protected pixels are present, and the frame
/// must be classified [`DxgiAcquireError::Protected`] — never converted
/// and returned as an ordinary `Frame`. There is no bypass fallback:
/// the caller maps `Protected` to
/// [`DxgiCaptureOutcome::ProtectedOrSecure`].
pub fn protected_from_frame_info(masked_out: bool) -> Option<DxgiAcquireError> {
    if masked_out {
        Some(DxgiAcquireError::Protected)
    } else {
        None
    }
}

/// Checked byte count of a mapped staging buffer, before allocating it.
///
/// `row_pitch * height` with checked arithmetic (overflow is a typed
/// refusal, never a saturating wrap into a maximum-size request), and the
/// result must fit the raster budget so the host allocation is bounded
/// before it happens. The caller refuses on `Err` without allocating.
pub fn checked_mapped_bytes(
    row_pitch: usize,
    height: u32,
    max_raster_bytes: u64,
) -> Result<usize, DxgiLimitError> {
    let bytes = row_pitch
        .checked_mul(height as usize)
        .ok_or(DxgiLimitError::Overflow)?;
    if bytes as u64 > max_raster_bytes {
        return Err(DxgiLimitError::RasterTooLarge {
            bytes: bytes as u64,
            max: max_raster_bytes,
        });
    }
    Ok(bytes)
}

/// Per-attempt `AcquireNextFrame` timeout under the total request deadline.
///
/// Returns `None` when no budget remains (the caller must stop without
/// acquiring again). Otherwise returns
/// `min(acquire_timeout_ms, remaining_ms)`, so an attempt starting just
/// before the deadline can never block for another full per-attempt
/// timeout past it. Pure over [`Duration`] so tests use injected values
/// instead of wall-clock flakiness.
///
/// The remaining budget is FLOORED to whole milliseconds because
/// `AcquireNextFrame` takes whole milliseconds: flooring guarantees the
/// passed timeout never exceeds the remaining budget. When less than
/// one whole millisecond remains, this returns `None` — a 1ms attempt
/// would block past the absolute deadline. The caller
/// ([`capture_single_output`]) grants at most one final nonblocking
/// 0ms poll per request on that `None`, so an already-ready frame can
/// still be taken without ever blocking past the deadline (DXGI1-005A).
/// The hard total bound holds exactly; the cost is at most 1ms of
/// unclaimed blocking budget.
pub fn attempt_timeout_ms(limits: &DxgiLimits, elapsed: Duration) -> Option<u32> {
    let deadline = Duration::from_millis(limits.total_deadline_ms as u64);
    let remaining = deadline.checked_sub(elapsed)?;
    let remaining_ms = remaining.as_millis();
    if remaining_ms == 0 {
        return None;
    }
    let capped = (limits.acquire_timeout_ms as u128).min(remaining_ms);
    Some(capped as u32)
}

/// Classify a raw HRESULT from `AcquireNextFrame` (or a neighboring call).
pub fn classify_hresult(code: i32) -> DxgiAcquireError {
    match code as u32 {
        DXGI_ERROR_ACCESS_LOST => DxgiAcquireError::AccessLost,
        DXGI_ERROR_WAIT_TIMEOUT => DxgiAcquireError::WaitTimeout,
        DXGI_ERROR_SESSION_DISCONNECTED => DxgiAcquireError::SessionDisconnected,
        DXGI_ERROR_DEVICE_REMOVED => DxgiAcquireError::DeviceRemoved,
        DXGI_ERROR_UNSUPPORTED | DXGI_ERROR_NOT_CURRENTLY_AVAILABLE => {
            DxgiAcquireError::Unavailable(format!(
                "duplication unsupported for this session (HRESULT 0x{code:08X})"
            ))
        }
        _ => DxgiAcquireError::Other(format!("DXGI call failed (HRESULT 0x{code:08X})")),
    }
}

/// Limit failure, checked before any frame-sized allocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DxgiLimitError {
    Empty,
    SideTooLarge { side: u32, max: u32 },
    RasterTooLarge { bytes: u64, max: u64 },
    Overflow,
}

impl std::fmt::Display for DxgiLimitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DxgiLimitError::Empty => write!(f, "frame is empty"),
            DxgiLimitError::SideTooLarge { side, max } => {
                write!(f, "frame side {side}px exceeds the {max}px limit")
            }
            DxgiLimitError::RasterTooLarge { bytes, max } => {
                write!(f, "frame raster {bytes} bytes exceeds the {max} byte limit")
            }
            DxgiLimitError::Overflow => write!(f, "frame size arithmetic overflowed"),
        }
    }
}

/// Validate dimensions against [`DxgiLimits`] with checked arithmetic.
/// Returns the exact RGBA byte count on success. Never allocates.
pub fn validate_limits(
    width: u32,
    height: u32,
    limits: &DxgiLimits,
) -> Result<usize, DxgiLimitError> {
    if width == 0 || height == 0 {
        return Err(DxgiLimitError::Empty);
    }
    if width > limits.max_side_px {
        return Err(DxgiLimitError::SideTooLarge {
            side: width,
            max: limits.max_side_px,
        });
    }
    if height > limits.max_side_px {
        return Err(DxgiLimitError::SideTooLarge {
            side: height,
            max: limits.max_side_px,
        });
    }
    let bytes = (width as u64)
        .checked_mul(height as u64)
        .and_then(|px| px.checked_mul(4))
        .ok_or(DxgiLimitError::Overflow)?;
    if bytes > limits.max_raster_bytes {
        return Err(DxgiLimitError::RasterTooLarge {
            bytes,
            max: limits.max_raster_bytes,
        });
    }
    Ok(bytes as usize)
}

/// Convert a BGRA staging buffer to packed RGBA, honoring row pitch.
///
/// `row_pitch` is the staging texture's bytes per row and may exceed
/// `width * 4` (driver padding). Returns `None` when the buffer is too
/// short, the pitch is narrower than one row, or dimensions overflow —
/// never a partial frame.
///
/// Alpha is forced opaque, matching the GDI path in [`native`](crate::native):
/// desktop surfaces do not carry meaningful per-pixel alpha for the
/// artifact contract, and a zero alpha would encode as a transparent PNG.
pub fn convert_bgra_to_rgba_pitched(
    src: &[u8],
    width: u32,
    height: u32,
    row_pitch: usize,
) -> Option<Vec<u8>> {
    if width == 0 || height == 0 {
        return None;
    }
    let row_bytes = (width as usize).checked_mul(4)?;
    if row_pitch < row_bytes {
        return None;
    }
    let needed = row_pitch
        .checked_mul(height as usize - 1)?
        .checked_add(row_bytes)?;
    if src.len() < needed {
        return None;
    }
    let mut out = vec![0u8; row_bytes * height as usize];
    for row in 0..height as usize {
        let src_row = &src[row * row_pitch..row * row_pitch + row_bytes];
        let dst_row = &mut out[row * row_bytes..(row + 1) * row_bytes];
        let (src_px, _) = src_row.as_chunks::<4>();
        let (dst_px, _) = dst_row.as_chunks_mut::<4>();
        for (s, d) in src_px.iter().zip(dst_px.iter_mut()) {
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = 255;
        }
    }
    Some(out)
}

/// Crop a rectangle out of a packed RGBA frame. Returns `None` when the
/// rectangle is empty or not fully inside the frame.
fn crop_frame(frame: &DxgiFrame, x: u32, y: u32, w: u32, h: u32) -> Option<DxgiFrame> {
    if w == 0 || h == 0 {
        return None;
    }
    if x.checked_add(w)? > frame.width || y.checked_add(h)? > frame.height {
        return None;
    }
    if frame.rgba.len() != frame.width as usize * frame.height as usize * 4 {
        return None;
    }
    let src_stride = frame.width as usize * 4;
    let dst_stride = w as usize * 4;
    let mut rgba = vec![0u8; dst_stride * h as usize];
    for row in 0..h as usize {
        let src_off = ((y as usize + row) * src_stride) + x as usize * 4;
        let dst_off = row * dst_stride;
        rgba[dst_off..dst_off + dst_stride]
            .copy_from_slice(&frame.rgba[src_off..src_off + dst_stride]);
    }
    Some(DxgiFrame {
        width: w,
        height: h,
        rgba,
        frame_info: frame.frame_info,
    })
}

/// RAII frame guard: calls its release exactly once, on explicit
/// [`FrameGuard::release`], on scope exit, or on unwind.
///
/// The real backend's closure calls `IDXGIOutputDuplication::ReleaseFrame`;
/// the release result is deliberately ignored — a guard must never panic
/// or fail the capture path while unwinding.
pub struct FrameGuard {
    release: Option<Box<dyn FnOnce() + Send>>,
}

impl FrameGuard {
    pub fn new<F: FnOnce() + Send + 'static>(release: F) -> Self {
        Self {
            release: Some(Box::new(release)),
        }
    }

    /// Release now; the later drop becomes a no-op. Takes `&mut self` so
    /// the (already released) guard can still be returned to a caller.
    pub fn release(&mut self) {
        if let Some(release) = self.release.take() {
            release();
        }
    }

    pub fn is_released(&self) -> bool {
        self.release.is_none()
    }
}

impl Drop for FrameGuard {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            release();
        }
    }
}

/// One acquired staging surface: raw BGRA bytes plus their pitch.
#[derive(Debug, Clone)]
pub struct AcquiredPixels {
    pub width: u32,
    pub height: u32,
    pub row_pitch: usize,
    pub bgra: Vec<u8>,
    /// Frame metadata from the acquire that produced these pixels.
    pub frame_info: DxgiFrameMetadata,
}

/// The duplication session behind [`capture_single_output`].
///
/// The real backend is [`DxgiCaptureContext`] (Windows only); tests use a
/// scripted mock. `acquire` returns the guard alongside the pixels: the
/// caller drops it immediately after the GPU copy, before conversion —
/// the brief's release-before-mapping order.
pub trait DuplicationBackend {
    /// Acquire one frame with a per-attempt timeout already capped by the
    /// caller's total deadline (see [`attempt_timeout_ms`]).
    ///
    /// `limits` is passed into the acquisition boundary so the backend
    /// validates dimensions against them BEFORE creating a staging
    /// texture or allocating a host buffer sized from the frame — never
    /// after. A limit refusal must still release the acquired frame
    /// exactly once.
    fn acquire(
        &mut self,
        timeout_ms: u32,
        limits: &DxgiLimits,
    ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError>;
    /// Invalidate and rebuild the FULL device-dependent resource set
    /// after `ACCESS_LOST` / device removal: a brand-new D3D11 device
    /// and context plus a fresh duplication object, atomically
    /// replacing the old state only on success. Called at most once
    /// per request by [`capture_single_output`]. A recreate that only
    /// rebuilt duplication on the removed device could never recover
    /// (DXGI1-004A); the old device is not a valid recovery foundation.
    fn recreate(&mut self) -> Result<(), DxgiAcquireError>;
}

/// Capture `rect` from one output (DXGI-1: single-output only).
///
/// `rect` must lie fully inside `output.rect`; a rect spanning outputs or
/// outside this output is an explicit [`DxgiCaptureOutcome::Unavailable`]
/// naming DXGI-2, never a partial or shifted image. Non-identity rotation
/// is likewise unavailable in DXGI-1. No frame is ever cached: a
/// `WAIT_TIMEOUT` past the total deadline is terminal, not a stale frame.
/// Real-clock entry point: elapsed time comes from `Instant::now()`.
pub fn capture_single_output<B: DuplicationBackend>(
    backend: &mut B,
    output: &OutputInfo,
    rect: RectI,
    limits: &DxgiLimits,
) -> DxgiCaptureOutcome {
    let start = Instant::now();
    capture_single_output_with_clock(backend, output, rect, limits, move || start.elapsed())
}

/// Deadline loop with an injected elapsed-time source.
///
/// DXGI1 fix round 3: the round-2 deadline tests read wall-clock time
/// and failed on Windows, where the first iteration can measure
/// elapsed == 0 (timer granularity) and issue a 1ms attempt before the
/// 0ms final poll — while Linux measured elapsed > 0 and passed. The
/// loop's deadline behavior must not depend on timer granularity, so
/// tests script elapsed deterministically through this function and
/// production passes the real clock. The loop reads elapsed ONCE per
/// iteration and uses that single value for both the timeout computation
/// and the final-poll/deadline decision, so the boundary is exact
/// rather than sampled twice.
pub fn capture_single_output_with_clock<B: DuplicationBackend, F: FnMut() -> Duration>(
    backend: &mut B,
    output: &OutputInfo,
    rect: RectI,
    limits: &DxgiLimits,
    mut elapsed: F,
) -> DxgiCaptureOutcome {
    if output.rotation != DxgiRotation::Identity {
        return DxgiCaptureOutcome::Unavailable(format!(
            "output rotation {:?} is handled in DXGI-2, not DXGI-1",
            output.rotation
        ));
    }
    if rect.is_empty() {
        return DxgiCaptureOutcome::Unavailable("capture rect is empty".into());
    }
    if rect.x < output.rect.x
        || rect.y < output.rect.y
        || rect.right() > output.rect.right()
        || rect.bottom() > output.rect.bottom()
    {
        return DxgiCaptureOutcome::Unavailable(
            "capture rect spans outputs or lies outside this output (DXGI-2)".into(),
        );
    }
    let mut recreated = false;
    let mut final_poll_done = false;
    loop {
        // Hard total bound: an attempt never blocks past the deadline.
        // When less than one whole millisecond remains, the pure
        // timeout function returns None; the loop then grants at most
        // ONE final nonblocking 0ms poll per request (DXGI1-005A), so
        // an already-ready frame can still be taken without ever
        // blocking past the deadline. After that poll, or once the
        // deadline itself is reached, the loop stops without acquiring.
        // Elapsed is read ONCE per iteration and reused for both the
        // timeout computation and the deadline decision, so the
        // boundary is exact (fix round 3: the old double read let a
        // Windows first iteration at elapsed == 0 issue a 1ms attempt
        // before the 0ms final poll).
        let e = elapsed();
        let timeout_ms = match attempt_timeout_ms(limits, e) {
            Some(t) => t,
            None => {
                let deadline = Duration::from_millis(limits.total_deadline_ms as u64);
                if !final_poll_done && e < deadline {
                    final_poll_done = true;
                    0
                } else {
                    return DxgiCaptureOutcome::Retryable(
                        "no new desktop frame within the total request deadline".into(),
                    );
                }
            }
        };
        match backend.acquire(timeout_ms, limits) {
            Ok((guard, pixels)) => {
                // Release before any CPU conversion work (brief order).
                // The guard still protected the acquire→copy window, and
                // its Drop covers unwind inside `acquire` itself.
                drop(guard);
                if let Err(e) = validate_limits(pixels.width, pixels.height, limits) {
                    return DxgiCaptureOutcome::Unavailable(format!(
                        "acquired frame violates limits: {e}"
                    ));
                }
                let Some(rgba) = convert_bgra_to_rgba_pitched(
                    &pixels.bgra,
                    pixels.width,
                    pixels.height,
                    pixels.row_pitch,
                ) else {
                    return DxgiCaptureOutcome::Retryable(
                        "staging buffer too short or row pitch invalid".into(),
                    );
                };
                let full = DxgiFrame {
                    width: pixels.width,
                    height: pixels.height,
                    rgba,
                    frame_info: pixels.frame_info,
                };
                let ox = (rect.x - output.rect.x) as u32;
                let oy = (rect.y - output.rect.y) as u32;
                return match crop_frame(&full, ox, oy, rect.w as u32, rect.h as u32) {
                    Some(cropped) => DxgiCaptureOutcome::Frame(cropped),
                    None => DxgiCaptureOutcome::Retryable(
                        "crop of acquired frame out of bounds".into(),
                    ),
                };
            }
            Err(DxgiAcquireError::WaitTimeout) => {
                // Stable unchanged desktop: not a failure. Retry until
                // the loop-top deadline check stops us.
            }
            Err(DxgiAcquireError::AccessLost)
            | Err(DxgiAcquireError::DeviceRemoved)
            | Err(DxgiAcquireError::StageFailed(_)) => {
                if recreated {
                    return DxgiCaptureOutcome::Retryable(
                        "duplication lost again after one recreate".into(),
                    );
                }
                match backend.recreate() {
                    Ok(()) => recreated = true,
                    Err(e) => {
                        return DxgiCaptureOutcome::Retryable(format!(
                            "duplication recreate failed: {e:?}"
                        ))
                    }
                }
            }
            Err(DxgiAcquireError::Protected) => {
                return DxgiCaptureOutcome::ProtectedOrSecure(
                    "protected or secure content".into(),
                )
            }
            Err(DxgiAcquireError::SessionDisconnected) => {
                return DxgiCaptureOutcome::Unavailable("session disconnected".into())
            }
            Err(DxgiAcquireError::Unavailable(reason)) => {
                return DxgiCaptureOutcome::Unavailable(reason)
            }
            Err(DxgiAcquireError::Other(msg)) => {
                return DxgiCaptureOutcome::Retryable(msg)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Windows backend: factory/adapter/output enumeration, D3D11 device,
// duplication object, staging copy. Compile-checked for the Windows target;
// runtime behavior needs real Windows GPU/display hardware (same standing
// caveat as `native.rs`'s Windows path).
// ---------------------------------------------------------------------------
#[cfg(windows)]
pub use win_backend::DxgiCaptureContext;

#[cfg(windows)]
mod win_backend {
    use super::{
        checked_mapped_bytes, classify_hresult, classify_stage_error, protected_from_frame_info,
        validate_limits, AcquiredPixels, DxgiAcquireError, DxgiCaptureOutcome, DxgiFrameMetadata,
        DxgiLimits, DxgiRotation, FrameGuard, OutputInfo,
    };
    use crate::coords::RectI;
    use crate::result::CaptureError;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::{Interface, IUnknown};
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::{
        D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
    };
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
        D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
        IDXGIOutputDuplication, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTPUT_DESC,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };

    const RPC_E_CHANGED_MODE: i32 = -2147417850; // 0x80010106 as i32

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..end])
            .to_string_lossy()
            .into_owned()
    }

    /// Best-effort per-monitor DPI awareness, set before enumerating.
    ///
    /// DXGI1 fix round 3: for a DPI-unaware process, `DXGI_OUTPUT_DESC`
    /// coordinates are virtualized, so enumerated rects disagreed with
    /// physical texture pixels across runs (1707x960 vs 2560x1440 at the
    /// same 2560x1440@59 mode) and a second-output bounds check failed
    /// on rects from two enumerations. Per-monitor awareness makes
    /// enumeration return physical pixels consistently. Failure (e.g.
    /// awareness already set by the host) is not an error: enumeration
    /// still proceeds, and any residual mismatch surfaces as the
    /// existing explicit `Unavailable` bounds refusal, never a silent
    /// wrong-region crop.
    fn ensure_dpi_awareness() {
        unsafe {
            let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
    }

    fn rotation_from(desc_rotation: DXGI_MODE_ROTATION) -> DxgiRotation {
        match desc_rotation.0 {
            1 => DxgiRotation::Identity,
            2 => DxgiRotation::Rotate90,
            3 => DxgiRotation::Rotate180,
            4 => DxgiRotation::Rotate270,
            _ => DxgiRotation::Unspecified,
        }
    }

    /// Initialize COM for this thread. Returns true when this call owns the
    /// initialization (and must later `CoUninitialize`); false when COM was
    /// already initialized in another apartment (proceed, do not uninit).
    fn ensure_com() -> Result<bool, CaptureError> {
        match unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
            Ok(()) => Ok(true),
            Err(e) if e.code().0 == RPC_E_CHANGED_MODE => Ok(false),
            Err(e) => Err(CaptureError::NativeApi(format!(
                "CoInitializeEx failed: HRESULT 0x{:08X}",
                e.code().0 as u32
            ))),
        }
    }

    /// Create a fresh D3D11 device + immediate context on `adapter`.
    /// Shared by initial context creation and device-loss recovery, so
    /// recovery rebuilds the same full device set (DXGI1-004A) instead
    /// of reusing a removed device. D3D11CreateDevice takes the base
    /// IDXGIAdapter; the Adapter1 handle stays owned by the caller
    /// (cast only AddRefs it).
    fn create_device(
        adapter: &IDXGIAdapter1,
    ) -> Result<(ID3D11Device, ID3D11DeviceContext), CaptureError> {
        let adapter_base: IDXGIAdapter = adapter.cast().map_err(|e| {
            CaptureError::NativeApi(format!("IDXGIAdapter1::cast to IDXGIAdapter: {e}"))
        })?;
        let mut device: Option<ID3D11Device> = None;
        let mut device_context: Option<ID3D11DeviceContext> = None;
        unsafe {
            D3D11CreateDevice(
                Some(&adapter_base),
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[
                    D3D_FEATURE_LEVEL_11_1,
                    D3D_FEATURE_LEVEL_11_0,
                    D3D_FEATURE_LEVEL_10_1,
                    D3D_FEATURE_LEVEL_10_0,
                ]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut device_context),
            )
        }
        .map_err(|e| CaptureError::NativeApi(format!("D3D11CreateDevice: {e}")))?;
        let device = device.ok_or_else(|| {
            CaptureError::NativeApi("D3D11CreateDevice returned no device".into())
        })?;
        let device_context = device_context.ok_or_else(|| {
            CaptureError::NativeApi("D3D11CreateDevice returned no device context".into())
        })?;
        Ok((device, device_context))
    }

    /// Worker-local DXGI context, bound to one output (DXGI-1).
    ///
    /// Created lazily by the supervised worker and reused on that worker
    /// thread; COM/D3D/DXGI objects never cross process or thread boundaries.
    /// Dropping the context releases the duplication object, staging texture,
    /// device, and (when owned) the COM initialization.
    pub struct DxgiCaptureContext {
        output_info: OutputInfo,
        _adapter: IDXGIAdapter1,
        output1: IDXGIOutput1,
        device: ID3D11Device,
        device_context: ID3D11DeviceContext,
        duplication: Option<IDXGIOutputDuplication>,
        staging: Option<ID3D11Texture2D>,
        staging_size: (u32, u32),
        com_initialized: bool,
    }

    impl DxgiCaptureContext {
        /// Enumerate attached desktop outputs with their physical rectangles,
        /// adapter LUIDs, device names, and rotations.
        ///
        /// COM is initialized for the calling thread and deliberately left
        /// initialized (process-lifetime, idempotent); contexts created
        /// afterwards do not uninitialize another caller's COM state.
        pub fn enumerate_outputs() -> Result<Vec<OutputInfo>, CaptureError> {
            ensure_dpi_awareness();
            let _ = ensure_com()?;
            let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }
                .map_err(|e| CaptureError::NativeApi(format!("CreateDXGIFactory1: {e}")))?;
            let mut outputs = Vec::new();
            let mut adapter_index = 0u32;
            loop {
                let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
                    Ok(a) => a,
                    Err(_) => break,
                };
                let desc = unsafe { adapter.GetDesc1() }.map_err(|e| {
                    CaptureError::NativeApi(format!("IDXGIAdapter1::GetDesc1: {e}"))
                })?;
                let luid = (desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart);
                let mut output_index = 0u32;
                loop {
                    let output = match unsafe { adapter.EnumOutputs(output_index) } {
                        Ok(o) => o,
                        Err(_) => break,
                    };
                    let odesc: DXGI_OUTPUT_DESC = unsafe { output.GetDesc() }.map_err(|e| {
                        CaptureError::NativeApi(format!("IDXGIOutput::GetDesc: {e}"))
                    })?;
                    if odesc.AttachedToDesktop.as_bool() {
                        let rc = odesc.DesktopCoordinates;
                        outputs.push(OutputInfo {
                            index: outputs.len(),
                            device_name: wide_to_string(&odesc.DeviceName),
                            adapter_luid: luid,
                            rect: RectI {
                                x: rc.left as i64,
                                y: rc.top as i64,
                                w: (rc.right - rc.left).max(0) as u64,
                                h: (rc.bottom - rc.top).max(0) as u64,
                            },
                            rotation: rotation_from(odesc.Rotation),
                        });
                    }
                    output_index += 1;
                }
                adapter_index += 1;
            }
            if outputs.is_empty() {
                return Err(CaptureError::NoMonitors);
            }
            Ok(outputs)
        }

        /// Create a context for the enumerated output at `index`.
        pub fn for_output(index: usize) -> Result<Self, CaptureError> {
            ensure_dpi_awareness();
            let com_initialized = ensure_com()?;
            let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }
                .map_err(|e| CaptureError::NativeApi(format!("CreateDXGIFactory1: {e}")))?;
            // Re-enumerate to keep adapter/output handles paired.
            let mut found: Option<(IDXGIAdapter1, IDXGIOutput1, OutputInfo)> = None;
            let mut seen = 0usize;
            let mut adapter_index = 0u32;
            'outer: loop {
                let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
                    Ok(a) => a,
                    Err(_) => break,
                };
                let desc = unsafe { adapter.GetDesc1() }.map_err(|e| {
                    CaptureError::NativeApi(format!("IDXGIAdapter1::GetDesc1: {e}"))
                })?;
                let luid = (desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart);
                let mut output_index = 0u32;
                loop {
                    let output = match unsafe { adapter.EnumOutputs(output_index) } {
                        Ok(o) => o,
                        Err(_) => break,
                    };
                    let odesc: DXGI_OUTPUT_DESC = unsafe { output.GetDesc() }.map_err(|e| {
                        CaptureError::NativeApi(format!("IDXGIOutput::GetDesc: {e}"))
                    })?;
                    if odesc.AttachedToDesktop.as_bool() {
                        if seen == index {
                            let rc = odesc.DesktopCoordinates;
                            let info = OutputInfo {
                                index,
                                device_name: wide_to_string(&odesc.DeviceName),
                                adapter_luid: luid,
                                rect: RectI {
                                    x: rc.left as i64,
                                    y: rc.top as i64,
                                    w: (rc.right - rc.left).max(0) as u64,
                                    h: (rc.bottom - rc.top).max(0) as u64,
                                },
                                rotation: rotation_from(odesc.Rotation),
                            };
                            let output1: IDXGIOutput1 = output.cast().map_err(|e| {
                                CaptureError::NativeApi(format!(
                                    "IDXGIOutput::cast to IDXGIOutput1: {e}"
                                ))
                            })?;
                            found = Some((adapter, output1, info));
                            break 'outer;
                        }
                        seen += 1;
                    }
                    output_index += 1;
                }
                adapter_index += 1;
            }
            let (adapter, output1, output_info) =
                found.ok_or_else(|| CaptureError::NativeApi(format!("no DXGI output {index}")))?;
            let (device, device_context) = create_device(&adapter)?;
            let mut ctx = Self {
                output_info,
                _adapter: adapter,
                output1,
                device,
                device_context,
                duplication: None,
                staging: None,
                staging_size: (0, 0),
                com_initialized,
            };
            ctx.recreate_duplication()?;
            Ok(ctx)
        }

        pub fn output_info(&self) -> &OutputInfo {
            &self.output_info
        }

        /// DXGI1-004A: rebuild the FULL adapter-bound resource set after
        /// device loss — a brand-new D3D11 device and context, then a
        /// fresh duplication object on the new device. The old state is
        /// replaced atomically, only on full success: on any failure the
        /// context keeps its (dead) prior state and the caller treats
        /// the request as terminal, exactly as before.
        ///
        /// A removed device is never a valid recovery foundation, so
        /// re-running DuplicateOutput on it (the round-1 behavior)
        /// cannot reliably recover. IDXGIOutput handles survive device
        /// removal (they hang off the adapter, not the device), so the
        /// existing output binding is reused; only if DuplicateOutput
        /// fails on it do we re-enumerate the adapter's outputs and
        /// retry once against the output with the same device name.
        fn rebuild_device_and_duplication(&mut self) -> Result<(), CaptureError> {
            let (new_device, new_context) = create_device(&self._adapter)?;
            let device_iunknown: IUnknown = new_device.cast().map_err(|e| {
                CaptureError::NativeApi(format!("ID3D11Device::cast to IUnknown: {e}"))
            })?;
            let duplication = match unsafe { self.output1.DuplicateOutput(&device_iunknown) } {
                Ok(d) => d,
                Err(_) => {
                    // Refresh the output binding once, then retry.
                    let refreshed = self.refresh_output()?;
                    let d = unsafe { refreshed.DuplicateOutput(&device_iunknown) }
                        .map_err(|e| CaptureError::NativeApi(format!("DuplicateOutput: {e}")))?;
                    self.output1 = refreshed;
                    d
                }
            };
            // Atomic replace: only now do the new resources become live.
            self.device = new_device;
            self.device_context = new_context;
            self.duplication = Some(duplication);
            self.staging = None;
            self.staging_size = (0, 0);
            Ok(())
        }

        /// Re-enumerate this adapter's outputs and return the one whose
        /// device name matches the context's output. Used only when a
        /// fresh device's DuplicateOutput fails on the stored output
        /// handle, i.e. the output binding itself went stale.
        fn refresh_output(&self) -> Result<IDXGIOutput1, CaptureError> {
            let mut output_index = 0u32;
            loop {
                let output = match unsafe { self._adapter.EnumOutputs(output_index) } {
                    Ok(o) => o,
                    Err(e) => {
                        return Err(CaptureError::NativeApi(format!(
                            "output refresh: no output matches {}: {e}",
                            self.output_info.device_name
                        )))
                    }
                };
                let odesc: DXGI_OUTPUT_DESC = unsafe { output.GetDesc() }
                    .map_err(|e| CaptureError::NativeApi(format!("IDXGIOutput::GetDesc: {e}")))?;
                if odesc.AttachedToDesktop.as_bool()
                    && wide_to_string(&odesc.DeviceName) == self.output_info.device_name
                {
                    return output.cast().map_err(|e| {
                        CaptureError::NativeApi(format!("IDXGIOutput::cast to IDXGIOutput1: {e}"))
                    });
                }
                output_index += 1;
            }
        }

        fn recreate_duplication(&mut self) -> Result<(), CaptureError> {
            self.duplication = None;
            self.staging = None;
            self.staging_size = (0, 0);
            let device_iunknown: IUnknown = self.device.cast().map_err(|e| {
                CaptureError::NativeApi(format!("ID3D11Device::cast to IUnknown: {e}"))
            })?;
            let duplication = unsafe { self.output1.DuplicateOutput(&device_iunknown) }
                .map_err(|e| CaptureError::NativeApi(format!("DuplicateOutput: {e}")))?;
            self.duplication = Some(duplication);
            Ok(())
        }

        /// Capture `rect` from this context's output (DXGI-1 single-output).
        pub fn capture_rect(
            &mut self,
            rect: RectI,
            limits: &DxgiLimits,
        ) -> DxgiCaptureOutcome {
            let output = self.output_info.clone();
            super::capture_single_output(self, &output, rect, limits)
        }
    }

    impl Drop for DxgiCaptureContext {
        fn drop(&mut self) {
            self.duplication = None;
            self.staging = None;
            if self.com_initialized {
                unsafe { CoUninitialize() };
            }
        }
    }

    impl super::DuplicationBackend for DxgiCaptureContext {
        fn acquire(
            &mut self,
            timeout_ms: u32,
            limits: &DxgiLimits,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            let duplication = match &self.duplication {
                Some(d) => d.clone(),
                None => {
                    return Err(DxgiAcquireError::Unavailable(
                        "duplication object not initialized".into(),
                    ))
                }
            };
            // Nothing is held until AcquireNextFrame succeeds.
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            let acquire_result =
                unsafe { duplication.AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource) };
            if let Err(e) = acquire_result {
                return Err(classify_hresult(e.code().0));
            }
            // DXGI1-001: the release guard is created IMMEDIATELY after a
            // successful AcquireNextFrame, before any fallible inspection
            // or cast. Every error return below drops it (exactly one
            // ReleaseFrame), so a missing resource or failed cast can
            // never leave the frame acquired and wedge the duplication
            // object into invalid-call behavior on the next acquire.
            let guard = FrameGuard::new({
                let d = duplication.clone();
                move || {
                    let _ = unsafe { d.ReleaseFrame() };
                }
            });
            // DXGI1-003: fail-closed protected-content rule, checked
            // before any pixel handling. Any nonzero mask means the frame
            // carries masked protected pixels and must never be returned
            // as an ordinary frame; the guard releases on this return.
            if let Some(err) =
                protected_from_frame_info(frame_info.ProtectedContentMaskedOut.as_bool())
            {
                drop(guard);
                return Err(err);
            }
            let resource = match resource {
                Some(r) => r,
                None => {
                    drop(guard);
                    return Err(DxgiAcquireError::Other(
                        "AcquireNextFrame succeeded with no resource".into(),
                    ));
                }
            };
            let texture: ID3D11Texture2D = match resource.cast() {
                Ok(t) => t,
                Err(e) => {
                    drop(guard);
                    return Err(DxgiAcquireError::Other(format!(
                        "acquired resource is not a texture: {e}"
                    )));
                }
            };
            let mut tex_desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut tex_desc) };
            let (width, height) = (tex_desc.Width, tex_desc.Height);
            // DXGI1-002: limits are enforced HERE, before any staging
            // texture is created or any host buffer is allocated from
            // these untrusted dimensions. The caller re-validates the
            // returned pixels as defense in depth, but no allocation
            // sized from the frame happens before this check.
            if let Err(e) = validate_limits(width, height, limits) {
                drop(guard);
                return Err(DxgiAcquireError::Unavailable(format!(
                    "acquired frame violates limits: {e}"
                )));
            }
            if self.staging.is_none() || self.staging_size != (width, height) {
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Width: width,
                    Height: height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_STAGING,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    ..Default::default()
                };
                let mut staging: Option<ID3D11Texture2D> = None;
                let created = unsafe {
                    self.device
                        .CreateTexture2D(&staging_desc, None, Some(&mut staging))
                };
                if let Err(e) = created {
                    // DXGI1-004: device-loss classification survives the
                    // staging stage; other failures become StageFailed so
                    // the caller still gets its one bounded recreate.
                    drop(guard);
                    return Err(classify_stage_error(e.code().0));
                }
                self.staging = staging;
                self.staging_size = (width, height);
            }
            let staging = match &self.staging {
                Some(s) => s.clone(),
                None => {
                    drop(guard);
                    return Err(DxgiAcquireError::Other(
                        "staging texture missing after create".into(),
                    ));
                }
            };
            // Full-output copy; the requested rect is cropped on the CPU
            // (DXGI-1 simplicity — DXGI-2 may copy sub-boxes instead).
            unsafe {
                self.device_context
                    .CopyResource(&staging, &texture);
            }
            // Brief order: ReleaseFrame before CPU mapping/conversion.
            let mut guard = guard;
            guard.release();
            let staging_resource: windows::Win32::Graphics::Direct3D11::ID3D11Resource =
                match staging.cast() {
                    Ok(r) => r,
                    Err(e) => {
                        return Err(classify_stage_error(e.code().0));
                    }
                };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            if let Err(e) = unsafe {
                self.device_context.Map(
                    &staging_resource,
                    0,
                    D3D11_MAP_READ,
                    0,
                    Some(&mut mapped as *mut D3D11_MAPPED_SUBRESOURCE),
                )
            } {
                return Err(classify_stage_error(e.code().0));
            }
            // DXGI1-004: the unmap guard is established immediately after
            // a successful Map, so the mapped state is released on every
            // path through the host allocation/copy work below, including
            // unwind — never a manual Map/Unmap pair.
            let unmap_guard = FrameGuard::new({
                let dc = self.device_context.clone();
                let res = staging_resource.clone();
                move || {
                    unsafe { dc.Unmap(&res, 0) };
                }
            });
            let row_pitch = mapped.RowPitch as usize;
            // DXGI1-002: checked pitch arithmetic and the raster budget
            // are enforced BEFORE allocating the host buffer — never a
            // saturating wrap into a maximum-size request. The unmap
            // guard releases on these error returns.
            let byte_len = match checked_mapped_bytes(row_pitch, height, limits.max_raster_bytes)
            {
                Ok(n) => n,
                Err(e) => {
                    drop(unmap_guard);
                    return Err(DxgiAcquireError::Unavailable(format!(
                        "staging buffer violates limits: {e}"
                    )));
                }
            };
            let mut bgra = vec![0u8; byte_len];
            if !mapped.pData.is_null() && byte_len > 0 {
                unsafe {
                    std::ptr::copy_nonoverlapping(
                        mapped.pData as *const u8,
                        bgra.as_mut_ptr(),
                        byte_len,
                    );
                }
            }
            drop(unmap_guard);
            // DXGI1 fix round 3: carry the raw frame metadata through
            // so hardware harnesses can log it per acquire (mask,
            // accumulated frames, coalescing, present time) and the
            // mask misfire can be discriminated from outcomes alone
            // no longer. Diagnostic only; the fail-closed mask rule
            // above is unchanged.
            let metadata = DxgiFrameMetadata {
                protected_content_masked_out: frame_info.ProtectedContentMaskedOut.0,
                accumulated_frames: frame_info.AccumulatedFrames,
                rects_coalesced: frame_info.RectsCoalesced.0,
                last_present_time: frame_info.LastPresentTime,
                total_metadata_size: frame_info.TotalMetadataBufferSize,
                pointer_shape_size: frame_info.PointerShapeBufferSize,
            };
            Ok((
                guard,
                AcquiredPixels {
                    width,
                    height,
                    row_pitch,
                    bgra,
                    frame_info: metadata,
                },
            ))
        }

        fn recreate(&mut self) -> Result<(), DxgiAcquireError> {
            // DXGI1-004A: full device/context/duplication rebuild, not
            // the round-1 duplication-only rebuild on a removed device.
            self.rebuild_device_and_duplication().map_err(|e| match e {
                crate::result::CaptureError::NativeApi(msg) => DxgiAcquireError::Other(msg),
                other => DxgiAcquireError::Other(other.to_string()),
            })
        }
    }

    // (No HRESULT import needed: classification works on the raw i32 code.)

    #[test]
    fn dxgi_error_constants_match_windows_crate() {
        use windows::Win32::Graphics::Dxgi::{
            DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_DEVICE_REMOVED, DXGI_ERROR_SESSION_DISCONNECTED,
            DXGI_ERROR_WAIT_TIMEOUT,
        };
        assert_eq!(super::DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_ACCESS_LOST.0 as u32);
        assert_eq!(super::DXGI_ERROR_WAIT_TIMEOUT, DXGI_ERROR_WAIT_TIMEOUT.0 as u32);
        assert_eq!(
            super::DXGI_ERROR_SESSION_DISCONNECTED,
            DXGI_ERROR_SESSION_DISCONNECTED.0 as u32
        );
        assert_eq!(
            super::DXGI_ERROR_DEVICE_REMOVED,
            DXGI_ERROR_DEVICE_REMOVED.0 as u32
        );
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn test_output() -> OutputInfo {
        OutputInfo {
            index: 0,
            device_name: "\\\\.\\DISPLAY1".to_string(),
            adapter_luid: (0, 0),
            rect: RectI {
                x: 0,
                y: 0,
                w: 4,
                h: 2,
            },
            rotation: DxgiRotation::Identity,
        }
    }

    fn solid_frame(width: u32, height: u32, bgra: [u8; 4]) -> AcquiredPixels {
        let mut bytes = Vec::new();
        for _ in 0..width * height {
            bytes.extend_from_slice(&bgra);
        }
        AcquiredPixels {
            width,
            height,
            row_pitch: width as usize * 4,
            bgra: bytes,
            frame_info: DxgiFrameMetadata::default(),
        }
    }

    /// Variant of `solid_frame` carrying explicit frame metadata, for
    /// passthrough tests (fix round 3: metadata must survive the
    /// acquire → convert → crop path unchanged).
    fn solid_frame_with_info(
        width: u32,
        height: u32,
        bgra: [u8; 4],
        frame_info: DxgiFrameMetadata,
    ) -> AcquiredPixels {
        let mut pixels = solid_frame(width, height, bgra);
        pixels.frame_info = frame_info;
        pixels
    }

    #[derive(Clone)]
    enum Step {
        Ok(AcquiredPixels),
        Err(DxgiAcquireError),
    }

    struct MockBackend {
        steps: VecDeque<Step>,
        releases: Arc<AtomicUsize>,
        recreates: Arc<AtomicUsize>,
        timeouts: Vec<u32>,
        acquire_calls: usize,
    }

    impl MockBackend {
        fn new(steps: Vec<Step>) -> Self {
            Self {
                steps: steps.into(),
                releases: Arc::new(AtomicUsize::new(0)),
                recreates: Arc::new(AtomicUsize::new(0)),
                timeouts: Vec::new(),
                acquire_calls: 0,
            }
        }
    }

    impl DuplicationBackend for MockBackend {
        fn acquire(
            &mut self,
            timeout_ms: u32,
            _limits: &DxgiLimits,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            self.timeouts.push(timeout_ms);
            self.acquire_calls += 1;
            match self.steps.pop_front() {
                Some(Step::Ok(pixels)) => {
                    let releases = Arc::clone(&self.releases);
                    Ok((
                        FrameGuard::new(move || {
                            releases.fetch_add(1, Ordering::SeqCst);
                        }),
                        pixels,
                    ))
                }
                Some(Step::Err(e)) => Err(e),
                None => Err(DxgiAcquireError::Other("mock script exhausted".into())),
            }
        }

        fn recreate(&mut self) -> Result<(), DxgiAcquireError> {
            self.recreates.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    // DXGI1-004A: minimal model of the production resource graph. A
    // device-removed event invalidates the D3D11 device itself, so a
    // frame can only be acquired again after the device is REBUILT.
    // A recreate that only rebuilds duplication/staging (the round-1
    // behavior) leaves the device dead, so the next acquire still
    // fails and the request is terminal. `full_rebuild` selects which
    // behavior the mock models.
    struct DeviceGraphMock {
        steps: VecDeque<Step>,
        device_alive: bool,
        full_rebuild: bool,
        generations: usize,
        recreates: usize,
    }

    impl DeviceGraphMock {
        fn new(steps: Vec<Step>, full_rebuild: bool) -> Self {
            Self {
                steps: steps.into(),
                device_alive: true,
                full_rebuild,
                generations: 0,
                recreates: 0,
            }
        }
    }

    impl DuplicationBackend for DeviceGraphMock {
        fn acquire(
            &mut self,
            _timeout_ms: u32,
            _limits: &DxgiLimits,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            match self.steps.pop_front() {
                Some(Step::Ok(pixels)) if self.device_alive => {
                    Ok((FrameGuard::new(|| {}), pixels))
                }
                Some(Step::Ok(_)) => Err(DxgiAcquireError::DeviceRemoved),
                Some(Step::Err(DxgiAcquireError::DeviceRemoved)) => {
                    self.device_alive = false;
                    Err(DxgiAcquireError::DeviceRemoved)
                }
                Some(Step::Err(e)) => Err(e),
                None => Err(DxgiAcquireError::Other("mock script exhausted".into())),
            }
        }

        fn recreate(&mut self) -> Result<(), DxgiAcquireError> {
            self.recreates += 1;
            if self.full_rebuild {
                // Models the round-2 repair: a brand-new D3D11 device
                // and context replace the removed ones.
                self.device_alive = true;
                self.generations += 1;
            }
            // Duplication-only rebuild (round-1 behavior) leaves
            // device_alive false: the removed device stays dead.
            Ok(())
        }
    }

    #[test]
    fn limits_accept_valid_frame() {
        let limits = DxgiLimits::default();
        assert_eq!(validate_limits(1920, 1080, &limits), Ok(1920 * 1080 * 4));
    }

    #[test]
    fn limits_reject_oversize_side_and_raster() {
        let limits = DxgiLimits::default();
        assert_eq!(
            validate_limits(16_385, 10, &limits),
            Err(DxgiLimitError::SideTooLarge {
                side: 16_385,
                max: 16_384
            })
        );
        // 16384 x 16384 x 4 = 1 GiB > 128 MiB.
        assert!(matches!(
            validate_limits(16_384, 16_384, &limits),
            Err(DxgiLimitError::RasterTooLarge { .. })
        ));
        assert_eq!(
            validate_limits(0, 10, &limits),
            Err(DxgiLimitError::Empty)
        );
    }

    #[test]
    fn limits_overflow_does_not_panic() {
        let limits = DxgiLimits::default();
        // u32::MAX sides overflow any byte count; checked math must fail,
        // not wrap. (Side check fires first for u32::MAX, so use a pair
        // that passes the side check only via a small custom limit.)
        let wide = DxgiLimits {
            max_side_px: u32::MAX,
            ..limits
        };
        assert_eq!(
            validate_limits(u32::MAX, u32::MAX, &wide),
            Err(DxgiLimitError::Overflow)
        );
    }

    #[test]
    fn pitch_conversion_skips_padding_and_forces_opaque_alpha() {
        // 2x1 frame, row pitch 12 (8 payload + 4 padding).
        let src = [
            10, 20, 30, 0, // BGRA pixel 0 (alpha 0 in source)
            40, 50, 60, 0, // BGRA pixel 1
            99, 99, 99, 99, // padding, must be ignored
        ];
        let out = convert_bgra_to_rgba_pitched(&src, 2, 1, 12).unwrap();
        assert_eq!(out, vec![30, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn pitch_conversion_rejects_short_buffer_and_narrow_pitch() {
        assert!(convert_bgra_to_rgba_pitched(&[0u8; 7], 2, 1, 8).is_none());
        assert!(convert_bgra_to_rgba_pitched(&[0u8; 8], 2, 1, 4).is_none());
        assert!(convert_bgra_to_rgba_pitched(&[], 0, 0, 0).is_none());
    }

    #[test]
    fn hresult_classification() {
        assert_eq!(
            classify_hresult(DXGI_ERROR_ACCESS_LOST as i32),
            DxgiAcquireError::AccessLost
        );
        assert_eq!(
            classify_hresult(DXGI_ERROR_WAIT_TIMEOUT as i32),
            DxgiAcquireError::WaitTimeout
        );
        assert_eq!(
            classify_hresult(DXGI_ERROR_SESSION_DISCONNECTED as i32),
            DxgiAcquireError::SessionDisconnected
        );
        assert_eq!(
            classify_hresult(DXGI_ERROR_DEVICE_REMOVED as i32),
            DxgiAcquireError::DeviceRemoved
        );
        assert!(matches!(
            classify_hresult(DXGI_ERROR_UNSUPPORTED as i32),
            DxgiAcquireError::Unavailable(_)
        ));
        assert!(matches!(
            classify_hresult(-1),
            DxgiAcquireError::Other(_)
        ));
    }

    #[test]
    fn guard_releases_on_explicit_release_and_on_drop() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        let mut guard = FrameGuard::new(move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        assert!(!guard.is_released());
        guard.release();
        assert_eq!(count.load(Ordering::SeqCst), 1);

        let c2 = Arc::clone(&count);
        {
            let _guard = FrameGuard::new(move || {
                c2.fetch_add(1, Ordering::SeqCst);
            });
        }
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn guard_releases_on_unwind() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        let result = std::panic::catch_unwind(move || {
            let _guard = FrameGuard::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
            });
            panic!("simulated conversion failure while a frame is held");
        });
        assert!(result.is_err());
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn single_output_success_crops_and_releases() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(
            4,
            2,
            [1, 2, 3, 0],
        ))]);
        let output = test_output();
        let rect = RectI {
            x: 1,
            y: 0,
            w: 2,
            h: 2,
        };
        let outcome = capture_single_output(&mut backend, &output, rect, &DxgiLimits::default());
        match outcome {
            DxgiCaptureOutcome::Frame(frame) => {
                assert_eq!((frame.width, frame.height), (2, 2));
                // BGRA [1,2,3] -> RGBA [3,2,1,255], all pixels identical.
                assert_eq!(frame.rgba, vec![3, 2, 1, 255].repeat(4));
            }
            other => panic!("expected Frame, got {other:?}"),
        }
        assert_eq!(backend.releases.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn access_lost_recreates_once_then_succeeds() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::AccessLost),
            Step::Ok(solid_frame(4, 2, [9, 8, 7, 0])),
        ]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.recreates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn second_access_lost_is_terminal_retryable() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::AccessLost),
            Step::Err(DxgiAcquireError::AccessLost),
        ]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.recreates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn wait_timeout_is_not_terminal_until_deadline() {
        // Timeout, then a frame: a stable unchanged desktop must not fail.
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::WaitTimeout),
            Step::Ok(solid_frame(4, 2, [5, 5, 5, 0])),
        ]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
    }

    #[test]
    fn wait_timeout_past_deadline_is_retryable_not_a_frame() {
        let mut backend = MockBackend::new(vec![Step::Err(DxgiAcquireError::WaitTimeout); 64]);
        let output = test_output();
        let limits = DxgiLimits {
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        let outcome = capture_single_output(&mut backend, &output, output.rect, &limits);
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
    }

    #[test]
    fn protected_content_is_explicit_not_a_frame() {
        let mut backend = MockBackend::new(vec![Step::Err(DxgiAcquireError::Protected)]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(
            outcome,
            DxgiCaptureOutcome::ProtectedOrSecure(_)
        ));
    }

    #[test]
    fn rect_outside_output_is_unavailable_not_partial() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [0, 0, 0, 0]))]);
        let output = test_output();
        let rect = RectI {
            x: 3,
            y: 0,
            w: 2,
            h: 2,
        };
        let outcome = capture_single_output(&mut backend, &output, rect, &DxgiLimits::default());
        assert!(matches!(outcome, DxgiCaptureOutcome::Unavailable(_)));
        // Backend never acquired: no frame was taken for a bad rect.
        assert_eq!(backend.releases.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn non_identity_rotation_is_unavailable_in_dxgi1() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [0, 0, 0, 0]))]);
        let mut output = test_output();
        output.rotation = DxgiRotation::Rotate90;
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Unavailable(_)));
    }

    // DXGI1-001 / DXGI1-002: a post-acquire refusal (limit validation
    // after acquisition) must still release the frame exactly once.
    #[test]
    fn limit_refusal_releases_frame_exactly_once() {
        // Oversize width: the caller-side limit check refuses.
        let mut backend = MockBackend::new(vec![Step::Ok(AcquiredPixels {
            width: 20_000,
            height: 2,
            row_pitch: 80_000,
            bgra: vec![0u8; 160_000],
            frame_info: DxgiFrameMetadata::default(),
        })]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Unavailable(_)));
        assert_eq!(backend.releases.load(Ordering::SeqCst), 1);
    }

    // DXGI1-003: the fail-closed protected rule is a pure function so it
    // is testable on any host; the Windows backend wires it to the real
    // frame metadata before any pixel handling.
    #[test]
    fn protected_mask_rule_is_fail_closed() {
        assert_eq!(
            protected_from_frame_info(true),
            Some(DxgiAcquireError::Protected)
        );
        assert_eq!(protected_from_frame_info(false), None);
    }

    // DXGI1-004: stage errors preserve device-loss classification, and
    // anything else becomes StageFailed (never a bare Other that would
    // skip the one bounded recreate).
    #[test]
    fn stage_error_classification_preserves_device_loss() {
        assert_eq!(
            classify_stage_error(DXGI_ERROR_DEVICE_REMOVED as i32),
            DxgiAcquireError::DeviceRemoved
        );
        assert_eq!(
            classify_stage_error(DXGI_ERROR_ACCESS_LOST as i32),
            DxgiAcquireError::AccessLost
        );
        assert!(matches!(
            classify_stage_error(-1),
            DxgiAcquireError::StageFailed(_)
        ));
        assert!(matches!(
            classify_stage_error(DXGI_ERROR_UNSUPPORTED as i32),
            DxgiAcquireError::Unavailable(_)
        ));
    }

    // DXGI1-004: a stage failure recreates once, then succeeds; a second
    // stage failure is terminal, exactly like AccessLost.
    #[test]
    fn stage_failure_recreates_once_then_succeeds() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::StageFailed("Map failed".into())),
            Step::Ok(solid_frame(4, 2, [9, 8, 7, 0])),
        ]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.recreates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn second_stage_failure_is_terminal_retryable() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::StageFailed("Map failed".into())),
            Step::Err(DxgiAcquireError::StageFailed("Map failed again".into())),
        ]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.recreates.load(Ordering::SeqCst), 1);
    }

    // DXGI1-002: mapped-byte accounting is checked before allocation.
    #[test]
    fn checked_mapped_bytes_refuses_overflow_and_over_limit() {
        assert_eq!(checked_mapped_bytes(16, 2, 128 * 1024 * 1024), Ok(32));
        assert_eq!(
            checked_mapped_bytes(usize::MAX, 2, u64::MAX),
            Err(DxgiLimitError::Overflow)
        );
        assert!(matches!(
            checked_mapped_bytes(100, 2, 150),
            Err(DxgiLimitError::RasterTooLarge { .. })
        ));
    }

    // DXGI1-005: the per-attempt timeout is capped by the remaining total
    // budget, computed from injected durations (no wall-clock flakiness).
    #[test]
    fn attempt_timeout_is_capped_by_remaining_budget() {
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 2_000,
            ..DxgiLimits::default()
        };
        assert_eq!(
            attempt_timeout_ms(&limits, Duration::from_millis(0)),
            Some(250)
        );
        let tight = DxgiLimits {
            total_deadline_ms: 100,
            ..limits
        };
        assert_eq!(
            attempt_timeout_ms(&tight, Duration::from_millis(0)),
            Some(100)
        );
        assert_eq!(
            attempt_timeout_ms(&tight, Duration::from_millis(90)),
            Some(10)
        );
        assert_eq!(
            attempt_timeout_ms(&tight, Duration::from_millis(100)),
            None
        );
        assert_eq!(
            attempt_timeout_ms(&tight, Duration::from_millis(101)),
            None
        );
        let zero = DxgiLimits {
            total_deadline_ms: 0,
            ..limits
        };
        assert_eq!(attempt_timeout_ms(&zero, Duration::from_millis(0)), None);
    }

    // DXGI1-005A: a sub-millisecond remainder must NEVER become a
    // positive blocking timeout. The old ceiling rounding turned a
    // 0.5ms remainder into Some(1), letting AcquireNextFrame(1) block
    // past the absolute total deadline. The fix floors to whole
    // milliseconds and stops (None) when less than 1ms remains.
    #[test]
    fn attempt_timeout_sub_millisecond_remainder_stops() {
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 100,
            ..DxgiLimits::default()
        };
        // 0.5ms remains: must stop, never Some(1).
        assert_eq!(
            attempt_timeout_ms(&limits, Duration::from_micros(99_500)),
            None
        );
        // Exactly 1ms remains: a 1ms attempt fits the budget exactly.
        assert_eq!(
            attempt_timeout_ms(&limits, Duration::from_millis(99)),
            Some(1)
        );
        // 1.5ms remains: floored to 1ms, never ceiled to 2ms.
        assert_eq!(
            attempt_timeout_ms(&limits, Duration::from_micros(98_500)),
            Some(1)
        );
        // 90.999ms remains: floored to 90ms, never 91ms.
        assert_eq!(
            attempt_timeout_ms(&limits, Duration::from_micros(9_001)),
            Some(90)
        );
    }

    // DXGI1-004A: recovery succeeds ONLY with a newly created device.
    // With a full device rebuild, a device-removed request recovers
    // and returns a frame; with a duplication-only rebuild (the
    // round-1 defect), the next acquire still fails and the request
    // is terminal after exactly one recreate.
    #[test]
    fn device_removed_recovers_only_with_full_device_rebuild() {
        let output = test_output();
        let mut backend = DeviceGraphMock::new(
            vec![
                Step::Err(DxgiAcquireError::DeviceRemoved),
                Step::Ok(solid_frame(4, 2, [9, 8, 7, 0])),
            ],
            true,
        );
        let outcome =
            capture_single_output(&mut backend, &output, output.rect, &DxgiLimits::default());
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.recreates, 1);
        assert_eq!(backend.generations, 1);
    }

    #[test]
    fn duplication_only_rebuild_cannot_recover_removed_device() {
        let output = test_output();
        let mut backend = DeviceGraphMock::new(
            vec![
                Step::Err(DxgiAcquireError::DeviceRemoved),
                Step::Ok(solid_frame(4, 2, [9, 8, 7, 0])),
            ],
            false,
        );
        let outcome =
            capture_single_output(&mut backend, &output, output.rect, &DxgiLimits::default());
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.recreates, 1);
        assert_eq!(backend.generations, 0);
    }

    // DXGI1-005A: with a 1ms total deadline the only acquire is the
    // single final nonblocking poll — never a 1ms attempt issued
    // against a sub-millisecond remainder (the round-1 ceiling bug).
    // DXGI1 fix round 3: deadline tests use a SCRIPTED clock, never wall
    // time. Round 2 read `Instant::now()` and failed on Windows, where
    // the first iteration can measure elapsed == 0 (timer granularity)
    // and issue a 1ms attempt before the 0ms final poll — while Linux
    // measured elapsed > 0 and passed. With elapsed pinned at 500us of
    // a 1ms deadline, less than one whole millisecond remains, so the
    // only legal attempt is the 0ms final poll on every platform.
    #[test]
    fn backend_receives_capped_timeout() {
        let mut backend = MockBackend::new(vec![Step::Err(DxgiAcquireError::WaitTimeout); 8]);
        let output = test_output();
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        let outcome =
            capture_single_output_with_clock(&mut backend, &output, output.rect, &limits, || {
                Duration::from_micros(500)
            });
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.timeouts, vec![0]);
        assert_eq!(backend.acquire_calls, 1);
    }

    // DXGI1-005A: the single final nonblocking poll can still take an
    // already-ready frame when less than 1ms remains.
    #[test]
    fn final_nonblocking_poll_can_take_ready_frame() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [1, 2, 3, 0]))]);
        let output = test_output();
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        let outcome =
            capture_single_output_with_clock(&mut backend, &output, output.rect, &limits, || {
                Duration::from_micros(500)
            });
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.timeouts, vec![0]);
    }

    // DXGI1-005A: at most ONE final poll per request — after it returns
    // WaitTimeout the loop stops even though a frame step remains.
    #[test]
    fn at_most_one_final_nonblocking_poll() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::WaitTimeout),
            Step::Ok(solid_frame(4, 2, [1, 2, 3, 0])),
        ]);
        let output = test_output();
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        let outcome =
            capture_single_output_with_clock(&mut backend, &output, output.rect, &limits, || {
                Duration::from_micros(500)
            });
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.timeouts, vec![0]);
        assert_eq!(backend.acquire_calls, 1);
    }

    // DXGI1 fix round 3: the clock injection must NOT weaken the rule —
    // with a full millisecond (or more) of budget remaining, the loop
    // still issues a positive capped timeout, not a 0ms poll.
    #[test]
    fn full_millisecond_budget_still_issues_positive_timeout() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [1, 2, 3, 0]))]);
        let output = test_output();
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 2,
            ..DxgiLimits::default()
        };
        let outcome =
            capture_single_output_with_clock(&mut backend, &output, output.rect, &limits, || {
                Duration::ZERO
            });
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.timeouts, vec![2]);
    }

    // DXGI1 fix round 3: once elapsed passes the deadline, the loop
    // stops without acquiring again — even with steps remaining.
    #[test]
    fn deadline_reached_stops_without_acquiring() {
        let mut backend = MockBackend::new(vec![
            Step::Err(DxgiAcquireError::WaitTimeout),
            Step::Ok(solid_frame(4, 2, [1, 2, 3, 0])),
        ]);
        let output = test_output();
        let limits = DxgiLimits {
            acquire_timeout_ms: 250,
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        let mut times = VecDeque::from([Duration::ZERO, Duration::from_millis(2)]);
        let outcome = capture_single_output_with_clock(
            &mut backend,
            &output,
            output.rect,
            &limits,
            move || times.pop_front().unwrap_or(Duration::MAX),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        // First iteration issued the 1ms attempt; the second saw the
        // deadline passed and stopped without a second acquire.
        assert_eq!(backend.timeouts, vec![1]);
        assert_eq!(backend.acquire_calls, 1);
    }

    // DXGI1 fix round 3: frame metadata survives acquire → convert →
    // crop unchanged, so hardware harnesses can log it per capture.
    #[test]
    fn frame_metadata_survives_acquire_and_crop() {
        let info = DxgiFrameMetadata {
            protected_content_masked_out: 0,
            accumulated_frames: 7,
            rects_coalesced: 1,
            last_present_time: 123_456_789,
            total_metadata_size: 64,
            pointer_shape_size: 0,
        };
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame_with_info(
            4,
            2,
            [9, 8, 7, 255],
            info,
        ))]);
        let output = test_output();
        // Crop to a sub-rect: metadata must survive cropping too.
        let rect = RectI {
            x: 1,
            y: 0,
            w: 2,
            h: 1,
        };
        let outcome =
            capture_single_output(&mut backend, &output, rect, &DxgiLimits::default());
        match outcome {
            DxgiCaptureOutcome::Frame(f) => {
                assert_eq!((f.width, f.height), (2, 1));
                assert_eq!(f.frame_info, info);
            }
            other => panic!("expected Frame, got {other:?}"),
        }
    }

    // DXGI1 fix round 3: repeated capture calls on one backend show no
    // cross-call state leakage at the pure-loop level (per-call
    // `final_poll_done` / `recreated` reset every call). This is the
    // Linux-testable half of the "stale state after the first capture"
    // hypothesis class; the COM half is hardware-gated.
    #[test]
    fn repeated_calls_have_no_cross_call_state() {
        let steps: Vec<Step> = (0..120)
            .map(|_| Step::Ok(solid_frame(4, 2, [1, 2, 3, 0])))
            .collect();
        let mut backend = MockBackend::new(steps);
        let output = test_output();
        for _ in 0..120 {
            let outcome = capture_single_output(
                &mut backend,
                &output,
                output.rect,
                &DxgiLimits::default(),
            );
            assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        }
        assert_eq!(backend.acquire_calls, 120);
    }

    #[test]
    fn full_acquire_timeout_used_within_budget() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [1, 2, 3, 0]))]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Frame(_)));
        assert_eq!(backend.timeouts, vec![250]);
    }

    #[test]
    fn zero_total_deadline_acquires_nothing() {
        let mut backend = MockBackend::new(vec![Step::Ok(solid_frame(4, 2, [1, 2, 3, 0]))]);
        let output = test_output();
        let limits = DxgiLimits {
            total_deadline_ms: 0,
            ..DxgiLimits::default()
        };
        let outcome = capture_single_output(&mut backend, &output, output.rect, &limits);
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.acquire_calls, 0);
    }

    #[test]
    fn conversion_failure_releases_and_is_retryable() {
        // Pitch narrower than a row: conversion fails after acquisition.
        let mut backend = MockBackend::new(vec![Step::Ok(AcquiredPixels {
            width: 4,
            height: 2,
            row_pitch: 4,
            bgra: vec![0u8; 32],
            frame_info: DxgiFrameMetadata::default(),
        })]);
        let output = test_output();
        let outcome = capture_single_output(
            &mut backend,
            &output,
            output.rect,
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiCaptureOutcome::Retryable(_)));
        assert_eq!(backend.releases.load(Ordering::SeqCst), 1);
    }
}
