# FORGE Capture — packaging & Windows runtime notes (Rung 2a)

## Distribution decision (2a)

- **Installer:** unsigned per-user **NSIS** (`targets: "nsis"`,
  `windows.nsis.installMode: "currentUser"` in `app/tauri.conf.json`).
- **Install location:** `%LOCALAPPDATA%` — no admin rights, no machine-wide
  writes.
- **Captures:** `%LOCALAPPDATA%/FORGE Capture/Captures` —
  `<stem>.png` + `<stem>.forge.json` sidecar per capture.

## Explicitly NOT in 2a

- Code signing (see gate below), Windows Store / MSIX, MSI/WiX,
  auto-updater infrastructure, additional architectures (x64 only).

## Signing gate (public beta / download)

Stable **Windows code signing is required before any public beta or
download**. The 2a NSIS bundle is unsigned and is for internal/dev-machine
use only. Do not publish the unsigned installer anywhere users can fetch
it. When the signing certificate lands, revisit: sign the EXE + installer,
re-verify SmartScreen behavior, then cut the beta.

## Windows runtime behavior

- The shell calls `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)`
  at startup (best effort; the Tauri manifest usually sets this already).
  Per-monitor `scale` values come from `GetDpiForMonitor(MDT_EFFECTIVE_DPI)`
  and flow into every artifact's `scale` field.
- Screen capture uses GDI `BitBlt` from the screen DC; the cursor is drawn
  with `DrawIconEx` only when `includeCursor` is set and the cursor is
  showing. Clipboard export uses `CF_DIB` (BITMAPINFOHEADER + bottom-up
  BGRA) — the most compatible clipboard image format on Windows.
- Window enumeration skips invisible windows and windows with empty titles.
- On non-Windows hosts every native entry point returns
  `CaptureError::UnsupportedPlatform` — the core crate compiles and its
  pure logic is fully testable on Linux/macOS.

## Local-first guarantees

- No network use anywhere in the shell: no HTTP clients, no analytics, no
  telemetry, no crash reporting, no update checks. (PostHog-style
  instrumentation stays out of this binary entirely.)
- No account, no sign-in, no upload. Export is a local file copy via a
  Save dialog.
- The Tauri capability set (`app/capabilities/default.json`) grants only
  core windowing; the frontend cannot touch the filesystem directly — all
  writes go through Rust commands into the app's own directories.
- No surveillance features: no background capture, no timers, no global
  hotkeys, no screen recording. Delayed capture sleeps at most 60s and
  only after an explicit user click.

## Build

```sh
cd forge-capture-app
cargo build -p forge-capture-app --release --target x86_64-pc-windows-msvc
# installer bundle (on a Windows host):
cargo tauri build --target x86_64-pc-windows-msvc
```

Cross-checks run on Linux: `cargo test -p forge-capture-core` (pure logic),
`cargo check -p forge-capture-core --target x86_64-pc-windows-msvc`
(native Win32 module). The full Tauri app links only on a Windows host
(GTK system deps are not installed for the Linux host build).
