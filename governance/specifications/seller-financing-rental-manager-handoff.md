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
