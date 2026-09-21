# FORGE Capture — packaging & Windows runtime notes (Rungs 2a + 2b)

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
- **Known limitation (2a):** window capture `BitBlt`s the window's screen
  rect from the screen DC, so an *occluded* window captures its occluders'
  pixels rather than its own content. A `PrintWindow`/`GetWindowDC`-based
  capture plus a blank-frame detector is the follow-up; it needs real
  Windows hardware to validate, so it is not attempted here.
- On non-Windows hosts every native entry point returns
  `CaptureError::NativeApi` — the core crate compiles and its
  pure logic is fully testable on Linux/macOS.

## Scrolling capture (2b) — supported targets and limits

Scrolling capture stitches a full scrollable document from viewport tiles.
It never claims universal support: every run reports **complete**,
**incomplete** (reason + evidence + partial stitch when tiles landed), or
**failed** (reason + evidence). A partial stitch is never labeled complete.

- **DOM-aware engine** (window targets only): reads the window's real
  scrollbar via `GetScrollInfo` and positions it exactly with
  `WM_VSCROLL`/`WM_HSCROLL` + `SB_THUMBPOSITION`. End of content is known
  from the geometry, not guessed. Best on classic Win32 scrollbars
  (Notepad-style editors, list views, MMC-style panes).
- **Raster-observation engine** (window or region targets): synthesizes
  wheel input (`SendInput`, `Shift`+wheel for horizontal) parked over the
  target center, then measures the real pixel displacement between frames
  with a phase-correlation-free block matcher. Works on targets with no
  OS-visible scrollbar (browsers, Electron apps, custom scrollbars) —
  anything that actually responds to wheel input.
- **Auto** tries DOM-aware first and falls back to raster-observation when
  the target exposes no usable scroll geometry (loudly recorded in the
  sidecar's `scroll.engine` field).

**Known limitations (2b, unverified until real Windows 11 hardware):**

- Occluded windows: tiles are `BitBlt`'d from the screen DC, so a window
  covered mid-scroll stitches its occluders' pixels (same 2a limitation,
  now per tile). Keep the target topmost and untouched during a run.
- `IsWindow` aliveness checks do not detect a window that was *moved or
  resized* without closing; the correlator's mismatch/stall detectors are
  the backstop, reported as incomplete, not silent corruption.
- Wheel synthesis moves the system cursor to the target center and
  restores it afterwards; don't touch the mouse mid-run.
- Horizontal scroll direction for `Shift`+wheel follows the common
  convention; if a target scrolls the other way the run stops on still
  frames (incomplete) rather than stitching backwards.
- Infinite feeds hit the tile/distance safeguards and report incomplete
  (`EngineLimit`), never an unbounded run.
- Sticky headers/footers and sidebars are detected per tile pair and
  trimmed; duplicates and missing regions are reported, not hidden.
- The cursor is excluded from scrolling tiles (it would smear across the
  stitch and poison displacement measurement).
- Unsigned NSIS remains internal/dev-only; stable code signing is still
  required before any public beta/download.

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
