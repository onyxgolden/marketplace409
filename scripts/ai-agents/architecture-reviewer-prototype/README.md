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

`requested_action: "check-gate"` runs the fixture gate simulator, which
reports evidence sufficiency for an authenticated designated-ChatGPT GO
plus Muse agreement (same repo/resource/scope/result head, standing
checks) and rejects advisory, self-issued, wrong-round, wrong-head and
wrong-source evidence. It does no merge.

## Layout

- `src/` — reviewer implementation (reviewer, checks, resolver,
  schemas, gates, injection, index, markdown, canonical)
- `runner/run-manual.js` — run one frozen battery case by id
- `fixtures/` — principal registry for the gate simulator
- `corpus/` — frozen battery + manifest + digest (authoring tools
  `make-battery.js`, `freeze-corpus.js` are not on the scored path)
- `tests/` — node:test suites + battery harness with a 5s worker
  watchdog per case

## Run

```sh
npm test        # unit suites (needs AR_APPROVED_ROOT, set in scripts)
npm run battery # frozen acceptance battery
node runner/run-manual.js ar-clean-01 --markdown
```

## Limitations

Synthetic fixtures only; structured clause syntax only (prose outside
`[check:...]` lines is untrusted commentary, except seeded injection
probes). The injection recognizer flags seeded families — security
rests on absent capabilities, not on pattern claims. Advisory output is
never an execution token (`authorization_granted` is always false).
