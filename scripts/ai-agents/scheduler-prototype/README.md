# Scheduler Agent — Phase 2 slice 1 prototype

Synthetic CPM (critical-path method) network recomputation. Pure Node 24
ESM, zero runtime dependencies, zero model calls, offline, fixture-only.
All networks, calendars, and claims are invented. Output is an advisory
recomputation — never a project date commitment.

## What it does

`run(task, context)` recomputes, for each connected component of an
invented activity network:

- **Calendar tick mapping** — exact weekday working mask + explicit
  excluded civil dates per component; tick 0 is the first working day
  on/after the anchor; zero-duration milestones share one boundary.
- **Forward pass** — ES = max(0, release, predecessors ES + w) with
  FS/SS/FF/SF edge weights (negative lag allowed, never repairs cycles).
- **Backward pass** — LS/LF/total float from the component deadline
  (max EF, or an explicit Finish-No-Later-Than bound), with
  Start-No-Earlier-Than / Must-Finish-On / Finish-No-Later-Than
  constraints. Inconsistencies yield CONSTRAINT_UNSATISFIABLE, never a
  feasible-looking schedule.
- **Critical subgraph** — float-0 activities and tight critical edges
  (reported as a subgraph, not enumerated paths); driving edges are
  tight forward constraints independent of criticality.
- **Claim checking** — claimed ES/EF/LS/LF/float values and claimed
  critical paths are compared against computed ticks; mismatches are
  preserved as diagnostics with both figures.

Structural failures (cycles, dangling ties, mixed calendars, horizon
overflow, missing anchors/calendars) block math for that component with a
named status; other anchored components may still return PARTIAL tables.

## Contract notes (S648A)

- **Connected components** are derived from the tie graph, not from
  `record.component` labels. Disconnected islands under one label split
  into independent components (`<label>~<n>`), each with its own deadline;
  an explicit deadline on a split label refuses as ambiguous.
- **Completeness**: `complete:true` only for a verified-complete report.
  Quarantined-away, unknown, or partial populations are never complete.
  Structural unknown references (constraint on missing activity) refuse.
- **Admission** is descriptor-safe: accessor properties are rejected, UTC
  instants are round-trip validated, and read grants are checked before
  any source bytes are touched. Declared revision labels must match the
  host registration.
- **Execution watchdog**: `runner/run-guarded.js` runs `run()` in a worker
  thread with an external 5s timeout, returning a bounded REFUSED envelope
  on timeout.

## Layout

- `src/` — `index.js` (`run(task, context)`), `scheduler.js` (CPM engine),
  `schemas.js` (runtime validation), `resolver.js` (fixture Git-object
  resolution + per-task budget), `injection.js` (seeded directive
  families), `canonical.js` (canonical JSON, hashes, civil dates).
- `fixtures/` — `make-fixtures.js` (authoring tool) + `store.json`
  (trusted fixture Git-object store: 33 invented networks).
- `corpus/` — `make-battery.js` (authoring tool with an independent
  clean-room oracle) + `battery.json` (120 frozen cases) +
  `manifest.json` / `corpus_digest.txt` (trust pins).
- `runner/run-manual.js` — manual host launcher (not scored).
- `tests/` — `node:test` suites + `run-tests.js` / `run-battery.js`
  trust-gated entrypoints.

## Budget discipline

One monotonic budget per invocation: 256 KiB input, 64 candidate
objects, 512 span checks, 256 output records, 256 KiB output. Every
network record and every trusted-context element is charged BEFORE its
fields are read; the 65th candidate refuses with BUDGET_EXCEEDED before
it (or any later candidate) is inspected.

## Running

```sh
# Freeze/verify the corpus (authoring)
node fixtures/make-fixtures.js
node corpus/make-battery.js
node corpus/freeze-corpus.js   # writes manifest.json + corpus_digest.txt

# Scored runs (need the externally supplied approval root)
SCHED_APPROVED_ROOT=<digest> npm test
SCHED_APPROVED_ROOT=<digest> npm run battery
```

## Boundaries

The agent reads only registered invented fixtures through the scoped
resolver. It cannot approve schedules, commit dates, publish, send,
execute, spend, or touch real project data. Advisory output satisfies no
authorization gate.
