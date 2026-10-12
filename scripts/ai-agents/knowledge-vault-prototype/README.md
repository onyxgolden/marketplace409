# Knowledge Vault agent — Phase 2 slice 1 synthetic prototype

Permission-filtered deterministic retrieval and extractive answers from
fixture Git sources only. Advisory only: no live activation, no knowledge
writes, no model calls, no network.

## What it does

`run(task, context) -> result` (see `src/index.js`):

- Maps a natural-language query through a **bounded fixture vocabulary**
  to a `query_key`. Unmapped text → `REFUSED / UNSUPPORTED_TASK`;
  ambiguous text → `UNVERIFIABLE` with a clarification diagnostic. Nothing
  is guessed.
- Selects the effective source revision **only through registered
  supersession records** authenticated against steward registrations:
  steward validity, action authorization (`supersede`), authority scope,
  both pin verifications (Git blob SHA-1 recomputed with the blob header),
  and read permission. No source-internal chain fallback, no commit-order
  heuristic, no revision-name authority. Forks and broken chains retain
  uncertainty — never a claim of current policy.
- Returns claims as **exact quoted extracts** with `SourceRef` citations
  (`quoted_span` === `span.quoted_text`, byte offsets verified against
  source bytes). Source facts are parsed from a bounded exact-text
  fixture grammar; a candidate's metadata is never trusted as truth.
- Detects contradictions (same claim key, overlapping scopes, same units,
  different values) and cites both exact spans.
- Quarantines sources containing seeded directive content; quarantined
  sources can never support claims, but clean independent evidence may
  still answer. Query-embedded directives and non-`answer` actions are
  refused (`INSTRUCTION_INJECTION` / `ACTION_DENIED`).
- Confidence: `HIGH` (all claims verified, effective, readable, within age
  limit, no conflict), `MEDIUM` (explicitly partial coverage), `LOW`
  (staleness, ambiguity, conflict, or unverifiable annotations). No
  verifiable claims → `UNVERIFIABLE`, never a fabricated answer.
- Source age comes from authenticated effective/verification ledger times,
  never file mtime. Every selected source and span is re-verified on every
  answer; there is no persistent cache.

## Layout

- `src/` — `index.js` (entry), `schemas.js` (runtime validation),
  `resolver.js` (Git-object resolution, span verification, budgets),
  `vocabulary.js` (bounded query mapping), `supersession.js` (steward
  authentication, effective-revision selection), `retriever.js` (claim
  extraction, filters, contradictions, confidence), `injection.js`
  (seeded-family recognizer), `canonical.js`, `markdown.js`.
- `fixtures/` — `store.json` (17 synthetic sources, 9 supersession
  records, steward registrations, read grants), `vocabulary.json`
  (13 query keys), `make-fixtures.js` (deterministic authoring tool).
- `corpus/` — `battery.json` (120 frozen cases), `make-battery.js`
  (authoring tool), `freeze-corpus.js`, `manifest.json`,
  `corpus_digest.txt`.
- `runner/` — `run-manual.js` (single manual query runner),
  `measure-latency.js` (manual latency/corpus-size measurement; manual
  runs only, no production SLA claimed).
- `tests/` — `run-tests.js` / `run-battery.js` (builtins-only trust
  launchers authenticating `KV_APPROVED_ROOT` before any scored import),
  unit tests, `harness.js`, `watchdog.js`, `case-worker.js`.

## Examples

```js
import { run } from "./src/index.js";
const result = run(
  { query: "What is the wifi password?", query_key: null,
    filters: { source_tags: [], max_source_age_days: null, as_of_date: null },
    requested_action: "answer" },
  context // host adapter: clock, vocabulary, sources, readGrants,
          // stewards, registrations, supersessionRecords
);
// result.status === "ANSWERED", result.confidence === "HIGH",
// result.claims -> exact quoted extracts with VERIFIED citations.
```

```bash
# Manual single-query run against the fixtures:
node runner/run-manual.js "What are the parking rules?" --tags official
# Manual latency measurement (manual runs only):
node runner/measure-latency.js /tmp/kv-latency.json
```

## Limitations

- Fixture-only: sources, stewards, records and the vocabulary are
  synthetic. Commit IDs are deterministic fixture identifiers, not real
  Git commits. Mock trusted registration is labeled simulated by the
  contract; no production identity or signing security is claimed.
- Bounded vocabulary: only the 13 fixture query keys are answerable.
- Advisory output only: `advisory: true`, `fixture_only: true`; the
  output is never an execution token and satisfies no gate by itself.
- Injection defense is structural (no write/tool capabilities,
  allowlists, quarantine), not a claim of universal attack detection.
- Latency numbers are measured on the documented machine for the frozen
  120 cases; no production SLA is stated or implied.
