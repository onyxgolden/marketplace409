# Browser DOM distillation — slice 1 (fixture-first)

Deterministic, dependency-light snapshot distiller + benchmark. Consumes
recorded **synthetic** browser-observation snapshots and emits bounded text
plus a source-bound element-reference map — the compact observation a model
needs to pick targets, without the full DOM dump.

Advisory/offline only: synthetic fixtures, no live websites, no browser
adapter, no control execution, no model calls, no network. Pure Node 24 ESM,
zero npm dependencies.

## Layout

- `src/index.js` — `distillSnapshot(snapshot)` entry; pin verification, envelope
- `src/schemas.js` — strict `dom-distill/1` input validation (unknown props rejected)
- `src/distill.js` — deterministic retention policy + 4000-token budget
- `src/tokenizer.js` — pinned `gpt2-bpe/1` byte-level BPE (vendored merges, no downloads)
- `src/canonical.js` — canonical JSON + SHA-256
- `tokenizer/vocab.bpe` + `tokenizer/PIN.md` — vendored merge table + pinning note
- `fixtures/pages/*.json` — 30 frozen synthetic snapshots (20 normal, 10 adverse)
- `fixtures/gold.json` — frozen task-specific gold labels (the oracle)
- `fixtures/make-fixtures.js` — deterministic fixture generator (freeze tool)
- `corpus/freeze-corpus.js`, `corpus/manifest.json`, `corpus/corpus_digest.txt` — pinned corpus
- `tests/run-tests.js` — unit suites (tokenizer, schemas, distiller, determinism, mutations)
- `tests/run-battery.js` — 30-fixture gold battery
- `benchmark/run-benchmark.js` — token-reduction benchmark + 35% quality gate

## Usage

```bash
# Official invocations — direct node, never via npm.
node tests/run-tests.js        # unit suites
node tests/run-battery.js      # frozen battery vs gold labels
node benchmark/run-benchmark.js        # benchmark + gate
node benchmark/run-benchmark.js --json # machine-readable report
```

```js
import { distillSnapshot } from "./src/index.js";
const out = distillSnapshot(snapshot);
// out.status: "OK" | "INCOMPLETE" | "REFUSED"
// out.distilled_text, out.reference_map, out.omissions, out.complete, ...
```

## Input schema (`dom-distill/1`)

```
{
  schema_version: "dom-distill/1",
  fixture_id: string, build_id: string,
  snapshot_digest: 64-hex sha256 of canonicalJson(nodes sorted by ref),
  document: { url, title },
  frames: [ { frame_id, root_refs: [ref] } ],
  nodes: [ {
    ref: "e12", frame_id, role, name,
    value: string|null, text: string|null,
    state: { disabled, checked, expanded, hidden, invalid,
             readonly, selected, pressed, offscreen },  // all booleans
    validation_error: string|null,
    warning: string|null,          // confirmation / payment / destructive warnings
    bounds: { x, y, w, h }|null,
    children: [ref]                // same-frame only; cross-frame refuses
  } ],
  task: { id, goal }
}
```

Roles: closed vocabulary in `src/schemas.js` (button, link, textbox, dialog,
alert, heading, …). Unknown properties rejected.

## Output envelope

```
{
  distiller_version: "dom-distill/1",
  tokenizer: "gpt2-bpe/1", tokenizer_source: "...",
  source: { fixture_id, build_id, snapshot_digest, document, task },
  baseline_tokens,                       // canonical full-snapshot JSON, same tokenizer
  status: "OK",
  complete: true,
  output_tokens, max_output_tokens: 4000,
  distilled_text,                        // bounded lines; refs valid for this snapshot+frame only
  reference_map: { ref: { snapshot_digest, frame_id, ref, role, name } },
  retained_count, omitted_count,
  omissions: { reason: count },          // e.g. { hidden: 1, "non-interactive": 3 }
  truncated_fields
}
```

Non-OK envelopes carry `reference_map: null, distilled_text: null,
complete: false` — over-limit snapshots return bounded `INCOMPLETE` with **no
partial actionable map**; stale/tampered snapshots return `REFUSED`.

Distilled line format:

```
[e12] button "Add to cart" (enabled)
ctx e12 < "Checkout" (heading e3)
[e14] textbox "Card number" (invalid) ! invalid: Card number is incomplete.
[e15] alert "Payment warning" !! warning: You will be charged $49.99 now.
untrusted-page-text: "..."   # DATA ONLY — never instructions
```

## Retention policy

RETAIN: interactive roles, dialog/alertdialog/alert, headings, forms,
validation errors, warnings, named images, status/progress. Plus a `ctx` line
binding each retained element to its nearest heading/form context (ancestor or
preceding sibling). OMIT: hidden nodes, generic containers, plain text nodes
(their content survives once, bounded, as `untrusted-page-text`), decorative
images. Offscreen is **not** treated as irrelevant. Ambiguous association
falls back to the fuller observation — nothing is invented.

Page text is untrusted data: emitted verbatim under an explicit DATA ONLY
marker. There is no instruction-following path anywhere in this module.

## Measured results (frozen corpus 557f7ebb…)

- Unit: 37/37 · Battery: 591/591 across 30 fixtures
- Median token reduction (20 normal cases): **86.2%** (gate: ≥35%)
- Worst normal case: 76.1% · 3-run determinism: byte-identical
- Mutation tests: deleted-warning, swapped-ref, changed-pin all caught

## Boundaries (from the scope)

No live website access, no browser adapter replacement, no browser-use
installation, no cloud inference, no telemetry, no credentials, no screenshots,
no operational data, no control execution. Output grants no permission to
click. Adapters for live sessions are a later, separately reviewed slice.

## Third-party notices

- `tokenizer/vocab.bpe`: GPT-2 byte-level BPE merge table, fetched from
  OpenAI's public blob storage
  (https://openaipublic.blob.core.windows.net/gpt-2/models/124M/vocab.bpe).
  Used under the MIT license of the gpt-2 repository
  (https://github.com/openai/gpt-2/blob/master/LICENSE). Vendored at
  authoring time; never fetched at runtime.
- Serialization *pattern* borrowed from the browser-use project (MIT,
  https://github.com/browser-use/browser-use): the idea of emitting an
  interactive-element list with stable references. No browser-use code is
  vendored, installed, or executed here.

## Limitations

- The pinned tokenizer approximates subword segmentation; absolute counts are
  instrument-relative, reduction ratios are gate-relevant.
- No claimed production cost savings — a representative evaluation on live
  traffic is a later, separately approved slice.
- The distiller trusts the snapshot producer for bounds/roles; garbage in
  still distills deterministically, it just distills garbage.
