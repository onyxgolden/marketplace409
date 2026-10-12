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
  steward validity, action authorization (`supersede`), **authority scope
  coverage (EVERY record scope must fall inside the steward's authority —
  one overlapping token never authorizes a mixed-scope record)**,
  **exact registration applicability (the record's scopes and old/new
  source keys must fall inside the registration's declared
  `applicability`, AND the record's exact old/new pins must match one of
  the registration's declared `transitions` — source keys alone never
  authorize an arbitrary revision pair)**, both pin verifications (Git
  blob SHA-1 recomputed with the blob header), and read permission, with
  the read grant checked BEFORE either pin is resolved (a denied pin's
  bytes are never inspected, not even to hash them). No source-internal
  chain fallback, no commit-order heuristic, no revision-name authority.
  Forks and broken chains retain uncertainty — never a claim of current
  policy.
- Emits each claim **only if EVERY one of its scopes is covered by the
  effective emission grant**: the intersection of (a) the applied
  records' issuers' steward authority, (b) the trusted registrations'
  `applicability` scopes, and (c) the applied records' scopes across the
  selected transitions. Principal capability is not the scope of a
  particular supersession: a fact inside the steward's broader authority
  but outside the record or its registration is excluded in full, never
  quoted with `HIGH` (excluded claims raise `SCOPE_NOT_COVERED`, a
  coverage gap). A mixed-scope fact naming both a covered and an
  uncovered scope is excluded in full.
- Returns claims as **exact quoted extracts** with `SourceRef` citations
  (`quoted_span` === `span.quoted_text`, byte offsets verified against
  source bytes). Source facts are parsed from a bounded exact-text
  fixture grammar; a candidate's metadata is never trusted as truth.
  **Claim IDs are unique and stable per fact** (query key + source key +
  commit + exact fact line); byte-identical duplicate lines dedupe to one
  claim, conflicting facts never dedupe.
- Detects contradictions (same claim key, overlapping scopes, same units,
  different values) **across and within sources** and cites both exact
  spans. **Degraded (unspecified-units) claims never contradict** a
  measured claim. Multiple contradictions never collapse: pair identity
  is per fact pair. A contradiction forces `LOW` with no asserted winner.
- Explicit `source_pin` selects the pinned revision **exclusively**
  (ignores `as_of_date`), but pin integrity identifies content, not
  present applicability: a pin to a future-effective revision is labeled
  uncertain (`FUTURE_EFFECTIVE`, `LOW`), never `HIGH`/current.
- Quarantines sources containing seeded directive content; quarantined
  sources can never support claims, but clean independent evidence may
  still answer. Query-embedded directives and non-`answer` actions are
  refused (`INSTRUCTION_INJECTION` / `ACTION_DENIED`).
- Confidence: `HIGH` (all claims verified, effective, readable, within age
  limit, no conflict, no coverage gaps), `MEDIUM` (explicitly partial
  coverage), `LOW` (staleness, ambiguity, conflict, unverifiable
  annotations, **or any relevant coverage gap — stale/ambiguous evidence,
  scope-excluded claims, future-effective pins, relevant hash/span/schema
  verification failures — even when another supported claim survives**).
  No verifiable claims → `UNVERIFIABLE`, never a fabricated answer.
- `complete` is accurate, not status-derived: true only when the answer
  is `ANSWERED` with zero contradictions and zero coverage-gap
  diagnostics.
- Source age comes from authenticated effective/verification ledger times,
  never file mtime; **ledger dates are runtime-validated** (invalid or
  missing dates → `REFUSED / INVALID_INPUT`, never a NaN bypass). Every
  selected source and span is re-verified on every answer; there is no
  persistent cache.
- **Budgets cover everything consulted**: every vocabulary phrase, source
  entry, revision ledger entry, grant, steward, registration, record,
  revision scan, and payload byte is charged BEFORE use. **Registry
  metadata payload bytes are accounted before validation** (source text
  excluded without being read); a single huge string inside an otherwise
  valid registration trips `INPUT_LIMIT`. **Source text is
  never accessed without a read grant** — relevance of denied sources is
  decided from adapter-supplied `claim_keys` metadata only; denied bytes
  are never parsed, scanned, quoted, or hashed (supersession pins check
  the grant before resolving). Any budget breach
  (`INPUT_LIMIT` / `BUDGET_EXCEEDED`) refuses with `complete: false` and
  no partial answer — `BudgetError` is never converted into a domain
  diagnostic.

## Layout

- `src/` — `index.js` (entry), `schemas.js` (runtime validation),
  `resolver.js` (Git-object resolution, span verification, budgets),
  `vocabulary.js` (bounded query mapping), `supersession.js` (steward
  authentication, effective-revision selection), `retriever.js` (claim
  extraction, filters, contradictions, confidence), `injection.js`
  (seeded-family recognizer), `canonical.js`, `markdown.js`.
- `fixtures/` — `store.json` (27 synthetic sources, 12 supersession
  records, steward registrations with exact applicability, read grants),
  `vocabulary.json` (22 query keys), `make-fixtures.js` (deterministic
  authoring tool).
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
- Bounded vocabulary: only the 22 fixture query keys are answerable.
- Advisory output only: `advisory: true`, `fixture_only: true`; the
  output is never an execution token and satisfies no gate by itself.
- Injection defense is structural (no write/tool capabilities,
  allowlists, quarantine), not a claim of universal attack detection.
- Latency numbers are measured on the documented machine for the frozen
  120 cases; no production SLA is stated or implied.
