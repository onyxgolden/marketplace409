# Architecture Reviewer agent — Phase 2 slice 1 synthetic prototype

Deterministic, bounded, evidence-linked synthetic **design checklist
evaluator**. Advisory only: it proposes GO / NEEDS CHANGES / NO-GO
verdicts with citations, and it never approves, merges, deploys, or
authorizes anything. Every Markdown preview labels the verdict
**ADVISORY**.

Pure Node 24 ESM, zero runtime dependencies, zero model calls, zero
network. No app-route/UI integration, no production scheduler.

## What it does

`run(task, context)` evaluates a structured fixture design document
against the trusted check registry:

- `component-io` — component I/O contract (inputs/outputs)
- `migration-pre-post` — migration pre/post conditions
- `read-write-boundary` — read/write boundary
- `retry-bounds` — retry bounds (policy max 5; unbounded is forbidden)
- `rollback` — rollback action (explicit no-rollback is forbidden)
- `failure-handling` — failure handling

Design facts are parsed from registered structured fixtures and cite
exact UTF-8 byte spans; there is no arbitrary architectural inference.
A missing required clause is evidenced by complete bounded document
coverage, never fabricated quotes. Contradictions preserve both
clauses — values are never averaged.

Clause grammar (runtime validated, `src/reviewer.js`): a clause is one
`[check:<id>]` line carrying `key: value;` pairs. Duplicate keys on one
line are preserved, never last-wins repaired: identical duplicates
collapse, conflicting duplicates classify as contradictions. Unknown
control fields and malformed fragments cannot support verification —
the affected check is marked unverifiable (MAJOR).

Submitted evidence (`evidence_refs`) is verified against the resolved
design bytes **before** any success verdict: wrong source, wrong quote,
out-of-range bounds, or a span that splits a multi-byte UTF-8 character
(fatal decoding — no replacement characters) is an inability to review:
`BLOCKED` + explicit `NO-GO` + `complete:false`. No GO is ever
supported by failed evidence. Citations carry the full provenance
schema: repo, path, commit, blob, `algorithm` (`git-sha1`),
`revision`, exact `quoted_span`, byte span and `VERIFIED` status.
`design_ref.path` is confined to the canonical allowlist
(`designs/<lowercase-name>.md`); `algorithm` and `revision` are
required.

Review budget (`src/resolver.js` `makeBudget`, limits
`BUDGET_LIMITS`): the task's own UTF-8 payload is charged before
anything consults it; every consulted store is charged (object +
payload bytes) before scanning; every record consulted during a scan
is charged before use; every evidence span and generated citation is
charged. Exhaustion fails closed with named codes: `INPUT_LIMIT`
(>256 KiB consumed input) or `BUDGET_EXCEEDED` (>64 objects or >512
span operations) — a small `complete:false` refusal with no domain
success. The final public envelope (including source_refs, evidence and
early denials) is capped at 256 KiB / 256 records (`OUTPUT_LIMIT`).
The 5s worker watchdog per battery case still terminates hanging work.

`requested_action: "check-gate"` runs the fixture gate simulator, which
reports evidence sufficiency for an authenticated designated-ChatGPT GO
plus Muse agreement. Trust model: the task payload supplies **references
only** (`verdict_ref`, `agreement_ref`) into the separately injected
authenticated fixture stores (`context.verdicts`, `context.agreements`,
`context.principals`); request-minted labels, booleans and matching
hashes are never trusted. A gate requires the designated ChatGPT
reviewer and the Muse principal (Jason-registered, unrevoked, valid)
bound to the same repo/resource/scope/source/result head/current round,
unrevoked and valid at the task clock; a newer-round verdict for the
same target supersedes an older GO (stale evidence). Verdict, agreement
and principal records pass strict runtime schemas (required `revoked`
boolean, real calendar dates — `2026-02-30` is rejected — no
missing-field defaults); a malformed trust store fails the gate with an
explicit reason. It does no merge.

## Layout

- `src/` — reviewer implementation (reviewer, checks, resolver,
  schemas, gates, injection, index, markdown, canonical)
- `runner/run-manual.js` — run one frozen battery case by id
- `fixtures/` — principal registry for the gate simulator
- `corpus/` — frozen battery + manifest + digest (authoring tools
  `make-battery.js`, `freeze-corpus.js` are not on the scored path)
- `tests/` — node:test suites + battery harness with a 5s worker
  watchdog per case; `tests/run-tests.js` is the `npm test` entrypoint
  and authenticates the separately trusted approved root (builtins
  only) before any scored test/helper is imported

## Run

```sh
npm test        # launcher authenticates AR_APPROVED_ROOT (set in scripts), then node --test
npm run battery # frozen acceptance battery
node runner/run-manual.js ar-clean-01 --markdown
```

## Limitations

Synthetic fixtures only; structured clause syntax only (prose outside
`[check:...]` lines is untrusted commentary, except seeded injection
probes). The injection recognizer flags seeded families — security
rests on absent capabilities, not on pattern claims. Advisory output is
never an execution token (`authorization_granted` is always false).
