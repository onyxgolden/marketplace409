# RV-E2C — reservation test payment confirmation and application

Status: implementation branch only. Do not apply the migration, deploy, or merge without separate authorization.

## Boundary

RV-E2C lets a holder of the private reservation access link confirm the RV-E2B booking-balance PaymentIntent in Stripe test mode. The existing authenticated Stripe webhook verifies the raw signature, confirms server mode and connected-account ownership, and routes reservation PaymentIntent events to a reservation-native service-role RPC.

The RPC locks the canonical owner/payment attempt, requires the stored PaymentIntent reference, validates succeeded amount and currency exactly, appends one immutable provider event, and applies the booking balance once. Replayed provider event IDs are idempotent. Delayed processing or failure after a terminal state is recorded as ignored evidence and cannot regress the payment.

A succeeded payment becomes payment_status=succeeded, applied_amount_cents=the exact booking balance, and settlement_status=pending. It does not become available or paid out.

## Authorization

| Surface | anon | authenticated | service_role |
|---|---:|---:|---:|
| financial raw writes | none | none | none |
| application RPC | none | none | execute |
| private guest payment UI | slug + private token | slug + private token | server-mediated |
| Stripe webhook | valid signature + known account | valid signature + known account | server-mediated |

Canonical authorization is always owner_id + reservation_id. Guest identity is audit context only.

## Explicit exclusions

- Live-mode reservation payments
- Security-deposit authorization, collection, capture, release, or damage application
- Refund, reversal, and dispute mutation (RV-E2D)
- Settlement availability, fees, payout, and reconciliation (RV-E2D)
- Lease-domain records
- Trading work
- Production migration, deployment, or merge

## Verification

~~~bash
SUPABASE_DB_CONTAINER=supabase_db_marketplace409-reservation-validation \
npx vitest run \
  supabase/migrations/__tests__/20260913060000_add_reservation_payment_application.migration.test.js \
  src/infrastructure/billing/normalizeStripeConnectEvent.test.js \
  src/app/api/rental/stripe-webhook/route.test.js \
  src/domains/reservations/reservationRpcs.integration.test.js \
  src/components/reservations/ReservationTestPayment.test.jsx \
  src/components/reservations/GuestReservationAccess.test.jsx

npx eslint \
  src/infrastructure/billing/normalizeStripeConnectEvent.js \
  src/infrastructure/billing/normalizeStripeConnectEvent.test.js \
  src/app/api/rental/stripe-webhook/route.js \
  src/app/api/rental/stripe-webhook/route.test.js \
  src/components/reservations/ReservationTestPayment.jsx \
  src/components/reservations/ReservationTestPayment.test.jsx \
  src/components/reservations/GuestReservationAccess.jsx \
  supabase/migrations/__tests__/20260913060000_add_reservation_payment_application.migration.test.js

npx tsc --noEmit
git diff --check origin/main...HEAD
~~~

Automated proof uses signed fixtures and real local database roles. One controlled Stripe test-mode payment is a separate final proof step after review; never use live keys or a real card.
