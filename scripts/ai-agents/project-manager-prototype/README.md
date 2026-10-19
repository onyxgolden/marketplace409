# Project Manager Agent — Phase 2 Slice 1 Prototype

Synthetic plan-health report: FS-only forward pass, milestone feasibility,
resource overallocation, completion accounting. Advisory JSON only.

## Layout

- `src/index.js` — `run(task, context)` entry, public envelope
- `src/manager.js` — domain: forward pass, milestones, orphans, resources, completion
- `src/schemas.js` — runtime validation
- `src/resolver.js` — fixture resolver + monotonic budget (charge before inspect)
- `src/injection.js` — seeded injection-family recognizer
- `src/canonical.js` — canonical JSON
- `fixtures/` — 23 synthetic plan packages (`make-fixtures.js` regenerates)
- `corpus/` — 120 frozen battery cases + SHA-256 manifest
- `tests/` — battery runner + node:test suites
- `runner/run-manual.js` — host launcher

## Commands

```sh
npm test              # unit tests (35)
npm run battery       # frozen battery (120), manifest verified first
node runner/run-manual.js plan-linear
```

## Domain rules (brief)

- Tick = invented elapsed hour, intervals `[start,end)`. FS edges only;
  SS/FF/SF, calendars, float → `UNSUPPORTED_TASK` (not implemented this slice).
- Earliest start = max(project_start_tick, max predecessor EF + lag, release_tick).
  Declared starts never move the network; violations are flagged.
- Cycle or dangling dependency → `PARTIAL`, `math: null`, `BLOCKING_MATH`.
- Duplicate task/edge IDs or malformed values → `REFUSED`.
- Orphan = no directed path to any milestone requirement → scope gap listed.
- Milestone earliest feasible = max required-task finishes. Claimed earlier →
  `MISMATCH`; equal/later → feasible; empty requirements → `UNVERIFIABLE`.
- Resources: declared intervals only; per-cutpoint rational sums; overcapacity →
  `RESOURCE_OVERALLOCATION`. Abutment `[end,start]` never overlaps. Windows must
  be nonoverlapping and fully cover the demand interval.
- Completion = COMPLETE / admitted; header claims compared exactly.

## Budget (per invocation)

256 KiB input, 64 objects, 512 spans, 256 output records, 256 KiB output.
Every candidate charged BEFORE its fields are read; attempt 65 refuses.

## Boundaries

Synthetic fixtures only. No model calls, no network, no filesystem/shell/send
capability in the agent. No tasking, commitment, or authorization language in
output. This prototype advises; it does not assign work or update any system.
