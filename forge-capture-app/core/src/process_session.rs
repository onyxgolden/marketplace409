//! Process Training (PT-1) session and event contract.
//!
//! Pure logic only, same division as every other module here: the session
//! manifest/event schema, click-pair/drag classification, sequence-gap
//! detection, and the privacy/sensitivity decision are all host-independent
//! and unit-tested on any platform. The actual Windows low-level mouse hook,
//! UI Automation calls, and GDI screenshot capture that *produce* the raw
//! input this module classifies and decides over live in `native.rs`
//! (`#[cfg(windows)]`) and are wired into a three-thread pipeline by the
//! Tauri shell (`app/src/main.rs`) — hook thread (enqueue raw events only,
//! assigns `sequenceId`, never blocks) → capture worker (GDI `BitBlt`) →
//! evidence thread (UI Automation, the decision below, the durable write).
//! That architecture, and the five-round review that produced it, are
//! recorded in `forge-ai-drop`'s `forge-capture-pt1-design-review.md`
//! through `-rereview5.md` (final verdict: GO, commit `ef775709`).
//!
//! # The privacy model this module encodes (the part five rounds of review
//! were spent getting right)
//!
//! There is no automatic "verified safe" status for any third-party
//! window. [`CoverageState::Default`] withholds a screenshot outright.
//! [`CoverageState::AuthorTrusted`] is an explicit, disclosed, session-
//! scoped grant the caller makes per process (never a persisted or global
//! setting) — detection still runs and still redacts/withholds on a
//! positive hit even inside a trusted app; trusting the app means
//! accepting detection may be incomplete, not disabling detection.
//! [`decide_sensitivity`] never treats the *absence* of a detection signal
//! as proof of safety — only an explicit positive "not sensitive" result
//! from a signal that actually ran counts for anything, and even then only
//! inside an already-trusted process.

use serde::{Deserialize, Serialize};

pub const PROCESS_SESSION_SCHEMA_VERSION: u32 = 1;
pub const PROCESS_SESSION_KIND: &str = "process-session";

// ---------------------------------------------------------------------
// Session manifest
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    Recording,
    Paused,
    Stopped,
    /// Set only by crash-recovery scanning on the next launch, never by the
    /// recorder itself — see [`is_crash_recoverable`].
    CrashRecoverable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManifest {
    pub schema_version: u32,
    pub kind: String,
    pub session_id: String,
    pub status: SessionStatus,
    /// ISO-8601 UTC.
    pub started_at: String,
    pub ended_at: Option<String>,
    pub event_count: u64,
    /// Raw hook events dropped by queue-overload backpressure — see
    /// [`detect_sequence_gaps`]. Zero in the overwhelming common case;
    /// surfaced to the author rather than hidden.
    pub dropped_event_count: u64,
}

impl SessionManifest {
    pub fn new(session_id: String, started_at: String) -> Self {
        SessionManifest {
            schema_version: PROCESS_SESSION_SCHEMA_VERSION,
            kind: PROCESS_SESSION_KIND.to_string(),
            session_id,
            status: SessionStatus::Recording,
            started_at,
            ended_at: None,
            event_count: 0,
            dropped_event_count: 0,
        }
    }

    pub fn to_json(&self) -> Result<String, ProcessSessionError> {
        serde_json::to_string(self).map_err(|e| ProcessSessionError::Json(e.to_string()))
    }
}

/// A session left in `Recording`/`Paused` with no `endedAt` is the crash
/// signature: the recorder never reached a clean `Stop`. Pure predicate —
/// the Tauri shell applies it to whatever `session.json` it finds on
/// launch and decides whether to offer recovery; this module never reads a
/// directory itself.
pub fn is_crash_recoverable(status: SessionStatus, ended_at: &Option<String>) -> bool {
    matches!(status, SessionStatus::Recording | SessionStatus::Paused) && ended_at.is_none()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessSessionError {
    KindMismatch { found: String },
    UnsupportedSchemaVersion { found: u32 },
    MissingSchemaVersion,
    Json(String),
}

impl std::fmt::Display for ProcessSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessSessionError::KindMismatch { found } => write!(
                f,
                "process-session kind mismatch: expected {PROCESS_SESSION_KIND}, found {found}"
            ),
            ProcessSessionError::UnsupportedSchemaVersion { found } => write!(
                f,
                "unsupported process-session schema version {found} (this build reads {PROCESS_SESSION_SCHEMA_VERSION})"
            ),
            ProcessSessionError::MissingSchemaVersion => {
                write!(f, "process-session manifest is missing schemaVersion")
            }
            ProcessSessionError::Json(e) => write!(f, "process-session JSON error: {e}"),
        }
    }
}

impl std::error::Error for ProcessSessionError {}

/// Strict parse: schema version checked against the raw JSON value before
/// deserializing the rest, same reasoning as every other sidecar in this
/// program — a newer, structurally different schema is reported as
/// unsupported, never silently misparsed.
pub fn parse_manifest(input: &str) -> Result<SessionManifest, ProcessSessionError> {
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|e| ProcessSessionError::Json(e.to_string()))?;
    let version = value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or(ProcessSessionError::MissingSchemaVersion)?;
    if version != PROCESS_SESSION_SCHEMA_VERSION as u64 {
        return Err(ProcessSessionError::UnsupportedSchemaVersion {
            found: version as u32,
        });
    }
    let manifest: SessionManifest =
        serde_json::from_value(value).map_err(|e| ProcessSessionError::Json(e.to_string()))?;
    if manifest.kind != PROCESS_SESSION_KIND {
        return Err(ProcessSessionError::KindMismatch {
            found: manifest.kind.clone(),
        });
    }
    Ok(manifest)
}

// ---------------------------------------------------------------------
// Raw input, as the hook thread hands it onward (no COM/UIA/GDI involved)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

/// One raw button transition as the hook thread observed it. `sequenceId`
/// is assigned once, at the hook thread, and is authoritative for ordering
/// everywhere downstream — see [`detect_sequence_gaps`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawButtonEvent {
    pub sequence_id: u64,
    pub hook_timestamp_ms: u64,
    pub x: i64,
    pub y: i64,
    pub button: MouseButton,
    pub is_down: bool,
}

// ---------------------------------------------------------------------
// Click-pair / drag / double-click classification
// ---------------------------------------------------------------------

/// The OS's own double-click timing/distance settings
/// (`GetDoubleClickTime`, `SM_CXDOUBLECLK`/`SM_CYDOUBLECLK`) and drag
/// threshold (`SM_CXDRAG`/`SM_CYDRAG`), read once at startup by the shell
/// and handed in here — this module never reads them itself, so it is
/// testable with deterministic, arbitrary values rather than the real,
/// user-configurable OS settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClickTimingConfig {
    pub double_click_time_ms: u64,
    pub double_click_box_w: i64,
    pub double_click_box_h: i64,
    pub drag_threshold_w: i64,
    pub drag_threshold_h: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassifiedClick {
    Click { x: i64, y: i64 },
    DoubleClick { x: i64, y: i64 },
    Drag { from: (i64, i64), to: (i64, i64) },
}

/// `WH_MOUSE_LL` never delivers `WM_LBUTTONDBLCLK` (that message is
/// synthesized downstream, in `USER32`'s window-message dispatch for a
/// window with the `CS_DBLCLKS` class style — strictly after where a
/// low-level hook observes input). This classifier synthesizes the
/// double-click/drag distinction itself from consecutive down/up pairs,
/// rather than assuming the OS hands it over.
#[derive(Debug, Clone)]
pub struct ClickClassifier {
    config: ClickTimingConfig,
    /// A down seen but not yet paired with its up, plus whether *this* down
    /// is a double-click candidate (matched timing/distance against the
    /// last genuine click). The decision is only made good once the
    /// matching up arrives — see `feed`'s doc comment for why.
    pending: Option<(RawButtonEvent, bool)>,
    /// The down half of the most recently resolved **click** (single or
    /// double) — the baseline the next down is compared against for
    /// double-click timing/distance. A resolved **drag** never updates
    /// this and explicitly clears it instead: a drag is not a click, so it
    /// must not seed — or leave stale — double-click eligibility for
    /// whatever comes next.
    last_resolved_down: Option<RawButtonEvent>,
}

impl ClickClassifier {
    pub fn new(config: ClickTimingConfig) -> Self {
        ClickClassifier {
            config,
            pending: None,
            last_resolved_down: None,
        }
    }

    /// Resets all state. Called after a detected sequence gap (a dropped
    /// event could be exactly the down or up half of a pair, or the first
    /// half of a double-click, that we would otherwise mis-match) and on
    /// Pause, so a paused session never carries stale state into its next
    /// Resume.
    pub fn reset(&mut self) {
        self.pending = None;
        self.last_resolved_down = None;
    }

    /// Feed one raw button transition. Returns a classification only once
    /// a complete down→up pair resolves — **never on the down alone**,
    /// even when that down's timing/distance against the last click
    /// qualifies it as a double-click candidate. The actual gesture that
    /// follows a down is not known until its up arrives: the same down
    /// that looks like the second half of a double-click can still turn
    /// into a drag if the pointer moves before release, and deciding
    /// `DoubleClick` at down-time would silently discard that movement
    /// (the up would then find no pending down to resolve against and be
    /// swallowed). So every down is held as a *candidate* and classified
    /// only on its matching up: movement beyond the drag threshold is
    /// always a `Drag`, regardless of double-click timing; otherwise it is
    /// `DoubleClick` when it was a candidate, `Click` when it was not.
    pub fn feed(&mut self, event: RawButtonEvent) -> Option<ClassifiedClick> {
        if event.is_down {
            let is_double_candidate = self
                .last_resolved_down
                .is_some_and(|prev| self.is_double_click(prev, event));
            self.pending = Some((event, is_double_candidate));
            return None;
        }
        // Button up: resolve against the buffered down, if any and if it's
        // the same button (an up for a different button than the pending
        // down means the down was orphaned by a dropped event — discard
        // rather than mis-pair).
        let (down, is_double_candidate) = self.pending.take()?;
        if down.button != event.button {
            return None;
        }
        let dx = (event.x - down.x).abs();
        let dy = (event.y - down.y).abs();
        if dx > self.config.drag_threshold_w || dy > self.config.drag_threshold_h {
            // A drag is never a click: it must not seed, or leave stale,
            // double-click eligibility for whatever comes next.
            self.last_resolved_down = None;
            Some(ClassifiedClick::Drag {
                from: (down.x, down.y),
                to: (event.x, event.y),
            })
        } else {
            self.last_resolved_down = Some(down);
            if is_double_candidate {
                Some(ClassifiedClick::DoubleClick {
                    x: down.x,
                    y: down.y,
                })
            } else {
                Some(ClassifiedClick::Click {
                    x: down.x,
                    y: down.y,
                })
            }
        }
    }

    fn is_double_click(&self, prev_down: RawButtonEvent, new_down: RawButtonEvent) -> bool {
        if prev_down.button != new_down.button {
            return false;
        }
        let dt = new_down
            .hook_timestamp_ms
            .saturating_sub(prev_down.hook_timestamp_ms);
        if dt > self.config.double_click_time_ms {
            return false;
        }
        (new_down.x - prev_down.x).abs() <= self.config.double_click_box_w
            && (new_down.y - prev_down.y).abs() <= self.config.double_click_box_h
    }
}

// ---------------------------------------------------------------------
// Sequence-gap detection
// ---------------------------------------------------------------------

/// `sequenceId`s observed so far (in the order they were actually
/// processed — always ascending, since every stage is a single-consumer
/// FIFO over the previous one). Returns the inclusive `(first_missing,
/// last_missing)` range for each gap a bounded, non-blocking queue's
/// drop-oldest overload policy left behind. Pure arithmetic over whatever
/// ids the evidence thread actually saw; it never guesses whether a given
/// gap was caused by overload versus, e.g., `Click`/`Drag` resolution
/// consuming an id as part of a pair.
///
/// The ascending-order guarantee above is architectural, not assumed
/// silently here: a later id that is not strictly greater than the one
/// before it means something upstream broke that guarantee (a duplicate,
/// a reordering, a second producer), and this function reports that as
/// [`SequenceError::NotStrictlyIncreasing`] rather than quietly skipping
/// it, which is what the naive `if b > a + 1` check used to do for a
/// non-increasing pair. All arithmetic is checked, not merely reasoned
/// about as safe — `b <= a` is handled above before any `+`/`-`, which
/// also happens to make the arithmetic provably panic-free (if `b > a`
/// then `a < u64::MAX`, so `a + 1` cannot overflow; `checked_add`/
/// `checked_sub` enforce that in code instead of only in a comment).
pub fn detect_sequence_gaps(seen: &[u64]) -> Result<Vec<(u64, u64)>, SequenceError> {
    let mut gaps = Vec::new();
    for pair in seen.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if b <= a {
            return Err(SequenceError::NotStrictlyIncreasing { prev: a, next: b });
        }
        if let (Some(first_missing), Some(last_missing)) = (a.checked_add(1), b.checked_sub(1)) {
            if first_missing <= last_missing {
                gaps.push((first_missing, last_missing));
            }
        }
    }
    Ok(gaps)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SequenceError {
    /// `next` was not strictly greater than `prev` — the architecture's
    /// ascending-order guarantee (see [`detect_sequence_gaps`]) was
    /// violated somewhere upstream.
    NotStrictlyIncreasing { prev: u64, next: u64 },
}

impl std::fmt::Display for SequenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SequenceError::NotStrictlyIncreasing { prev, next } => write!(
                f,
                "sequence ids must be strictly increasing: {next} did not follow {prev}"
            ),
        }
    }
}

impl std::error::Error for SequenceError {}

// ---------------------------------------------------------------------
// Privacy / sensitivity decision
// ---------------------------------------------------------------------

/// Whether the author has explicitly granted this process a session-scoped
/// trust decision. Never a persisted or global setting — the shell asks
/// this fresh for the session's own in-memory grant list every time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessTrust {
    AuthorTrusted,
    Default,
}

/// Detection signals already gathered by the caller (UIA + native checks
/// happen in `native.rs`/the evidence thread; this module only decides
/// given the results — it never calls UIA or Win32 itself, which is what
/// keeps it host-independent and unit-testable). `None` means the signal
/// did not run or did not produce an answer — never treated the same as
/// `Some(false)`.
#[derive(Debug, Clone, Default)]
pub struct SensitivitySignals {
    /// UI Automation `IsPassword`, when UIA answered at all.
    pub uia_is_password: Option<bool>,
    /// Native `EM_GETPASSWORDCHAR` result for a real Edit/RichEdit control
    /// (only ever attempted on a control already confirmed to be one of
    /// those classes — ambiguous/other classes leave this `None`).
    pub native_password_char_set: Option<bool>,
    /// An owner-draw style bit was found on this or an ancestor control in
    /// the captured region (`BS_OWNERDRAW`/`LBS_OWNERDRAWFIXED`/etc.) —
    /// the parent paints it, so this control's real content is opaque.
    pub owner_drawn: bool,
    /// The window/control's class was not on the closed, structurally-
    /// transparent allowlist (`Edit`, `RichEdit20W`/`50W`, `Button`,
    /// `Static`, `ComboBox`, `ListBox`, …), or its tree could not be
    /// walked at all (a UIA error, or a UIA/native enumeration mismatch).
    pub unrecognized_or_unwalkable: bool,
    /// The control's name/automation-id/window-title matched the
    /// conservative sensitive-content name heuristic.
    pub name_heuristic_matched: bool,
    /// A trustworthy small bounding rectangle is available for the
    /// specific region that would need redaction (from UIA
    /// `BoundingRectangle`, or a native `GetWindowRect` on a control whose
    /// class is itself the field — never a container/browser-render-host
    /// rect, which can be far larger than the actual field).
    pub trustworthy_rect_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensitivityDecision {
    /// No positive signal fired; the process is `AuthorTrusted`; persist
    /// the screenshot as captured.
    ProceedNormally,
    /// A positive signal fired, a trustworthy rect is available, and the
    /// process is `AuthorTrusted`; persist with that region redacted.
    RedactRegion,
    /// Either the process is `Default` (not explicitly trusted) or a
    /// positive signal fired without a trustworthy rect to redact — in
    /// both cases the screenshot for this step is not persisted at all.
    Withhold,
}

/// The decision this whole design exists to get right. Two rules, applied
/// in order:
///
/// 1. **No automatic safety for any third-party window.** A `Default`
///    (not explicitly author-trusted) process always withholds, regardless
///    of what the signals say — there is no structural check that proves a
///    third-party window's rendering is safe (see the module doc comment),
///    so nothing here is ever allowed to conclude "safe" on its own for an
///    untrusted process.
/// 2. **Inside an `AuthorTrusted` process, detection still runs and still
///    wins.** Any positive signal (`owner_drawn`, `unrecognized_or_unwalkable`,
///    an explicit `Some(true)` from either password check, or a name-
///    heuristic match) means this region is sensitive-or-unconfirmable. If
///    a trustworthy rect exists for it, redact; if not, withhold the whole
///    step rather than guess at an untrustworthy region. Only when *zero*
///    positive signals fired does trust alone let the screenshot through
///    unmasked — and that still only happens inside `AuthorTrusted`, never
///    by default.
pub fn decide_sensitivity(
    trust: ProcessTrust,
    signals: &SensitivitySignals,
) -> SensitivityDecision {
    if matches!(trust, ProcessTrust::Default) {
        return SensitivityDecision::Withhold;
    }
    let positive_signal = signals.owner_drawn
        || signals.unrecognized_or_unwalkable
        || signals.uia_is_password == Some(true)
        || signals.native_password_char_set == Some(true)
        || signals.name_heuristic_matched;
    if !positive_signal {
        return SensitivityDecision::ProceedNormally;
    }
    if signals.trustworthy_rect_available {
        SensitivityDecision::RedactRegion
    } else {
        SensitivityDecision::Withhold
    }
}

/// Conservative, case-insensitive substring match against a control's
/// name/automation-id/window-title, feeding
/// [`SensitivitySignals::name_heuristic_matched`]. Deliberately a second,
/// independent signal from UIA `IsPassword`/the native password-char check
/// — a heuristic can never be a comprehensive secret-content detector, so
/// it only ever adds a positive signal, never clears one (see
/// [`decide_sensitivity`]'s own doc comment for why absence of a signal
/// is never treated as proof of safety). Pure string matching; the caller
/// gathers the text from UIA/native Win32 calls.
pub fn name_matches_sensitive_heuristic(text: &str) -> bool {
    const NEEDLES: &[&str] = &[
        "password",
        "passwd",
        "pwd",
        "passcode",
        "pin",
        "ssn",
        "social security",
        "card number",
        "cardnumber",
        "cvv",
        "cvc",
        "security code",
        "routing number",
        "account number",
        "secret",
        "token",
        "api key",
        "apikey",
        "private key",
    ];
    let lower = text.to_lowercase();
    NEEDLES.iter().any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- SessionManifest / crash recovery --

    #[test]
    fn new_manifest_round_trips() {
        let m = SessionManifest::new("s-1".to_string(), "2026-10-08T00:00:00Z".to_string());
        let json = m.to_json().unwrap();
        let back = parse_manifest(&json).unwrap();
        assert_eq!(back, m);
        assert_eq!(back.status, SessionStatus::Recording);
    }

    #[test]
    fn unsupported_schema_version_fails_closed_both_directions() {
        let newer = r#"{"schemaVersion":2,"kind":"process-session","sessionId":"s","status":"recording","startedAt":"t","endedAt":null,"eventCount":0,"droppedEventCount":0}"#;
        assert_eq!(
            parse_manifest(newer).unwrap_err(),
            ProcessSessionError::UnsupportedSchemaVersion { found: 2 }
        );
        let zero = r#"{"schemaVersion":0,"kind":"process-session","sessionId":"s","status":"recording","startedAt":"t","endedAt":null,"eventCount":0,"droppedEventCount":0}"#;
        assert_eq!(
            parse_manifest(zero).unwrap_err(),
            ProcessSessionError::UnsupportedSchemaVersion { found: 0 }
        );
    }

    #[test]
    fn missing_schema_version_fails_closed() {
        let bad = r#"{"kind":"process-session","sessionId":"s","status":"recording","startedAt":"t","endedAt":null,"eventCount":0,"droppedEventCount":0}"#;
        assert_eq!(
            parse_manifest(bad).unwrap_err(),
            ProcessSessionError::MissingSchemaVersion
        );
    }

    #[test]
    fn wrong_kind_is_rejected() {
        let bad = r#"{"schemaVersion":1,"kind":"something-else","sessionId":"s","status":"recording","startedAt":"t","endedAt":null,"eventCount":0,"droppedEventCount":0}"#;
        assert_eq!(
            parse_manifest(bad).unwrap_err(),
            ProcessSessionError::KindMismatch {
                found: "something-else".to_string()
            }
        );
    }

    #[test]
    fn recording_with_no_ended_at_is_crash_recoverable() {
        assert!(is_crash_recoverable(SessionStatus::Recording, &None));
        assert!(is_crash_recoverable(SessionStatus::Paused, &None));
    }

    #[test]
    fn stopped_or_ended_is_never_crash_recoverable() {
        assert!(!is_crash_recoverable(SessionStatus::Stopped, &None));
        assert!(!is_crash_recoverable(
            SessionStatus::Recording,
            &Some("2026-10-08T00:00:00Z".to_string())
        ));
    }

    // -- ClickClassifier --

    fn config() -> ClickTimingConfig {
        ClickTimingConfig {
            double_click_time_ms: 500,
            double_click_box_w: 4,
            double_click_box_h: 4,
            drag_threshold_w: 4,
            drag_threshold_h: 4,
        }
    }

    fn down(seq: u64, t: u64, x: i64, y: i64) -> RawButtonEvent {
        RawButtonEvent {
            sequence_id: seq,
            hook_timestamp_ms: t,
            x,
            y,
            button: MouseButton::Left,
            is_down: true,
        }
    }

    fn up(seq: u64, t: u64, x: i64, y: i64) -> RawButtonEvent {
        RawButtonEvent {
            sequence_id: seq,
            hook_timestamp_ms: t,
            x,
            y,
            button: MouseButton::Left,
            is_down: false,
        }
    }

    #[test]
    fn a_simple_down_up_with_no_movement_is_a_click() {
        let mut c = ClickClassifier::new(config());
        assert_eq!(c.feed(down(1, 0, 100, 100)), None);
        assert_eq!(
            c.feed(up(2, 50, 100, 100)),
            Some(ClassifiedClick::Click { x: 100, y: 100 })
        );
    }

    #[test]
    fn movement_beyond_the_drag_threshold_is_a_drag() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        assert_eq!(
            c.feed(up(2, 50, 200, 100)),
            Some(ClassifiedClick::Drag {
                from: (100, 100),
                to: (200, 100)
            })
        );
    }

    #[test]
    fn movement_within_the_drag_threshold_is_still_a_click() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        assert_eq!(
            c.feed(up(2, 50, 102, 101)),
            Some(ClassifiedClick::Click { x: 100, y: 100 })
        );
    }

    #[test]
    fn two_downs_within_time_and_distance_classify_as_a_double_click_on_the_up() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.feed(up(2, 10, 100, 100));
        // The down alone is not enough to decide — see the next test for why.
        assert_eq!(c.feed(down(3, 100, 101, 100)), None);
        assert_eq!(
            c.feed(up(4, 110, 101, 100)),
            Some(ClassifiedClick::DoubleClick { x: 101, y: 100 })
        );
    }

    #[test]
    fn a_double_click_candidate_down_that_actually_drags_is_classified_as_a_drag_not_a_double_click(
    ) {
        // Regression: the down alone matches double-click timing/distance against
        // the prior click, but the pointer then moves past the drag threshold
        // before release — the gesture that actually happened is a drag, and
        // deciding DoubleClick at down-time would have silently discarded that
        // movement (the up would find no pending down and be swallowed).
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.feed(up(2, 10, 100, 100));
        c.feed(down(3, 100, 101, 100)); // matches double-click timing/distance
        assert_eq!(
            c.feed(up(4, 150, 300, 100)), // but moves far before release
            Some(ClassifiedClick::Drag {
                from: (101, 100),
                to: (300, 100)
            })
        );
    }

    #[test]
    fn a_completed_drag_does_not_seed_double_click_eligibility_for_the_next_click() {
        // Regression: a drag's down must never become the baseline a later
        // click is compared against — a drag is not a click.
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        assert_eq!(
            c.feed(up(2, 10, 300, 100)),
            Some(ClassifiedClick::Drag {
                from: (100, 100),
                to: (300, 100)
            })
        );
        // A click shortly after, near the drag's start point, must not be
        // treated as the second half of a double-click.
        c.feed(down(3, 50, 100, 100));
        assert_eq!(
            c.feed(up(4, 60, 100, 100)),
            Some(ClassifiedClick::Click { x: 100, y: 100 })
        );
    }

    #[test]
    fn a_completed_drag_clears_a_stale_baseline_too() {
        // A drag must reset last_resolved_down outright, not merely "not update"
        // it — otherwise a click from before the drag could stay eligible and
        // wrongly pair with a click after it.
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.feed(up(2, 10, 100, 100)); // an ordinary click, sets last_resolved_down
        c.feed(down(3, 20, 500, 500));
        c.feed(up(4, 30, 900, 500)); // a drag in between, must clear it
        c.feed(down(5, 40, 101, 100)); // would match the first click's timing/distance
        assert_eq!(
            c.feed(up(6, 50, 101, 100)),
            Some(ClassifiedClick::Click { x: 101, y: 100 })
        );
    }

    #[test]
    fn a_second_down_outside_the_time_window_is_not_a_double_click() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.feed(up(2, 10, 100, 100));
        c.feed(down(3, 600, 100, 100));
        assert_eq!(
            c.feed(up(4, 610, 100, 100)),
            Some(ClassifiedClick::Click { x: 100, y: 100 })
        );
    }

    #[test]
    fn a_second_down_outside_the_distance_box_is_not_a_double_click() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.feed(up(2, 10, 100, 100));
        c.feed(down(3, 100, 200, 100));
        assert_eq!(
            c.feed(up(4, 110, 200, 100)),
            Some(ClassifiedClick::Click { x: 200, y: 100 })
        );
    }

    #[test]
    fn an_up_with_no_pending_down_is_ignored_not_mismatched() {
        let mut c = ClickClassifier::new(config());
        assert_eq!(c.feed(up(1, 0, 100, 100)), None);
    }

    #[test]
    fn an_up_for_a_different_button_than_the_pending_down_does_not_pair() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        let mismatched_up = RawButtonEvent {
            sequence_id: 2,
            hook_timestamp_ms: 10,
            x: 100,
            y: 100,
            button: MouseButton::Right,
            is_down: false,
        };
        assert_eq!(c.feed(mismatched_up), None);
    }

    #[test]
    fn reset_clears_pending_state_after_a_gap() {
        let mut c = ClickClassifier::new(config());
        c.feed(down(1, 0, 100, 100));
        c.reset();
        // The up that follows a reset must not pair with the discarded down.
        assert_eq!(c.feed(up(5, 10, 999, 999)), None);
    }

    // -- detect_sequence_gaps --

    #[test]
    fn contiguous_sequence_has_no_gaps() {
        assert_eq!(detect_sequence_gaps(&[1, 2, 3, 4]), Ok(vec![]));
    }

    #[test]
    fn a_single_dropped_event_is_reported_as_a_one_wide_gap() {
        assert_eq!(detect_sequence_gaps(&[1, 2, 4, 5]), Ok(vec![(3, 3)]));
    }

    #[test]
    fn multiple_dropped_events_are_reported_as_a_wide_gap() {
        assert_eq!(detect_sequence_gaps(&[1, 10]), Ok(vec![(2, 9)]));
    }

    #[test]
    fn several_separate_gaps_are_each_reported() {
        assert_eq!(
            detect_sequence_gaps(&[1, 3, 6, 8]),
            Ok(vec![(2, 2), (4, 5), (7, 7)])
        );
    }

    #[test]
    fn fewer_than_two_ids_has_no_gaps() {
        assert_eq!(detect_sequence_gaps(&[]), Ok(vec![]));
        assert_eq!(detect_sequence_gaps(&[1]), Ok(vec![]));
    }

    #[test]
    fn a_duplicate_id_is_reported_as_a_sequence_error_not_silently_skipped() {
        assert_eq!(
            detect_sequence_gaps(&[1, 3, 3, 6]),
            Err(SequenceError::NotStrictlyIncreasing { prev: 3, next: 3 })
        );
    }

    #[test]
    fn a_decreasing_id_is_reported_as_a_sequence_error() {
        assert_eq!(
            detect_sequence_gaps(&[1, 5, 2]),
            Err(SequenceError::NotStrictlyIncreasing { prev: 5, next: 2 })
        );
    }

    #[test]
    fn adjacent_to_u64_max_never_panics_and_reports_no_gap() {
        // b > a here (MAX-1 < MAX), so this must not hit the overflow this
        // regression is specifically about -- a naive `a + 1` would have
        // panicked (debug) or wrapped (release) when a == u64::MAX, which
        // this input deliberately sits one id away from.
        assert_eq!(detect_sequence_gaps(&[u64::MAX - 1, u64::MAX]), Ok(vec![]));
    }

    #[test]
    fn a_repeated_u64_max_is_a_sequence_error_not_an_overflow_panic() {
        // The one input that would actually reach `a == u64::MAX` on the
        // left side of a pair is caught by the strictly-increasing check
        // before any arithmetic runs at all, which is what makes the
        // arithmetic provably panic-free rather than merely untested at
        // the boundary.
        assert_eq!(
            detect_sequence_gaps(&[u64::MAX, u64::MAX]),
            Err(SequenceError::NotStrictlyIncreasing {
                prev: u64::MAX,
                next: u64::MAX
            })
        );
    }

    // -- decide_sensitivity --

    #[test]
    fn default_trust_always_withholds_even_with_zero_signals() {
        let signals = SensitivitySignals::default();
        assert_eq!(
            decide_sensitivity(ProcessTrust::Default, &signals),
            SensitivityDecision::Withhold
        );
    }

    #[test]
    fn default_trust_withholds_even_when_every_signal_says_safe() {
        let signals = SensitivitySignals {
            uia_is_password: Some(false),
            native_password_char_set: Some(false),
            owner_drawn: false,
            unrecognized_or_unwalkable: false,
            name_heuristic_matched: false,
            trustworthy_rect_available: true,
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::Default, &signals),
            SensitivityDecision::Withhold
        );
    }

    #[test]
    fn trusted_process_with_no_positive_signal_proceeds_normally() {
        let signals = SensitivitySignals {
            uia_is_password: Some(false),
            native_password_char_set: Some(false),
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::ProceedNormally
        );
    }

    #[test]
    fn trusted_process_with_no_signal_at_all_still_proceeds_normally() {
        // Absence of a signal (None) is not a positive hit, but it also
        // never counts as a confirmed "not sensitive" on its own — this
        // test documents that, with zero signals run at all, trust is what
        // lets the screenshot through, not an inferred negative.
        let signals = SensitivitySignals::default();
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::ProceedNormally
        );
    }

    #[test]
    fn uia_confirmed_password_with_a_rect_redacts_rather_than_withholds() {
        let signals = SensitivitySignals {
            uia_is_password: Some(true),
            trustworthy_rect_available: true,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::RedactRegion
        );
    }

    #[test]
    fn native_confirmed_password_char_with_a_rect_redacts() {
        let signals = SensitivitySignals {
            native_password_char_set: Some(true),
            trustworthy_rect_available: true,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::RedactRegion
        );
    }

    #[test]
    fn sensitive_without_a_trustworthy_rect_withholds_rather_than_guesses() {
        let signals = SensitivitySignals {
            uia_is_password: Some(true),
            trustworthy_rect_available: false,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::Withhold
        );
    }

    #[test]
    fn owner_drawn_control_is_treated_as_a_positive_signal_even_without_uia() {
        let signals = SensitivitySignals {
            owner_drawn: true,
            trustworthy_rect_available: false,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::Withhold
        );
    }

    #[test]
    fn unrecognized_or_unwalkable_class_is_treated_as_a_positive_signal() {
        let signals = SensitivitySignals {
            unrecognized_or_unwalkable: true,
            trustworthy_rect_available: false,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::Withhold
        );
    }

    #[test]
    fn name_heuristic_match_alone_is_a_positive_signal() {
        let signals = SensitivitySignals {
            name_heuristic_matched: true,
            trustworthy_rect_available: true,
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::AuthorTrusted, &signals),
            SensitivityDecision::RedactRegion
        );
    }

    #[test]
    fn a_false_password_result_alone_does_not_prove_safety_without_trust() {
        // Named regression for the original Blocker 1 finding: a negative
        // password check must never, by itself, establish "whole screenshot
        // is safe" outside of the AuthorTrusted boundary.
        let signals = SensitivitySignals {
            uia_is_password: Some(false),
            ..SensitivitySignals::default()
        };
        assert_eq!(
            decide_sensitivity(ProcessTrust::Default, &signals),
            SensitivityDecision::Withhold
        );
    }

    // -- name_matches_sensitive_heuristic --

    #[test]
    fn matches_common_sensitive_field_names_case_insensitively() {
        assert!(name_matches_sensitive_heuristic("Password"));
        assert!(name_matches_sensitive_heuristic("PASSCODE"));
        assert!(name_matches_sensitive_heuristic("Social Security Number"));
        assert!(name_matches_sensitive_heuristic("Card Number"));
        assert!(name_matches_sensitive_heuristic("cvv"));
        assert!(name_matches_sensitive_heuristic("Routing Number"));
        assert!(name_matches_sensitive_heuristic("txtApiKey"));
    }

    #[test]
    fn does_not_match_ordinary_field_names() {
        assert!(!name_matches_sensitive_heuristic("First Name"));
        assert!(!name_matches_sensitive_heuristic("Email Address"));
        assert!(!name_matches_sensitive_heuristic("Save"));
        assert!(!name_matches_sensitive_heuristic(""));
    }

    #[test]
    fn matches_as_a_substring_within_a_longer_label() {
        assert!(name_matches_sensitive_heuristic("Enter your password here"));
        assert!(name_matches_sensitive_heuristic("txtPIN_1"));
    }
}
