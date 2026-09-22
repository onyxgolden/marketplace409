# FORGE Capture — Rung 4 Encoder License Audit

**Date:** 2026-09-22 · Fresh audit per the Rung 0 PR plan (§2 PR #5, §4:
"Rung 4 needs its fresh encoder license audit"). Audit only; the
implementation follows in the same PR after this verdict.

## Proposed recording pipeline (what is being audited)

```
getDisplayMedia (OS picker: screen / window)
  → optional compositor canvas (cursor highlight / spotlight / magnifier overlays)
  → canvas.captureStream()  [only when an overlay is active; otherwise the raw display stream]
  → MediaRecorder → WebM (VP9/VP8) or MP4 (platform muxer, when supported)
  → 1 s timeslice chunks → header-preserving cluster concat (trim)
  → cluster-timestamp offsetting (combine)
  → <video> decode + canvas frame grabs + gifenc (GIF export)
```

Every encoder/muxer in this path is either a **platform API** (the OS/browser
vendor ships and licenses the codec) or an **MIT-licensed JS library already
in the tree**. FORGE Capture ships **zero codec bytes** in Rung 4.

## Findings

### 1. MediaRecorder video codecs — VP8 / VP9 (WebM recording path)

- The recorder requests `video/webm;codecs=vp9`, falling back to
  `video/webm;codecs=vp8`, then `video/webm`, in that order, probed with
  `MediaRecorder.isTypeSupported`. The encoder is the platform's (Chromium /
  WebView2 media stack).
- **VP8 / VP9 are royalty-free.** The WebM Project publishes an irrevocable
  patent grant covering VP8 and VP9; there is no patent pool and no royalty
  obligation for implementers or users. (AV1, not used here, is likewise
  royalty-free under the Alliance for Open Media patent license 1.0.)
- Verdict: **clean**. No license, no fee, no attribution required.

### 2. MediaRecorder MP4 path (optional MP4 export)

- MP4 is offered **only** when `MediaRecorder.isTypeSupported("video/mp4")`
  returns true (recent Chromium-based browsers / Safari). The H.264/AAC
  encoder and the MP4 muxer are the platform's.
- H.264 and AAC are patent-encumbered (MPEG-LA / Via Licensing pools), **but
  we ship no H.264/AAC bytes and no encoder**: codec licensing for a
  platform-provided MediaRecorder implementation is the platform vendor's
  responsibility (Microsoft / Google / Apple), exactly as for every Electron /
  Tauri / browser app that calls this API.
- Explicitly **not** in Rung 4: bundling OpenH264, x264, or any native
  encoder; building our own MP4 muxer around a shipped H.264 encoder.
- Verdict: **clean** — platform-API use only, no new exposure.

### 3. npm muxer candidates from the Rung 0 shortlist — NOT NEEDED

Checked 2026-09-22 via the npm registry (not from memory):

| Package | Version | License (registry) | Decision |
|---|---|---|---|
| `webm-muxer` | 5.1.4 | MIT | **not added** — MediaRecorder emits fully-muxed WebM; trim/combine are implemented as cluster-level byte operations on that output, no re-muxing library required |
| `mp4-muxer` | 5.2.2 | MIT | **not added** — MP4 comes from the platform MediaRecorder when supported; we never mux MP4 ourselves |

Both are permissive (MIT) and remain viable for a future rung, but Rung 4
adds **zero** new npm dependencies.

### 4. gifenc (GIF export) — already in the tree

- `gifenc@^1.0.3` is already a root `package.json` dependency (used by
  `src/domains/capture-editor/pixelEncoders.js` for still-GIF export).
- License re-verified 2026-09-22 via the npm registry: **MIT**.
- GIF's LZW compression patents (Unisys/IBM) expired in 2003–2004; there is
  no remaining patent exposure in GIF encoding.
- Verdict: **clean**. Reused, no new dependency.

### 5. `canvas.captureStream()` + compositor overlays

- `captureStream()` produces an uncompressed MediaStream from canvas pixels;
  no codec involved. Cursor highlight / spotlight / magnifier are plain
  Canvas 2D draw operations.
- Cursor position comes from the existing Win32 `GetCursorInfo` path already
  used by Rung 2a screenshots — a platform API call, no licensed component.
- Verdict: **clean**.

### 6. WebView2 `getDisplayMedia` support (platform capability, not a license)

Verified 2026-09-22 against independent Tauri/WebView2 apps in the wild
(flowcap, gametalk, campfire, brmble — all calling `getDisplayMedia` inside
Tauri WebView2 shells successfully):

- **Supported** on Windows WebView2 (Chromium engine). Standard Tauri serves
  from a secure context (`https://tauri.localhost`), which satisfies the
  API's secure-context requirement.
- Known platform caveats (documented as Rung 4 limitations, not blockers):
  - Chromium draws a mandatory "sharing" indicator on the webview that
    initiated capture; it is visible if our own window is inside the
    recorded area.
  - Per-window audio is not provided by Chromium/WebView2 — a window capture
    yields video only; system audio is available with full-screen capture.
  - MP4 MediaRecorder support varies by platform; the UI offers it only when
    `isTypeSupported("video/mp4")` is true.
- The implementation feature-detects
  (`navigator.mediaDevices?.getDisplayMedia`, `window.MediaRecorder`) and
  disables recording with an honest message where unavailable.

### 7. Hard constraints reaffirmed

- **No FFmpeg bundling** (Rung 0 NO-GO item) — unchanged; Rung 4 needs none.
- **No native encoder** (no libvpx, no x264, no Media Foundation encode
  session) — unchanged.
- **No network, no account, no upload** — recordings are written to the
  local captures folder only, same as stills.

## Verdict

**GO.** Rung 4 ships with **zero new dependencies and zero new license
surface**: platform MediaRecorder (royalty-free VP8/VP9 WebM path;
platform-licensed MP4 path used only where the platform offers it),
`canvas.captureStream()` compositing, and the already-vendored MIT `gifenc`.
`webm-muxer` / `mp4-muxer` were evaluated and deliberately not added.
`THIRD_PARTY_NOTICES.md` gains no new entries from this rung.
