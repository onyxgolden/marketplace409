# FORGE Production Tester Missions

**Prepared:** 2026-09-10
**Source:** `FORGE_PRODUCTION_USER_FEEDBACK_AND_ACTIVATION_PLAN.md`, Phase 1. Missions below are scoped
against what the Phase 0 current-state audit confirmed is actually implemented and testable today, not
against aspirational functionality. (That audit doc is tracked outside this branch, in Jason's own
working checkout — ask him for it directly if you need the full domain-by-domain matrix; this doc only
restates what's directly relevant to each mission.)

Each mission is a numbered, observable pass/fail sequence. A tester should be able to say, for every
step, whether it succeeded, failed, or confused them -- not just "it mostly worked." Record every step
using the feedback contract in `scripts/production-feedback/feedbackContracts.mjs` (`workflowId` =
this mission's id below, `stepId` = the step number).

## Landlord — `mission-landlord`

Status: fully testable today (Rental Manager and tenant/charge/report surfaces are production-verified
per the Phase 0 audit).

1. Add or import a property and unit.
2. Add a tenant.
3. Confirm the UI switches to or clearly reveals the new tenant.
4. Inspect contact, household, lease, notes, charges, and running balance.
5. Create or inspect a charge/payment.
6. Find the resulting financial record and report.

## Co-owner — `mission-co-owner`

Status: testable today; workspace membership is implemented, but this exact "same workspace, no
duplication" scenario was not independently load-tested in the Phase 0 audit — treat this mission as
the first real evidence for it, not a formality.

1. Sign in through the existing co-owner account.
2. Access the same canonical owner workspace as the primary landlord.
3. Read and update authorized rental and financial records.
4. Confirm audit evidence identifies the acting co-owner separately from the canonical owner.
5. Confirm no duplicate owner/property/tenant data is created.

## Tenant — `mission-tenant`

Status: fully testable today (tenant portal + Stripe rent payments are production-verified at the test
level per the Phase 0 audit, including live RLS/immutability triggers). No real payment should be run
outside an explicitly authorized, controlled runbook (Phase 2).

1. Accept or reclaim portal access.
2. Inspect lease, charges, running balance, and payment options.
3. Make a controlled Stripe test-mode payment.
4. Verify confirmation, receipt, ledger effect, and updated balance.
5. Confirm unauthorized landlord/other-tenant data is inaccessible.

## Private-financing borrower — `mission-borrower`

Status: **testable today.** The Phase 0 audit's Finding A reported this mission as blocked by an
unmerged invitation-onboarding fix. That finding was **stale**: independent verification during Phase 1
implementation confirmed PR #88 (`fix(private-financing): carry the invited email through borrower
onboarding`, merged 2026-09-02) already shipped a complete, tested fix to `origin/main` — a fresh
implementation superseding both branches the audit found, not a merge of either. Of the six required onboarding scenarios, five are covered by existing automated tests: claim-link
preservation, invited-email handling, sign-in/sign-up return behavior, invalid/already-used-link
handling (this system has no time-based invitation expiry — a `private_financing_borrowers` row and
membership status, not a short-lived token — so "never invited / wrong email" and "already claimed"
are the two states that actually exist, and both are tested), and unauthorized-access denial. The sixth,
**mobile behavior, is not yet verified by any automated evidence** — the layout is a simple single-column
responsive form consistent with the rest of this codebase, but no screenshot/device check has been run
against it. Recommend this specific mission's step 1-2 include a mobile-viewport check as first-class
evidence. See `docs/product/private-financing-borrower-onboarding-verification.md` for the full verification record.

A private-financing borrower is a distinct role from a rental tenant — do not conflate them when
recruiting or recording feedback; lot-rent (rental) and loan (private-financing) ledgers are separate
systems and must stay reported separately even when the same person holds both relationships.

1. Open and claim a valid invitation.
2. Confirm the invited email is preserved and pre-filled/locked through sign-in and sign-up.
3. Inspect amount owed, remaining principal, interest/principal history, credits, and payoff
   information.
4. Make a controlled Stripe test-mode payment.
5. Verify provider result, event, ledger, read model, and owner/borrower views agree.
6. Sign in with a different email than the invitation and confirm the mismatch is explained clearly
   rather than showing a bare "no accounts" message.

## RV/short-term landlord — `mission-rv-short-term`

Status: testable today, but **scope this precisely**. "RV/short-term landlord" in this mission means
the already-shipped short-term/transient reservation system (`src/domains/reservations/`), covering
`rv_site`, `cabin`, `glamping_site`, `tent_site`, and `parking_space` unit types with rates, deposits,
and tax. It does **not** mean FORGE's separate, deferred "Park Rentals" concept (long-term RV/mobile-home
lot leasing) — that remains architecture-aware but implementation-deferred per the 2026-08-29 owner
decision in `governance/specifications/park-rentals-and-private-financing-crossover-handoff.md`. Do not
recruit a tester or write copy implying long-term lot leasing is available.

1. Bulk-import RV spots and cabins via CSV.
2. Review the proposed changes before confirmation.
3. Confirm units, unit types, rate plans, seasons, inventory, and calendar blocks.
4. Create, modify, cancel, and inspect a reservation using test data.
5. Confirm availability and financial totals remain consistent.

## Notes for whoever runs these missions

- Prefer picture/document uploads as evidence (`evidenceRefs` on the feedback contract) with manual
  entry as fallback.
- A mission step marked `abandoned` still counts as evidence — do not discard it.
- Do not use real payment instruments for any Stripe step; use test mode only, per the plan's Phase 2
  gate.
- If a mission step surfaces a defect matching an already-known item from the Phase 0 audit or a prior
  feedback entry, link it via `relatedFeedbackId` rather than filing a fresh duplicate.
