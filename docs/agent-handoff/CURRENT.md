# FORGE Active Handoff

## Last Updated

2026-08-23T19:16Z — Claude Code (Sonnet 5) — branch `chore/agent-handoff` — HEAD (pending this commit).

## Current Objective

Resume the Rentec financial-history import: `financial_events` has continuous, real Rentec transaction
history only through 2018 (100% imported) and partially through 2019 (~94%) and 2020 (~11%); it is
empty for 2021–2026 even though Rentec itself has continuous transaction history 2005–2026. A
read-only preview + owner-approved import pipeline has been built on a feature branch to safely fill
that gap via the live Rentec transaction API, without disturbing the existing rental-payment
(`rental_payments`/`rent_charges`) domain. The pipeline is built, tested, and pushed; it is currently
blocked on a missing Preview-environment secret before the real production preview numbers can be
generated (see Pending Decision).

## Production State

- `origin/main` SHA: `327b8b025ade68200857ce50f2b24ab43ff092fe`
- Deployed Production SHA: `327b8b025ade68200857ce50f2b24ab43ff092fe` (confirmed via
  `vercel ls --meta githubCommitSha=...` — Production is current with `origin/main`, no drift)
- Migrations: local files exist through `20260823000000_add_rentec_financial_history_import.sql`.
  `20260714_create_financial_events.sql` is confirmed applied in Production (verified functionally —
  real report endpoints backed by `financial_events` return real data). Application status of
  migrations between that one and the newest was **not independently re-verified this session** (no
  raw DB/SQL access available); treat as presumed-applied via normal deploy history unless checked.
  `20260823000000_add_rentec_financial_history_import.sql` is explicitly **not applied anywhere** —
  its own header says so, and it lives only on the unmerged `feat/rentec-financial-history-resume`
  branch.
- Environment configuration (variable **names** only, `vercel env ls`, no values retrieved):
  - **Production-only, missing from Preview** — `RENTEC_API_KEY`, `CRON_SECRET`,
    `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PLATFORM`,
    `RENTAL_EMAIL_VERIFIED_DOMAIN`, `RENTAL_NOTIFICATION_DELIVERY_SECRET`, `RESEND_API_KEY`,
    `ACCOUNT_BALANCE_REPOSITORY`, `FINANCIAL_ACCOUNT_REPOSITORY`, `FINANCIAL_EVENT_REPOSITORY`.
    This is a real Preview/Production parity gap, not specific to Rentec — any Preview deployment
    that exercises one of these paths will fail the same way `RENTEC_API_KEY` did.
  - **Present in both Preview and Production** — `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_MODE`,
    `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
    `PLAID_ENV`, `PLAID_SECRET`, `PLAID_CLIENT_ID`, `CONNECTION_REPOSITORY`,
    `CONNECTION_EXECUTION_HISTORY_REPOSITORY`, `INSTITUTION_REFERENCE_REPOSITORY`,
    `CREDENTIAL_REFERENCE_REPOSITORY`, `CREDENTIAL_VAULT_REPOSITORY`.
  - Preview and Production point at the **same Supabase project** (same `financial_events` table,
    same real data) — there is no separate staging database.
- Safety state (billing pause / external schedule status): **not independently verified this
  session** — do not assume a particular state without checking `rental_billing_settings` /
  `rent_schedules` directly.

## Active Worktree

- Path: `/home/jason/USMarketplace/marketplace409/.claude/worktrees/rentec-financial-history-resume`
- Branch: `feat/rentec-financial-history-resume`
- HEAD: `f4ab9d01ba1d7cbd32e2060638f1e2e96db2d2ec`
- Clean, fully pushed (`origin/feat/rentec-financial-history-resume` matches HEAD). No modified files
  pending.
- A second worktree also has completed, unpushed work: `.claude/worktrees/forge-workspace-2-rental-summary`
  on `feat/forge-workspace-2-rental-summary`, HEAD `8022b0b0e`, clean, **not pushed** (Workspace 2.0
  Portfolio Performance chart — metallic treatment + real data-coverage-gap labeling). Deliberately
  left unpushed pending Jason's UI approval; unrelated to the Rentec importer.

## Completed This Session

- `8022b0b0e` (`feat/forge-workspace-2-rental-summary`, unpushed) — Portfolio Performance chart shows
  real per-year data-coverage gaps (no fabricated continuous history), plus the metallic visual
  treatment.
- `f4ab9d01b` (`feat/rentec-financial-history-resume`, pushed) — Rentec financial-history resume
  importer:
  - `RentecApiClient.financialHistoryTransactions()` — real per-transaction/split identity plus the
    six previously-unsupported provenance fields (`bank_id`, `owner_id`, `vendor_id`, `check_num`,
    `pmt_type`, `notes`); never returns raw `description`/`memo`.
  - `buildRentecFinancialHistoryImportPreview()` — pure classifier: composite
    `{transactionId}:{splitId|"none"}` identity; fail-closed category mapping (direct `CATEGORY_MAP`
    lookup, not the normalizer's silent "other" fallback); evidence-based matching against the legacy
    CSV-imported rows (property + date + amount + direction + category, since those rows have no real
    Rentec ID to compare against); classifies every row as alreadyRepresented / safeMissing /
    ambiguous / conflict / unsupported.
  - `POST /api/rental/rentec-financial-history-import-preview` — read-only, zero writes, scans every
    Rentec property including archived ones.
  - `POST /api/rental/rentec-financial-history-import-approve` — re-fetches Rentec and recomputes the
    classification fresh server-side before writing; only ever imports rows the fresh recomputation
    confirms as `safeMissing`; ambiguous/conflict rows can never be bulk-approved.
  - `20260823000000_add_rentec_financial_history_import.sql` — new owner-scoped audit table
    (`rentec_financial_history_import_batches`) + `approve_rentec_financial_history_import()` RPC
    (security invoker, idempotent via `financial_events`' own unique index, fails closed on
    structurally invalid rows). **Not applied anywhere.** Never touches `rental_payments`,
    `rent_charges`, settlements, or reconciliation-approval tables.

## Verification

- Focused tests (classifier + both routes + Rentec client): 98/98 passed.
- Broader financial/rental-scoped suite (`src/domains`, `src/application/rental`,
  `src/application/financial`, `src/app/api/rental`): 1907/1907 passed.
- Full repo suite: 4038/4058 passed. 20 failures across 3 files, all **pre-existing and unrelated**:
  - `scripts/governance/__tests__/validateGovernanceArchitecture.test.mjs` and
    `validateGovernanceRelationships.test.mjs` — failed only because the local (gitignored)
    `governance/validation/` directory didn't exist in this fresh worktree checkout; creating the
    empty directory (no tracked-file change) made both pass.
  - `src/infrastructure/developer/executeProgrammerCommand.test.js` — 18 failures, all
    "No validation evidence artifact is available" — requires a populated evidence artifact from a
    real prior CI run that doesn't exist in a fresh worktree. Not fixed; flagged as a known
    environment-setup gap, unrelated to any feature code.
- Production build (`next build`, Turbopack): succeeded. Both new routes appear in the route
  manifest. Required a real local `npm ci` in the worktree (a `node_modules` symlink to the main
  checkout is rejected by Turbopack as "outside the filesystem root").
- `git diff --check` (staged, including new files): clean, 0 issues.
- One data-integrity bug caught and fixed during this work: a test helper (`csvEvent()` in the
  classifier test file) silently dropped its `overrides` parameter, masking a false-pass on the
  soft-delete-filtering test. Fixed before commit.
- One file-corruption bug caught and fixed: the classifier source file was written with a single
  stray null byte inside a string literal (`" \x00nassigned"` instead of a plain space), which made
  `git`/`file` treat the whole file as binary. Rewritten clean; verified zero null bytes and valid
  UTF-8 across every new/modified file in the commit before committing.

## Pending Decision

1. **RENTEC_API_KEY missing from Preview.** The Preview deployment for
   `feat/rentec-financial-history-resume` (commit `f4ab9d01b`, URL:
   `https://marketplace409-7fn3kdcz7-jason-morgan-s-projects.vercel.app`) cannot run the new preview
   endpoint (or the existing `rentec-payment-import-preview`) until either (a) Jason adds
   `RENTEC_API_KEY` to the Preview environment himself, or (b) Jason chooses to run this preview-only,
   zero-write code against Production directly instead. No environment variable has been changed by
   any agent — this requires Jason's explicit choice.
2. Once real preview data is available: does the address-based property-slug convention
   (`PropertyId.fromSourceName(address)`) actually match what the historical CSV import used? This
   was not independently confirmed against production `financial_events.property_id` values (no
   authenticated browser session or DB access was available this session) — it is the same function
   (`PropertyResolverService.fromSourceName`) the old CSV importer used, so it should match, but the
   real preview report's classification counts for the known-good 2018/2019 baseline years are the
   actual proof: if the vast majority of those years' Rentec transactions come back
   `alreadyRepresented` rather than `safeMissing`/`ambiguous`, the slug convention is confirmed
   correct.
3. Whether/when to push and deploy `feat/forge-workspace-2-rental-summary` (`8022b0b0e`) — held back
   pending Jason's UI approval, independent of the Rentec work above.
4. Whether to actually run the approval endpoint against Production at all yet — nothing has been
   approved/imported; that requires a separate, explicit go-ahead after the preview totals have been
   reviewed.

## Exact Next Action

Once Jason resolves the `RENTEC_API_KEY` Preview/Production decision above: call
`POST /api/rental/rentec-financial-history-import-preview` (read-only) as an authenticated owner, and
report the sanitized totals — already-represented / safe-missing / ambiguous / conflict / unsupported
counts and totals by year, plus expected post-import totals by year. **Stop after reporting those
numbers.** Do not call the approve endpoint, do not apply the pending migration, do not deploy to
Production, and do not merge to `main` without a separate, explicit instruction to do so.

## Do Not Repeat

- Do not re-assume "2018 one month / 2019 all twelve months / 2020 one month" as the historical
  import's coverage — that premise was checked against live Rentec and found wrong. Actual: 2018 is
  100% imported (exact match to Rentec); 2019 is ~94% imported; 2020 is ~11% imported; Rentec's own
  history is continuous 2005–2026 with no source-side gap. The gap 2021–2026 is real but lives only in
  `financial_events`.
- Do not assume `2020-07-01` (or any single date) is the import boundary — the 2019 shortfall means
  missing records can exist before the apparent 2020 cutoff too. The importer intentionally does not
  use a date cutoff; it classifies every transaction individually.
- Do not compare the historical CSV import's rows to live Rentec data by ID — its
  `source_record_id` (`"rentec-{date}-{csvRowIndex}-{income|expense}"`) has no relationship to
  Rentec's real `transaction_id`/`split_id`. Only evidence-based matching (property + date + amount +
  direction + category) works against those rows.
- Do not use `categoryNormalizer.normalize()`'s fallback for classification — it silently defaults an
  unmapped category to `{normalizedCategory: "other", transactionKind: "expense"}`. The importer
  checks `CATEGORY_MAP` membership directly and fails closed (`unsupported`) instead.
- Do not use the `slug()` helper from `rentec-import-manifest.preview.js` (street-suffix-stripping) for
  anything that writes to `financial_events.property_id` — that scheme is only used by
  `rental_units.property_id` and is incompatible with the existing `financial_events` rows, which use
  `PropertyId.fromSourceName()` (no street-suffix stripping).
- The `governance/validation` directory and `executeProgrammerCommand` evidence-artifact test failures
  (see Verification) are a pre-existing fresh-worktree gap, not a regression from any feature branch —
  don't re-diagnose them per branch.

## Safety Boundaries

No API keys, webhook secrets, passwords, JWTs, personal information, bank/card numbers, raw
Stripe/Rentec API responses, or production account/customer IDs belong in this file or in
`DECISIONS.md`. Record environment variable **names** and which environment(s) they're set in — never
values. Record sanitized counts/totals, never raw transaction payloads. If a future update to this
file needs to reference specific financial figures from a preview/report, use rounded or aggregate
figures only, and only what's already safe to show an owner-scoped UI.

## Roadmap Parking Lot

- 2026 `financial_events` shows `$0` from `forge_rental_payment` despite earlier references to a
  small number of real `rental_payments` rows existing — flagged during the original audit, explicitly
  not chased (out of scope). Worth a short, separate investigation.
- Preview/Production environment-variable parity gap (see Production State) — several
  Production-only secrets are missing from Preview beyond `RENTEC_API_KEY`. Worth deciding as a
  policy: either provision Preview with safe/scoped equivalents, or document which routes are
  Production-only by design.
