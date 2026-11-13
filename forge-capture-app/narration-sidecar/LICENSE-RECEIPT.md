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
- **BERT base encoder (fix round 5 — the offline pin):** MeloTTS EN
  generation loads `bert-base-uncased` (tokenizer + masked-LM) on
  every segment, at no revision in melo's code. Setup seeds it once
  by the canonical id `google-bert/bert-base-uncased` (the old id
  `bert-base-uncased` cannot download `model.safetensors` on the
  iBUYPOWER — the Xet read-token endpoint 404s for it, diagnosed
  2026-11-13), then creates the alias cache identity melo requests
  (`models--bert-base-uncased/snapshots/<rev>/` + `refs/main`) by
  copying the verified snapshot, at pinned revision
  `86b5e0934494bd15c9632b12f734a8a67f723594`, every file verified by
  pinned SHA-256 (config.json `7160e155…187d20`, vocab.txt
  `07eced37…038a3`, tokenizer_config.json `a025160e…4bf10`,
  tokenizer.json `ce64fce7…9a98`, pytorch_model.bin `09741738…b203a`,
  model.safetensors `68d45e23…169d3` — full hashes in
  `docs/narration.md`); the receipt records the runtime repo, the
  seed repo, the revision, the snapshot dir, and all six hashes, and
  the runner re-validates them plus the cache identity
  (`validate_bert_model`) before any TTS work and records them in
  every `result.json` model block. A missing, changed, or
  mis-resolved BERT file fails the job closed. The setup also runs a
  real-library cold-cache proof (fresh `HF_HOME`, sockets blocked,
  one English segment) that must print `COLD CACHE PROOF OK`.
- **Lazy-import patch (fix round 6):** the pinned MeloTTS dispatcher
  (`melo/text/__init__.py::get_bert`) imports ALL five language BERT
  modules before choosing the requested language, and several
  construct tokenizers at import — so the first English segment
  needed all five tokenizer caches just to import the dispatcher,
  while setup seeds/validates only `bert-base-uncased`. Setup applies
  the pinned patch `tools/narration/melotts-lazy-bert.patch` (SHA-256
  `2318ba2a92ac7a0b10beb296c9c4d30d8024131b97f018549894e0cda4a7e3a9`,
  verified before applying, idempotent via the `FORGE lazy-import
  patch` marker, re-verified in all three patched files) to the
  installed MeloTTS code: `cleaner.py` and `get_bert` lazily import
  only the selected language module, and `english.py` defines
  `distribute_phone` locally instead of importing it from `japanese`.
  After the patch, an English segment imports/constructs ONLY the EN
  tokenizer + model. The receipt records `melotts_patch_sha256`.
  The cold-cache proof (below) is rebuilt on an explicit allowlist
  from empty — only the validated EN BERT alias snapshot — and never
  copies ambient `models--*` caches. Setup does NOT delete the shared
  `models--google-bert--bert-base-uncased` seed folder (fix round 6
  P2: shared cache state is not narration-owned).
- **Pinned lock file (fix round 6):** every Python artifact is
  installed from `tools/narration/requirements-lock.txt` with `pip
  install --require-hashes` — exact versions + SHA-256 hashes for all
  133 packages of the proven working venv (Python 3.12,
  cp312/win_amd64), including the CUDA-index torch wheel
  (`torch==2.14.1+cu130`) and `torchaudio==2.11.1` (PyPI), plus the
  enrollment path's `whisper-timestamped==1.14.2` (the version
  OpenVoice's pinned `requirements.txt` pins; `se_extractor.py`
  imports it at module level) and its four resolved deps
  (`openai-whisper==20250625`, `dtw-python==1.9.0`, `Cython==3.3.1`,
  `tiktoken==0.14.0`) — the first enrollment failed on the missing
  import before these were added (fix round 6 live-proof find). No unpinned
  `pip install <name>` remains in the setup. The lock SHA-256
  (`73a4c2524468753bbfcb961d195aef5a0660f2b7d51574911e63830af42d4a07`)
  is recorded in the receipt as `requirements_lock_sha256`; a `-Clean`
  setup run rebuilds the venv from the lock from scratch.
- **Code install (fix round 3, lock in fix round 6):** the pinned MeloTTS
  `requirements.txt` cannot install on Python 3.12 as written
  (fugashi 1.3.0 needs MeCab C headers; tokenizers 0.13.3 has no
  cp312 wheel) — setup installs the pinned MeloTTS code `--no-deps`
  plus the EN-path runtime deps from the pinned lock file
  (`cached_path`, `transformers`, `g2p_en`, `pykakasi`, `num2words`,
  `jamo`, `anyascii`, `mecab-python3` + `unidic-lite`, `fugashi`,
  `gruut` + `gruut-ipa` — retained in the lock even though the
  lazy-import patch means the EN path no longer reaches the JP/KO/FR/
  ES modules at import; the list was verified with a full AST walk of
  the pinned source after two rounds missed imports a line grep
  couldn't see — plus NLTK cmudict + perceptron-tagger data) and
  verifies the import (against the patched code) before proceeding.

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
base-model revision + per-file hashes + install dir, BERT revision +
per-file hashes + snapshot dir, the requirements-lock SHA-256 and the
MeloTTS lazy-import patch SHA-256, torch version, GPU name, and the
import smoke-test result, plus a frozen requirements list at
`C:\forge-bridge\narration\requirements-frozen.txt`. A clean local
install reproduces one segment from those pins (acceptance gate 2).
