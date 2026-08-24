# FORGE Active Handoff

## Last Updated

2026-08-24T04:35Z — Claude Code (Sonnet 5) — branch `chore/agent-handoff`.

## Current Objective

**RENTEC-02, UI-01, the FORGE Workspace 2.0 visual rollout, and all three Roadmap Parking Lot items
from the previous version of this file are complete.** All available Rentec financial history
(2014–2026) is imported and verified; every Rental Manager panel (21 of them, not just the Summary
page) now uses the Workspace 2.0 visual language with full dark-mode support; the
`forge_rental_payment_adjustment` accounting gap is fixed; Preview/Production environment parity is
resolved per Jason's explicit policy; and `financial_events`' trusted-source provenance is now
enforced at the database level, not just by convention. Nothing is currently blocked.

## Production State

- `origin/main` SHA: `64ec62fd7` (linear history from `cb78ab313` through the provenance-hardening
  migration; every step pushed as a fast-forward, no rewritten history reached `main`). Note: `main`
  picked up two more unrelated Simplifi commits (`cc8bf3101`, `9751190ff`, Codex's track) in between —
  zero file overlap both times, handled by routine rebase/cherry-pick.
- Deployed Production SHA: `cb78ab313` is the last one confirmed live on all three domains (the
  provenance-hardening commit is a migration-only change with no application code, so it needed no
  redeploy — the migration itself was applied directly and independently verified, see below).
- Migrations: `20260824010000_harden_financial_events_trusted_source_provenance.sql` is **applied to
  Production** (`supabase db push --linked --yes`), verified by reading back the live `pg_policy` and
  `pg_proc` rows afterward (see "What Actually Happened" below) — not just trusted from the migration
  file. All prior migrations unchanged.
- Environment configuration — **updated this session** (see Roadmap Parking Lot for the decision
  record): `ACCOUNT_BALANCE_REPOSITORY`, `FINANCIAL_ACCOUNT_REPOSITORY`, `FINANCIAL_EVENT_REPOSITORY`,
  and `RENTAL_EMAIL_VERIFIED_DOMAIN` now exist in **Preview**, mirrored from their Production values
  (all four are non-sensitive config, not secrets). `CRON_SECRET` and
  `RENTAL_NOTIFICATION_DELIVERY_SECRET` now exist in **Preview** too, but as freshly generated values
  distinct from Production (never reused across environments). `RENTEC_API_KEY`, `RESEND_API_KEY`,
  `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`, and `STRIPE_WEBHOOK_SECRET_PLATFORM` remain
  Production-only **by explicit decision, not oversight** — see Roadmap Parking Lot.
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

## What Actually Happened (Workspace 2.0 rollout + roadmap items 1–2)

- **Workspace 2.0 visual rollout**: all 21 remaining Rental Manager panels (everything besides the
  Summary page, which was UI-01) converted to the same visual language — `rounded-3xl` card
  sections, the `goldControlClassName` pressed-control treatment for primary actions, consistent
  typography, and full `dark:` support (none of these panels had any dark-mode classes before).
  Purely presentational — no handler, data-fetch, or business-logic changes anywhere. Shipped as 4
  commits by nav group (Money, Portfolio, Operations, Controls). Every panel with existing tests
  passes unchanged; `RentalReportsPanel.jsx` (1,200+ lines, previously zero test coverage) got a new
  smoke test. Where a test asserted an exact className substring (lease status colors in
  `RentalLeasePanel.jsx`), the literal string was preserved and only `dark:` variants were appended
  alongside it. Full suite: same pre-existing `executeProgrammerCommand` failures only, nothing new.
  **Not visually spot-checked live** (no authenticated browser session available this session) —
  Jason should click through a few pages, especially Reports and Setup, when convenient.
- **Roadmap item 1 resolved — `forge_rental_payment_adjustment` fix**: investigating the parked "2026
  `forge_rental_payment` shows $0" note found the real, currently-live issue instead: a working DB
  trigger (`reconcile_rental_payment_reversal_trigger`, already existed, see
  `20260813003000_reconcile_rental_payment_reversals.sql`) posts an offsetting expense to
  `financial_events` whenever a FORGE-collected payment is refunded or disputed, under
  `source_system = 'forge_rental_payment_adjustment'` — but `buildRentalFinancialPerformance.js`'s
  `SAFE_EXPENSE_SOURCES` never included it, so a refunded payment kept counting as pure income in the
  Portfolio Performance chart. Confirmed live: a $1 test payment refunded during this session was
  still showing as $1 collected with no offset before the fix. Fixed and reconciled against the live
  database after deploy. Separately noted (not a bug, not touched): one `forge_rental_payment`
  `financial_events` row references a `rental_payments` id that no longer exists in that table — the
  row has full trigger-populated metadata (charge/lease/tenant/Stripe), so this looks like a test
  payment whose source row was later deleted directly while its financial-ledger entry was correctly
  left in place. Real financial history; left alone.
- **Roadmap item 2 resolved — Preview/Production environment parity**: see Roadmap Parking Lot for
  the decision record and Production State above for what changed.
- **Roadmap item 3 resolved — `financial_events` trusted-source provenance hardened**: the
  owner-scoped INSERT/UPDATE/DELETE RLS policies on `financial_events` had no restriction on
  `source_system`, so an authenticated owner could write a row directly through the Supabase client
  claiming `source_system = 'rentec_api'` (or `'rentec'`, or a FORGE-payment source) without that
  data ever actually coming from Rentec or a real payment — not a new privilege escalation (an owner
  already had full access to their own rows), but provenance was a convention, not something the
  database enforced. Mapped every write path into `financial_events` first: `forge_rental_payment`
  and its reversal were already `SECURITY DEFINER` triggers (unaffected);
  `approve_rentec_financial_history_import()` was `SECURITY INVOKER`, meaning its insert relied on
  the same open RLS policy as a raw client insert would — promoted to `SECURITY DEFINER` with
  `row_security = off` (its own checks — owner match, per-row validation, hardcoded
  `source_system`— were already sufficient and unchanged, matching the sibling triggers' existing
  pattern); the legacy `'rentec'` CSV bulk import has no live application write path at all
  (confirmed by grep). Migration `20260824010000_harden_financial_events_trusted_source_provenance.sql`
  tightens all three owner-scoped policies to `source_system = 'manual'` only (UPDATE and DELETE
  were tightened too, not just INSERT — otherwise an owner could retag an existing `'manual'` row to
  a trusted source_system after the fact via UPDATE, defeating the INSERT restriction entirely).
  Applied directly to Production and independently verified by reading back the live `pg_policy` and
  `pg_proc` rows afterward (not just trusted from the migration file) — see the exact `using`/`with
  check` expressions and `prosecdef`/`proconfig` values in git history of this session if needed.
  Pure migration, zero application code changed, so no redeploy was required.

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
- **A plain client-side (`SECURITY INVOKER`) write to `financial_events` can now only ever succeed
  with `source_system = 'manual'`** — the owner-scoped INSERT/UPDATE/DELETE RLS policies enforce
  this as of `20260824010000_harden_financial_events_trusted_source_provenance.sql`. Any new feature
  that needs to write a different `source_system` (a new import source, a new automated posting)
  must do it through a new or existing `SECURITY DEFINER` function/trigger with `row_security = off`
  that performs its own full validation — not by relying on RLS, and not by trying to loosen these
  policies back open.

## Safety Boundaries

No API keys, webhook secrets, passwords, JWTs, personal information, bank/card numbers, raw
Stripe/Rentec API responses, or production account/customer IDs belong in this file or in
`DECISIONS.md`. Record environment variable **names** and which environment(s) they're set in — never
values. Record sanitized counts/totals, never raw transaction payloads. If a future update to this
file needs to reference specific financial figures from a preview/report, use rounded or aggregate
figures only, and only what's already safe to show an owner-scoped UI.

## Roadmap Parking Lot

- **Resolved**: 2026 `forge_rental_payment` accounting gap — see "What Actually Happened" above.
- **Resolved**: Preview/Production environment-variable parity — Jason made an explicit two-part
  decision (2026-08-24): (1) internal secrets/config with no third-party dependency
  (`CRON_SECRET`, `RENTAL_NOTIFICATION_DELIVERY_SECRET`, `RENTAL_EMAIL_VERIFIED_DOMAIN`, and the
  three `*_REPOSITORY` config vars) should be added to Preview now — done, via `vercel env add`,
  non-sensitive config mirrored from Production, the two secrets freshly generated and distinct per
  environment (never reused across environments). (2) Real third-party credentials
  (`RENTEC_API_KEY`, `RESEND_API_KEY`, `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`,
  `STRIPE_WEBHOOK_SECRET_PLATFORM`) stay Production-only **by explicit decision** rather than being
  reused across environments or provisioned as separate vendor-scoped test credentials — this avoids
  giving any Preview deployment real Rentec/Stripe/Resend access. Verified each dependent code path
  already fails closed with a clear error when its variable is absent (e.g.
  `RentecApiClient` throws `"Rentec API key is not configured."` rather than crashing cryptically) —
  no code changes were needed, this was purely a documentation + env-var task. If this policy is ever
  revisited, it requires Jason's vendor-dashboard action (creating scoped test credentials in Rentec/
  Stripe/Resend); no agent can do that.
- **Resolved**: `financial_events` trusted-source provenance — see "What Actually Happened" above.
  All three items originally parked in this section are now closed.
- Simplifi CSV import (SIMPLIFI-01 design review, SIMPLIFI-02 build) — a fully separate track owned by
  Codex, untouched by any of this work. See `TASKS.md` for its current status.
