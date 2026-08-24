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
| SIMPLIFI-VERIFY | `approve_simplifi_csv_import()` fails every call in Production with Postgres 42501 (RLS violation on `financial_events`) — a regression from Claude's `20260824010000` provenance-hardening migration, which restricted direct writes to `source_system = 'manual'` without knowing the Simplifi RPC (SECURITY INVOKER) relied on the same policy. Zero Simplifi rows exist anywhere; see `CURRENT.md` ACTIVE INCIDENT for full detail | Promote `approve_simplifi_csv_import()` to SECURITY DEFINER (matching the Rentec RPC pattern) + decide on PR #5 (mixed-account fail-safe, unmerged) before retrying | Read-only work only against Simplifi until unblocked — do not attempt another approval against Production |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| SIMPLIFI-VERIFY | Read-only 9-point verification of a supposedly completed Simplifi Production import; no writes made. Found the import never actually succeeded (0 rows anywhere) and traced why — see Blocked table above and `CURRENT.md` | Claude | (read-only, no branch) | n/a | 2026-08-24 |
| UI-01-HOTFIX | Fix two live bugs found post-deploy: chart missing `rentec_api` rows, dashboard route hitting the 1000-row PostgREST pagination cap | Claude | `main` (direct, no feature branch) | `341221bfa`, `7c6a05d92` | 2026-08-23 |
| UI-01 | Portfolio Performance chart: data coverage + metallic treatment — rebased onto `main` and deployed to Production (previously built but deliberately left unpushed pending approval) | Claude | `feat/forge-workspace-2-rental-summary` → `main` | `44bbda68e` | 2026-08-23 |
| RENTEC-02 | Import all available Rentec financial history (2014–2026) into Production `financial_events`: 1,230 rows, $703,914.10 income / $499,756.33 expense, via a purpose-built authenticated import-control UI, approved year-by-year directly against Production per Jason's explicit instruction | Claude | `feat/rentec-financial-history-resume` → `main` | `0e8d190f3`..`3289f2670` | 2026-08-23 |
| RENTEC-01-FIX | Correct three material Rentec history findings; targeted Codex follow-up approved | Claude / Codex review | `feat/rentec-financial-history-resume` | `7817b6c09` | 2026-08-23 |
| RENTEC-01-REVIEW | One-time architecture/accounting/idempotency review; three material fixes required | Codex | `chore/agent-handoff` | `f8a4ef554` | 2026-08-23 |
| HANDOFF-01 | Create shared agent-handoff docs | Claude | `chore/agent-handoff` | `430f6f70f` | 2026-08-23 |
