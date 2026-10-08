# Slice 6 Discovery Note: Evidence-Grounded Triage

## Reused Slice 5 contracts

| Module | Exports | Reused for |
|--------|---------|------------|
| `aggregateHealth.mjs` | `aggregateHealth()`, `HEALTH_STATES` | Health snapshot input (index freshness, bug catalog state, watchdog not-enabled) |
| `assembleFindings.mjs` | `assembleFindings()` | Finding objects with stable IDs (`coverage:<id>`, `fix:<sha>`, `evidence:...`), kinds, confidence |
| `matchRegressions.mjs` | `matchRegressions()` | Advisory regression exposures (file overlap only) |
| `formatHandoffDraft.mjs` | `formatHandoffDraft()` | Base handoff formatter; extended for triage items |
| `runtimeCoverageRegistry.mjs` | `getRegistry()`, capability entries | `moves_money` flag, `monitoring_status`, `execution_path` |

API: `GET /api/forge/engineering-brain/health` returns `{success, health, findings}` (programmer auth, 404 on unauthorized). No new route needed — triage is computed server-side in the same handler.

UI: `BrainHealthDashboard.jsx` — extended with triage section, reusing `SectionCard`, `StateBadge`, `HandoffDraftBuilder` patterns.

## Minimal implementation plan

**New pure modules** (all deterministic, zero I/O):
1. `prioritizeFindings.mjs` — `prioritizeFindings({findings, capabilities, exposures})` → findings with `severity` + `triageState`. Severity rules documented in code (see below).
2. `buildTriageQueue.mjs` — `buildTriageQueue({prioritized})` → ordered queue. Sort: severity → confidence → freshness → ID tie-breaker.
3. `buildEvidencePacket.mjs` — `buildEvidencePacket({item, health, exposures, bugCatalog})` → packet with `current` vs `historical` sections.
4. Extend `formatHandoffDraft.mjs` with `formatTriageHandoffDraft({packet, ...})` — pure, preview/copy only.

**Severity rules** (deterministic, no LLM):
- Base: `evidence-unavailable` → high; `coverage-gap/uncovered` → high; `coverage-gap/partially-covered` → medium; `coverage-gap/unable-to-verify` → medium; `known-defect-repaired` → low (historical only).
- Boost +1 (max critical): `moves_money=true` on the capability.
- Boost +1 (max critical): exact-file regression exposure on the finding's subsystem files.
- Money-moving increases priority only; never labels defective.

**Triage states**: `needs-review` (actionable), `evidence-unavailable` (cannot verify), `informational` (historical context). Never `resolved` — disappearance is not resolution.

**API change**: health route computes triage server-side, adds `triage` array to response. No new route, no new auth surface, no writes.

**UI change**: triage section in dashboard — ordered queue, severity badges, money indicator ($), state badges, expandable evidence packet, per-item handoff draft (preview/copy).

## Schema/API impact

- Health route response gains `triage: [...]` (read-only, derived). No breaking change to existing `health`/`findings` fields.
- No migrations. No new tables. No new polling. No notifications.

## Safety confirmation

All 15 invariants hold by construction: pure functions only, no I/O in triage modules, no watchdog activation, no cron changes, no writes, no auto-posting. Watchdog section remains hardcoded `not-enabled`.
