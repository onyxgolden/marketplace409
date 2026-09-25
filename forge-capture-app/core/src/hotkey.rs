//! Print Screen system-default takeover contract.
//!
//! FORGE Capture registers the Print Screen key as a global shortcut so it
//! can replace the OS screenshot tool (e.g. Windows Snipping Tool) as the
//! default capture entry point. This module owns the contract both sides
//! share: the accelerator string, the intended action, and the graceful-
//! degradation rule. The Tauri shell (`forge-capture-app`) performs the
//! actual OS registration; nothing in this module touches the OS, so all of
//! it is unit-testable on any host.
//!
//! Design rules (pinned by the tests below):
//! * A Print Screen press is a *launch*, not a shutter: it brings the
//!   Capture window forward so the user picks a capture mode. It never
//!   starts a capture by itself.
//! * The modified variants *are* shutters: Shift+PrintScreen opens the
//!   region overlay on the monitor under the cursor; Alt+PrintScreen
//!   captures that monitor immediately; Ctrl+PrintScreen focuses the app
//!   and arms window capture (the window itself must still be picked —
//!   there is no way to capture a window the user did not choose).
//! * All shortcuts stay inside the PrintScreen namespace: FORGE Capture
//!   never hijacks application shortcuts (Ctrl+Shift+W etc.).
//! * Registration is best-effort. The OS may already reserve Print Screen
//!   (Windows 11 maps it to screen snipping via an Accessibility setting),
//!   a Wayland compositor may refuse global shortcuts entirely, or another
//!   capture tool may hold one. A failed registration must never fail
//!   startup — the app keeps working and reports the status.

/// Accelerator string the shell registers with the OS global-shortcut API.
///
/// `"PrintScreen"` is the W3C UI Events `code` value the Tauri
/// global-shortcut plugin parses; it carries no modifiers.
pub const PRINTSCREEN_ACCELERATOR: &str = "PrintScreen";

/// What a Print Screen press must do: bring the Capture window forward.
/// Kept as a named constant so the shell and any future UI/status surface
/// cannot drift apart.
pub const PRINTSCREEN_ACTION: &str = "focus-capture-window";

/// Case-insensitive match so alternate spellings (`"printscreen"`,
/// `"PRINTSCREEN"`) in config or logs still resolve to the takeover, while
/// genuinely different shortcuts (`"F12"`, `"Ctrl+PrintScreen"`) do not.
pub fn is_printscreen_takeover(accelerator: &str) -> bool {
    accelerator.eq_ignore_ascii_case(PRINTSCREEN_ACCELERATOR)
}

/// Outcome of the shell's registration attempt. `Unavailable` carries the
/// OS/plugin error text for the log; the app treats both variants as
/// non-fatal by construction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TakeoverStatus {
    Active,
    Unavailable { reason: String },
}

impl TakeoverStatus {
    pub fn active(&self) -> bool {
        matches!(self, TakeoverStatus::Active)
    }

    /// Human-readable one-liner for logs and the (future) UI status row.
    pub fn describe(&self) -> String {
        match self {
            TakeoverStatus::Active => {
                "Print Screen takeover active: pressing Print Screen opens FORGE Capture".into()
            }
            TakeoverStatus::Unavailable { reason } => {
                format!("Print Screen takeover unavailable ({reason}); capture still works from the app window")
            }
        }
    }
}

/// Map a registration `Result` to a [`TakeoverStatus`]. `Ok` means the OS
/// accepted the global shortcut; `Err` carries the plugin/OS error text and
/// degrades to `Unavailable` — never a startup failure.
pub fn status_from_registration(result: Result<(), String>) -> TakeoverStatus {
    match result {
        Ok(()) => TakeoverStatus::Active,
        Err(reason) => TakeoverStatus::Unavailable { reason },
    }
}

/// Human-readable one-liner for a direct-capture shortcut's registration
/// outcome, for the startup log. Names the accelerator so a failed grab is
/// diagnosable without guessing which one it was.
pub fn describe_shortcut_status(accelerator: &str, status: &TakeoverStatus) -> String {
    match status {
        TakeoverStatus::Active => format!("{accelerator}: global shortcut active"),
        TakeoverStatus::Unavailable { reason } => format!(
            "{accelerator}: global shortcut unavailable ({reason}); capture still works from the app window"
        ),
    }
}

// ---------------------------------------------------------------------------
// Direct-capture shortcuts: the modified Print Screen variants.
// ---------------------------------------------------------------------------

/// Accelerator that opens the region overlay immediately on the monitor
/// under the cursor.
pub const REGION_ACCELERATOR: &str = "Shift+PrintScreen";

/// Accelerator that focuses the app and arms window capture (the user still
/// picks the window — there is no way to capture a window unchosen).
pub const WINDOW_ACCELERATOR: &str = "Ctrl+PrintScreen";

/// Accelerator that captures the monitor under the cursor immediately.
pub const FULLSCREEN_ACCELERATOR: &str = "Alt+PrintScreen";

/// Action id emitted to the UI when the window-capture shortcut fires, so
/// the app can switch to window mode and refresh the window list.
pub const ACTION_WINDOW_CAPTURE: &str = "window-capture";

/// The action a global shortcut asks the app to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    /// Bring the Capture window forward (bare PrintScreen).
    FocusWindow,
    /// Open the region overlay on the monitor under the cursor.
    RegionCapture,
    /// Focus the app, switch to window mode, refresh the window list.
    WindowCapture,
    /// Capture the monitor under the cursor immediately.
    FullscreenCapture,
}

/// Map an accelerator string (case-insensitive) to its action. `None` for
/// anything FORGE Capture does not own.
pub fn action_for_accelerator(accelerator: &str) -> Option<HotkeyAction> {
    if is_printscreen_takeover(accelerator) {
        Some(HotkeyAction::FocusWindow)
    } else if accelerator.eq_ignore_ascii_case(REGION_ACCELERATOR) {
        Some(HotkeyAction::RegionCapture)
    } else if accelerator.eq_ignore_ascii_case(WINDOW_ACCELERATOR) {
        Some(HotkeyAction::WindowCapture)
    } else if accelerator.eq_ignore_ascii_case(FULLSCREEN_ACCELERATOR) {
        Some(HotkeyAction::FullscreenCapture)
    } else {
        None
    }
}

/// Every (accelerator, action) pair the shell registers, in registration
/// order. Registration stays best-effort: one failure never blocks the
/// others or startup.
pub const CAPTURE_SHORTCUTS: [(&str, HotkeyAction); 4] = [
    (PRINTSCREEN_ACCELERATOR, HotkeyAction::FocusWindow),
    (REGION_ACCELERATOR, HotkeyAction::RegionCapture),
    (WINDOW_ACCELERATOR, HotkeyAction::WindowCapture),
    (FULLSCREEN_ACCELERATOR, HotkeyAction::FullscreenCapture),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accelerator_is_bare_printscreen() {
        assert_eq!(PRINTSCREEN_ACCELERATOR, "PrintScreen");
        assert_eq!(PRINTSCREEN_ACTION, "focus-capture-window");
    }

    #[test]
    fn takeover_matches_case_insensitively() {
        assert!(is_printscreen_takeover("PrintScreen"));
        assert!(is_printscreen_takeover("printscreen"));
        assert!(is_printscreen_takeover("PRINTSCREEN"));
    }

    #[test]
    fn takeover_rejects_other_shortcuts() {
        assert!(!is_printscreen_takeover("F12"));
        assert!(!is_printscreen_takeover("Ctrl+PrintScreen"));
        assert!(!is_printscreen_takeover("Print Screen"));
        assert!(!is_printscreen_takeover(""));
    }

    #[test]
    fn successful_registration_maps_to_active() {
        let status = status_from_registration(Ok(()));
        assert_eq!(status, TakeoverStatus::Active);
        assert!(status.active());
        assert!(status.describe().contains("active"));
    }

    #[test]
    fn failed_registration_degrades_with_reason_preserved() {
        let status =
            status_from_registration(Err("hotkey already registered by another app".to_string()));
        assert!(!status.active());
        match &status {
            TakeoverStatus::Unavailable { reason } => {
                assert_eq!(reason, "hotkey already registered by another app")
            }
            TakeoverStatus::Active => panic!("expected Unavailable"),
        }
        let text = status.describe();
        assert!(text.contains("unavailable"));
        assert!(text.contains("hotkey already registered"));
        assert!(text.contains("still works"));
    }

    #[test]
    fn direct_capture_accelerators_map_to_their_actions() {
        assert_eq!(
            action_for_accelerator("Shift+PrintScreen"),
            Some(HotkeyAction::RegionCapture)
        );
        assert_eq!(
            action_for_accelerator("Ctrl+PrintScreen"),
            Some(HotkeyAction::WindowCapture)
        );
        assert_eq!(
            action_for_accelerator("Alt+PrintScreen"),
            Some(HotkeyAction::FullscreenCapture)
        );
        assert_eq!(
            action_for_accelerator("PrintScreen"),
            Some(HotkeyAction::FocusWindow)
        );
    }

    #[test]
    fn direct_capture_accelerators_match_case_insensitively() {
        assert_eq!(
            action_for_accelerator("shift+printscreen"),
            Some(HotkeyAction::RegionCapture)
        );
        assert_eq!(
            action_for_accelerator("CTRL+PRINTSCREEN"),
            Some(HotkeyAction::WindowCapture)
        );
        assert_eq!(
            action_for_accelerator("alt+printscreen"),
            Some(HotkeyAction::FullscreenCapture)
        );
    }

    #[test]
    fn unknown_accelerators_map_to_no_action() {
        assert_eq!(action_for_accelerator("F12"), None);
        assert_eq!(action_for_accelerator("Ctrl+Shift+W"), None);
        assert_eq!(action_for_accelerator("Print Screen"), None);
        assert_eq!(action_for_accelerator(""), None);
    }

    #[test]
    fn capture_shortcuts_table_is_consistent() {
        assert_eq!(CAPTURE_SHORTCUTS.len(), 4);
        let mut seen = std::collections::HashSet::new();
        for (accelerator, action) in CAPTURE_SHORTCUTS {
            // No duplicate accelerators in the registration table.
            assert!(seen.insert(accelerator), "duplicate: {accelerator}");
            // The table agrees with the mapping function.
            assert_eq!(action_for_accelerator(accelerator), Some(action));
        }
        // The bare PrintScreen contract is unchanged by the new scheme.
        assert!(CAPTURE_SHORTCUTS.contains(&(PRINTSCREEN_ACCELERATOR, HotkeyAction::FocusWindow)));
    }

    #[test]
    fn shortcut_status_description_names_the_accelerator() {
        let active =
            describe_shortcut_status("Shift+PrintScreen", &status_from_registration(Ok(())));
        assert!(active.contains("Shift+PrintScreen"), "got: {active}");
        assert!(active.contains("active"), "got: {active}");

        let failed = describe_shortcut_status(
            "Alt+PrintScreen",
            &status_from_registration(Err("already registered".to_string())),
        );
        assert!(failed.contains("Alt+PrintScreen"), "got: {failed}");
        assert!(failed.contains("already registered"), "got: {failed}");
        assert!(failed.contains("still works"), "got: {failed}");
    }
}
