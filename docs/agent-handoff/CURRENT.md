# FORGE Active Handoff

## Last Updated

2026-08-25T05:35Z — Claude Code (Sonnet 5) — branch `chore/agent-handoff`. Work paused at Jason's
explicit request for this refresh; no further fixes/migrations/imports/merges/deploys were started
after this point.

## Status At A Glance

| Area | Status | One-line summary |
|------|--------|-------------------|
| Simplifi duplicate-import defect | **Done** | 301 duplicate `financial_events` found and soft-deleted directly against Production (data-only fix, no code branch). Idempotency proven. |
| Simplifi 172-recovered-rows claim | **Unverified** | Does not reconcile against any figure this session could derive. See Simplifi section. |
| Simplifi 52 rows / 17 accounts never reviewed | **Ready** (needs a scope decision) | Vehicle/crypto/tool "accounts" bootstrapped by Simplifi import, never submitted to any approval batch. Not a bug — likely correct to exclude, not confirmed. |
| Financial FORGE — personal/business blending | **Done** | Fixed and deployed, PR #15. |
| Financial FORGE — KPI ÷100 display bug | **Done** | Fixed and deployed, PR #18. |
| Financial FORGE — "Monthly Profit" mislabeling | **Ready** | Confirmed defect, not yet fixed. See Financial FORGE section. |
| Property document library | **Done** | Built, deployed, verified live (PR #13). |
| Image-compression upload fix | **Done** | Built, deployed, verified live (PR #14). |
| Vision OCR credentials | **Done** | Provisioned and verified live end-to-end (PR #19 + Vercel env var + real service-account key). |
| Manual account balance entry | **Done** | Built, deployed, verified live (PR #17). |

## A. Simplifi — Fingerprint/Duplicate Defect

**Fact, independently re-verified 2026-08-25 against the live database** (all counts below are from
`supabase db query --linked`, re-run immediately before writing this file, not carried over from
memory):

- Original source CSV: **4,829 rows**. Verified two ways: (1) `parseSimplifiCsv()` (current, fixed
  parser) against the real file gives `row_count: 4829`; (2) that file's own SHA-256
  (`f9fb14fb...bd55ff1`) matches the `file_hash` recorded on all 12 of the owner's approval batches
  in `simplifi_import_batches` — i.e. this is provably the exact byte-identical file that was
  actually approved, not a guess or a re-export.
- **True unique approvable rows: 4,327** (1,272 business + 3,055 personal). This reconciles exactly
  with the "4,327" figure Jason had cited as the original target.
- **Defect found**: a v1→v2 fingerprint "recovery" pass (run across 7 of the 12 approval batches, all
  timestamped 2026-08-24T18:10–18:19Z) failed to recognize 301 rows that had already been imported
  under the old v1 fingerprint scheme, and re-imported them under new v2 fingerprints as if new.
  Confirmed with a concrete example: "Tst* Nothing Bundt Cakes", $50.18, Chase Credit Card,
  2026-08-17 — exactly one row in the source CSV, but two `financial_events` (one `v1:d9fc8c38...`
  created 17:39:10, one `v2:9efc2402...` created 18:10:45). Generalized by cross-checking all 4,628
  then-active Simplifi `financial_events` against real CSV occurrence counts (grouped by account +
  date + amount + payee + category, sign-corrected): exactly 301 rows existed in the database more
  times than the CSV supports, zero rows existed with no CSV match at all (so nothing was
  fabricated — every event traces to a real row, 301 of them just doubled).
- **Fix applied**: **data-only correction, no code branch or commit** — this was not a code defect
  (the running approval code is fine going forward, see idempotency proof below), it was 301 bad
  rows already sitting in the table. Corrected by soft-deleting (never hard-deleted) the
  later-created copy of each of the 301 confirmed duplicate pairs, via a single `UPDATE ... WHERE id
  IN (<301 exact ids>) AND source_system = 'quicken_simplifi_csv' AND is_deleted = false` run
  directly against Production through `supabase db query --linked`. Executed 2026-08-24. Not merged
  anywhere because there is nothing to merge — no application code changed.
- **Current financial_events state for `source_system = 'quicken_simplifi_csv'`** (re-verified
  2026-08-25, unchanged since the correction — nothing has touched this data since): **4,327 active**
  (1,272 business / 3,055 personal), **301 soft-deleted** (`is_deleted = true`, `deleted_at` set,
  `updated_by = 'data_correction:simplifi_duplicate_cleanup_2026-08-24'`), total rows tagged with
  this source ever created = 4,628.
- **Rows still missing/approvable after the correction: 0.** Cross-checking the 4,327 active rows
  against the real CSV a second time (after the correction) found zero excess groups, zero
  unmatched rows — every one of the 4,327 approved business+personal rows is now represented exactly
  once.
- **Separately, not a defect**: **52 CSV rows across 17 Simplifi-bootstrapped accounts were never
  submitted to any approval batch at all** — zero `financial_events` exist for them, zero
  `simplifi_import_rows` audit entries exist for them. These 17 accounts read as
  net-worth/asset-tracking entries Simplifi itself creates (e.g. "2016 Lexus GX 460", "XRP",
  "Tractor", "Box Trailer", "Card Ladder") rather than real transaction accounts — plausibly correct
  to exclude from P&L entirely, but this was never an explicit decision, just an absence. **Ready**
  for someone to make an explicit call: either confirm exclusion is correct and document why, or
  decide these need reviewing.
- **"Were all 172 previously skipped transactions recovered?" — cannot be confirmed.** No dataset
  available this session reconciles to "172". What can be shown: the v1-only pass captured 1,500
  distinct real transactions; the later v2 pass added 2,827 *additional* distinct real transactions
  beyond that (before accounting for the 301-row duplicate defect above) — 1,500 + 2,827 = 4,327,
  the correct final total. If "172" referred to some earlier, narrower recovery check from before
  this session, its relationship to the 2,827 figure is unknown — flagging as **unverified**, not
  asserting it's wrong.
- **Simplifi audit table (`simplifi_import_rows`) — unchanged by the correction** (this table was
  never written to as part of the fix, only `financial_events` was): 5,320 total rows across 12
  approval batches, 4,628 distinct fingerprints, zero orphaned rows, zero rows with a null
  `linked_financial_event_id`.
- **Idempotency — proven two ways**:
  1. Empirically: re-running the exact same corrective `UPDATE` a second time affects **0 rows**
     (the `is_deleted = false` guard in its `WHERE` clause makes it naturally idempotent).
  2. By code inspection: `fetchAllOwnerSimplifiFingerprints()` (used by both the preview and approve
     routes to compute "already imported") reads `financial_events.source_record_id` with **no**
     `is_deleted` filter — so the 301 soft-deleted rows' fingerprints remain in that "already seen"
     set. A future preview/approve run will still recognize all 4,628 historically-seen fingerprints
     (the 4,327 active ones and the 301 corrected ones) as already-imported and will not recreate
     them. No code change was needed for this guarantee; it fell out of using soft-delete rather than
     hard-delete.
- **Nothing is currently paused.** The Simplifi import is in a fully reconciled, idempotency-proven
  state. The only open item is the 52-row/17-account scope decision above, which was never started,
  not paused.

## B. Financial FORGE

- **Simplifi sources are included in the read models — yes, and this was the actual root defect**,
  not missing data. `SupabaseFinancialEventRepository.toFinancialEvent()` was silently dropping
  `business_scope` when mapping DB rows into domain objects, and
  `FinancialEventAggregationService.aggregate()` never filtered by scope at all — every dashboard
  variant (financial/business/investor/kpi/executive) summed **all** activity together. With 3,055
  personal Simplifi rows vs. 1,272 business rows, personal activity dominated every "business" total
  and NOI figure. **Fixed and deployed, PR #15** (merged `2026-08-25T00:32Z`): the repository now
  carries `business_scope` through; `aggregate(events, { scope })` accepts an optional filter;
  `FinancialReadModelApplication` defaults every dashboard builder to `scope: "business"` unless a
  caller explicitly asks for `"personal"` or `"all"`.
- **Second confirmed defect, unrelated to the first, found while verifying PR #15/#17 live**: the
  page-level `money()` formatter (`src/app/forge/financial/page.js`) divided every dollar KPI by 100
  before display, on the mistaken assumption its inputs were cents. They were always real dollar
  figures. Verified directly against the database: real all-time business revenue is
  **$4,200,210.70**, matching the API's raw `kpis.revenue` value exactly — the dashboard had been
  showing **1/100th of every real number** (Net Worth, Cash, "Monthly Profit", Revenue, Expenses)
  since this page existed. **Fixed and deployed, PR #18** (merged `2026-08-25T01:38Z`).
- **Which totals/charts are now live vs. still a known placeholder**:
  - **Live, real, verified against the database**: Net Worth/Equity, Cash, Revenue, Expenses, Profit
    Margin, the income-vs-expense chart (6 Months/YTD/Year/All Time + year selector), income trend
    charts (trailing-6-months and YTD), expense category breakdown, "imported activity by account"
    reconciliation table, business/personal toggle, data-coverage notice.
  - **Deliberately still `null`/unavailable, not fabricated**: `receivables` (no receivables source
    exists yet); detailed balance-sheet `metrics`/`insights` (explicitly tagged
    `unavailable-without-canonical-ledger-position` / `unavailable-without-financial-metrics` in the
    API response itself — this is intentional, matching the "no invented numbers" requirement, not a
    bug).
  - **Known remaining defect, not yet fixed**: the top KPI card labeled **"Monthly Profit" is
    mislabeled — it actually displays an all-time total** (no period scoping exists at that specific
    call site), currently showing ~$1,194,979 (all-time NOI) under a "Monthly" label. The newer
    "Financial activity" panel directly below it *does* have real period controls and does not have
    this problem — only the older top-of-page KPI header does.
- **Manual account-balance entry — built and deployed, PR #17** (merged `2026-08-25T01:30Z`): the
  read path for Net Worth/Cash (`FinancialPositionQueryService`,
  `FinancialPositionReadModelAdapter`, `account_balances` table,
  `SupabaseAccountBalanceRepository`) was already fully built with no write path — `account_balances`
  had zero rows for this owner. Added `GET/POST /api/financial/account-balances`. Bug fix bundled in
  the same PR: the "Cash" KPI filtered on `category === "cash"`, a value no account in this database
  has ever actually had (every Simplifi-bootstrapped account's `subtype` is hardcoded
  `"csv_import"`) — changed to filter on `account_type === "depository"`, matching Plaid's real
  taxonomy directly. **Architected so Plaid becomes source of truth automatically, no new code
  needed for that**: the repository already keeps only the latest-`as_of` balance per account
  regardless of provider, and the POST route explicitly refuses to let a manual entry overwrite an
  account whose latest balance already comes from a non-manual provider.
- **Next bounded implementation task**: fix the "Monthly Profit" mislabeling above — either rename
  the card to reflect that it's an all-time total, or wire it to a real current-month figure. Small,
  isolated, no schema/migration involved.

## C. Property Documents

- **Standardized document library — built, deployed, verified live, PR #13** (merged
  `2026-08-24T21:27Z`): extends the existing `rental_documents` table/system rather than creating a
  second one. Adds `property_id` (nullable `lease_id`, so a document can be property-only), 15
  standardized categories, generated-column full-text search (`tsvector`, weighted
  title/description/extracted_text), version history (`version_of_document_id` always points at the
  family root), expiration reminders, and an append-only audit log
  (`rental_document_audit_log`). Text extraction: native PDF text via `unpdf` tried first, Google
  Cloud Vision OCR as fallback for scans/images — always best-effort, never blocks an upload.
- **Image-compression upload fix — built, deployed, verified live, PR #14** (merged
  `2026-08-24T21:53Z`): a real-world 7.06 MB phone-camera photo failed with HTTP 413 (platform body
  size limit, hit before the app's own 10 MB limit ever ran). Fixed with client-side
  downscale/re-encode (`compressImageFile.js`) for any image over 2 MB before upload; non-image
  files pass through untouched.
- **Real documents successfully uploaded**: 930 Highland Drive's boundary survey/plat, **two
  versions**, both preserved:
  - **v1** (`rental_document_7fbf045f-2390-4539-9342-ad7b521e70d3`) — uploaded 2026-08-24 after the
    compression fix shipped (7.06 MB → 489 KB, no 413). `extracted_text` is `null` — uploaded
    *before* Vision OCR credentials existed in this environment, so extraction silently failed
    (best-effort, did not block the upload). Not current version, preserved for history.
  - **v2** (`rental_document_1847f927-e859-4ba0-8d39-254664410435`) — uploaded 2026-08-25 as a new
    version specifically to verify OCR after credentials were wired up. `extracted_text` populated,
    1,823 characters of real, accurate survey content (bearings, lot dimensions, setback lines,
    street names). Current version.
  - Both: `property_id = "930 Highland Drive"`, `category = "survey_plat"`, `tenant_visible = false`
    (private — correctly never tenant-visible for a property-only document, enforced by a DB
    constraint, not just application logic).
- **Vision OCR credentials — provisioned and verified working end-to-end, 2026-08-25.** Root cause
  of "OCR never worked": `ImageAnnotatorClient()`'s default (no-args) credential resolution only
  works via `GOOGLE_APPLICATION_CREDENTIALS` pointing at a *file*, the GCE/GKE metadata server, or a
  local `gcloud` login — none of which exist on Vercel Functions. Fixed in **PR #19** (merged
  `2026-08-25T05:17Z`): `GOOGLE_CLOUD_VISION_CREDENTIALS` env var now holds the full service-account
  key JSON directly, parsed and passed to the client explicitly when present. A dedicated GCP service
  account (`forge-document-ocr@project-b3552b1b-749e-4413-989.iam.gserviceaccount.com`, scoped to
  Cloud Vision API only) was created, its key added to Vercel Production as a sensitive env var, and
  production redeployed. Verified by uploading survey/plat v2 above and confirming real extracted
  text landed in the database.
- **Nothing currently failing** in this area.

## D. Repository / Production

- **`origin/main` HEAD**: `fb1ed7b41` ("Merge pull request #19 from onyxgolden/feat-ocr-credentials-env").
- **Merged PRs this session, in order** (all via the standard branch → PR → CI-green → merge flow,
  `--merge` strategy, branches left undeleted): #4 `42b5950ff`, #6 `0c1bfd2fc`, #7 `310644506`, #8
  `9f18cc3f5`, #9 `0d4f7447a`, #10 `c6fe7b3f8`, #11 `79ebf80f5`, #12 `f67d51461`, #13 `f08daec4e`,
  #14 `28aec9182`, #15 `4bcd995db`, #16 `9d45fb84d`, #17 `e6d64b5b6`, #18 `6749fd7e6`, #19
  `fb1ed7b41`.
- **Working tree**: clean on every branch touched this session; this handoff update is the only
  uncommitted work at pause time.
- **Latest Production deployment**: `https://marketplace409-ml8rkxzyg-jason-morgan-s-projects.vercel.app`,
  status **Ready**, aliased to `www.409marketplace.online` / `409marketplace.online` /
  `marketplace409.vercel.app`. This is the redeploy that picked up the `GOOGLE_CLOUD_VISION_CREDENTIALS`
  env var (PR #19's code was already live from an earlier auto-deploy; this redeploy was needed
  specifically so the new env var took effect, since Vercel bakes env vars in at build time).
- **Migrations**: `origin/main`'s `supabase/migrations/` tree matches Supabase's applied-migrations
  list exactly through `20260825000000_extend_rental_document_library.sql` — **nothing pending**.
  (Note: the 301-row Simplifi correction in section A was a data `UPDATE`, not a migration — it has
  no migration file, by design, since it corrected existing rows rather than changing schema.)
- **Tests**: fresh full-suite run against `origin/main` HEAD (`fb1ed7b41`, detached checkout,
  2026-08-25): **4,408 / 4,428 passing**. All 20 failures are pre-existing and unrelated to any work
  this session — `src/infrastructure/developer/executeProgrammerCommand.test.js`, all failing with
  `"No validation evidence directory exists."`, a filesystem-dependent test fixture issue confirmed
  present on `origin/main` independent of any branch this session touched.
- **Build**: local production build (`next build`) is **blocked in this environment** — `vercel env
  pull` redacts secret values to the literal string `"[SENSITIVE]"` here, so any route touching
  Supabase fails static analysis locally regardless of code correctness. This is a pre-existing
  environment limitation, not a code defect. Every merged PR's real Vercel CI build (with actual
  production credentials) succeeded — that was used as the authoritative build check throughout,
  per established practice.
- **Unresolved defects / concrete blockers, complete list**:
  1. "Monthly Profit" KPI mislabeling (Financial FORGE section B) — confirmed defect, small, not
     fixed.
  2. 52 CSV rows / 17 Simplifi accounts never submitted for approval (Simplifi section A) — needs an
     explicit scope decision, not a bug.
  3. "172 previously skipped transactions recovered" — unverifiable with available data, flagged not
     resolved.
  4. Local production build blocked by this environment's credential redaction — environmental, not
     app-level; no action possible from inside this environment.
  5. `ASSETS-01` and `SIMPLIFI-01` design docs (Codex's track) sit in TASKS.md "Review Ready" awaiting
     Jason/Claude review — untouched by this session's work.
  6. A markdown-formatting bug in the previous version of `TASKS.md`'s "Review Ready" table (a
     literal `\n` instead of a real newline collapsed two rows into one) — fixed while updating this
     file.

## Active Worktrees

- `.claude/worktrees/rentec-financial-history-resume` — this session's worktree. Currently on branch
  `agent-handoff-update` (tracking `origin/chore/agent-handoff`) specifically to prepare this
  documentation update without colliding with the `chore/agent-handoff` branch name, which is
  already checked out in a different, separate worktree (`.claude/worktrees/agent-handoff`) —
  presumably another concurrent session's. No application code was changed while on this branch.
- `.claude/worktrees/agent-handoff` — branch `chore/agent-handoff`, owned by a different worktree/
  session than this one as of this update.

## Pending Decision

- The 52-row/17-account Simplifi scope question (section A) needs a human or agent decision:
  confirm these Simplifi-bootstrapped "accounts" (vehicles, crypto, tools, trailers) are correctly
  out of scope for P&L import, or decide they need review.
- Whether to fix the "Monthly Profit" mislabel now or leave it queued (section B) — small, no
  dependencies, safe to pick up independently.

## Do Not Repeat

- Everything in prior versions of this section still holds (classifier evidence-group matching, no
  date-cutoff assumption, no ID-based CSV-row comparison, no `categoryNormalizer` fallback, no
  `slug()`-based property IDs for `financial_events`, always use `fetchAllOwnerFinancialEvents()`
  for any full-table read, spot-check a data-visualization branch against live Production data
  before calling it done, never rely on RLS for a new `financial_events` write path — use a
  `SECURITY DEFINER` function with its own validation instead).
- **The Simplifi RLS/`SECURITY DEFINER` incident described in earlier versions of this file is
  resolved** — `approve_simplifi_csv_import()` was promoted to `SECURITY DEFINER` (migration
  `20260824020000_fix_simplifi_approval_security.sql`, already applied and deployed before this
  session began) before the 12 approval batches referenced throughout section A ever ran. Do not
  re-investigate this as if it were still active; the current, different defect was the v1→v2
  fingerprint recovery gap described above, now corrected.
- **When cross-checking imported financial data against a source file, verify the file is
  byte-identical to what was actually approved (`sha256sum` against the recorded `file_hash`) before
  trusting any comparison against it.** This session found a local copy that matched exactly, but
  that match was verified, not assumed.
- **Distinguish "amount is unsigned dollars" from "amount is cents" explicitly at every display
  boundary.** The `money()` bug in section B existed because a formatter assumed its input was cents
  when it was always dollars — this class of bug is easy to introduce again wherever a new dollar
  figure is threaded through to a presentation layer without an explicit, tested contract for its
  unit.
- **A local production build in this environment cannot be trusted as a pass/fail signal** — it fails
  on `vercel env pull`'s credential redaction regardless of code correctness. Use the real Vercel CI
  build on the PR as the authoritative check.

## Safety Boundaries

No API keys, webhook secrets, passwords, JWTs, personal information, bank/card numbers, raw
Stripe/Rentec/Google Cloud API responses or key material, or production account/customer IDs belong
in this file or in `DECISIONS.md`. Record environment variable **names** and which environment(s)
they're set in — never values. Record sanitized counts/totals, never raw transaction payloads. This
file already includes real aggregate dollar figures for this specific owner's own portfolio, at
their own explicit direction throughout this session (e.g. "$4,200,210.70", "$703,914.10") — that
practice continues here, but stays bounded to aggregates/counts, never a raw per-transaction payload,
account number, or credential.

## Roadmap Parking Lot

- **Resolved this update**: Simplifi duplicate-import defect (301 rows), Financial FORGE
  personal/business blending, Financial FORGE KPI ÷100 display bug, property document library +
  image-compression fix + Vision OCR credentials, manual account-balance entry.
- **Still open**: "Monthly Profit" mislabel (Financial FORGE), 52-row/17-account Simplifi scope
  decision, `ASSETS-01`/`SIMPLIFI-01` design-doc review (Codex's track).
