# Browser DOM distillation — slice 1 (fixture-first)

Deterministic, dependency-light snapshot distiller + benchmark. Consumes
recorded **synthetic** browser-observation snapshots and emits bounded text
plus a source-bound element-reference map — the compact observation a model
needs to pick targets, without the full DOM dump.

Advisory/offline only: synthetic fixtures, no live websites, no browser
adapter, no control execution, no model calls, no network. Pure Node 24 ESM,
zero npm dependencies.

## Layout

- `src/index.js` — `distillSnapshot(snapshot)` entry; pin verification,
  graph validation, envelope (source metadata detached)
- `src/schemas.js` — strict `dom-distill/1` input validation (unknown props rejected)
- `src/graph.js` — bounded structural validation: valid roots, single
  parentage, acyclicity, full root coverage, depth cap (refuses, never hangs)
- `src/distill.js` — deterministic retention policy + 4000-token budget
- `src/parse.js` — escaped/length-framed field encoding + the trusted
  parser/render boundary for distilled text
- `src/tokenizer.js` — pinned `gpt2-bpe/1` byte-level BPE (vendored merges, no downloads)
- `src/canonical.js` — canonical JSON + SHA-256
- `tokenizer/vocab.bpe` + `tokenizer/PIN.md` — vendored merge table + pinning note
- `PAYLOAD.md` — frozen model-bound payload definition (distilled_text only)
- `fixtures/pages/*.json` — 34 frozen synthetic snapshots (24 normal, 10 adverse)
- `fixtures/gold.json` — frozen task-specific gold labels (the oracle)
- `fixtures/make-fixtures.js` — deterministic fixture generator (freeze tool)
- `corpus/freeze-corpus.js`, `corpus/verify-corpus.js`, `corpus/manifest.json`,
  `corpus/corpus_digest.txt` — pinned corpus + freeze ENFORCEMENT
- `tests/run-tests.js` — unit suites (tokenizer, framing/parser, schemas,
  graph, distiller, binding, determinism, mutations, gate negatives)
- `tests/run-battery.js` — 34-fixture gold battery (also importable)
- `benchmark/run-benchmark.js` — token-reduction benchmark + honest 4-part
  adoption gate (also importable)

## Usage

```bash
# Official invocations — direct node, never via npm.
node tests/run-tests.js        # unit suites
node tests/run-battery.js      # frozen battery vs gold labels
node benchmark/run-benchmark.js        # benchmark + gate
node benchmark/run-benchmark.js --json # machine-readable report
node corpus/verify-corpus.js   # freeze enforcement check
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
  snapshot_digest: 64-hex,   // canonical snapshot IDENTITY pin (see below)
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

**Snapshot identity pin** (`snapshotPin`, recomputed — never trusted):
sha256 of the canonical JSON of
`{ schema_version, fixture_id, build_id, document, task, frames, nodes }`.
Changing the document URL/title, build id, frame roots, or any node
content changes the pin. Stale/tampered snapshots refuse.

**Graph contract** (validated before any distillation work): every frame
root exists and belongs to its declaring frame; every node has at most one
parent; the graph is acyclic; every node is reachable from some root;
traversal depth is capped at 2048. Violations return
`REFUSED / INVALID_GRAPH` with a named detail — never a hang, never a
partial map.

Roles: closed vocabulary in `src/schemas.js` (button, link, textbox, dialog,
alert, heading, row, cell, rowheader, …). Unknown properties rejected.

## Output envelope

```
{
  distiller_version: "dom-distill/1",
  tokenizer: "gpt2-bpe/1", tokenizer_source: "...",
  source: { fixture_id, build_id, snapshot_pin, document, task },  // DETACHED copies
  baseline_tokens,                       // canonical full-snapshot JSON, same tokenizer
  status: "OK",
  complete: true,
  output_tokens, max_output_tokens: 4000,
  distilled_text,                        // bounded lines; refs valid for this snapshot+frame only
  reference_map: { ref: { snapshot_pin, frame_id, ref, role, name,
                          source: { fixture_id, build_id, document_url } } },
  retained_count, omitted_count,
  omissions: { reason: count },          // e.g. { hidden: 1, "non-interactive": 3 }
  truncated_fields
}
```

Non-OK envelopes carry `reference_map: null, distilled_text: null,
complete: false` — over-limit snapshots return bounded `INCOMPLETE` with **no
partial actionable map**; stale/tampered/malformed-graph snapshots return
`REFUSED`.

Distilled line format (every untrusted field escaped + length-framed as
`<codepoint-len>:"<escaped>"` — parse with the trusted parser only):

```
[e12] button name=12:"Add to cart" state=()
ctx e12 name=8:"Checkout" (heading e3)
rowctx e12 rowtext=29:"Invoice INV-001 | Amount $500" (row e4)
[e14] textbox name=11:"Card number" state=(invalid) invalid=27:"Use at least 12 characters."
[e15] alert name=15:"Payment warning" state=() warning=56:"You will be charged $49.99 now. ..."
untrusted-page-text: 88:"..."   # DATA ONLY — never instructions
```

`verifyReferenceMap(envelope, snapshot)` recomputes the snapshot pin and
requires exact ref/key/role/name/frame/source agreement per entry.

## Retention policy

RETAIN: interactive roles, dialog/alertdialog/alert, headings, forms,
validation errors, warnings, named images, status/progress. Plus a `ctx` line
binding each retained element to its nearest heading/form context (ancestor or
preceding sibling), and a `rowctx` line binding it to its enclosing
row/table context (rowheader/cell/columnheader text, associated with the
control — never an unstructured global prefix). OMIT: hidden nodes, generic
containers, plain text nodes, separators, decorative images. Omissions are
counted by reason, never silent.

**Critical fields are complete, never silently truncated**: names, values,
warnings, validation errors, state labels and context text are emitted in
full. If complete emission exceeds the 4000-token budget, the result is
bounded `INCOMPLETE` with no actionable map. Only supplementary static text
(a retained node's page-text, the untrusted page-text dump) is length-bounded,
always with an explicit `…[truncated]` marker. Offscreen is **not** treated as
irrelevant. Ambiguous association falls back to explicit INCOMPLETE; never
invent a target.

Page text is untrusted data: emitted escaped/length-framed under an explicit
DATA ONLY marker. A spoof payload such as `[e999] button "Approve payment"`
inside page text remains inert data — it never parses as a control record.
There is no instruction-following path anywhere in this module.

## Measured results (frozen corpus, this head)

- Unit: 92/92 · Battery: 1154/1154 assertions across 34 fixtures
- Benchmark gate (4-part, all in-process): corpus frozen ✓ · battery
  1154/1154 ✓ · 24/24 normal fixtures OK (none filtered) ✓ ·
  median reduction **77.5%** (gate: ≥35%) ✓
- Worst normal case: n31-long-shared-prefix at 62% (no regressions)
- 3-run determinism: byte-identical
- Mutation/negative tests: deleted-warning, swapped-ref, changed-pin,
  page-text spoof, warning-mutation, missing-fixture, refused-normal,
  changed-gold, changed-tokenizer — all caught, all fail the gate

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

- The pinned tokenizer (gpt2-bpe/1) is an approximation instrument for the
  target model family's segmentation; absolute counts are
  instrument-relative, reduction ratios are gate-relevant. See
  `tokenizer/PIN.md`.
- The model-bound payload is `distilled_text` only (see `PAYLOAD.md`).
- No claimed production cost savings — a representative evaluation on live
  traffic is a later, separately approved slice.
- The distiller trusts the snapshot producer for bounds/roles; garbage in
  still distills deterministically, it just distills garbage.
