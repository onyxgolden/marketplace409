# FORGE Rental Manager first-tenant runbook

## Release boundary

This release is a controlled pilot, not general availability. Code import, database migration, provider configuration, and tenant activation are separate approvals. Never place service-role, Stripe, webhook, scheduler, or email-provider secrets in the browser or repository.

## 1. Preserve and verify

1. Confirm a clean `main` working tree and record the current production commit.
2. Create and verify a restorable Supabase backup before applying migrations.
3. Import the cumulative Git bundle into a review branch, inspect `origin/main..review`, and run `npm ci`.
4. Run `npm run rental:preflight:schema`, the rental-focused tests, the complete test suite, and `npm run build` with production-equivalent non-secret configuration.
5. Resolve every new regression. The known local governance-evidence failures are not rental failures, but must not be silently treated as production approval.

## 2. Apply without activating providers

1. Apply migrations in filename order. The preflight verifies the 20-file chain from `20260812001800` through `20260813003700`.
2. Deploy application code with email settings absent or paused and autopay enrollments inactive. A deployment alone must not debit or email anyone.
3. Confirm owner isolation, tenant portal identity, charge totals, existing payment history, document visibility, and open maintenance data using non-destructive reads.
4. Verify Stripe Connect account ownership, webhook signature validation, idempotency behavior, and the settlement reconciliation view in test mode.

## 3. Pilot acceptance

Complete these checks with a test lease before inviting the first tenant:

- tenant claim and landlord/tenant authorization separation;
- lease dates, recurring charge schedule, late-fee rule, deposit liability, and opening balance;
- successful and failed one-time payment, duplicate webhook, refund, dispute, and settlement reconciliation;
- maintenance intake/update, document publication/acknowledgement, inspection acknowledgement, insurance proof, animal request, and support case;
- autopay consent, Stripe mandate capture, one test-mode debit, cancellation, bounded failure pause, and no duplicate charge;
- email sender-domain approval, optional-reminder opt-out, transactional notice delivery, bounce/complaint evidence, retry exhaustion, and no duplicate send;
- accountant export and contractor review package totals against source transactions.

Record the tester, timestamp, evidence, and result for every check. Do not use a real tenant as the test fixture.

## 4. First tenant activation

1. Reconcile the tenant, property, unit, lease, balances, deposit, and documents with the current property manager.
2. Obtain the tenant's verified portal identity and explicit autopay consent separately; autopay is optional.
3. Activate only the approved landlord email setting and one pilot lease. Keep bulk automation unavailable.
4. Make a low-risk test-mode validation first, then schedule the first real charge only after the owner verifies amount, date, destination account, and fee disclosure.
5. Monitor the payment, webhook, ledger posting, receipt, settlement, and bank reconciliation as one chain.

## 5. Stop and recovery rules

Pause email settings, cancel queued optional notices, and pause autopay enrollments immediately on identity mismatch, duplicate activity, incorrect amount, missing webhook evidence, reconciliation variance, provider complaint, or suspected secret exposure. Rotate exposed secrets and preserve logs before remediation.

After migrations contain production data, do not attempt an improvised down-migration. Roll application code forward or back only to a schema-compatible commit; disable provider activity through settings/enrollment states; restore the database only through the approved backup procedure. Refunds and payment disputes must use the recorded Stripe workflow rather than direct database edits.

## Go/no-go ownership

The owner approves tenant and financial data, provider destinations, and pilot activation. Engineering verifies code, schema, security boundaries, and observability. Stripe/email-provider approval, legal disclosures, insurance requirements, tax treatment, and property-management obligations require their appropriate professional or provider review. A green technical preflight does not replace those approvals.
