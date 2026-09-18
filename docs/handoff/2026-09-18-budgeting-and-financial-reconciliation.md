# Handoff: FORGE personal budgeting + financial reconciliation

**Date:** 2026-09-18
**Handed off from:** Claude Code session (hit rate limits repeatedly; Jason is using this as a
cross-tool handoff so ChatGPT or "Muse" can continue without re-deriving everything below)
**Repo:** `marketplace409` (409 Marketplace / FORGE)
**Owner/user:** Jason Morgan, `owner_id = e1b22131-9100-4a79-bbe2-b82d43af922e`
**Supabase project ref:** `bzqvenxjlstinmgbuvvg`

## Read this first

Jason asked for a personal budgeting feature ("EveryDollar-style"). Building it exposed several
real, pre-existing data-quality bugs in FORGE's financial pipeline that had nothing to do with
budgeting per se — those got fixed along the way because the budget numbers were wrong without
them. **The very last thing found (see "Open problem" below) is a real bug that blocks further
progress and needs solving before anything else in this area should be trusted.**

## What shipped (merged to `main`, deployed to production)

All of these are real, live, on `https://www.409marketplace.online`:

1. **PR #208** — Personal budgeting foundation: `budget_categories` / `budget_monthly_allocations`
   tables, history-based suggestion engine (median of last 3 months per category), `/forge/budget`
   UI.
2. **PR #209** — Budget summary bar (income/planned/actual/unassigned) + debt-payoff and
   savings/investment "where should this go" nudges.
3. **PR #210** — Table redesign for the budget line list, per-category notes, two SVG pie charts
   (income by source, planned by category), rename/archive (soft-delete) for categories.
4. **PR #211** — Fixed `financial_events.business_scope` defaulting to `'business'` for every
   Plaid/Stripe-Financial-Connections-imported transaction regardless of the real account (DB
   column default bug — the import code never set it explicitly). Added
   `financial_accounts.business_scope`, backfilled via a name heuristic ("business" in account
   name → business, else personal), fixed the import pipeline to set it going forward.
5. **PR #212** — Fixed a duplicate migration timestamp collision between #210 and #211 (pure
   rename, no logic change).
6. **PR #213** — Duplicate-transaction reconciliation: the same real Rentec-tracked rent/repair/tax
   transactions were also landing a second time via the raw DuGood/Capital One bank feed
   (`source_system='transaction'`), generically categorized and mis-signed. Built a conservative
   matcher (only exact, unambiguous date+amount matches) + a human-gated review panel on
   `/forge/connections` (checkbox + type "CONFIRM" before anything writes). **Jason applied this
   panel — 20 duplicates marked, confirmed via `financial_events.duplicate_of_event_id`.**
7. **PR #214** — Fixed the raw bank feed's direction/sign bug (every `source_system='transaction'`
   row was tagged `transaction_kind='expense'` regardless of real direction) + built a transfer/
   distribution classifier (internal transfers between Jason's own accounts vs. real business→
   personal owner distributions) + a second review panel on `/forge/connections`.
   **NOT yet applied** — see "Open problem," this panel should not be applied yet.
8. **PR #215** — Personal/Business toggle on `/forge/budget` (the schema already supported
   `business_scope`, routes were just hardcoded to "personal").

## Open problem — do this next, before anything else in this area

While extending PR #214's classifier to also recognize loan/HELOC payments as real expenses
(instead of silently excluding them as "internal transfers" — this is why Jason's mortgage/HELOC
payment wasn't showing up in the budget), a **real production data inconsistency** was found:

Jason's DuGood "Home Equity" account (a `financial_accounts.type = 'credit'` HELOC/loan account,
paired with "Regular Savings Account" for the recurring payment) does **not** reliably follow the
sign convention the whole direction-fix (#214) was built on. Verified against real production data
just now:

```
2026-03-15  Regular Savings Account  +1413.83  "Withdrawal / Transfer to Loan 0020"     (correct: positive=outbound)
2026-03-15  Home Equity              +1413.83  "Payment / Transfer from Share 0000"     (WRONG: should be negative/inbound)
2026-07-20  Home Equity              -1482.50  "Payment / Transfer from Share 0000"     (this one IS correctly negative)
```

Almost every recurring HELOC-payment row on the Home Equity (credit-type) side has the **same
positive sign** as its paired Regular Savings withdrawal, except one row that's correctly negative.
This is inconsistent even within the same account and same description pattern — not a clean
"credit accounts are always inverted" rule that could just be sign-flipped. It looks like Stripe
Financial Connections may report amounts differently for credit/loan-type accounts than for
depository accounts, inconsistently.

**Why this matters:** the transfer/distribution classifier (#214) splits rows into inbound
(negative) vs outbound (positive) purely by sign, then matches pairs by amount+date. Because most
Home Equity rows are mis-signed the same as their outbound counterpart, they never get recognized
as a pair at all — they show up as unmatched/ambiguous instead of confirmed. **Do not apply the
#214 review panel on `/forge/connections` (the "Transfer & distributions" panel) until this is
resolved** — it would leave Jason's real mortgage/HELOC payments unclassified rather than showing
them as a real expense, and worse, could misclassify them if a naive fix is applied without
understanding the actual inconsistency.

**In-progress fix** (uncommitted, sitting in a worktree, NOT pushed/merged): a new "debt payment"
classification bucket was added to `classifyTransferPairs.js` (any transfer touching a
`type='credit'` account becomes a real expense category like `heloc_payment`/`loan_payment` instead
of being excluded as a no-op internal transfer) — the matching logic itself is right and tested
(15/15 unit tests pass), but it depends on the same broken sign assumption for pairing, so it
currently finds 0 confirmed debt payments against real data instead of the expected ~13.
Location: `/home/jason/USMarketplace/marketplace409-transfer-classification` worktree, branch
`fix/classify-transfers-and-distributions` has already been merged (that's #214) — this newer,
uncommitted debt-payment work is sitting on top of that same worktree's working tree, not yet
committed to a new branch.

**Suggested next step:** investigate whether Stripe Financial Connections' raw payload (check
`metadata.raw` on these `financial_events` rows, or re-fetch via the Stripe FC API for this specific
account) distinguishes credit-account transactions in a way that explains the inconsistent sign —
e.g. a `credit`/`debit` field independent of amount sign, which would be a more reliable direction
signal than amount sign alone for this account type. Do NOT ship a fix based on guessing; validate
against all of Jason's real Home Equity transaction rows first (small dataset, ~20 rows).

## Also still open (lower priority, not blocking)

- **11 ambiguous transfer rows** ($126,482.50) in the #214 panel — mostly recurring ~$10,000
  deposits into Business Savings with no matching outbound leg found in scanned data. Needs Jason's
  manual review, or investigation into whether the counterpart account simply isn't connected to
  FORGE yet.
- **Category family grouping** — Jason asked whether e.g. "Dining Drinks" and "Dining Drinks
  Restaurants" (and similar parent/child category families: `auto_transport*`, `home_*`,
  `utilities_*`, `travel_*`) should be combined into one budget suggestion instead of showing as
  separate lines. Proposed approach: group suggestions by category family prefix instead of exact
  `normalized_category`. Not started — needs a careful migration path since Jason already has real
  budget categories saved that shouldn't silently merge/lose data.
- **Recurring-payment detection** — Jason wants any recurring payment (same amount/description on a
  regular cadence) auto-suggested as a budget line with an editable label, symmetric for both
  expenses and income (e.g. paycheck detection). Discussed, not started. Would build on the same
  domain-function pattern as everything else here (pure, tested matching logic; human-gated apply).
- **Email deliverability** — a private-financing invite (to Ethan Morgan) landed in spam. Flagged,
  not investigated. Likely SPF/DKIM/domain reputation on `rentals@mail.409marketplace.online`.

## Key facts to avoid re-deriving

- `financial_events.source_system` values in production: `quicken_simplifi_csv` (personal spending
  import, stops 2026-08-22), `rentec` / `rentec_api` (property-management rental income/expenses,
  stops ~2026-08-23), `transaction` (raw Plaid/Stripe-FC bank feed, has real September 2026 data but
  needs the fixes above before it's trustworthy), `forge_rental_payment` /
  `forge_rental_payment_adjustment` / `property_financial_setup` (FORGE's own rental-collection
  data).
- **This is why the budget shows $0 income for September**: none of the three income sources
  (Simplifi, Rentec, raw bank feed) currently has clean September data available to the budget —
  Simplifi/Rentec haven't synced past August, and the raw bank feed's real September transactions
  are still stuck with the wrong `transaction_kind` until the #214 panel (blocked, see above) gets
  applied correctly.
- Real DuGood Federal Credit Union accounts: "Business Checking - No Div/Fee" and "Business Savings"
  (business_scope=business), "Home Equity" (business_scope=personal, type=credit, the HELOC),
  "Regular Savings Account" and "Advantage Checking Account" (business_scope=personal, depository).
  A Capital One "360 Checking" account is also connected (business_scope=business).
- Jason's actual personal income sources: unemployment checks, plus $5,000/$10,000 distributions
  his wife transfers from Business Checking into personal savings/checking (irregularly — "most of
  the time" the overage also gets moved into a personal Money Market account, which is a second,
  purely internal transfer, not new income).
- Safe verification pattern used throughout this session: `npx supabase link --project-ref
  bzqvenxjlstinmgbuvvg` then wrap SQL in `begin; ... rollback;` via `npx supabase db query --linked
  --file <scratch.sql>` to validate against real production schema/data with zero risk — used for
  every migration before it was ever pushed for real.
- Every reconciliation/reclassification feature in this session follows the same shape: a pure,
  unit-tested domain function computes the classification; nothing writes to real data without an
  explicit human review-and-confirm step in the UI (checkbox + typing "CONFIRM"); writes are
  soft/reversible (`is_deleted` + a link back to the canonical row, or a narrow `reclassify_*` RPC
  that can only touch specific columns) — never a hard delete, never automatic.
- Repo convention: new migrations go in `supabase/migrations/`, timestamp-prefixed after whatever
  is currently latest (check first — this session hit one accidental timestamp collision, #212,
  from two branches landing the same minute-level timestamp independently). Work happens in fresh
  `git worktree add <path> -b <branch> origin/main` checkouts, never in the stale primary checkout
  at `/home/jason/USMarketplace/marketplace409` (an unrelated feature branch is checked out there
  with unrelated uncommitted files — do not touch it).

## Open worktrees relevant to this work (as of 2026-09-18)

- `/home/jason/USMarketplace/marketplace409-transfer-classification` — branch
  `fix/classify-transfers-and-distributions` (already merged as #214), with **uncommitted** further
  edits for the debt-payment classification (blocked, see above).
- `/home/jason/USMarketplace/marketplace409-main-deploy` — detached, tracks latest `origin/main`,
  used for pushing migrations (`supabase db push --linked`) and read-only production queries.
- Several other now-stale worktrees from this session's earlier, already-merged PRs (#208-#213,
  #215) can be cleaned up (`git worktree remove`) once whoever picks this up confirms they're done
  with them.
