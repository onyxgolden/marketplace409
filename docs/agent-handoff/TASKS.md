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
| SIMPLIFI-02 | Build Simplifi CSV import and safe preview/approval workflow | Codex | `feat/simplifi-csv-import` | 2026-08-23 | `src/domains/simplifi-import/**` and future isolated Simplifi import route/schema/tests | Foundation + preview builder pushed; schema/write approval path remains. **Note**: the write/approval path has since shipped and run in Production (12 batches, see `CURRENT.md` section A), and a read-only asset-registry preview has also since shipped (`SIMPLIFI-ASSET-PREVIEW` below) — confirm with Codex whether this row is stale before picking it up. |
| SIMPLIFI-SCOPE | Decide whether the 52 CSV rows across 17 Simplifi-bootstrapped non-transaction accounts (vehicles, crypto, tools, trailers) should ever be reviewed/imported, or are correctly out of scope | _(unclaimed)_ | _(none yet)_ | Simplifi import domain, read-only investigation first | none | Explicit documented decision, either "confirmed correctly excluded, here's why" or a follow-up task to review them |
| ASSETS-DOUBLECOUNT | Resolve the cross-feature double-counting risk between Financial Assets (`financial_assets`) and the generic manual-balance-entry panel — both can now write a `type='other'` `financial_accounts` row for the same physical thing with no cross-reference. **No longer purely latent**: 20 properties now have both an old empty Simplifi-bootstrapped row and a new populated Financial Asset row side by side (see `CURRENT.md` section B.1's 2026-08-25 update) | _(unclaimed)_ | _(none yet)_ | `src/domains/financial-position/FinancialPositionQueryService.js`, `src/app/api/financial/account-balances/route.js`, `src/app/api/financial/assets/route.js` | none | Should be resolved as part of the Simplifi asset-account import below, not deferred past it. Now higher priority — one manual balance entry on an old shadow row away from an actual Net Worth double-count |
| SIMPLIFI-ASSETS-IMPORT | Import the 17 Simplifi-bootstrapped `type='other'` accounts (52 CSV rows, vehicles/crypto/tools/trailers) as Financial Assets, now that the registry exists. **Not the same as `REALESTATE-NETWORTH` below** — that used the Financial Assets registry directly from a Simplifi dashboard screenshot and did not touch these 17 accounts | _(unclaimed)_ | _(none yet)_ | Simplifi import domain + `src/app/api/financial/assets/**` | ASSETS-DOUBLECOUNT (resolve alongside, not before); also needs SIMPLIFI-PREVIEW-FIXES below resolved first if this import is meant to build on the preview classifier | All 17 accounts represented exactly once in Net Worth via the asset registry, generic manual-balance-entry panel no longer double-counts them |
| SIMPLIFI-PREVIEW-FIXES | Fix two classifier bugs found by calling the read-only Simplifi asset-registry preview live: (1) the real-estate regex matches "home" in "Home Depot" (false positive) and misses actual property-address account names (false negative); (2) zero rows can ever reach `ready` because ownership scope is inferred only from `financial_events`, which none of these 17 zero-transaction accounts have | _(unclaimed)_ | _(none yet)_ | `src/domains/simplifi-import/buildSimplifiAssetRegistryPreview.js` | none | Real-estate regex no longer matches unrelated "home"/"property"-adjacent brand names; a documented method exists for determining ownership scope on a zero-transaction account, and at least the 7 known-good asset-class rows (vehicles, trailers, equipment, crypto) can reach `ready` |
| PARSEASSETBODY-NAN | `parseAssetBody` in `src/app/api/financial/assets/route.js` converts an omitted `purchaseCostCents` field to `Number(undefined)` = `NaN`, which fails validation, instead of treating a missing field the same as `null`/`""`. Hit during manual real-estate data entry on 2026-08-25 (worked around by passing `purchaseCostCents: null` explicitly) | _(unclaimed)_ | _(none yet)_ | `src/app/api/financial/assets/route.js` | none | Omitting `purchaseCostCents` entirely behaves the same as passing `null` |
| ASSETS-FUTURE-SLICES | Build the remaining slices of the Investments design (`designs/ASSETS-01-INVESTMENTS-OTHER-ASSETS.md`) beyond manual accounts+valuations: CSV import/reconciliation (`ASSETS-04`), analytics/read models (`ASSETS-05`), price-provider adapter (`ASSETS-06`), Plaid Investments (`ASSETS-07`) | _(unclaimed)_ | _(none yet)_ | `src/domains/investment-*` (new), `src/app/api/financial/investment-accounts/**` | `INVESTMENTS-WORKSPACE` (done, see Completed) | Whichever slice is picked up meets that slice's own acceptance criteria from the design doc |

## In Progress

| ID | Task | Owner | Branch | Started UTC | Files/Areas Reserved | Status |
|----|------|-------|--------|-------------|-----------------------|--------|
| _(none)_ | | | | | | |

## Review Ready

| ID | Owner | Branch | Commit | Tests | Reviewer Needed | Notes |
|----|-------|--------|--------|-------|------------------|-------|
| SIMPLIFI-01 | Codex | `chore/agent-handoff` | `0f5ca9054` | Design-only | Jason/Claude | Complete design at `designs/SIMPLIFI-01-CSV-IMPORT.md`; no source/schema changes. **Codex unavailable until 2026-08-26 (weekly token limit)** — don't expect a response on this today; Grok/Perplexity available in the meantime if needed for anything unrelated to this specific review. |

`ASSETS-01` removed from this table 2026-08-25 — superseded by `INVESTMENTS-WORKSPACE` in Completed
below, which shipped the manual-accounts slice of this design (`ASSETS-02`/`ASSETS-03` in the
design doc's own slicing). The full design (CSV import, tax lots, XIRR, price providers, Plaid) is
still real future work — see `ASSETS-FUTURE-SLICES` in Ready above if picking that up.

## Blocked

| ID | Blocker | Needed From | Safe Work That Can Continue |
|----|---------|-------------|------------------------------|
| _(none)_ | | | |

## Completed

Keep only the most recent 20 completed tasks here; git history is the archive.

| ID | Task | Owner | Branch | Commit | Completed UTC |
|----|------|-------|--------|--------|---------------|
| CASH-SAVINGS-BALANCES | Entered the home cash box (corrected mid-session from an initial wrong $35,000 to the real $53,168) and, once Simplifi's Savings group was seen expanded for the first time, the remaining 4 accounts: Personal Savings ($12,273.64), Rave Brandy's ($134.49), RAVE Jason's ($71.19), and a correction to Business Savings — its $4,235.67 figure had been a stale early-session placeholder, corrected to the real $26,123.53. Also added a newly-surfaced "Joint WROS - TOD" brokerage account ($12,528.84) to Investments. Net Worth $3,996,781 → $4,031,781 → $4,096,845. See `CURRENT.md` section B.5 | Claude | (live data entry via authenticated API calls, no branch) | n/a | 2026-08-25 |
| INVESTMENTS-WORKSPACE | Built the manual-accounts slice of Codex's Investments design (`ASSETS-01`): new `investment_accounts`/`investment_account_valuations` tables, 3 atomic RPCs, `GET/POST/PATCH/DELETE /api/financial/investment-accounts`, new "Investments" tab. Mirrors the Financial Assets registry's architecture with all 3 of its review defects fixed from the start. First confirmed nothing had already been built (checked all 47 branches, full history, every migration — only the design doc existed). Applied migration, deployed, populated with 8 real accounts. Net Worth $3,795,810 → $3,996,781. See `CURRENT.md` section B.4 | Claude | `feat/investments-workspace` → `main` (PR #23) | `a7b17f547` | 2026-08-25 |
| BANK-BALANCES-REFRESH | Entered/refreshed 16 bank and credit-card account balances from two Quicken Simplifi screenshots taken ~30 minutes apart (real transaction activity happened between them, verified against the screenshots' own transaction lists); confirmed and applied the correct liability sign convention (positive = amount owed, opposite of Simplifi's display). Net Worth $3,774,436 → $3,795,810. See `CURRENT.md` section B.3 | Claude | (live data entry via authenticated API calls, no branch) | n/a | 2026-08-25 |
| REALESTATE-NETWORTH | Registered 23 real-estate properties as Financial Assets from a Quicken Simplifi dashboard screenshot's per-property values, so Net Worth reflects real estate for the first time; 20 linked to matching Rental Manager properties, 1 created in Rental Manager first (17706 Highway 62) then linked, 1 left deliberately unlinked/personal (4832 Share Lane), 1 used a value supplied directly by Jason rather than the screenshot (930 Highland Drive). Net Worth $4,236 → $3,774,436. No code change — used the existing Financial Assets API. See `CURRENT.md` section B.2 | Claude | (live data entry via authenticated API calls, no branch) | n/a | 2026-08-25 |
| SIMPLIFI-ASSET-PREVIEW | Applied and hardened Codex's read-only Simplifi asset-registry preview (`GET /api/financial/simplifi-asset-registry-preview`); fixed a latent `account_balances` pagination gap pre-merge with regression tests; called live and found 2 classifier bugs (see `SIMPLIFI-PREVIEW-FIXES` above). Still read-only, no write/import path | Claude (fix/review) + Codex (original build) | `feat/simplifi-asset-registry-preview` → `main` (PR #21) | `539cbb5`/`a6f4dc036` (Codex base) + `66de08d0b` (Claude pagination fix) | 2026-08-25 |
| FINANCIAL-ASSETS | Reviewed and shipped Codex's Financial Assets feature (physical/digital asset registry, lifecycle controls, Net Worth integration); found and fixed 3 material defects (same-day valuation correction, retired assets not leaving Net Worth, no double-linked-property safeguard); applied migration; fast-forwarded `main`; verified Production on all 3 domains with zero data mutation | Claude (review/fix) + Codex (original build) | `feat/financial-assets-foundation` → `main` (fast-forward, no PR) | `5358d3a18` (Codex base) + `4762e5293` (Claude corrections) | 2026-08-25 |
| FORGE-PROFIT-LABEL | Fixed "Monthly Profit" KPI card to show a real current-month figure instead of an all-time total, via a new `getCurrentMonthProfitKpi.js` reusing the existing period-bucketing utility | Claude | `fix-monthly-profit-current-month` → `main` | `81ccb52a9` | 2026-08-25 |
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
