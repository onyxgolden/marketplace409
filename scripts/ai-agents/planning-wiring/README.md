# P2b-1 — Scheduler planning-review wiring

**Status: WIRED_INERT / SYNTHETIC_RUNTIME_VERIFIED / LIVE_NOT_AUTHORIZED.**
Jobs ship DISABLED + SYNTHETIC_PREVIEW only. There is no workflow,
timer, cron, Bridge job, or schedule registration in this slice, and
no live read, production write, migration, deployment, or activation.
Activation is Jason-gated later and requires a separately reviewed
change plus his per-agent word (reviewed artifact, exact
owner/project set, read principal, fields, clock policy, retention,
cadence).

## What this is

The Scheduler planning-review job (`scheduler-planning-review@1`,
window `planning-lookahead-14-civil-days`, proposed Monday 08:00
America/Chicago) evaluates a bounded, admitted planning snapshot
into a DRAFT review report: dependency/calendar integrity, supported
schedule recomputation (Scheduler-prototype FS/SS/FF/SF signed-lag
inequalities, working-day clock only), and the next-14-day declared
activity/milestone review. Declared values and computed advisory
values are reported side by side with disagreements flagged; source
blocks are never moved, dates never committed, crews never
dispatched. Decisions are review metadata only: acknowledge,
needs-clarification, dismiss-with-reason. There is no Approve
schedule, Apply draft, Execute, Send, Auto-fix, or Activate control.

## Layout

- `src/` — the inert runner (`runner.js`), preemptive-deadline
  execution worker (`executeWorker.js`), synthetic repository
  (`syntheticRepository.js`), planning budget limits
  (`planningBudget.js`), fixtures (`fixtures.js`).
- `descriptors/job-descriptors.json` — versioned job descriptors.
  Scheduler is WIRED_INERT; Project Controls and Project Manager
  are NOT_BUILT in this slice and refuse with
  JOB_NOT_BUILT_IN_SLICE (the P2a-1 precedent for P2a-2).
- `runner/` — the authenticated executable closure: `manifest.json`
  (regenerate with `node runner/make-manifest.mjs`) and
  `trust-entry.mjs` (builtins-only verification before any
  candidate byte runs).
- `battery/` — the frozen 80-case wiring battery + independent
  oracle (`node battery/run-battery.js`). Each case runs the full
  inert runner three times against one shared publisher; published
  items must be byte-identical across runs.
- `tests/` — node:test suites, discovered only from the manifest
  (`node tests/run-tests.js <trust-root>`).
- `preview/` — the preview child, spawned only after the
  drop-owned trusted launcher authenticates the closure. It runs
  one synthetic job and publishes item + snapshot into the
  operator-owned private state directory (never into Git).

## Shared machinery (imported, not copied)

Budget primitives + canonical JSON: `src/application/ai-lab/
rental-ops/{budgets,canonical}.js`. Deadline / worker-termination /
bounded publication: `scripts/ai-agents/rental-ops-wiring/src/
deadline.js`. Prototype math: `scripts/ai-agents/
scheduler-prototype/src/scheduler.js` (imported single-sourced).
The planning lane adds only its own contracts, projection,
snapshot builder, mapping, evaluator, serializer, runner, and
battery — no second daemon, bus, database, or document store.

## Bounds (brief §11)

One monotonic invocation budget: ≤64 candidates, ≤512 evidence
spans, ≤256 KiB serialized UTF-8 input, ≤256 public output records /
256 KiB final envelope, depth ≤32, 5-second external computation
deadline (preemptive worker termination), separately bounded
publication (5 s), 2-second single-page reads. Over-budget projects
refuse wholly with no domain totals. No streaming, no portfolio
batching, no raised caps, no refunds, no silent sampling.

## Application surface

`src/application/ai-lab/planning/`: `jobContracts.js` (closed
request schema, host-owned modes, typed scope), `fieldMappings.js`
(`planning-fields@1` allowlist + source-column receipt),
`readProjection.js` (injected-capability read boundary),
`snapshotBuilder.js` (owner/scope-checked collection, budget
charging before inspection, PARTIAL handling, freshness/revision
attestation), `sourceMappings.js` (snapshot → scheduler network,
calendar precedence, constraint conversion, withhold rules),
`schedulerAssessment.js` (the DRAFT report), `privateItemSerializer.js`
(canonical-tuple item identity, digest row ids),
`decisionValidator.js` (closed decision enum, digest binding).

## Forbidden by construction

Never call the scheduling project GET endpoint,
`computeAndPersistCpm`, or `persistCpmResults` (the GET persists
CPM data as a side effect). No `SELECT *`, no broad board JSON
read-then-strip, no cost-rollup helpers, no mutation RPC, no
financial fields (PV/EV/AC/CPI/SPI/EAC, contingency) even read-only,
no business-day → elapsed-hour conversion (×24), no default
calendars or default dates, no cross-type identity inference
(scheduling project ≠ work-management project ≠ package ≠ generic
project), no raw-colon-concatenated row ids (digests over complete
canonical tuples — the P670-005A lesson).

## Run it

```sh
node runner/make-manifest.mjs
node battery/run-battery.js
node tests/run-tests.js "$(sha256sum runner/manifest.json | cut -d' ' -f1)"
```

See `ACTIVATION-RUNBOOK.md` for the activation gate (Jason's word,
separately reviewed change — nothing here activates anything).
