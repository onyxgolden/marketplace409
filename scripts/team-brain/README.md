# Team Brain — build slice 1

Inert, deterministic obligation ledger + executive queue projection + transaction-gated
handoff state machine. Local synthetic fixtures only. This module connects to **nothing
live**: no FORGE commands, no tracker, no cron, no agent, no notification, no network,
no model.

Binding contract: `onyxgolden/forge-ai-drop` →
`briefs/team-brain/persistence-and-queue-contract-2026-10-14.md`
(blob `19df84c04f84c0bbda52b1c3954b94af4a88e702`, Jason-approved 2026-10-14).

## Layout

| Path | Responsibility |
|---|---|
| `migrations/001_team_brain_schema.sql` | Versioned local PGlite schema (single source of truth) |
| `migrations/schema.snapshot.md` | Deterministic snapshot generated from the migration; pinned by test |
| `ledger/repository.mjs` | Obligation repository + lifecycle guards (PGlite transactions) |
| `ledger/errors.mjs` | Typed `TeamBrainError` + stable guard codes |
| `ledger/validation.mjs` | Strict UTC-ISO timestamps, source/artifact bindings |
| `queue/projection.mjs` | **Pure** deterministic queue projection (no I/O, no clock) |
| `handoffs/stateMachine.mjs` | `OPEN → OUTCOME_WRITTEN → READBACK_VERIFIED → QUEUE_UPDATED → COMPLETE` |
| `report/buildReport.mjs` | Fixture → ledger → projection → deterministic JSON report |
| `report/fixtureSchema.mjs` | Synthetic-fixture-only schema validation |
| `report/stableStringify.mjs` | Key-sorted JSON serialization |
| `report/generateSchemaSnapshot.mjs` | Schema snapshot generator (used by the snapshot test) |
| `runFixtureReport.mjs` | CLI: `--fixture --db --now [--out]` |
| `fixtures/` | Synthetic fixtures (`schemaVersion: 1`, `synthetic: true`) |
| `__tests__/` | Unit, PGlite migration/restart, CLI determinism, network-deny tests |

## Commands

```bash
# Run the Team Brain slice-1 tests (repo's normal runner)
npx vitest run scripts/team-brain

# Fixture CLI (local only; --now is required and never defaults to wall clock)
node scripts/team-brain/runFixtureReport.mjs \
  --fixture scripts/team-brain/fixtures/basic.json \
  --db /tmp/tb-fixture-db \
  --now 2026-10-14T19:00:00Z

# npm script
npm run forge:team-brain:fixture -- --fixture <path> --db <path> --now <ISO-UTC>

# Regenerate the schema snapshot after a migration change (then the test pins it)
node scripts/team-brain/report/generateSchemaSnapshotCli.mjs \
  --out scripts/team-brain/migrations/schema.snapshot.md
```

## Schema

- `team_brain_obligations` — one row per obligation: stable id, kind
  (`TASK|AUTHORIZATION|VERDICT|EVIDENCE`), UTC `filed_at`, immutable source binding
  (`source_repo/path/commit/blob/head`), lifecycle `state`
  (`OPEN|IN_PROGRESS|CLOSED|REVOKED|SUPERSEDED`), explicit `retention_disposition`,
  dependency ids, supersession links, optional priority override. Check constraints
  reject self-dependencies and self-supersession.
- `team_brain_obligation_events` — append-only event history (actor, UTC time, reason,
  evidence refs). Rows are never updated or deleted.
- `team_brain_handoffs` / `team_brain_handoff_events` — handoff state machine rows and
  their transition log.
- `team_brain_schema_version` — migration bookkeeping.

## Invariants (enforced in code, not documentation)

1. A `TASK` closes only with ≥1 completion-evidence reference **and** a prior
   `VERIFICATION` event, atomically. Evidence without verification is rejected.
2. Clock advancement never closes, expires, or deletes anything. The API has no
   delete, no expiry, no TTL, no garbage collection — silent deletion/expiry is
   impossible by construction.
3. An `AUTHORIZATION` stays effective across restarts until an explicit
   `revokeAuthorization` event.
4. A `VERDICT` stays current until `supersedeVerdict` files a newer verdict binding a
   **different** reviewed head. Same-head "supersession" is rejected; the old record
   is never rewritten.
5. `EVIDENCE` is immutable: `correctEvidence` files a linked replacement; the
   original's fields and prior events are unchanged.
6. Queue projection is pure: ledger snapshot + injected UTC `now` → ordered
   actionable ids, blocked ids with reasons, oldest open item + `oldestAgeMs`,
   escalation actions, override metadata. Ordering: oldest effective age first, then
   `obligation_id`. A blocked item's age is inherited transitively by its
   dependencies (affects ordering, never mutates `filed_at`). Dependency cycles fail
   closed with a diagnostic naming the cycle. Priority overrides require full
   attribution (`actor`, `recorded_at`, `reason`, Jason-binding `authority`) and are
   **rejected** — never ignored — when malformed. Escalation starts strictly after
   four hours (`>4h`; exactly 4h yields nothing): one `REPING_DUE`, then one
   `REPORT_TO_JASON_DUE` after the re-ping event is recorded; repeated projections
   emit no duplicates. The library never sends anything.
7. Handoff transitions are single PGlite transactions in the fixed order
   write → verify → queue-update → complete. Skipped, reordered,
   duplicate-conflicting, and stale-binding transitions are rejected with no partial
   state. Exact replays are idempotent (no second event). Restarts recover the last
   committed state; completion is never inferred from chat text.

## Explicit non-capabilities

This slice does **not**: read or write live `commands/`, `results/`,
`MASTER-TRACKER.md`, `open_asks`, or memory files; touch GitHub, Supabase, or any
production database; send re-pings, reports, emails, chats, or notifications; run a
daemon, scheduler, hook, route, or UI; make network or model calls; implement
Section 4 consolidation, duplicate merging, standing-rule changes, or permission
grants; or merge/authorize anything. Later slices may add a live adapter; this one
proves the ledger, projection, and gating logic on synthetic fixtures only.

## Acceptance criteria → tests

| # | Criterion | Test file → case |
|---|---|---|
| 1 | Task close needs evidence + verification (three sub-cases) | `__tests__/ledger.test.mjs` → AC-01a, AC-01b, AC-01c |
| 2 | Clock never closes/expires/deletes; no delete/TTL API | `__tests__/ledger.test.mjs` → AC-02 |
| 3 | Authorization effective across restart until revocation | `__tests__/ledger.test.mjs` → AC-03 |
| 4 | Verdict stands until superseded at a new head; same-head rejected | `__tests__/ledger.test.mjs` → AC-04a, AC-04b |
| 5 | Evidence + prior events unchanged after correction | `__tests__/ledger.test.mjs` → AC-05 |
| 6 | Restart preserves records and event order | `__tests__/ledger.test.mjs` → AC-06 |
| 7 | Shuffled insertion → identical oldest-first; id tie-break | `__tests__/queue.test.mjs` → AC-07 |
| 8 | Direct dependency inherits blocked item's age | `__tests__/queue.test.mjs` → AC-08 |
| 9 | Transitive + fan-in inheritance, earliest age, deterministic | `__tests__/queue.test.mjs` → AC-09 |
| 10 | Cycle fails closed with stable diagnostic | `__tests__/queue.test.mjs` → AC-10 |
| 11 | Unattributed / partial / non-Jason overrides rejected | `__tests__/queue.test.mjs` → AC-11 |
| 12 | Valid override records who/when/why/authority; documented reorder | `__tests__/queue.test.mjs` → AC-12 |
| 13 | Exactly 4h: nothing; just after: one re-ping | `__tests__/queue.test.mjs` → AC-13 |
| 14 | After re-ping: one report-to-Jason; no duplicates | `__tests__/queue.test.mjs` → AC-14 |
| 15 | Nonempty → oldest + age; empty → explicit null | `__tests__/queue.test.mjs` → AC-15 |
| 16 | Skipped/out-of-order transitions rejected, no partial state | `__tests__/handoffs.test.mjs` → AC-16 |
| 17 | Readback must bind exact artifact; changed SHA rejected | `__tests__/handoffs.test.mjs` → AC-17 |
| 18 | Queue update durable before completion; missing/stale blocks | `__tests__/handoffs.test.mjs` → AC-18 |
| 19 | Exact replay idempotent; conflicting replay rejected | `__tests__/handoffs.test.mjs` → AC-19 |
| 20 | Restart after each state recovers it, never advances | `__tests__/handoffs.test.mjs` → AC-20 |
| 21 | Chat-only "done" cannot advance a handoff | `__tests__/handoffs.test.mjs` → AC-21 |
| 22 | All tests pass under the repo's normal runner | `npx vitest run scripts/team-brain` (35/35) |
| 23 | Network-deny guard: zero network/model calls | `__tests__/cliDeterminism.test.mjs` → AC-23, AC-23b |
| 24 | Two identical CLI runs → byte-identical JSON | `__tests__/cliDeterminism.test.mjs` → AC-24a, AC-24b |
| 25 | No regression in existing relevant suites | See PR evidence: `scripts/engineering-brain` suite counts |
| 26 | Boundary: only `scripts/team-brain/` + `package.json` (one script) change | `git status` / PR diffstat; no new runtime dependency |

Validation limits: synthetic fixtures only. This slice claims no live queue
correctness, production durability, notification delivery, or runtime integration.
