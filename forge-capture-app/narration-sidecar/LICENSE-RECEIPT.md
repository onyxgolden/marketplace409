# License + model receipt — FORGE Capture Phase 3 Slice A narration sidecar

Slice A uses **no paid service and no cloud voice API**. All voice work
runs locally on the iBUYPOWER with the components below. **Chatterbox is
NOT used** — its upstream repository was archived/retired in August 2026,
so it is not an admissible fallback.

## OpenVoice V2 (voice cloning / tone-color conversion)

- License: **MIT** (commercial use stated by upstream)
- Repository: https://github.com/myshell-ai/OpenVoice
- Pinned code commit: `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`
- Checkpoints source: https://huggingface.co/myshell-ai/OpenVoice
  (official Hugging Face repo, pinned revision
  `c70fc8b939bd1d8213994ff7c88e32be39708271`) for the nine files of
  the repo's `checkpoints/` tree, PLUS
  https://huggingface.co/myshell-ai/OpenVoiceV2 (official Hugging
  Face repo, same author, pinned revision
  `f36e7edfe1684461a8343844af60babc2efbb727`) for the six English
  `base_speakers/ses/` embeddings the V2 generation path loads
  (`en-au`, `en-br`, `en-default`, `en-india`, `en-newest`,
  `en-us`). The `myshell-ai/OpenVoice` tree carries NO `ses/`
  directory (verified 2026-11-13 at the pinned revision and at
  main), and the canonical V2 zip that used to carry the ses files
  lived on the S3 bucket below — OpenVoiceV2 is the authoritative
  source for them. The upstream S3 zip
  (`https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip`)
  is GONE — the bucket was deleted (`NoSuchBucket`, verified 2026-11-12).
  The setup script downloads the fifteen files from the two pinned
  revisions and assembles `checkpoints_v2_0417.zip` with the
  deterministic builder (`narration-sidecar/build_checkpoints_zip.py`).
- Checkpoints (V2 weights) SHA-256: `cf5ce18b3a3841d3079fc47a3cd6ec76e0b51d12da5b62d33787c63e16028020`
  - The SHA-256 of the deterministic zip (420,906,355 bytes), built
    2026-11-13 from the Hugging Face files above and verified
    byte-identical across two independent builds. The setup script
    rebuilds the same zip on the iBUYPOWER and records the same hash
    as `checkpoints_v2_zip_sha256` in
    `C:\forge-bridge\narration\receipt.json`; the Rust core
    (`CHECKPOINTS_ZIP_SHA256`) and the runner
    (`WEIGHTS_SHA256_PINNED`) pin this value. A receipt carrying a
    different hash is not this weights set. (Previous hash
    `200e6e39…82e3fb` was the nine-file zip without the ses
    embeddings; superseded by fix round 3 — a clean setup with that
    zip could not generate, because the runner's ses load had no
    file to load.)
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
