# FORGE Active Handoff

## Last Updated

2026-08-23T21:56Z — Claude Code (Sonnet 5) — branch `chore/agent-handoff`.

## Current Objective

**RENTEC-02 (the Rentec financial-history resume import) is complete.** All available Rentec
financial history (2014–2026) has been imported into `financial_events` in Production, verified
row-for-row against the database, and the Rental Manager Summary's Portfolio Performance chart
(UI-01) is deployed and correctly displays it. Nothing is currently blocked. See Roadmap Parking Lot
for genuinely open follow-up items — none of them block anything today.

## Production State

- `origin/main` SHA: `7c6a05d92` (fast-forward history from `327b8b025` → `3289f2670` →
  `44bbda68e` → `341221bfa` → `7c6a05d92`; every step pushed as a fast-forward or a clean merge
  commit, no rewritten history reached `main`).
- Deployed Production SHA: `7c6a05d92`, confirmed live on `409marketplace.online`,
  `www.409marketplace.online`, and `marketplace409.vercel.app`.
- Migrations: `20260823000000_add_rentec_financial_history_import.sql` and
  `20260823010000_fix_rentec_financial_history_import_reason_column.sql` are both **applied to
  Production** (`supabase db push --linked --yes`). The second migration is a targeted hotfix for a
  SQL typo in the first (`x.reason` → `reasons.reason`) discovered when live approvals were failing
  with Postgres error 42703 — see `DECISIONS.md`. Both were verified read-only-safe before applying
  (audit table + one RPC function, no changes to `rental_payments`/`rent_charges`/settlements).
- Environment configuration: unchanged from the last recorded snapshot (see git history of this file
  for the last full `vercel env ls` names-only listing) — no environment variables were added,
  removed, or changed during the import or chart rollout.
- Safety state, independently re-verified after every import batch and again at final verification:
  `rental_billing_settings` has 0 rows with `billing_enabled = true`; all 27 `rent_schedules` rows
  remain `collection_mode = 'external'`. FORGE billing was never activated by this work.

## What Actually Happened (RENTEC-02 + UI-01)

- **Import**: all 13 years with a real gap (2014–2026) were approved one year at a time through a
  purpose-built authenticated import-control UI
  (`src/components/forge/rental/RentecFinancialHistoryImportPanel.jsx`, reachable from Rental Manager
  → Money → "Rentec Financial History Import"). 1,230 rows inserted, `source_system = 'rentec_api'`:
  $703,914.10 total income, $499,756.33 total expense. Full per-year breakdown is in git history /
  the final report given to Jason; not repeated here per the Safety Boundaries below.
  - **Held back, not imported**: 20 "Commissions"-category rows ($766,730.19) — may already be
    recorded as real-estate purchases under a different category; flagged for manual review, never
    auto-imported.
  - **Excluded, not imported**: 40 rows with a $0.00 (or negative) amount — no financial impact to
    record; the approval RPC fails an entire batch closed on any non-positive-amount row, so these
    are filtered out before submission (`rentecFinancialHistoryImportBatchPlan.js`).
  - **Idempotency verified**: the audit table (`rentec_financial_history_import_batches`) has 13
    rows whose `sum(inserted_count)` exactly equals actual rows written; zero duplicate
    `(owner_id, source_system, source_record_id)` tuples anywhere in `financial_events`.
  - **Legacy data untouched**: the pre-existing `source_system = 'rentec'` CSV bulk import (5,629
    rows, 2005–2026, all inserted 2026-07-15) is unchanged; `forge_rental_payment` (3 rows) and its
    adjustment table (1 row) are unchanged.
- **Two production bugs found and fixed live during this rollout** (both via `vercel logs`
  diagnosis against real failures, both re-verified against the live database before continuing):
  1. A SQL typo in `approve_rentec_financial_history_import()` (`x.reason` instead of
     `reasons.reason`) made every approval fail with Postgres 42703 — meaning early approval clicks
     had written nothing despite appearing to succeed in the UI. Fixed via the
     `20260823010000` hotfix migration (never edited the already-applied original).
  2. Both the preview and approve routes used a bare, unbounded `financial_events` `.select()` —
     PostgREST silently caps this at 1000 rows. For this owner (5,600+ rows) that silently truncated
     the "existing rows" evidence set used for duplicate-detection, which could have caused
     duplicate inserts had it gone unnoticed. Fixed with a new paginated helper,
     `fetchAllOwnerFinancialEvents()` (`src/domains/rentec-financial-history-import/`), now reused
     by every route that reads the full `financial_events` table for one owner.
- **UI-01 (Portfolio Performance chart)**: was sitting complete-but-unpushed on
  `feat/forge-workspace-2-rental-summary` (`8022b0b0e`) pending Jason's approval. Rebased onto `main`
  via a merge commit (`44bbda68e`, zero file-level conflicts with the import work) and deployed.
  Spot-checking the live chart against real data surfaced two more real bugs, both fixed and
  deployed same-session:
  1. The chart's source-system allowlist (`SAFE_INCOME_SOURCES`/`SAFE_EXPENSE_SOURCES` in
     `buildRentalFinancialPerformance.js`) only recognized `source_system = 'rentec'`, not the new
     `'rentec_api'` — so all 1,230 just-imported rows were invisible to the chart. Fixed at
     `341221bfa`.
  2. `/api/rental`'s own dashboard route independently reintroduced the *exact same* unbounded
     `.select()` / 1000-row cap bug described above (a different file, same bug class) — ordered by
     `event_date` ascending, so the truncation silently dropped the *most recent* years (2020–2026)
     specifically. Fixed at `7c6a05d92` by reusing `fetchAllOwnerFinancialEvents()`, with a
     dedicated regression test proving pagination past 1000 rows.
  3. Per Jason's direction, the "All Time" view now floors at 2014 (`EARLIEST_PORTFOLIO_YEAR`
     constant) rather than the earliest year with *any* safe event — a couple of stray pre-2014
     ledger entries were stretching the chart across a decade of empty years.
  - Final chart totals were reconciled exactly against a direct database query
    (`SELECT sum(amount) ... GROUP BY transaction_kind, source_system`) before calling this done.

## Active Worktrees

- `.claude/worktrees/rentec-financial-history-resume` — branch `feat/rentec-financial-history-resume`,
  HEAD `3289f2670`, clean, fully pushed, fully merged into `main`. No further work planned here
  unless new Rentec-import issues surface.
- `.claude/worktrees/forge-workspace-2-rental-summary` — branch
  `feat/forge-workspace-2-rental-summary`, kept in sync with `main` at `7c6a05d92`. No further work
  planned here.
- `.claude/worktrees/agent-handoff` — branch `chore/agent-handoff`, this file.

## Pending Decision

None outstanding. (The two RENTEC_API_KEY-in-Preview and property-slug-matching questions from the
previous version of this file are resolved: the import ran directly against Production per Jason's
explicit instruction, so the Preview-secret gap never blocked anything, and the property-slug
convention is confirmed correct by the import's own result — 13 years imported with the classifier
reporting `safeMissing` counts that reconciled exactly to Jason's pre-approved totals, and zero
`ambiguous`/`conflict` rows encountered.)

## Do Not Repeat

- Everything in the previous version of this section still holds (classifier evidence-group
  matching, no date-cutoff assumption, no ID-based CSV-row comparison, no `categoryNormalizer`
  fallback, no `slug()`-based property IDs for `financial_events`) — none of it changed.
- **Any new code that reads the full `financial_events` table for one owner must use
  `fetchAllOwnerFinancialEvents()`, never a bare `.select()`.** This bug class has now been found and
  fixed independently in three different files (both import routes, then the dashboard route) in a
  single day. Grep for `.from("financial_events")` before adding a fourth.
- Do not assume a chart/report branch is safe to deploy just because its own unit tests pass and it
  was reviewed against test fixtures — both UI-01 bugs above passed their own test suites and were
  only caught by spot-checking the live page against real Production data after deploy. Do that
  spot-check before considering a data-visualization branch done, not after.

## Safety Boundaries

No API keys, webhook secrets, passwords, JWTs, personal information, bank/card numbers, raw
Stripe/Rentec API responses, or production account/customer IDs belong in this file or in
`DECISIONS.md`. Record environment variable **names** and which environment(s) they're set in — never
values. Record sanitized counts/totals, never raw transaction payloads. If a future update to this
file needs to reference specific financial figures from a preview/report, use rounded or aggregate
figures only, and only what's already safe to show an owner-scoped UI.

## Roadmap Parking Lot

- 2026 `financial_events` shows `$0` from `forge_rental_payment` despite a small number of real
  `rental_payments` rows existing — flagged during the original audit, still not investigated. Worth
  a short, separate look.
- Preview/Production environment-variable parity gap — several Production-only secrets
  (`RENTEC_API_KEY`, `CRON_SECRET`, Stripe webhook secrets, notification/repository config) are still
  missing from Preview. Never became a blocker here because all real work ran directly against
  Production per Jason's explicit instruction, but the underlying parity gap is unaddressed.
- Residual provenance-hardening gap (noted in RENTEC-01-REVIEW, not part of that task's scope): the
  `approve_rentec_financial_history_import` RPC can technically be called directly by an authenticated
  owner with arbitrary structurally-valid rows labeled `rentec_api`, because the pre-existing
  `financial_events` INSERT policy already allows an owner to insert arbitrary owner-scoped events —
  not a new privilege escalation, but Rentec provenance isn't cryptographically enforced at the DB
  boundary. Still open.
- Simplifi CSV import (SIMPLIFI-01 design review, SIMPLIFI-02 build) — a fully separate track owned by
  Codex, untouched by any of this work. See `TASKS.md` for its current status.
