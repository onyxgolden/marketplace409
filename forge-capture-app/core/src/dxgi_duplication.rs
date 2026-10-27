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
//! - `ACCESS_LOST` / device removed: invalidate, rebuild once, retry the
//!   whole request; a second loss is a terminal [`DxgiCaptureOutcome::Retryable`].
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

/// One captured frame: RGBA bytes (row-major, no pitch padding).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DxgiFrame {
    pub width: u32,
    pub height: u32,
    /// Exactly `width * height * 4` bytes.
    pub rgba: Vec<u8>,
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
}

/// The duplication session behind [`capture_single_output`].
///
/// The real backend is [`DxgiCaptureContext`] (Windows only); tests use a
/// scripted mock. `acquire` returns the guard alongside the pixels: the
/// caller drops it immediately after the GPU copy, before conversion —
/// the brief's release-before-mapping order.
pub trait DuplicationBackend {
    fn acquire(
        &mut self,
        timeout_ms: u32,
    ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError>;
    /// Invalidate and rebuild the duplication object (and staging state)
    /// after `ACCESS_LOST` / device removal. Called at most once per
    /// request by [`capture_single_output`].
    fn recreate(&mut self) -> Result<(), DxgiAcquireError>;
}

/// Capture `rect` from one output (DXGI-1: single-output only).
///
/// `rect` must lie fully inside `output.rect`; a rect spanning outputs or
/// outside this output is an explicit [`DxgiCaptureOutcome::Unavailable`]
/// naming DXGI-2, never a partial or shifted image. Non-identity rotation
/// is likewise unavailable in DXGI-1. No frame is ever cached: a
/// `WAIT_TIMEOUT` past the total deadline is terminal, not a stale frame.
pub fn capture_single_output<B: DuplicationBackend>(
    backend: &mut B,
    output: &OutputInfo,
    rect: RectI,
    limits: &DxgiLimits,
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
    let start = Instant::now();
    let deadline = Duration::from_millis(limits.total_deadline_ms as u64);
    let mut recreated = false;
    loop {
        match backend.acquire(limits.acquire_timeout_ms) {
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
                if start.elapsed() >= deadline {
                    return DxgiCaptureOutcome::Retryable(
                        "no new desktop frame within the total request deadline".into(),
                    );
                }
                // Stable unchanged desktop: not a failure. Retry.
            }
            Err(DxgiAcquireError::AccessLost) | Err(DxgiAcquireError::DeviceRemoved) => {
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
        classify_hresult, AcquiredPixels, DxgiAcquireError, DxgiCaptureOutcome, DxgiLimits,
        DxgiRotation, FrameGuard, OutputInfo,
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

    const RPC_E_CHANGED_MODE: i32 = -2147417850; // 0x80010106 as i32

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..end])
            .to_string_lossy()
            .into_owned()
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
            let mut device: Option<ID3D11Device> = None;
            let mut device_context: Option<ID3D11DeviceContext> = None;
            // D3D11CreateDevice takes the base IDXGIAdapter; the Adapter1
            // handle stays owned by the context (cast only AddRefs it).
            let adapter_base: IDXGIAdapter = adapter.cast().map_err(|e| {
                CaptureError::NativeApi(format!("IDXGIAdapter1::cast to IDXGIAdapter: {e}"))
            })?;
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
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
            let duplication = match &self.duplication {
                Some(d) => d.clone(),
                None => {
                    return Err(DxgiAcquireError::Unavailable(
                        "duplication object not initialized".into(),
                    ))
                }
            };
            // No guard yet: nothing is held until AcquireNextFrame succeeds.
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            let acquire_result =
                unsafe { duplication.AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource) };
            if let Err(e) = acquire_result {
                return Err(classify_hresult(e.code().0));
            }
            let resource = match resource {
                Some(r) => r,
                None => {
                    return Err(DxgiAcquireError::Other(
                        "AcquireNextFrame succeeded with no resource".into(),
                    ));
                }
            };
            let texture: ID3D11Texture2D = match resource.cast() {
                Ok(t) => t,
                Err(e) => {
                    return Err(DxgiAcquireError::Other(format!(
                        "acquired resource is not a texture: {e}"
                    )));
                }
            };
            // RAII guard: ReleaseFrame on every path through the GPU copy,
            // including unwind. Released explicitly below, before mapping.
            let guard = FrameGuard::new({
                let d = duplication.clone();
                move || {
                    let _ = unsafe { d.ReleaseFrame() };
                }
            });
            let mut tex_desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut tex_desc) };
            let (width, height) = (tex_desc.Width, tex_desc.Height);
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
                    return Err(DxgiAcquireError::Other(format!(
                        "CreateTexture2D (staging): {e}"
                    )));
                }
                self.staging = staging;
                self.staging_size = (width, height);
            }
            let staging = match &self.staging {
                Some(s) => s.clone(),
                None => {
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
                        return Err(DxgiAcquireError::Other(format!(
                            "staging texture cast to resource: {e}"
                        )))
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
                return Err(DxgiAcquireError::Other(format!(
                    "Map staging texture: {e}"
                )));
            }
            let row_pitch = mapped.RowPitch as usize;
            let byte_len = row_pitch.saturating_mul(height as usize);
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
            unsafe {
                self.device_context.Unmap(&staging_resource, 0);
            }
            Ok((
                guard,
                AcquiredPixels {
                    width,
                    height,
                    row_pitch,
                    bgra,
                },
            ))
        }

        fn recreate(&mut self) -> Result<(), DxgiAcquireError> {
            self.recreate_duplication().map_err(|e| match e {
                crate::result::CaptureError::NativeApi(msg) => {
                    DxgiAcquireError::Other(msg)
                }
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
        }
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
    }

    impl MockBackend {
        fn new(steps: Vec<Step>) -> Self {
            Self {
                steps: steps.into(),
                releases: Arc::new(AtomicUsize::new(0)),
                recreates: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    impl DuplicationBackend for MockBackend {
        fn acquire(
            &mut self,
            _timeout_ms: u32,
        ) -> Result<(FrameGuard, AcquiredPixels), DxgiAcquireError> {
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

    #[test]
    fn conversion_failure_releases_and_is_retryable() {
        // Pitch narrower than a row: conversion fails after acquisition.
        let mut backend = MockBackend::new(vec![Step::Ok(AcquiredPixels {
            width: 4,
            height: 2,
            row_pitch: 4,
            bgra: vec![0u8; 32],
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
