# Model-bound payload — dom-distillation slice 1 (frozen)

## The payload

The ONLY bytes sent to the model per observation: **`distilled_text`**
(the text output of `distillSnapshot`).

## Host-side only (never sent)

- `reference_map` — binds `[eN]` refs to snapshot nodes for the host's
  action layer. Sending it would hand the model pre-resolved targets
  outside the text it actually read, and bloat the payload.
- `source` envelope (fixture/build/pin/document/task) — evidence for the
  host, not model input.
- `omissions`, `retained_count` / `omitted_count`, `truncated_fields`,
  `baseline_tokens`, `output_tokens`, `max_output_tokens`.

## Why this boundary

The model cites `[eN]` refs from the distilled text it read; the host
resolves those refs against the frozen reference map. The map is the
host's private binding — the model must never receive a second,
potentially divergent copy of target identity.

## Measurement (frozen)

The benchmark measures exactly this payload on both sides with the pinned
instrument (`gpt2-bpe/1`):

- baseline: `countTokens(canonicalJson(full snapshot))` — what would be
  sent without distillation;
- payload: `countTokens(distilled_text)` — via `payloadTokens(out)`.

Both sides use the same tokenizer; only the payload boundary above is
ever claimed as "sent". Per-case sizes and worst-case regression are
reported; any normal case whose payload grows (negative reduction) is
flagged REGRESSION in the per-case output and in the report's
`worst_case_regression` field.

Changing this boundary requires a new review: it changes what the
savings figures mean.
