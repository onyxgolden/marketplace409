# Microsoft Store submission checklist — FORGE Capture

**Status:** scaffolding in-repo (manifest template + pack script). Everything
below is a manual, on-a-Windows-machine, Jason-action step. Nothing here
costs anything except the Partner Center account itself (~$19 one-time for
an individual developer account, paid by Jason when he decides).

## 1. Partner Center account (Jason)

1. Go to https://partner.microsoft.com → sign up as a developer
   (individual account ≈ **$19 one-time**).
2. Complete account verification (ID check; can take a day or two).

## 2. Reserve the app name (Jason)

1. Partner Center → Apps and games → New product → MSIX or PWA app.
2. Reserve the name, e.g. **FORGE Capture**.
3. Open the product → **Product identity** and copy these three values:
   - Package/Identity/**Name** (e.g. `1234Publisher.FORGECapture`)
   - Package/Identity/**Publisher** (e.g. `CN=1234ABCD-...`)
   - Package/Properties/**PublisherDisplayName** (e.g. `409 Marketplace LLC`)

## 3. Build the unsigned MSIX (Windows machine)

Prereqs: Rust + Node, Windows SDK
(`winget install Microsoft.WindowsSDK.10.0.26100`).

```powershell
cd forge-capture-app\packaging\msix
.\pack-msix.ps1 -IdentityName "<Name from step 2>" `
  -Publisher "<Publisher from step 2>" `
  -PublisherDisplayName "409 Marketplace LLC" `
  -Version "<x.y.z.0 matching the release>"
```

Output: `out\FORGECapture_<version>_x64.msix` — **unsigned**. Do not sign
it; Partner Center signs Store submissions after certification. (The
script's `-SelfSign` flag is for local install testing only and must
never be used for the uploaded package.)

## 4. Create the submission (Jason)

1. Partner Center → the FORGE Capture product → **Start a new submission**
   (or continue the draft).
2. **Packages:** upload the unsigned `.msix` from step 3.
3. **Properties:** category `Utilities`; fill the age rating questionnaire
   (no user-generated content sharing, no network — expect the lowest
   rating tier).
4. **Store listing:** description, screenshots (take them with the app
   itself, naturally), and a **privacy policy URL** (required even though
   the app collects nothing — point it at the 409marketplace.online
   privacy page or a short statement page).
5. Notes for certification (paste-friendly):
   > FORGE Capture is a full-trust desktop utility (runFullTrust). It
   > performs screen capture via Win32 APIs, registers an optional
   > Print-Screen global hotkey (best-effort; degrades gracefully), and
   > stores captures locally under its own app data. It installs no
   > drivers, services, or browser extensions; creates no accounts; and
   > makes no network requests.
6. Submit for certification. Typical turnaround: hours to a few days.

## 5. Updates later

Repeat step 3 with a bumped `-Version` and upload the new `.msix` in a new
submission. The GitHub NSIS installer remains the non-Store distribution
channel; keep both version numbers in sync.

## What is deliberately NOT in-repo

- No code-signing certificate. Store submissions don't need one
  (Microsoft signs them). The only cert that ever exists is the throwaway
  self-signed one from `-SelfSign`, used for local testing and never
  committed.
- No Partner Center secrets, no publisher IDs. Those live in Partner
  Center and are passed as script parameters at pack time.
