# RV-E2B — reservation payment initiation

Status: implementation branch only. Do not apply the migration, deploy, or merge without separate authorization.

## Boundary

RV-E2B initiates or resumes one Stripe **test-mode** PaymentIntent for the reservation booking-balance obligation. The amount, currency, owner, reservation, guest, and connected account are resolved server-side from the private booking slug/access-token pair and the immutable RV-E2A financial contract.

The request body cannot choose an owner, reservation, amount, currency, payment purpose, connected account, provider mode, or Stripe metadata.

## Idempotency and failure behavior

The "begin_public_reservation_payment_attempt" RPC takes an advisory transaction lock for the canonical owner/reservation booking-balance obligation. It returns an existing created, pending, or processing attempt before creating another. The attempt's stored idempotency key is passed unchanged to Stripe.

If Stripe creation fails before a provider reference is bound, only that canonical owner's created attempt transitions to failed. If Stripe succeeds but the database response is interrupted, a retry resolves the same attempt and Stripe idempotency key. Once the provider reference is stored, later retries retrieve that PaymentIntent instead of creating another.

Provider identity may transition exactly once from null/created to non-null/pending. All RV-E2A terminal-state monotonicity and cumulative-amount guards remain in force.

## Authorization matrix

| Surface | anon | authenticated | service_role |
|---|---:|---:|---:|
| Financial tables (raw writes) | none | none | none |
| begin RPC | none | none | execute |
| record RPC | none | none | execute |
| fail RPC | none | none | execute |
| POST /api/book/[slug]/payment-session | private slug + token | private slug + token | server only |

All financial mutations bind to both canonical owner_id and reservation_id. Guest identity remains an audit attribute and never replaces workspace ownership.

## Explicit exclusions

- No live-mode PaymentIntent
- No security-deposit authorization, collection, capture, release, or damage application
- No PaymentIntent confirmation and no real or test charge
- No webhook mutation branch
- No applied-payment or ledger mutation
- No refund, reversal, or dispute processing
- No settlement, availability, payout, or reconciliation
- No lease, tenant, rent schedule, rent charge, rental payment, or lease-deposit records
- No Trading changes
- No production migration, deployment, or merge

The existing guest UI continues to state that payment collection is not enabled. RV-E2B exposes the server initiation boundary for controlled test proof; it does not present a guest-facing payment control.

## Verification

Run from a clean worktree on this branch:

~~~bash
SUPABASE_DB_CONTAINER=supabase_db_marketplace409-reservation-validation \
npx vitest run \
  supabase/migrations/__tests__/20260913040000_add_reservation_financial_contract.migration.test.js \
  supabase/migrations/__tests__/20260913050000_add_reservation_payment_initiation.migration.test.js \
  src/infrastructure/billing/StripeBillingProvider.test.js \
  src/app/api/book/'[slug]'/payment-session/route.test.js \
  src/app/api/book/'[slug]'/access/route.test.js \
  src/domains/reservations/reservationRpcs.integration.test.js

npx eslint \
  src/infrastructure/billing/StripeBillingProvider.js \
  src/infrastructure/billing/StripeBillingProvider.test.js \
  src/app/api/book/'[slug]'/payment-session/route.js \
  src/app/api/book/'[slug]'/payment-session/route.test.js \
  supabase/migrations/__tests__/20260913050000_add_reservation_payment_initiation.migration.test.js

npx tsc --noEmit
git diff --check origin/main...HEAD
~~~

A Stripe test API call is not required for this proof: provider tests assert the exact SDK call contract with a fake Stripe client. No charge is created.
