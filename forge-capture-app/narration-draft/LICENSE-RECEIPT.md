# License + model receipt — FORGE Capture Phase 3 Slice 2 (PPTX narration drafts)

Slice 2's local-model-draft path uses **no cloud API and no paid service**. It runs
entirely on the iBUYPOWER using the two components below. No torch, no transformers,
no Python — llama.cpp's own CLI binary does the forward pass.

## llama.cpp (local text generation runtime)

- License: **MIT**
- Repository: https://github.com/ggml-org/llama.cpp
- Pinned release: **b12444**, commit `47fe13331`
- Windows asset: `llama-b12444-bin-win-cpu-x64.zip` (CPU-only build — no CUDA/GPU
  dependency; Q4 1.5B inference is fast enough on CPU alone for a 2-5 sentence
  narration paragraph, so the extra CUDA runtime surface is not worth adding)
- Asset SHA-256: `d17f82517cf6b5ee501953cc41ca1cdea0c2fb2a0aedd62b5c61e7b4fa6437bd`
  (25,219,626 bytes)
- Binary invoked at runtime: `llama-cli.exe`
  (SHA-256 `514ddd4891ab40de63f7535634a4f140badb96bf7e20272af1774471e99e5ae4`).
  Fix round 1 (P2): the Rust wrapper (`narration_draft.rs`,
  `LLAMA_CPP_PACK_FILES`) now pins and verifies EVERY file this binary can
  dynamically load at runtime, not just the exe and its one impl DLL — llama.cpp
  picks its CPU backend at runtime from several `ggml-cpu-*.dll` variants
  depending on detected CPU features, so a substituted file in any of them was a
  real gap. The full pinned set (21 files, all from the same pinned zip):
  `llama-cli.exe`, `llama-cli-impl.dll`, `llama.dll`, `llama-common.dll`,
  `ggml.dll`, `ggml-base.dll`, `libomp.dll`, and all 14 `ggml-cpu-*.dll` variants
  (alderlake, cannonlake, cascadelake, cooperlake, haswell, icelake, ivybridge,
  piledriver, sandybridge, sapphirerapids, skylakex, sse42, x64, zen4). Every
  hash is checked before every generation request; a changed file fails closed.
- Installed at: `C:\forge-bridge\pptx-narration\llama-cpp\b12444-win-cpu-x64\`
  (outside git — the receipt and hashes below are what make this reproducible,
  not a committed binary).
- No network calls at inference time — this is llama.cpp's own design (a pure
  local GGUF forward pass over stdin/file input); verified no socket/HTTP code
  path exists anywhere in the Rust wrapper that shells out to it either.

## Qwen2.5-1.5B-Instruct (narration-draft script model)

- License: **Apache-2.0** (verified on the model card; this is the 1.5B variant
  specifically — Qwen2.5-3B uses the Qwen Research License and is excluded by
  the scope brief's license rule, so it is never used here)
- Repository: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF
  (Qwen's own official GGUF export — not a third-party community requantization)
- Pinned repo commit: `91cad51170dc346986eccefdc2dd33a9da36ead9`
- File: `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- File SHA-256: `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`
  (1,117,320,736 bytes — matches the repo's own git-lfs pointer `oid` exactly,
  cross-checked against the locally downloaded bytes, not just trusted from the
  download)
- Quantization: Q4_K_M, Qwen's own published quant (not re-quantized locally;
  per the scope brief, "do not substitute a random community quantization")
- Installed at: `C:\forge-bridge\pptx-narration\model\qwen2.5-1.5b-instruct-q4_k_m.gguf`
  (outside git — ~1.1 GB; too large to commit, and the project convention
  established by Slice A's OpenVoice checkpoints already keeps model weights
  outside the repo with a pinned-hash receipt).
- Target pack size per the brief was "approximately 1 GB for a Q4 model pack" —
  the actual Q4_K_M artifact is 1.12 GB (recorded here, not rounded).

## End-to-end smoke test (before any Rust code was written)

Ran `llama-cli.exe` directly against the pinned model with a real grounded
prompt (a 3-bullet safety-review slide) before writing any integration code,
to confirm the raw pipeline actually works on this hardware:

```
Prompt: 695.7 t/s | Generation: 39.9 t/s
```

Output used only the facts given (zero lost-time incidents, 412 walk-throughs,
new PPE policy) with no invented numbers or claims — see
`results/claude/capture-pptx-slice2-2026-11-16.md` for the full transcript.

## Reproducibility

`C:\forge-bridge\pptx-narration\receipt.json` records every hash above plus the
asset URLs and install paths, as a human-readable provenance record. **Fix round
1 correction:** the Rust wrapper does NOT read this JSON file at startup or at
any point — an earlier version of this document claimed it did; that was never
true. The pinned `LLAMA_CPP_PACK_FILES` / `MODEL_GGUF_SHA256` constants compiled
into `narration_draft.rs` are the only thing the running code ever checks,
against the files actually present at `C:\forge-bridge\pptx-narration\` on disk
(not just against the receipt — the receipt could itself be tampered with; the
pinned constants are the real source of truth, same pattern as the OCR sidecar's
`model_pack::verify_model_pack`), and refuses to generate if either mismatches.
A missing model/binary, or an installed-but-mismatched one, fails to the manual
narration path — never a cloud call, never a silent skip.
