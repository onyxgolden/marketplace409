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
