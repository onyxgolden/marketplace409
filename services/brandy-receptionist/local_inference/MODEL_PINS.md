# Local inference model pins — Receptionist Cut 1 (Stage 0, offline)

All local AI for the receptionist runs on the iBUYPOWER (RTX 5080, 16 GB VRAM) through
`local_inference/server.py`, a loopback-only HTTP server that loads these models once
at startup and keeps them warm. No model phones home during inference; the only
network access any of these packages make is the one-time pinned download below.

## Speech-to-text

- **Model:** `mobiuslabsgmbh/faster-whisper-large-v3-turbo` — a CTranslate2 conversion
  of OpenAI's `openai/whisper-large-v3-turbo`.
- **License:** MIT (both the faster-whisper library and the Whisper code/weights it
  packages; verified on the repo's own metadata, `license: mit`).
- **Pinned revision:** `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`
- **Runtime:** faster-whisper 1.2.1 (CTranslate2 backend), `device="cuda"`,
  `compute_type="float16"`. Loaded from the already-proven
  `C:\forge-bridge\narration\venv` (Capture Phase 3 Slice A's venv — faster-whisper was
  already a pinned dependency there for enrollment VAD; reused here, not reinstalled).
- **Real load proof:** loaded on this exact machine in 54.0s cold; `model.device ==
  "cuda"` confirmed.
- **Why this repo, not Systran's own `faster-whisper-large-v3`:** SYSTRAN has not
  published an official CT2 conversion of the *-turbo* variant specifically (only the
  non-turbo large-v3); `mobiuslabsgmbh/faster-whisper-large-v3-turbo` is the exact repo
  faster-whisper's own library code resolves the `"turbo"` model-size alias to
  (`faster_whisper.utils._MODELS["turbo"]`), so it is the library maintainers' own
  choice of canonical turbo conversion, not an unvetted third party.

## LLM (advisory only — never authoritative; see app/pipeline.py)

- **Model:** `qwen3:8b` via Ollama.
- **License:** Qwen3-8B is Apache-2.0; Ollama itself is MIT.
- **Pulled:** `ollama pull qwen3:8b` — 5.2 GB, matching the scope brief's published
  estimate exactly. Ollama was already installed and already running as a local
  service on this machine (v0.40.6) before this build; no new install was needed.
- **Runtime:** Ollama's own local HTTP API on `127.0.0.1:11434`. No remote API key, no
  outbound call — this is the same boundary Ollama itself already enforces.
- **Context:** 4K initially, per the scope brief; thinking disabled for this
  constrained assistant role (not yet wired — see the provider adapter's own notes for
  the exact request shape).

## TTS fallback / current working default

- **Model:** Kokoro-82M (`hexgrad/Kokoro-82M`).
- **License:** Apache-2.0 (verified on the repo's own tags: `license:apache-2.0`).
- **Pinned revision:** `f3ff3571791e39611d31c381e3a41a3af07b4987`
- **Default voice:** `af_heart` (American English) — **provisional**, chosen only to
  prove the pipeline works; Stage 4 of the full brief requires Jason and Brandy to
  listen to and approve the actual selected voice before any live use. Do not treat
  `af_heart` as approved.
- **Real synthesis proof:** synthesized the exact pinned disclosure sentence end-to-end
  on this machine — produced a real 4.3-second WAV file (not a stub), first-audio
  latency measured (cold-pipeline run; not the warm-server number the Stage 0 rehearsal
  will measure).
- **New dependency installed:** `kokoro==0.9.4` (pip) plus its own transitive deps
  (spacy, misaki, etc. — see the exact installed-package list below). Installed into
  the SAME venv as OpenVoice/MeloTTS (`C:\forge-bridge\narration\venv`) rather than a
  fresh venv. **This was checked, not assumed, to be safe**: `pip install
  --require-hashes -r tools/narration/requirements-lock.txt` (the exact pinned lock
  for that venv) afterward showed **zero actual version changes** — every package was
  already at its pinned version. Confirmed `import melo.api` still succeeds.

## TTS candidate, gated OFF by default — Tyler Welch / OpenVoice V2

- **Components:** OpenVoice V2 + MeloTTS (MIT) — see
  `forge-capture-app/narration-sidecar/LICENSE-RECEIPT.md` for the full existing
  provenance chain (unchanged by this build).
- **Gate (this build's own addition):** `local_inference/server.py`'s `/tts/openvoice`
  endpoint only attempts synthesis when a file at
  `RECEPTIONIST_OPENVOICE_APPROVAL_PATH` (default: `services/brandy-receptionist/data/
  openvoice-receptionist-approval.txt`) exists and contains exactly the text
  `APPROVED`. **No such file is created by this build.** Per the Cut 1 task's own
  explicit instruction: "Do NOT assume his Capture enrollment covers the receptionist
  ... that decision is Jason's, flagged in your filing, not yours." Until Jason creates
  that file (or the equivalent decision is made some other explicit way), the endpoint
  returns `501` and no OpenVoice synthesis wiring is reachable in this build — recorded
  as a named follow-on, not silently skipped.

## Open items this pin list does NOT resolve

- Kokoro voice selection (`af_heart` is provisional pending Jason/Brandy's listening
  approval — Stage 4 of the full brief).
- Tyler's voice approval decision (above).
- A full SBOM/license audit of Kokoro's own transitive dependency tree (spacy, misaki,
  thinc, blis, etc.) — all pulled from PyPI, not yet individually hash-pinned or
  license-reviewed one by one in this pass. Flagging as real remaining work, not
  claiming it is done.

## New packages installed into `C:\forge-bridge\narration\venv` for Cut 1

```
kokoro==0.9.4, misaki==0.9.4, espeakng-loader==0.2.4, spacy==3.8.18,
spacy-curated-transformers==0.3.1, curated-tokenizers==0.0.10,
curated-transformers==0.1.1, thinc==8.3.14, blis==1.3.4, srsly==2.5.6,
catalogue==2.0.10, confection==1.3.4, weasel==1.0.1, cloudpathlib==0.26.0,
smart-open==9.0.4, wasabi==1.1.3, murmurhash==1.0.16, cymem==2.0.16,
preshed==3.0.15, rdflib==7.6.0, jsonschema==4.26.0, jsonschema-specifications,
referencing, rpds-py, csvw, segments, language-tags, isodate, rfc3986,
phonemizer-fork==3.3.2, dlinfo==2.0.0, addict==2.4.0, loguru==0.8.0,
termcolor==3.3.0, uritemplate==4.2.0, win32-setctime==1.2.1, pyparsing,
attrs, en-core-web-sm==3.8.0 (spacy English model, auto-pulled by misaki
on first use).
```

None of these were already in the pinned `requirements-lock.txt` for that venv (they
are additive, not a version bump of anything already pinned there).
