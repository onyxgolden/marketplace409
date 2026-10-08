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
}

/// A captured frame, handed from the capture worker to the evidence
/// thread, carrying the window/process info gathered alongside it.
pub(crate) struct CapturedFrame {
    pub raw: RawHookEvent,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub monitor_origin: (i64, i64),
}

/// Non-blocking, bounded-by-count-and-bytes handoff. `send` never blocks:
/// on overflow it drops the oldest queued item and reports that drop
/// rather than ever stalling its caller — this is what keeps the hook
/// thread's loop free regardless of how far behind a downstream stage
/// falls. Pure, host-independent queueing logic; the threads that use it
/// are Windows-only, but this type itself is not.
pub(crate) struct BoundedDropOldest<T> {
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
        CallNextHookEx, DispatchMessageW, GetClassNameW, GetMessageW, GetWindowLongPtrW,
        GetWindowThreadProcessId, PostThreadMessageW, SendMessageTimeoutW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, WindowFromPoint, GWL_STYLE, HHOOK, MSG,
        MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
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

    /// Owning process name (lowercase, no path) for the window at `point`,
    /// and that window's PID. Best-effort: an inaccessible process yields
    /// `None` for the name but still the PID, which is enough for the
    /// self-exclusion check.
    fn window_and_process_at(point: POINT) -> (u32, Option<String>, HWND) {
        let hwnd = unsafe { WindowFromPoint(point) };
        if hwnd.0.is_null() {
            return (0, None, hwnd);
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let name = process_image_name(pid);
        (pid, name, hwnd)
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

    // Set only by the hook thread itself, read only by its own HOOKPROC
    // (both always on the same OS thread — a low-level hook's callback
    // runs on the thread that installed it) — thread-local, never shared.
    thread_local! {
        static HOOK_HANDLE: std::cell::Cell<HHOOK> = const { std::cell::Cell::new(HHOOK(std::ptr::null_mut())) };
        static SEQUENCE: AtomicU64 = const { AtomicU64::new(1) };
    }

    // The channel the HOOKPROC pushes into. Thread-local to the hook
    // thread's own setup, populated once before the message loop starts.
    thread_local! {
        static HOOK_SINK: std::cell::RefCell<Option<Arc<Mutex<BoundedDropOldest<RawHookEvent>>>>> =
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
                // local, non-blocking Win32 calls (no COM, no GDI).
                let (window_pid, _name, _hwnd) = window_and_process_at(point);
                let seq = SEQUENCE.with(|s| s.fetch_add(1, Ordering::SeqCst));
                let event = RawHookEvent {
                    sequence_id: seq,
                    hook_timestamp_ms: now_ms(),
                    x: info.pt.x as i64,
                    y: info.pt.y as i64,
                    button,
                    is_down,
                    window_pid,
                };
                HOOK_SINK.with(|sink| {
                    if let Some(queue) = sink.borrow().as_ref() {
                        if let Ok(mut q) = queue.try_lock() {
                            q.push(event);
                        }
                        // A held lock here means the capture worker is
                        // mid-drain; this one event is lost rather than
                        // the hook callback ever blocking on a lock.
                    }
                });
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Starts the three-thread pipeline. See this module's doc comment
    /// for the architecture; **nothing calls this function anywhere in
    /// this codebase as of this sub-slice.**
    pub fn start(
        config: ProcessCaptureConfig,
        sink: Box<dyn Fn(PipelineMessage) + Send + 'static>,
    ) -> Result<ProcessCaptureHandle, CaptureError> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let hook_thread_id: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));

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

        // -- Thread A: the hook. --
        let a_stop = stop_flag.clone();
        let a_queue = a_to_c.clone();
        let a_tid_slot = hook_thread_id.clone();
        let hook_join = std::thread::spawn(move || {
            HOOK_SINK.with(|s| *s.borrow_mut() = Some(a_queue));
            let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
            if let Ok(mut slot) = a_tid_slot.lock() {
                *slot = Some(tid);
            }
            let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) };
            let hook = match hook {
                Ok(h) => h,
                Err(_) => {
                    let _ = last_error("SetWindowsHookExW");
                    return;
                }
            };
            HOOK_HANDLE.with(|h| h.set(hook));
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
        });

        // -- Thread C: the capture worker. --
        let c_stop = stop_flag.clone();
        let c_in = a_to_c.clone();
        let c_out = c_to_b.clone();
        let capture_join = std::thread::spawn(move || loop {
            if c_stop.load(Ordering::SeqCst) {
                break;
            }
            let next = c_in.lock().ok().and_then(|mut q| q.pop());
            let Some(raw) = next else {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            };
            if let Some(frame) = capture_monitor_at(raw.x, raw.y, raw) {
                if let Ok(mut q) = c_out.lock() {
                    q.push(frame);
                }
            }
        });

        // -- Thread B: the evidence thread. Owns IUIAutomation. --
        let b_stop = stop_flag.clone();
        let b_in = c_to_b.clone();
        let self_pid = config.self_pid;
        let trusted = config.author_trusted_processes.clone();
        let evidence_join = std::thread::spawn(move || {
            let com_ok = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if com_ok.is_err() {
                return;
            }
            let automation: Option<IUIAutomation> =
                unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };

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

            loop {
                if b_stop.load(Ordering::SeqCst) {
                    break;
                }
                let next = b_in.lock().ok().and_then(|mut q| q.pop());
                let Some(frame) = next else {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                };

                // Sequence-gap detection: honest, not silent.
                if let Some(prev) = last_seq {
                    if let Ok(gaps) =
                        crate::process_session::detect_sequence_gaps(&[prev, frame.raw.sequence_id])
                    {
                        for (first, last) in gaps {
                            sink(PipelineMessage::Gap(GapMarker {
                                first_missing: first,
                                last_missing: last,
                            }));
                        }
                        classifier.reset();
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
                let point_screen = POINT {
                    x: point.0 as i32,
                    y: point.1 as i32,
                };

                let mut evidence = TargetEvidence::default();
                let mut uia_is_password = None;
                if let Some(ref automation) = automation {
                    let (ev, pw) = uia_enrich(automation, point_screen);
                    evidence = ev;
                    uia_is_password = pw;
                }
                let (_pid2, proc_name, hwnd_for_native) = window_and_process_at(point_screen);
                evidence.process_name = proc_name.clone();

                let trust = match &proc_name {
                    Some(name) if trusted.contains(name) => ProcessTrust::AuthorTrusted,
                    _ => ProcessTrust::Default,
                };
                let trust_label = match trust {
                    ProcessTrust::AuthorTrusted => TrustLabel::AuthorTrusted,
                    ProcessTrust::Default => TrustLabel::Default,
                };

                let decision = if matches!(trust, ProcessTrust::AuthorTrusted) {
                    let signals = gather_signals(&evidence, uia_is_password, hwnd_for_native);
                    decide_sensitivity(trust, &signals)
                } else {
                    crate::process_session::SensitivityDecision::Withhold
                };

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
                                x: rect.x - frame.monitor_origin.0,
                                y: rect.y - frame.monitor_origin.1,
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
            unsafe {
                CoUninitialize();
            }
        });

        Ok(ProcessCaptureHandle {
            stop_flag,
            hook_thread_id,
            joins: vec![hook_join, capture_join, evidence_join],
        })
    }

    /// Captures the whole monitor containing `(x, y)` via the existing
    /// public `native::capture_rect`/`native::list_monitors` — no new GDI
    /// code, reusing the same primitive every other capture path in this
    /// app already uses.
    fn capture_monitor_at(x: i64, y: i64, raw: RawHookEvent) -> Option<CapturedFrame> {
        let monitors = crate::native::list_monitors().ok()?;
        let monitor = monitors.iter().find(|m| {
            let left = m.origin_virtual.0 as i64;
            let top = m.origin_virtual.1 as i64;
            let right = left + (m.size_logical.0 as f64 * m.scale).round() as i64;
            let bottom = top + (m.size_logical.1 as f64 * m.scale).round() as i64;
            x >= left && x < right && y >= top && y < bottom
        })?;
        let left = monitor.origin_virtual.0 as i64;
        let top = monitor.origin_virtual.1 as i64;
        let w = (monitor.size_logical.0 as f64 * monitor.scale).round() as u64;
        let h = (monitor.size_logical.1 as f64 * monitor.scale).round() as u64;
        let rect = RectI {
            x: left,
            y: top,
            w,
            h,
        };
        let frame = crate::native::capture_rect(rect, monitor, false).ok()?;
        Some(CapturedFrame {
            raw,
            width: w as u32,
            height: h as u32,
            rgba: frame.rgba,
            monitor_origin: (left, top),
        })
    }
}
