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
| Every object/array in `context`: sources, revisions, read grants, principal, criteria, provenance-registry entries, derivation links, `applies_to` pins | once each, before field reads |
| Admitted context/registry metadata bytes (grant fields, source keys, revision metadata, registry entries incl. `applies_to` pins) | serialized (canonical JSON) bytes via `countSerialized` — structure, key names, escaping and all SourceRef/SHA-256 fields; never raw string lengths |
| The resolved evidence-bundle source | once, at resolve time (text bytes; metadata counted above — nonduplicating) |
| Each document record | once, before its span is decoded |
| Each `passages`, `assertions`, `citations` array | once, before iteration |
| Each passage, assertion, citation, assertion span object | once, before field reads |
| Each document-record span and assertion-span verification | one span check each |

Re-reading an already admitted immutable record does not create a second
record, but a new consultation/returned object is not free. No dedup
refunds after a charge. Arrays cannot hide long primitive ID lists:
`origin_passage_refs`, `atoms`, `citations` and `derivation_links` are
length-bounded and every element is a charged candidate.

Output accounting walks the exact final envelope with one bounded
record walk (`countFinalEnvelopeRecords` in `src/index.js`),
implementing the brief's public-record taxonomy — every record counted
once per emitted occurrence. Fix round 3: the walk runs over the
SERIALIZED envelope (canonical JSON parsed back), not the live object
graph. The live graph may share citation / source_ref / span objects
across claims (one origin citation referenced from several claims);
serialization emits each occurrence separately, so the walk counts
per-occurrence — an identity-deduplicated walk undercounts the actual
public records. Unserializable (cyclic) input fails closed to
+Infinity, which becomes an `OUTPUT_LIMIT` refusal:

| Record | Where it is counted |
|---|---|
| report record | the `report` object itself |
| item records | each `report.claims[]` element |
| nested basis records | each claim's `atom` and `origin` |
| citation records | every emitted `citation` |
| span records | every `span` nested in a citation |
| byte-identity records | every emitted `citation.byte_identity` (PER-010 fix: previously omitted) |
| source-ref records | every emitted `source_ref` (nested and top-level) |
| resource records | each corroboration `evidence` / `same_group_occurrences` / `unregistered_candidates` / `derivation_linked_candidates` / `cycle_defeated_candidates` entry |
| corroboration records | each claim's `corroboration` object itself |
| conflict records | each `contradictions[]` entry |
| completeness record | `report.coverage` |
| summary record | `report.summary` (when non-null) |
| exclusion records | each `quarantined_sources[]` entry |
| diagnostic records | each `diagnostics[]` entry |

Scalars and collection arrays are not records; internal work objects
are never counted. The parsed serialized tree is acyclic by
construction, so the walk terminates; a node cap aborts pathological
input to +Infinity (fail-closed). Overrun returns bounded
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

## Fix round 4: carried EXEC652 findings

**Pinned citation byte identity (EXEC652-001).** An emitted citation's
`span` addresses the *passage* bytes — never the bundle bytes named by
`source_ref` (which is provenance: the registered bundle the passage
was extracted from). Every citation carries `byte_identity`
`{algorithm:"sha256", digest, byte_length}`: the SHA-256 of the exact
passage UTF-8 bytes the span was verified against. Independent
verification: resolve the bundle via `source_ref`, locate the passage,
check `sha256(passage bytes) == byte_identity.digest`, then slice
`[start_byte, end_byte)` and require the exact `quoted_span`. The
canonical claim key (`makeCanonicalKey` in `src/research.js`) binds the
atom, the origin reference, the consumed bundle's git-sha1 pin, the
passage SHA-256 and the span — a changed source identity can never
silently retain the prior canonical identity; a byte-identical replay
stays stable.

## Slice 3: bounded-report-completion repairs (PER-008, PER-010,
2026-10-21 retrospective audit)

**Trap-free candidate admission (PER-008).** Every consulted host
object is Proxy/accessor/function/symbol/prototype/depth-checked per
object and charged BEFORE its fields are read — the uncharged
recursive preflight sweep over unknown subtrees is removed, so an
over-budget child (e.g. an accessor sentinel at candidate 79) refuses
`BUDGET_EXCEEDED` at candidate 65 with zero descriptor visits or
getter invocations.

**Complete output counting (PER-010).** The output walk's record
taxonomy now includes every emitted `citation.byte_identity` record
(see the taxonomy table above). The corrected natural counts: the
single-passage 1-claim envelope counts 12 public records, the
contradiction envelope 16.

**Exact-source provenance applicability (EXEC652-002).** Every
provenance-registry entry declares `applies_to`: the complete source
pins (`SourceRef` tuples) the registration is valid for. `run()` admits
only entries whose `applies_to` includes the actually consumed bundle
pin; a reused `doc_id|passage_id` under a changed repo, path, commit,
blob, algorithm or revision finds no applicable entry and keeps
conservative unregistered treatment (unknown independence ⇒
`UNCORROBORATED`, never independent). Derivation/transitive-copy
positives are preserved when the pins match. Per-run host builders bind
each evaluation's entries to the evaluated bundle's exact pin (the
fixture store keeps the full multi-bundle master record).

**Trap-free Proxy rejection + serialized accounting (EXEC652-003).**
`types.isProxy` (a native V8 map check — zero trap invocations, verified
by instrumented-trap tests) runs before every reflective operation:
the task is swept before admission, the context top-level before the
clock read, and each admitted subgraph (grants/principal/criteria,
selected source entry, provenance registry) at its own admission point.
A native Proxy anywhere in the admitted graph refuses `INVALID_INPUT`
with zero trap executions — top-level, nested, or selected-source.
(Denied source entries stay completely untouched pre-grant, RA652-006:
only a shallow map-level check runs before the grant gate.) Aggregate
metadata accounting uses `budget.countSerialized`: admitted
context/registry metadata (keys, structure, JSON escaping, all
SourceRef/SHA-256 fields) is charged in canonical-JSON serialized
bytes — never selected raw string lengths — under the single 256-KiB
serialized representation. A source resolved twice is charged twice
(cumulative; no dedup refunds).

**Empty source preserves requested claims (EXEC652-005).** An empty
bundle returns `EMPTY` with zero extracted claims *and* each requested
atom reported `NOT_FAITHFUL` / `UNCORROBORATED` / `unsupported`, with a
null citation and no passage reference — the empty bundle is never
presented as fabricated supporting evidence. Coverage stays
conservative (`COMPLETE_EMPTY` / `UNKNOWN_EMPTY`). Output limits
(record + byte bounds, including the host prefill) run on the empty
path too.

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
# RA652-002 (fix round 2): the package ships with ZERO npm scripts by
# design — there is no npm entrypoint at all, so npm can never parse
# and dispatch candidate-controlled lifecycle metadata (pretest, etc.)
# before authentication. `npm test` simply errors ("Missing script").
# The ONLY official authenticated acceptance entrypoint is the
# host-owned command below, which invokes the separately trusted
# bootstrap directly (never through npm). The bootstrap lives at
# /home/hatch/workspace/research-prototype-trust/bootstrap.js and
# authenticates every byte (and the manifest itself) against the
# approved root BEFORE any candidate byte executes. Its bytes and the
# approved root are pinned in the separately reviewable receipt:
# forge-ai-drop results/muse/research-agent-phase2-slice1-bootstrap-receipt-2026-10-19.md.
#   RESEARCH_APPROVED_ROOT=<digest> node /home/hatch/workspace/research-prototype-trust/bootstrap.js <repo-dir> tests
RESEARCH_APPROVED_ROOT=<digest> node /home/hatch/workspace/research-prototype-trust/bootstrap.js <repo-dir> tests
RESEARCH_APPROVED_ROOT=<digest> node /home/hatch/workspace/research-prototype-trust/bootstrap.js <repo-dir> battery
```

## Trust chain

There is no npm entrypoint: `package.json` ships with no `scripts`
object, so `npm test` / `npm run battery` error out without executing
anything. The only official acceptance entrypoint is the host-owned
direct command `node /home/hatch/workspace/research-prototype-trust/bootstrap.js
<repo-dir> <tests|battery|manual>` with `RESEARCH_APPROVED_ROOT` set.
That small builtins-only bootstrap (separately trusted directory,
outside the repo, never modified by the PR) pins the approved root
from its own `approved-root.txt` (must match `RESEARCH_APPROVED_ROOT`),
authenticates every manifest-listed byte, rejects unlisted files,
nested helpers and symlinks, authenticates the manifest digest itself,
refuses any npm scripts in `package.json`, and only then spawns the
in-repo launcher. Prepend/top-of-file marker canaries against both
official entrypoints and the runtime/watchdog chain are covered by
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
