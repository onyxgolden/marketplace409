# MSIX packaging (Microsoft Store) — FORGE Capture

Tauri v2 does not emit MSIX (only `msi`/`nsis`), and the Microsoft Store
only accepts MSIX. So we build the raw Win32 exe and wrap it afterwards —
the same approach the Tauri community uses (see the winapp CLI's official
Tauri guide: `learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri`).

## What is here

- `AppxManifest.template.xml` — the package manifest with `{{TOKENS}}`
  filled in by the pack script. Edit the template, never a generated copy.
- `pack-msix.ps1` — stages `forge-capture-app.exe` + generated Store logos,
  fills the manifest, and packs an **unsigned** `.msix` with the Windows
  SDK `makeappx.exe`.
- `out/` (created on run) — staging dir + the finished `.msix`. Not
  committed.

## Prerequisites (Windows machine)

- Rust + Node, and a working `cargo tauri build --no-bundle` for this app
  (the static UI in `../../ui` is embedded at compile time).
- Windows SDK (`makeappx.exe`, `signtool.exe` for test-signing only):
  `winget install Microsoft.WindowsSDK.10.0.26100`
- Alternative packer: `winget install Microsoft.winappcli` (`winapp pack`
  can substitute for `makeappx` — same manifest works).
- Partner Center app reservation for the real Identity/Publisher values
  (see `docs/product/forge-capture/MSIX_STORE_CHECKLIST.md`).

## Build → pack → submit

```powershell
# From this directory, in PowerShell:
.\pack-msix.ps1 -IdentityName "<Name from Partner Center>" `
  -Publisher "<CN=... from Partner Center>" `
  -PublisherDisplayName "409 Marketplace LLC" `
  -Version "0.2.0.0"
```

Output: `out\FORGECapture_0.2.0.0_x64.msix` — **unsigned**. Upload it
as-is in a Partner Center submission; Microsoft signs it after
certification. There is deliberately no certificate handling for the
Store path: nothing to buy, nothing to store in-repo.

Local install test (optional):

```powershell
.\pack-msix.ps1 -SkipBuild -SelfSign   # test-only self-signed cert
```

Then trust `out\forge-capture-test.cer` once (admin → Local Machine →
Trusted People) and double-click the `.msix`. The `-SelfSign` package
must never go to the Store.

## Notes for certification

- Full-trust desktop-bridge app (`runFullTrust`): FORGE Capture is a
  Win32 app — global hotkeys, GDI capture, clipboard. It installs no
  drivers, services, or browser extensions.
- Local-first: captures stay under the app's own data dir; no account,
  no network use at all. (Under MSIX, `%LOCALAPPDATA%` writes are
  redirected to the package's private per-user store — the existing
  `captures_dir()` logic keeps working unchanged.)
- Print Screen takeover: best-effort global-hotkey registration. If the
  OS reserves the key, the app logs it and keeps working; certification
  testers can use the app window directly.
