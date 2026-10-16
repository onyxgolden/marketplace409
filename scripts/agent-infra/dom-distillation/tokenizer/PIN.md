# Tokenizer pin — dom-distillation slice 1

Pinned instrument: **gpt2-bpe/1** — byte-level BPE with the 50,000 merge ranks
vendored in `vocab.bpe` (OpenAI public GPT-2 merges, `#version: 0.2` header
present; 50,000 rank lines verified at load — the loader throws if the count
differs).

## Target identification (DOM-005)

The intended consumer of distilled output is the FORGE browser agent's
language model (the agent runtime that reads distilled observations to pick
targets). That runtime does not expose a single vendored tokenizer offline,
so **gpt2-bpe/1 is the pinned measurement instrument — an approximation of
the target model family's subword segmentation, not the target model's own
tokenizer.**

Consequences, stated plainly:

- Absolute token counts are instrument-relative. Never quote them as
  production cost figures.
- Reduction ratios (distilled vs. undistilled, same instrument both sides)
  are what the adoption gate uses.
- No claimed production cost savings until a later approved representative
  evaluation on live traffic.

## Pinning

- Source: https://openaipublic.blob.core.windows.net/gpt-2/models/124M/vocab.bpe
  (fetched once at authoring time, 2026-10-16; never fetched at runtime)
- License: see README.md third-party notices (MIT).
- Runtime behavior: file read once from disk at first use, rank table frozen.
  No network, no downloads, no native modules, no WASM.
- The instrument's identity (`gpt2-bpe/1`, 50,000 ranks, no runtime
  downloads) is asserted by unit tests, including known-vector checks.
- The vendored file is covered by the frozen corpus manifest: any change
  fails corpus verification and fails the adoption gate.
