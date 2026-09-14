# RV-E2A reservation financial-contract foundation

Status: implemented on `feat/rv-reservation-financial-contract`; not merged, deployed, or applied to production.

## Scope

RV-E2A adds a reservation-native financial contract without moving money. It does not reuse or create rental tenants, leases, rent schedules, rent charges, rental payments, or lease security-deposit rows.

## Schema and symbols

Migration: `supabase/migrations/20260913040000_add_reservation_financial_contract.sql`

| Symbol | Purpose |
|---|---|
| `reservation_financial_contracts` | Immutable cent-exact quote snapshot, including a booking balance that excludes the refundable deposit |
| `reservation_payment_attempts` | Provider-neutral future attempt/status projection; no rows are created by RV-E2A |
| `reservation_payment_events` | Immutable future provider/audit events; no rows are created by RV-E2A |
| `reservation_financial_summary` | Honest owner read model separating due, applied, refunded, disputed, settlement, and payout state |
| `initialize_reservation_financial_contract()` | Idempotently snapshots each reservation after insert |
| `prevent_reservation_financial_snapshot_rewrite()` | Rejects silent rewrites of established quote components |
| `enforce_reservation_payment_state_transition()` | Rejects status regression, identity changes, and decreasing cumulative amounts |
| `prevent_reservation_payment_event_mutation()` | Makes financial events append-only |
| `get_public_reservation_financial_summary(text,text)` | Returns only the reservation-bound guest financial read model through the existing private credential |

Existing reservations receive one snapshot row through an idempotent `insert ... on conflict do nothing`. Existing `reservations` rows are not updated.

## Grant and RLS matrix

| Object | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `reservation_financial_contracts` | none | none | SELECT through `has_workspace_access(owner_id)` | no raw grant |
| `reservation_payment_attempts` | none | none | SELECT through `has_workspace_access(owner_id)` | no raw grant |
| `reservation_payment_events` | none | none | SELECT through `has_workspace_access(owner_id)` | no raw grant |
| `reservation_financial_summary` | none | none | SELECT; security-invoker view preserves base-table RLS | no raw grant |
| `get_public_reservation_financial_summary` | none | none | none | EXECUTE |

Guests never receive raw table access. The server role can invoke only the shaped RPC after proving the existing booking slug plus private reservation access token.

## Honest state contract

- Booking balance = lodging + cleaning + lodging tax.
- Refundable security deposit is separate and never silently included in the booking-payment projection.
- Payment status is distinct from settlement status.
- Settlement availability is distinct from payout.
- RV-E2A initializes no payment attempt and the UI continues to state that no payment was collected.
- A succeeded payment cannot regress to pending or processing.

## Proof locations

- Static contract test: `supabase/migrations/__tests__/20260913040000_add_reservation_financial_contract.migration.test.js`
- Real Postgres/RLS integration: `src/domains/reservations/reservationRpcs.integration.test.js`
- Guest route shaping: `src/app/api/book/[slug]/access/route.test.js`
- Guest display: `src/components/reservations/GuestReservationAccess.test.jsx`
- Owner display: `src/components/forge/rental/ReservationsPanel.test.jsx`

The real integration suite applies the migration twice, confirms a reservation through the authenticated RPC, verifies exact component reconciliation and one-row idempotency, and confirms a real unrelated authenticated role sees no financial contract.

## Required pre-merge commands

```bash
SUPABASE_DB_CONTAINER=supabase_db_marketplace409-reservation-validation \
npx vitest run \
  supabase/migrations/__tests__/20260913040000_add_reservation_financial_contract.migration.test.js \
  src/domains/reservations/reservationRpcs.integration.test.js \
  src/app/api/book/'[slug]'/access/route.test.js \
  src/components/reservations/GuestReservationAccess.test.jsx \
  src/components/forge/rental/ReservationsPanel.test.jsx

npx eslint \
  src/app/api/book/'[slug]'/access/route.js \
  src/app/api/book/'[slug]'/access/route.test.js \
  src/app/api/rental/reservations/route.js \
  src/components/reservations/GuestReservationAccess.jsx \
  src/components/reservations/GuestReservationAccess.test.jsx \
  src/components/forge/rental/ReservationsPanel.jsx \
  src/components/forge/rental/ReservationsPanel.test.jsx \
  src/domains/reservations/reservationRpcs.integration.test.js \
  supabase/migrations/__tests__/20260913040000_add_reservation_financial_contract.migration.test.js

npx tsc --noEmit
npx vitest run
git diff --check origin/main...HEAD
```

## Explicit exclusions

### RV-E2B

No Stripe API call, PaymentIntent, Checkout Session, payment-session route, webhook branch, provider mutation, or money movement is included.

### RV-E2C

No deposit authorization, capture, collection, release, damage application, refund, or dispute workflow is included.

### RV-E2D

No reservation settlement table, availability polling, payout initiation, payout reconciliation, or production observation is included.

No Trading file or phase is changed.
