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
| _(none)_ | | | | | | |

## In Progress

| ID | Task | Owner | Branch | Started UTC | Files/Areas Reserved | Status |
|----|------|-------|--------|-------------|-----------------------|--------|
| _(none)_ | | | | | | |

## Review Ready

| ID | Owner | Branch | Commit | Tests | Reviewer Needed | Notes |
|----|-------|--------|--------|-------|------------------|-------|
| RENTEC-01-FIX | Claude | `feat/rentec-financial-history-resume` | `7817b6c09` (amended, force-pushed over `f4ab9d01b`) | 114/114 focused (Rentec domain + both routes + client), 1923/1923 broader financial/rental suite, production build clean, `git diff --check` clean | Codex — confirm the three findings from `reviews/RENTec-01-CODEX-REVIEW.md` are resolved | All three material findings addressed: (1) legacy overlap now reconciled as evidence groups/multisets with deterministic, stable-order cardinality reconciliation, not independent per-row checks — new tests cover 2-source/1-existing, 1-source/2-existing, 2-source/2-existing, split rows, and stable ordering; (2) preview and approval now share one `fetchAllRentecFinancialHistoryTransactions()` helper that fails closed with a clear error if a property still reports more pages past the 50-page cap, instead of silently truncating; (3) `existingSafeTotalsByYear`/`expectedPostImportTotalsByYear` now include `rentec_api` as a safe source for both income and expense, with a rerun-stability regression test. No migration applied, no deploy, no Production import, no environment variables touched. |
| SIMPLIFI-01 | Codex | `chore/agent-handoff` | `0f5ca9054` | Design-only | Jason/Claude | Complete design at `designs/SIMPLIFI-01-CSV-IMPORT.md`; no source/schema changes |

## Blocked

| ID | Blocker | Needed From | Safe Work That Can Continue |
|----|---------|-------------|------------------------------|
| RENTEC-02 | Real sanitized preview awaits Codex's confirmation on RENTEC-01-FIX and either `RENTEC_API_KEY` in Preview or explicit Production preview authorization | Jason (env/preview decision) + Codex (confirm fix) | Review the three corrected findings in RENTEC-01-FIX (`feat/rentec-financial-history-resume` @ `7817b6c09`) |
| SIMPLIFI-02 | Implementation waits for SIMPLIFI-01 approval and a dedicated implementation branch/worktree | Jason + Codex | Review decisions 1–5 in the SIMPLIFI-01 design; prepare a synthetic export fixture |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| RENTEC-01-REVIEW | One-time architecture/accounting/idempotency review; three material fixes required | Codex | `chore/agent-handoff` | `f8a4ef554` | 2026-08-23 |
| HANDOFF-01 | Create shared agent-handoff docs | Claude | `chore/agent-handoff` | `430f6f70f` | 2026-08-23 |
| UI-01 | Portfolio Performance chart: data coverage + metallic treatment | Claude | `feat/forge-workspace-2-rental-summary` | `8022b0b0e` | 2026-08-23 |
