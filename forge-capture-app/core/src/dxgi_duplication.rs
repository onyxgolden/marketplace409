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
//!   (DXGI1-004A). Genuine hardware device-removal recovery evidence is
//!   still unproven (a mode-switch ACCESS_LOST is not DEVICE_REMOVED);
//!   the production-shaped fault-injection seam
//!   ([`DxgiCaptureContext::inject_acquire_error`], Windows only,
//!   confined per verdict DXGI1-006B: `dxgi-fault-injection` feature,
//!   off by default, bounded queue, fixed injectable variants) proves
//!   the internal recovery path with labeled injected evidence instead
//!   of destabilizing the GPU.
//! - `WAIT_TIMEOUT`: "no new desktop update yet," not failure. Retried until
//!   the total request deadline; DXGI-1 keeps no cached frame, so a deadline
//!   expiry is a terminal retryable, never a stale frame.
//! - Protected/secure content: explicit [`DxgiCaptureOutcome::ProtectedOrSecure`],
//!   never a bypass attempt, never black pixels labeled success.
//!
//! Fix round 4 diagnostics (round-3 verdict: instrument the failing
//! outcome before changing behavior):
//!
//! - Every acquisition attempt records a [`DxgiAcquireDiagnostic`]
//!   immediately after AcquireNextFrame and before the mask branch —
//!   including Protected outcomes, which round-3 metadata could not
//!   observe. The record carries raw mask, accumulated frames, present
//!   time, metadata sizes, release HRESULT, session generation, attempt
//!   number, adapter LUID, and output identity. Metadata only: never
//!   pixels or desktop content.
//! - [`DxgiCaptureContext::acquire_staged`] (Windows only) runs one
//!   pipeline prefix per attempt (acquire-only, resource-inspect,
//!   staging-copy, map-copy) with no retry and no recreate, so the
//!   first failing stage is observed, not inferred. The complete
//!   wrapper loop is stage 5 ([`DxgiCaptureContext::capture_rect`]).
//! - Deadline scope (DXGI1-005A): the per-attempt/total-deadline rules
//!   bound AcquireNextFrame waits only. They are NOT an end-to-end hard
//!   execution deadline: the successful path does not recheck elapsed
//!   after copy/map/conversion, and native work/recreation can outlast
//!   the remaining budget. Do not advertise otherwise.
//! - GPU-telemetry scope: flat handles/working set do not establish flat
//!   dedicated GPU allocation; that limitation is preserved.
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
///
/// DXGI1 fix round 4: this struct only exists on successful copy/map
/// outcomes, so it cannot observe Protected outcomes at all (the mask
/// branch returns before construction). [`DxgiAcquireDiagnostic`] is the
/// pre-branch record that covers every attempt, including Protected ones.
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

/// Furthest pipeline stage reached by one acquisition attempt (fix
/// round 4). A diagnostic record's stage only ever moves forward.
/// Order: AcquireFailed < Acquired < MaskChecked < ResourceInspected <
/// StagingCopied < Mapped; [`DxgiAcquireStage::order`] gives that order
/// so tests and harnesses can assert monotonic progression.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DxgiAcquireStage {
    /// AcquireNextFrame returned an HRESULT, or no frame was acquired.
    AcquireFailed,
    /// AcquireNextFrame succeeded; the diagnostic was taken here, before
    /// the mask branch.
    Acquired,
    /// The mask branch evaluated (Protected classification or pass).
    MaskChecked,
    /// Resource cast + texture descriptor read succeeded.
    ResourceInspected,
    /// Staging texture allocated (or reused) and CopyResource enqueued.
    StagingCopied,
    /// Map/Unmap + host copy completed.
    Mapped,
}

impl DxgiAcquireStage {
    pub fn order(self) -> u8 {
        match self {
            DxgiAcquireStage::AcquireFailed => 0,
            DxgiAcquireStage::Acquired => 1,
            DxgiAcquireStage::MaskChecked => 2,
            DxgiAcquireStage::ResourceInspected => 3,
            DxgiAcquireStage::StagingCopied => 4,
            DxgiAcquireStage::Mapped => 5,
        }
    }
}

/// Provenance of one diagnostic record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DxgiAcquireProvenance {
    /// Real hardware acquisition.
    Real,
    /// Fault-injection seam: a harness call, never production behavior.
    /// Records with this provenance must be labeled "injected" in every
    /// report; they never prove real hardware device removal.
    Injected,
}

/// Classification an acquisition attempt produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DxgiAcquireClassification {
    /// Recorded pre-branch; the mask branch has not evaluated yet.
    Pending,
    /// Passed the mask branch (mask == 0); the pipeline continued.
    Pass,
    /// Mask branch classified Protected (mask != 0).
    Protected,
    /// AcquireNextFrame (or an injected error) failed; see
    /// [`DxgiAcquireDiagnostic::acquire_hresult`].
    AcquireError,
    /// A stage past acquisition failed (cast, limits, staging, map).
    StageError,
}

/// Bounded diagnostic record for ONE acquisition attempt (fix round 4).
///
/// Recorded immediately after AcquireNextFrame returns, BEFORE the mask
/// branch — including Protected outcomes, which the round-3 metadata
/// passthrough could not observe. One record per attempt: the release
/// update fills the release fields on the same record, never a second
/// one. Metadata only: no pixels, no desktop content, ever. Diagnostic
/// only: these records never change the fail-closed mask rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DxgiAcquireDiagnostic {
    /// Monotonic attempt number on this context (0-based; the staged
    /// API and the full loop share one counter).
    pub attempt: u64,
    /// Process-wide id of the context that made this attempt, so
    /// separate duplication sessions are distinguishable in one log.
    pub context_id: u64,
    /// Device generation at this attempt (0 = initial device; +1 per
    /// full device rebuild).
    pub session_generation: u64,
    /// Adapter LUID of the bound output.
    pub adapter_luid: (u32, i32),
    /// OS device name of the bound output.
    pub output_device_name: String,
    /// Furthest stage reached (forward-only).
    pub stage_reached: DxgiAcquireStage,
    pub provenance: DxgiAcquireProvenance,
    /// AcquireNextFrame HRESULT on failure; None on success.
    pub acquire_hresult: Option<i32>,
    /// Raw frame-info fields; None when AcquireNextFrame failed.
    pub protected_content_masked_out: Option<i32>,
    pub accumulated_frames: Option<u32>,
    pub rects_coalesced: Option<i32>,
    pub last_present_time: Option<i64>,
    pub total_metadata_size: Option<u32>,
    pub pointer_shape_size: Option<u32>,
    pub classification: DxgiAcquireClassification,
    /// ReleaseFrame HRESULT once released; None until then.
    pub release_hresult: Option<i32>,
    /// True once ReleaseFrame has run for this attempt.
    pub released: bool,
}

/// Bounded store for acquisition diagnostics (fix round 4).
///
/// Pure and platform-neutral so the cap/update rules are unit-testable on
/// any host; the Windows backend holds one behind a mutex. Oldest
/// records drop when the cap is exceeded — the store is diagnostic
/// evidence, never a correctness input, so losing old records is safe.
#[derive(Debug, Clone)]
pub struct DxgiDiagnosticLog {
    records: std::collections::VecDeque<DxgiAcquireDiagnostic>,
    cap: usize,
}

impl DxgiDiagnosticLog {
    pub fn new(cap: usize) -> Self {
        Self {
            records: std::collections::VecDeque::new(),
            cap: cap.max(1),
        }
    }

    pub fn push(&mut self, record: DxgiAcquireDiagnostic) {
        self.records.push_back(record);
        while self.records.len() > self.cap {
            self.records.pop_front();
        }
    }

    fn newest_for_attempt_mut(
        &mut self,
        attempt: u64,
    ) -> Option<&mut DxgiAcquireDiagnostic> {
        self.records.iter_mut().rev().find(|r| r.attempt == attempt)
    }

    /// Advance a record's stage/classification. The stage only moves
    /// forward; a backward update is ignored so a late path cannot
    /// rewrite the furthest point an attempt reached.
    pub fn update(
        &mut self,
        attempt: u64,
        stage: DxgiAcquireStage,
        classification: DxgiAcquireClassification,
    ) {
        if let Some(record) = self.newest_for_attempt_mut(attempt) {
            if stage.order() >= record.stage_reached.order() {
                record.stage_reached = stage;
                record.classification = classification;
            }
        }
    }

    /// Mark a record failed at its current stage without moving the
    /// stage. Never overwrites a Protected classification: a frame the
    /// mask branch already classified stays Protected.
    pub fn mark_failed(
        &mut self,
        attempt: u64,
        classification: DxgiAcquireClassification,
    ) {
        if let Some(record) = self.newest_for_attempt_mut(attempt) {
            if record.classification != DxgiAcquireClassification::Protected {
                record.classification = classification;
            }
        }
    }

    /// Fill the release fields on the newest unreleased record for this
    /// attempt. A second call is a no-op: release happens exactly once.
    pub fn mark_released(&mut self, attempt: u64, release_hresult: i32) {
        if let Some(record) = self
            .records
            .iter_mut()
            .rev()
            .find(|r| r.attempt == attempt && !r.released)
        {
            record.released = true;
            record.release_hresult = Some(release_hresult);
        }
    }

    pub fn get(&self, attempt: u64) -> Option<DxgiAcquireDiagnostic> {
        self.records
            .iter()
            .rev()
            .find(|r| r.attempt == attempt)
            .cloned()
    }

    pub fn snapshot(&self) -> Vec<DxgiAcquireDiagnostic> {
        self.records.iter().cloned().collect()
    }

    pub fn take(&mut self) -> Vec<DxgiAcquireDiagnostic> {
        self.records.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }
}

/// Fixed set of injectable acquisition faults (fix round 4, verdict
/// DXGI1-006B). Only these variants can be injected — no string-bearing
/// or arbitrary errors — and only when the `dxgi-fault-injection`
/// Cargo feature is enabled (off by default, absent from release
/// artifacts).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(feature = "dxgi-fault-injection")]
pub enum DxgiInjectableFault {
    DeviceRemoved,
    AccessLost,
    Protected,
}

#[cfg(feature = "dxgi-fault-injection")]
impl DxgiInjectableFault {
    pub(crate) fn as_error(self) -> DxgiAcquireError {
        match self {
            DxgiInjectableFault::DeviceRemoved => DxgiAcquireError::DeviceRemoved,
            DxgiInjectableFault::AccessLost => DxgiAcquireError::AccessLost,
            DxgiInjectableFault::Protected => DxgiAcquireError::Protected,
        }
    }
}

/// Map an acquisition error to the diagnostic fields it produces, so the
/// real and injected paths record identical provenance shapes (tested on
/// any host). Returns (stage, classification, canonical HRESULT if any).
///
/// A real Protected outcome never comes from an HRESULT — it comes from
/// the mask branch. The Protected arm here exists only for the
/// fault-injection seam, which can queue a Protected error directly.
pub fn diagnostic_for_acquire_error(
    err: &DxgiAcquireError,
) -> (DxgiAcquireStage, DxgiAcquireClassification, Option<i32>) {
    use DxgiAcquireClassification as C;
    use DxgiAcquireStage as S;
    match err {
        DxgiAcquireError::AccessLost => (
            S::AcquireFailed,
            C::AcquireError,
            Some(DXGI_ERROR_ACCESS_LOST as i32),
        ),
        DxgiAcquireError::WaitTimeout => (
            S::AcquireFailed,
            C::AcquireError,
            Some(DXGI_ERROR_WAIT_TIMEOUT as i32),
        ),
        DxgiAcquireError::SessionDisconnected => (
            S::AcquireFailed,
            C::AcquireError,
            Some(DXGI_ERROR_SESSION_DISCONNECTED as i32),
        ),
        DxgiAcquireError::DeviceRemoved => (
            S::AcquireFailed,
            C::AcquireError,
            Some(DXGI_ERROR_DEVICE_REMOVED as i32),
        ),
        DxgiAcquireError::Protected => (S::MaskChecked, C::Protected, None),
        DxgiAcquireError::StageFailed(_) => (S::AcquireFailed, C::StageError, None),
        DxgiAcquireError::Unavailable(_) => (S::AcquireFailed, C::AcquireError, None),
        DxgiAcquireError::Other(_) => (S::AcquireFailed, C::AcquireError, None),
    }
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
/// Win32 E_INVALIDARG (0x80070057), compared as u32 against an
/// HRESULT's bits — the code DuplicateOutput returns when a still-valid
/// duplication object already exists for the output.
const E_INVALIDARG: u32 = 0x8007_0057;

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
pub use win_backend::{
    DxgiCaptureContext, DxgiMultiOutputSession, DxgiStagedResult, DxgiStagedVariant,
};

#[cfg(windows)]
mod win_backend {
    use super::{
        checked_mapped_bytes, classify_hresult, classify_stage_error,
        diagnostic_for_acquire_error, protected_from_frame_info, validate_limits, AcquiredPixels,
        DxgiAcquireClassification, DxgiAcquireDiagnostic, DxgiAcquireProvenance,
        DxgiAcquireStage, DxgiAcquireError, DxgiCaptureOutcome, DxgiDiagnosticLog, DxgiFrameMetadata,
        DxgiLimits, DxgiMultiOutputOutcome, DxgiRotation, E_INVALIDARG, FrameGuard, OutputInfo,
        TopologySnapshot,
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
        D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
        IDXGIOutputDuplication, IDXGIResource, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTPUT_DESC,
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

    /// Process-wide context counter, so diagnostic records carry a
    /// separate-context identity even across fresh sessions in one
    /// harness process (fix round 4).
    static NEXT_CONTEXT_ID: std::sync::atomic::AtomicU64 =
        std::sync::atomic::AtomicU64::new(0);

    /// Cap for the per-context diagnostic store: old records drop, so a
    /// long sustained run cannot grow memory without bound.
    const MAX_DIAGNOSTICS: usize = 1024;

    /// Cap for the fault-injection queue (verdict DXGI1-006B): bounded,
    /// oldest drops when full, so no unbounded synthetic-error backlog.
    const MAX_INJECT_QUEUE: usize = 16;

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
        /// Fix round 4: pre-branch diagnostic store, shared with the
        /// release closures so one record covers acquire through release.
        diagnostics: std::sync::Arc<std::sync::Mutex<DxgiDiagnosticLog>>,
        /// Monotonic attempt counter; the staged API and the full loop
        /// share it so attempt numbers are unique per context.
        next_attempt: u64,
        /// Attempt number of the most recent acquire_frame_raw call, so
        /// staged results can find the record even on error paths.
        last_attempt: u64,
        /// Device generation: 0 = initial device, +1 per full rebuild.
        session_generation: u64,
        /// This context's id from [`NEXT_CONTEXT_ID`].
        context_id: u64,
        /// Fault-injection queue (feature-gated, see
        /// [`DxgiCaptureContext::inject_acquire_error`]).
        #[cfg(feature = "dxgi-fault-injection")]
        inject_queue: std::collections::VecDeque<DxgiAcquireError>,
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
                diagnostics: std::sync::Arc::new(std::sync::Mutex::new(
                    DxgiDiagnosticLog::new(MAX_DIAGNOSTICS),
                )),
                next_attempt: 0,
                last_attempt: 0,
                session_generation: 0,
                context_id: NEXT_CONTEXT_ID
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst),
                #[cfg(feature = "dxgi-fault-injection")]
                inject_queue: std::collections::VecDeque::new(),
            };
            ctx.recreate_duplication()?;
            Ok(ctx)
        }

        pub fn output_info(&self) -> &OutputInfo {
            &self.output_info
        }

        /// This context's process-wide id (fix round 4 diagnostics).
        pub fn context_id(&self) -> u64 {
            self.context_id
        }

        /// Current device generation (fix round 4 diagnostics): 0 for the
        /// initial device, +1 per full device rebuild.
        pub fn session_generation(&self) -> u64 {
            self.session_generation
        }

        /// Snapshot of this context's diagnostic records so far.
        pub fn diagnostics_snapshot(&self) -> Vec<DxgiAcquireDiagnostic> {
            self.lock_log().snapshot()
        }

        /// Drain this context's diagnostic records.
        pub fn take_diagnostics(&mut self) -> Vec<DxgiAcquireDiagnostic> {
            self.lock_log().take()
        }

        /// Fault-injection seam (fix round 4, 004A evidence; confined
        /// per verdict DXGI1-006B).
        ///
        /// Only available with the `dxgi-fault-injection` Cargo feature,
        /// which is OFF by default — this entrypoint does not exist in
        /// normal release artifacts. The queue is bounded (16, oldest
        /// drops when full) and the injectable set is fixed
        /// ([`DxgiInjectableFault`]: no string-bearing or arbitrary
        /// errors). Harness use only: it is never activated by
        /// environment or configuration, and every record it produces
        /// must be labeled "injected" in reports — injected evidence
        /// never proves real hardware device removal. A queued
        /// DeviceRemoved error drives the production recovery path (one
        /// recreate, then a terminal second failure when queued twice),
        /// which is exactly the evidence the round-3 verdict asks for,
        /// without deliberately destabilizing the GPU.
        #[cfg(feature = "dxgi-fault-injection")]
        pub fn inject_acquire_error(&mut self, fault: super::DxgiInjectableFault) {
            if self.inject_queue.len() >= MAX_INJECT_QUEUE {
                self.inject_queue.pop_front();
            }
            self.inject_queue.push_back(fault.as_error());
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
        ///
        /// Fix round 4 (J1 evidence): only ONE live duplication object
        /// may exist per output. Recovery can trigger while the old
        /// object is still valid (an injected fault, or a stage failure
        /// on a live session), and then the first DuplicateOutput fails
        /// with E_INVALIDARG — not because the new device is bad, but
        /// because the old object blocks it. On exactly that error the
        /// rebuild drops the old object and retries once; any other
        /// failure keeps the atomic-replace behavior above. A failed
        /// rebuild after the drop leaves no duplication, and the caller
        /// still treats the request as terminal.
        fn rebuild_device_and_duplication(&mut self) -> Result<(), CaptureError> {
            let (new_device, new_context) = create_device(&self._adapter)?;
            let device_iunknown: IUnknown = new_device.cast().map_err(|e| {
                CaptureError::NativeApi(format!("ID3D11Device::cast to IUnknown: {e}"))
            })?;
            let mut duplication = unsafe { self.output1.DuplicateOutput(&device_iunknown) };
            if let Err(e) = &duplication {
                if e.code().0 as u32 == E_INVALIDARG {
                    // A still-valid old duplication blocks the new one.
                    // Drop it and retry once; the atomic replace below
                    // still only installs the new set on full success.
                    self.duplication = None;
                    self.staging = None;
                    self.staging_size = (0, 0);
                    duplication = unsafe { self.output1.DuplicateOutput(&device_iunknown) };
                }
            }
            let duplication = match duplication {
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
            // Fix round 4: a successful full rebuild is a new device
            // generation; diagnostics after this point carry it.
            self.session_generation += 1;
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

        // ---------------------------------------------------------------
        // Fix round 4: pre-branch diagnostics + staged acquisition.
        //
        // The round-3 verdict's core demand: record EVERY acquired frame
        // immediately after AcquireNextFrame and BEFORE the mask branch,
        // including Protected outcomes. The round-3 metadata passthrough
        // could not do that (it was built only after copy/map). The
        // staged API runs one pipeline prefix per attempt — never two
        // outstanding acquisitions on one duplication object, never a
        // recreate, never a mask bypass — so the first failing stage is
        // observable instead of inferred.
        // ---------------------------------------------------------------

        fn lock_log(&self) -> std::sync::MutexGuard<'_, DxgiDiagnosticLog> {
            self.diagnostics.lock().unwrap_or_else(|e| e.into_inner())
        }

        fn push_diagnostic(&self, record: DxgiAcquireDiagnostic) {
            self.lock_log().push(record);
        }

        fn update_diagnostic(
            &self,
            attempt: u64,
            stage: DxgiAcquireStage,
            classification: DxgiAcquireClassification,
        ) {
            self.lock_log().update(attempt, stage, classification);
        }

        fn mark_diagnostic_failed(
            &self,
            attempt: u64,
            classification: DxgiAcquireClassification,
        ) {
            self.lock_log().mark_failed(attempt, classification);
        }

        fn diagnostic_for_attempt(&self, attempt: u64) -> Option<DxgiAcquireDiagnostic> {
            self.lock_log().get(attempt)
        }

        /// Release closure that records the ReleaseFrame HRESULT on the
        /// attempt's diagnostic record. Release still happens exactly
        /// once (FrameGuard semantics); the record update is diagnostic
        /// only and never fails the release path.
        fn release_closure(
            &self,
            duplication: IDXGIOutputDuplication,
            attempt: u64,
        ) -> FrameGuard {
            let diagnostics = std::sync::Arc::clone(&self.diagnostics);
            FrameGuard::new(move || {
                let hr = match unsafe { duplication.ReleaseFrame() } {
                    Ok(()) => 0,
                    Err(e) => e.code().0,
                };
                let mut log = diagnostics.lock().unwrap_or_else(|e| e.into_inner());
                log.mark_released(attempt, hr);
            })
        }

        /// One raw acquisition: AcquireNextFrame + guard + pre-branch
        /// diagnostic record, and nothing else. Shared by the full loop
        /// (`acquire`) and the staged API, so both paths observe the
        /// same pre-branch values.
        ///
        /// Returns (attempt, guard, frame info, resource). On error the
        /// attempt's diagnostic is already recorded; callers read it via
        /// [`DxgiCaptureContext::diagnostic_for_attempt`] using
        /// `last_attempt`.
        fn acquire_frame_raw(
            &mut self,
            timeout_ms: u32,
        ) -> Result<
            (
                u64,
                FrameGuard,
                DXGI_OUTDUPL_FRAME_INFO,
                Option<IDXGIResource>,
            ),
            DxgiAcquireError,
        > {
            let attempt = self.next_attempt;
            self.next_attempt += 1;
            self.last_attempt = attempt;
            let base = DxgiAcquireDiagnostic {
                attempt,
                context_id: self.context_id,
                session_generation: self.session_generation,
                adapter_luid: self.output_info.adapter_luid,
                output_device_name: self.output_info.device_name.clone(),
                stage_reached: DxgiAcquireStage::AcquireFailed,
                provenance: DxgiAcquireProvenance::Real,
                acquire_hresult: None,
                protected_content_masked_out: None,
                accumulated_frames: None,
                rects_coalesced: None,
                last_present_time: None,
                total_metadata_size: None,
                pointer_shape_size: None,
                classification: DxgiAcquireClassification::AcquireError,
                release_hresult: None,
                released: false,
            };
            // Fault-injection seam (feature-gated, verdict DXGI1-006B):
            // a queued synthetic error short-circuits the real
            // AcquireNextFrame and is recorded as Injected.
            #[cfg(feature = "dxgi-fault-injection")]
            if let Some(err) = self.inject_queue.pop_front() {
                let (stage, classification, hr) = diagnostic_for_acquire_error(&err);
                self.push_diagnostic(DxgiAcquireDiagnostic {
                    stage_reached: stage,
                    provenance: DxgiAcquireProvenance::Injected,
                    acquire_hresult: hr,
                    classification,
                    ..base
                });
                return Err(err);
            }
            let duplication = match &self.duplication {
                Some(d) => d.clone(),
                None => {
                    self.push_diagnostic(base);
                    return Err(DxgiAcquireError::Unavailable(
                        "duplication object not initialized".into(),
                    ));
                }
            };
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            let acquire_result =
                unsafe { duplication.AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource) };
            if let Err(e) = acquire_result {
                let hr = e.code().0;
                let (stage, classification, _) =
                    diagnostic_for_acquire_error(&classify_hresult(hr));
                self.push_diagnostic(DxgiAcquireDiagnostic {
                    stage_reached: stage,
                    acquire_hresult: Some(hr),
                    classification,
                    ..base
                });
                return Err(classify_hresult(hr));
            }
            // Guard FIRST (DXGI1-001), then the pre-branch record: every
            // path below releases exactly once, and the record exists
            // before the mask branch evaluates.
            let guard = self.release_closure(duplication, attempt);
            self.push_diagnostic(DxgiAcquireDiagnostic {
                stage_reached: DxgiAcquireStage::Acquired,
                protected_content_masked_out: Some(frame_info.ProtectedContentMaskedOut.0),
                accumulated_frames: Some(frame_info.AccumulatedFrames),
                rects_coalesced: Some(frame_info.RectsCoalesced.0),
                last_present_time: Some(frame_info.LastPresentTime),
                total_metadata_size: Some(frame_info.TotalMetadataBufferSize),
                pointer_shape_size: Some(frame_info.PointerShapeBufferSize),
                classification: DxgiAcquireClassification::Pending,
                ..base
            });
            Ok((attempt, guard, frame_info, resource))
        }

        /// Evaluate the fail-closed mask branch for one raw frame,
        /// updating the attempt's diagnostic. The caller drops the guard
        /// on the Protected return; the record keeps stage MaskChecked.
        fn evaluate_mask(
            &self,
            attempt: u64,
            frame_info: &DXGI_OUTDUPL_FRAME_INFO,
        ) -> Result<(), DxgiAcquireError> {
            match protected_from_frame_info(frame_info.ProtectedContentMaskedOut.as_bool()) {
                Some(err) => {
                    self.update_diagnostic(
                        attempt,
                        DxgiAcquireStage::MaskChecked,
                        DxgiAcquireClassification::Protected,
                    );
                    Err(err)
                }
                None => {
                    self.update_diagnostic(
                        attempt,
                        DxgiAcquireStage::MaskChecked,
                        DxgiAcquireClassification::Pass,
                    );
                    Ok(())
                }
            }
        }

        /// Cast the acquired resource and read its texture descriptor.
        /// Pure prefix step shared by the full loop and the staged API.
        fn inspect_resource(
            &self,
            attempt: u64,
            resource: Option<IDXGIResource>,
        ) -> Result<(ID3D11Texture2D, u32, u32), DxgiAcquireError> {
            let resource = match resource {
                Some(r) => r,
                None => {
                    return Err(DxgiAcquireError::Other(
                        "AcquireNextFrame succeeded with no resource".into(),
                    ))
                }
            };
            let texture: ID3D11Texture2D = match resource.cast() {
                Ok(t) => t,
                Err(e) => {
                    return Err(DxgiAcquireError::Other(format!(
                        "acquired resource is not a texture: {e}"
                    )))
                }
            };
            let mut tex_desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut tex_desc) };
            self.update_diagnostic(
                attempt,
                DxgiAcquireStage::ResourceInspected,
                DxgiAcquireClassification::Pass,
            );
            Ok((texture, tex_desc.Width, tex_desc.Height))
        }

        /// Enforce limits, allocate (or reuse) the staging texture, and
        /// enqueue CopyResource. The caller releases the frame guard
        /// after this step, before any mapping (brief order).
        fn copy_to_staging(
            &mut self,
            attempt: u64,
            texture: &ID3D11Texture2D,
            width: u32,
            height: u32,
            limits: &DxgiLimits,
        ) -> Result<ID3D11Texture2D, DxgiAcquireError> {
            // DXGI1-002: limits before any staging texture or host
            // allocation sized from the frame.
            if let Err(e) = validate_limits(width, height, limits) {
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
                    // staging stage; other failures become StageFailed.
                    return Err(classify_stage_error(e.code().0));
                }
                self.staging = staging;
                self.staging_size = (width, height);
            }
            let staging = match &self.staging {
                Some(s) => s.clone(),
                None => {
                    return Err(DxgiAcquireError::Other(
                        "staging texture missing after create".into(),
                    ))
                }
            };
            // Full-output copy; the requested rect is cropped on the CPU
            // (DXGI-1 simplicity — DXGI-2 may copy sub-boxes instead).
            unsafe {
                self.device_context
                    .CopyResource(&staging, texture);
            }
            self.update_diagnostic(
                attempt,
                DxgiAcquireStage::StagingCopied,
                DxgiAcquireClassification::Pass,
            );
            Ok(staging)
        }

        /// Map the staging texture, copy its bytes to the host, unmap.
        /// The unmap guard is established immediately after a successful
        /// Map, so the mapped state releases on every path, including
        /// unwind — never a manual Map/Unmap pair.
        fn map_and_copy(
            &mut self,
            attempt: u64,
            staging: &ID3D11Texture2D,
            height: u32,
            limits: &DxgiLimits,
        ) -> Result<(usize, Vec<u8>), DxgiAcquireError> {
            let staging_resource: ID3D11Resource = match staging.cast() {
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
            let unmap_guard = FrameGuard::new({
                let dc = self.device_context.clone();
                let res = staging_resource.clone();
                move || {
                    unsafe { dc.Unmap(&res, 0) };
                }
            });
            let row_pitch = mapped.RowPitch as usize;
            // DXGI1-002: checked pitch arithmetic and the raster budget
            // are enforced BEFORE allocating the host buffer.
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
            self.update_diagnostic(
                attempt,
                DxgiAcquireStage::Mapped,
                DxgiAcquireClassification::Pass,
            );
            Ok((row_pitch, bgra))
        }

        /// Run ONE staged pipeline prefix (fix round 4 experiment API).
        ///
        /// Single attempt, no retry loop, no recreate: a loss or failure
        /// ends the attempt and is reported, never retried. The frame is
        /// released exactly once on every path. The returned diagnostic
        /// snapshot is the attempt's record after the variant completes,
        /// so the harness compares pre-branch metadata against the
        /// resulting classification from the same record.
        pub fn acquire_staged(
            &mut self,
            variant: DxgiStagedVariant,
            timeout_ms: u32,
            limits: &DxgiLimits,
        ) -> DxgiStagedResult {
            let (attempt, mut guard, frame_info, resource) =
                match self.acquire_frame_raw(timeout_ms) {
                    Ok(t) => t,
                    Err(_) => {
                        // The attempt's diagnostic is already recorded.
                        let diagnostic = self
                            .diagnostic_for_attempt(self.last_attempt)
                            .expect("acquire_frame_raw always records a diagnostic");
                        let classification = diagnostic.classification;
                        return DxgiStagedResult {
                            attempt: self.last_attempt,
                            diagnostic,
                            classification,
                            stage_error: None,
                            width: None,
                            height: None,
                            row_pitch: None,
                            host_bytes: None,
                        };
                    }
                };
            // Mask branch first, whatever the variant: a Protected frame
            // never proceeds to any later stage.
            if let Err(e) = self.evaluate_mask(attempt, &frame_info) {
                drop(guard);
                let diagnostic = self
                    .diagnostic_for_attempt(attempt)
                    .expect("staged attempt record exists");
                return DxgiStagedResult {
                    attempt,
                    diagnostic,
                    classification: DxgiAcquireClassification::Protected,
                    stage_error: Some(format!("{e:?}")),
                    width: None,
                    height: None,
                    row_pitch: None,
                    host_bytes: None,
                };
            }
            if variant == DxgiStagedVariant::AcquireOnly {
                drop(guard);
                let diagnostic = self
                    .diagnostic_for_attempt(attempt)
                    .expect("staged attempt record exists");
                return DxgiStagedResult {
                    attempt,
                    diagnostic,
                    classification: DxgiAcquireClassification::Pass,
                    stage_error: None,
                    width: None,
                    height: None,
                    row_pitch: None,
                    host_bytes: None,
                };
            }
            let (texture, width, height) = match self.inspect_resource(attempt, resource) {
                Ok(t) => t,
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    drop(guard);
                    let diagnostic = self
                        .diagnostic_for_attempt(attempt)
                        .expect("staged attempt record exists");
                    return DxgiStagedResult {
                        attempt,
                        diagnostic,
                        classification: DxgiAcquireClassification::StageError,
                        stage_error: Some(format!("{e:?}")),
                        width: None,
                        height: None,
                        row_pitch: None,
                        host_bytes: None,
                    };
                }
            };
            if variant == DxgiStagedVariant::ResourceInspected {
                drop(guard);
                let diagnostic = self
                    .diagnostic_for_attempt(attempt)
                    .expect("staged attempt record exists");
                return DxgiStagedResult {
                    attempt,
                    diagnostic,
                    classification: DxgiAcquireClassification::Pass,
                    stage_error: None,
                    width: Some(width),
                    height: Some(height),
                    row_pitch: None,
                    host_bytes: None,
                };
            }
            let staging = match self.copy_to_staging(attempt, &texture, width, height, limits) {
                Ok(s) => s,
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    drop(guard);
                    let diagnostic = self
                        .diagnostic_for_attempt(attempt)
                        .expect("staged attempt record exists");
                    return DxgiStagedResult {
                        attempt,
                        diagnostic,
                        classification: DxgiAcquireClassification::StageError,
                        stage_error: Some(format!("{e:?}")),
                        width: Some(width),
                        height: Some(height),
                        row_pitch: None,
                        host_bytes: None,
                    };
                }
            };
            // Brief order: release before CPU mapping/conversion.
            guard.release();
            if variant == DxgiStagedVariant::StagingCopied {
                let diagnostic = self
                    .diagnostic_for_attempt(attempt)
                    .expect("staged attempt record exists");
                return DxgiStagedResult {
                    attempt,
                    diagnostic,
                    classification: DxgiAcquireClassification::Pass,
                    stage_error: None,
                    width: Some(width),
                    height: Some(height),
                    row_pitch: None,
                    host_bytes: None,
                };
            }
            match self.map_and_copy(attempt, &staging, height, limits) {
                Ok((row_pitch, bgra)) => {
                    let host_bytes = bgra.len();
                    let diagnostic = self
                        .diagnostic_for_attempt(attempt)
                        .expect("staged attempt record exists");
                    DxgiStagedResult {
                        attempt,
                        diagnostic,
                        classification: DxgiAcquireClassification::Pass,
                        stage_error: None,
                        width: Some(width),
                        height: Some(height),
                        row_pitch: Some(row_pitch),
                        host_bytes: Some(host_bytes),
                    }
                }
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    let diagnostic = self
                        .diagnostic_for_attempt(attempt)
                        .expect("staged attempt record exists");
                    DxgiStagedResult {
                        attempt,
                        diagnostic,
                        classification: DxgiAcquireClassification::StageError,
                        stage_error: Some(format!("{e:?}")),
                        width: Some(width),
                        height: Some(height),
                        row_pitch: None,
                        host_bytes: None,
                    }
                }
            }
        }
    }

    /// One staged pipeline prefix (fix round 4 experiment API).
    ///
    /// Stage 5, the complete wrapper loop, is [`DxgiCaptureContext::capture_rect`]
    /// itself; these four variants are the prefixes it is compared against.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum DxgiStagedVariant {
        /// Acquire + pre-branch diagnostic + ReleaseFrame only.
        AcquireOnly,
        /// + resource cast + texture descriptor inspection.
        ResourceInspected,
        /// + staging allocation + CopyResource, then release (before map).
        StagingCopied,
        /// + Map/Unmap + host copy.
        MapCopied,
    }

    /// Result of one staged acquisition attempt. Dimensions and byte
    /// counts only — never pixel values.
    #[derive(Debug, Clone)]
    pub struct DxgiStagedResult {
        pub attempt: u64,
        pub diagnostic: DxgiAcquireDiagnostic,
        pub classification: DxgiAcquireClassification,
        pub stage_error: Option<String>,
        pub width: Option<u32>,
        pub height: Option<u32>,
        pub row_pitch: Option<usize>,
        pub host_bytes: Option<usize>,
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
            // Fix round 4: the full loop is the same staged chain the
            // experiment API runs, so stage-5 evidence is comparable
            // with stages 1-4 instead of a parallel implementation.
            let (attempt, mut guard, frame_info, resource) =
                self.acquire_frame_raw(timeout_ms)?;
            // DXGI1-003: fail-closed protected-content rule, checked
            // before any pixel handling. Any nonzero mask means the
            // frame carries masked protected pixels and must never be
            // returned as an ordinary frame; the guard releases on
            // this return.
            if let Err(e) = self.evaluate_mask(attempt, &frame_info) {
                drop(guard);
                return Err(e);
            }
            let (texture, width, height) = match self.inspect_resource(attempt, resource) {
                Ok(t) => t,
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    drop(guard);
                    return Err(e);
                }
            };
            let staging = match self.copy_to_staging(attempt, &texture, width, height, limits) {
                Ok(s) => s,
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    drop(guard);
                    return Err(e);
                }
            };
            // Brief order: ReleaseFrame before CPU mapping/conversion.
            // The guard still protected the acquire→copy window, and
            // its Drop covers unwind inside the steps above.
            guard.release();
            let (row_pitch, bgra) = match self.map_and_copy(attempt, &staging, height, limits) {
                Ok(t) => t,
                Err(e) => {
                    self.mark_diagnostic_failed(attempt, DxgiAcquireClassification::StageError);
                    return Err(e);
                }
            };
            // DXGI1 fix round 3: carry the raw frame metadata through
            // so hardware harnesses can log it per acquire. Diagnostic
            // only; the fail-closed mask rule above is unchanged. (The
            // round-4 pre-branch record in DxgiAcquireDiagnostic covers
            // Protected outcomes too; this passthrough covers Frame
            // outcomes through the public capture API.)
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

    /// DXGI-2 multi-output session: one [`DxgiCaptureContext`] per
    /// attached output, plus the [`TopologySnapshot`] they were built
    /// from.
    ///
    /// The session is the real [`MultiOutputBackend`]: the pure
    /// [`capture_multi_output`](super::capture_multi_output) loop drives
    /// it, so rotation/crop/composition/retry behavior is identical
    /// between the mock tests and real hardware. Dispatch is still NOT
    /// wired: nothing calls this session from production code yet
    /// (DXGI-3 owns dispatch). Only tests and harnesses construct it.
    ///
    /// Topology refresh rebuilds ALL contexts wholesale: stale
    /// duplication objects, staging textures, and devices never survive
    /// a reconfiguration, and the old contexts drop (releasing their
    /// resources) only after the fresh set is fully built.
    pub struct DxgiMultiOutputSession {
        contexts: Vec<DxgiCaptureContext>,
        snapshot: TopologySnapshot,
    }

    impl DxgiMultiOutputSession {
        /// Enumerate attached outputs and bind one context per output.
        ///
        /// Index alignment between `enumerate_outputs` and `for_output`
        /// is VERIFIED by device name, not assumed: a mismatch is an
        /// error, because a misbound context would capture the wrong
        /// monitor while claiming the right identity.
        pub fn enumerate() -> Result<Self, CaptureError> {
            let outputs = DxgiCaptureContext::enumerate_outputs()?;
            let mut contexts = Vec::new();
            for (index, info) in outputs.iter().enumerate() {
                let ctx = DxgiCaptureContext::for_output(index)?;
                if ctx.output_info().device_name != info.device_name {
                    return Err(CaptureError::NativeApi(format!(
                        "DXGI-2 session: enumeration index {index} maps to \
                         {} but the context bound {}",
                        info.device_name,
                        ctx.output_info().device_name
                    )));
                }
                contexts.push(ctx);
            }
            let snapshot = TopologySnapshot::from_outputs(outputs).map_err(|e| {
                CaptureError::NativeApi(format!("DXGI-2 topology: {e}"))
            })?;
            Ok(Self { contexts, snapshot })
        }

        pub fn snapshot(&self) -> &TopologySnapshot {
            &self.snapshot
        }

        /// Capture `rect` across every intersecting output in this
        /// session's snapshot (DXGI-2 path; production dispatch still
        /// owns which rects reach here — DXGI-3).
        pub fn capture_rect(
            &mut self,
            rect: RectI,
            limits: &DxgiLimits,
        ) -> DxgiMultiOutputOutcome {
            let snapshot = self.snapshot.clone();
            super::capture_multi_output(self, &snapshot, rect, limits)
        }
    }

    impl super::MultiOutputBackend for DxgiMultiOutputSession {
        fn acquire_output(
            &mut self,
            output: &OutputInfo,
            timeout_ms: u32,
            limits: &DxgiLimits,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            let ctx = self
                .contexts
                .iter_mut()
                .find(|c| c.output_info().device_name == output.device_name)
                .ok_or_else(|| {
                    DxgiAcquireError::Unavailable(format!(
                        "no DXGI context for output {}",
                        output.device_name
                    ))
                })?;
            <DxgiCaptureContext as super::DuplicationBackend>::acquire(ctx, timeout_ms, limits)
        }

        fn recreate_all(&mut self) -> Result<(), DxgiAcquireError> {
            // DXGI2-001: all-or-nothing, mirroring `refresh_snapshot`'s
            // build-then-swap shape. Each fresh context is built with
            // the same `for_output` construction `enumerate` uses, and
            // its device name must match the context it replaces — a
            // topology shift mid-rebuild is an error, not a misbound
            // context. Any failure leaves the old set (and the old
            // snapshot) completely intact, so no later request can
            // mix generations; the old contexts drop only after the
            // fresh set is fully built.
            super::rebuild_all_or_nothing(&mut self.contexts, |index, old| {
                let ctx = DxgiCaptureContext::for_output(index)
                    .map_err(|e| DxgiAcquireError::Other(e.to_string()))?;
                if ctx.output_info().device_name != old.output_info().device_name {
                    return Err(DxgiAcquireError::Other(format!(
                        "DXGI-2 session: recreate index {index} bound {} but the old \
                         context served {}",
                        ctx.output_info().device_name,
                        old.output_info().device_name
                    )));
                }
                Ok(ctx)
            })
        }

        fn refresh_snapshot(&mut self) -> Result<TopologySnapshot, String> {
            // Build the fresh set completely before replacing anything:
            // a failed re-enumeration leaves the old session intact.
            let fresh = Self::enumerate().map_err(|e| e.to_string())?;
            let next = self
                .snapshot
                .refresh(fresh.snapshot.outputs)
                .map_err(|e| e.to_string())?;
            self.contexts = fresh.contexts;
            self.snapshot = next.clone();
            Ok(next)
        }

        fn snapshot_generation(&self) -> u64 {
            self.snapshot.generation
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

    /// DXGI-2 hardware acceptance (IGNORED by default): real two-output
    /// capture on Windows hardware. Run ONLY on a machine with at least
    /// two attached outputs, per `docs/DXGI2_HARDWARE_TEST_PROCEDURE.md`:
    ///
    /// ```powershell
    /// cargo test -p forge-capture-core --lib dxgi2_two_output_hardware_capture -- --ignored --nocapture
    /// ```
    ///
    /// The test captures the whole virtual desktop, asserts the
    /// composite dimensions equal the virtual bounds, logs every
    /// output's rect/rotation/acquisition metadata and the
    /// present-time tick skew, and writes a PNG (path from
    /// `DXGI2_HARDWARE_PNG_PATH`, default `dxgi2-two-output.png`) for
    /// the visual orientation check the procedure requires — dimensions
    /// alone cannot distinguish a clockwise from a counter-clockwise
    /// rotation. It is NOT run by the default suite and is NOT claimed
    /// anywhere until it has actually run on hardware.
    #[test]
    #[ignore = "requires real Windows multi-output hardware (see DXGI2_HARDWARE_TEST_PROCEDURE.md)"]
    fn dxgi2_two_output_hardware_capture() {
        let mut session =
            DxgiMultiOutputSession::enumerate().expect("enumerate DXGI outputs");
        let snapshot = session.snapshot().clone();
        eprintln!(
            "DXGI-2 hardware: {} outputs, generation {}",
            snapshot.outputs.len(),
            snapshot.generation
        );
        for output in &snapshot.outputs {
            eprintln!(
                "  {} rect=({},{}) {}x{} rotation={:?} luid={:?}",
                output.device_name,
                output.rect.x,
                output.rect.y,
                output.rect.w,
                output.rect.h,
                output.rotation,
                output.adapter_luid
            );
        }
        assert!(
            snapshot.outputs.len() >= 2,
            "DXGI-2 hardware test requires at least two attached outputs; found {}",
            snapshot.outputs.len()
        );
        let bounds = snapshot.virtual_bounds().expect("virtual bounds");
        let composite = match session.capture_rect(bounds, &DxgiLimits::default()) {
            DxgiMultiOutputOutcome::Frame(composite) => composite,
            other => panic!("expected Frame, got {other:?}"),
        };
        assert_eq!(
            (
                composite.frame.width as u64,
                composite.frame.height as u64
            ),
            (bounds.w, bounds.h),
            "composite dimensions must equal the virtual desktop bounds"
        );
        assert_eq!(
            composite.per_output.len(),
            snapshot.outputs.len(),
            "every attached output intersects the virtual bounds"
        );
        assert!(
            !composite.frame.rgba.is_empty(),
            "composite raster must not be empty"
        );
        for record in &composite.per_output {
            eprintln!(
                "  acquired #{} {} last_present_time={} accumulated_frames={}",
                record.sequence,
                record.device_name,
                record.frame_info.last_present_time,
                record.frame_info.accumulated_frames
            );
        }
        if let Some(skew) = super::present_time_skew_ticks(&composite.per_output) {
            eprintln!("  present-time skew: {skew} QueryPerformanceCounter ticks");
        } else {
            eprintln!("  present-time skew: unknown (fewer than two outputs or a zero present time)");
        }
        let png = crate::png::encode_rgba(
            composite.frame.width,
            composite.frame.height,
            &composite.frame.rgba,
        )
        .expect("encode composite PNG");
        let path = std::env::var("DXGI2_HARDWARE_PNG_PATH")
            .unwrap_or_else(|_| "dxgi2-two-output.png".to_string());
        std::fs::write(&path, &png).expect("write composite PNG");
        eprintln!(
            "  wrote {path} ({} bytes) — inspect visually for orientation/mirroring",
            png.len()
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

    // DXGI1 fix round 4: the diagnostic log drops the OLDEST records
    // past its cap, so a long sustained run cannot grow memory without
    // bound — and the newest records (the ones a harness reads) survive.
    fn test_diagnostic(attempt: u64) -> DxgiAcquireDiagnostic {
        DxgiAcquireDiagnostic {
            attempt,
            context_id: 0,
            session_generation: 0,
            adapter_luid: (0, 0),
            output_device_name: "\\\\.\\DISPLAY1".to_string(),
            stage_reached: DxgiAcquireStage::Acquired,
            provenance: DxgiAcquireProvenance::Real,
            acquire_hresult: None,
            protected_content_masked_out: Some(0),
            accumulated_frames: Some(1),
            rects_coalesced: Some(0),
            last_present_time: Some(0),
            total_metadata_size: Some(0),
            pointer_shape_size: Some(0),
            classification: DxgiAcquireClassification::Pending,
            release_hresult: None,
            released: false,
        }
    }

    #[test]
    fn diagnostic_log_cap_drops_oldest_records() {
        let mut log = DxgiDiagnosticLog::new(3);
        for attempt in 0..5 {
            log.push(test_diagnostic(attempt));
        }
        assert_eq!(log.len(), 3);
        let attempts: Vec<u64> = log.snapshot().iter().map(|r| r.attempt).collect();
        assert_eq!(attempts, vec![2, 3, 4]);
    }

    // DXGI1 fix round 4: stage updates only move forward, a Protected
    // classification is never overwritten by a later stage failure, and
    // release is recorded exactly once on the same record.
    #[test]
    fn diagnostic_log_update_rules() {
        let mut log = DxgiDiagnosticLog::new(16);
        log.push(test_diagnostic(0));
        // Backward stage move is ignored.
        log.update(
            0,
            DxgiAcquireStage::AcquireFailed,
            DxgiAcquireClassification::AcquireError,
        );
        let record = log.get(0).unwrap();
        assert_eq!(record.stage_reached, DxgiAcquireStage::Acquired);
        assert_eq!(record.classification, DxgiAcquireClassification::Pending);
        // Forward move applies.
        log.update(
            0,
            DxgiAcquireStage::MaskChecked,
            DxgiAcquireClassification::Protected,
        );
        let record = log.get(0).unwrap();
        assert_eq!(record.stage_reached, DxgiAcquireStage::MaskChecked);
        assert_eq!(record.classification, DxgiAcquireClassification::Protected);
        // A later stage failure must NOT overwrite Protected.
        log.mark_failed(0, DxgiAcquireClassification::StageError);
        assert_eq!(
            log.get(0).unwrap().classification,
            DxgiAcquireClassification::Protected
        );
        // Release records once.
        log.mark_released(0, 0);
        let record = log.get(0).unwrap();
        assert!(record.released);
        assert_eq!(record.release_hresult, Some(0));
        log.mark_released(0, -1);
        assert_eq!(log.get(0).unwrap().release_hresult, Some(0));
    }

    // DXGI1 fix round 4: a failed record keeps its Protected status
    // open to a release update but closed to a failure overwrite, and a
    // non-Protected record accepts the failure classification.
    #[test]
    fn diagnostic_log_mark_failed_on_pass_record() {
        let mut log = DxgiDiagnosticLog::new(16);
        log.push(test_diagnostic(1));
        log.update(
            1,
            DxgiAcquireStage::MaskChecked,
            DxgiAcquireClassification::Pass,
        );
        log.mark_failed(1, DxgiAcquireClassification::StageError);
        assert_eq!(
            log.get(1).unwrap().classification,
            DxgiAcquireClassification::StageError
        );
        // Stage is untouched by mark_failed.
        assert_eq!(
            log.get(1).unwrap().stage_reached,
            DxgiAcquireStage::MaskChecked
        );
    }

    // DXGI1 fix round 4: error → diagnostic mapping is identical for
    // the real and injected paths, so provenance is the only difference
    // between a hardware failure record and an injected one.
    #[test]
    fn diagnostic_error_mapping_covers_all_variants() {
        use DxgiAcquireClassification as C;
        use DxgiAcquireStage as S;
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::AccessLost),
            (S::AcquireFailed, C::AcquireError, Some(DXGI_ERROR_ACCESS_LOST as i32))
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::WaitTimeout),
            (S::AcquireFailed, C::AcquireError, Some(DXGI_ERROR_WAIT_TIMEOUT as i32))
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::SessionDisconnected),
            (
                S::AcquireFailed,
                C::AcquireError,
                Some(DXGI_ERROR_SESSION_DISCONNECTED as i32)
            )
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::DeviceRemoved),
            (S::AcquireFailed, C::AcquireError, Some(DXGI_ERROR_DEVICE_REMOVED as i32))
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::Protected),
            (S::MaskChecked, C::Protected, None)
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::StageFailed("x".into())),
            (S::AcquireFailed, C::StageError, None)
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::Unavailable("x".into())),
            (S::AcquireFailed, C::AcquireError, None)
        );
        assert_eq!(
            diagnostic_for_acquire_error(&DxgiAcquireError::Other("x".into())),
            (S::AcquireFailed, C::AcquireError, None)
        );
    }

    // DXGI1 fix round 4, verdict DXGI1-006B: the injection entrypoint
    // must not exist in the default (release) configuration. This test
    // trips if the suite is ever run with the feature enabled: it
    // proves the default configuration lacks the seam. Harnesses
    // enable the feature explicitly and separately.
    #[test]
    fn injection_feature_off_by_default() {
        assert!(!cfg!(feature = "dxgi-fault-injection"));
    }

    // DXGI1 fix round 4: stage order is strictly monotonic, so a
    // harness can assert "first failing stage" from record order.
    #[test]
    fn diagnostic_stage_order_is_monotonic() {
        use DxgiAcquireStage as S;
        let stages = [
            S::AcquireFailed,
            S::Acquired,
            S::MaskChecked,
            S::ResourceInspected,
            S::StagingCopied,
            S::Mapped,
        ];
        let orders: Vec<u8> = stages.iter().map(|s| s.order()).collect();
        let mut sorted = orders.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(orders, sorted);
        assert_eq!(orders.len(), 6);
    }
}

#[cfg(test)]
mod dxgi2_tests {
    use super::*;
    use std::collections::{HashMap, VecDeque};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn out(
        name: &str,
        x: i64,
        y: i64,
        w: u64,
        h: u64,
        rotation: DxgiRotation,
    ) -> OutputInfo {
        OutputInfo {
            index: 0,
            device_name: name.to_string(),
            adapter_luid: (0, 0),
            rect: RectI { x, y, w, h },
            rotation,
        }
    }

    /// Primary at the origin + a secondary to its LEFT (negative origin).
    fn left_snapshot() -> TopologySnapshot {
        TopologySnapshot::from_outputs(vec![
            out("\\\\.\\DISPLAY1", 0, 0, 4, 2, DxgiRotation::Identity),
            out("\\\\.\\DISPLAY2", -4, 0, 4, 2, DxgiRotation::Identity),
        ])
        .unwrap()
    }

    /// Primary at the origin + a secondary to its RIGHT.
    fn right_snapshot() -> TopologySnapshot {
        TopologySnapshot::from_outputs(vec![
            out("\\\\.\\DISPLAY1", 0, 0, 4, 2, DxgiRotation::Identity),
            out("\\\\.\\DISPLAY2", 4, 0, 4, 2, DxgiRotation::Identity),
        ])
        .unwrap()
    }

    /// Solid BGRA frame (payload pitch, no padding) for one output.
    fn solid_pixels(width: u32, height: u32, bgra: [u8; 4]) -> AcquiredPixels {
        let mut bgra_bytes = Vec::new();
        for _ in 0..width * height {
            bgra_bytes.extend_from_slice(&bgra);
        }
        AcquiredPixels {
            width,
            height,
            row_pitch: width as usize * 4,
            bgra: bgra_bytes,
            frame_info: DxgiFrameMetadata::default(),
        }
    }

    fn solid_pixels_with_present(
        width: u32,
        height: u32,
        bgra: [u8; 4],
        last_present_time: i64,
    ) -> AcquiredPixels {
        let mut pixels = solid_pixels(width, height, bgra);
        pixels.frame_info.last_present_time = last_present_time;
        pixels
    }

    /// Gradient BGRA frame: R channel = local_x * 10 + local_y, so any
    /// crop offset is visible in the output values. (BGRA order: the
    /// R value sits at byte 2 of each pixel; conversion flips it to
    /// byte 0 of the RGBA output.)
    fn gradient_pixels(width: u32, height: u32) -> AcquiredPixels {
        let mut bgra_bytes = Vec::new();
        for y in 0..height {
            for x in 0..width {
                let r = (x * 10 + y) as u8;
                bgra_bytes.extend_from_slice(&[0, 0, r, 0]);
            }
        }
        AcquiredPixels {
            width,
            height,
            row_pitch: width as usize * 4,
            bgra: bgra_bytes,
            frame_info: DxgiFrameMetadata::default(),
        }
    }

    /// R channel of every pixel in a composited RGBA frame, row-major.
    fn reds(frame: &DxgiFrame) -> Vec<u8> {
        frame
            .rgba
            .chunks_exact(4)
            .map(|px| px[0])
            .collect()
    }

    #[derive(Clone)]
    enum MStep {
        Ok(AcquiredPixels),
        Err(DxgiAcquireError),
    }

    struct MultiMock {
        steps: HashMap<String, VecDeque<MStep>>,
        /// Outputs the mock serves after a refresh (mode-change /
        /// unplug simulation). `None` means "same outputs as before".
        refresh_outputs: Option<Vec<OutputInfo>>,
        snapshot: TopologySnapshot,
        releases: Arc<AtomicUsize>,
        recreates: Arc<AtomicUsize>,
        refresh_calls: Arc<AtomicUsize>,
        acquire_calls: Arc<AtomicUsize>,
        /// Fire a generation-only change after this many total
        /// acquires (external-change simulation); fires once.
        flip_after: Option<usize>,
    }

    impl MultiMock {
        fn new(snapshot: TopologySnapshot, steps: Vec<(String, Vec<MStep>)>) -> Self {
            Self {
                steps: steps
                    .into_iter()
                    .map(|(k, v)| (k, v.into()))
                    .collect(),
                refresh_outputs: None,
                snapshot,
                releases: Arc::new(AtomicUsize::new(0)),
                recreates: Arc::new(AtomicUsize::new(0)),
                refresh_calls: Arc::new(AtomicUsize::new(0)),
                acquire_calls: Arc::new(AtomicUsize::new(0)),
                flip_after: None,
            }
        }
    }

    impl MultiOutputBackend for MultiMock {
        fn acquire_output(
            &mut self,
            output: &OutputInfo,
            _timeout_ms: u32,
            _limits: &DxgiLimits,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            let calls = self.acquire_calls.fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(at) = self.flip_after {
                if calls >= at {
                    self.flip_after = None;
                    self.snapshot.generation =
                        self.snapshot.generation.saturating_add(1);
                }
            }
            match self.steps.get_mut(&output.device_name).and_then(|q| q.pop_front()) {
                Some(MStep::Ok(pixels)) => {
                    let releases = Arc::clone(&self.releases);
                    Ok((
                        FrameGuard::new(move || {
                            releases.fetch_add(1, Ordering::SeqCst);
                        }),
                        pixels,
                    ))
                }
                Some(MStep::Err(e)) => Err(e),
                None => Err(DxgiAcquireError::Other("mock script exhausted".into())),
            }
        }

        fn recreate_all(&mut self) -> Result<(), DxgiAcquireError> {
            self.recreates.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn refresh_snapshot(&mut self) -> Result<TopologySnapshot, String> {
            self.refresh_calls.fetch_add(1, Ordering::SeqCst);
            let outputs = self
                .refresh_outputs
                .clone()
                .unwrap_or_else(|| self.snapshot.outputs.clone());
            self.snapshot = self
                .snapshot
                .refresh(outputs)
                .map_err(|e| e.to_string())?;
            Ok(self.snapshot.clone())
        }

        fn snapshot_generation(&self) -> u64 {
            self.snapshot.generation
        }
    }

    fn frame_of(outcome: DxgiMultiOutputOutcome) -> DxgiCompositeFrame {
        match outcome {
            DxgiMultiOutputOutcome::Frame(composite) => composite,
            other => panic!("expected Frame, got {other:?}"),
        }
    }

    // --- Rotation fixtures: 2 wide x 3 high, R channel identifies
    // each pixel (a=10, b=20, c=30, d=40, e=50, f=60):
    //   rows: [a b; c d; e f]
    fn asymmetric_frame() -> DxgiFrame {
        let mut rgba = Vec::new();
        for r in [10u8, 20, 30, 40, 50, 60] {
            rgba.extend_from_slice(&[r, 0, 0, 255]);
        }
        DxgiFrame {
            width: 2,
            height: 3,
            rgba,
            frame_info: DxgiFrameMetadata::default(),
        }
    }

    #[test]
    fn rotation_identity_is_unchanged() {
        let frame = asymmetric_frame();
        let rotated = rotate_frame(&frame, DxgiRotation::Identity).unwrap();
        assert_eq!(rotated, frame);
        assert_eq!(
            rotated_dimensions(2, 3, DxgiRotation::Identity),
            Some((2, 3))
        );
    }

    #[test]
    fn rotation_90_is_clockwise() {
        // CW: rows [e c a; f d b].
        let rotated = rotate_frame(&asymmetric_frame(), DxgiRotation::Rotate90).unwrap();
        assert_eq!((rotated.width, rotated.height), (3, 2));
        assert_eq!(reds(&rotated), vec![50, 30, 10, 60, 40, 20]);
        assert_eq!(
            rotated_dimensions(2, 3, DxgiRotation::Rotate90),
            Some((3, 2))
        );
    }

    #[test]
    fn rotation_270_is_counter_clockwise() {
        // CCW: rows [b d f; a c e].
        let rotated = rotate_frame(&asymmetric_frame(), DxgiRotation::Rotate270).unwrap();
        assert_eq!((rotated.width, rotated.height), (3, 2));
        assert_eq!(reds(&rotated), vec![20, 40, 60, 10, 30, 50]);
    }

    #[test]
    fn rotation_180_reverses_both_axes() {
        // rows [f e; d c; b a].
        let rotated = rotate_frame(&asymmetric_frame(), DxgiRotation::Rotate180).unwrap();
        assert_eq!((rotated.width, rotated.height), (2, 3));
        assert_eq!(reds(&rotated), vec![60, 50, 40, 30, 20, 10]);
    }

    #[test]
    fn rotation_unspecified_is_refused_not_guessed() {
        assert_eq!(
            rotate_frame(&asymmetric_frame(), DxgiRotation::Unspecified),
            None
        );
        assert_eq!(
            rotated_dimensions(2, 3, DxgiRotation::Unspecified),
            None
        );
    }

    #[test]
    fn rotation_round_trips() {
        // 90 then 270 returns the original pixels exactly.
        let frame = asymmetric_frame();
        let once = rotate_frame(&frame, DxgiRotation::Rotate90).unwrap();
        let back = rotate_frame(&once, DxgiRotation::Rotate270).unwrap();
        assert_eq!(back, frame);
        let twice = rotate_frame(
            &rotate_frame(&frame, DxgiRotation::Rotate180).unwrap(),
            DxgiRotation::Rotate180,
        )
        .unwrap();
        assert_eq!(twice, frame);
    }

    #[test]
    fn pitched_conversion_then_rotation_honors_padding() {
        // 2x2 BGRA with row pitch 12 (8 payload + 4 padding per row).
        let src = [
            1, 2, 3, 0, 4, 5, 6, 0, 99, 99, 99, 99, // row 0 + padding
            7, 8, 9, 0, 10, 11, 12, 0, 99, 99, 99, 99, // row 1 + padding
        ];
        let rgba = convert_bgra_to_rgba_pitched(&src, 2, 2, 12).unwrap();
        let frame = DxgiFrame {
            width: 2,
            height: 2,
            rgba,
            frame_info: DxgiFrameMetadata::default(),
        };
        let rotated = rotate_frame(&frame, DxgiRotation::Rotate90).unwrap();
        // Converted rows: [3,2,1 | 6,5,4] / [9,8,7 | 12,11,10] (R first).
        // CW: rows [9,8,7 | 3,2,1] / [12,11,10 | 6,5,4].
        assert_eq!(
            rotated.rgba,
            vec![
                9, 8, 7, 255, 3, 2, 1, 255, 12, 11, 10, 255, 6, 5, 4, 255
            ]
        );
    }

    // --- Topology snapshots ---

    #[test]
    fn snapshot_rejects_empty_duplicate_and_empty_rect() {
        assert_eq!(
            TopologySnapshot::from_outputs(vec![]),
            Err(TopologyError::Empty)
        );
        assert!(matches!(
            TopologySnapshot::from_outputs(vec![
                out("\\\\.\\DISPLAY1", 0, 0, 4, 2, DxgiRotation::Identity),
                out("\\\\.\\DISPLAY1", 4, 0, 4, 2, DxgiRotation::Identity),
            ]),
            Err(TopologyError::DuplicateDeviceName(_))
        ));
        assert!(matches!(
            TopologySnapshot::from_outputs(vec![out(
                "\\\\.\\DISPLAY1",
                0,
                0,
                0,
                2,
                DxgiRotation::Identity
            )]),
            Err(TopologyError::EmptyOutputRect(_))
        ));
    }

    #[test]
    fn snapshot_resolves_by_device_name_not_index() {
        let snapshot = left_snapshot();
        // Deliberately scrambled index fields must not matter: identity
        // is the device name.
        let mut scrambled = snapshot.clone();
        scrambled.outputs[0].index = 99;
        scrambled.outputs[1].index = 0;
        assert_eq!(
            scrambled
                .output_for_device_name("\\\\.\\DISPLAY2")
                .unwrap()
                .rect
                .x,
            -4
        );
        assert!(scrambled.output_for_device_name("\\\\.\\DISPLAY9").is_none());
    }

    #[test]
    fn snapshot_point_lookup_honors_negative_origins() {
        let snapshot = left_snapshot();
        assert_eq!(
            snapshot
                .output_at_point(-1, 1)
                .unwrap()
                .device_name,
            "\\\\.\\DISPLAY2"
        );
        assert_eq!(
            snapshot.output_at_point(0, 0).unwrap().device_name,
            "\\\\.\\DISPLAY1"
        );
        assert!(snapshot.output_at_point(-5, 1).is_none());
        assert!(snapshot.output_at_point(4, 0).is_none());
    }

    #[test]
    fn virtual_bounds_include_negative_origins() {
        assert_eq!(
            left_snapshot().virtual_bounds().unwrap(),
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2
            }
        );
    }

    #[test]
    fn virtual_bounds_and_intersection_refuse_extreme_coords_without_panicking() {
        // An output rect whose right edge overflows i64: checked
        // arithmetic must fail cleanly, never saturate or panic.
        let extreme = TopologySnapshot::from_outputs(vec![out(
            "\\\\.\\DISPLAY1",
            i64::MAX - 10,
            0,
            20,
            2,
            DxgiRotation::Identity,
        )])
        .unwrap();
        assert_eq!(
            extreme.virtual_bounds(),
            Err(TopologyError::ArithmeticOverflow)
        );
        // The same rect never intersects a normal request rect, and
        // planning that request fails cleanly (no intersection), not
        // with a wrapped-around bogus overlap.
        let plan = plan_composition(
            &extreme,
            RectI {
                x: 0,
                y: 0,
                w: 4,
                h: 2,
            },
            &DxgiLimits::default(),
        );
        assert_eq!(plan, Err(TopologyError::NoIntersection));
    }

    #[test]
    fn refresh_bumps_generation() {
        let snapshot = left_snapshot();
        let refreshed = snapshot.refresh(snapshot.outputs.clone()).unwrap();
        assert_eq!(refreshed.generation, 1);
        assert_eq!(refreshed.outputs, snapshot.outputs);
    }

    // --- Composition plans ---

    #[test]
    fn plan_spanning_negative_origin_rect() {
        let plan = plan_composition(
            &left_snapshot(),
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        )
        .unwrap();
        assert_eq!((plan.dest_width, plan.dest_height), (8, 2));
        assert_eq!(plan.contributions.len(), 2);
        // Enumeration order: primary first, then the negative-origin
        // secondary — but destination offsets follow coordinates.
        let primary = &plan.contributions[0];
        assert_eq!(primary.output.device_name, "\\\\.\\DISPLAY1");
        assert_eq!((primary.dest_x, primary.dest_y), (4, 0));
        assert_eq!((primary.width, primary.height), (4, 2));
        let secondary = &plan.contributions[1];
        assert_eq!(secondary.output.device_name, "\\\\.\\DISPLAY2");
        assert_eq!((secondary.dest_x, secondary.dest_y), (0, 0));
    }

    #[test]
    fn plan_rect_fully_inside_negative_output() {
        let plan = plan_composition(
            &left_snapshot(),
            RectI {
                x: -4,
                y: 0,
                w: 2,
                h: 2,
            },
            &DxgiLimits::default(),
        )
        .unwrap();
        assert_eq!((plan.dest_width, plan.dest_height), (2, 2));
        assert_eq!(plan.contributions.len(), 1);
        assert_eq!(
            plan.contributions[0].output.device_name,
            "\\\\.\\DISPLAY2"
        );
        assert_eq!(
            (plan.contributions[0].dest_x, plan.contributions[0].dest_y),
            (0, 0)
        );
    }

    #[test]
    fn plan_mid_span_rect_clips_to_both_outputs() {
        let plan = plan_composition(
            &right_snapshot(),
            RectI {
                x: 2,
                y: 0,
                w: 4,
                h: 2,
            },
            &DxgiLimits::default(),
        )
        .unwrap();
        assert_eq!((plan.dest_width, plan.dest_height), (4, 2));
        assert_eq!(plan.contributions.len(), 2);
        assert_eq!(
            (plan.contributions[0].crop.x, plan.contributions[0].width),
            (2, 2)
        );
        assert_eq!(
            (plan.contributions[1].crop.x, plan.contributions[1].width),
            (4, 2)
        );
        assert_eq!(
            (plan.contributions[1].dest_x, plan.contributions[1].dest_y),
            (2, 0)
        );
    }

    #[test]
    fn plan_refuses_no_intersection_uncovered_and_unspecified() {
        let limits = DxgiLimits::default();
        assert_eq!(
            plan_composition(
                &left_snapshot(),
                RectI {
                    x: 100,
                    y: 100,
                    w: 4,
                    h: 2
                },
                &limits
            ),
            Err(TopologyError::NoIntersection)
        );
        // Straddles the desktop edge into void: refused, never a
        // raster with a black hole.
        assert_eq!(
            plan_composition(
                &left_snapshot(),
                RectI {
                    x: -6,
                    y: 0,
                    w: 4,
                    h: 2
                },
                &limits
            ),
            Err(TopologyError::UncoveredRegion)
        );
        let unspecified = TopologySnapshot::from_outputs(vec![out(
            "\\\\.\\DISPLAY1",
            0,
            0,
            4,
            2,
            DxgiRotation::Unspecified,
        )])
        .unwrap();
        assert!(matches!(
            plan_composition(
                &unspecified,
                RectI {
                    x: 0,
                    y: 0,
                    w: 4,
                    h: 2
                },
                &limits
            ),
            Err(TopologyError::UnspecifiedRotation(_))
        ));
    }

    #[test]
    fn plan_oversize_and_overflow_fail_before_any_acquire() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 0, 0]))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 0, 0]))],
                ),
            ],
        );
        let limits = DxgiLimits::default();
        // Side over the 16,384 limit.
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 16_385,
                h: 2,
            },
            &limits,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Unavailable(_)));
        // Raster over the 128 MiB limit (16,384 x 16,384 x 4 = 1 GiB).
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: 16_384,
                h: 16_384,
            },
            &limits,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Unavailable(_)));
        // Side that does not even fit u32.
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: u32::MAX as u64 + 1,
                h: 2,
            },
            &limits,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Unavailable(_)));
        // Empty request.
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: 0,
                h: 2,
            },
            &limits,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Unavailable(_)));
        // No acquire happened for any of these refusals.
        assert_eq!(mock.acquire_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn plan_clone_overlap_pastes_in_enumeration_order() {
        // Mirrored outputs share coordinates; the plan allows the
        // overlap and the later output wins the shared region
        // (documented last-wins behavior — mirrored outputs show the
        // same content, so the choice is unobservable in practice).
        let snapshot = TopologySnapshot::from_outputs(vec![
            out("\\\\.\\DISPLAY1", 0, 0, 4, 2, DxgiRotation::Identity),
            out("\\\\.\\DISPLAY2", 0, 0, 4, 2, DxgiRotation::Identity),
        ])
        .unwrap();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 100, 0]))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 200, 0]))],
                ),
            ],
        );
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: 4,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert_eq!(reds(&composite.frame), vec![200; 8]);
    }

    // --- Multi-output capture ---

    #[test]
    fn multi_output_spanning_capture_composites_negative_origin() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels_with_present(
                        4,
                        2,
                        [0, 0, 100, 0],
                        1500,
                    ))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(gradient_pixels(4, 2))],
                ),
            ],
        );
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert_eq!((composite.frame.width, composite.frame.height), (8, 2));
        // Secondary gradient block, then solid primary block.
        assert_eq!(
            reds(&composite.frame),
            vec![0, 10, 20, 30, 100, 100, 100, 100, 1, 11, 21, 31, 100, 100, 100, 100]
        );
        assert_eq!(composite.per_output.len(), 2);
        assert_eq!(
            composite.per_output[0].device_name,
            "\\\\.\\DISPLAY1".to_string()
        );
        assert_eq!(composite.per_output[0].sequence, 0);
        assert_eq!(
            composite.per_output[1].frame_info.last_present_time, 0
        );
        // Skew: only one nonzero present time here (the gradient mock
        // carries 0 = unknown), so the tick delta is unknown, not 0.
        assert_eq!(present_time_skew_ticks(&composite.per_output), None);
        assert_eq!(mock.releases.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn multi_output_rotated_output_is_rotated_before_cropping() {
        // Rotated output: desktop rect 2x3, panel-native texture 3x2.
        // Identity output to its right: desktop rect 2x3.
        let snapshot = TopologySnapshot::from_outputs(vec![
            out("\\\\.\\DISPLAY1", 0, 0, 2, 3, DxgiRotation::Rotate90),
            out("\\\\.\\DISPLAY2", 2, 0, 2, 3, DxgiRotation::Identity),
        ])
        .unwrap();
        // Panel-native 3x2 texture with distinct R values per pixel:
        // rows (R): [10 20 30; 40 50 60] in BGRA source order.
        let mut bgra = Vec::new();
        for r in [10u8, 20, 30, 40, 50, 60] {
            bgra.extend_from_slice(&[0, 0, r, 0]);
        }
        let rotated_pixels = AcquiredPixels {
            width: 3,
            height: 2,
            row_pitch: 12,
            bgra,
            frame_info: DxgiFrameMetadata::default(),
        };
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(rotated_pixels)],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(2, 3, [0, 0, 100, 0]))],
                ),
            ],
        );
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: 4,
                h: 3,
            },
            &DxgiLimits::default(),
        ));
        // Rotated block (CW of [10 20 30; 40 50 60]) is
        // rows [40 10; 50 20; 60 30]; identity block is solid 100.
        assert_eq!(
            reds(&composite.frame),
            vec![40, 10, 100, 100, 50, 20, 100, 100, 60, 30, 100, 100]
        );
    }

    #[test]
    fn multi_output_wait_timeout_then_frame_is_not_a_failure() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Err(DxgiAcquireError::WaitTimeout),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 100, 0])),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0]))],
                ),
            ],
        );
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert_eq!((composite.frame.width, composite.frame.height), (8, 2));
    }

    #[test]
    fn multi_output_wait_timeout_past_deadline_is_retryable_not_partial() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Err(DxgiAcquireError::WaitTimeout); 8],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0]))],
                ),
            ],
        );
        let limits = DxgiLimits {
            total_deadline_ms: 1,
            ..DxgiLimits::default()
        };
        // Scripted clock: first iteration inside the deadline, then
        // past it — deterministic, no wall-clock flakiness.
        let mut times: VecDeque<Duration> = [
            Duration::from_millis(0),
            Duration::from_millis(5),
            Duration::from_millis(5),
        ]
        .into();
        let clock = move || times.pop_front().unwrap_or(Duration::from_millis(5));
        let outcome = capture_multi_output_with_clock(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &limits,
            clock,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Retryable(_)));
    }

    #[test]
    fn final_poll_grant_is_shared_across_outputs_not_per_output() {
        // DXGI2-002: one final 0ms poll per REQUEST. Output 1 spends
        // it (sub-millisecond remainder, already-ready frame); output
        // 2 must then get no final poll of its own, so the request
        // ends Retryable with output 2's scripted frame unconsumed.
        // Under the old per-output reset, output 2 would poll, take
        // its frame, and the request would wrongly return Frame.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 100, 0]))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0]))],
                ),
            ],
        );
        let limits = DxgiLimits {
            total_deadline_ms: 10,
            ..DxgiLimits::default()
        };
        // Scripted clock: both reads land in the sub-millisecond
        // remainder (remaining < 1ms, still before the deadline), so
        // each output's first attempt is a final-poll-or-nothing
        // decision — exactly the boundary the shared grant governs.
        let mut times: VecDeque<Duration> =
            [Duration::from_micros(9500), Duration::from_micros(9600)].into();
        let clock = move || times.pop_front().unwrap_or(Duration::from_micros(9900));
        let outcome = capture_multi_output_with_clock(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &limits,
            clock,
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Retryable(_)));
        // Output 2 was never polled: its scripted frame is still queued.
        assert_eq!(mock.steps.get("\\\\.\\DISPLAY2").map(|q| q.len()), Some(1));
    }

    #[test]
    fn rebuild_all_or_nothing_keeps_old_set_when_later_rebuild_fails() {
        // DXGI2-001: the helper the Windows session's `recreate_all`
        // delegates to — a failure on a later context must leave the
        // original set completely intact, never partially rebuilt.
        let mut contexts = vec![10, 20, 30];
        let err = rebuild_all_or_nothing(&mut contexts, |index, old| {
            if index == 1 {
                Err("second rebuild failed")
            } else {
                Ok(old + 100)
            }
        })
        .unwrap_err();
        assert_eq!(err, "second rebuild failed");
        assert_eq!(contexts, vec![10, 20, 30]);
    }

    #[test]
    fn rebuild_all_or_nothing_swaps_complete_set_on_success() {
        let mut contexts = vec![10, 20, 30];
        rebuild_all_or_nothing(&mut contexts, |_, old| Ok::<_, &str>(old + 100)).unwrap();
        assert_eq!(contexts, vec![110, 120, 130]);
    }

    #[test]
    fn multi_output_protected_on_one_output_is_explicit_not_partial() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 100, 0]))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Err(DxgiAcquireError::Protected)],
                ),
            ],
        );
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        );
        assert!(matches!(
            outcome,
            DxgiMultiOutputOutcome::ProtectedOrSecure(_)
        ));
        // The primary's acquired frame was still released exactly once.
        assert_eq!(mock.releases.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unplug_simulation_discards_partial_and_retries_once() {
        // First attempt: primary succeeds (stale color 11), secondary
        // reports ACCESS_LOST (unplug/mode change). The loop discards
        // the primary partial, recreates once, refreshes (same
        // topology), and retries: both succeed with fresh colors.
        // The final image must contain ONLY second-attempt pixels.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 11, 0])),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 22, 0])),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![
                        MStep::Err(DxgiAcquireError::AccessLost),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 33, 0])),
                    ],
                ),
            ],
        );
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert!(!reds(&composite.frame).contains(&11));
        assert_eq!(
            reds(&composite.frame),
            vec![33, 33, 33, 33, 22, 22, 22, 22, 33, 33, 33, 33, 22, 22, 22, 22]
        );
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
        assert_eq!(mock.refresh_calls.load(Ordering::SeqCst), 1);
        // Every acquired frame released exactly once (3 acquires).
        assert_eq!(mock.releases.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn mode_change_simulation_retries_from_the_fresh_snapshot() {
        // First attempt: primary ACCESS_LOST. The refresh reports a
        // WIDER primary (resolution change, 4 -> 6 px wide). The retry
        // plans against the fresh snapshot: the 6-wide frame passes
        // the rotated-dims check against the new rect, and the
        // requested 4-wide crop succeeds from it.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Err(DxgiAcquireError::AccessLost),
                        MStep::Ok(solid_pixels(6, 2, [0, 0, 77, 0])),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0]))],
                ),
            ],
        );
        mock.refresh_outputs = Some(vec![
            out("\\\\.\\DISPLAY1", 0, 0, 6, 2, DxgiRotation::Identity),
            out("\\\\.\\DISPLAY2", -4, 0, 4, 2, DxgiRotation::Identity),
        ]);
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: 0,
                y: 0,
                w: 4,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert_eq!((composite.frame.width, composite.frame.height), (4, 2));
        assert_eq!(reds(&composite.frame), vec![77; 8]);
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
        assert_eq!(mock.refresh_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unplug_removing_an_output_is_unavailable_not_partial() {
        // First attempt: primary succeeds, secondary ACCESS_LOST.
        // The refresh reports the secondary GONE. The retried plan no
        // longer covers the spanning request, so the outcome is
        // Unavailable — never a primary-only image relabeled as the
        // spanning request.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 100, 0]))],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Err(DxgiAcquireError::AccessLost)],
                ),
            ],
        );
        mock.refresh_outputs = Some(vec![out(
            "\\\\.\\DISPLAY1",
            0,
            0,
            4,
            2,
            DxgiRotation::Identity,
        )]);
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Unavailable(_)));
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
        // The first attempt's primary frame was released; the retry
        // never acquired (its plan failed first).
        assert_eq!(mock.releases.load(Ordering::SeqCst), 1);
        assert_eq!(mock.acquire_calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn second_access_lost_is_terminal_after_one_recreate() {
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Err(DxgiAcquireError::AccessLost),
                        MStep::Err(DxgiAcquireError::AccessLost),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0]))],
                ),
            ],
        );
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Retryable(_)));
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn generation_change_mid_request_discards_and_reacquires_all() {
        // Both outputs acquire, then the backend reports a new
        // generation (topology changed under the request). The loop
        // discards both frames and re-acquires everything once.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 11, 0])),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 22, 0])),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 33, 0])),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 44, 0])),
                    ],
                ),
            ],
        );
        mock.flip_after = Some(2);
        let composite = frame_of(capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        ));
        assert_eq!(
            reds(&composite.frame),
            vec![44, 44, 44, 44, 22, 22, 22, 22, 44, 44, 44, 44, 22, 22, 22, 22]
        );
        assert_eq!(mock.acquire_calls.load(Ordering::SeqCst), 4);
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
        assert_eq!(mock.refresh_calls.load(Ordering::SeqCst), 1);
        assert_eq!(mock.releases.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn rotated_frame_size_mismatch_is_stale_then_terminal() {
        // The backend returns a 6-wide texture for a 4-wide output
        // rect on both attempts: a mode change the refresh does not
        // explain. First pass goes stale, the single retry goes stale
        // again, and the request ends Retryable — never a wrongly
        // cropped image.
        let snapshot = left_snapshot();
        let mut mock = MultiMock::new(
            snapshot.clone(),
            vec![
                (
                    "\\\\.\\DISPLAY1".to_string(),
                    vec![
                        MStep::Ok(solid_pixels(6, 2, [0, 0, 100, 0])),
                        MStep::Ok(solid_pixels(6, 2, [0, 0, 100, 0])),
                    ],
                ),
                (
                    "\\\\.\\DISPLAY2".to_string(),
                    vec![
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0])),
                        MStep::Ok(solid_pixels(4, 2, [0, 0, 50, 0])),
                    ],
                ),
            ],
        );
        let outcome = capture_multi_output(
            &mut mock,
            &snapshot,
            RectI {
                x: -4,
                y: 0,
                w: 8,
                h: 2,
            },
            &DxgiLimits::default(),
        );
        assert!(matches!(outcome, DxgiMultiOutputOutcome::Retryable(_)));
        assert_eq!(mock.recreates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn present_time_skew_ticks_uses_max_minus_min() {
        let records = vec![
            DxgiOutputAcquisition {
                device_name: "\\\\.\\DISPLAY1".to_string(),
                adapter_luid: (0, 0),
                frame_info: DxgiFrameMetadata {
                    last_present_time: 1000,
                    ..DxgiFrameMetadata::default()
                },
                sequence: 0,
            },
            DxgiOutputAcquisition {
                device_name: "\\\\.\\DISPLAY2".to_string(),
                adapter_luid: (0, 0),
                frame_info: DxgiFrameMetadata {
                    last_present_time: 1500,
                    ..DxgiFrameMetadata::default()
                },
                sequence: 1,
            },
        ];
        assert_eq!(present_time_skew_ticks(&records), Some(500));
        // Zero means "no present since last acquire": unknown, not 0.
        let mut unknown = records.clone();
        unknown[0].frame_info.last_present_time = 0;
        assert_eq!(present_time_skew_ticks(&unknown), None);
        assert_eq!(present_time_skew_ticks(&records[..1]), None);
        assert_eq!(present_time_skew_ticks(&[]), None);
    }
}

// ---------------------------------------------------------------------------
// DXGI-2 — Topology, rotation, and multi-output composition.
//
// Pure, platform-neutral logic (this section compiles and tests on any
// host); the Windows session that feeds it real outputs lives in
// `win_backend::DxgiMultiOutputSession` below. Nothing here changes
// production dispatch: `native.rs` still owns dispatch, and DXGI-3 wires
// Region/Window/Monitor capture to this path.
//
// Pipeline (brief, "Topology and request mapping"):
//
// 1. `TopologySnapshot` maps stable app monitor identity (the OS device
//    name, NEVER the enumeration index) to adapter LUID + physical
//    desktop rectangle + rotation, and carries a generation token.
// 2. `plan_composition` turns a request rect into a checked destination
//    raster plus one crop per intersecting output, in physical desktop
//    coordinates (negative origins included). The plan is computed —
//    and the destination limits are enforced — BEFORE any acquisition
//    or allocation, so oversize and checked-arithmetic cases fail
//    without touching the GPU or the heap.
// 3. `capture_multi_output` acquires every intersecting output, rotates
//    each frame from panel-native texture orientation into desktop
//    orientation, crops the intersection, and pastes into one raster.
//    On ANY failure or topology change mid-request, all partial pixels
//    are discarded and the whole request is retried exactly once from a
//    fresh snapshot. A partial multi-monitor image is never returned.
// 4. Cross-output atomicity is NOT claimed: Desktop Duplication cannot
//    promise simultaneous presentation across independent outputs. Each
//    output's acquisition is recorded (`DxgiOutputAcquisition`, with the
//    raw `LastPresentTime` ticks), and the skew bound is documented
//    below instead of hidden.
//
// Rotation mapping (panel-native texture -> desktop orientation).
// DXGI reports the rotation the compositor applies to the panel; the
// duplicated texture is in panel-native orientation, so the frame must
// be rotated back into desktop coordinates before cropping against the
// output's desktop rect (whose dimensions already reflect the rotation):
//
// - `Rotate90`:  90 degrees clockwise.  dst(x', y') = src(y', H-1-x').
// - `Rotate270`: 90 degrees counter-clockwise. dst(x', y') = src(W-1-y', x').
// - `Rotate180`: dst(x', y') = src(W-1-x', H-1-y').
// - `Unspecified`: never guessed. The plan refuses the request rather
//   than silently treating an unknown rotation as identity.
//
// DIRECTION ASSUMPTION, flagged for hardware confirmation: the mapping
// above assumes ROTATE90 means "rotate the texture 90 degrees clockwise
// to reach desktop orientation." Dimensions alone cannot distinguish
// clockwise from counter-clockwise (both swap width/height), so the
// Windows hardware procedure (`docs/DXGI2_HARDWARE_TEST_PROCEDURE.md`)
// includes an orientation-marker check on a real rotated output. If
// hardware shows the opposite direction, only this mapping (plus its
// fixtures) changes — the plan/compose/retry machinery is unaffected.
//
// Cross-output skew bound: every output acquire in one request runs
// under the SAME total request deadline (`DxgiLimits::total_deadline_ms`,
// default 2000 ms), and the deadline loop bounds AcquireNextFrame waits
// only (same scope caveat as DXGI-1: copy/map/conversion are not
// deadline-metered). The first-to-last output frame skew is therefore
// bounded by the total deadline in the wait dimension, and typically by
// one per-attempt timeout when the desktop is updating. The hardware
// test logs per-output `LastPresentTime` ticks so real skew can be
// measured (ticks convert to time only with QueryPerformanceFrequency;
// the pure helper `present_time_skew_ticks` returns the tick delta and
// never labels it milliseconds).
//
// Resource discipline (brief): every acquired frame is released via its
// `FrameGuard` before conversion (same order as DXGI-1); partial frames
// are plain `Vec`s dropped on the discard path; the Windows session
// drops whole contexts (duplication object, staging texture, device)
// when a topology refresh rebuilds it. No frame is ever cached across
// requests: a `WAIT_TIMEOUT` past the deadline is terminal, not stale.
// ---------------------------------------------------------------------------

/// Error building or using a topology snapshot or composition plan.
///
/// All variants are refusals BEFORE allocation or acquisition where the
/// plan stage produces them; the capture loop maps them to
/// [`DxgiMultiOutputOutcome::Unavailable`], never to a partial image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopologyError {
    /// No outputs at all (empty snapshot or empty request).
    Empty,
    /// Two outputs share one OS device name, so device-name identity —
    /// the only identity DXGI-2 trusts — is ambiguous.
    DuplicateDeviceName(String),
    /// An enumerated output has an empty desktop rect.
    EmptyOutputRect(String),
    /// Checked desktop-coordinate arithmetic overflowed (extreme rects).
    ArithmeticOverflow,
    /// The request rect intersects no output.
    NoIntersection,
    /// Part of the request rect is covered by no output (virtual-desktop
    /// void). DXGI-2 refuses rather than returning a raster with a
    /// silently black uncovered region; callers clip to the virtual
    /// desktop first when that is what they want.
    UncoveredRegion,
    /// An intersecting output reports an unknown rotation.
    UnspecifiedRotation(String),
    /// Destination raster violates the shared artifact limits.
    Limit(DxgiLimitError),
    /// Destination side exceeds the pixel-per-side limit but does not
    /// fit `u32`, so it cannot be expressed as a `DxgiLimitError`.
    SideTooLarge { side: u64, max: u32 },
}

impl std::fmt::Display for TopologyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TopologyError::Empty => write!(f, "topology is empty"),
            TopologyError::DuplicateDeviceName(name) => {
                write!(f, "duplicate output device name {name}")
            }
            TopologyError::EmptyOutputRect(name) => {
                write!(f, "output {name} has an empty desktop rect")
            }
            TopologyError::ArithmeticOverflow => {
                write!(f, "desktop-coordinate arithmetic overflowed")
            }
            TopologyError::NoIntersection => {
                write!(f, "capture rect intersects no output")
            }
            TopologyError::UncoveredRegion => {
                write!(f, "capture rect extends beyond the covered desktop")
            }
            TopologyError::UnspecifiedRotation(name) => {
                write!(f, "output {name} reports an unspecified rotation")
            }
            TopologyError::Limit(e) => write!(f, "destination violates limits: {e}"),
            TopologyError::SideTooLarge { side, max } => {
                write!(f, "destination side {side}px exceeds the {max}px limit")
            }
        }
    }
}

/// Checked right edge of a rect: `None` when the width does not fit
/// `i64` or the addition overflows. `RectI::right` saturates, which
/// would silently merge distinct extreme rects; the plan path never
/// uses it.
fn checked_right(rect: RectI) -> Option<i64> {
    let w = i64::try_from(rect.w).ok()?;
    rect.x.checked_add(w)
}

/// Checked bottom edge of a rect (see [`checked_right`]).
fn checked_bottom(rect: RectI) -> Option<i64> {
    let h = i64::try_from(rect.h).ok()?;
    rect.y.checked_add(h)
}

/// Checked intersection of two rects; `None` on overflow or no overlap.
/// Uses `i128` differences so the width/height conversion cannot wrap
/// for extreme coordinates (two `i64` edges can differ by up to 2^64-1,
/// which fits `u64` exactly but not `i64`).
fn checked_intersect(a: RectI, b: RectI) -> Option<RectI> {
    let ax2 = checked_right(a)?;
    let ay2 = checked_bottom(a)?;
    let bx2 = checked_right(b)?;
    let by2 = checked_bottom(b)?;
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    let r = ax2.min(bx2);
    let bot = ay2.min(by2);
    if r > x && bot > y {
        Some(RectI {
            x,
            y,
            w: (r as i128 - x as i128) as u64,
            h: (bot as i128 - y as i128) as u64,
        })
    } else {
        None
    }
}

/// Subtract `cut` from `rect`: the pieces of `rect` not covered by
/// `cut` (up to four strips, each non-empty). Used by the plan's
/// coverage check so a rect straddling virtual-desktop void is refused
/// instead of composited with a black hole.
fn subtract_rect(rect: RectI, cut: RectI) -> Vec<RectI> {
    let Some(inter) = checked_intersect(rect, cut) else {
        return vec![rect];
    };
    let mut out = Vec::new();
    // All edges below are within `rect`, so differences fit.
    let rx2 = checked_right(rect).expect("subtract: rect right edge is checked");
    let ry2 = checked_bottom(rect).expect("subtract: rect bottom edge is checked");
    let ix2 = checked_right(inter).expect("subtract: intersection right edge is checked");
    let iy2 = checked_bottom(inter).expect("subtract: intersection bottom edge is checked");
    if inter.x > rect.x {
        out.push(RectI {
            x: rect.x,
            y: rect.y,
            w: (inter.x as i128 - rect.x as i128) as u64,
            h: rect.h,
        });
    }
    if ix2 < rx2 {
        out.push(RectI {
            x: ix2,
            y: rect.y,
            w: (rx2 as i128 - ix2 as i128) as u64,
            h: rect.h,
        });
    }
    if inter.y > rect.y {
        out.push(RectI {
            x: inter.x,
            y: rect.y,
            w: inter.w,
            h: (inter.y as i128 - rect.y as i128) as u64,
        });
    }
    if iy2 < ry2 {
        out.push(RectI {
            x: inter.x,
            y: iy2,
            w: inter.w,
            h: (ry2 as i128 - iy2 as i128) as u64,
        });
    }
    out
}

/// A snapshot of the attached-desktop topology at one moment.
///
/// Identity is the OS device name plus adapter LUID — never the
/// enumeration index (brief: "Do not equate enumeration index with
/// monitor identity"). The generation token starts at 0 and increments
/// on every refresh; the capture loop treats any generation change
/// between plan and completion as stale topology and retries once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopologySnapshot {
    pub generation: u64,
    pub outputs: Vec<OutputInfo>,
}

impl TopologySnapshot {
    /// Build a generation-0 snapshot, validating identity and rects.
    pub fn from_outputs(outputs: Vec<OutputInfo>) -> Result<Self, TopologyError> {
        if outputs.is_empty() {
            return Err(TopologyError::Empty);
        }
        for (i, output) in outputs.iter().enumerate() {
            if output.rect.is_empty() {
                return Err(TopologyError::EmptyOutputRect(
                    output.device_name.clone(),
                ));
            }
            if outputs[..i]
                .iter()
                .any(|o| o.device_name == output.device_name)
            {
                return Err(TopologyError::DuplicateDeviceName(
                    output.device_name.clone(),
                ));
            }
        }
        Ok(Self {
            generation: 0,
            outputs,
        })
    }

    /// Rebuild from freshly enumerated outputs, bumping the generation.
    /// The generation saturates rather than wrapping: a wrap would make
    /// a new topology compare equal to an ancient one.
    pub fn refresh(&self, outputs: Vec<OutputInfo>) -> Result<Self, TopologyError> {
        let mut next = Self::from_outputs(outputs)?;
        next.generation = self.generation.saturating_add(1);
        Ok(next)
    }

    /// Resolve by stable identity: OS device name, not index.
    pub fn output_for_device_name(&self, name: &str) -> Option<&OutputInfo> {
        self.outputs.iter().find(|o| o.device_name == name)
    }

    /// First output (enumeration order) containing the desktop point.
    pub fn output_at_point(&self, x: i64, y: i64) -> Option<&OutputInfo> {
        self.outputs.iter().find(|o| {
            let (Some(r), Some(b)) = (checked_right(o.rect), checked_bottom(o.rect)) else {
                return false;
            };
            x >= o.rect.x && x < r && y >= o.rect.y && y < b
        })
    }

    /// Bounding box of all outputs (the virtual desktop), including
    /// negative origins. Checked: extreme rects fail instead of
    /// saturating into a wrong box.
    pub fn virtual_bounds(&self) -> Result<RectI, TopologyError> {
        let mut acc: Option<RectI> = None;
        for output in &self.outputs {
            let r = checked_right(output.rect).ok_or(TopologyError::ArithmeticOverflow)?;
            let b = checked_bottom(output.rect).ok_or(TopologyError::ArithmeticOverflow)?;
            acc = Some(match acc {
                None => output.rect,
                Some(a) => {
                    let ar = checked_right(a).ok_or(TopologyError::ArithmeticOverflow)?;
                    let ab = checked_bottom(a).ok_or(TopologyError::ArithmeticOverflow)?;
                    let x = a.x.min(output.rect.x);
                    let y = a.y.min(output.rect.y);
                    let r2 = ar.max(r);
                    let b2 = ab.max(b);
                    RectI {
                        x,
                        y,
                        w: (r2 as i128 - x as i128) as u64,
                        h: (b2 as i128 - y as i128) as u64,
                    }
                }
            });
        }
        acc.ok_or(TopologyError::Empty)
    }

    /// Every output intersecting `rect`, with the intersection in
    /// physical desktop coordinates.
    pub fn intersecting(&self, rect: RectI) -> Vec<(OutputInfo, RectI)> {
        self.outputs
            .iter()
            .filter_map(|o| checked_intersect(rect, o.rect).map(|inter| (o.clone(), inter)))
            .collect()
    }
}

/// One output's share of a composition: which desktop crop goes where
/// in the destination raster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputContribution {
    /// The output this crop comes from (identity: device name).
    pub output: OutputInfo,
    /// Intersection of the request rect with the output, in physical
    /// desktop coordinates (may have a negative origin).
    pub crop: RectI,
    /// Top-left of this crop inside the destination raster.
    pub dest_x: u32,
    pub dest_y: u32,
    /// Crop size, equal to its destination footprint.
    pub width: u32,
    pub height: u32,
}

/// A fully checked multi-output plan: destination size plus one
/// contribution per intersecting output. Built before any acquisition
/// or allocation, so every refusal below is cheap and side-effect-free.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompositionPlan {
    pub dest_width: u32,
    pub dest_height: u32,
    pub contributions: Vec<OutputContribution>,
}

/// Plan a multi-output capture. Order of refusals (all before any
/// acquire or allocation): empty request, destination limits
/// (checked, including the `u32` fit), no intersection, uncovered
/// region, unspecified rotation on an intersecting output.
pub fn plan_composition(
    snapshot: &TopologySnapshot,
    rect: RectI,
    limits: &DxgiLimits,
) -> Result<CompositionPlan, TopologyError> {
    if rect.is_empty() {
        return Err(TopologyError::Empty);
    }
    let dest_width = u32::try_from(rect.w).map_err(|_| TopologyError::SideTooLarge {
        side: rect.w,
        max: limits.max_side_px,
    })?;
    let dest_height = u32::try_from(rect.h).map_err(|_| TopologyError::SideTooLarge {
        side: rect.h,
        max: limits.max_side_px,
    })?;
    validate_limits(dest_width, dest_height, limits).map_err(TopologyError::Limit)?;

    let mut contributions = Vec::new();
    for (output, inter) in snapshot.intersecting(rect) {
        // `inter` lies inside both `rect` and the output, so both
        // differences are non-negative and bounded by the destination
        // size (already validated to fit `u32`).
        let dest_x = u32::try_from((inter.x as i128 - rect.x as i128) as u64)
            .map_err(|_| TopologyError::ArithmeticOverflow)?;
        let dest_y = u32::try_from((inter.y as i128 - rect.y as i128) as u64)
            .map_err(|_| TopologyError::ArithmeticOverflow)?;
        let width = u32::try_from(inter.w).map_err(|_| TopologyError::ArithmeticOverflow)?;
        let height = u32::try_from(inter.h).map_err(|_| TopologyError::ArithmeticOverflow)?;
        contributions.push(OutputContribution {
            output,
            crop: inter,
            dest_x,
            dest_y,
            width,
            height,
        });
    }
    if contributions.is_empty() {
        return Err(TopologyError::NoIntersection);
    }
    // Coverage: subtract every intersection from the request; any
    // remainder is virtual-desktop void and the request is refused
    // rather than composited with a black hole.
    let mut remainder = vec![rect];
    for contribution in &contributions {
        remainder = remainder
            .into_iter()
            .flat_map(|r| subtract_rect(r, contribution.crop))
            .collect();
        if remainder.is_empty() {
            break;
        }
    }
    if !remainder.is_empty() {
        return Err(TopologyError::UncoveredRegion);
    }
    for contribution in &contributions {
        if contribution.output.rotation == DxgiRotation::Unspecified {
            return Err(TopologyError::UnspecifiedRotation(
                contribution.output.device_name.clone(),
            ));
        }
    }
    Ok(CompositionPlan {
        dest_width,
        dest_height,
        contributions,
    })
}

/// Dimensions of a frame after rotation into desktop orientation.
/// `None` for `Unspecified`: an unknown rotation is never assumed to be
/// identity.
pub fn rotated_dimensions(
    width: u32,
    height: u32,
    rotation: DxgiRotation,
) -> Option<(u32, u32)> {
    match rotation {
        DxgiRotation::Identity | DxgiRotation::Rotate180 => Some((width, height)),
        DxgiRotation::Rotate90 | DxgiRotation::Rotate270 => Some((height, width)),
        DxgiRotation::Unspecified => None,
    }
}

/// Rotate a packed-RGBA frame from panel-native texture orientation
/// into desktop orientation (mapping documented in the section header).
/// Returns `None` for `Unspecified` rotation, a malformed frame buffer,
/// or overflowing destination arithmetic — never a partial frame.
///
/// The rotation direction (Rotate90 = clockwise) is the documented
/// assumption flagged for hardware confirmation in the DXGI-2 hardware
/// procedure; see the section header.
pub fn rotate_frame(frame: &DxgiFrame, rotation: DxgiRotation) -> Option<DxgiFrame> {
    if rotation == DxgiRotation::Identity {
        return Some(frame.clone());
    }
    let (dw, dh) = rotated_dimensions(frame.width, frame.height, rotation)?;
    let src_stride = frame.width as usize * 4;
    if frame.rgba.len() != src_stride.checked_mul(frame.height as usize)? {
        return None;
    }
    let dst_len = (dw as usize)
        .checked_mul(dh as usize)?
        .checked_mul(4)?;
    let mut rgba = vec![0u8; dst_len];
    let (sw, sh) = (frame.width as usize, frame.height as usize);
    let dst_stride = dw as usize * 4;
    for dy in 0..dh as usize {
        for dx in 0..dw as usize {
            let (sx, sy) = match rotation {
                DxgiRotation::Rotate90 => (dy, sh - 1 - dx),
                DxgiRotation::Rotate270 => (sw - 1 - dy, dx),
                DxgiRotation::Rotate180 => (sw - 1 - dx, sh - 1 - dy),
                _ => unreachable!("Identity and Unspecified handled above"),
            };
            let s = (sy * src_stride) + sx * 4;
            let d = (dy * dst_stride) + dx * 4;
            rgba[d..d + 4].copy_from_slice(&frame.rgba[s..s + 4]);
        }
    }
    Some(DxgiFrame {
        width: dw,
        height: dh,
        rgba,
        frame_info: frame.frame_info,
    })
}

/// One output's acquisition record in a composite frame. Metadata only:
/// never pixels. `sequence` is acquisition order within the request, so
/// a harness can reconstruct which output was acquired when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DxgiOutputAcquisition {
    pub device_name: String,
    pub adapter_luid: (u32, i32),
    pub frame_info: DxgiFrameMetadata,
    pub sequence: usize,
}

/// A composited multi-output frame: one raster plus the per-output
/// acquisition records that bound its cross-output skew.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DxgiCompositeFrame {
    pub frame: DxgiFrame,
    pub per_output: Vec<DxgiOutputAcquisition>,
}

/// Tick delta between the earliest and latest per-output
/// `LastPresentTime` in a composite frame. `None` when fewer than two
/// outputs were acquired or any output reports 0 ("no present since the
/// last acquire" — unknown, not zero skew). The result is in
/// QueryPerformanceCounter ticks, NOT milliseconds: only the Windows
/// harness, which knows the counter frequency, may convert it.
pub fn present_time_skew_ticks(per_output: &[DxgiOutputAcquisition]) -> Option<i64> {
    if per_output.len() < 2 {
        return None;
    }
    let mut min: Option<i64> = None;
    let mut max: Option<i64> = None;
    for record in per_output {
        let t = record.frame_info.last_present_time;
        if t == 0 {
            return None;
        }
        min = Some(min.map_or(t, |m: i64| m.min(t)));
        max = Some(max.map_or(t, |m: i64| m.max(t)));
    }
    Some(max? - min?)
}

/// Typed result of one multi-output capture (same shape as
/// [`DxgiCaptureOutcome`], but a `Frame` carries per-output records).
#[derive(Debug)]
pub enum DxgiMultiOutputOutcome {
    Frame(DxgiCompositeFrame),
    Unavailable(String),
    Retryable(String),
    ProtectedOrSecure(String),
}

/// The multi-output acquisition backend behind [`capture_multi_output`].
///
/// All-or-nothing rebuild of a context set (DXGI2-001): build a
/// complete fresh set with `rebuild` before swapping it in. On any
/// failure the original set is untouched — a caller can never observe
/// a mixed-generation set — and the error propagates. `rebuild` gets
/// the context's index plus its old value, so index-bound rebuilds
/// (like the Windows session's `for_output`) keep their alignment.
/// The Windows-only session delegates its `recreate_all` here; the
/// helper itself is platform-independent, so the invariant is covered
/// by Linux tests below (the session type itself is `#[cfg(windows)]`
/// and its execution proof stays owed on Windows hardware). The
/// helper exists only where it has a caller — Windows production code
/// or any test build — so non-Windows library builds stay warning-free.
#[cfg(any(windows, test))]
fn rebuild_all_or_nothing<T, E, F>(current: &mut Vec<T>, mut rebuild: F) -> Result<(), E>
where
    F: FnMut(usize, &T) -> Result<T, E>,
{
    let mut fresh = Vec::with_capacity(current.len());
    for (index, old) in current.iter().enumerate() {
        fresh.push(rebuild(index, old)?);
    }
    *current = fresh;
    Ok(())
}

/// The real backend is `DxgiMultiOutputSession` (Windows only); tests
/// use a scripted mock. `acquire_output` returns the FULL output frame
/// (the loop crops it); its guard is dropped by the loop immediately
/// after acquisition, before conversion — the brief's release order.
/// `refresh_snapshot` re-enumerates and bumps the generation; the loop
/// calls it only on the single retry, after `recreate_all`.
pub trait MultiOutputBackend {
    fn acquire_output(
        &mut self,
        output: &OutputInfo,
        timeout_ms: u32,
        limits: &DxgiLimits,
    ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError>;
    /// Rebuild every output's device-dependent resource set (same
    /// bounded budget as DXGI-1's per-output recreate: at most once per
    /// request, driven by the loop).
    fn recreate_all(&mut self) -> Result<(), DxgiAcquireError>;
    /// Re-enumerate the topology and return the new snapshot (generation
    /// bumped). The loop adopts it for the single retry.
    fn refresh_snapshot(&mut self) -> Result<TopologySnapshot, String>;
    /// Generation of the snapshot this backend currently serves.
    fn snapshot_generation(&self) -> u64;
}

/// Internal result of one whole-request acquisition pass.
enum MultiPass {
    /// All outputs acquired, rotated, cropped, and ready to paste.
    Ready(Vec<(OutputContribution, DxgiFrame, DxgiFrameMetadata)>),
    /// Topology went stale mid-request (loss, size mismatch, or a
    /// generation change): discard everything, retry once.
    Stale,
    /// Terminal outcome: discard everything, do not retry.
    Terminal(DxgiMultiOutputOutcome),
}

/// Capture `rect` across every intersecting output in `snapshot`.
///
/// Real-clock entry point: elapsed time comes from `Instant::now()`.
/// See [`capture_multi_output_with_clock`] for the deterministic
/// deadline source used by tests.
pub fn capture_multi_output<B: MultiOutputBackend>(
    backend: &mut B,
    snapshot: &TopologySnapshot,
    rect: RectI,
    limits: &DxgiLimits,
) -> DxgiMultiOutputOutcome {
    let start = Instant::now();
    capture_multi_output_with_clock(backend, snapshot, rect, limits, move || start.elapsed())
}

/// Multi-output capture with an injected elapsed-time source.
///
/// The whole request — every output's acquires — shares ONE total
/// deadline (the DXGI-1 `attempt_timeout_ms` rule, including the single
/// final nonblocking 0ms poll per request). On any stale signal the
/// loop discards all partial frames, recreates all outputs, refreshes
/// the snapshot, and retries the ENTIRE request exactly once; a second
/// stale signal is terminal. Protected/unavailable/terminal errors on
/// any output end the request immediately with partials discarded —
/// never a partial composite.
pub fn capture_multi_output_with_clock<B: MultiOutputBackend, F: FnMut() -> Duration>(
    backend: &mut B,
    snapshot: &TopologySnapshot,
    rect: RectI,
    limits: &DxgiLimits,
    mut elapsed: F,
) -> DxgiMultiOutputOutcome {
    let mut snapshot = snapshot.clone();
    let mut retried = false;
    loop {
        let plan = match plan_composition(&snapshot, rect, limits) {
            Ok(plan) => plan,
            Err(e) => {
                return DxgiMultiOutputOutcome::Unavailable(format!(
                    "composition plan failed: {e}"
                ))
            }
        };
        match acquire_all_outputs(backend, &plan, limits, &mut elapsed) {
            MultiPass::Ready(frames) => {
                // A generation change during acquisition invalidates
                // the plan even though every acquire succeeded.
                if backend.snapshot_generation() != snapshot.generation {
                    drop(frames);
                    if retried {
                        return DxgiMultiOutputOutcome::Retryable(
                            "topology changed again after one retry".into(),
                        );
                    }
                    match retry_from_fresh_snapshot(backend) {
                        Ok(fresh) => {
                            snapshot = fresh;
                            retried = true;
                            continue;
                        }
                        Err(outcome) => return outcome,
                    }
                }
                // Destination size was validated by the plan, so this
                // allocation cannot exceed the raster budget.
                let dest_len = plan.dest_width as usize
                    * plan.dest_height as usize
                    * 4;
                let mut rgba = vec![0u8; dest_len];
                let mut per_output = Vec::new();
                let dest_stride = plan.dest_width as usize * 4;
                for (sequence, (contribution, cropped, info)) in
                    frames.into_iter().enumerate()
                {
                    // Defensive bounds check: the plan guarantees the
                    // paste fits, but a paste must never write outside
                    // the destination on a logic slip.
                    let src_stride = contribution.width as usize * 4;
                    let fits = cropped.width == contribution.width
                        && cropped.height == contribution.height
                        && cropped.rgba.len() == src_stride * contribution.height as usize
                        && (contribution.dest_x as usize) + (contribution.width as usize)
                            <= plan.dest_width as usize
                        && (contribution.dest_y as usize) + (contribution.height as usize)
                            <= plan.dest_height as usize;
                    if !fits {
                        drop(rgba);
                        return DxgiMultiOutputOutcome::Retryable(
                            "composite paste out of bounds".into(),
                        );
                    }
                    for row in 0..contribution.height as usize {
                        let dst_off = ((contribution.dest_y as usize + row) * dest_stride)
                            + contribution.dest_x as usize * 4;
                        let src_off = row * src_stride;
                        rgba[dst_off..dst_off + src_stride]
                            .copy_from_slice(&cropped.rgba[src_off..src_off + src_stride]);
                    }
                    per_output.push(DxgiOutputAcquisition {
                        device_name: contribution.output.device_name.clone(),
                        adapter_luid: contribution.output.adapter_luid,
                        frame_info: info,
                        sequence,
                    });
                }
                return DxgiMultiOutputOutcome::Frame(DxgiCompositeFrame {
                    frame: DxgiFrame {
                        width: plan.dest_width,
                        height: plan.dest_height,
                        rgba,
                        frame_info: DxgiFrameMetadata::default(),
                    },
                    per_output,
                });
            }
            MultiPass::Stale => {
                if retried {
                    return DxgiMultiOutputOutcome::Retryable(
                        "topology changed again after one retry".into(),
                    );
                }
                match retry_from_fresh_snapshot(backend) {
                    Ok(fresh) => {
                        snapshot = fresh;
                        retried = true;
                        continue;
                    }
                    Err(outcome) => return outcome,
                }
            }
            MultiPass::Terminal(outcome) => return outcome,
        }
    }
}

/// Recreate all outputs, then refresh the snapshot. Either failure is
/// terminal: the loop must not retry from a half-rebuilt backend.
fn retry_from_fresh_snapshot<B: MultiOutputBackend>(
    backend: &mut B,
) -> Result<TopologySnapshot, DxgiMultiOutputOutcome> {
    if let Err(e) = backend.recreate_all() {
        return Err(DxgiMultiOutputOutcome::Retryable(format!(
            "multi-output recreate failed: {e:?}"
        )));
    }
    backend.refresh_snapshot().map_err(|e| {
        DxgiMultiOutputOutcome::Retryable(format!("topology refresh failed: {e}"))
    })
}

/// One acquisition pass over a plan's contributions. Every guard is
/// dropped immediately after its acquire (before conversion); every
/// partial frame is dropped by the caller on `Stale`/`Terminal`.
fn acquire_all_outputs<B: MultiOutputBackend, F: FnMut() -> Duration>(
    backend: &mut B,
    plan: &CompositionPlan,
    limits: &DxgiLimits,
    elapsed: &mut F,
) -> MultiPass {
    let mut frames = Vec::new();
    // DXGI2-002: the final-poll grant is shared across the whole
    // request, not reset per output. At most one final nonblocking
    // 0ms poll per REQUEST (DXGI1-005A), however many outputs the
    // request covers: once any output spends it, later outputs get
    // no final poll of their own.
    let mut final_poll_done = false;
    for contribution in &plan.contributions {
        let acquired = loop {
            // Same deadline rule as DXGI-1: an attempt never blocks
            // past the total request deadline; at most one final
            // nonblocking 0ms poll per REQUEST (DXGI1-005A, shared
            // across outputs via the flag above). A 0ms poll never
            // blocks, so the hard total bound still holds exactly.
            let e = elapsed();
            let timeout_ms = match attempt_timeout_ms(limits, e) {
                Some(t) => t,
                None => {
                    let deadline = Duration::from_millis(limits.total_deadline_ms as u64);
                    if !final_poll_done && e < deadline {
                        final_poll_done = true;
                        0
                    } else {
                        break None;
                    }
                }
            };
            match backend.acquire_output(&contribution.output, timeout_ms, limits) {
                Ok((guard, pixels)) => {
                    // Release before any CPU conversion work.
                    drop(guard);
                    break Some(pixels);
                }
                Err(DxgiAcquireError::WaitTimeout) => {
                    // Stable unchanged desktop: retry until the
                    // loop-top deadline check stops us.
                }
                Err(DxgiAcquireError::AccessLost)
                | Err(DxgiAcquireError::DeviceRemoved)
                | Err(DxgiAcquireError::StageFailed(_)) => {
                    drop(frames);
                    return MultiPass::Stale;
                }
                Err(DxgiAcquireError::Protected) => {
                    drop(frames);
                    return MultiPass::Terminal(DxgiMultiOutputOutcome::ProtectedOrSecure(
                        "protected or secure content on an output".into(),
                    ));
                }
                Err(DxgiAcquireError::SessionDisconnected) => {
                    drop(frames);
                    return MultiPass::Terminal(DxgiMultiOutputOutcome::Unavailable(
                        "session disconnected".into(),
                    ));
                }
                Err(DxgiAcquireError::Unavailable(reason)) => {
                    drop(frames);
                    return MultiPass::Terminal(DxgiMultiOutputOutcome::Unavailable(reason));
                }
                Err(DxgiAcquireError::Other(msg)) => {
                    drop(frames);
                    return MultiPass::Terminal(DxgiMultiOutputOutcome::Retryable(msg));
                }
            }
        };
        let Some(pixels) = acquired else {
            drop(frames);
            return MultiPass::Terminal(DxgiMultiOutputOutcome::Retryable(
                "no new desktop frame within the total request deadline".into(),
            ));
        };
        // Caller-side limit check, mirroring DXGI-1: an oversize
        // acquired frame is refused, never allocated around.
        if let Err(e) = validate_limits(pixels.width, pixels.height, limits) {
            drop(frames);
            return MultiPass::Terminal(DxgiMultiOutputOutcome::Unavailable(format!(
                "acquired frame violates limits: {e}"
            )));
        }
        let Some(rgba) =
            convert_bgra_to_rgba_pitched(&pixels.bgra, pixels.width, pixels.height, pixels.row_pitch)
        else {
            drop(frames);
            return MultiPass::Terminal(DxgiMultiOutputOutcome::Retryable(
                "staging buffer too short or row pitch invalid".into(),
            ));
        };
        let full = DxgiFrame {
            width: pixels.width,
            height: pixels.height,
            rgba,
            frame_info: pixels.frame_info,
        };
        let Some(rotated) = rotate_frame(&full, contribution.output.rotation) else {
            drop(frames);
            return MultiPass::Terminal(DxgiMultiOutputOutcome::Unavailable(format!(
                "output rotation {:?} cannot be applied",
                contribution.output.rotation
            )));
        };
        // The rotated frame must match the output's desktop rect
        // exactly; anything else means the topology moved under us
        // (mode/rotation change) — discard and retry once.
        if rotated.width as u64 != contribution.output.rect.w
            || rotated.height as u64 != contribution.output.rect.h
        {
            drop(frames);
            return MultiPass::Stale;
        }
        // Crop offsets: the crop lies inside the output rect, so the
        // differences are non-negative and bounded by the rotated
        // frame (checked just above).
        let ox = (contribution.crop.x - contribution.output.rect.x) as u32;
        let oy = (contribution.crop.y - contribution.output.rect.y) as u32;
        let Some(cropped) = crop_frame(
            &rotated,
            ox,
            oy,
            contribution.width,
            contribution.height,
        ) else {
            drop(frames);
            return MultiPass::Stale;
        };
        frames.push((contribution.clone(), cropped, pixels.frame_info));
    }
    MultiPass::Ready(frames)
}

