//! Process Training (PT-1) capture pipeline — the Windows-only hook,
//! capture-worker, and UI-Automation-evidence boundary the approved
//! design (five review rounds; final GO at `forge-ai-drop` commit
//! `ef775709`) specifies. All decision logic — click/drag/double-click
//! classification, the privacy decision, sequence-gap detection — is pure
//! and lives in [`crate::process_session`], already unit-tested there.
//! This module is only the OS boundary that feeds real input into that
//! logic and produces real pixels; it owns no policy of its own.
//!
//! # Nothing here is activated by this sub-slice
//!
//! [`start`] is the one entry point that installs a real, global,
//! system-wide low-level mouse hook. Nothing in this crate, this app, or
//! any test calls it. It exists, compiles, and type-checks for the
//! Windows target; its runtime behavior is unverified without a live
//! desktop session and a human explicitly choosing to start a session —
//! a decision this sub-slice deliberately does not make. Per this
//! codebase's established convention for Windows-only code (see
//! `native.rs`'s own doc comment), "compile-verified, runtime-unverified
//! without real hardware" is the accepted bar at this stage; the
//! three-thread architecture itself has no meaningful way to be
//! unit-tested beyond what `process_session.rs` already covers, since it
//! is fundamentally OS thread/message-loop/COM wiring, not pure logic.
//!
//! # Three threads, matching the approved design exactly
//!
//! - **Hook thread**: installs `WH_MOUSE_LL`, runs only the minimal
//!   message loop a low-level hook requires. The `HOOKPROC` itself does
//!   the absolute minimum — read the raw `MSLLHOOKSTRUCT`, assign the
//!   next `sequenceId` (one atomic counter, the single source of
//!   ordering truth for the whole pipeline), and a bounded, non-blocking
//!   push to the capture worker's queue. No GDI, no COM, no screenshot,
//!   nothing that can stall ever runs inside the hook callback or
//!   anywhere else on this thread.
//! - **Capture worker thread**: drains the hook thread's queue in strict
//!   FIFO order (a single consumer, which is what keeps `sequenceId`
//!   order intact end to end with no re-sorting needed anywhere) and
//!   performs the GDI screenshot for each event immediately on dequeue —
//!   pixels are captured close to the click, independent of however long
//!   UI Automation enrichment later takes. Hands the raw RGBA buffer
//!   onward over a second bounded, non-blocking queue.
//! - **Evidence thread**: the only thread that owns `IUIAutomation` (one
//!   STA `CoInitializeEx` for its whole life). Self-exclusion by PID,
//!   click-pair/drag classification
//!   ([`crate::process_session::ClickClassifier`]), UI Automation and
//!   native-Win32 enrichment of the clicked target, the privacy decision
//!   ([`crate::process_session::decide_sensitivity`]), and applying that
//!   decision to the already-captured buffer (redact in place via
//!   [`crate::annotations::paint_redaction_rect`], or drop the buffer
//!   entirely when withheld) all happen here, before anything is handed
//!   to the caller's sink.
//!
//! Every queue between stages is bounded (both by item count and an
//! estimated byte budget, since a queued item can carry an uncompressed
//! RGBA frame) and non-blocking: on overflow the oldest unconsumed item
//! is dropped and a counter increments, so the hook thread can never be
//! made to wait on a slow downstream stage.
//!
//! # What this sub-slice does *not* implement
//!
//! Per the final (round 5) design, there is no automatic "verified safe"
//! structural scan of a whole window's control tree — that approach was
//! explicitly retracted as cryptographically/structurally unreliable (see
//! the design review trail). Detection here is scoped to the clicked
//! target only, exactly matching
//! [`crate::process_session::SensitivitySignals`]'s own shape: UI
//! Automation `IsPassword`, a native password-char check (only ever
//! attempted on a control already confirmed to be a classic `Edit`/
//! `RichEdit` class, bounded by `SendMessageTimeout`), an owner-draw
//! style-bit check, and the sensitive-name heuristic
//! ([`crate::process_session::name_matches_sensitive_heuristic`]). A
//! `Default`-trust process never runs any of this for persistence
//! purposes — the screenshot is withheld unconditionally before
//! detection would even matter.

use crate::coords::RectI;
use crate::process_session::{ClassifiedClick, MouseButton};

/// Session-scoped configuration the Tauri shell builds fresh each
/// session. Never persisted by this module.
#[derive(Debug, Clone, Default)]
pub struct ProcessCaptureConfig {
    /// FORGE Capture's own PID, for self-exclusion — a click landing on
    /// this app's own window (main window, any overlay) is discarded
    /// before anything else runs, never recorded as an event at all.
    pub self_pid: u32,
    /// Lowercase executable file names (e.g. `"notepad.exe"`) the author
    /// has explicitly granted session-scoped trust to. Never a global or
    /// persisted setting — rebuilt by the caller every session, and the
    /// caller is responsible for having shown the author the exact
    /// disclosure the design requires before adding an entry here.
    pub author_trusted_processes: std::collections::HashSet<String>,
    /// Whether window titles and control names are persisted verbatim.
    /// Opt-in, off by default — see the design's metadata-leakage fix. A
    /// structural placeholder (process name + control type) is used when
    /// this is false.
    pub persist_verbatim_metadata: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustLabel {
    AuthorTrusted,
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensitivityDecisionLabel {
    ProceedNormally,
    RedactRegion,
    Withhold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrivacyOutcome {
    pub trust: TrustLabel,
    pub decision: SensitivityDecisionLabel,
}

/// Best-effort evidence about the clicked control. Any field being
/// `None` means that specific signal did not run or did not answer —
/// never treated as a negative result (see `process_session`'s own
/// fail-closed discipline).
#[derive(Debug, Clone, Default)]
pub struct TargetEvidence {
    pub name: Option<String>,
    /// Raw numeric `UIA_CONTROLTYPE_ID`, not a friendly name — mapping to
    /// a human label is a presentation concern for a later slice.
    pub control_type_id: Option<i32>,
    pub automation_id: Option<String>,
    pub bounding_rect_physical: Option<RectI>,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Click,
    DoubleClick,
    Drag,
}

impl EventKind {
    fn from_classified(c: &ClassifiedClick) -> (Self, (i64, i64)) {
        match *c {
            ClassifiedClick::Click { x, y } => (EventKind::Click, (x, y)),
            ClassifiedClick::DoubleClick { x, y } => (EventKind::DoubleClick, (x, y)),
            ClassifiedClick::Drag { from, .. } => (EventKind::Drag, from),
        }
    }
}

/// One fully classified, evidenced, privacy-decided event — the shape the
/// Tauri shell turns into a durable `process_session` event record.
#[derive(Debug, Clone)]
pub struct ProcessCaptureEvent {
    pub sequence_id: u64,
    pub hook_timestamp_ms: u64,
    pub capture_timestamp_ms: u64,
    pub kind: EventKind,
    pub point: (i64, i64),
    pub target: Option<TargetEvidence>,
    /// `Some((width, height, rgba))` only when a screenshot was captured
    /// *and* the privacy decision allows it to be persisted (already
    /// redacted in place when the decision was `RedactRegion`). `None`
    /// when withheld or when no screenshot was attempted.
    pub screenshot: Option<(u32, u32, Vec<u8>)>,
    pub privacy: PrivacyOutcome,
}

/// A gap in observed `sequenceId`s, surfaced honestly rather than
/// silently dropped — see `process_session::detect_sequence_gaps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GapMarker {
    pub first_missing: u64,
    pub last_missing: u64,
}

#[derive(Debug, Clone)]
pub enum PipelineMessage {
    Event(ProcessCaptureEvent),
    Gap(GapMarker),
    /// A queue between pipeline stages dropped one or more items to stay
    /// within its bound. `dropped_count` is that queue's running total,
    /// not a delta — the caller can diff against the last value it saw.
    /// Surfaced explicitly rather than only inferred from a later
    /// sequence-id gap, since a drop that happens to be the *last* event
    /// before a session stops would otherwise never show up as a gap at
    /// all (nothing after it to reveal the hole).
    QueueOverflow {
        stage: &'static str,
        dropped_count: u64,
    },
    /// End-of-session reconciliation could not confirm the hook thread
    /// had fully stopped (incrementing the shared sequence counter)
    /// before the wait deadline passed. Emitted *instead of* a terminal
    /// `Gap` in that case — reading the counter and reporting a range as
    /// if it were the definitive final state would be presenting an
    /// unconfirmed snapshot as fact; this says plainly that the trailing
    /// portion of the session is unknown, not confirmed-complete.
    /// `last_processed_seq` is the last sequence id this thread actually
    /// finished processing, for whatever partial accounting is possible.
    SessionReconciliationUncertain {
        last_processed_seq: Option<u64>,
    },
}

/// Raw down/up transition the hook thread hands onward — plain data,
/// nothing OS-specific, so it reuses `process_session::MouseButton`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RawHookEvent {
    pub sequence_id: u64,
    pub hook_timestamp_ms: u64,
    pub x: i64,
    pub y: i64,
    pub button: MouseButton,
    pub is_down: bool,
    /// The owning process's PID for the window under the cursor at the
    /// time of this raw event — captured on the hook thread via a cheap,
    /// non-blocking `WindowFromPoint`/`GetWindowThreadProcessId` pair
    /// (not a COM/UIA call), so self-exclusion can happen immediately on
    /// the evidence thread without a second native round-trip.
    pub window_pid: u32,
    /// The raw `HWND` value (as `isize`, so this type stays plain `Copy`
    /// data safe to move across threads) for the window under the cursor
    /// at hook time — the *same* window every later stage must use,
    /// rather than each stage independently re-resolving "whatever is at
    /// this point now" via its own fresh `WindowFromPoint` call. Threading
    /// one resolved identity through the whole pipeline is what closes the
    /// TOCTOU gap a design review caught: with three independent
    /// `WindowFromPoint` calls at three different times (hook, capture,
    /// evidence), a window change in between could let one process's
    /// frame get authorized using a different process's identity. `0`
    /// means no window was under the point at hook time.
    pub hwnd_value: isize,
}

/// A captured frame, handed from the capture worker to the evidence
/// thread. The captured region is always exactly the clicked top-level
/// window's own rect — never a whole monitor — so no pixels belonging to
/// any other window are ever read into this buffer in the first place,
/// regardless of what the privacy decision later turns out to be: trust
/// is granted per process, so the capture scope must match that exactly,
/// not merely "whatever happens to share the same screen."
pub(crate) struct CapturedFrame {
    pub raw: RawHookEvent,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Top-left of the captured rect in the same physical/virtual-desktop
    /// space as `raw.x`/`raw.y` — the window's own origin now, not a
    /// monitor's, though the "subtract this to get local buffer
    /// coordinates" math downstream is unchanged either way.
    pub capture_origin: (i64, i64),
}

/// Non-blocking, bounded-by-count-and-bytes handoff. `send` never blocks:
/// on overflow it drops the oldest queued item and reports that drop
/// rather than ever stalling its caller — this is what keeps the hook
/// thread's loop free regardless of how far behind a downstream stage
/// falls. Pure, host-independent queueing logic; the threads that use it
/// are Windows-only, but this type itself is not. Fully `pub` (not just
/// `pub(crate)`) so the Tauri shell can apply the same bounded,
/// drop-oldest-and-count policy to its own in-memory event buffer rather
/// than accumulate an unbounded `Vec` of potentially huge RGBA frames.
pub struct BoundedDropOldest<T> {
    inner: std::collections::VecDeque<T>,
    max_items: usize,
    max_bytes: usize,
    current_bytes: usize,
    size_of: fn(&T) -> usize,
    pub dropped_count: u64,
}

impl<T> BoundedDropOldest<T> {
    pub fn new(max_items: usize, max_bytes: usize, size_of: fn(&T) -> usize) -> Self {
        BoundedDropOldest {
            inner: std::collections::VecDeque::new(),
            max_items,
            max_bytes,
            current_bytes: 0,
            size_of,
            dropped_count: 0,
        }
    }

    /// Pushes `item`, dropping the oldest queued item(s) first if needed
    /// to stay within both the count and byte budgets. Never blocks.
    pub fn push(&mut self, item: T) {
        let item_size = (self.size_of)(&item);
        while (self.inner.len() >= self.max_items
            || self.current_bytes + item_size > self.max_bytes)
            && !self.inner.is_empty()
        {
            if let Some(old) = self.inner.pop_front() {
                self.current_bytes = self.current_bytes.saturating_sub((self.size_of)(&old));
                self.dropped_count += 1;
            }
        }
        self.current_bytes += item_size;
        self.inner.push_back(item);
    }

    pub fn pop(&mut self) -> Option<T> {
        let item = self.inner.pop_front();
        if let Some(ref i) = item {
            self.current_bytes = self.current_bytes.saturating_sub((self.size_of)(i));
        }
        item
    }
}

/// Decides `start`'s own outcome from the hook thread's and the evidence
/// thread's independently-reported startup results — pure, host-
/// independent logic (the two `Result`s it's given are plain data; it
/// never touches a thread, a channel, or the OS itself), extracted so it
/// can be unit-tested without installing anything. `None` means both
/// threads reported success; `Some(reason)` is what `start` returns as
/// its own `Err`. Review ask: "add mockable tests for lifecycle and error
/// branches where possible" — this is the one piece of that lifecycle
/// genuinely separable from real OS threads/COM/a hook.
pub(crate) fn resolve_startup_result(
    a: Result<Result<(), String>, std::sync::mpsc::RecvTimeoutError>,
    b: Result<Result<(), String>, std::sync::mpsc::RecvTimeoutError>,
) -> Option<String> {
    match (a, b) {
        (Ok(Ok(())), Ok(Ok(()))) => None,
        (Ok(Err(e)), _) => Some(format!("hook thread failed to start: {e}")),
        (_, Ok(Err(e))) => Some(format!("evidence thread failed to start: {e}")),
        (Err(_), _) => Some("hook thread did not report startup within the timeout".into()),
        (_, Err(_)) => Some("evidence thread did not report startup within the timeout".into()),
    }
}

/// The per-frame byte budget `validate_frame_dimensions` enforces.
/// Deliberately generous for any real monitor/window (a 7680×4320 8K
/// frame is ~133 MB) while still rejecting a malformed or extreme window
/// rect before any allocation is attempted.
pub(crate) const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024;
/// Per-dimension cap, matching real hardware limits with headroom —
/// GDI's own `CreateCompatibleBitmap` has comparable practical ceilings.
pub(crate) const MAX_FRAME_DIMENSION: i32 = 16384;

/// Validates a window rect's width/height are sane *before* any
/// allocation or GDI call is attempted, returning the exact RGBA byte
/// length to allocate on success. Pure, host-independent arithmetic/logic
/// — extracted specifically so a malformed or extreme rect (whether from
/// a buggy window, a deliberately hostile one, or corrupted state) cannot
/// cause an excessive allocation, an integer overflow, or a process
/// termination; rejected here, before `CreateCompatibleBitmap`/`vec![]`
/// ever run, rather than discovered after the fact.
pub(crate) fn validate_frame_dimensions(width: i32, height: i32) -> Option<usize> {
    if width <= 0 || height <= 0 {
        return None;
    }
    if width > MAX_FRAME_DIMENSION || height > MAX_FRAME_DIMENSION {
        return None;
    }
    let pixels = (width as usize).checked_mul(height as usize)?;
    let bytes = pixels.checked_mul(4)?;
    if bytes > MAX_FRAME_BYTES {
        return None;
    }
    Some(bytes)
}

#[cfg(test)]
mod pure_tests {
    use super::{resolve_startup_result, validate_frame_dimensions, MAX_FRAME_DIMENSION};
    use std::sync::mpsc::RecvTimeoutError;

    #[test]
    fn both_threads_reporting_ok_is_overall_success() {
        assert_eq!(resolve_startup_result(Ok(Ok(())), Ok(Ok(()))), None);
    }

    #[test]
    fn hook_thread_error_is_surfaced_with_its_own_reason() {
        let result = resolve_startup_result(Ok(Err("boom".to_string())), Ok(Ok(())));
        assert_eq!(
            result,
            Some("hook thread failed to start: boom".to_string())
        );
    }

    #[test]
    fn evidence_thread_error_is_surfaced_with_its_own_reason_even_if_hook_succeeded() {
        let result = resolve_startup_result(Ok(Ok(())), Ok(Err("com failed".to_string())));
        assert_eq!(
            result,
            Some("evidence thread failed to start: com failed".to_string())
        );
    }

    #[test]
    fn hook_thread_timeout_is_reported_distinctly() {
        let result = resolve_startup_result(Err(RecvTimeoutError::Timeout), Ok(Ok(())));
        assert_eq!(
            result,
            Some("hook thread did not report startup within the timeout".to_string())
        );
    }

    #[test]
    fn evidence_thread_timeout_is_reported_distinctly() {
        let result = resolve_startup_result(Ok(Ok(())), Err(RecvTimeoutError::Timeout));
        assert_eq!(
            result,
            Some("evidence thread did not report startup within the timeout".to_string())
        );
    }

    #[test]
    fn a_disconnected_sender_is_treated_the_same_as_a_timeout() {
        // A panic in either spawned thread drops its sender without
        // sending -- this must fail the same way a timeout does, not
        // hang or panic itself.
        let result = resolve_startup_result(Err(RecvTimeoutError::Disconnected), Ok(Ok(())));
        assert_eq!(
            result,
            Some("hook thread did not report startup within the timeout".to_string())
        );
    }

    #[test]
    fn hook_failure_takes_priority_when_both_threads_fail() {
        // Not load-bearing which one "wins" when both fail, but the
        // result must be Some with a real reason either way, never None.
        let result = resolve_startup_result(
            Ok(Err("hook boom".to_string())),
            Ok(Err("evidence boom".to_string())),
        );
        assert!(result.is_some());
    }

    // -- validate_frame_dimensions --

    #[test]
    fn an_ordinary_window_size_is_accepted_with_the_right_byte_length() {
        assert_eq!(validate_frame_dimensions(1920, 1080), Some(1920 * 1080 * 4));
    }

    #[test]
    fn a_generously_large_but_real_monitor_size_is_still_accepted() {
        // 8K, ~133 MB -- within MAX_FRAME_BYTES, well below any real
        // display's actual limits.
        assert_eq!(validate_frame_dimensions(7680, 4320), Some(7680 * 4320 * 4));
    }

    #[test]
    fn zero_or_negative_dimensions_are_rejected() {
        assert_eq!(validate_frame_dimensions(0, 100), None);
        assert_eq!(validate_frame_dimensions(100, 0), None);
        assert_eq!(validate_frame_dimensions(-1, 100), None);
        assert_eq!(validate_frame_dimensions(100, -1), None);
    }

    #[test]
    fn a_dimension_beyond_the_per_axis_cap_is_rejected() {
        assert_eq!(validate_frame_dimensions(MAX_FRAME_DIMENSION + 1, 10), None);
        assert_eq!(validate_frame_dimensions(10, MAX_FRAME_DIMENSION + 1), None);
    }

    #[test]
    fn a_dimension_at_exactly_the_per_axis_cap_is_still_accepted_if_the_byte_budget_allows() {
        // MAX_FRAME_DIMENSION alone is accepted; only the product against
        // the other axis determines whether the byte budget is exceeded.
        assert_eq!(
            validate_frame_dimensions(MAX_FRAME_DIMENSION, 1),
            Some(MAX_FRAME_DIMENSION as usize * 4)
        );
    }

    #[test]
    fn a_product_within_axis_caps_but_exceeding_the_byte_budget_is_rejected() {
        // Both axes individually legal, but width * height * 4 exceeds
        // MAX_FRAME_BYTES -- this is exactly the "malformed/extreme rect"
        // case the review finding is about: no single dimension looks
        // absurd, but the allocation would be.
        assert_eq!(
            validate_frame_dimensions(MAX_FRAME_DIMENSION, MAX_FRAME_DIMENSION),
            None
        );
    }

    #[test]
    fn near_i32_max_dimensions_never_panic_via_overflow_and_are_rejected() {
        // Exercises the checked_mul path specifically -- a naive
        // `width * height * 4` with i32/usize casts could overflow for
        // inputs this large; this must return None, never panic.
        assert_eq!(validate_frame_dimensions(i32::MAX, i32::MAX), None);
        assert_eq!(validate_frame_dimensions(i32::MAX, 1), None);
    }
}

#[cfg(not(windows))]
mod stub {
    use super::*;
    use crate::result::CaptureError;

    pub struct ProcessCaptureHandle;

    impl ProcessCaptureHandle {
        pub fn stop(self) {}
    }

    pub fn start(
        _config: ProcessCaptureConfig,
        _sink: Box<dyn Fn(PipelineMessage) + Send + 'static>,
    ) -> Result<ProcessCaptureHandle, CaptureError> {
        Err(CaptureError::NativeApi(
            "process capture requires Windows; this host is not Windows".into(),
        ))
    }
}

#[cfg(not(windows))]
pub use stub::{start, ProcessCaptureHandle};

#[cfg(windows)]
pub use win::{start, ProcessCaptureHandle};

// ---------------------------------------------------------------------------
// Windows implementation. Compile-checked for the Windows target; runtime
// behavior is unverified without a live desktop session and an explicit
// human decision to start a session (see this module's own doc comment).
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod win {
    use super::*;
    use crate::annotations::paint_redaction_rect;
    use crate::process_session::{
        decide_sensitivity, name_matches_sensitive_heuristic, ClickClassifier, ClickTimingConfig,
        ProcessTrust, RawButtonEvent, SensitivitySignals,
    };
    use crate::result::CaptureError;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW,
        GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindow, PeekMessageW,
        PostThreadMessageW, SendMessageTimeoutW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GWL_STYLE, HHOOK, MSG, MSLLHOOKSTRUCT,
        PM_NOREMOVE, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
        WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    const BS_OWNERDRAW: i32 = 0x0000_000B;
    const LBS_OWNERDRAWFIXED: i32 = 0x0010;
    const LBS_OWNERDRAWVARIABLE: i32 = 0x0020;
    const CBS_OWNERDRAWFIXED: i32 = 0x0010;
    const CBS_OWNERDRAWVARIABLE: i32 = 0x0020;
    const EM_GETPASSWORDCHAR: u32 = 0x00D2;

    const QUEUE_MAX_ITEMS: usize = 8;
    const QUEUE_MAX_BYTES: usize = 256 * 1024 * 1024;

    /// Hard, structural kill switch — `start` refuses unconditionally while
    /// this is `false`, regardless of what any caller passes as
    /// `author_trusted_processes`. Review finding: "no caller exists yet"
    /// is an accident of this sub-slice having no UI, not an authorization
    /// boundary — `process_capture_start_session` is a registered Tauri
    /// command, and any code able to invoke it could self-assert an
    /// arbitrary trust list with nothing in the privileged Rust boundary
    /// to stop it. This constant is that stop, until a later slice (under
    /// its own review) replaces it with a real per-session, disclosed
    /// consent flow and removes this line deliberately rather than by
    /// accident. Flipping it is itself "the separate explicit
    /// authorization" the design's safety gate requires — not something
    /// this sub-slice does.
    const SESSIONS_ENABLED: bool = false;

    /// Reconstructs the `HWND` a `RawHookEvent`/`CapturedFrame` carries as
    /// a plain `isize`. See `RawHookEvent::hwnd_value`'s doc comment for
    /// why the same resolved window is threaded through every stage
    /// instead of each stage re-resolving it independently.
    fn hwnd_from_value(value: isize) -> HWND {
        HWND(value as *mut std::ffi::c_void)
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn last_error(context: &str) -> CaptureError {
        let code = unsafe { windows::Win32::Foundation::GetLastError() };
        CaptureError::NativeApi(format!("{context}: Win32 error {}", code.0))
    }

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    /// The leaf window at `point` and its owning PID only — `WindowFromPoint`
    /// plus `GetWindowThreadProcessId`, both local, non-blocking, bounded
    /// reads of window-manager data (no cross-process call). This is the
    /// *only* window/process lookup safe to run inside the hook callback;
    /// it deliberately does not resolve a process name, which needs
    /// `OpenProcess`/`QueryFullProcessImageNameW` — real cross-process
    /// calls with no bound on their latency, and a value the hook callback
    /// never needed anyway (self-exclusion compares PIDs, never names).
    fn pid_at_point(point: POINT) -> (u32, HWND) {
        let hwnd = unsafe { WindowFromPoint(point) };
        if hwnd.0.is_null() {
            return (0, hwnd);
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        (pid, hwnd)
    }

    /// The top-level window owning `hwnd` — `GetAncestor(hwnd, GA_ROOT)`,
    /// falling back to `hwnd` itself if it has no further ancestor (it is
    /// already top-level) or the call fails. Used so capture scope and the
    /// trust decision are both anchored to the same window: the one whose
    /// process the author actually trusted, not whatever leaf control
    /// happened to be under the cursor.
    fn root_window(hwnd: HWND) -> HWND {
        if hwnd.0.is_null() {
            return hwnd;
        }
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        if root.0.is_null() {
            hwnd
        } else {
            root
        }
    }

    /// `true` only when `hwnd` still denotes a live window *and* that
    /// window's current owning PID still equals `expected_pid` (the PID
    /// recorded at hook time). `IsWindow` alone proves a handle currently
    /// denotes *some* window, never that it is the *same* window — Windows
    /// reuses destroyed HWND values, so a recycled handle can belong to a
    /// different process by the time anything downstream of the hook gets
    /// to it. Shared by both the capture worker (gates capture itself,
    /// not just the later persist decision — see `capture_window_at`'s own
    /// doc comment for why that distinction matters) and the evidence
    /// thread (re-checked again, since still more time passes before
    /// persistence). Local, non-blocking (`GetWindowThreadProcessId`
    /// only) — safe to call from either thread.
    fn identity_matches(hwnd: HWND, expected_pid: u32) -> bool {
        if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return false;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid != 0 && pid == expected_pid
    }

    /// Owning process name (lowercase, no path) for `hwnd` and its PID.
    /// Only ever called on the evidence thread, which is allowed to block —
    /// `OpenProcess`/`QueryFullProcessImageNameW` are real cross-process
    /// calls, never safe inside the hook callback (see `pid_at_point`).
    fn process_name_for_hwnd(hwnd: HWND) -> (u32, Option<String>) {
        if hwnd.0.is_null() {
            return (0, None);
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        (pid, process_image_name(pid))
    }

    fn process_image_name(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            if ok.is_err() {
                return None;
            }
            let full = wide_to_string(&buf[..size as usize]);
            full.rsplit(['\\', '/']).next().map(|s| s.to_lowercase())
        }
    }

    /// Owner-draw style bit, checked per class — a direct `GWL_STYLE`
    /// read, not a cross-process pointer comparison (the technique round
    /// 4's design retracted as unreliable). Reliable cross-process since
    /// it is a plain stored attribute, not a code pointer.
    fn has_owner_draw_style(hwnd: HWND, class_name: &str) -> bool {
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as i32;
        match class_name {
            "Button" => style & BS_OWNERDRAW != 0,
            "ListBox" => style & (LBS_OWNERDRAWFIXED | LBS_OWNERDRAWVARIABLE) != 0,
            "ComboBox" => style & (CBS_OWNERDRAWFIXED | CBS_OWNERDRAWVARIABLE) != 0,
            _ => false,
        }
    }

    fn class_name_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        if len <= 0 {
            String::new()
        } else {
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }

    /// `EM_GETPASSWORDCHAR` only ever attempted on a confirmed `Edit`/
    /// `RichEdit` class, bounded by `SendMessageTimeout` (not a bare
    /// `SendMessage`) since this dispatches into the target process's own
    /// message queue and can genuinely hang against an unresponsive
    /// target. A timeout is treated the same as "no answer" — never as a
    /// negative/safe result.
    fn native_password_char_set(hwnd: HWND, class_name: &str) -> Option<bool> {
        let is_edit_class = matches!(class_name, "Edit" | "RichEdit20W" | "RichEdit50W");
        if !is_edit_class {
            return None;
        }
        let mut result: usize = 0;
        let timed_out = unsafe {
            SendMessageTimeoutW(
                hwnd,
                EM_GETPASSWORDCHAR,
                WPARAM(0),
                LPARAM(0),
                windows::Win32::UI::WindowsAndMessaging::SMTO_ABORTIFHUNG,
                500,
                Some(&mut result as *mut usize),
            )
        };
        if timed_out.0 == 0 {
            // Timed out or failed to deliver — unconfirmed, not safe.
            return None;
        }
        Some(result != 0)
    }

    /// UI Automation enrichment for the element at `point`. Best-effort:
    /// any UIA failure leaves every field `None` rather than guessing.
    fn uia_enrich(automation: &IUIAutomation, point: POINT) -> (TargetEvidence, Option<bool>) {
        let mut evidence = TargetEvidence::default();
        let mut is_password = None;
        if let Ok(element) = unsafe { automation.ElementFromPoint(point) } {
            if let Ok(name) = unsafe { element.CurrentName() } {
                evidence.name = Some(name.to_string());
            }
            if let Ok(ct) = unsafe { element.CurrentControlType() } {
                evidence.control_type_id = Some(ct.0);
            }
            if let Ok(aid) = unsafe { element.CurrentAutomationId() } {
                evidence.automation_id = Some(aid.to_string());
            }
            if let Ok(rect) = unsafe { element.CurrentBoundingRectangle() } {
                let w = (rect.right - rect.left).max(0) as u64;
                let h = (rect.bottom - rect.top).max(0) as u64;
                if w > 0 && h > 0 {
                    evidence.bounding_rect_physical = Some(RectI {
                        x: rect.left as i64,
                        y: rect.top as i64,
                        w,
                        h,
                    });
                }
            }
            if let Ok(pw) = unsafe { element.CurrentIsPassword() } {
                is_password = Some(pw.as_bool());
            }
        }
        (evidence, is_password)
    }

    fn gather_signals(
        evidence: &TargetEvidence,
        uia_is_password: Option<bool>,
        hwnd: HWND,
    ) -> SensitivitySignals {
        let class_name = class_name_of(hwnd);
        let known_class = matches!(
            class_name.as_str(),
            "Button" | "Edit" | "RichEdit20W" | "RichEdit50W" | "Static" | "ComboBox" | "ListBox"
        );
        let name_text = [
            evidence.name.as_deref().unwrap_or(""),
            evidence.automation_id.as_deref().unwrap_or(""),
        ]
        .join(" ");
        SensitivitySignals {
            uia_is_password,
            native_password_char_set: native_password_char_set(hwnd, &class_name),
            owner_drawn: has_owner_draw_style(hwnd, &class_name),
            unrecognized_or_unwalkable: !known_class,
            name_heuristic_matched: name_matches_sensitive_heuristic(&name_text),
            trustworthy_rect_available: evidence.bounding_rect_physical.is_some()
                && matches!(class_name.as_str(), "Edit" | "RichEdit20W" | "RichEdit50W"),
        }
    }

    pub struct ProcessCaptureHandle {
        stop_flag: Arc<AtomicBool>,
        hook_thread_id: Arc<Mutex<Option<u32>>>,
        joins: Vec<JoinHandle<()>>,
    }

    impl ProcessCaptureHandle {
        /// Signals every thread to stop and joins them: the hook thread
        /// exits its message loop (via `PostThreadMessageW(WM_QUIT)`,
        /// which also triggers it to unhook itself before exiting), the
        /// capture and evidence threads notice the stop flag on their
        /// next loop iteration. Self-exclusion, the UI Automation
        /// instance's `CoUninitialize`, and the hook's own
        /// `UnhookWindowsHookEx` all happen before this returns.
        pub fn stop(mut self) {
            self.stop_flag.store(true, Ordering::SeqCst);
            if let Ok(guard) = self.hook_thread_id.lock() {
                if let Some(tid) = *guard {
                    unsafe {
                        let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                    }
                }
            }
            for handle in self.joins.drain(..) {
                let _ = handle.join();
            }
        }
    }

    impl Drop for ProcessCaptureHandle {
        fn drop(&mut self) {
            self.stop_flag.store(true, Ordering::SeqCst);
            if let Ok(guard) = self.hook_thread_id.lock() {
                if let Some(tid) = *guard {
                    unsafe {
                        let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                    }
                }
            }
            for handle in self.joins.drain(..) {
                let _ = handle.join();
            }
        }
    }

    // HOOK_HANDLE is set only by the hook thread itself, read only by its
    // own HOOKPROC (both always on the same OS thread — a low-level
    // hook's callback runs on the thread that installed it) — genuinely
    // thread-local, never shared. SEQUENCE holds a clone of a *shared*
    // `Arc<AtomicU64>` (set once, at hook-thread startup) rather than a
    // private per-thread counter — `start` and the evidence thread both
    // need to read the same counter's final value for end-of-session gap
    // reconciliation (a trailing drop has nothing after it to reveal the
    // gap via the ordinary pairwise sequence check, so the counter's own
    // final value is the only way to detect one). Storing the `Arc` in a
    // thread-local (rather than directly in a shared static) is only
    // because `mouse_hook_proc` is a plain `extern "system" fn` with no
    // closure capture; the counter it increments is still the one shared
    // instance.
    thread_local! {
        static HOOK_HANDLE: std::cell::Cell<HHOOK> = const { std::cell::Cell::new(HHOOK(std::ptr::null_mut())) };
        static SEQUENCE: std::cell::RefCell<Option<Arc<AtomicU64>>> = const { std::cell::RefCell::new(None) };
    }

    // The channel the HOOKPROC pushes into, and an explicit counter for
    // the one loss mode a bounded queue's own `dropped_count` cannot see:
    // a `try_lock` failure means the push was never attempted at all, so
    // nothing inside `BoundedDropOldest` itself observes it. Thread-local
    // to the hook thread's own setup, populated once before the message
    // loop starts.
    thread_local! {
        static HOOK_SINK: std::cell::RefCell<Option<Arc<Mutex<BoundedDropOldest<RawHookEvent>>>>> =
            const { std::cell::RefCell::new(None) };
        static HOOK_TRYLOCK_MISSES: std::cell::RefCell<Option<Arc<AtomicU64>>> =
            const { std::cell::RefCell::new(None) };
    }

    unsafe extern "system" fn mouse_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let msg = wparam.0 as u32;
            let (is_down, button) = match msg {
                m if m == WM_LBUTTONDOWN => (true, MouseButton::Left),
                m if m == WM_LBUTTONUP => (false, MouseButton::Left),
                m if m == WM_RBUTTONDOWN => (true, MouseButton::Right),
                m if m == WM_RBUTTONUP => (false, MouseButton::Right),
                m if m == WM_MBUTTONDOWN => (true, MouseButton::Middle),
                m if m == WM_MBUTTONUP => (false, MouseButton::Middle),
                _ => (false, MouseButton::Left),
            };
            let relevant = matches!(
                msg,
                m if m == WM_LBUTTONDOWN || m == WM_LBUTTONUP || m == WM_RBUTTONDOWN
                    || m == WM_RBUTTONUP || m == WM_MBUTTONDOWN || m == WM_MBUTTONUP
            );
            if relevant {
                let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                let point = POINT {
                    x: info.pt.x,
                    y: info.pt.y,
                };
                // Self-exclusion's PID lookup and the hook-time bounded
                // push are the only work this callback does -- both are
                // local, non-blocking Win32 calls, with no process-name
                // resolution (no OpenProcess/QueryFullProcessImageNameW,
                // which are real cross-process calls with no latency
                // bound) -- self-exclusion only ever needs the PID.
                let (window_pid, hook_hwnd) = pid_at_point(point);
                let seq = SEQUENCE
                    .with(|s| {
                        s.borrow()
                            .as_ref()
                            .map(|c| c.fetch_add(1, Ordering::SeqCst))
                    })
                    .unwrap_or(0);
                let event = RawHookEvent {
                    sequence_id: seq,
                    hook_timestamp_ms: now_ms(),
                    x: info.pt.x as i64,
                    y: info.pt.y as i64,
                    button,
                    is_down,
                    window_pid,
                    hwnd_value: hook_hwnd.0 as isize,
                };
                HOOK_SINK.with(|sink| {
                    if let Some(queue) = sink.borrow().as_ref() {
                        match queue.try_lock() {
                            Ok(mut q) => q.push(event),
                            Err(_) => {
                                // A held lock here means the capture
                                // worker is mid-drain; this one event is
                                // lost rather than the hook callback ever
                                // blocking on a lock. Explicitly counted
                                // (not just left to be inferred from a
                                // later sequence-id gap, which a trailing
                                // miss would never produce) -- the
                                // evidence thread surfaces this counter
                                // the same way it surfaces each queue's
                                // own dropped_count.
                                HOOK_TRYLOCK_MISSES.with(|c| {
                                    if let Some(counter) = c.borrow().as_ref() {
                                        counter.fetch_add(1, Ordering::SeqCst);
                                    }
                                });
                            }
                        }
                    }
                });
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Starts the three-thread pipeline. See this module's doc comment
    /// for the architecture; **nothing calls this function anywhere in
    /// this codebase as of this sub-slice** — and even a caller that did
    /// would get `Err` unconditionally, since [`SESSIONS_ENABLED`] is
    /// `false`. Blocks briefly (bounded by `STARTUP_TIMEOUT`) waiting for
    /// both the hook thread and the evidence thread to report their own
    /// startup result before returning, so a `SetWindowsHookExW` or COM
    /// initialization failure is returned to the caller as `Err` rather
    /// than silently leaving a handle that looks active but has no
    /// working hook or evidence stage behind it.
    pub fn start(
        config: ProcessCaptureConfig,
        sink: Box<dyn Fn(PipelineMessage) + Send + 'static>,
    ) -> Result<ProcessCaptureHandle, CaptureError> {
        if !SESSIONS_ENABLED {
            return Err(CaptureError::NativeApi(
                "process-capture sessions are not yet enabled; this is a structural kill switch \
                 in process_capture.rs, not a missing caller — see SESSIONS_ENABLED's own doc \
                 comment"
                    .to_string(),
            ));
        }

        const STARTUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

        let stop_flag = Arc::new(AtomicBool::new(false));
        let hook_thread_id: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
        let sequence_counter = Arc::new(AtomicU64::new(1));
        // Set only by the hook thread, as the literal last thing it does
        // before returning -- the ordering barrier end-of-session
        // reconciliation waits on (see that code, in the evidence
        // thread's exit path) before it is safe to read sequence_counter's
        // final value.
        let hook_fully_stopped = Arc::new(AtomicBool::new(false));
        // Explicit loss counters for the two drop modes a queue's own
        // `dropped_count` cannot see: a hook-callback `try_lock` miss
        // (the push was never attempted) and a capture failure (the
        // worker had an event but produced no frame for it).
        let hook_trylock_misses = Arc::new(AtomicU64::new(0));
        let capture_failures = Arc::new(AtomicU64::new(0));

        let a_to_c: Arc<Mutex<BoundedDropOldest<RawHookEvent>>> = Arc::new(Mutex::new(
            BoundedDropOldest::new(QUEUE_MAX_ITEMS, QUEUE_MAX_BYTES, |_: &RawHookEvent| {
                std::mem::size_of::<RawHookEvent>()
            }),
        ));
        let c_to_b: Arc<Mutex<BoundedDropOldest<CapturedFrame>>> = Arc::new(Mutex::new(
            BoundedDropOldest::new(QUEUE_MAX_ITEMS, QUEUE_MAX_BYTES, |f: &CapturedFrame| {
                f.rgba.len() + 64
            }),
        ));

        let (a_ready_tx, a_ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let (b_ready_tx, b_ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        // -- Thread A: the hook. --
        let a_stop = stop_flag.clone();
        let a_queue = a_to_c.clone();
        let a_tid_slot = hook_thread_id.clone();
        let a_sequence = sequence_counter.clone();
        let a_trylock_misses = hook_trylock_misses.clone();
        let a_fully_stopped = hook_fully_stopped.clone();
        let hook_join = std::thread::spawn(move || {
            HOOK_SINK.with(|s| *s.borrow_mut() = Some(a_queue));
            SEQUENCE.with(|s| *s.borrow_mut() = Some(a_sequence));
            HOOK_TRYLOCK_MISSES.with(|c| *c.borrow_mut() = Some(a_trylock_misses));
            let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
            if let Ok(mut slot) = a_tid_slot.lock() {
                *slot = Some(tid);
            }
            // Force this thread's message queue to exist *before* install
            // and *before* signaling ready, so a `PostThreadMessageW`
            // issued the moment `start` returns can never race a queue
            // that has not been created yet (which would silently fail,
            // and `GetMessageW` below would then block forever with no
            // quit message ever delivered — a deadlock in `stop`'s join).
            let mut probe = MSG::default();
            unsafe {
                let _ = PeekMessageW(&mut probe, None, 0, 0, PM_NOREMOVE);
            }
            let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) };
            let hook = match hook {
                Ok(h) => h,
                Err(_) => {
                    let e = last_error("SetWindowsHookExW");
                    let _ = a_ready_tx.send(Err(e.to_string()));
                    // Never going to run the loop, so never going to
                    // touch SEQUENCE again -- fully stopped immediately.
                    a_fully_stopped.store(true, Ordering::SeqCst);
                    return;
                }
            };
            HOOK_HANDLE.with(|h| h.set(hook));
            let _ = a_ready_tx.send(Ok(()));
            let mut msg = MSG::default();
            loop {
                if a_stop.load(Ordering::SeqCst) {
                    break;
                }
                let got = unsafe { GetMessageW(&mut msg, None, 0, 0) };
                if got.0 <= 0 {
                    break; // WM_QUIT or an error — either way, stop.
                }
                unsafe {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            unsafe {
                let _ = UnhookWindowsHookEx(hook);
            }
            // The one and only point after which SEQUENCE is guaranteed
            // never to be touched by this thread again -- the ordering
            // barrier the evidence thread's end-of-session reconciliation
            // waits on before it is safe to read SEQUENCE's final value.
            a_fully_stopped.store(true, Ordering::SeqCst);
        });

        // -- Thread C: the capture worker. --
        let c_stop = stop_flag.clone();
        let c_in = a_to_c.clone();
        let c_out = c_to_b.clone();
        let c_capture_failures = capture_failures.clone();
        let capture_join = std::thread::spawn(move || loop {
            if c_stop.load(Ordering::SeqCst) {
                break;
            }
            let next = c_in.lock().ok().and_then(|mut q| q.pop());
            let Some(raw) = next else {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            };
            match capture_window_at(raw) {
                Some(frame) => {
                    if let Ok(mut q) = c_out.lock() {
                        q.push(frame);
                    }
                }
                None => {
                    // The worker had an event (its sequenceId was
                    // dequeued) but produced no frame for it -- window
                    // gone, GetWindowRect/PrintWindow failed, etc.
                    // Counted explicitly, same reasoning as the hook
                    // callback's try_lock miss: a sequence-id gap would
                    // eventually reveal this too, but only if a later
                    // event follows it, never for a trailing loss.
                    c_capture_failures.fetch_add(1, Ordering::SeqCst);
                }
            }
        });

        // -- Thread B: the evidence thread. Owns IUIAutomation. --
        let b_stop = stop_flag.clone();
        let b_in = c_to_b.clone();
        let b_a_queue = a_to_c.clone(); // read-only, to poll its dropped_count
        let b_sequence = sequence_counter.clone();
        let b_fully_stopped = hook_fully_stopped.clone();
        let b_trylock_misses = hook_trylock_misses.clone();
        let b_capture_failures = capture_failures.clone();
        let self_pid = config.self_pid;
        let trusted = config.author_trusted_processes.clone();
        let persist_verbatim_metadata = config.persist_verbatim_metadata;
        let evidence_join = std::thread::spawn(move || {
            let com_ok = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if com_ok.is_err() {
                let _ = b_ready_tx.send(Err(format!("CoInitializeEx failed: {com_ok:?}")));
                return;
            }
            let automation: Option<IUIAutomation> =
                unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };
            // UIA itself failing to construct is not fatal -- `automation`
            // stays `None` and every enrichment call already degrades to
            // "no signal" gracefully. COM initializing is what matters for
            // startup success.
            let _ = b_ready_tx.send(Ok(()));

            let timing = ClickTimingConfig {
                double_click_time_ms: unsafe {
                    windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime() as u64
                },
                double_click_box_w: unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CXDOUBLECLK,
                    ) as i64
                },
                double_click_box_h: unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CYDOUBLECLK,
                    ) as i64
                },
                drag_threshold_w: unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CXDRAG,
                    ) as i64
                },
                drag_threshold_h: unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
                        windows::Win32::UI::WindowsAndMessaging::SM_CYDRAG,
                    ) as i64
                },
            };
            let mut classifier = ClickClassifier::new(timing);
            let mut last_seq: Option<u64> = None;
            let mut last_a_dropped: u64 = 0;
            let mut last_c_dropped: u64 = 0;
            let mut last_trylock_misses: u64 = 0;
            let mut last_capture_failures: u64 = 0;

            loop {
                if b_stop.load(Ordering::SeqCst) {
                    break;
                }

                // Loss accounting, all four modes: a queue's own
                // drop-oldest policy (BoundedDropOldest) counts what it
                // drops internally; a hook-callback try_lock miss and a
                // capture failure are counted by their own dedicated
                // counters (see their declarations in `start`), since
                // neither one ever touches a BoundedDropOldest at all.
                // None of these four were ever surfaced to the caller
                // before — each is polled here (diffed against the last
                // seen value) and reported as its own message, since a
                // loss that happens to be the pipeline's very last event
                // has nothing after it to reveal a hole via the ordinary
                // pairwise sequence-gap check below.
                if let Ok(q) = b_a_queue.lock() {
                    if q.dropped_count != last_a_dropped {
                        last_a_dropped = q.dropped_count;
                        sink(PipelineMessage::QueueOverflow {
                            stage: "hook-to-capture",
                            dropped_count: last_a_dropped,
                        });
                    }
                }
                let trylock_misses_now = b_trylock_misses.load(Ordering::SeqCst);
                if trylock_misses_now != last_trylock_misses {
                    last_trylock_misses = trylock_misses_now;
                    sink(PipelineMessage::QueueOverflow {
                        stage: "hook-trylock-miss",
                        dropped_count: last_trylock_misses,
                    });
                }
                let capture_failures_now = b_capture_failures.load(Ordering::SeqCst);
                if capture_failures_now != last_capture_failures {
                    last_capture_failures = capture_failures_now;
                    sink(PipelineMessage::QueueOverflow {
                        stage: "capture-failure",
                        dropped_count: last_capture_failures,
                    });
                }

                let next = b_in.lock().ok().and_then(|mut q| {
                    if q.dropped_count != last_c_dropped {
                        last_c_dropped = q.dropped_count;
                        sink(PipelineMessage::QueueOverflow {
                            stage: "capture-to-evidence",
                            dropped_count: last_c_dropped,
                        });
                    }
                    q.pop()
                });
                let Some(frame) = next else {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                };

                // Sequence-gap detection: honest, not silent. Regression:
                // `Ok(vec![])` is the normal, gap-free, contiguous case —
                // matching on `Ok(_)` alone and resetting unconditionally
                // reset the classifier's pending state before every single
                // event, including right before a down's own matching up,
                // which meant no down/up pair could ever resolve. The
                // classifier is reset only when a real gap was found, or
                // defensively on a sequence anomaly (`Err`) — never on the
                // ordinary contiguous path.
                if let Some(prev) = last_seq {
                    match crate::process_session::detect_sequence_gaps(&[
                        prev,
                        frame.raw.sequence_id,
                    ]) {
                        Ok(gaps) if !gaps.is_empty() => {
                            for (first, last) in gaps {
                                sink(PipelineMessage::Gap(GapMarker {
                                    first_missing: first,
                                    last_missing: last,
                                }));
                            }
                            classifier.reset();
                        }
                        Ok(_) => {}
                        Err(_) => {
                            // A non-increasing sequence id should not be
                            // possible given the single-producer
                            // architecture; if it ever happens, reset
                            // defensively rather than risk mis-pairing.
                            classifier.reset();
                        }
                    }
                }
                last_seq = Some(frame.raw.sequence_id);

                // Self-exclusion.
                if frame.raw.window_pid == self_pid {
                    continue;
                }

                let button_event = RawButtonEvent {
                    sequence_id: frame.raw.sequence_id,
                    hook_timestamp_ms: frame.raw.hook_timestamp_ms,
                    x: frame.raw.x,
                    y: frame.raw.y,
                    button: frame.raw.button,
                    is_down: frame.raw.is_down,
                };
                let Some(classified) = classifier.feed(button_event) else {
                    continue; // still pending its matching up
                };

                let (kind, point) = EventKind::from_classified(&classified);

                // Identity is resolved exactly once, at hook time
                // (frame.raw.hwnd_value / frame.raw.window_pid), and
                // threaded through every stage from here on -- never
                // re-resolved via a fresh WindowFromPoint in this thread.
                // A second independent resolution here, made however long
                // after the hook fired this thread took to get scheduled,
                // is exactly the TOCTOU gap a design review caught: the
                // window at a given point can change in between, which
                // would let one process's already-captured frame get
                // authorized using a *different* process's identity.
                //
                // `IsWindow` alone is not enough to rule this out: Windows
                // reuses destroyed HWND values, so a handle that is
                // "still a window" now may be a *different* window than
                // the one the hook saw -- `IsWindow` cannot tell those
                // apart. The hook already recorded that window's PID
                // (`frame.raw.window_pid`); re-deriving the leaf's PID now
                // and requiring it to still match is what actually
                // detects handle reuse (a recycled handle now belongs to
                // a different process in the overwhelming common case).
                let leaf_hwnd = hwnd_from_value(frame.raw.hwnd_value);
                let leaf_pid_now = if leaf_hwnd.0.is_null() {
                    0
                } else {
                    let mut pid = 0u32;
                    unsafe { GetWindowThreadProcessId(leaf_hwnd, Some(&mut pid)) };
                    pid
                };
                let leaf_identity_confirmed = !leaf_hwnd.0.is_null()
                    && unsafe { IsWindow(Some(leaf_hwnd)) }.as_bool()
                    && leaf_pid_now != 0
                    && leaf_pid_now == frame.raw.window_pid;
                if !leaf_identity_confirmed {
                    sink(PipelineMessage::Event(ProcessCaptureEvent {
                        sequence_id: frame.raw.sequence_id,
                        hook_timestamp_ms: frame.raw.hook_timestamp_ms,
                        capture_timestamp_ms: now_ms(),
                        kind,
                        point,
                        target: None,
                        screenshot: None,
                        privacy: PrivacyOutcome {
                            trust: TrustLabel::Default,
                            decision: SensitivityDecisionLabel::Withhold,
                        },
                    }));
                    continue;
                }

                let evidence_point = POINT {
                    x: frame.raw.x as i32,
                    y: frame.raw.y as i32,
                };
                let mut evidence = TargetEvidence::default();
                let mut uia_is_password = None;
                if let Some(ref automation) = automation {
                    let (ev, pw) = uia_enrich(automation, evidence_point);
                    evidence = ev;
                    uia_is_password = pw;
                }
                // The leaf control is what owner-draw/password-char
                // checks need (gather_signals, below). The trust decision
                // is anchored to that control's TOP-LEVEL window's owning
                // process instead -- the same window the capture worker
                // scoped the screenshot to (capture_window_at used this
                // exact frame.raw.hwnd_value too) -- so capture scope and
                // trust scope are always the same window, resolved once.
                let root_hwnd = root_window(leaf_hwnd);
                let (root_pid, proc_name) = process_name_for_hwnd(root_hwnd);
                // Leaf/root ownership consistency, required explicitly:
                // the leaf's identity was just confirmed against the
                // hook-time PID above, but `root_window` walking to an
                // ancestor owned by a *different* process (an unusual
                // cross-process parenting case, or a sign something about
                // the walk is wrong) must not be trusted silently just
                // because `GetAncestor` returned something. Trust is only
                // ever decided from `proc_name` below, so a leaf/root PID
                // mismatch here makes `proc_name` effectively unusable --
                // cleared so it can never match `trusted` and, same as an
                // unconfirmed leaf identity, the result is `Default`.
                let proc_name = if root_pid == leaf_pid_now {
                    proc_name
                } else {
                    None
                };
                evidence.process_name = proc_name.clone();

                let trust = match &proc_name {
                    Some(name) if trusted.contains(name) => ProcessTrust::AuthorTrusted,
                    _ => ProcessTrust::Default,
                };
                let trust_label = match trust {
                    ProcessTrust::AuthorTrusted => TrustLabel::AuthorTrusted,
                    ProcessTrust::Default => TrustLabel::Default,
                };

                // Detection runs against the FULL, unredacted evidence --
                // before any metadata stripping. Regression, caught by
                // review: the metadata opt-out used to clear
                // evidence.name/automation_id before this call, which
                // silently disabled name_matches_sensitive_heuristic
                // (gather_signals reads those same fields) precisely in
                // the default, opt-out configuration -- the one most
                // sessions would actually run with. Privacy detection
                // must never depend on which metadata-persistence
                // preference the author chose; stripping happens only
                // afterward, right before the event is built (below),
                // never before.
                let decision = if matches!(trust, ProcessTrust::AuthorTrusted) {
                    let signals = gather_signals(&evidence, uia_is_password, leaf_hwnd);
                    decide_sensitivity(trust, &signals)
                } else {
                    crate::process_session::SensitivityDecision::Withhold
                };

                if !persist_verbatim_metadata {
                    // Opt-in only -- see ProcessCaptureConfig's own doc
                    // comment. control_type_id and process_name are
                    // structural (not free text), kept either way. This
                    // strip happens strictly after detection above has
                    // already run and decided -- see that comment.
                    evidence.name = None;
                    evidence.automation_id = None;
                }

                let mut width = frame.width;
                let mut height = frame.height;
                let mut rgba = frame.rgba;
                let screenshot = match decision {
                    crate::process_session::SensitivityDecision::ProceedNormally => {
                        Some((width, height, rgba))
                    }
                    crate::process_session::SensitivityDecision::RedactRegion => {
                        if let Some(rect) = evidence.bounding_rect_physical {
                            let local = RectI {
                                x: rect.x - frame.capture_origin.0,
                                y: rect.y - frame.capture_origin.1,
                                w: rect.w,
                                h: rect.h,
                            };
                            paint_redaction_rect(&mut rgba, width, height, local);
                            Some((width, height, rgba))
                        } else {
                            None
                        }
                    }
                    crate::process_session::SensitivityDecision::Withhold => None,
                };
                let _ = (&mut width, &mut height);

                let decision_label = match decision {
                    crate::process_session::SensitivityDecision::ProceedNormally => {
                        SensitivityDecisionLabel::ProceedNormally
                    }
                    crate::process_session::SensitivityDecision::RedactRegion => {
                        SensitivityDecisionLabel::RedactRegion
                    }
                    crate::process_session::SensitivityDecision::Withhold => {
                        SensitivityDecisionLabel::Withhold
                    }
                };

                sink(PipelineMessage::Event(ProcessCaptureEvent {
                    sequence_id: frame.raw.sequence_id,
                    hook_timestamp_ms: frame.raw.hook_timestamp_ms,
                    capture_timestamp_ms: now_ms(),
                    kind,
                    point,
                    target: Some(evidence),
                    screenshot,
                    privacy: PrivacyOutcome {
                        trust: trust_label,
                        decision: decision_label,
                    },
                }));
            }

            // End-of-session reconciliation: the ordinary pairwise
            // sequence-gap check (above, inside the loop) can only ever
            // detect a gap between two events this thread actually saw —
            // a drop that happens to be the *last* thing the hook ever
            // assigned a sequenceId to has nothing after it to reveal the
            // hole, AND (review finding) if every single assigned id was
            // lost, last_seq is still None and the old unconditional `if
            // let Some(last)` skipped reconciliation entirely, reporting
            // nothing at all for a session where everything was dropped.
            //
            // Reading the shared counter here is only honest once the
            // hook thread is *provably* done incrementing it — this
            // thread observing `b_stop` is not that proof: all three
            // threads watch the same flag and can observe it at roughly
            // the same time, so without an explicit barrier the hook
            // thread could still be mid-callback (about to increment
            // SEQUENCE one more time) when this thread already read a
            // "final" value that turns out to be stale. `hook_fully_stopped`
            // is set by the hook thread as the literal last thing it does
            // before returning (after `UnhookWindowsHookEx`) specifically
            // to make this a real happens-before relationship, not a race.
            // Bounded, not an unconditional block: the hook thread stopping
            // is expected to be fast once `stop_flag` is set, but this
            // thread must still be able to exit (and let `stop`'s join
            // complete) even in an unexpected case where it does not.
            let reconciliation_wait_deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(2);
            while !b_fully_stopped.load(Ordering::SeqCst)
                && std::time::Instant::now() < reconciliation_wait_deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            // Regression, caught by review: the wait above used to be
            // treated as good enough regardless of whether it actually
            // confirmed `hook_fully_stopped` -- on a timeout, the counter
            // was still read and reported as a definitive final gap,
            // which could be wrong (the hook might still be about to
            // increment it) and silently present an unconfirmed snapshot
            // as fact. Only a *confirmed* stop makes reading the counter
            // honest; a timeout reports explicit uncertainty instead of a
            // possibly-false-precise range.
            if b_fully_stopped.load(Ordering::SeqCst) {
                let final_seq = b_sequence.load(Ordering::SeqCst);
                let baseline = last_seq.unwrap_or(0);
                if let Ok(gaps) =
                    crate::process_session::detect_sequence_gaps(&[baseline, final_seq])
                {
                    for (first, last) in gaps {
                        sink(PipelineMessage::Gap(GapMarker {
                            first_missing: first,
                            last_missing: last,
                        }));
                    }
                }
            } else {
                sink(PipelineMessage::SessionReconciliationUncertain {
                    last_processed_seq: last_seq,
                });
            }

            unsafe {
                CoUninitialize();
            }
        });

        // Wait for both the hook thread and the evidence thread to report
        // their own startup result before handing back a handle. A
        // `SetWindowsHookExW` failure or a `CoInitializeEx` failure used
        // to be silently swallowed inside the spawned thread while this
        // function still returned `Ok(handle)` — a caller had no way to
        // tell "the pipeline is genuinely running" from "one of its
        // threads already gave up." On any failure (including a timeout
        // or a sender dropped without sending, e.g. a panic), the
        // partially-started pipeline is torn down the same way `stop`
        // does before returning `Err`, rather than leaking threads.
        let a_result = a_ready_rx.recv_timeout(STARTUP_TIMEOUT);
        let b_result = b_ready_rx.recv_timeout(STARTUP_TIMEOUT);
        if let Some(reason) = super::resolve_startup_result(a_result, b_result) {
            stop_flag.store(true, Ordering::SeqCst);
            if let Ok(guard) = hook_thread_id.lock() {
                if let Some(tid) = *guard {
                    unsafe {
                        let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                    }
                }
            }
            let _ = hook_join.join();
            let _ = capture_join.join();
            let _ = evidence_join.join();
            return Err(CaptureError::NativeApi(reason));
        }

        Ok(ProcessCaptureHandle {
            stop_flag,
            hook_thread_id,
            joins: vec![hook_join, capture_join, evidence_join],
        })
    }

    /// Captures *only* the clicked top-level window's own content —
    /// genuinely isolated, not merely a correctly-sized rectangle.
    ///
    /// Regression history: the first fix for this function narrowed the
    /// captured rectangle from a whole monitor down to the clicked
    /// window's own bounds, but still pulled those pixels via
    /// `native::capture_rect`, which `BitBlt`s from the **screen** DC —
    /// a rectangle-shaped crop of whatever is visually on top at that
    /// screen location, not that window's own rendered content. A
    /// notification, tooltip, context menu, or another process's window
    /// edge overlapping that rectangle at the moment of capture would
    /// still be retained even though the clicked window was the only one
    /// actually trusted. Review finding: "do not infer isolation from the
    /// crop rectangle." Fixed by using `PrintWindow` with
    /// `PW_RENDERFULLCONTENT` instead of screen `BitBlt` — it asks the
    /// window itself to render its own content into the provided DC,
    /// which is the standard Win32 mechanism for genuine window-content
    /// isolation (this is deliberately a different, narrower-purpose
    /// capture path from `native::capture_rect`'s screen-DC approach,
    /// which remains correct and unchanged for this app's ordinary,
    /// non-privacy-critical window-capture feature — that function's own
    /// doc comment already discloses the screen-DC limitation as accepted
    /// for that general-purpose use case; it is not accepted here).
    ///
    /// `PrintWindow` can still fail or render incompletely for some
    /// hardware-accelerated or minimized windows — a disclosed, real
    /// limitation, not hidden. On any such failure this returns `None`
    /// rather than ever falling back to the screen-`BitBlt` path, which
    /// would silently reintroduce the exact isolation gap being fixed for
    /// precisely the windows where the isolated path doesn't work.
    /// `PrintWindow` reporting success is an OS-API success signal only —
    /// it is not a content-correctness guarantee (the target could render
    /// stale, partial, or blank content and still return success); the
    /// one further check genuinely available without a known-good
    /// reference to compare against is rejecting an entirely blank
    /// buffer (see `print_window_rgba`'s own doc comment), which this
    /// design does not claim is a complete answer to that limitation,
    /// only a cheap, real floor.
    ///
    /// Identity is verified (`identity_matches`, against `raw.window_pid`
    /// recorded at hook time) *before* any capture work is attempted here
    /// — not only later, before persisting (the evidence thread still
    /// re-checks independently, since more time passes before that
    /// decision). Review finding: capturing first and validating only
    /// before persist left a window where pixels could be pulled from an
    /// already-stale/reused handle even though they would ultimately be
    /// discarded — gating capture itself closes that window to near zero
    /// rather than relying solely on a later discard. What this still
    /// cannot rule out: the *same process* destroying a window and
    /// recreating a new one that happens to reuse the identical HWND
    /// value in between — PID equality cannot distinguish two different
    /// window instances owned by the same process. This residual
    /// limitation is disclosed, not hidden; there is no practical Win32
    /// API that exposes a window "instance identity" distinct from its
    /// (reusable) handle value and its (unchanged, same-process) owning
    /// PID.
    ///
    /// Takes the hook-time-resolved `HWND` directly (`raw.hwnd_value`)
    /// rather than re-resolving one from `(x, y)` via a fresh
    /// `WindowFromPoint` call here — a second independent resolution,
    /// made however long after the hook fired this thread took to get
    /// scheduled, is exactly the TOCTOU gap a design review caught: the
    /// window at that exact pixel can change between the hook observing
    /// the click and this function running.
    fn capture_window_at(raw: RawHookEvent) -> Option<CapturedFrame> {
        let leaf = hwnd_from_value(raw.hwnd_value);
        if !identity_matches(leaf, raw.window_pid) {
            return None;
        }
        let root = root_window(leaf);
        let mut win_rect = windows::Win32::Foundation::RECT::default();
        if unsafe { GetWindowRect(root, &mut win_rect) }.is_err() {
            return None;
        }
        let width = win_rect.right - win_rect.left;
        let height = win_rect.bottom - win_rect.top;
        // Rejects a malformed/extreme rect (checked arithmetic, a sane
        // per-axis cap, and an explicit byte budget) *before* any
        // allocation or GDI call — see `validate_frame_dimensions`'s own
        // doc comment.
        super::validate_frame_dimensions(width, height)?;

        let rgba = print_window_rgba_bounded(root, width, height)?;

        Some(CapturedFrame {
            raw,
            width: width as u32,
            height: height as u32,
            rgba,
            capture_origin: (win_rect.left as i64, win_rect.top as i64),
        })
    }

    /// How long a single `PrintWindow` attempt is allowed to run before
    /// it is treated as a capture failure and abandoned.
    const PRINT_WINDOW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

    /// Runs the actual `PrintWindow`-based capture on a dedicated,
    /// short-lived helper thread and waits for it with a hard timeout —
    /// never on the capture worker thread itself.
    ///
    /// Review finding: `PrintWindow` asks another process to render; an
    /// unresponsive, hung, or hostile target can block that call
    /// indefinitely. Calling it directly on the capture worker thread (as
    /// the previous round did) meant a single stuck target could block
    /// that thread forever — and since `ProcessCaptureHandle::stop` joins
    /// the capture thread with no timeout of its own, a hung capture
    /// could make `stop` itself hang forever too.
    ///
    /// Rust has no safe way to forcibly cancel a blocked native call, so
    /// this bounds the *wait*, not the call itself: a dedicated thread is
    /// spawned per attempt, the result is sent back over a channel, and
    /// this function returns as soon as either the result arrives or
    /// `PRINT_WINDOW_TIMEOUT` elapses — whichever is first. On a timeout,
    /// the capture worker thread is freed immediately and treats this as
    /// an ordinary capture failure (counted the same as any other). The
    /// spawned helper thread itself is *not* killed — if the target truly
    /// never responds, that one thread remains blocked for the life of
    /// the process, a disclosed, accepted trade-off rather than a hidden
    /// one: it never blocks the three main pipeline threads, never blocks
    /// `stop`'s join, and only accumulates per genuinely-hung target
    /// (expected to be rare), not per ordinary capture.
    fn print_window_rgba_bounded(root: HWND, width: i32, height: i32) -> Option<Vec<u8>> {
        let root_value = root.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel::<Option<Vec<u8>>>();
        std::thread::spawn(move || {
            let hwnd = hwnd_from_value(root_value);
            let result = unsafe { print_window_rgba(hwnd, width, height) };
            // Ignored if the receiver already gave up on timeout -- that
            // is exactly the case this function exists to make harmless.
            let _ = tx.send(result);
        });
        // `unwrap_or_default` here means exactly "timeout or a sent
        // `None` both collapse to `None`" -- not a silent swallow of a
        // real result.
        rx.recv_timeout(PRINT_WINDOW_TIMEOUT).unwrap_or_default()
    }

    /// The actual `PrintWindow`-based capture: renders `hwnd`'s own
    /// content (via `PW_RENDERFULLCONTENT`, needed for correct output
    /// from modern DWM-composited windows) into a compatible bitmap, then
    /// reads it back as top-down RGBA — the same `GetDIBits` plumbing
    /// `native::capture_screen_rect` uses, just fed by `PrintWindow`
    /// instead of `BitBlt`-from-the-screen-DC. `None` on any failure at
    /// any step, including an entirely blank result (see this function's
    /// caller's doc comment for what that is, and is not, evidence of);
    /// never partially successful. Always called from the dedicated
    /// helper thread `print_window_rgba_bounded` spawns — never directly
    /// from the capture worker thread, which must never block on this.
    unsafe fn print_window_rgba(hwnd: HWND, width: i32, height: i32) -> Option<Vec<u8>> {
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
            ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        };
        use windows::Win32::Storage::Xps::PrintWindow;
        use windows::Win32::UI::WindowsAndMessaging::PW_RENDERFULLCONTENT;

        // A reference DC only, to make the compatible bitmap's pixel
        // format match the display — never read from (no BitBlt).
        let reference_dc = GetDC(None);
        if reference_dc.is_invalid() {
            return None;
        }
        let mem_dc = CreateCompatibleDC(Some(reference_dc));
        if mem_dc.is_invalid() {
            ReleaseDC(None, reference_dc);
            return None;
        }
        let bitmap = CreateCompatibleBitmap(reference_dc, width, height);
        if bitmap.is_invalid() {
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, reference_dc);
            return None;
        }
        let old = SelectObject(mem_dc, HGDIOBJ(bitmap.0));

        let printed = PrintWindow(
            hwnd,
            mem_dc,
            windows::Win32::Storage::Xps::PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT),
        )
        .as_bool();

        SelectObject(mem_dc, old);

        // Byte length already validated by the caller
        // (`validate_frame_dimensions`, via `capture_window_at`) — not
        // recomputed from an unchecked width*height*4 here.
        let mut rgba = vec![0u8; width as usize * height as usize * 4];
        let lines = if printed {
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = width;
            bmi.bmiHeader.biHeight = -height; // top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            GetDIBits(
                mem_dc,
                bitmap,
                0,
                height as u32,
                Some(rgba.as_mut_ptr() as *mut _),
                &mut bmi as *mut _,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, reference_dc);

        if !printed || lines == 0 {
            return None;
        }
        // PrintWindow succeeding is an API-level signal only (see this
        // function's own doc comment) -- an entirely blank buffer most
        // likely means the render silently produced nothing useful
        // despite reporting success, so it is treated as a failure
        // rather than persisted as a suspiciously-empty "successful"
        // capture. This is a cheap, real floor, not a claim that any
        // non-blank result is proven correct.
        if rgba.iter().all(|&b| b == 0) {
            return None;
        }
        crate::native::bgra_to_rgba_force_opaque(&mut rgba);
        Some(rgba)
    }
}
