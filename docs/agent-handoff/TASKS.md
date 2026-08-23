# FORGE Agent Work Queue

Coordination rules:

1. Every task has exactly one implementation owner.
2. Claude and Codex must use separate branches/worktrees.
3. A task must list its allowed file/domain scope.
4. Do not edit files reserved by another in-progress task.
5. Independent work may proceed simultaneously.
6. Cross-cutting migrations, shared schemas, environment variables, deployments, and Production writes remain single-owner operations.
7. One agent may implement while the other performs architecture review; researches external APIs/legal requirements; designs tests and edge cases; reviews migrations/RLS; builds documentation; audits accessibility/responsiveness; or prepares the next independent feature.
8. The reviewing agent should report material defects once, not repeatedly reverify already-proven facts.
9. Update TASKS.md when claiming, completing, blocking, or handing off work.
10. Never store secrets or personal information.

## Ready

| ID | Task | Owner | Branch | Allowed Scope | Dependencies | Completion Gate |
|----|------|-------|--------|---------------|--------------|-----------------|
| SIMPLIFI-02 | Build Simplifi CSV import and safe preview/approval workflow | Codex | `feat/simplifi-csv-import` | 2026-08-23 | `src/domains/simplifi-import/**` and future isolated Simplifi import route/schema/tests | Foundation + preview builder pushed; schema/write approval path remains |

## In Progress

| ID | Task | Owner | Branch | Started UTC | Files/Areas Reserved | Status |
|----|------|-------|--------|-------------|-----------------------|--------|
| _(none)_ | | | | | | |

## Review Ready

| ID | Owner | Branch | Commit | Tests | Reviewer Needed | Notes |
|----|-------|--------|--------|-------|------------------|-------|
| SIMPLIFI-01 | Codex | `chore/agent-handoff` | `0f5ca9054` | Design-only | Jason/Claude | Complete design at `designs/SIMPLIFI-01-CSV-IMPORT.md`; no source/schema changes |

## Blocked

| ID | Blocker | Needed From | Safe Work That Can Continue |
|----|---------|-------------|------------------------------|
| RENTEC-02 | Real sanitized preview awaits either `RENTEC_API_KEY` in Preview or explicit Production preview authorization | Jason | Prepare rollout plan; do not migrate/deploy/import yet |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| RENTEC-01-FIX | Correct three material Rentec history findings; targeted Codex follow-up approved | Claude / Codex review | `feat/rentec-financial-history-resume` | `7817b6c09` | 2026-08-23 |
| RENTEC-01-REVIEW | One-time architecture/accounting/idempotency review; three material fixes required | Codex | `chore/agent-handoff` | `f8a4ef554` | 2026-08-23 |
| HANDOFF-01 | Create shared agent-handoff docs | Claude | `chore/agent-handoff` | `430f6f70f` | 2026-08-23 |
| UI-01 | Portfolio Performance chart: data coverage + metallic treatment | Claude | `feat/forge-workspace-2-rental-summary` | `8022b0b0e` | 2026-08-23 |
