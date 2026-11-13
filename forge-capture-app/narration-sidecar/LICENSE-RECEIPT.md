# License + model receipt — FORGE Capture Phase 3 Slice A narration sidecar

Slice A uses **no paid service and no cloud voice API**. All voice work
runs locally on the iBUYPOWER with the components below. **Chatterbox is
NOT used** — its upstream repository was archived/retired in August 2026,
so it is not an admissible fallback.

## OpenVoice V2 (voice cloning / tone-color conversion)

- License: **MIT** (commercial use stated by upstream)
- Repository: https://github.com/myshell-ai/OpenVoice
- Pinned code commit: `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`
- Checkpoints: https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip
- Checkpoints (V2 weights) SHA-256: `<FILL-FROM-RECEIPT:C:\forge-bridge\narration\receipt.json>`
  - **NOT YET KNOWN** — the iBUYPOWER env setup is still running. The
    setup script records the zip hash as `checkpoints_v2_zip_sha256` in
    `C:\forge-bridge\narration\receipt.json`; fill this line (and the
    runner's weights hash, which reads the same receipt at runtime) from
    that file before the first benchmark run. Until then every
    `result.json` / `render-manifest.json` carries the same placeholder
    string and the runner logs a warning.
- Use in slice A: zero-shot tone-color cloning only. No training, no
  durable per-person model.

## MeloTTS (base TTS for OpenVoice V2)

- License: **MIT**
- Repository: https://github.com/myshell-ai/MeloTTS
- Pinned code commit: `209145371cff8fc3bd60d7be902ea69cbdb7965a`
- Use in slice A: English base-speaker synthesis (`TTS(language='EN')`);
  its output is re-voiced by the OpenVoice tone-color converter.

## FFmpeg (render assembly)

- License: **LGPL/GPL per the gyan.dev essentials build** (static build
  from https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip)
- The exact FFmpeg version string is recorded at runtime in every
  `render-manifest.json` and `result.json` (`ffmpeg_version`); the
  setup receipt also records it (`C:\forge-bridge\narration\receipt.json`).

## Python

- Python 3.12.10 (per-user install on the iBUYPOWER, at
  `C:\Users\jason\AppData\Local\Programs\Python\Python312\python.exe`).
  OpenVoice/MeloTTS require Python <= 3.12.

## Reproducibility

The setup script (`tools/narration/setup-env.ps1` in forge-ai-drop)
writes a machine receipt to `C:\forge-bridge\narration\receipt.json`
with the Python version, FFmpeg version + zip hash, OpenVoice commit +
LICENSE hash, MeloTTS commit, checkpoints zip hash, torch version, GPU
name, and the import smoke-test result, plus a frozen requirements
list at `C:\forge-bridge\narration\requirements-frozen.txt`. A clean
local install reproduces one segment from those pins (acceptance gate 2).
