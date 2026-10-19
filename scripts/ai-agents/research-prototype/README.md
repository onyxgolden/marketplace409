# Research Agent — Phase 2 slice 1 prototype

Synthetic claim-by-claim attribution over preloaded registered passages.
Pure Node 24 ESM, zero runtime dependencies, zero model calls, offline,
fixture-only. All documents, passages, figures and claims are invented.
Output is an advisory attribution report — never a real-world truth
assertion.

## What it does

`run(task, context)` evaluates each requested atomic claim against a
closed-world evidence bundle:

- **Fidelity** — the claim's structured fields (subject, predicate, typed
  value, scope, polarity) match a verified assertion in a declared origin
  passage, byte-exact. Origin absent or embellished ⇒ `NOT_FAITHFUL`.
- **Corroboration** — a *distinct* verified passage carries the same
  assertion as underlying content, in a *different* host-registered
  provenance group, with no derivation/copy link to the origin. Citation
  pointers, self-certifications, authority labels and citation cycles
  contribute zero corroboration. Unknown independence ⇒ `UNCORROBORATED`.
- **Contradiction** — same subject/predicate/scope and value type, with a
  differing typed scalar value or opposite polarity. Different scope or
  different value type is not a conflict. Every supporting and opposing
  passage is preserved; the agent never picks a winner.
- **Status precedence** — `contradicted` > `supported` > `attributed-only`
  > `unsupported`. Fidelity and corroboration axes are exposed
  independently even when contradicted. "Supported" means supported within
  this synthetic bundle, never world truth.

Structural failures (malformed bundles, bad pins, denied grants,
over-budget populations) refuse with a named code and `report:null` —
never a partial domain artifact. A quarantined instruction passage cannot
support a claim; unaffected verified passages remain explicit with
`complete:false` where coverage changed. An assertion whose byte span
fails verification is excluded from evidence (diagnostic
`SPAN_MISMATCH`); affected claims are unverified, never faithfully
attributed.

## The fixture grammar

Passages carry controlled assertion text, the deliberate bounded
extraction language (not general NLP):

```
subject | predicate | value | scope
```

prefixed with `NOT ` for negative polarity. Values render canonically:
numbers in JSON number form, strings JSON-quoted, booleans bare.
Non-English tokens match exactly — no translation or Unicode
normalization is ever invented. The agent reconstructs this text from the
structured fields and proves the passage bytes equal it; it never trusts
a fixture-carried quote string.

## Candidate taxonomy (budget discipline)

One monotonic budget per invocation: **64 consulted candidates**,
**512 span checks**, **256 output records**, **256 KiB aggregate input**,
**256 KiB output**, depth 32, 5 seconds per task.

Every candidate is charged **before** its fields are read. Attempt 65
refuses with `BUDGET_EXCEEDED` before that candidate — or any later
candidate — is inspected at all:

| Candidate | Charged |
|---|---|
| Every object/array in `task` (admission walk) | once each, before descriptor inspection |
| Every object/array in `context`: sources, revisions, read grants, principal, criteria, provenance-registry entries, derivation links | once each, before field reads |
| The resolved evidence-bundle source | once, at resolve time |
| Each document record | once, before its span is decoded |
| Each `passages`, `assertions`, `citations` array | once, before iteration |
| Each passage, assertion, citation, assertion span object | once, before field reads |
| Each document-record span and assertion-span verification | one span check each |

Re-reading an already admitted immutable record does not create a second
record, but a new consultation/returned object is not free. No dedup
refunds after a charge. Arrays cannot hide long primitive ID lists:
`origin_passage_refs`, `atoms`, `citations` and `derivation_links` are
length-bounded and every element is a charged candidate.

Output accounting walks the exact final envelope with one bounded,
cycle-safe record walk (`countFinalEnvelopeRecords` in `src/index.js`),
implementing the brief's public-record taxonomy — every record counted
once per emitted occurrence:

| Record | Where it is counted |
|---|---|
| report record | the `report` object itself |
| item records | each `report.claims[]` element |
| nested basis records | each claim's `atom` and `origin` |
| citation records | every emitted `citation` |
| span records | every `span` nested in a citation |
| source-ref records | every emitted `source_ref` (nested and top-level) |
| resource records | each corroboration `evidence` / `same_group_occurrences` / `unregistered_candidates` / `derivation_linked_candidates` / `cycle_defeated_candidates` entry |
| conflict records | each `contradictions[]` entry |
| completeness record | `report.coverage` |
| summary record | `report.summary` (when non-null) |
| exclusion records | each `quarantined_sources[]` entry |
| diagnostic records | each `diagnostics[]` entry |

Scalars and collection arrays are not records; internal work objects
are never counted. Shared/cyclic references are visited once, so the
walk terminates and cannot inflate the count. Overrun returns bounded
`REFUSED`, `complete:false`, `report:null`, with a bounded safe
`task_id` and no partial domain artifact.

Every guard/transport/boot/worker-error/cleanup refusal uses the same
bounded null-report contract (`REFUSED`, `complete:false`,
`report:null`) — no envelope carries an empty domain report object.

The 64-object input budget makes 256 natural output records unreachable,
so the output-record counter accepts a host-prefilled base through the
explicitly validated, closed-schema `context.test_hooks.
prefill_output_records` field (0..1024). It is inert in production —
hosts never set it — and exists only for the 256-allowed / 257-refused
boundary test through the real `run()` path.

## Layout

- `src/` — `index.js` (`run(task, context)`), `research.js` (attribution
  engine), `schemas.js` (runtime validation), `resolver.js` (fixture
  Git-object resolution + per-task budget), `injection.js` (seeded
  directive families), `canonical.js` (canonical JSON, hashes).
- `fixtures/` — `make-fixtures.js` (authoring tool) + `store.json`
  (trusted fixture Git-object store: 37 invented bundles).
- `corpus/` — `make-battery.js` (authoring tool with an independent
  clean-room oracle) + `battery.json` (120 frozen cases) +
  `research-training-pairs.json` (frozen paired fixture for the Research
  Training agent: one minimal case per research status; vendored as
  pinned bytes, no runtime dependency) + `manifest.json` /
  `corpus_digest.txt` (trust pins).
- `runner/run-manual.js` — manual host launcher (not scored).
- `runner/run-guarded.js` — external 5-second watchdog (worker thread,
  inert serialized JSON transport). JSON-only: no executable task
  factories, no eval (RA652-001).
- `runner/timeout-hang-worker.js` — fixed hang fixture for timeout
  probes, selectable only through the closed enum in
  `tests/timeout-probe-host.js` (test-only host, outside the production
  API).
- `tests/` — `node:test` suites + `run-tests.js` / `run-battery.js`
  trust-gated entrypoints (invoked via the separately trusted
  bootstrap; see Trust chain).

## Running

```sh
# Freeze/verify the corpus (authoring)
node fixtures/make-fixtures.js
node corpus/make-battery.js
node corpus/freeze-corpus.js   # writes manifest.json + corpus_digest.txt

# Scored runs (need the externally supplied approval root).
# The npm scripts invoke the separately trusted bootstrap at
# /home/hatch/workspace/research-prototype-trust/bootstrap.js, which
# authenticates every byte (and the manifest itself) against the
# approved root BEFORE any candidate byte executes. Direct invocation:
#   RESEARCH_APPROVED_ROOT=<digest> node /home/hatch/workspace/research-prototype-trust/bootstrap.js <repo-dir> tests
RESEARCH_APPROVED_ROOT=<digest> npm test
RESEARCH_APPROVED_ROOT=<digest> npm run battery
```

## Trust chain

`npm test` / `npm run battery` never execute in-repo bytes first: the
package scripts invoke the small builtins-only bootstrap in the
separately trusted directory
`/home/hatch/workspace/research-prototype-trust/` (outside the repo,
never modified by the PR). The bootstrap pins the approved root from
its own `approved-root.txt` (must match `RESEARCH_APPROVED_ROOT`),
authenticates every manifest-listed byte, rejects unlisted files,
nested helpers and symlinks, authenticates the manifest digest itself,
rejects npm lifecycle hooks, and only then spawns the in-repo
launcher. Prepend/top-of-file marker canaries against both official
entrypoints and the runtime/watchdog chain are covered by
`tests/trust.test.js`.

## Grant before bytes

`run()` admits the context in two phases: the grant gate inspects only
bounded grant/principal/control metadata, the denied-source read grant
is checked next, and only after an exact grant succeeds are the
selected source/revision and the required provenance metadata admitted.
Non-selected sources are never inspected. A denied source's revision
metadata and payload remain untouched (see the RA652-006 sentinels in
`tests/execution-addendum.test.js`).

## Boundaries

The agent reads only registered invented fixtures through the scoped
resolver. It cannot browse, retrieve, publish, send, execute, spend,
approve, or touch real data. Unsupported freeform paraphrase yields
`UNVERIFIABLE_ATTRIBUTION`-style `unsupported`, never confident semantic
inference. Advisory output satisfies no authorization gate.
