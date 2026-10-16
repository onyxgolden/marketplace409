# Windows Build & Acceptance Plan — Capture PR #639 fix round

**Status:** NOT RUN. The sandbox has no Rust toolchain and no Windows desktop.
These steps must run on the iBUYPOWER (or another Windows dev machine) before
merge. Do not waive.

## 1. Compile & unit tests

```powershell
cd <repo>\forge-capture-app
cargo check --workspace
cargo test --workspace
```

Required outputs:
- `cargo check` clean for both crates (`core`, `app`).
- `cargo test` passing, including the new tests:
  - `engines::tests::solid_color_detects_uniform_raw_frame`
  - `engines::tests::solid_color_ignores_cursor_pixels_on_raw_check`
  - `engines::tests::solid_color_does_not_warn_on_genuine_content`
  - `engines::tests::solid_color_rejects_degenerate_buffers`
- Resolve actual errors; do not label failures waived.

## 2. Packaged build

Build the Windows artifact from the EXACT reviewed tree (record the commit SHA):

```powershell
cd <repo>\forge-capture-app
cargo tauri build
```

Record: executable/installer SHA-256, version, machine/OS/display/DPI/session.

## 3. Daemon-driven acceptance (Bridge allowlist already covers the Capture exe)

Use the FORGE Bridge daemon (`screenshot`, `launch`, `click`, `key`) or direct
observation. Test on the affected interactive desktop with a controlled
visibly NONUNIFORM pattern (not a blank wallpaper):

1. **Alt+PrintScreen** — full capture. Verify: preview dialog OPENS and is
   VISIBLE (C639-004: app was minimized — main window must restore/focus
   AFTER acquisition). Saved PNG opened/decoded separately: dimensions match,
   pixels nonuniform beyond cursor.
2. **Region capture** (Shift+PrintScreen or UI) — drag a region. Verify:
   overlay shows selection UI (not a white screen); on complete, preview
   opens with the region image.
3. **Region cancel** (Esc) — overlay closes cleanly, no trapped opaque overlay.
4. **Preview race** — trigger two captures in quick succession; verify the
   preview shows ONE capture's image with matching metadata/actions.
5. **4K capture** — capture a 3840×2160 monitor; verify preview loads
   (C639-001: must NOT refuse with the 25MB upload-cap error).
6. **Blank-frame warning** — capture a uniform-color screen; verify the
   preview shows the solid-color warning (C639-005: warning must fire even
   with cursor visible).
7. **Actions bind** — Copy, AI Edit, Save as… operate on the displayed
   capture (C639-002).
8. **Repeated captures** — 3+ in a row; no stuck overlay, no focus traps.

## 4. Evidence to file

- `cargo check` / `cargo test` full output at the reviewed tree.
- Packaged artifact SHA-256 + version.
- The exact saved PNGs (opened/decoded separately, dimensions + nonuniform
  content confirmed).
- Screenshots/photos of: preview dialog visible after minimized Alt+PrintScreen;
  region overlay (not white); warning on uniform capture.
- Note what happened before the first overlay paint and when closing/hiding it.

A dark blank overlay or an error message is NOT a correct screenshot preview.
