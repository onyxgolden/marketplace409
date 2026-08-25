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
| SIMPLIFI-02 | Build Simplifi CSV import and safe preview/approval workflow | Codex | `feat/simplifi-csv-import` | 2026-08-23 | `src/domains/simplifi-import/**` and future isolated Simplifi import route/schema/tests | Foundation + preview builder pushed; schema/write approval path remains. **Note**: the write/approval path has since shipped and run in Production (12 batches, see `CURRENT.md` section A) — confirm with Codex whether this row is stale before picking it up. |
| FORGE-PROFIT-LABEL | Fix "Monthly Profit" KPI card, which actually displays an all-time total, not a monthly figure | _(unclaimed)_ | _(none yet)_ | `src/app/forge/financial/page.js` (the `kpiPresentations` "profit" entry and its data source) | none | Card either renamed to reflect an all-time total, or wired to a real current-month figure; regression test added |
| SIMPLIFI-SCOPE | Decide whether the 52 CSV rows across 17 Simplifi-bootstrapped non-transaction accounts (vehicles, crypto, tools, trailers) should ever be reviewed/imported, or are correctly out of scope | _(unclaimed)_ | _(none yet)_ | Simplifi import domain, read-only investigation first | none | Explicit documented decision, either "confirmed correctly excluded, here's why" or a follow-up task to review them |

## In Progress

| ID | Task | Owner | Branch | Started UTC | Files/Areas Reserved | Status |
|----|------|-------|--------|-------------|-----------------------|--------|
| _(none)_ | | | | | | |

## Review Ready

| ID | Owner | Branch | Commit | Tests | Reviewer Needed | Notes |
|----|-------|--------|--------|-------|------------------|-------|
| ASSETS-01 | Codex | `chore/agent-handoff` | `87d54518c` | Design-only | Jason/Claude | Investments and other-assets architecture at `designs/ASSETS-01-INVESTMENTS-OTHER-ASSETS.md`; stocks, funds, bonds, crypto, metals, private/manual assets; no source/schema changes |
| SIMPLIFI-01 | Codex | `chore/agent-handoff` | `0f5ca9054` | Design-only | Jason/Claude | Complete design at `designs/SIMPLIFI-01-CSV-IMPORT.md`; no source/schema changes |

## Blocked

| ID | Blocker | Needed From | Safe Work That Can Continue |
|----|---------|-------------|------------------------------|
| _(none)_ | | | |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| SIMPLIFI-DUPES | Ground-truth investigation found and corrected 301 duplicate `financial_events` from a v1→v2 fingerprint recovery gap (data-only fix, no code branch); proved idempotency two ways. See `CURRENT.md` section A for full figures | Claude | (data correction, no branch) | n/a | 2026-08-24 |
| FORGE-SCOPE-FIX | Fixed personal Simplifi activity blending into every "business" Financial FORGE dashboard/KPI/NOI figure; built out the Overview tab (period controls, income charts, category breakdown, account reconciliation, business/personal toggle) | Claude | `feat-financial-forge-dashboard` → `main` | `4bcd995db` | 2026-08-25 |
| FORGE-CHART-STYLE | Metallic graphic treatment on the new income trend charts, matching Rental Manager's existing chart language | Claude | `fix-income-chart-metallic-treatment` → `main` | `9d45fb84d` | 2026-08-25 |
| FORGE-BALANCES | Manual account-balance entry (`GET/POST /api/financial/account-balances`); fixed the "Cash" KPI filtering on a `subtype` value no account has ever had; architected for Plaid to become source of truth automatically | Claude | `feat-account-balances` → `main` | `e6d64b5b6` | 2026-08-25 |
| FORGE-MONEY-BUG | Fixed a KPI display bug dividing every dollar figure (Net Worth, Cash, Profit, Revenue, Expenses) by 100 before display — found live while verifying FORGE-BALANCES | Claude | `fix-financial-kpi-double-cents-conversion` → `main` | `6749fd7e6` | 2026-08-25 |
| DOCS-01 | Standardized property document library: categories, upload/preview/download, full-text search, version history, expiration reminders, audit trail — extends the existing `rental_documents` table, no second document system | Claude | `feat-property-document-library` → `main` | `f08daec4e` | 2026-08-24 |
| DOCS-COMPRESS | Client-side image compression before document upload, fixing a real-world 413 on a 7 MB phone-camera photo | Claude | `fix-document-upload-image-compression` → `main` | `28aec9182` | 2026-08-24 |
| OCR-CREDS | Wired Google Cloud Vision credentials via an env var (Vercel Functions have no file-based credential path); provisioned a dedicated GCP service account; verified real OCR extraction end-to-end against 930 Highland Drive's survey/plat | Claude | `feat-ocr-credentials-env` → `main` | `fb1ed7b41` | 2026-08-25 |
| PROPERTY-FINSETUP | Financial setup workflow linking a Rental Manager property to Financial FORGE under one shared property ID; populated with real 930 Highland Drive acquisition data from its HUD-1 | Claude | `feat-property-financial-setup` → `main` | `c6fe7b3f8`, `79ebf80f5`, `f67d51461` | 2026-08-24 |
| SIMPLIFI-FINGERPRINT-FIX | Fixed a fingerprint cardinality bug (`split_identity` treated as identity) that collapsed distinct transactions and dropped duplicates; paginated a 1000-row-capped fingerprint fetch | Claude | `fix-simplifi-fingerprint-cardinality` → `main` | `310644506`, `9f18cc3f5`, `0d4f7447a` | 2026-08-24 |
| SIMPLIFI-PERSONAL-SCOPE | Import personal Simplifi transactions, segregated from business reports | Claude | `simplifi-personal-scope` → `main` | `0c1bfd2fc` | 2026-08-24 |
| SIMPLIFI-VERIFY | Read-only 9-point verification of a supposedly completed Simplifi Production import; found it had never actually succeeded (0 rows anywhere) at the time, traced why (an RLS regression, since resolved before the 12-batch import described in `CURRENT.md` ever ran) | Claude | (read-only, no branch) | n/a | 2026-08-24 |
| UI-01-HOTFIX | Fix two live bugs found post-deploy: chart missing `rentec_api` rows, dashboard route hitting the 1000-row PostgREST pagination cap | Claude | `main` (direct, no feature branch) | `341221bfa`, `7c6a05d92` | 2026-08-23 |
| UI-01 | Portfolio Performance chart: data coverage + metallic treatment — rebased onto `main` and deployed to Production (previously built but deliberately left unpushed pending approval) | Claude | `feat/forge-workspace-2-rental-summary` → `main` | `44bbda68e` | 2026-08-23 |
| RENTEC-02 | Import all available Rentec financial history (2014–2026) into Production `financial_events`: 1,230 rows, $703,914.10 income / $499,756.33 expense, via a purpose-built authenticated import-control UI, approved year-by-year directly against Production per Jason's explicit instruction | Claude | `feat/rentec-financial-history-resume` → `main` | `0e8d190f3`..`3289f2670` | 2026-08-23 |
| RENTEC-01-FIX | Correct three material Rentec history findings; targeted Codex follow-up approved | Claude / Codex review | `feat/rentec-financial-history-resume` | `7817b6c09` | 2026-08-23 |
| RENTEC-01-REVIEW | One-time architecture/accounting/idempotency review; three material fixes required | Codex | `chore/agent-handoff` | `f8a4ef554` | 2026-08-23 |
| HANDOFF-01 | Create shared agent-handoff docs | Claude | `chore/agent-handoff` | `430f6f70f` | 2026-08-23 |
