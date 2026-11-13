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
- **Base model files (fix round 3):** the MeloTTS English config +
  checkpoint the runner binds TTS to come from the official Hugging
  Face repo `myshell-ai/MeloTTS-English`, pinned revision
  `bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef`:
  `config.json` (3,488 bytes, SHA-256
  `039116c927c70eaa4458d315ea83aaaa99e1fca1c621b50c8ca56b4a5700eb77`) and
  `checkpoint.pth` (207,860,748 bytes, SHA-256
  `acd278040eaf9536908e2b965273df5a731c44d8f0da66cc5fed7972772ed23c`).
  Setup downloads them from that exact revision, verifies sizes +
  hashes, records them in the receipt, and installs them under
  `C:\forge-bridge\narration\melotts-en\`; the runner validates the
  receipt + installed bytes (`validate_melotts_model`) before any TTS
  work and records the revision + hashes in every `result.json`
  model block. A missing or changed base-model file fails the job
  closed. The `spk2id` keys at this revision are exactly the five
  `MELO_EN_SPEAKER_KEYS` the ses layout smoke test covers.
- **BERT base encoder (fix round 3):** MeloTTS EN generation loads
  `bert-base-uncased` (tokenizer + masked-LM) on every segment, at
  no revision in melo's code. Setup seeds it once from
  `google-bert/bert-base-uncased` at pinned revision
  `86b5e0934494bd15c9632b12f734a8a67f723594` into the transformers
  cache (sizes verified, revision + cache dir in the receipt); the
  runner forces `HF_HUB_OFFLINE=1` before importing melo, so a job
  can only use the seeded cache.
- **Code install (fix round 3):** the pinned MeloTTS
  `requirements.txt` cannot install on Python 3.12 as written
  (fugashi 1.3.0 needs MeCab C headers; tokenizers 0.13.3 has no
  cp312 wheel) — setup installs the pinned MeloTTS code `--no-deps`
  plus only the EN-path runtime deps (`cached_path`, `transformers`,
  `g2p_en`, `pykakasi`, `num2words`, `jamo`, `mecab-python3` +
  `unidic-lite`, `fugashi` — the last three are required at import
  because `japanese.py` does `import MeCab` and instantiates the
  Japanese BERT tokenizer at module level; the pinned fugashi 1.3.0
  has no cp312 wheel, so the latest wheel build is installed instead
  — plus NLTK cmudict data) and verifies the import before proceeding.

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
LICENSE hash, MeloTTS commit, checkpoints zip hash, MeloTTS English
base-model revision + per-file hashes + install dir, torch version, GPU
name, and the import smoke-test result, plus a frozen requirements
list at `C:\forge-bridge\narration\requirements-frozen.txt`. A clean
local install reproduces one segment from those pins (acceptance gate 2).
