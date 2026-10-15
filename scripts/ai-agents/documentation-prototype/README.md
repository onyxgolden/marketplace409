# Documentation agent — Phase 2 slice 1 synthetic prototype

Deterministic documentation-vs-code drift detector over synthetic fixture
sources only. Emits an inert per-claim proposal JSON plus a Markdown
reviewer preview (before / after / citation / coverage). Advisory only:
no live activation, no doc writes, no model calls, no network.

## What it does

`run(task, context) -> result` (see `src/index.js`):

- Accepts `{repo, doc_ref, code_refs, claim_specs, requested_action:
  "propose"}`. Any other `requested_action` (`apply`, `commit`, `merge`,
  …) is refused (`ACTION_DENIED`); the prototype proposes inert diffs
  only and can never apply, commit, merge, deploy or approve anything.
- Resolves every `SourceRef` through the fixture Git object store:
  commit must be registered, and the Git blob SHA-1 is recomputed with
  the blob header and compared to the pinned blob. Read grants are exact
  `repo|path`; a missing grant → `BLOCKED / READ_DENIED`. Missing
  mandatory evidence (empty `code_refs`, unregistered commit) → `BLOCKED`.
  Malformed pins (abbreviated/non-hex) → `REFUSED / INVALID_INPUT`.
- Verifies each claim's `doc_span` by exact UTF-8 byte search against the
  pinned doc bytes; a mismatch excludes the claim (`SPAN_MISMATCH`).
- Extracts behavior values deterministically from the bounded fixture
  code grammar (fgv1) **plus registered usage context**:
  `retry-limit` (`MAX_RETRIES` + `retry_queue.configure(...)`),
  `holdback-pct` (`HOLDBACK_PCT` + `apply_holdback(...)`),
  `rounding-mode` (`ROUNDING_MODE` + `set_rounding(...)`),
  `feature-flag:<name>` (`FEATURE_FLAGS` + `is_enabled("<name>")`),
  `status-map` (`STATUS_MAP` + `STATUS_MAP[code]`).
  Unknown behavior or grammar → `UNVERIFIABLE`.
- A bare/dead constant, comment, test expectation alone, or arbitrary
  caller annotation never proves production behavior: a declaration with
  zero production usage spans → `DEAD_CONSTANT`; a usage that does not
  attribute to the declared constant → `AMBIGUOUS_USAGE`. Caller-supplied
  `code_span_ids` are hints only — each must resolve to a derived
  evidence span or the claim is excluded; `required_usage_span_ids` must
  all resolve to usage spans of the same behavior.
- Versioned v1/v2 code: complete path selection must be established;
  conflicting active paths are retained, never averaged (`PATH_CONFLICT`).
- Compares the documented value (parsed from the verified doc span)
  against the effective code value. Equal → `SUPPORTED`; different →
  `DRIFTED` with `before`/`after` (the doc's value phrase replaced by the
  code value rendered per behavior).
- Builds `proposed_diff` as **inert text**: hunks over the pinned doc
  lines (`before`/`after` line arrays), merged per doc line, replacements
  applied in descending byte order. No drift → empty diff with explicit
  `no_change: true`, zero inferred claims. The diff is never applied to
  real files; the host test validator may apply it to an in-memory
  fixture copy and verify only cited spans changed.
- Seeded injection families (`src/injection.js`): SEC-002 forged
  compliance/certification claims, SEC-003 instruction directives,
  SEC-004 live-mutation directives, SEC-005 self-approval. Task-level
  injection → `REFUSED`; injected fixture sources are quarantined and can
  never support claims (clean independent evidence may still support
  unaffected claims when completeness is explicit). Zero compliance
  claims are ever emitted.
- Status: `READY` (all emitted claims supported/drifted, diff exact),
  `BLOCKED` (missing/read-denied evidence), `UNVERIFIABLE` (requested
  coverage not achieved), `REFUSED` (malformed/prohibited/injection).
  `complete` is true only for `READY` with full coverage.
- Budgets per task: 256 KiB payload, 64 object resolutions, 512 span
  checks, 256 output records / 256 KiB output; breach → `INPUT_LIMIT` /
  `BUDGET_EXCEEDED` with no partial success. Host watchdog 5 s/task.

## Layout

- `src/` — `index.js` (entry), `schemas.js` (runtime validation),
  `resolver.js` (Git-object resolution, span verification, budgets),
  `extraction.js` (fixture grammar + behavior value extraction),
  `detector.js` (drift pipeline, inert diff builder, reviewer preview),
  `injection.js` (seeded-family recognizer), `canonical.js`, `markdown.js`.
- `fixtures/` — `gen.js` (deterministic authoring, shared by the
  fixture and battery builders), `make-fixtures.js`, `store.json`
  (264 synthetic doc/code sources).
- `corpus/` — `battery.json` (200 frozen cases), `make-battery.js`
  (authoring tool with hand-derived expectations), `freeze-corpus.js`,
  `manifest.json`, `corpus_digest.txt`.
- `runner/` — `run-manual.js` (single manual proposal run),
  `measure-latency.js` (manual latency measurement; manual runs only,
  no production SLA claimed).
- `tests/` — `run-tests.js` / `run-battery.js` (builtins-only trust
  launchers authenticating `DOC_APPROVED_ROOT` before any scored import),
  unit tests, `harness.js` (manifest verification, structural projection,
  host-side diff-bound validator), `watchdog.js`, `case-worker.js`.

## Corpus (200 cases)

| Category | n | Expected |
|---|---|---|
| evidenced-drift | 40 | READY, DRIFTED, exact diff |
| no-change | 40 | READY, SUPPORTED, empty diff |
| dead-ambiguous-version | 40 | UNVERIFIABLE (dead constant / ambiguous usage / v1-v2 conflict) |
| pins-malformed-diffbounds | 40 | BLOCKED/REFUSED/UNVERIFIABLE + 10 host-validated diff bounds |
| compliance-injection | 20 | REFUSED or quarantined exclusion; zero compliance claims |
| live-mutation-self-approval | 20 | REFUSED ACTION_DENIED |

Acceptance: 100% expected status, zero uncited claims, 100% seeded
SEC-002 exclusion/refusal, every READY diff applies to the exact fixture
doc changing only cited lines, zero source writes, wrong result-head /
self-issued approval rejected, repeated scans byte-identical.

## Examples

```js
import { run } from "./src/index.js";
const result = run(
  {
    repo: "forge",
    doc_ref: { repo: "forge", path: "runbooks/drift-1.md", commit: "<40-hex>", blob: "<40-hex>", algorithm: "git-sha1", revision: "fixture-rev-1" },
    code_refs: [ /* ... */ ],
    claim_specs: [{
      claim_id: "dd-claim-1",
      doc_span: { quoted_text: "The invoice client retries failed submissions up to 5 attempts.", start_byte: 66, end_byte: 129 },
      behavior_key: "retry-limit",
      code_span_ids: ["decl:MAX_RETRIES@v1", "usage:retry-limit@v1"],
      required_usage_span_ids: ["usage:retry-limit@v1"],
    }],
    requested_action: "propose",
  },
  context // host adapter: clock, store, readGrants
);
// result.status === "READY", claims[0].support_status === "DRIFTED",
// proposed_diff.hunks -> the single cited doc line, inert text.
```

```bash
# Manual single-proposal run against the fixtures:
node runner/run-manual.js D-drift-1 C-drift-1 retry-limit
# Full battery (trust-authenticated — approval root from OUTSIDE the tree):
DOC_APPROVED_ROOT=<separately-trusted-corpus-digest> npm run battery
# Unit tests (trust-authenticated):
DOC_APPROVED_ROOT=<separately-trusted-corpus-digest> npm test
```

> Trust model (DOC-002): the corpus approval root is never stored in this
> tree. `npm test` / `npm run battery` fail closed (exit 3) when
> `DOC_APPROVED_ROOT` is absent or does not match the recomputed corpus
> digest. After any corpus change, run `node corpus/freeze-corpus.js` and
> record the printed digest externally as the new trusted root.

## Limitations

- Fixture-only: docs, code, pins and grants are synthetic. Commit IDs are
  deterministic fixture identifiers, not real Git commits. Mock trusted
  registration is labeled simulated by the contract; no production
  identity or signing security is claimed.
- Bounded behaviors: only `retry-limit`, `holdback-pct`,
  `rounding-mode`, `feature-flag:<name>`, `status-map` are extractable
  from the fgv1 fixture grammar; everything else is `UNVERIFIABLE` by
  design, never guessed.
- Advisory output only: `advisory: true`, `fixture_only: true`; the
  output is never an execution token and satisfies no gate by itself.
- Injection defense is structural (no write/tool capabilities,
  allowlists, quarantine), not a claim of universal attack detection.
- Latency numbers are measured on the documented machine for the frozen
  200 cases; no production SLA is stated or implied.
