# FORGE Private Financing — Owner-Directed Handoff

## Status and priority

**Owner decision (2026-08-29): pause GW-3 and make Seller Financing the active product priority.**

GW-3 is paused, not cancelled. Before changing branches or files, inspect the current repository, all worktrees,
the active GW-3 branch, and uncommitted changes. Record the exact GW-3 checkpoint and preserve every change.
Do not reset, delete, overwrite, commit, push, merge, deploy, migrate, or mutate Production merely to make the
switch. Keep this work isolated on a fresh branch/worktree based on the correct current `origin/main` after
confirming the state of PR #55 and any later work.

This handoff is the durable assignment. Repository reality remains authoritative. If this document conflicts
with current code, stop and report the conflict rather than silently forcing the design.

## Product intent

Build a reusable **FORGE Private Financing** foundation for people and small businesses servicing legitimate
loans they already own. The first production-facing use case remains **Seller Financing** inside Rental
Manager, proven with the South Main account. The shared engine must be designed so a later **Personal Loans**
surface can reuse its terms, calculation, immutable ledger, payments, statements, adjustments, borrower
access, payoff, and audit capabilities without treating every loan as property or rent.

Seller Financing must not represent the buyer as a renter or ordinary tenant and must not classify loan
principal as rent or rental income. Personal Loans should later appear as a separate FORGE product surface,
likely integrated with Financial FORGE, rather than being forced into Rental Manager.

Initial boundary: FORGE provides recordkeeping, servicing, statements, and payment software for agreements
the customer already owns. It does not originate or underwrite loans, match lenders and borrowers, buy debt,
collect defaulted debt for unrelated third parties, determine enforceability, or automatically declare
default or accelerate a loan.

The first real account is the South Main home. The seller must be able to manage the loan in Rental Manager.
The home buyer must have a borrower/home-buyer portal that shows:

- current amount due and due date;
- past-due amount, if any;
- principal balance remaining;
- estimated payoff as of a stated date;
- principal paid to date;
- interest paid to date;
- payments and seller adjustments;
- downloadable or printable statements and receipts;
- an understandable explanation of how the most recent payment was applied.

The buyer must be able to submit payments through the existing FORGE payment experience only after the
repository inspection confirms the processor/account model supports seller-financed real-estate payments.
Do not assume the existing Stripe rent flow is legally, contractually, or processor-policy equivalent.

## Owner-approved South Main opening facts

Use the documents and payment history supplied by the owner as the source data for this initial account.
The owner explicitly directed the calculation to begin on the date of the first recorded payment and to treat
the supplied note pages and workbook as the available governing data.

- Financed principal: **$55,000.00**
- Interest-bearing portion: **$45,000.00 at 3%**
- Financed-down-payment portion: **$10,000.00 at 0%**
- Regular combined payment: **$517.85**
  - 3% portion: **$434.52**
  - 0% portion: **$83.33**
- Calculation start / first recorded payment: **2022-03-23**
- Last supplied payment: **2026-08-23**
- Recorded payments: **48**
- Actual cash payments recorded: **$26,577.00**
- Late-payment charges: **disabled; do not assess them**
- Contractual interest method: actual elapsed days on a **365/365 basis**
- Prepayment: allowed without penalty; interest on prepaid principal stops accruing
- Stripe processing expense: borne by the seller; the buyer receives full contractual credit for the amount
  submitted. A Stripe fee must never reduce buyer payment credit or increase the loan balance.

Accepted opening reconciliation through 2026-08-23:

- Payments scheduled from the first-payment date through 2026-08-23: **54**
- Scheduled amount through that date: **$27,963.90**
- Actual cash recorded: **$26,577.00**
- Owner-approved one-time bring-current/reporting credit: **$1,386.90**
- Past due after that credit: **$0.00**
- Corrected principal remaining immediately after the credit: **$31,843.47**
- Interest paid through 2026-08-23: **$4,807.37**
- Actual cash applied to principal: **$21,769.63**
- Principal credited by seller: **$1,386.90**
- Total principal paid or credited: **$23,156.53**
- Next assumed regular payment: **$517.85 due 2026-09-23**

The uploaded workbook has a confirmed $100 second-loan carry-forward formula error and also uses fixed monthly
interest instead of the note's actual-day method. Do not import workbook formulas or its stored running
balances. Import raw payment events and recompute deterministically. The accepted $1,386.90 adjustment
supersedes the bad running balance; do not deduct the $100 a second time.

Interest and payoff values after 2026-08-23 must be calculated dynamically. Never store a changing payoff
quote as though it were immutable principal.

## Required allocation behavior

Create a deterministic, currency-safe calculation engine with explicit rounding rules and golden tests.
For this account:

1. Accrue 3% interest for actual elapsed days on the outstanding interest-bearing principal using 365/365.
2. Apply each payment to accrued interest first.
3. Apply the regular 3% portion.
4. Apply the regular $83.33 portion to the 0% financed-down-payment balance.
5. Apply payment amounts above the combined regular payment to the 3% principal so interest stops sooner.
6. Never generate a late charge for this account.
7. Credit the borrower with the full amount submitted; post processor fees separately as seller expense.
8. Preserve underpayments and overpayments exactly and recompute future state from immutable events.
9. Make allocation results explainable per event and reproducible as of any historical date.

Do not use binary floating-point for posted currency. Define and test cent-rounding and interest carry behavior
before importing the real account. If current repository financial conventions conflict with these rules,
report the conflict and request an owner decision.

## Seller UI requirements

Add a dedicated Seller Financing surface within Rental Manager. It must support portfolio-level accounts and
an account detail screen with balances, upcoming payment, payment history, statements, payoff, audit history,
and borrower access.

The seller/co-owner must be able to create controlled adjustments, including:

- one-time account credit;
- bring-current/reporting credit;
- principal reduction;
- interest correction or waiver;
- discounted payoff offer;
- Stripe-fee reimbursement;
- payment correction or compensating reversal;
- seller-entered external payment such as cash, check, or bank transfer;
- optional internal note and borrower-visible explanation;
- effective date and supporting attachment/reference.

Adjustment safeguards:

- Never edit or delete the original payment or adjustment event.
- Corrections use compensating immutable ledger events.
- Separate contractual corrections from discretionary seller concessions.
- Preview balance, principal, interest, arrears, and payoff effects before posting.
- Require explicit confirmation for every balance-changing action.
- Record canonical owner, acting authenticated user, timestamp, reason, event type, and before/after snapshot.
- Enforce idempotency for payment webhooks and manual submissions.
- Borrowers can view adjustments but can never create, approve, reverse, or delete them.
- Respect the existing primary-owner/co-owner authorization model and cross-workspace denial.
- Treat payoff discounts as dated offers with original calculated payoff, discount, offered payoff, expiration,
  status, and acceptance/payment evidence.
- Do not mark a loan paid off until funds have cleared and the seller explicitly confirms completion where
  processor state alone is insufficient.
- Preserve historical principal and interest when a payoff concession closes the remaining balance.

## Borrower portal and payment requirements

Create a borrower/home-buyer access role and authorization boundary distinct from tenant access. Inspect and
reuse existing secure portal invitation/session patterns where appropriate, but do not grant access through
tenant identity merely because this feature lives inside Rental Manager.

The portal must be plain-language, mobile-friendly, keyboard accessible, and disclose:

- payment amount being credited to the loan;
- Stripe or processor fee treatment without reducing the buyer's loan credit;
- payment status (initiated, pending, succeeded, failed, reversed/refunded);
- allocation to interest, 3% principal, 0% principal, seller credit, and remaining balance;
- whether a displayed payoff is an estimate and its through-date.

No borrower action may silently change contractual terms or accept a payoff offer without explicit
confirmation and a durable receipt.

## Accounting boundaries

- Loan principal collections reduce a note receivable; they are not rental revenue or NOI.
- Interest collections are interest income, separate from rent.
- Seller concessions/credits and seller-paid processing fees require distinct classifications.
- Do not feed seller-financing transactions into rent delinquency, security-deposit, Rentec-authoritative rent,
  lease-readiness, or tenant-payment reports without an explicit mapping designed for that purpose.
- Financial FORGE integration must preserve these classifications and the acting-user/canonical-owner audit
  split.


## Approved platform expansion beyond the first Seller Financing account

The owner approved designing the foundation for a broader **FORGE Private Financing** product with two
product-specific experiences:

1. **Seller Financing** — property-linked and accessible from Rental Manager.
2. **Personal Loans** — a later general-purpose surface connected to Financial FORGE.

The common engine should support interest-bearing and zero-interest components, fixed or flexible payments,
actual-day or scheduled interest methods, secured or unsecured classifications, early/late/partial/extra
payments, credits, waivers, discounted settlements, external payments, statements, receipts, and explainable
historical reconstruction. Product-specific rules and disclosures must remain explicit; do not flatten all
loan types into one unsafe generic behavior.

### FORGE servicing revenue

Design—but do not activate without later approval—a configurable FORGE platform fee of **$0 to $10 per
active loan per month**. The lender/seller pays by default. It is FORGE subscription/servicing revenue,
not loan principal or interest, and must never reduce the amount credited from a borrower payment.

A borrower-paid servicing fee may be supported only for future agreements when applicable law and the signed
agreement authorize it. It must be separately disclosed, receipted, and classified; it cannot be enabled
retroactively through a dashboard toggle. The South Main account is grandfathered: the seller absorbs both
FORGE servicing and Stripe processing expenses, and the buyer receives full credit for every dollar submitted.

### Later optional credit reporting

Reserve an extension boundary for **buyer-opt-in credit reporting**, but do not implement or advertise it as
available during SF-0 through SF-4. Treat it as a later **PF-5 / optional credit-reporting integration**,
dependent on a qualified third-party furnisher/reporting provider, legal and processor review, verified data
accuracy, dispute/correction workflows, and explicit buyer consent.

FORGE must not promise score improvement or selectively report only favorable events when the provider or law
requires complete history. Prefer provider-hosted identity verification/tokenization so FORGE does not store
full Social Security numbers, identity documents, or unnecessary birth dates. Reporting fees must remain
separate from principal, interest, and payment credit. Opt-out behavior and already-reported accurate history
must follow provider and legal requirements.

### Later document-generation product

Reserve a future **FORGE Documents** layer that uses the same authoritative loan terms and calculation engine
to produce consistent documents and servicing records. Potential outputs include term sheets, promissory
notes, payment schedules, amortization tables, payment instructions, servicing-fee disclosures, prepayment
and late-fee selections, optional credit-reporting consent, borrower acknowledgments, signature packages,
and a permanent signed-document archive.

Delivery must progress in controlled levels:

1. Import and service an existing agreement.
2. Generate a non-binding term sheet for review.
3. Offer versioned, state- and loan-type-specific attorney-reviewed templates.
4. Only later consider complete execution packages with e-signature, notarization, recording instructions,
   disclosures, and automatic servicing activation.

Never present one generic contract as valid for every state or transaction. Each template needs state,
loan type, version, effective date, review status, required disclosures, eligibility restrictions, and
notarization/recording requirements. FORGE may populate reviewed templates and validate arithmetic; it must
not decide whether a transaction or its terms are legally appropriate.

## Security and data model expectations

Perform a read-only overlap and authorization inspection before proposing migrations. Expected concepts include
seller-financing accounts, loan components/terms, immutable ledger events, payment allocations, adjustments,
payoff offers, borrower memberships/invitations, processor transactions, and statement snapshots. Names are
not prescribed; reuse repository conventions.

RLS and server authorization must cover primary owner, co-owner, borrower access to only their own account,
cross-workspace denial, service/webhook access, and audit attribution. Never expose other landlord, borrower,
tenant, payment, or property records. No service-role shortcut in ordinary browser routes.

## Delivery sequence and gates

1. **SF-0 — Read-only integration map**
   - Preserve and record the GW-3 pause checkpoint.
   - Inspect current `origin/main`, PR #55 status, worktrees, branches, payment/Stripe architecture,
     tenant portal, Rental Manager navigation, Financial FORGE classifications, authorization helpers,
     migrations, RLS, audit patterns, and tests.
   - Identify overlap, processor-policy blockers, and the smallest safe implementation slices.
   - Update this handoff with cited repository reality.
   - Stop for owner review before migrations or Production changes.

2. **SF-1 — Calculation and immutable-ledger foundation**
   - Currency-safe actual-day engine, allocation rules, event contracts, historical replay, adjustment previews,
     payoff quotes, and golden tests using the South Main history.
   - No Production import or money movement.

3. **SF-2 — Seller administration**
   - Seller Financing navigation, account screens, controlled adjustments, manual/external payments, payoff
     offers, statements, audit presentation, primary-owner/co-owner authorization.

4. **SF-3 — Borrower portal and payments**
   - Borrower access, statements, receipts, payment initiation/status, processor integration only after policy
     and account architecture are verified.

5. **SF-4 — South Main import and reconciliation**
   - Dry-run import preview first.
   - Owner reviews raw payments, computed allocations, opening balances, and $1,386.90 credit.
   - Separate explicit approval is required before a migration, Production import, live payment enablement,
     or borrower invitation.

At every checkpoint: focused tests, relevant authorization/RLS tests, full suite, lint, build, clean
`git diff --check`, and honest browser evidence. Do not fabricate completed/paid-off states by mutating real
records. Do not commit, push, open a PR, merge, deploy, migrate, import Production data, invite the borrower,
or enable live money movement without the owner's explicit instruction for that action.

## Immediate Claude assignment

Pause implementation of GW-3 after preserving its exact state. Begin **SF-0 only**: read-only repository
inspection and a source-cited integration map for the reusable Private Financing foundation, with Seller
Financing/South Main as the first bounded delivery and Personal Loans as a later product surface. Do not begin migrations, UI implementation, Stripe changes,
or Production data work. Return:

- the preserved GW-3 branch/worktree/dirty-state checkpoint;
- PR #55 and `origin/main` reality;
- reusable code and real gaps for Seller Financing;
- proposed shared Private Financing data, ledger, calculation, authorization, payment, accounting, and audit boundaries;
- product boundaries between Seller Financing, Personal Loans, optional credit reporting, and FORGE Documents;
- a safe $0-$10 lender-paid monthly servicing-fee design that never reduces borrower payment credit;
- processor, reporting-provider, licensing, template-review, and policy questions requiring verification;
- proposed SF-1 slices and tests, keeping South Main as the first proof account;
- conflicts or decisions that genuinely require owner input.

---

## SF-0 — Inspection findings and integration map (complete)

Performed 2026-08-29, entirely read-only. No migration, UI, Stripe, Production, or code change of any
kind was made. Three parallel research passes plus direct verification cover Stripe/payment
infrastructure, Financial FORGE accounting classifications, and authorization/RLS/audit/tenant-portal
patterns. Every claim below is source-cited to an exact file, table, column, or migration — nothing here
is inferred without a citation.

### 1. Preserved GW-3 checkpoint

GW-3 required no rescue — it was already in the cleanest possible state before this assignment began.

- **Worktree**: `/home/jason/USMarketplace/marketplace409/.claude/worktrees/rentec-financial-history-resume`
  (left exactly as found; this SF-0 work happened on a new branch, `explore/seller-financing-sf0`, checked
  out in the same worktree directory rather than a second worktree — the sandbox that runs this session
  restricts git operations to a single fixed worktree path, so a genuinely separate worktree could not be
  used interactively; a `git worktree add` for a second directory was attempted, found inoperable from
  this session, and cleanly removed again before proceeding).
- **GW-3 branch**: `feat/gw3-lease-renewal`, HEAD `6c805a13204cbed3029ef3bcbe3b8851fa793928` — unchanged,
  still exists locally and on `origin`, byte-identical to `origin/feat/gw3-lease-renewal`.
- **GW-3 commits** (2, not squashed): `fd11ae8fba5d35b93d0b3f3e326f730140a3b182` (fix: scope
  lease-change save/approve to the workspace owner) and `6c805a13204cbed3029ef3bcbe3b8851fa793928` (feat:
  guide lease renewal for expiring leases).
- **GW-3 PR #56**: MERGED (`mergedAt` 2026-08-29T04:58:51Z) as merge commit
  `6274a7e873dea77d7b9b0f47fd759132ef095a30` on `main`. Production Vercel deployment verified `success`,
  and the live "Renew a Lease" surface was confirmed working in production before this assignment began.
- **Working tree**: clean except two untracked, benign, auto-regenerated scaffold files (`AGENTS.md`,
  `CLAUDE.md`, written by `next dev`, never part of any feature, correctly left untracked all session).
- **Stash**: empty. **Uncommitted GW-3 work**: none existed to lose.
- **What's deliberately still open** (not started, not lost): five more GW-3 candidate operational
  workflows surveyed and deferred per the design doc's one-at-a-time requirement — tenant guidance,
  overdue-payment collection, maintenance handling, move-out inspection, and reconciliation guidance
  (reconciliation intentionally last, since it has no mutating action to guide through today). Resuming
  GW-3 later needs no restoration — just branch fresh off whatever `origin/main` is by then and pick the
  next candidate.

### 2. PR #55 and `origin/main` reality

- **PR #55** (GW-2, "state-aware first-tenant readiness guidance"): MERGED, `mergedAt`
  2026-08-29T03:13:21Z, merge commit `5869784748cf4d4fda85126d1165a8bc77751f8b`.
- **PR #56** (GW-3, see §1): MERGED, as above.
- **`origin/main` HEAD** at the time this inspection began: `7d15e8439fa9f70185a95ddc8bd645056d2e2072`
  ("docs(governance): expand financing handoff") — one commit ahead of `6062341a7acad09aad31ab39eeef849b01062ee3`
  ("docs(governance): hand off seller financing priority"), which is itself one commit ahead of GW-3's
  merge (`6274a7e87...` is actually the parent of `6062341a7` — the docs handoff was pushed directly to
  `main` by the owner/another process between GW-3's merge and this assignment, not through a PR this
  session opened). Confirmed via `git merge-base --is-ancestor` that the cited handoff commit
  `7d15e8439` is a real ancestor of `origin/main`.
- No other branch or worktree in this repository contains any seller-financing, private-financing, loan,
  amortization, or borrower-related code. Confirmed by a direct grep of `supabase/migrations/` and `src/`
  for `seller.financ|amortiz|note_receivable|private_financ|borrower|sellerFinanc|SellerFinanc|noteReceivable|privateFinanc`
  — zero matches anywhere. This is genuinely greenfield; there is no duplicate or overlapping work to
  reconcile.

### 3. Reusable code and verified gaps for Seller Financing

**Directly reusable, no new mechanism needed:**
- Stripe Connect **V2 Core Accounts API** model (`src/infrastructure/billing/StripeBillingProvider.js:36-57`,
  `createConnectedAccount`) — `dashboard:"full"`, `fees_collector`/`losses_collector: "stripe"`. The
  Payment Intent creation pattern (`createPaymentSession`, `StripeBillingProvider.js:134-160`), the
  Payment Element client confirmation flow (`TenantPortal.jsx`/`TenantPaymentForm.jsx`), and the
  `application_fee_amount` field (currently always `0` for rent) all generalize cleanly.
- The webhook signature-verification + `payment_webhook_events` idempotency ledger
  (`unique(provider, provider_mode, provider_event_id)`, `src/application/rental/stripeWebhookLedger.js`'s
  `isWebhookEventAlreadySettled`/`webhookLivemodeMatchesServerMode` helpers) — schema is already
  provider/event-generic, not rent-specific; **can likely be reused directly** rather than duplicated, pending
  confirmation it has no hidden FK into rent tables (none found in this inspection).
  `STRIPE_MODE`/`provider_mode` isolation discipline (`src/infrastructure/billing/stripeMode.js`) must be
  followed identically by any new table/RPC from day one.
  A settlement-reconciliation cron pattern (`src/app/api/rental/cron/settlement-reconciliation/route.js`)
  is a ready-made template for a loan-payment equivalent.
- **The exact property this feature most depends on already exists and is proven**: gross payer credit
  (`process_stripe_rental_payment_event` crediting the full `rental_payments.amount_cents`) is already
  fully independent of fee tracking (`record_stripe_rental_settlement`'s separate `gross/fee/net` row,
  `check (net_amount_cents = gross_amount_cents - fee_amount_cents)`). No code path today lets a Stripe
  fee reduce what a payer is credited for. This is precisely the property required for "the buyer receives
  full credit for every dollar submitted" — it does not need to be invented, only replicated in a parallel
  loan-payments/loan-settlements schema.
- Workspace-membership authorization (`has_workspace_access(p_owner_id)`, `resolve_effective_owner_id()`,
  `supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql`) — reuse verbatim for
  every owner/co-owner-scoped Private Financing table and RPC. No new authorization mechanism for the
  seller side.
  Audit convention: `owner_id` (canonical) + `created_by`/`updated_by` sourced from `auth.uid()::text`
  (confirmed via `supabase/migrations/20260829001600_fix_audit_attribution_actor_columns.sql`) — **there is
  no column literally named `acting_user_id` anywhere in this codebase**; that name does not exist as a
  convention despite being referenced conceptually in prior requirement language. Use `created_by`/
  `updated_by` to match the established pattern exactly.
- The forward-only migration discipline, the `drop policy ...; create policy ...`
  /`create or replace function` conversion shape, and the static-migration-text `*.migration.test.js`
  assertion pattern (`src/domains/workspace-membership/__tests__/security-regression-matrix.migration.test.js`
  is the direct template for a new borrower/cross-workspace-denial test suite).
- `Money.js` (`src/platform/value-objects/Money.js`) as the low-level cents-safe primitive
  (round-per-operation, same-currency assertion) — reusable as a building block, not a full solution (see
  gap below).
- `financial_events`, `account_balances`, and `financial_assets`/`financial_asset_valuations` — all
  reusable as the home for Financial FORGE integration (see §7), via new enum values and a new
  `source_system`, not new tables.

**Verified gaps — genuinely new work required, confirmed by reading the actual schema, not assumed:**
- `rental_payments` has **hard `not null` foreign keys** to `rent_charges`, `rental_leases`,
  `rental_tenants` (`supabase/migrations/20260812000500_create_rental_payments.sql:1-16`, `on delete
  restrict`). **A loan payment structurally cannot be inserted into this table.** A parallel
  `private_financing_payments` table is required, not an extension of this one.
- `billing_customer_references` FKs to `rental_tenants(owner_id, id)` — the Stripe Customer owner must
  literally be a tenant row. A borrower is a different actor type; needs its own
  `private_financing_billing_customer_references`-equivalent (or a generalized version — see §6 for why
  reuse-via-shared-identity is explicitly rejected).
- `landlord_payment_accounts` is unique on `(owner_id, provider, provider_mode)` — **one Stripe Connect
  account per landlord identity, full stop.** If South Main needs its own distinct Connect
  account/payout destination (a real open question — see §10), this table cannot represent that without a
  schema change (a `product`/`purpose` discriminator added to the unique key). Recommended: a new,
  dedicated `private_financing_payment_accounts` table rather than widening this one, to avoid any risk
  to the live, working rent-payment unique constraint.
- `record_offline_rental_payment` RPC is fully rent-charge-shaped (`p_charge_id` required, derives
  `tenant_id` via `rental_lease_tenants`, payment method restricted to `('cash','cashiers_check')`) — **it
  cannot record a payment without a `rent_charges` row.** A parallel `record_offline_private_financing_payment`
  RPC is needed, following the identical safety shape (ownership check, `for update` row lock,
  payment-method allowlist, amount-vs-remaining-balance guard) against new loan tables.
  `manual-financial-event` (the more generic ledger-entry route) is a closer precedent for "money changed
  hands outside Stripe" but is a plain accounting entry, not a payment-against-a-schedule-line credit —
  not a substitute for a real payment-recording RPC.
- `rental_billing_settings` is **owner-wide** (`owner_id text primary key`) — reusing it means pausing
  rent billing also pauses loan servicing and vice versa. A separate
  `private_financing_billing_settings` (or an account-scoped flag) is required.
- No cent-safe **allocation/amortization** helper exists anywhere in the repository (confirmed by grep for
  `allocate|remainder|amortiz` across `src/application/` and `src/domains/` — zero hits beyond what's
  already cited). Splitting a payment across an interest-bearing component, a zero-interest component, and
  correctly handling the 365/365 actual-day accrual and remainder-cent distribution is genuinely new
  domain logic, to be built on top of `Money.js`, not found within it.
- No existing enum value represents "note receivable." `financial_assets.asset_class` has no
  `note_receivable`/`loan` option (`supabase/migrations/20260825010000_add_financial_asset_registry.sql`),
  and — critically — `financial_accounts.type = 'loan'` is classified as a **liability** in
  `src/domains/financial-position/FinancialPositionQueryService.js:3-9` (`LIABILITY_ACCOUNT_TYPES = new
  Set(["credit", "loan"])`). **A seller-financed note receivable must never be tagged
  `financial_accounts.type='loan'`** — that would silently subtract the note's principal from the owner's
  net worth instead of adding it. The correct extension point is a new `financial_assets.asset_class`
  value (small, additive CHECK-constraint migration), not `financial_accounts`/`investment_accounts`.
- No tenant-portal-style borrower identity/claim/access pattern exists for a non-tenant actor. Must be
  built new, mirroring `claim_rental_tenant_portal()`'s shape exactly (see §6) but on entirely separate
  tables — the owner's explicit instruction not to grant borrower access through tenant identity is
  additionally reinforced by the repository's own test suite, which hard-codes tenant-portal access as
  governed only by tenant/lease identity, deliberately isolated from every other authorization sweep
  (`security-regression-matrix.migration.test.js`).

### 4. Proposed shared Private Financing calculation and immutable-ledger architecture

**New domain, new table family**, prefixed `private_financing_` to match this repo's per-domain prefix
convention (`rental_`, `financial_`, `workspace_`) and to keep every policy/RPC name unambiguous:

- **`private_financing_accounts`** — one row per loan/note. `owner_id`, `id`, `product` (`'seller_financing'
  | 'personal_loan'`), `property_id` (nullable — populated for Seller Financing, null for Personal Loans,
  matching the requirement that a loan must never be forced to look like property/rent), `borrower_id`
  (FK to the new borrower table), `status`, `opened_date`, `origination_principal_cents`,
  `late_fee_policy` (`'disabled' | 'enabled'`, defaulting per-account — South Main is `'disabled'`, never
  assessed), `interest_day_count_convention` (`'actual_365' | ...`, extensible for Personal Loans), audit
  columns.
- **`private_financing_components`** — one row per interest-bearing or zero-interest slice of a loan (South
  Main needs exactly two: the $45,000-at-3% component and the $10,000-at-0% down-payment component).
  `account_id`, `component_type` (`'interest_bearing' | 'zero_interest'`), `original_principal_cents`,
  `rate_bps` (0 for zero-interest), `regular_payment_cents`, ordering/priority for payment application.
  This is the mechanism that generalizes to Personal Loans' "interest-bearing and zero-interest
  components, fixed or flexible payments" requirement without hardcoding South Main's specific two-component
  shape into the schema.
- **`private_financing_events`** — the immutable ledger. Append-only, never updated or deleted (mirrors the
  `reconcile_rental_payment_reversal`/`forge_rental_payment_adjustment` compensating-event precedent
  exactly, which is the closest and most directly reusable pattern found in this repo). One row per:
  payment received (Stripe or external/manual), interest accrual posting (if accrual is posted rather than
  purely computed-on-read — open design choice, see below), adjustment (credit, principal reduction,
  interest waiver/correction, Stripe-fee reimbursement, payment correction/reversal), payoff-offer
  acceptance. Columns: `owner_id`, `id`, `account_id`, `event_type`, `effective_date`, `amount_cents`,
  per-component allocation breakdown (jsonb or child rows — `private_financing_payment_allocations`),
  `reason`, `internal_note`, `borrower_visible_explanation`, `reference`/`document_evidence_id`
  (mirroring `rental_lease_changes.document_evidence_id`), `reverses_event_id` (nullable self-reference
  for corrections, mirroring the `metadata: {"reverses_event_id": ...}` pattern the Financial FORGE
  research recommended), canonical before/after balance snapshot (`principal_remaining_cents_before/after`
  per component, for fast historical display without full replay), `created_by`/`updated_by`
  (`auth.uid()::text`, matching the established audit convention — not a webhook sentinel, since no such
  convention exists in this repo yet; see §6 for the one genuinely open decision this creates).
- **`private_financing_payoff_offers`** — `account_id`, `original_payoff_cents`, `discount_cents`,
  `offered_payoff_cents`, `offered_as_of_date`, `expiration_date`, `status`
  (`'offered'|'accepted'|'expired'|'withdrawn'`), acceptance evidence reference. A closed/paid-off loan
  preserves its historical principal/interest rows exactly as required — payoff is itself just another
  `private_financing_events` row referencing the accepted offer, never a retroactive edit.

**Calculation engine — pure, deterministic, no I/O:**
A new domain module (e.g. `src/domains/private-financing/`), consuming/producing integer cents (never
floating point), built on `Money.js` but implementing the genuinely-new piece: cent-safe allocation across
components with 365/365 actual-elapsed-day interest accrual, remainder-safe rounding (largest-remainder or
equivalent, tested explicitly), and **full historical replay** — current balance, interest paid to date,
and payoff quote are never stored as a mutable running total; they are always recomputed by replaying
`private_financing_events` from account inception (or from a periodic snapshot forward, for performance,
with the snapshot itself just a cached replay result, never authoritative). This directly satisfies "never
store a changing payoff quote as though it were immutable principal." Golden tests validate the engine
reproduces the owner-approved South Main reconciliation numbers exactly ($1,386.90 credit,
$31,843.47 corrected principal, $4,807.37 interest paid, $21,769.63 cash-to-principal, as of 2026-08-23)
from the raw 48-payment history — see §11.

**Open design choice flagged, not resolved**: whether interest accrual is (a) purely computed on read
(derive accrued interest as of any date directly from the component's rate/day-count/last-payment-date,
no stored accrual row), or (b) periodically posted as its own ledger event. Recommendation: (a) for SF-1 —
simpler, provably correct via replay, and matches "explainable as of any historical date" — with (b)
reserved only if a future statement/reporting requirement needs a materialized accrual trail. This is a
design recommendation, not yet an owner decision point, since either is compatible with every other
requirement — flagged here for visibility, not blocking.

### 5. Seller Financing and Personal Loans product boundaries

- **Seller Financing**: `private_financing_accounts.product = 'seller_financing'`, `property_id` populated,
  surfaced inside Rental Manager's existing navigation (same `RENTAL_NAVIGATION`/`buildRentalSurface`
  pattern GW-1/GW-2/GW-3 already established — a new nav entry, not a new top-level app), authorized via
  the same `has_workspace_access` used everywhere else in Rental Manager.
- **Personal Loans**: `product = 'personal_loan'`, `property_id` null, surfaced as its own top-level FORGE
  workspace module (mirroring `FinancialWorkspaceModule.jsx`'s `href="/forge/financial"` pattern — a
  sibling `/forge/private-financing` or integrated directly into `/forge/financial`'s own navigation,
  per the handoff's own "likely integrated with Financial FORGE" direction), reusing the identical
  `private_financing_accounts`/`_components`/`_events` schema and calculation engine, with product-specific
  UI copy, disclosures, and (eventually) different default terms — never a shared, undifferentiated
  "loan" experience. The `product` column is the single discriminator; every UI-facing label, disclosure,
  and default must branch on it explicitly, never assume one product's language fits the other (matching
  the handoff's explicit "do not flatten all loan types into one unsafe generic behavior").
- Both products share every backend concept (components, events, adjustments, payoff offers, statements,
  borrower access, Stripe/payment plumbing, Financial FORGE classification) — the boundary is entirely at
  the presentation and default-terms layer, never the ledger.

### 6. Seller, co-owner, borrower, webhook, and cross-workspace authorization boundaries

- **Seller/co-owner**: `has_workspace_access(owner_id)` on every `private_financing_*` table's owner
  policy (`for all ... using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id))`,
  exact shape of `rental_leases_owner_all`) and every RPC guard. No new mechanism.
- **Borrower**: a genuinely new identity table, `private_financing_borrowers` (`owner_id`, `id`,
  `auth_user_id uuid references auth.users(id)`, `invited_email`, `status`), explicitly **not**
  `rental_tenants` — this both matches the owner's explicit instruction and the repository's own
  established boundary (tenant-portal access is proven, by the existing regression-test suite, to be
  isolated from every other authorization sweep; folding borrowers into it would break that isolation on
  both sides). Claim flow mirrors `claim_rental_tenant_portal()` exactly: a new
  `claim_private_financing_borrower_portal()` RPC, zero parameters, `security definer`, reads `auth.uid()`
  and the caller's own **confirmed** email from `auth.users` itself, matches against an `invited`
  row by email — never trusts a client-supplied UUID. A new SECURITY DEFINER helper,
  `private_financing_actor_has_account_access(p_owner_id, p_account_id)`, mirrors
  `rental_actor_has_lease_access` exactly (joins the new borrower table on `borrower.auth_user_id =
  auth.uid()`), used in every borrower-facing `select` RLS policy
  (`private_financing_events_borrower_select`, etc.) — a borrower can only ever see rows for their own
  account, structurally, the same way a tenant can only see their own lease.
- **Webhook**: reuse the existing service-role client pattern
  (`createRentalWebhookClient`/`SUPABASE_SERVICE_ROLE_KEY`, `persistSession:false`) — this is the one
  deliberate, narrowly-scoped RLS-bypass point in the entire payment system today, gated by Stripe
  signature verification before any DB write, and it introduces no new bypass surface if the new
  `private_financing_*` tables simply have no RLS grant to `authenticated`/`anon` for
  webhook-owned writes either (matching `payment_webhook_events`' own "service-role only, no authenticated
  policy" stance).
- **Cross-workspace denial**: automatic, for free, from reusing `has_workspace_access` — but must be
  proven, not assumed. SF-1/SF-2 should ship a new
  `private-financing-security-regression-matrix.migration.test.js`, directly modeled on the existing one,
  covering: primary owner full access; active co-owner full access; suspended/invited co-owner denied;
  non-`co_owner` role denied; unrelated stranger denied; a co-owner of a *different* owner's workspace
  denied (the cross-workspace case); and — new to this domain — a borrower on loan A denied access to loan
  B, even under the same owner.
- **One genuinely open decision, not yet resolved by any existing convention**: webhook/system-initiated
  `private_financing_events` rows (e.g. a Stripe payment webhook posting a payment-received event with no
  live interactive user) need a `created_by`/`updated_by` value. The established precedent elsewhere in
  this codebase (`20260829001600_fix_audit_attribution_actor_columns.sql`'s own stated rationale) is to
  fall back to `owner_id` for system-driven writes, on the grounds that "owner_id is the only meaningful
  attribution available" — there is **no** sentinel "system"/"webhook" actor UUID convention anywhere in
  this repository. Recommendation: follow the same fallback (`created_by = owner_id`) for consistency,
  rather than inventing a new convention this codebase has never used — flagged for owner confirmation
  since it's a real, if small, precedent-setting choice (see §12).

### 7. Payment, Stripe-fee, accounting, statement, payoff, adjustment, and audit architecture

- **Payment**: new `private_financing_payment_accounts` (Connect V2, mirroring
  `landlord_payment_accounts`'s shape but keyed `(owner_id, provider, provider_mode, product)` from
  inception, avoiding any risk to the existing rent Connect account's constraint), new
  `private_financing_payments` (mirrors `rental_payments`, FK'd to `private_financing_accounts`/
  `private_financing_borrowers`, never to `rent_charges`/`rental_leases`/`rental_tenants`), reusing the
  Payment Intent + Payment Element flow, `provider_mode` isolation, and — pending confirmation it has no
  hidden rent-table coupling — the existing `payment_webhook_events` idempotency ledger directly.
- **Stripe fee**: new `private_financing_settlements`, exact `gross_amount_cents`/`fee_amount_cents`/
  `net_amount_cents` shape and CHECK constraint as `rental_settlements`, populated by a new
  `record_stripe_private_financing_settlement` RPC mirroring `record_stripe_rental_settlement`. The payer
  credit (`private_financing_events` payment-received row, full submitted amount) and the fee tracking
  (`private_financing_settlements`, seller's expense) are two independent write paths from day one, exactly
  replicating the property described in §3 that already makes this safe for rent.
- **Accounting**: new `source_system = 'forge_private_financing'` in `financial_events`, **never** added to
  `buildRentalFinancialPerformance.js`'s `SAFE_INCOME_SOURCES`/`SAFE_EXPENSE_SOURCES` (so it can never
  corrupt the rent chart). Principal collection posts as `transaction_kind: 'transfer'` (cash up,
  note-receivable asset down, net worth unchanged — never `'income'`, matching "loan principal collections
  reduce a note receivable; they are not rental revenue or NOI"). Interest income posts as
  `transaction_kind: 'income'`, `normalized_category: 'note_interest_income'`, `affects_noi: false` — this
  is a direct, already-established analog: `src/domains/knowledge/category-map.ts` already maps Rentec's
  "Other Interest" category to exactly this shape (`interest_income`, `affects_noi:false`), confirming the
  convention pre-exists and just needs a matching category for loan interest. Seller concessions/credits
  and seller-paid processing-fee reimbursements post as `transaction_kind: 'expense'`,
  `normalized_category: 'seller_financing_concession'` / `'seller_financing_processing_fee'`,
  `affects_noi: false`. A new `SECURITY DEFINER` RPC/trigger,
  `post_private_financing_event_to_financial_event()`, mirrors `post_succeeded_rental_payment_to_financial_event()`
  exactly and is the only writer for this `source_system` — matching the RLS trust gate
  (`financial_events_owner_insert`/`_update`/`_delete` restrict the plain `authenticated` role to
  `source_system='manual'` only; every other source must go through a SECURITY DEFINER function that sets
  its own hardcoded `source_system`).
- **Net worth surfacing**: the loan's remaining-principal balance surfaces via a new
  `financial_assets.asset_class` value (e.g. `'note_receivable'`, small additive CHECK-constraint
  migration on the existing table — not a new registry) plus the existing `account_balances`
  manual-tagging convention (`provider='manual_private_financing'`, `connection_id=
  'manual_private_financing'`), reusing `FinancialPositionQueryService.buildPosition` entirely unmodified.
  **Must never** use `financial_accounts.type='loan'` (classified as a liability in this codebase — see
  §3).
- **Statements/receipts**: new `private_financing_statements` (snapshot rows, one per statement period,
  generated from a replay of `private_financing_events` as of the statement's through-date — never a
  live/mutable document) plus reusing whatever the existing receipt/PDF-rendering convention is for rent
  receipts (not yet inspected in this pass — flagged for SF-1/SF-2 investigation, not a blocker for SF-0).
- **Payoff**: `private_financing_payoff_offers` (§4) plus a payoff-quote function in the calculation engine
  (pure, replay-derived, dated) — a quote is never persisted as though it were a balance; only an
  *accepted* offer becomes a ledger event.
- **Adjustments**: every adjustment type the handoff lists (one-time credit, bring-current credit,
  principal reduction, interest correction/waiver, discounted payoff, Stripe-fee reimbursement, payment
  correction/reversal, external payment) is a distinct `private_financing_events.event_type`, never an
  edit to a prior row — exactly the `reconcile_rental_payment_reversal` compensating-event shape. Every
  balance-changing adjustment requires a preview (computed via the same replay engine, before posting) and
  explicit confirmation, per the handoff's own safeguards — this is a UI/API-layer requirement for SF-2,
  not a schema concern, and is noted here only so the schema (before/after snapshot columns) is designed
  to support it from the start.
- **Audit**: `owner_id` + `created_by`/`updated_by` (`auth.uid()::text`) on every table and event row,
  exactly matching the established convention (§3, §6).

### 8. A safe $0–$10 lender-paid monthly servicing-fee design

The fee must be designed now but **never activated** in SF-0 through SF-4, and must **never** touch
borrower payment credit at any point in its lifecycle:

- A new nullable `private_financing_billing_settings.platform_fee_cents` (0–1000, CHECK-constrained),
  defaulting to `null`/`0` and requiring an explicit owner opt-in action to set above zero — not a
  dashboard toggle that silently starts charging.
- **Critically, this must be billed as a completely separate money movement from any borrower payment.**
  The existing Connect model has the *landlord* as the merchant of record (Stripe collects payment
  processing fees from the landlord's own connected-account balance automatically,
  `fees_collector:"stripe"`). A FORGE servicing fee charged *to the lender* is the **reverse** relationship
  — FORGE would need to charge the lender directly, which means either (a) FORGE's own platform Stripe
  account creating a separate charge/subscription against the lender (a materially different Stripe
  relationship than anything that exists in this codebase today — no code path currently has FORGE, as
  opposed to a landlord/lender, ever be the payee), or (b) an off-Stripe invoicing mechanism. This is
  **not** solvable by reusing any existing table or RPC and is flagged as a real open question requiring
  its own design pass, not assumed solvable within the existing Connect architecture (see §10).
  It must never be implemented as a deduction from a borrower's submitted payment amount before the
  `private_financing_events` payment-received row is posted — the credit event is always computed from
  the full submitted amount, and any FORGE fee is a wholly separate, later, lender-initiated charge.
- Borrower-paid servicing fees (mentioned in the handoff as a *possible future* option, law/agreement
  permitting) require their own explicit `fee_payer` discriminator on the account (`'lender' | 'borrower'`),
  defaulting to `'lender'` and never retroactively switchable — a borrower-paid fee must be separately
  disclosed and receipted, never silently blended into a payment amount.
- **South Main**: `platform_fee_cents = 0`, hardcoded/grandfathered, with a comment in the migration or
  seed data explaining why — the seller absorbs both FORGE servicing and Stripe processing costs
  permanently for this account, per the owner's explicit direction, and this must remain true even after
  the fee mechanism is later activated for other accounts.

### 9. Future boundaries for optional credit reporting and FORGE Documents

- **Credit reporting (PF-5)**: reserve extension columns only — e.g.
  `private_financing_borrowers.credit_reporting_opt_in boolean default false`,
  `credit_reporting_provider text null`, `credit_reporting_consented_at timestamptz null` — never
  populated or read by any live code path through SF-4. No provider integration, no furnisher-format
  logic, no dispute workflow. This is a placeholder boundary, not a partial implementation — the handoff
  is explicit that this must not be implemented or advertised as available during SF-0 through SF-4, and
  nothing proposed here crosses that line.
- **FORGE Documents**: reserve a `document_evidence_id`-style reference field on relevant tables (already
  planned into `private_financing_events`, §4) so a future document layer has somewhere to attach a
  generated/signed artifact, but no template engine, no state/loan-type template registry, and no
  generation logic is proposed for SF-0 through SF-4. The controlled-levels delivery the handoff specifies
  (import-and-service existing agreement → non-binding term sheet → attorney-reviewed versioned templates
  → full execution packages) is a later, separate initiative with its own gates.

### 10. Processor, reporting-provider, licensing, template-review, and policy questions requiring verification

These are genuinely open — none are answerable by reading this repository's code, and none are answered
here:

1. **Stripe account-level policy**: does Stripe's underwriting/terms-of-service for this connected
   account's existing business description (rental payments) already cover "seller-financed real-estate
   note servicing," or does this require a distinct connected account with its own business description/
   MCC? The owner explicitly flagged not to assume equivalence — this needs a direct read of Stripe's
   Connect platform agreement and/or a conversation with Stripe, not a code inspection.
2. **State lending/servicing licensure**: does servicing an existing seller-financed note (not
   originating, not underwriting, not buying debt) trigger a state loan-servicer or mortgage-servicer
   license requirement in the state where South Main sits, for either the seller or for FORGE as the
   software provider? This is a real legal question requiring qualified counsel, independent of any code
   in this repository.
3. **FORGE-as-merchant billing relationship** (§8): what Stripe product (Billing/Subscriptions on FORGE's
   own platform account, versus an off-Stripe invoice) is appropriate for collecting a $0–$10/month
   platform fee directly from a lender? This is a genuine architecture/product decision with no existing
   precedent in this codebase to extend.
4. **Credit-reporting furnisher relationship**: which third-party furnisher/reseller would FORGE use, what
   data-accuracy and dispute-resolution obligations follow (FCRA, Metro 2 format), and what verified
   identity data would that provider require FORGE to collect/tokenize? Not answerable from code; needs a
   vendor and legal review, explicitly deferred to PF-5 per the handoff.
5. **FORGE Documents template legality**: state- and loan-type-specific promissory note/deed-of-trust
   templates require attorney review per the handoff's own explicit delivery-level gate — this is a
   licensing/content question for each jurisdiction FORGE eventually supports, not a code question.
6. **South Main's actual existing note documents**: do they contain any assignment-of-servicing notice
   requirement to the borrower, or any restriction on the servicing method, that should shape SF-4's
   import/notification design? This requires the owner (or counsel) to review the real, physical note
   documents already referenced in the handoff's opening facts — outside this repository entirely.

### 11. Proposed SF-1 slices and tests, using South Main as the first proof account

SF-1 is schema + pure calculation engine only — no Stripe, no UI, no Production import, no money
movement, matching the handoff's own SF-1 gate exactly.

**Slice 1 — Schema (migration only, no data, no Production apply without separate instruction)**:
`private_financing_accounts`, `private_financing_components`, `private_financing_events`,
`private_financing_payment_allocations`, `private_financing_payoff_offers` — forward-only migration(s),
owner-scoped RLS via `has_workspace_access` from the first migration (never added later), following the
exact `drop policy/create policy` and `create or replace function` conventions already established.

**Slice 2 — Calculation engine** (`src/domains/private-financing/`, pure JS, no I/O):
- `computeAccrual(component, asOfDate)` — 365/365 actual-elapsed-day interest on the outstanding
  interest-bearing balance.
- `allocatePayment(components, paymentAmountCents, appliedDate)` — interest first, then the regular 3%
  principal portion, then the regular $83.33 zero-interest portion, then any amount above the combined
  regular payment applied to the 3% principal (matching the handoff's required allocation order exactly,
  §"Required allocation behavior" items 1–5).
- `replayEvents(events, asOfDate)` — full historical reconstruction of balances/interest/principal-paid as
  of any date, never a stored running total.
- `computePayoffQuote(account, asOfDate)` — derived, never persisted as fact.
- Cent-safe rounding/remainder distribution, explicitly tested (not assumed correct by inspection).

**Slice 3 — Golden tests using the real South Main history**: the 48 recorded payments and the owner-approved
opening-reconciliation numbers (from the handoff's "Owner-approved South Main opening facts" section) become
fixture input and expected output:
- Given the raw payment events from calculation-start (2022-03-23) through 2026-08-23, the engine must
  reproduce: interest paid through 2026-08-23 = $4,807.37; principal paid or credited = $23,156.53
  ($21,769.63 actual cash + $1,386.90 seller credit); corrected principal remaining immediately after the
  credit = $31,843.47; next regular payment = $517.85 due 2026-09-23.
- A dedicated test proves the workbook's two known defects (the $100 second-loan carry-forward error and
  fixed-monthly-interest instead of actual-day) are **not** reproduced by the new engine — i.e. a test that
  would fail if the engine accidentally imported the workbook's flawed logic instead of computing
  independently from raw events.
- Tests for the required allocation order itself (interest first, regular 3% portion, regular 0% portion,
  overpayment-to-3%-principal), for prepayment (interest stops accruing on prepaid principal, no penalty),
  for underpayment/overpayment preservation, and for the explicit "never assess a late charge for this
  account" rule.
- Tests proving replay is reproducible as of any historical date, not just the present.

No migration is applied to Production, no South Main data is imported, and no money moves in SF-1 — this
matches the handoff's gate precisely, and the golden-test fixture data lives in the test file itself, not
in a live database.

### 12. Conflicts or decisions that genuinely require owner input

1. **Second worktree inoperability** (§1): this session's sandbox cannot interactively operate a second
   git worktree; SF-1 forward will continue on a fresh branch inside this same worktree directory (the
   pattern already used successfully for GW-1→GW-2→GW-3), unless the owner has a way to relax that
   constraint. Purely a process note, not a design conflict.
2. **Interest-accrual posting model** (§4): compute-on-read (recommended) versus a periodically-posted
   accrual ledger row. Flagged as a recommendation, not a blocking question — either satisfies every
   stated requirement, but the owner may have a preference once statements (SF-2/SF-3) are designed in
   more detail.
3. **Webhook/system actor attribution** (§6): no "system" sentinel actor convention exists anywhere in
   this codebase; the recommendation is to fall back to `owner_id` for `created_by`/`updated_by` on
   system-driven ledger rows, matching the one existing precedent for this exact situation. Worth an
   explicit owner sign-off since it's the kind of small convention that's expensive to change later across
   an immutable ledger.
4. **`landlord_payment_accounts` reuse vs. new table** (§3, §7): recommendation is a dedicated
   `private_financing_payment_accounts` table rather than widening the existing rent Connect-account
   table's unique constraint, specifically to avoid any risk to the live, working rent-payment system.
   This is the safer default but does mean South Main would get its own, separate Stripe Connect
   onboarding rather than reusing an existing rental Connect account if the owner already has one for this
   property — worth confirming this is the intended relationship before SF-2/SF-3 build against it.
5. **`payment_webhook_events` direct reuse vs. a parallel table** (§3, §7): the existing table appears
   schema-generic enough to reuse directly for loan-payment webhook idempotency, but this was confirmed by
   inspection, not by a live query against the table's actual current constraints in Production — worth a
   final confirmation at the start of SF-1's schema slice before committing to shared-table reuse.
6. Items 1–6 in §10 (processor policy, licensure, FORGE-as-merchant billing relationship,
   credit-reporting furnisher, document-template legality, South Main's actual note-document
   requirements) all require owner and/or outside-counsel input this repository cannot supply — none are
   blocking SF-1 (schema + calculation engine only), but all block SF-3 (real payments) and beyond.

## SF-1 — Checkpoints A–D closeout (complete, not applied, not committed)

**Status (2026-08-29): SF-0 complete. SF-1 Checkpoints A, B, C, and D are all complete and owner-approved.**
Nothing in this section has been committed, pushed, merged, deployed, or applied to any live database.
The work exists only as uncommitted changes on this branch/worktree.

1. **Checkpoint A — currency-safe calculation engine.** `currencyMath.js`, `interestAccrual.js`,
   `paymentAllocation.js`, and the golden South Main replay fixture/test are complete and owner-approved.
   Actual-day (365/365) accrual, largest-remainder-safe cent allocation, no floating point anywhere.
2. **Checkpoint B — immutable ledger contracts.** `privateFinancingContracts.js` and its tests are complete
   and owner-approved, including the later `manual_external` addition (§below).
3. **Checkpoint C — replay, adjustment preview, and payoff-quote logic.** `replayEvents.js`,
   `adjustmentPreview.js`, `payoffQuote.js`, `payoffOffer.js`, `ledgerOrdering.js`, `ledgerIntegrity.js`,
   and their tests are complete and owner-approved.
4. **Checkpoint D — proposed schema/RLS migration, revised and validated.** The single migration file
   `supabase/migrations/20260830000200_create_private_financing_foundation.sql` is complete and
   owner-approved after a full revision cycle that added: a borrower identity/membership split
   (`private_financing_borrowers` vs. `private_financing_account_borrowers`, deliberately not merged with
   `rental_tenants`); a borrower-safe read boundary as a guarded RPC
   (`read_private_financing_borrower_events`) rather than a view; membership-safe terms versioning;
   sequence-allocation hardening (row-locked, concurrency-safe); payoff-offer transition authorization;
   and, per an explicit owner instruction mid-checkpoint, a new `manual_external` event-origin value
   (distinct from `manual_import`) so a seller can record a payment a borrower sent through an outside
   app (e.g. Venmo, Cash App) without that being confused with historical-record reconstruction. This
   checkpoint does **not** implement any Venmo/Cash App integration — only the schema/attribution boundary
   for a seller to manually confirm such a payment occurred.
5. **Park Rentals crossover compatibility.** Verified against
   `governance/specifications/park-rentals-and-private-financing-crossover-handoff.md`
   (commit `867080c0c6c34e93464fc10741c9c5c80d09e7a3`) before finalizing Checkpoint D. The current design
   preserves that future boundary; no park properties, sites, utilities, reservations, recurring park
   charges, combined payments, or Park Rentals UI were implemented, and none of Checkpoint D's tables
   assume a single-family-house or Rental Manager property model.
6. **Disposable local PostgreSQL/Supabase validation — completed and accepted.** The migration was applied
   to a fully disposable, throwaway local Postgres/Supabase stack (never Production, never any shared
   database) via `supabase db reset --local`, exercised with real authenticated-identity behavioral tests
   across owner/co-owner/unrelated-user/borrower/unrelated-borrower/anonymous/webhook-forgery paths, a
   genuine concurrency test, and a DB-to-JS replay round-trip check, then fully torn down
   (`supabase stop --no-backup`). Two real defects were found and corrected in the migration file as a
   result:
   - An invalid PostgreSQL simple-CASE construct (`case event_type when 'a', 'b' then …`) in the
     per-event-type CHECK constraint, corrected to a searched CASE (`case when event_type = 'a' then …
     when event_type in ('a','b') then …`).
   - A JSON key-casing mismatch in `open_private_financing_account`'s two `jsonb_to_recordset(...)` calls
     (snake_case column aliases against camelCase caller payloads), which silently extracted `null` instead
     of erroring and caused a false "must not repeat a componentType" rejection; corrected to quoted
     camelCase aliases matching the JS contract layer.
   A third apparent issue (missing `authenticated`/`anon` table grants) was root-caused to a local-only
   Supabase CLI environment gap — a one-time platform-level grant bootstrap that Production already has and
   that no migration in this repository's history creates explicitly — and is **not** a migration defect;
   nothing in the migration file changed because of it.
7. **Payment-acceptance policy (owner-approved requirement, added after Checkpoint D's first approval).**
   A closed, versioned `payment_acceptance_policy` (`partial_allowed` / `full_amount_or_more` /
   `exact_amount_only` -- one enum, never two independent booleans) governing what a BORROWER-INITIATED
   ONLINE payment amount would be allowed to be. Explicit at account opening (`open_private_financing_account`
   now requires it as a plain parameter, never defaulted); prospective and append-only thereafter via the
   new `private_financing_servicing_policy_versions` table and its guarded
   `append_private_financing_servicing_policy_version` RPC (primary owner and co-owner only, enforced the
   same `has_workspace_access` way as every other seller-only RPC; a borrower has no path to it at all);
   a version-ordering trigger and an RPC-level "not in the past" check together make backdating
   structurally impossible. The pure accept/reject decision itself lives in
   `src/domains/private-financing/paymentAcceptancePolicy.js` (`evaluatePaymentAcceptance`), a fail-closed
   function that takes an already-authoritative amount-due figure (computed by the existing
   replayEvents/payoffQuote engine -- no second balance engine was added) and detects staleness via a
   ledger-sequence snapshot, the same idiom `payoffQuote.js` already uses for its own staleness check.
   This policy is fully decoupled from `manual_import`/`manual_external` recording in both directions --
   a seller confirming a real external payment (Venmo, Cash App, Zelle, PayPal, bank transfer, cash,
   check, money order) is never gated by it, and South Main's own historical partial payments and later
   online policy choice (still to be made during its import review) cannot invalidate each other. No
   online-payment initiation, Stripe integration, or borrower payment UI was added -- this addition stays
   within Checkpoint D's schema/authorization/versioning boundary, validated the same disposable-local-
   Postgres way as the rest of Checkpoint D (real owner/co-owner/borrower/unrelated-workspace identities,
   the version-ordering trigger, and the previously static-only `late_fee_policy='enabled'` rejection path
   were all exercised live in this pass).
8. **Not done, and not authorized by this closeout:** the migration has not been applied to Production or
   any shared database; South Main has not been imported into any live account; no borrower has been
   invited or has claimed a portal identity; Stripe/payment-processor integration has not been activated;
   no online-payment initiation path exists anywhere in this repository; SF-2 (the write-path work that
   actually posts adjustments/payments through these RPCs from the UI) has not begun.
9. **Gates that remain open before any real money moves**, per §10 and item 6 above: processor policy and
   FORGE-as-merchant billing relationship, licensure, the credit-reporting furnisher relationship,
   document-template legality/review, and South Main's actual note-document requirements. None of these
   were resolved by SF-1 and none block schema/calculation work; all block SF-3 and live payments.

## SF-2 — Private Financing Seller Administration

**PR #57 (SF-1, 6 commits) merged to `main` at `62689f804b2d0deba90e955d8bb89ebb73a2c008` (2026-08-29).**
Verified before merge: 6 commits, head `365695d645294ccee6070bd7d2dcd526e8eac064`, 0 behind `main`, Vercel
check green, zero unresolved review threads, no merge conflict, migration confirmed unapplied remotely
(`supabase migration list` showed a blank Remote column for `20260830000200`), `AGENTS.md`/`CLAUDE.md`
absent from the PR. Post-merge: all six SF-1 commits confirmed ancestors of `origin/main`; the Park
Rentals crossover handoff confirmed present; `supabase migration list` re-run against `origin/main`
confirms the Private Financing migration is *still* local-only, not remote; the Vercel deployment for the
merge commit reports `state: success`. SF-2 work continues on a fresh branch, `explore/private-financing-sf2`,
created from the post-merge `origin/main`; `explore/seller-financing-sf0` is preserved (merged, not deleted).

### 1. Read-only integration inspection (source-cited, before any SF-2 code was written)

**Rental Manager navigation and application shell.** Two-part registration for a promoted top-level area:
`WORKSPACES` array + `PROMOTED_OUT_OF_FORGE` in `src/lib/workspaces.js:12-46`, and `PROMOTED_PREFIXES` in
`src/components/forge/ForgeApplicationRail.jsx:63`. App Router: `src/app/forge/rental/layout.js` (wraps in
`WorkspaceShell`) + `src/app/forge/rental/page.js` (server auth/redirect, then a client page) — this is
the *top-level workspace* pattern, not what SF-2 needs. Inside Rental Manager itself, sections are config
entries, not routes: `RENTAL_NAVIGATION` in `src/components/forge/rental/RentalApplicationShell.jsx:16-22`
(grouped `{label, items:[{id,label}]}`), rendered by `RentalNavSidebar` (lines 82-137), with
`buildRentalSurface()` (lines 25-29) mapping an `id` to its panel component. **SF-2's own instruction names
this exact layer** ("SF-2B — Rental Manager navigation, account list") — so Private Financing becomes a
new `RENTAL_NAVIGATION` entry plus a panel registered in the surfaces map, not a new top-level workspace.

**Existing seller-facing payment/adjustment panels.**
`src/components/forge/rental/RentalPaymentsPanel.jsx` (177 lines) is the closest analog: a merged
charge/payment/settlement timeline (`buildRentActivity`, lines 14-17), `Intl.NumberFormat` money
formatting, a toggleable "Record offline payment" form, and a void action gated by an inline confirm
sub-form (`showVoidConfirm`, lines 166-170) — not a modal.
`src/components/forge/rental/RentalLeaseLifecyclePanel.jsx` shows the same shape for late-fee
assessment: a create-rule form plus a separate "assess" form, each requiring an explicit `required`
checkbox ("I confirm...") before the consequential POST fires. `RentalReconciliationPanel.jsx` and
`RentalDepositsPanel.jsx` are the other adjacent balance-display precedents.

**Accessible modal/form/confirmation patterns.** No shared Modal/Dialog component exists — each of
`RentalHelpModal.jsx` and `src/components/forge/scheduling/SchedulingCalendarsModal.jsx` hand-rolls its
own overlay (`role="dialog" aria-modal="true" aria-labelledby`, backdrop `onClick`+`stopPropagation`,
`autoFocus` on close, manual Escape-key `useEffect`). For a *single consequential action* (void a charge,
assess a fee), the established pattern is an inline reveal-form plus a `required` confirmation checkbox,
not a modal at all (`RentalPaymentsPanel.jsx:168-170`, `RentalLeaseLifecyclePanel.jsx`). Forms are plain
`<form onSubmit>` + `new FormData(event.currentTarget)` — no react-hook-form or any form library anywhere
in this repo (repo-wide grep, zero matches). Errors render via `<p role="alert">`.

**API/application-layer authorization pattern.** Every authenticated route opens with a per-domain
factory (`createAuthenticatedForgeApplication.js:17-74`, `createAuthenticatedFinancialApplication.js`) that:
builds a request-scoped Supabase server client (`src/lib/supabase/server.js:9-47`, `@supabase/ssr` +
Next `cookies()`), calls `auth.getUser()`, returns a 401 `NextResponse` on failure (checked via
`if (authenticated.response) return authenticated.response;` everywhere), and resolves
`effectiveOwnerId`. Routes then either query directly through `authenticated.supabaseClient` relying on
RLS (`/api/workspace/members/route.js:22-46`, GET), call an RPC (`.rpc("invite_workspace_member", ...)`,
same file, POST/PATCH), or go through a domain repository class
(`/api/rental/manual-financial-event/route.js`). **One inconsistency flagged, not to be replicated**:
`/api/financial/accounts/route.js:13` filters `.eq("owner_id", authenticated.user.id)` instead of
`effectiveOwnerId` — a co-owner-scoping bug in an older route. SF-2 always uses `effectiveOwnerId` and/or
plain RLS, matching the newer, correct `/api/workspace/members` pattern.

**Primary-owner/co-owner workspace resolution.** `src/lib/supabase/resolveEffectiveOwnerId.js:14-28`
queries `workspace_members` for an active `co_owner` row and returns its `owner_id`, falling back to the
actor's own id; every `createAuthenticated*Application` factory calls it. There is **no shared
client-side hook/context** — `WorkspaceMembersPanel.jsx:8-9,23-24` keeps local `viewerRole`/`viewerId`
state populated straight from the API response, matching the server contract set at
`/api/workspace/members/route.js:38` (`viewerRole = user.id === effectiveOwnerId ? "primary_owner" : "co_owner"`).
SF-2 follows this same per-fetch pattern rather than introducing new shared client infrastructure.

**Local disposable Supabase development.** Fully established across SF-1's own Checkpoint D validation:
`supabase init` (local-only `config.toml`/`.gitignore`/`.branches`, none committed), `supabase start
--exclude <heavy services>` for a Postgres-only stack, migrations applied fail-fast, a one-time local
grant bootstrap (`grant all privileges on all tables/sequences in schema public to anon, authenticated,
service_role; alter default privileges ...`) since the local CLI doesn't replicate Production's
one-time platform-level bootstrap, `SET ROLE authenticated; SET request.jwt.claim.sub = '<uuid>';` for
identity simulation, `supabase stop --no-backup` for full teardown (confirmed via `docker ps -a`), and
`supabase migration list` to compare local-vs-remote applied state (the exact command used to confirm
the migration remains unapplied both before and after the SF-1 merge).

**Handling when the Private Financing migration is absent remotely.** **No precedent exists.** A
repo-wide grep for Postgres error codes `42P01`/`42883`/`undefined_table`/`undefined_function` across
`src/app/api/**/route.js`, `src/lib/supabase/**`, `src/domains/**` returns nothing; the only existing
Postgres error-code branching in this codebase is unique-violation handling (`23505`) in
`/api/financial/investment-accounts/route.js:115` and `/api/rental/route.js:423`, both just producing a
friendlier duplicate-key message. No UI component renders a "not available yet" state tied to a missing
backend table/RPC either. **SF-2A introduces this guard itself** (see below) — it is the first API
surface in this repository whose own migration may not yet be applied to every environment it ships to.

**Test and visual-verification conventions.** Only Vitest is used (`package.json` `test`/`test:watch`/
`test:coverage` scripts); there is no Playwright, Cypress, Puppeteer, or `@testing-library/*` dependency
anywhere in this repo. React component tests render manually via `react-dom/client`'s `createRoot` +
`act()` inside `// @vitest-environment jsdom` files (e.g.
`RentalLeaseRenewalPanel.test.jsx`, `WorkspaceMembersPanel.test.jsx`). API route handlers are
consistently unit-tested by mocking the auth factory and stubbing a fake Supabase client
(`/api/workspace/members/route.test.js`) — this is the pattern SF-2A's own route tests follow. UI/visual
verification is manual-only in this repository; there is no browser-driven automated check to reuse.

### 2. Ordered SF-2 checkpoints

- **SF-2A — Authenticated application services, read models, and API boundaries.** No UI. Delivers:
  `createAuthenticatedPrivateFinancingApplication.js` (auth + `effectiveOwnerId`, mirroring
  `createAuthenticatedForgeApplication.js`'s shape but without a multi-repository "application suite" —
  SF-2A's reads are simple RLS-scoped selects, matching `/api/workspace/members` GET's own precedent, not
  the larger Forge/Financial operation surface that pattern was built for); `isMissingRemoteSchemaError.js`
  (the 42P01/42883 guard this repo has never needed before); `persistedRowMapping.js` (a pure,
  independently-tested translation from `private_financing_events`/`private_financing_components` DB rows
  into the exact camelCase shape `replayEvents.js` already requires — never a second balance engine);
  and three read-only routes: `GET /api/private-financing/accounts` (list, RLS-scoped), `GET
  /api/private-financing/accounts/[accountId]` (account + current components + current servicing policy +
  a computed balance summary via `replayEvents`), and `GET /api/private-financing/accounts/[accountId]/events`
  (full seller-facing ledger history — every column the seller's own RLS already grants, unlike the
  borrower-safe RPC). Every route returns `{ available: false, ... }` with HTTP 200 rather than a 500 when
  the schema doesn't exist remotely yet, satisfying "missing remote tables must produce a controlled
  unavailable/empty state, not crash existing Rental Manager." Payoff-quote generation (which needs a
  UI-supplied target date) is deliberately deferred to SF-2C, not built here.
- **SF-2B — Rental Manager navigation, account list, and empty state.** Adds a `RENTAL_NAVIGATION` entry
  and a list panel (mirroring `RentalPaymentsPanel.jsx`'s structure) consuming SF-2A's list endpoint,
  including the `available:false` empty/coming-soon state.
- **SF-2C — Account details, balances, history, and payoff presentation.** A detail panel consuming
  SF-2A's detail + events endpoints; payoff-quote generation (via `payoffQuote.js`, UI-supplied target
  date) is added here, in the API layer, the first time a UI actually needs it.
- **SF-2D — Seller adjustment previews and explicit confirmations.** Adjustment preview
  (`adjustmentPreview.js`, already pure/reused) surfaced in the UI with the established
  inline-reveal-form-plus-required-checkbox confirmation pattern (`RentalLeaseLifecyclePanel.jsx`'s
  precedent) before any real `append_private_financing_event` call.
- **SF-2E — Seller-confirmed external payments and payment-policy controls.** Venmo/Cash App/etc. recording
  UI (`manual_external`) and the servicing-policy-version UI
  (`append_private_financing_servicing_policy_version`), both following the same confirmation pattern.
- **SF-2F — Local disposable-database and visual/accessibility verification.** A full disposable
  Supabase pass (per the established SF-1 methodology) plus manual browser verification of every SF-2B–E
  surface, since this repo has no automated visual-verification tooling to invoke instead.

### 3. SF-2A delivered (this pass)

6 new files, all tested and lint-clean: `src/lib/supabase/isMissingRemoteSchemaError.js` (+test),
`src/lib/supabase/createAuthenticatedPrivateFinancingApplication.js` (+test),
`src/domains/private-financing/persistedRowMapping.js` (+test, including a round-trip test through the
real `replayEvents`/`allocatePayment`/`computeAccrual` engine — fixture figures are generated by that same
engine, never hand-computed, so the test is correct by construction), and the three
`/api/private-financing/accounts*` routes (+tests). No owner decision was required to proceed: every open
question (nav placement, authorization shape, missing-schema handling) was already settled either by
existing repository precedent or by this checkpoint's own explicit instructions.

### 4. SF-2A approved — pre-SF-2B API corrections

Three gaps identified in review, all closed before SF-2B began:

1. **Missing-schema semantics.** All three routes now return **HTTP 503** with a stable
   `code: "private_financing_schema_unavailable"` and a safe, generic message — never a 200 with an empty
   array, and never the underlying Postgres error's own code/message. A caller can now always distinguish
   four states: 401 (unauthorized, from the auth factory), 503+code (feature not activated in this
   environment), 500 (an ordinary, safe-messaged failure), and 200 (available — `accounts: []` for a
   genuinely empty portfolio, non-empty otherwise). `isMissingRemoteSchemaError` gained 7 explicit negative
   tests proving it never matches authorization failures (42501), malformed queries (42601), schema-drift
   (42703), connectivity failures (08006), resource exhaustion (53300), or constraint violations (23514) —
   only the two exact codes it was built for (42P01, 42883). New shared helper:
   `src/lib/supabase/privateFinancingSchemaUnavailableResponse.js`.
2. **Event-history pagination.** `GET .../events` is now keyset-paginated on `ledger_sequence` (stable,
   gapless, append-only — chosen specifically because it cannot duplicate or skip rows when new events
   append between page fetches, unlike OFFSET). New module `src/domains/private-financing/eventHistoryCursor.js`:
   an opaque, account-bound cursor (malformed, wrong-shaped, or cross-account cursors all fail closed with
   400 + `code: "private_financing_invalid_cursor"`, never silently restarting from page one), an explicit
   default (50) and maximum (200) page size, and a `pageInfo: { hasMore, nextCursor, pageSize }` envelope.
   The account-detail route's own balance computation is unaffected — it still replays the **complete**
   authorized event history internally regardless of what page a caller of the history endpoint happens to
   be viewing; nothing paginated ever feeds a partial page into `replayEvents`.
3. **Numeric mapping.** `persistedRowMapping.js` now asserts every `*_cents`/`rate_bps`/`ledger_sequence`
   field is within `Number.isSafeInteger` range before it ever reaches the replay engine, throwing a new
   `PersistedRowMappingError` (not silently truncating) on an out-of-range or non-integer value. Sign/range
   *business rules* (e.g. "amount_cents must be positive") remain solely `privateFinancingContracts.js`'s
   responsibility, re-enforced immediately downstream by `replayEvents.js` — deliberately not duplicated in
   the mapping layer, proven by a new integration test (a negative `amount_cents` row maps successfully at
   the numeric-safety layer, then is rejected by `replayEvents` the moment it's folded). Additional tests
   confirm no `Date`/`parseInt`/`parseFloat`/`Number(...)` parsing exists anywhere in the module (dates and
   numbers pass through byte-for-byte) and that the module can never itself produce a "balance"-shaped
   field, only event/component-shaped input for `replayEvents` to fold.

### 5. SF-2B — Rental Manager navigation, account list, and honest empty/unavailable states

**Navigation**: added `{ id: "private-financing", label: "Private Financing" }` to `RENTAL_NAVIGATION`'s
existing "Money" group (`RentalApplicationShell.jsx`), and registered
`"private-financing": <PrivateFinancingAccountsPanel />` in `buildRentalSurface()` — the exact same
config-array + surfaces-map pattern every other Rental Manager section uses; no new top-level FORGE
application, no new route. `RentalHelpModal`'s per-function help content was deliberately left unauthored
for this id — its own `getRentalFunctionHelp` already falls back to the Overview help text for any
unregistered id, so nothing breaks; authoring Private-Financing-specific help copy was out of this
checkpoint's explicit scope and is noted here as a real, minor, non-blocking gap for a later pass.

**Account-list panel**: `src/components/forge/rental/PrivateFinancingAccountsPanel.jsx`. Consumes SF-2A's
list endpoint only — every displayed figure (principal remaining, next-amount-due, payment-acceptance
policy) is exactly what the API returned; nothing is recomputed in React. Two required display fields —
**due date** and **past-due status** — have **no backing data model anywhere in SF-1's schema**: there is
no due-day column, no recurrence rule, and no "next due date" concept stored or computable from what
exists today (confirmed by inspection of `private_financing_accounts`/`private_financing_components`).
Rather than infer or fabricate either figure (e.g. assuming a monthly cadence from the last payment date,
which the schema does not actually guarantee), both render as the honest, explicit string "Not tracked
yet," and the API's own `dueDateTrackingAvailable: false` flag makes this a structural fact of the
response, not a UI guess. This is flagged here as a genuine design gap for a future checkpoint (a due-date/
cadence concept would need its own additive migration) rather than something SF-2B silently worked around.
To support the remaining required fields honestly, SF-2A's list endpoint (`GET /api/private-financing/accounts`)
was extended, still read-only: a real joined **borrower label** (from `private_financing_account_borrowers`
+ `private_financing_borrowers`, excluding only revoked memberships; `null` — never a placeholder string —
when no borrower exists yet), the real **payment-acceptance policy** (from
`private_financing_current_servicing_policy`), and a real computed **balance** per account via the newly
extracted, shared `src/domains/private-financing/accountBalanceSummary.js` (now used by both the list and
detail routes, so a balance is never computed two different ways). All of this is bulk-fetched (accounts,
memberships, borrowers, policies, events, and version-1 components are each one `.in(accountIds)` query
regardless of portfolio size) — no N+1 pattern.

**Four states, all implemented and tested**: a calm, duplicate-request-guarded loading state (a `useRef`
flag makes a second concurrent load a no-op, not a race); the genuine empty state ("No private financing
accounts yet," explicitly explaining account creation/import comes in a later checkpoint, with zero
fabricated South Main or any other placeholder data); the schema-unavailable state (503 + stable code,
explicitly worded as "not activated for this environment," never described as an empty portfolio, with a
working Retry); and an ordinary-error state (safe, generic message only, Retry, no database internals ever
rendered).

**No premature actions**: no create/import/adjustment/external-payment/payoff-offer/policy-change/borrower-
access/Stripe control exists anywhere in this panel — verified by an explicit test asserting none of that
copy appears. **Open** is a real, working control (not a dead button): it toggles an inline, honestly-worded
notice — "Full account details, balances, history, and payoff presentation are not available yet — they
are coming in a later checkpoint" — rather than linking to a nonexistent detail page or pretending to show
one.

**Authorization and isolation**: the panel calls only `GET /api/private-financing/accounts`, which is
itself gated by `createAuthenticatedPrivateFinancingApplication` (401 on no session) and RLS
(`has_workspace_access(owner_id)`) on every underlying table; there is no direct Supabase client call and
no service-role path anywhere in the component (verified by a test asserting `fetch` is the only method
used, GET only, no mutating verb). A co-owner viewer receives the identical canonical-workspace list a
primary owner would (verified). No borrower-facing path exists in this panel at all.

**Accessibility and presentation**: native `<button>` elements throughout (inherently keyboard-reachable),
explicit `focus-visible:outline` utility classes on every interactive control (matching
`RentalNavSidebar`'s own precedent, stricter than the plain `goldControlClassName` buttons elsewhere in
Rental Manager rely on), `role="status"`/`role="alert"` on loading/error announcements, semantic
`<h2>`/`<dl>`/`<dt>`/`<dd>` structure, `dark:` classes on every colored surface, and a responsive
`sm:grid-cols-2 lg:grid-cols-3` fact grid with no fixed-width elements. No status is communicated by color
alone — every state (loading/empty/unavailable/error) carries its own explicit text.

**Guided-workflow compatibility**: the panel root carries `data-guided-workflow-panel` and its two controls
carry `data-guided-workflow-control="open-account"` / `"retry"` — the exact attribute vocabulary
`RentalLeaseRenewalPanel.jsx`/`RentalFirstTenantReadinessPanel.jsx` (GW-1/GW-2/GW-3) already established,
applied here purely for semantic-targeting consistency. This panel implements no step machine, no restart/
why affordances, and no `data-guided-workflow-step` — it is not a guided workflow, and GW-1/GW-2/GW-3
behavior is untouched (confirmed: no file under `guided-workflow/` was modified).

**Tests**: `RentalApplicationShell.test.jsx` gained a navigation-registration assertion (the "Money" group
contains `private-financing`) and a surface-reachability assertion; its existing full-function-list
assertion was updated to include the new id. `PrivateFinancingAccountsPanel.test.jsx` (16 tests) covers:
initial loading render, duplicate-request prevention, real-account rendering (every required field), no
fabricated records, the genuine empty state, the schema-unavailable state (distinct wording, no empty-
portfolio language), the ordinary-error state (no leaked internals), Retry (including recovery from
schema-unavailable to available), canonical-owner and co-owner response handling, fetch-only/no-mutating-
method usage, absence of every premature action, the Open toggle's real behavior, keyboard/focus-visible
semantics, and status/alert roles plus dark-mode class presence.

## SF-2C — Account details, balances, history, and payoff presentation

Preserved SF-2A and SF-2B unchanged, per instruction — `RentalApplicationShell.jsx`'s nav registration and
`buildRentalSurface()` entry from SF-2B are untouched this pass; only the account-list panel's own Open
button now navigates to a real detail view instead of SF-2B's honest placeholder notice (the one necessary
integration point SF-2C itself required — "Open selects the exact account").

### 1. Backend extensions (still read-only, still API-only)

`GET /api/private-financing/accounts/[accountId]` gained three things, all still through the exact same
RLS-scoped, `has_workspace_access`-gated query pattern as before:

- **`interestDayCountConvention`** added to the account row mapper (was selected via `select("*")` but
  never surfaced in the response).
- **Borrower memberships**: `private_financing_account_borrowers` joined against `private_financing_borrowers`
  (two flat, bulk queries — id/borrower_id/role/status, then id/full_name/email — never a PostgREST
  relational embed, matching the same safer, more predictable pattern SF-2B's list-route join already
  established). Returns `{ membershipId, borrowerId, displayName, email, role, status }` only —
  `private_financing_borrowers` has no SSN/birth-date/identity-document column anywhere in its schema (see
  the migration's own Revision 1 comment), so "no hidden identity fields" is true by construction; `phone`
  and `auth_user_id`, though present on the underlying table, are deliberately left out of this read model
  as unnecessary for a seller-facing membership summary. This is the "seller-only authenticated read
  boundary" requirement 7 asked for if the detail API didn't already have one — it didn't, so this is new,
  fully tested, and does not reuse `rental_tenants`.
- **A read-only payoff estimate**, via new `src/domains/private-financing/payoffEstimate.js` wrapping SF-1's
  own `computePayoffQuote` (`payoffQuote.js`, Checkpoint C, untouched). Computed fresh on every request —
  never persisted, never a stored offer or concession (`computeAccountPayoffEstimate` is a strictly
  read-only wrapper; nothing under `src/domains/private-financing` gained a write path). `payoffThroughDate`
  is always `asOfDate` (today) — no funds-clearing buffer is assumed, avoiding an invented constant.
  `quoteId` is deterministic (`pf_estimate_{accountId}_{asOfDate}`), not randomly generated, so the same
  day's estimate is reproducible. Returns `null` (not an error, not a thrown exception) when the account has
  no balance yet or is already closed — checked via the already-computed `balanceSummary.closed` flag
  *before* calling `computePayoffQuote`, since that function itself throws on a closed account; this
  boundary check means the API caller never sees that throw. Late charges are always `0` and no fee field
  exists anywhere in the return shape — both true by inheritance from `payoffQuote.js`'s own design, not
  reimplemented here.

`src/domains/private-financing/accountBalanceSummary.js` (shared by list and detail routes since SF-2B)
gained two more pass-through fields from `replayEvents`' own return shape: `cumulativePrincipalForgivenCents`
("seller credits/concessions to date") and `unpaidAccruedInterestCents`.

### 2. The due-date/past-due gap, restated and applied consistently

SF-2B already found that this schema has no due-day column, no recurrence rule, and no "next due date"
concept anywhere. SF-2C's account-summary requirements name **three** fields that inherit this same gap:
"current amount due," "past-due amount," and "next due date." Rather than invent three different partial
workarounds, one consistent rule was applied: "current amount due" is shown as the real, already-computed
regular-payment figure (labeled "Current amount due (regular payment)," identical in meaning to SF-2B's
list-panel "Next amount due"), while "past-due amount" and "next due date" render as the same honest
"Not tracked yet" string SF-2B already established, with no invented cadence or inferred date. This is a
restatement of an already-flagged gap, not a new one.

### 3. UI: master-detail within the existing panel, not a new route

`PrivateFinancingAccountsPanel.jsx` (SF-2B) now conditionally renders `PrivateFinancingAccountDetail.jsx`
in place of the list when an account is open — the same single component instance, so the already-fetched
`accounts` array and list `status` state are never cleared or re-fetched by Back (verified by a test
asserting the list's own fetch is called exactly once across an Open→Back round trip). This mirrors
`RentalPaymentsPanel.jsx`'s own established master-detail pattern more closely than the `recordContext`
mechanism `RentalApplicationShell` uses for tenant/property drill-down elsewhere, chosen deliberately to
avoid touching `RentalPageClient.jsx`/shell-level record-context plumbing for a self-contained feature.

**`PrivateFinancingAccountDetail.jsx`** — fetches the detail endpoint, renders five sections (Account
summary, Loan components, Payoff estimate, Borrowers, then embeds the ledger history component), and
handles five distinct states: loading, schema-unavailable, not-found/inaccessible (both a missing and a
cross-workspace account id produce the identical 404-driven message, never a distinguishing side channel),
ordinary error with Retry, and available. Refresh re-fetches unconditionally. The stale-payoff banner
imports and calls `isQuoteExpired` from `payoffQuote.js` directly (a date-string comparison against an
already-computed `expirationDate`, not a financial recalculation) rather than reimplementing that check.

**`PrivateFinancingLedgerHistory.jsx`** — a separate component consuming the paginated SF-2A events
endpoint. Tracks loaded event ids in a `Set` and filters any server-resent id before rendering, as a
defensive belt-and-suspenders check on top of the keyset cursor's own no-duplicate guarantee (SF-2B's
pre-SF-2B correction). "Load more" disappears once `pageInfo.hasMore` is false, never lingering as a dead
control. Each `payment_posted`/`payment_reversal` row has an expandable, `aria-expanded`-driven allocation
explanation (amount received, interest applied, each principal component applied, unapplied amount if
present, and the authoritative post-payment balance per component — taken directly from the event's own
stored `principalRemaining*Cents`, never recomputed). Event origins render in plain language
(`interactive_user`→"Recorded live by seller", `manual_import`→"Imported historical record",
`manual_external`→"Seller-confirmed external payment", `stripe_webhook`→"Online payment
(provider-originated)" — labeled even though no live caller of that origin exists anywhere in this repo
yet, so the ledger never renders a raw enum value if one ever appears).

### 4. No premature actions, still true under detail view

No create/import/adjustment/payment/payoff-offer/policy-change/borrower-invitation control exists anywhere
in the detail view or ledger history — verified by an explicit test. Every fetch anywhere in SF-2C's three
new components is GET-only (verified). No direct Supabase client call exists in any component (verified by
inspection — every data access goes through `fetch()` against the SF-2A/SF-2C API routes).

### 5. Tests

`payoffEstimate.test.js` (7), `accountBalanceSummary.test.js` (+3 for the two new fields), the detail
route's own test file (+5 for day-count/components/payoff/borrowers), `PrivateFinancingAccountDetail.test.jsx`
(18: loading, real rendering of every required summary field, no fabricated data, component separation,
payoff date/fee-exclusion/late-charge-zero, stale and fresh payoff-warning states, borrower summaries and
privacy, the genuine no-borrower state, schema-unavailable, not-found, ordinary error + Retry, Refresh,
Back invocation, no mutating fetch, no premature-action controls, keyboard/focus-visible/heading semantics,
screen-reader description presence), `PrivateFinancingLedgerHistory.test.jsx` (8: loading, empty history,
real rendering with plain-language origin labels, Load-more pagination with no duplicates, defensive
duplicate filtering, ordinary error + Retry, the payment-allocation disclosure, GET-only fetch usage), and
two replaced/added tests in `PrivateFinancingAccountsPanel.test.jsx` (Open navigates to the real detail
view for the exact account clicked; Back returns without a redundant list re-fetch).

## SF-2C correction — the regular payment is not a current-due claim

**Owner finding.** SF-2C's account summary labeled the account's contractual regular-payment figure as
"Current amount due (regular payment)." The owner correctly identified this as a false claim: nothing in
this schema tracks payment cadence, arrears, or due dates (a gap SF-2B and SF-2C had both already flagged
in prose), so presenting the regular-payment figure *as* the current obligation implies a calculated,
arrears-aware present-due amount that does not exist. The correction required: never label the regular
payment as a present obligation; show it honestly as "Regular scheduled payment"; show "Current amount
due," "Past-due amount," and "Next due date" as three separate, honestly "Not tracked yet" facts; and
never expose the regular-payment figure through an API field name that implies a calculated due-state.

**Read-model rename.** `accountBalanceSummary.js`'s `regularPaymentCents` output field is renamed
`regularScheduledPaymentCents`, with an explicit comment warning any future caller never to rename it back
to imply arrears-awareness. This is the account-level summary field only — the unrelated, unambiguous
per-*component* `regularPaymentCents` field used throughout `paymentAllocation.js`, `replayEvents.js`,
`privateFinancingContracts.js`, `persistedRowMapping.js`, and the detail route's `rowToComponent` mapper is
untouched (confirmed by a repo-wide grep that every remaining hit is a genuine component-level field, never
the account-summary one).

**UI correction.** Both `PrivateFinancingAccountsPanel.jsx` (list) and `PrivateFinancingAccountDetail.jsx`
(detail) now render "Regular scheduled payment" (the real figure) and "Current amount due" (the honest
"Not tracked yet" string) as two separate facts, never one combined label; the detail view additionally
separates "Past-due amount" and "Next due date," each "Not tracked yet" — four honest facts where SF-2C
had one dishonest one.

**Tests.** `accountBalanceSummary.test.js` gained a test asserting the read model carries no
`currentAmountDue`/`amountDue`/`amountOwed`/`regularPaymentCents` property under any name.
`PrivateFinancingAccountDetail.test.jsx` gained a test asserting the rendered summary section contains
"Regular scheduled payment," does not contain the old combined label, and contains "Current amount due,"
"Past-due amount," and "Next due date" as three separate facts (each "Not tracked yet," verified as exactly
three occurrences within the summary section). `PrivateFinancingAccountsPanel.test.jsx` and the accounts
list route's own test were updated for the renamed field. All pre-existing SF-2A/2B/2C tests continued to
pass under the rename (fixtures updated, no behavior other than the label/field name changed).

## SF-2D — Seller adjustment previews and confirmed postings

### 1. Preview-first workflow, one dispatch point for both routes

Every one of the nine supported seller actions — bring-current/reporting credit, contractual principal
correction, discretionary principal concession, interest correction, interest waiver, Stripe-fee
reimbursement preview, compensating correction, payment reversal, and account closure — flows through a
single new dispatch function, `computeAdjustmentPreview` (`adjustmentActionRegistry.js`), called by BOTH
the preview route and the confirm route. This closes the one gap SF-1 Checkpoint C's own design intended
but SF-2D had to guarantee structurally: preview and posting can never compute an adjustment two different
ways, because there is only one function that computes either. `previewPaymentReversal` did not exist in
SF-1 Checkpoint C (the `payment_reversal` event type and RPC support did, but no preview function did) and
was added to `adjustmentPreview.js` as an SF-1-consistent extension, reusing `validateReversalReference`
and `buildPreviewEnvelope` identically to the existing `previewCompensatingCorrection`. Discounted payoff
offers were kept deferred (not part of SF-2D), consistent with the existing SF-2 checkpoint plan.

### 2. Staleness and idempotency without a database idempotency key

`interactive_user`-origin events structurally cannot carry an `idempotency_key`
(`private_financing_events_check3` forbids it), so double-click/duplicate-submit protection could not reuse
the pattern `manual_import`/`manual_external` events use. `adjustmentPreviewToken.js` instead binds an
opaque, unsigned token to `{ accountId, actionType, inputs, ledgerSequenceAtPreview, asOfDate }` — not a
security boundary itself (the guarded RPC and RLS remain the real boundary), only a staleness detector.
`assertAdjustmentPreviewTokenFresh` rejects a changed account, action, or input, and a moved ledger
sequence. The moved-ledger-sequence check does double duty as the double-submit guard: a first successful
post advances the account's real ledger sequence, so an immediately-repeated confirm call with the same
token is rejected on the second call even though no idempotency key exists for this event origin.

### 3. Truthful attribution, reused from SF-1 exactly

`appendEventRpcParams.js` never sends `p_created_by` — the RPC (`append_private_financing_event`, from SF-1
Checkpoint D, unmodified) forces it to the real `auth.uid()` for `interactive_user` events and rejects a
caller-supplied value otherwise. `p_owner_id` always comes from `authenticated.effectiveOwnerId` (the
workspace resolver), never from the replayed ledger snapshot or any client input. `p_event_origin` is always
`interactive_user`, baked into every SF-2D preview function's own `proposedEventPayload`, never read from
the request body.

### 4. Backdating restricted to today/prospective

Per the checkpoint spec's own stated fallback ("If safe backdating is not fully supported, restrict SF-2D
UI actions to today/prospective dates"), the preview route rejects any `effectiveDate` earlier than the
server's own `todayISODate()` with a stable `private_financing_backdating_not_supported` code, rather than
building the full preview-the-downstream-replay-effect machinery a general backdating feature would
require. Historical corrections remain explicitly deferred.

### 5. API routes

**`/api/private-financing/accounts/[accountId]/adjustments/preview`** (`POST`) — genuinely non-mutating:
never calls `.rpc(...)` anywhere in the route. Resolves the account, replays current events through
`computeAdjustmentPreview`, and returns the preview envelope plus an `adjustmentPreviewToken`. Unknown
action type, invalid input, and backdated `effectiveDate` all return stable 400s with distinct codes;
missing/inaccessible account returns 404; missing schema returns 503.

**`/api/private-financing/accounts/[accountId]/adjustments/confirm`** (`POST`) — the one place in this
repository that appends an SF-2D ledger event. Decodes the token (malformed → 409), reloads fresh
events/components, recomputes the current ledger sequence, asserts token freshness (409 on any staleness),
recomputes the preview fresh (never trusts the token's cached preview), rejects if the fresh preview still
blocks (400), and only then calls the guarded RPC. RPC failures return either 503 (missing schema) or a
safe 500 that never surfaces raw Postgres detail.

### 6. UI: `PrivateFinancingSellerActions.jsx`

A single, data-driven component (`ACTION_CONFIGS`) implementing the inline reveal-form pattern for all
nine action types, matching the repository's established convention (no shared modal exists in this repo,
confirmed by SF-2's own read-only inspection) rather than introducing one. One action open at a time; a
Preview step (calls the preview endpoint only) before any acknowledgement UI renders; an explicit
acknowledgement checkbox; a stronger, typed "CONFIRM" requirement for `HIGH_IMPACT_ACTION_TYPES` (principal
concessions, bring-current credit, interest waiver, compensating correction, payment reversal, account
closure); a submitting/disabled state on Confirm (prevents double-submit); a success receipt naming the
newly posted event's id, type, and ledger sequence; safe error text with the form left intact for retry;
`data-guided-workflow-control="..."` attributes on every new control (borrowed vocabulary only, no step
machine implemented).

State-adjustment note: prefilling the reversal/correction form from a ledger-row click uses React's
documented "adjusting state when a prop changes" pattern (a render-time comparison against the previous
prop, not a `useEffect`) — `PrivateFinancingLedgerHistory.jsx`'s new "Reverse this payment" /"Correct this
adjustment" buttons construct a fresh object on every click, so reference inequality alone detects a new
request even for the same event clicked twice. This repo's `react-hooks/set-state-in-effect` lint rule
flags the more obvious `useEffect`-based version, which is why the render-time form was used instead.

**Wiring.** `PrivateFinancingAccountDetail.jsx` holds the `prefillReversalTarget` state and a
`historyRefreshSignal` counter; a successful post calls both the detail `load()` and bumps the refresh
signal, satisfying the spec's own requirement ("server reloads authoritative state... UI refetches account
detail and history") for both halves, not just one.

### 7. Tests

535 tests pass across the full Private Financing domain and API layer (32 files) after SF-2D, including
new files: `adjustmentActionRegistry.test.js` (9), `adjustmentPreviewToken.test.js` (11),
`appendEventRpcParams.test.js` (5), the preview route's test (12: non-mutating, token shape, bring-current
and payment-reversal computation, blocking-validation surfaced not thrown, unknown action type, invalid
input, backdating rejection, prospective-date acceptance, 404, 503, 401 propagation), the confirm route's
test (16: valid post + receipt, co-owner attribution via `effectiveOwnerId`, no `p_created_by` ever sent,
stale-ledger/changed-input/cross-account/malformed-token rejection, duplicate-submit rejection via a real
second-POST simulation, fresh-validation-failure rejection, duplicate-reversal rejection, 404/503/401,
internal-note trimming), `PrivateFinancingSellerActions.test.jsx` (15: every action type renders, one
action open at a time with no-mutation Cancel, Preview-only never posts on initial submit, before/after
balances render with a disabled Confirm until acknowledged, posting only after Confirm with `onPosted`
firing and a receipt naming the new event, high-impact CONFIRM-phrase gating, non-high-impact actions skip
that gate, warnings/blockers render with Confirm hidden when blocked, safe preview-failure and
confirm-failure error states, double-submit prevented via a disabled Confirm while in flight, prefill
opens and fills the correct form and re-triggers on a new target, borrower-visible vs. seller-only field
labeling, keyboard-reachable controls), and 8 new tests in `PrivateFinancingLedgerHistory.test.jsx`
(Reverse/Correct controls appear only where valid, already-reversed rows hide Reverse, no callback means no
button, `refreshSignal` triggers a refetch). `PrivateFinancingAccountDetail.test.jsx`'s SF-2C-era
"no premature write actions" test was renamed and updated to assert SF-2D's actions now exist while SF-2E's
still don't (external payment recording, payoff offers, policy changes, borrower invitations), rather than
silently becoming a stale, vacuously-passing check now that this screen genuinely has write actions.

Full regression: 831 files / 5713 tests pass; scoped lint clean on every new/changed file; `npm run build`
succeeds; `git diff --check` clean.

### 8. Disposable local Supabase validation

A local stack was started (`supabase init` → `supabase start --exclude <heavy services>`, migrations
applied fail-fast including the unmodified `20260830000200_create_private_financing_foundation.sql`), the
one-time local grant bootstrap applied, and a real identity matrix exercised directly against
`append_private_financing_event` and RLS via `SET ROLE authenticated; SET request.jwt.claim.sub = '<uuid>'`
— ten scenarios, all confirming expected behavior against real Postgres rather than mocks:

1. Primary owner posts a `principal_correction` — succeeds, correctly attributed.
2. Co-owner (an active `workspace_members` row under the owner) posts an `interest_correction` — succeeds,
   `created_by` is the co-owner's own uuid, never the owner's.
3. An unrelated authenticated user attempts the same call — denied (`has_workspace_access` false).
4. A claimed borrower (an active `private_financing_account_borrowers` row, no workspace membership)
   attempts the same call — denied identically to (3), confirming `has_workspace_access` checks workspace
   membership specifically and grants a borrower nothing here.
5. Owner posts a `payment_reversal` against a seeded `payment_posted` event — succeeds.
6. Owner attempts to reverse the same payment a second time — denied by the RPC's own guard ("Event has
   already been reversed and cannot be reversed again," `23505`), independent of and in addition to the JS
   `validateReversalReference` check the preview/confirm routes already run.
7. Owner attempts to post with `event_origin = 'stripe_webhook'` from the authenticated role — denied
   (the RPC only accepts `interactive_user`/`manual_import`/`manual_external` from `authenticated`).
8. Co-owner attempts to pass `p_created_by` as the owner's uuid while posting as `interactive_user` — the
   inserted row's `created_by` is the co-owner's own real uuid regardless, confirming the spoof attempt has
   no effect.
9. The unrelated user from (3) queries `private_financing_events` directly — zero rows returned, confirming
   the RLS `SELECT` boundary independently of the RPC's own `INSERT` boundary.
10. Owner queries the same table — sees the real, complete 4-event history, confirming (9) was a genuine
    RLS boundary and not a broken query.

One real drift was caught and fixed by this pass: a hand-written raw-SQL rehearsal of scenario 2 initially
omitted `p_correction_basis`, which the live `private_financing_events_check8` CASE constraint requires for
every `interest_correction` row. Inspection confirmed the actual JS code path
(`previewInterestAdjustment` → `appendEventRpcParams.js`) already sets `correctionBasis` correctly on every
`proposedEventPayload` it produces — the gap was in the manual validation script, not the shipped product
code — and the script was corrected before the scenario was re-run and passed. The local stack was reset
(`supabase db reset`) between the flawed and corrected runs for a clean, reproducible record, and fully torn
down afterward (`supabase stop --no-backup`, confirmed empty via `docker ps -a`). The migration was not
applied to any remote database.

### 9. Explicitly not in SF-2D

External/off-platform payment recording, payment-policy changes, discounted payoff offers, borrower
invitations, Stripe activation, and South Main import all remain out of scope, matching the checkpoint
spec exactly. `adjustmentActionRegistry.test.js` asserts the external-payment/policy-change and
payoff-offer/concession action-type names are NOT recognized by `isKnownAdjustmentActionType`, so this
boundary is enforced by a test, not only by omission.

## Product-generalization audit (owner-requested, before SF-2D UI was reviewed)

**South Main is the first validation account for FORGE Private Financing, not the product's schema or
default configuration.** FORGE Private Financing is built for every qualified lender/seller and borrower
this platform serves — South Main is a golden calculation fixture, the first real validation account, and
a later controlled import; it is never the platform default, a hard-coded loan structure, the only
supported allocation method, or the source of universal fee/interest/payment/late-charge rules. This
statement is recorded here prominently per explicit owner instruction, and the findings below are the
result of auditing SF-1 through SF-2D against it.

### 1. Audit method

A systematic, source-grep-based audit of every production (non-test, non-fixture) file under
`src/domains/private-financing/`, `src/app/api/private-financing/`, and
`src/components/forge/rental/PrivateFinancing*` for: hard-coded South Main dollar figures, dates, and
payment counts; hard-coded "3%"/"0%" labels; a hard-coded single-borrower, single-property, or family-
relationship assumption; a hard-coded ten-year-term assumption; globally-disabled late fees or seller-
absorbed fees; and confirmation that `late_fee_policy`, `fee_payer`, `payment_acceptance_policy`, and
`product` (financing type) are genuinely read per-account, never hard-coded. Two real defects were found
and corrected; several suspected issues were checked and confirmed to already be correctly generalized.

### 2. Corrected — late-fee calculation now fails closed instead of fabricating $0

`payoffQuote.js`'s `computePayoffQuote` previously set `lateChargesCents = 0` unconditionally for every
account, regardless of that account's own `late_fee_policy`. An account with late fees legitimately
*enabled* (a lawful, contract-authorized configuration this schema has always permitted, `late_fee_policy
in ('disabled', 'enabled')`) would have silently received a payoff quote claiming $0 in late charges —
exactly the "quietly wrong number that looks complete" failure mode the owner's instruction warns against.

Fixed: `computePayoffQuote` now requires an explicit `lateFeePolicy` argument and throws a new
`UnsupportedAccountPolicyError` (fail-closed, not a `LedgerIntegrityViolationError` — nothing is corrupt,
V1 simply has no late-charge calculation engine yet) for any value other than `"disabled"`.
`computeAccountPayoffEstimate` (`payoffEstimate.js`) catches that error and returns `null`, folding into
the same "no estimate available" contract every other caller already handles; the detail route
(`/api/private-financing/accounts/[accountId]/route.js`) now passes the account's real
`late_fee_policy` through; the UI (`PrivateFinancingAccountDetail.jsx`'s `PayoffPresentation`) explains the
null honestly — "this account's late-fee policy is enabled, and late-charge calculation is not yet
supported" — distinct from the ordinary "no history yet / already closed" message. Tests added in
`payoffQuote.test.js`, `payoffEstimate.test.js`, the detail route's test, and
`PrivateFinancingAccountDetail.test.jsx` cover both the disabled (honest $0) and enabled (fails closed,
never fabricates) cases.

### 3. Corrected — "Seller" was hard-coded in the SF-2D UI regardless of financing type

`PrivateFinancingSellerActions.jsx`, `PrivateFinancingLedgerHistory.jsx`, and
`PrivateFinancingAccountDetail.jsx` hard-coded the word "Seller" in several user-visible strings ("Seller
actions," "Reason (seller record)," "Seller credits/concessions to date," "Recorded live by seller,"
"Seller-only note") regardless of the account's own `product`. A `personal_loan` account (a real,
already-supported financing type in the schema) would have shown "Seller" throughout, which is simply the
wrong word for that product.

Fixed: a new `financingPartyLabel(product)` helper
(`src/domains/private-financing/financingPartyLabel.js`) resolves `"Seller"` for `seller_financing` and
`"Lender"` for `personal_loan` (falling back to `"Seller"` for an unrecognized value, since this is a
display lookup, never a validation gate). `PrivateFinancingSellerActions.jsx`'s field-label/description
config is now built as a function of this label (`buildActionConfigs(partyLabel)`) rather than a fixed
module-level constant; all three components now accept `product` and thread it down. Tests confirm a
`personal_loan` account renders "Lender" throughout and never renders the literal string "Seller."

### 4. Confirmed already correct — no further change needed

- **SF-2C's component presentation** (`ComponentDetails` in `PrivateFinancingAccountDetail.jsx`) already
  renders every component's label and rate dynamically (`COMPONENT_TYPE_LABELS[component.componentType]`,
  `bpsToPercent(component.rateBps)`) — no hard-coded "3% principal"/"0% principal" string exists anywhere
  in production code; a repo-wide grep for those literals returns nothing outside test assertions.
- **`late_fee_policy`, `fee_payer`, and `payment_acceptance_policy`** are genuine per-account database
  columns, read via `row.late_fee_policy` / `row.fee_payer` / `policyByAccountId.get(...)` in both API
  routes — never hard-coded constants. `paymentAcceptancePolicy.js` and its test file already cover all
  three policy values (`partial_allowed`, `full_amount_or_more`, `exact_amount_only`) with partial/exact/
  extra scenarios for each.
- **`product`** (financing type) is a genuine per-account enum already supporting both `seller_financing`
  and `personal_loan` in the schema's own `check (product in (...))` constraint; the detail/list UI already
  reads it dynamically via a `PRODUCT_LABELS` lookup, never assuming `seller_financing`.
- **`property_id` is correctly omitted** from `private_financing_accounts` entirely (a deliberate SF-1
  Checkpoint D decision, not an oversight — see that migration's own Revision 3 comment) — this means
  Personal Loans already "work without a property" trivially, and Seller Financing is not falsely tied to
  one either. No UI component renders an address or assumes a single-family-house shape.
- **Multiple borrowers already work.** `BorrowerMemberships` renders `borrowers.map(...)` generically with
  no cap; a new test (`PrivateFinancingAccountDetail.test.jsx`) proves three borrowers with three distinct
  roles (`primary_borrower`, `co_borrower`, `guarantor`) render correctly on one account.
- **No hard-coded loan-term/maturity assumption exists anywhere in code** — the concept of a fixed term or
  maturity date does not appear in the schema or domain layer at all (see the scope boundary below), so
  there is no "ten-year" constant to find or remove.
- **`previewBringCurrentCredit` and `previewStripeFeeReimbursement`'s component-selection default**
  (interest-bearing) is exactly that — a sensible default for a caller that doesn't specify one. The real
  SF-2D UI always lets the seller/lender select the applicable component explicitly (`ACTION_CONFIGS`'s
  `componentType` select field on both actions), satisfying "the seller must select the applicable
  component when an adjustment could affect more than one component" already. Only the *comment wording*
  implied these defaults were derived from South Main rather than being general design choices South
  Main's own facts happen to validate — reworded in `adjustmentPreview.js` for honesty about generality.

### 5. Reported, not "corrected" — real V1 architecture boundaries, disclosed rather than silently patched

Two structural facts were found that are genuine V1 scope boundaries inherited from SF-1 Checkpoints A/B/D
— not South Main leaks, and not something a "focused audit + necessary corrections" pass should redesign
without a dedicated checkpoint of its own. Both are now enforced by a test that would fail if a future
change silently regressed the disclosed boundary, and both are recorded here so they are a known, chosen
scope limit rather than an undocumented gap:

- **At most one interest-bearing and one zero-interest component per account — never three, never two of
  the same type.** `private_financing_components.component_type` accepts exactly two values by CHECK
  constraint, and `unique (owner_id, account_id, component_type, version_number)` makes a second component
  of the same type at the same version structurally impossible. `replayEvents.js` mirrors this exactly
  (`componentTerms[component.componentType] = component`, a two-key lookup, never a general list). A
  zero-interest component is correctly optional (one possible component, not required — proved by the new
  single-component tests in `replayEvents.test.js`), but "more than two components" is not something V1's
  contracts permit at all, so the requested test for that case is instead a boundary-enforcement test
  (`private-financing-component-cap.migration.test.js`) proving the cap is real and intentional, not an
  attempt to exercise a >2-component scenario that cannot occur.
- **No `allocation_policy`, `prepayment_policy`, `payment_frequency`, or `term`/`maturity` column exists
  anywhere in the schema.** V1 has exactly one allocation algorithm (`paymentAllocation.js`: interest on
  the interest-bearing component first, then that component's own regular principal, then the
  zero-interest component's regular principal, then any excess to interest-bearing principal), applied
  uniformly to every account with no per-account variability, and tracks no term, maturity date, or payment
  cadence at all — "next due date" and "past-due amount" are the same disclosed, honest "Not tracked yet"
  gap already recorded in the SF-2C correction above, for the same underlying reason. Prepayment already
  works correctly for every account regardless (interest stops accruing on prepaid principal immediately,
  by construction of the actual-day accrual math, not by a policy flag), so that specific item from the
  requested coverage list is already generically true. Adding real `allocation_policy`/`prepayment_policy`/
  `payment_frequency`/term-tracking columns would mean an additive migration and a materially different,
  more general allocation engine — correctly scoped as a future checkpoint of its own, not a change folded
  into this audit pass, and specifically **not** made to the already-merged
  `20260830000200_create_private_financing_foundation.sql` migration file (forward-only discipline: a
  merged migration is never edited after merge in this codebase).

### 6. New generic (non-South-Main) test coverage added

- `financingPartyLabel.test.js` — the new Seller/Lender resolver, including its safe fallback.
- `replayEvents.test.js` — a new "component generality" block: an interest-bearing-only account and a
  zero-interest-only account (a personal loan with no interest, as an example), both using numbers that
  share nothing with South Main, both replaying correctly, including a payment.
- `paymentAllocation.test.js` — a new "independent account terms" block re-running the regular-payment,
  wide-amount-range, remaining-principal-cap, and above-envelope scenarios against a `GENERIC_LOAN_SHAPE`
  fixture sharing no numbers with `SOUTH_MAIN_SHAPE`.
- `payoffEstimate.test.js` — a new test computing a correct estimate for a single-component account with a
  different rate, principal, and start date than South Main's own.
- `productGenericity.test.js` (new) — a structural test proving the five core calculation modules
  (`accountBalanceSummary.js`, `replayEvents.js`, `paymentAllocation.js`, `interestAccrual.js`,
  `payoffQuote.js`) never reference the identifier `product` at all (financing type is not one of their
  inputs), plus two tests proving no production module under `private-financing/` imports the South Main
  fixture or hard-codes its specific dollar figures.
- `private-financing-component-cap.migration.test.js` (new) — the component-cap boundary test described
  above.
- `PrivateFinancingAccountDetail.test.jsx` — a new multi-borrower rendering test (three borrowers, three
  roles) and a new `personal_loan` terminology test; the SF-2C-era "no premature write actions" test was
  already renamed for SF-2D and is unaffected by this pass.
- `PrivateFinancingSellerActions.test.jsx` / `PrivateFinancingLedgerHistory.test.jsx` — new `personal_loan`
  terminology tests confirming "Lender" renders and "Seller" never does.

### 7. Gate

535+ new/updated tests across the Private Financing domain and UI pass; full regression suite passes with
zero unrelated regressions; scoped lint clean on every changed/new file; migration/authorization tests
pass unchanged (no migration file was touched); production build succeeds; `git diff --check` clean. SF-2D
itself (built in the prior pass) is unaffected in behavior by this audit except for the three corrections
above, which are additive/corrective, not a redesign of anything already reviewed.

Not committed, pushed, merged, or deployed. No migration applied remotely. No South Main import. No
borrower invitation. No payment activation.

## V1 Terms Generalization — bounded checkpoint (owner-directed, after the product-generalization audit)

### 0. Why this checkpoint exists

The product-generalization audit above fixed two immediate leaks, but the owner's follow-up instruction
identified two remaining architecture boundaries that could not stay documentation-only: (1) at most one
interest-bearing plus one zero-interest component, and (2) one universal allocation algorithm with no
explicit payment-frequency, allocation-policy, or prepayment-policy terms. Left in place, those constraints
would make another customer's agreement behave according to South Main's own structure. This checkpoint
replaces both with a bounded, closed V1 support envelope — explicitly NOT an attempt to support every
possible loan — covering seller-financed real estate and personal loans, one-or-more fixed-rate components
(any may be zero-rate), simple actual/365 interest, irregular/partial/exact/extra payments, multiple
borrowers, and account-specific payment-acceptance/fee-payer/schedule/allocation/prepayment policy, while
explicitly deferring variable rates, compounding, negative amortization, escrow, interest-only periods,
graduated payments, legally calculated late fees, prepayment penalties, revolving credit, automatic balloon
refinancing, credit reporting, and document generation (unchanged from SF-1's own scope boundary).

### 1. Component generalization

`private_financing_components` no longer hard-codes exactly one `interest_bearing` and one `zero_interest`
row (the CHECK constraint and its two-value enum are gone). A component is now an ordered collection member
with a stable `component_key`, a `label`, `original_principal_cents`, `rate_bps` (zero is a fully valid
rate, not a special case), `day_count_convention` (closed to `actual_365`), `scheduled_component_amount_cents`,
`allocation_priority`, `effective_date`, and `version_number` — one or more per account, no maximum. The
domain layer never imports or references `interestBearing`/`zeroInterest`/`PRIVATE_FINANCING_COMPONENT_TYPE`
anywhere in production code (confirmed by a repo-wide grep sweep before the test-rewrite pass began, and by
`productGenericity.test.js`'s own structural check). `replayEvents.js` accrues interest, and
`paymentAllocation.js` allocates payments, generically across however many components an account actually
has — proved by dedicated fixtures for one fixed-interest component, one zero-interest-only component, and
three components at three different rates (`replayEvents.test.js`).

### 2. Explicit, versioned account terms

A new table, `private_financing_account_terms_versions`, holds insert-only, trigger-ordered (strictly
increasing `effective_date` per account, mirroring the components table's own established discipline)
versions of: `payment_frequency` (closed to `monthly` — the schema reserves room for future closed values,
but the engine only calculates what it has deterministic, tested date/arrears math for), `first_payment_due_date`,
`regular_scheduled_payment_amount_cents`, `maturity_date`, `allocation_policy`, `extra_payment_allocation_policy`,
`prepayment_policy`, `day_count_convention`, `effective_date`/`version_number`, `acting_seller_id`, and
`amendment_reason` (required once `version_number > 1`). `resolveAccountTermsAsOf` resolves the single
version in effect as of any date, exactly like `resolveComponentsAsOf` already does for components.

### 3. Closed allocation-policy design (two axes, not one hidden universal algorithm)

Rather than trying to force four named contractual behaviors onto one linear scale, this checkpoint splits
allocation into two independent, closed axes: `allocation_policy` governs the REQUIRED phase (closed to one
value, `scheduled_component_order` — accrued interest then each component's own scheduled amount, in
priority order) and `extra_payment_allocation_policy` governs what happens to any amount ABOVE the required
envelope (closed to three values — `highest_rate_first_extra`, `proportional_extra` via a new
largest-remainder `allocateCentsByRatio` helper in `currencyMath.js`, and `selected_component_extra`, which
requires the caller to name an eligible component explicitly and leaves the extra entirely unapplied
otherwise, rather than guessing). South Main's own real historical behavior — "excess reduces the
interest-bearing component" — is expressed as ordinary `highest_rate_first_extra` configuration, satisfying
the requirement that South Main be expressible through terms and policy, never a special code branch. All
four described behaviors map cleanly onto this two-axis model; an unrecognized value on either axis throws
`UnsupportedAllocationPolicyError` and fails the whole payment, never silently substituting a default —
proved at three layers: the `allocatePayment` unit level, the full `replayEvents` level (a new
`extraPaymentAllocationPolicy` describe block covering `proportional_extra` and `selected_component_extra`
end-to-end, plus an unsupported-policy-fails-closed replay test), and live against real Postgres (§8 below).

### 4. Prepayment policy

Closed to three values: `allowed_without_penalty_does_not_advance_due_date`, `allowed_without_penalty_advances_due_date`,
and `unsupported` (a real, storable value — V1 can declare an account has no computable prepayment
behavior yet, rather than being forced to guess). No penalty calculation exists in V1 for any value. The
due-state engine (§5) is the only place this policy has a computable effect, and extra principal never
silently satisfies a future scheduled installment unless the account's own policy says it advances the due
date.

### 5. Due-state engine (`dueState.js`, new)

A pure, deterministic function computing — for an account within V1's supported envelope only — scheduled
installments through an as-of date, the qualifying-payment shortfall split into current vs. past-due
amounts (the ordinary servicer convention), the next due date (computed differently depending on whether
the account's prepayment policy advances it), and the remaining scheduled obligation (always the real
replayed balance, never schedule-count arithmetic). Month-end due dates are handled explicitly and tested:
a first due date on the 31st clamps only when the target month is too short (Jan 31 → Feb 28) and returns
to the 31st the moment a long-enough month comes around again (→ Mar 31), never staying stuck at the
clamped value. Fails closed (`UnsupportedDueStateError`) for any non-monthly frequency, `prepaymentPolicy:
"unsupported"`, or a non-positive scheduled payment amount — the account-detail route only ever substitutes
a real `dueState` for the previously honest "Not tracked yet" placeholders when this engine can actually
compute one; every other account keeps the placeholder unchanged. 16 new tests in `dueState.test.js` cover
calendar clamping, the current/past-due split, partial payment, both prepayment-policy behaviors under an
identical "2.5 installments paid ahead" scenario (proving the SAME extra payment produces a materially
different next-due-date depending solely on the account's own configured policy), and all three fail-closed
paths.

### 6. Migration discipline

The original, already-merged `20260830000200_create_private_financing_foundation.sql` was never edited.
All changes are a new, additive, forward-only file,
`supabase/migrations/20260830000300_add_private_financing_v1_terms_generalization.sql`, which: ALTERs
`private_financing_components` (rename `component_type`→`component_key`, rename
`regular_payment_cents`→`scheduled_component_amount_cents`, add `label`/`day_count_convention`/
`allocation_priority`, drop the two-value CHECK, add a non-empty-string CHECK instead); creates
`private_financing_account_terms_versions` with its own ordering trigger and a `select`-only RLS policy
(intentionally no `authenticated`-role insert/update/delete — every write goes through
`open_private_financing_account` for version 1 or a **future, not-yet-built amendment RPC** for version 2+,
mirrored below); restructures `private_financing_events`' per-component monetary fields from two fixed
named columns into jsonb maps keyed by `component_key`, enforced by two independent layers (the JS
contracts layer AND a PL/pgSQL loop inside `append_private_financing_event` itself, since Postgres CHECK
constraints cannot contain subqueries) checking both "allocation sums exactly to the payment amount" and
"every referenced component actually exists on this account"; and DROP+CREATEs
`append_private_financing_event`, `open_private_financing_account`, and `read_private_financing_borrower_events`
for their new signatures (Postgres cannot `CREATE OR REPLACE` a function whose parameter list changes).
Because no Private Financing row of any kind exists in Production, every ALTER is written as a plain,
unconditional change rather than a data-preserving backfill — a deliberate, disclosed simplification, noted
in the migration's own header comment.

### 7. Generic fixtures and test coverage

South Main remains one golden fixture (`southMainGoldenReplay.test.js`, `replayEvents.test.js`'s South Main
reconciliation block) — both re-verified to still reproduce the owner-approved numbers solely through
ordinary configuration (`highest_rate_first_extra`, `scheduled_component_order`), never a special code path.
Independent, non-South-Main fixtures now cover: one fixed-interest-only component; one zero-interest-only
component; three components at three different rates; a personal loan with no property (structurally true
by construction — `private_financing_accounts` has no `property_id` column at all, confirmed by a static
migration test); multiple borrowers with distinct roles on one account; a monthly due date on the 31st
across short months; partial payment; an extra payment that does not advance the due date vs. one that
does, from an identical starting position; highest-rate-first, proportional, and selected-component extra
allocation, each exercised at both the unit and full-replay level; unsupported frequency, unsupported
extra-payment-allocation-policy, and unsupported prepayment-policy all failing closed, at both the JS layer
and live against real Postgres; and a structural proof that no production module imports South Main
constants (`productGenericity.test.js`, `southMainPayments.js` remains test/fixture-only). All 22
previously-shape-coupled test files were rewritten end to end (domain, API route, and UI layers); the
Private Financing test surface now totals **36 files / 607 tests**, all passing, up from 535 before this
checkpoint.

### 8. UI/read-model correction

`ComponentDetails` renders `components.map(...)` dynamically for however many components an account
actually has, each with its own rate/day-count/scheduled-amount/effective-version facts — never assuming
two fixed named slots. `PrivateFinancingSellerActions.jsx` builds every `componentId` select field's options
from the account's own real `components` prop (`componentOptions`), never a hard-coded pair, and no longer
defaults `INTEREST_CORRECTION`/`INTEREST_WAIVER` to `"interest_bearing"` — the seller/lender always selects
explicitly. `AccountSummary` now accepts a `dueState` prop: once the due-state engine returns a real value
for an in-envelope account, "Current amount due"/"Past-due amount"/"Next due date" show the real, calculated
figures; every other account keeps the honest "Not tracked yet" labels from the SF-2C correction, unchanged.

### 9. SF-2D status

SF-2D's own implementation was already given a complete, dedicated report in this document (see the
"SF-2D — Seller adjustment previews and confirmed postings" section above) before this checkpoint began.
This checkpoint's own changes to `adjustmentPreview.js`/`adjustmentActionRegistry.js` are limited to
threading the new generic `componentVersions`/`accountTermsVersions` parameters and generic per-component
maps through every one of SF-2D's nine preview functions — no adjustment kind's approved behavior, business
rule, or high-impact/strong-confirmation classification changed. SF-2D is now built on the generalized
engine and terms, per the instruction not to extend or approve its posting behavior until that was true.

### 10. Live Supabase validation — one real defect fixed, one intentional safety boundary applied on owner review

Both migrations were applied in sequence (the full, real 107-file migration chain, ending with the
original foundation migration followed immediately by this checkpoint's additive migration) to a fresh
disposable local Supabase instance (`supabase init` → `supabase start --exclude <heavy services>`, a local
grant-only bootstrap file — see note below — → real identity simulation via `SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '<uuid>'`), then fully torn down (`supabase stop --no-backup`, confirmed
empty via `docker ps -a`).

**Local-environment note, not a Production bug:** this disposable `supabase init` project's own default
table privileges (tables created by `postgres` inherit only `TRIGGER`/`REFERENCES`/`TRUNCATE` to
`authenticated`, not `SELECT`/`INSERT`/`UPDATE`/`DELETE`) do not match what Supabase's own hosted platform
provides by default. No migration in this repository grants table-level privileges explicitly (confirmed by
grepping every migration), and every other already-Production-validated FORGE domain works fine without
them — so a one-line `grant select, insert, update, delete on all tables in schema public to authenticated;`
was added ONLY to this disposable session's own local bootstrap file, never to any migration.

**Real defect #1 — found and fixed in the new migration.** `enforce_private_financing_component_version_ordering()`,
the BEFORE INSERT trigger enforcing "a new component version's effective_date must strictly postdate every
prior version," still referenced the just-renamed `component_type` column in its own PL/pgSQL body (a
`rename column` updates every dependent view/constraint automatically, but not the text of a function body,
which Postgres treats as opaque until executed). This made every real component-version insert fail with
`column "component_type" does not exist`, regardless of caller or authorization — a defect only live SQL
execution against real Postgres could catch; no static migration-text test exercises a real INSERT. Fixed
by adding a `create or replace function` for the corrected body (referencing `component_key`) directly in
the new migration, immediately after the column rename — no DROP needed, since the function takes no
arguments and the existing trigger already resolves it by name. Re-validated after the fix: a co-owner
successfully posted a real version-2 component amendment (rate reduced from 3% to 2.5%, `created_by`
correctly the co-owner's own uuid) against real Postgres.

**No authorized terms/component amendment path — an OWNER-DIRECTED, INTENTIONAL V1 SAFETY PROTECTION, not a
defect or an unfinished feature.** `private_financing_account_terms_versions` has no `authenticated`-role
INSERT policy at all. Live validation also surfaced that `private_financing_components` DID still carry its
original `owner_insert` policy (inherited unchanged from the foundation migration), which meant a co-owner
could directly amend a component's own rate/principal/scheduled amount through ordinary workspace
authorization alone — successfully exercised once, live, before the owner reviewed this finding. On review,
the owner determined that changing signed loan terms — whether at the account level or a single component's
own rate/principal — is not an ordinary seller adjustment: it may require borrower consent, a signed
amendment, updated disclosures, a recalculated schedule, and jurisdiction-specific legal review, none of
which primary-owner/co-owner workspace authorization alone can satisfy. Per that explicit direction, the
migration was revised to `drop policy if exists "private_financing_components_owner_insert"`, closing the
component path to match the terms path exactly. **In V1, no seller, co-owner, borrower, browser route, or
ordinary authenticated RPC can append a term or component amendment of any kind — only
`open_private_financing_account` (version 1, at account opening, `SECURITY DEFINER`) may ever write either
table.** The versioning columns and ordering triggers remain in the schema as future-compatible structure
for a properly designed Terms Amendments phase (amendment document/reference, borrower/co-borrower consent,
acting lender, disclosure requirements, schedule recalculation, treatment of existing payments, whether an
amendment is legally permitted, and immutable acceptance evidence — none of which V1 attempts or implies).
Re-validated live, after the policy was dropped: with real identities for both the primary owner and the
same active co-owner who had previously succeeded, all four amendment attempts (owner and co-owner, against
both components and terms) were denied with a clean "new row violates row-level security policy" error, and
a superuser-vantage-point count confirmed exactly one version of each row ever existed afterward — none of
the four denied attempts left any row.

**Minor, non-blocking observation (informational, not actionable in V1).** Neither version-ordering trigger
function (components or account terms) is `SECURITY DEFINER`, so its own internal
`SELECT ... max(effective_date)` runs under the INSERTing caller's own RLS visibility. This was visible
earlier in validation (before the policy was dropped) as a misleading date-ordering error surfacing instead
of a clean permission-denied message for a caller who couldn't see the prior version being compared against
— never a security gap (the row was never written either way) but worth designing around explicitly (e.g. a
`SECURITY DEFINER` ordering check, or validating ordering inside the eventual RPC itself instead of a bare
table trigger) whenever the future Terms Amendments phase adds a real, properly-gated write path.

**Scenarios validated, all against real Postgres, not mocks, across two full validation passes (before and
after the component `owner_insert` policy was dropped):** foundation migration followed by the additive
terms migration applying cleanly in the real, full sequence, both times; a personal-loan account opened
with three components at three different rates and `proportional_extra`, proving no maximum component
count; a South-Main-shaped account opened and its first real payment posted through
`append_private_financing_event` with the exact accrued-interest figure ($114.66 over 31 days at 3%),
matching the JS engine's own independent computation exactly; terms versioning (version 1 → version 2 with
a required amendment reason, and a rejected backdated version 3, validated at the schema/trigger level since
no application write path to this table exists at all); zero UPDATE/DELETE policies on either table,
confirming immutable prior terms and prior components alike; **primary-owner and co-owner amendment attempts
against BOTH components and terms now uniformly denied**, matching the owner's explicit V1 safety decision
(superseding the earlier finding that a co-owner could amend a component directly, which prompted the
policy drop); borrower and unrelated-user denial on the same amendment attempts; and four distinct
unsupported-terms scenarios (`biweekly` frequency, an unrecognized extra-payment-allocation-policy, zero
components, and `late_fee_policy: 'enabled'`) all rejected at the RPC boundary with clear errors, alongside
confirming `prepaymentPolicy: 'unsupported'` itself is correctly ACCEPTED and stored as a legitimate
closed-set value. Due-state calculation has no database-level surface (it is a pure function over
already-fetched rows) and was instead validated by `dueState.test.js`'s own 16 tests, referenced above.

### 11. V1 supported-term matrix

| Supported now | Deferred (explicitly, not silently) |
|---|---|
| Seller-financed real estate and personal loans, no required property relationship | Variable/adjustable rates |
| One or more fixed-rate components per account, any may be zero-rate | Compounding interest |
| Simple interest, actual/365 day-count (the only closed value) | Negative amortization |
| Irregular partial, exact, and extra payments | Escrow |
| Multiple borrowers, distinct roles | Interest-only periods |
| Account-specific payment-acceptance and fee-payer policy | Graduated payments |
| Account-specific payment schedule (monthly only, closed) | Legally calculated late fees |
| Account-specific allocation (`scheduled_component_order`, the only closed required-phase value) | Prepayment penalties |
| Account-specific extra-payment allocation (`highest_rate_first_extra` / `proportional_extra` / `selected_component_extra`) | Revolving credit |
| Account-specific prepayment policy, including a storable `unsupported` value | Automatic balloon refinancing |
| Seller credits, corrections, concessions, reversals, and payoff | Credit reporting |
| Unsupported terms failing closed, at both the JS and live-Postgres layer | Document generation |
| Due-state calculation (current/past-due/next-due-date) for in-envelope accounts | Terms/component AMENDMENT write path — an OWNER-DIRECTED V1 SAFETY BOUNDARY, not merely unbuilt: no seller, co-owner, borrower, browser route, or ordinary authenticated RPC may append a version-2+ term or component row (see §10); versioning schema/triggers remain as future-compatible structure only |
| | Weekly/biweekly/semimonthly/custom payment frequency (schema reserves the enum space; no calculation engine yet) |

### 12. Gate

Full private-financing surface: 36 files / 607 tests passing (up from 535). Full repository regression:
835 files / 5785 tests passing, zero unrelated regressions. Scoped lint clean on every new/changed
private-financing file. `npm run build` succeeds. `git diff --check` clean. Both migrations validated
together against real Postgres per §10, including one real defect found and fixed in the new migration.

Not committed, pushed, merged, or deployed. No migration applied remotely. No South Main import. No
borrower invitation. No Stripe activation. SF-2D/SF-2E were not extended further. AGENTS.md/CLAUDE.md
remain untracked and untouched throughout.

## SF-2D — V1 amendment-boundary correction and generalized-engine compatibility audit (owner review of the above)

On review of the checkpoint above, the owner made one explicit safety decision and requested one
compatibility audit before SF-2D could resume:

**Owner safety decision — no generic terms-amendment RPC in V1, and the component amendment path (found
open during live validation above) is closed to match.** See §10's rewritten text above for the full
rationale and the live-Postgres re-validation proving both tables now uniformly deny every amendment
attempt, from every non-`SECURITY DEFINER` caller, in V1.

**Compatibility audit finding and fix — `previewBringCurrentCredit` was not yet using the authoritative
due-state engine.** Auditing SF-2D's own implementation against the generalized engine surfaced one real
gap: `scheduledAmountThroughAsOfDateCents`, `nextDueDate`, and `nextDueAmountCents` were still plain
seller-typed form fields (`PrivateFinancingSellerActions.jsx`'s `BRING_CURRENT_CREDIT` field config),
never derived from `computeDueState` (`dueState.js`), even though that engine now exists and is
authoritative for exactly this figure. Fixed: `previewBringCurrentCredit` now calls `computeDueState`
itself (using the same replayed snapshot and resolved terms it already had) and derives the shortage,
next-due-date, and next-due-amount from its real output; the three now-computed fields were removed from
the seller-facing form entirely (the seller only ever picks the component and the credit amount); the
preview panel now renders the authoritative scheduled-amount/shortage/next-due-date figures so the seller
reviews real numbers before confirming, never a number they typed themselves. For an account outside
V1's due-state envelope (non-monthly frequency, or `prepaymentPolicy: "unsupported"`), this action now
fails closed via `blockingValidation` (never a guessed or partially-computed credit), proven at both the
domain level and end-to-end through the preview API route. `dueState.js` was extended with two additional
output fields (`scheduledThroughAsOfDateCents`, `alreadyPostedCents`) so this consuming code has a single
authoritative source for both, rather than re-deriving them a second, potentially divergent way. Every
other SF-2D compatibility criterion (dynamic N-component arrays, Lender/Seller terminology, configured
allocation/extra-payment policy, unsupported-policy fail-closed, no South Main constants, no universal
$0 late-fee claim, no terms-edit controls) was already correct from the V1 Terms Generalization checkpoint
itself and required no further change.

**New/extended test coverage:** a three-component adjustment; selected-component identity validated
against the account (an unknown key rejected); a cross-account component key rejected identically (proving
no leak even when a caller submits another account's own real component identifier); bring-current credit
proven to derive its shortage from an account's own uncommon schedule numbers, never South Main's; a
stale-ledger-state test proving a payment posted between preview and confirm changes the freshly
recomputed shortage (the confirm route's existing "always recompute fresh, never trust the cached preview"
design already covers this generically); a structural proof that every SF-2D `proposedEventPayload` is one
of the seven closed ledger event types, never a components/terms table write; a purity test proving the
account's own component/terms version arrays are never mutated by computing (or posting) any adjustment;
and a migration-level test suite (`private-financing-v1-amendment-lockdown.migration.test.js`) proving the
new migration actively drops the components table's own original INSERT policy and that neither table ever
re-grants one. Full private-financing surface: **37 files / 622 tests** passing (up from 36/607). Full
repository regression: **836 files / 5800 tests** passing, zero unrelated regressions. Lint clean. Build
succeeds. `git diff --check` clean. Both migrations re-validated live against real Postgres with the policy
drop in place, per §10's rewritten text above.

Not committed, pushed, merged, or deployed. No migration applied remotely. No South Main import. No
borrower invitation. No live payment activation. SF-2E was not begun. AGENTS.md/CLAUDE.md remain untracked
and untouched throughout. See the standalone SF-2D report delivered in chat for the full 17-point summary
of SF-2D's complete current implementation.
