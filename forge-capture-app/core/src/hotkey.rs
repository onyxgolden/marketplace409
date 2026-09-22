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
//! * Registration is best-effort. The OS may already reserve Print Screen
//!   (Windows 11 maps it to screen snipping via an Accessibility setting)
//!   or another capture tool may hold it. A failed registration must never
//!   fail startup — the app keeps working and reports the status.

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
}
