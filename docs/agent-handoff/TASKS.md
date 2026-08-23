# FORGE Agent Work Queue

Coordination rules:

1. Every task has exactly one implementation owner.
2. Claude and Codex must use separate branches/worktrees.
3. A task must list its allowed file/domain scope.
4. Do not edit files reserved by another in-progress task.
5. Independent work may proceed simultaneously.
6. Cross-cutting migrations, shared schemas, environment variables, deployments, and Production
   writes remain single-owner operations.
7. One agent may implement while the other performs architecture review; researches external
   APIs/legal requirements; designs tests and edge cases; reviews migrations/RLS; builds
   documentation; audits accessibility/responsiveness; or prepares the next independent feature.
8. The reviewing agent should report material defects once, not repeatedly reverify already-proven
   facts.
9. Update TASKS.md when claiming, completing, blocking, or handing off work.
10. Never store secrets or personal information.

## Ready

| ID | Task | Owner | Branch | Allowed Scope | Dependencies | Completion Gate |
|----|------|-------|--------|---------------|--------------|-----------------|
| SIMPLIFI-01 | Design the Simplifi CSV importer: field mapping, duplicate-detection strategy, Rentec/Plaid overlap rules, fixtures, test matrix, UI flow | Codex | TBD (design-only; no code branch needed yet) | Design docs/fixtures only — no `src/` changes until SIMPLIFI-02 unblocks | None | Design doc + fixtures + test matrix reviewed by Jason before SIMPLIFI-02 (implementation) begins |

## In Progress

| ID | Task | Owner | Branch | Started UTC | Files/Areas Reserved | Status |
|----|------|-------|--------|-------------|-----------------------|--------|
| _(none)_ | | | | | | |

## Review Ready

| ID | Owner | Branch | Commit | Tests | Reviewer Needed | Notes |
|----|-------|--------|--------|-------|------------------|-------|
| RENTEC-01 | Claude | `feat/rentec-financial-history-resume` | `f4ab9d01b` | 98/98 focused, 1907/1907 broader financial/rental suite, 4038/4058 full repo suite (20 failures pre-existing/unrelated — see `CURRENT.md` Verification), production build clean, `git diff --check` clean | Codex — one-time architecture/accounting/idempotency review of the importer code + migration (rule 8: report material defects once, don't reverify proven facts) | Code, tests, and migration are complete and pushed. The **sanitized production preview output itself** (the thing Codex's review is ultimately meant to check) has not been generated yet — see RENTEC-02 in Blocked. Codex can review the classifier/migration/RPC logic now without waiting on that. |

## Blocked

| ID | Blocker | Needed From | Safe Work That Can Continue |
|----|---------|--------------|------------------------------|
| RENTEC-02 | Generating the real sanitized production preview totals requires either `RENTEC_API_KEY` added to the Vercel Preview environment, or Jason's explicit choice to run this preview-only (zero-write) code against Production instead | Jason (decision + action; see `CURRENT.md` Pending Decision #1) | RENTEC-01 code/idempotency review by Codex; SIMPLIFI-01 design work |
| SIMPLIFI-02 | Implementation can't start until (a) SIMPLIFI-01 design is reviewed and approved, and (b) Codex has repository access in its own workspace | Jason (repo access) + Codex (finish SIMPLIFI-01) | SIMPLIFI-01 design work itself |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| HANDOFF-01 | Create shared agent-handoff docs (`CURRENT.md`, `DECISIONS.md`, `TASKS.md`) | Claude | `chore/agent-handoff` | (this commit) | 2026-08-23T19:16Z |
| UI-01 | Portfolio Performance chart: real per-year data-coverage gaps + metallic visual treatment | Claude | `feat/forge-workspace-2-rental-summary` (unpushed) | `8022b0b0e` | 2026-08-23 (exact time not recorded) |
