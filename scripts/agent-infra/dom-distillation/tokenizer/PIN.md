# Tokenizer pin — dom-distillation slice 1

Pinned tokenizer: **gpt2-bpe/1** — byte-level BPE with the 50,000 merge ranks
vendored in `vocab.bpe` (OpenAI public GPT-2 merges, `#version: 0.2` header
present; 50,000 rank lines verified at load — the loader throws if the count
differs).

- Source: https://openaipublic.blob.core.windows.net/gpt-2/models/124M/vocab.bpe
  (fetched once at authoring time, 2026-10-16; never fetched at runtime)
- License: see README.md third-party notices (MIT).
- Runtime behavior: file read once from disk at first use, rank table frozen.
  No network, no downloads, no native modules, no WASM.
- Role: a pinned, static, deterministic measurement instrument. Token counts
  in the benchmark are measured with THIS tokenizer on both baseline and
  distilled sides — never with characters and never with a vendor claim.
  It approximates subword segmentation of the target model family; absolute
  counts are instrument-relative, reduction ratios are what the gate uses.
