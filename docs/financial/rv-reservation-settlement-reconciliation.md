# RV-E2D — reservation finance evidence and reconciliation

Implementation for review on `work/rv-e2d`, based on PR #182 merge
`9d6f0650c6910965adc84e21da244b1e88e5f748`. The migration has **not** been applied.
No Stripe object, payment, refund, webhook delivery, deployment, or production data was changed.

## Boundary and delivery

Migration: `supabase/migrations/20260914010000_add_reservation_finance_reconciliation.sql`.

The dedicated `POST /api/rental/reservation-finance-webhook` endpoint verifies the raw
Stripe signature using `STRIPE_RESERVATION_FINANCE_WEBHOOK_SECRET`. This is a new,
separately configured **test-mode** subscription, not an automatic extension of the
existing rental webhook subscription. RV-E2C's existing PaymentIntent webhook and
`process_stripe_reservation_payment_event` remain the sole booking-payment application
boundary. Do not subscribe PaymentIntent events to the finance endpoint.

Supported notifications:

- `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`
- `charge.succeeded`, `charge.updated`, `balance.available`
- `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`

Notifications trigger read-only, connected-account-scoped Stripe retrievals. The
adapter validates the stored PaymentIntent, latest charge, amount, currency, test
mode, refund/dispute relationships, balance transaction source, gross/fee/net
arithmetic, and automatic payout membership. Metadata cannot authorize an event.

## Persistence and exact-once behavior

| Symbol | Contract |
| --- | --- |
| `reservation_finance_receipts` | Immutable event ID, signed-payload SHA-256, safe provider identity, and accepted/unknown outcome; unknown accounts have no invented owner |
| `reservation_finance_evidence` | Immutable canonical owner/reservation/attempt/account/mode/PaymentIntent/object/amount/currency observations |
| `reservation_finance_objects` | Current per-provider-object projection; provider identity and original amounts are checked before status updates |
| `resolve_reservation_finance_attempts` | Service-only account plus stored-PaymentIntent resolution; no metadata input |
| `record_reservation_finance_event` | Service-only serialized, atomic batch validation, immutable evidence, object deduplication, and terminal-state protection |
| `reservation_finance_summary` | Security-invoker read model separating payment, refund, reversal, dispute, settlement, payout, and reconciliation |
| `get_public_reservation_financial_summary` | Existing private-token RPC, extended without widening guest access or revocation rules |

Event IDs are serialized and recorded once. Distinct events for the same refund,
dispute, or balance transaction update only that object's projection; they do not
add the same amount again. Refund totals cannot exceed the applied payment. A
second original settlement transaction for the same attempt is ambiguous and is
rejected. A batch containing invalid evidence rolls back all of its object and
observation writes and retains one safe unknown receipt.

Succeeded/failed refunds, closed disputes, available settlement, and terminal
payout states cannot regress. Conflicting terminal outcomes become unknown rather
than silently replacing history. Payout association is independent of settlement
notification ordering, so delayed payout evidence can still establish association.

All new tables use RLS and FORCE ROW LEVEL SECURITY. Authenticated users receive
workspace-filtered SELECT only. Anonymous users receive no raw access. Service
role receives mutation RPC execution rather than raw table writes. RPCs have a
fixed `search_path` and execute with the same definer/RLS pattern as RV-E2C.

The migration changes no existing contract, reservation, payment-attempt, payment
event, security-deposit, tenant, lease, rent-charge, or rental-payment row. Original
settlement and payout amounts remain historical facts after refunds and disputes.
Refunds do not reopen the booking balance for collection.

## Read models and UI

`reservationFinanceReadModel` allowlists owner-facing fields. The owner reservations
API reads `reservation_finance_summary` under `effectiveOwnerId`; the acting user
continues to be resolved by the existing authenticated application boundary.

`ReservationFinanceDetails` is shared by `GuestReservationAccess` and
`ReservationsPanel`. Both show refunds, reversal amounts, disputes, original Stripe
gross/fee/net, payout, and reconciliation separately. The owner panel consumes the
actual payment and settlement status instead of hardcoded unpaid labels. Unknown
amounts are displayed as unknown; historical net is not labeled spendable balance.

## Deliberate fail-closed limits and review risks

- Only automatic payouts whose entire paginated batch consists of attributable
  charge/payment balance transactions are matched. Manual, mixed, split,
  incomplete, negative-adjustment, or unsupported batches remain unknown. No
  proportional or metadata-based payout allocation is attempted.
- Reversals are recognized from Stripe refund `destination_details.card.type =
  reversal`. Transfer reversals and other unsupported provider shapes remain
  unknown; they are not silently treated as booking refunds.
- An unknown receipt for a known account conservatively marks that owner's
  reservation reconciliation as unknown. This slice has no operator resolution
  RPC; later matched observations do not erase that review requirement.
- An event arriving before RV-E2C applies the payment remains unknown. A later
  distinct charge or balance notification can collect settlement evidence; replay
  of the same event ID remains a no-op. This slice introduces no cron or polling.
- Raw payloads, guest data, provider error strings, and metadata are not retained.
  Safe receipts provide hashes and coarse rejection reasons, not raw replay bodies.
- Database execution, migration replay/idempotency, and real Stripe observations
  are outstanding review gates. Parsing and mocks do not establish runtime SQL or
  real-provider correctness. Do not mark this implementation production-verified.

## Validation

New tests cover strict event normalization, offline signed webhook authentication,
provider relationships and arithmetic, refund/reversal/dispute outcomes,
pagination, payout membership, migration structure, read-model shaping, and actual
guest/owner UI rendering. Existing tests were retained.

`reservationFinanceRpcs.integration.test.js` contains opt-in real-Postgres tests
using `SET LOCAL ROLE` for service, authenticated owner/member/stranger, and anon.
Each scenario creates synthetic fixtures in one transaction and rolls back. It
does not apply migrations, start/reset a stack, disable immutable triggers, or
delete provider history. It requires an already-installed schema and the exact
disposable project identity:

```sh
RV_E2D_DISPOSABLE_PROJECT=marketplace409-reservation-validation \
  npx vitest run src/domains/reservations/reservationFinanceRpcs.integration.test.js
```

Do not run that command until the migration has been installed through a separately
authorized validation step. The running project was identified read-only as
`marketplace409-reservation-validation`; it was not reset or migrated for this work.
Existing suites that automatically apply migrations are excluded from this run,
without editing or weakening their assertions. Exact command results are recorded
in the PR and delivery report.

### Results in this worktree

| Check | Result |
| --- | --- |
| Final focused run, including existing Stripe/webhook/UI regressions | 174 passed; 19 opt-in PostgreSQL cases skipped |
| Broad Vitest regression excluding database and migration-applying suites | 1,024 files / 7,418 tests passed |
| Non-database governance integration | 2 passed separately; also included in the final broad run |
| RV-E2B/RV-E2C static checks, with migration-executing cases filtered out | 13 passed; 4 restricted cases skipped |
| ESLint, all changed JavaScript/JSX files and tests | Passed |
| PostgreSQL syntax parsing without execution (`pglast` 8.4 in `/tmp`) | 34 SQL statements and 3 function definitions parsed |
| `git diff --check` | Passed |
| `npx tsc --noEmit`, before Next generated route checks | Passed |
| Default `npm run build` | Blocked by font-network restrictions, then Turbopack internal port-binding restriction |
| `npm run build -- --webpack` | Compiled successfully; failed on four unchanged route exports in generated Next type checks |
| Final `npx tsc --noEmit`, including generated route checks | Same four unchanged route-export errors |

The four build/type blockers are in files unchanged from the PR #182 base:

- `src/app/api/private-financing/portal/route.js`: `BorrowerSummaryUnavailableError`
- `src/app/api/rental/cron/settlement-reconciliation/route.js`: `reconcileMissingStripeSettlements`
- `src/app/api/rental/email-settings/route.js`: `emailDeliveryReadiness`
- `src/app/api/rental/reports/route.js`: `excludeOffModeStripePayments`

They are reported rather than bypassed or changed in this bounded slice. The draft
is not a claim that the production build or database validation gates passed.

The final broad regression command used `--exclude 'src/**/*.integration.test.*'` plus the
seven migration test files beginning `20260911000000`, `20260911010000`,
`20260912000100`, `20260912020000`, `20260913000000`, `20260913050000`, and
`20260913060000`. E2B/E2C static cases were run separately. The final broad run
included the non-database governance integration. No existing test source was
removed or weakened. The disposable database container's
`com.supabase.cli.project` label was verified as
`marketplace409-reservation-validation` using read-only `docker ps`.

### Exact file inventory

Production and documentation:

- `supabase/migrations/20260914010000_add_reservation_finance_reconciliation.sql`
- `src/infrastructure/billing/normalizeReservationFinanceEvent.js`: `normalizeReservationFinanceEvent`, `reservationProviderId`
- `src/infrastructure/billing/ReservationFinanceProvider.js`: `ReservationFinanceProvider` (`pages`, `charge`, `paymentIntentForCharge`, `observations`, `payout`)
- `src/app/api/rental/reservation-finance-webhook/route.js`: `POST`, private `resolve`
- `src/domains/reservations/financeReadModel.js`: `reservationFinanceReadModel`
- `src/app/api/rental/reservations/route.js`: `GET`
- `src/components/reservations/ReservationFinanceDetails.jsx`: `ReservationFinanceDetails`
- `src/components/reservations/GuestReservationAccess.jsx`: `GuestReservationAccess`
- `src/components/forge/rental/ReservationsPanel.jsx`: `ReservationsPanel`
- `docs/financial/rv-reservation-settlement-reconciliation.md`

Tests:

- `supabase/migrations/__tests__/20260914010000_add_reservation_finance_reconciliation.migration.test.js`
- `src/infrastructure/billing/normalizeReservationFinanceEvent.test.js`
- `src/infrastructure/billing/ReservationFinanceProvider.test.js`
- `src/app/api/rental/reservation-finance-webhook/route.test.js`
- `src/app/api/rental/reservations/route.test.js`
- `src/domains/reservations/financeReadModel.test.js`
- `src/domains/reservations/reservationFinanceRpcs.integration.test.js`
- `src/components/reservations/ReservationFinanceDetails.test.jsx`
- `src/components/reservations/GuestReservationAccess.test.jsx`
- `src/components/forge/rental/ReservationsPanel.test.jsx`

## Separate controlled observations after review and explicit authorization

1. Authorize a disposable-database migration/replay check and execute the real-role
   tests. Compare preexisting row snapshots and grants before and after.
2. Authorize configuration of the dedicated Stripe **test-mode** webhook endpoint
   and its test signing secret; verify its account and mode independently.
3. Observe a separately authorized RV-E2C test payment, then distinct partial/full
   refund and explicit reversal examples. Verify one object amount per refund ID
   and retained original booking/deposit/settlement history.
4. Observe dispute creation/update and separate won/lost examples. Verify payment
   success, active/lost exposure, and terminal dispute state remain distinct.
5. Observe pending/available balance transactions and a reconcilable automatic
   payout. Compare provider gross, fee, net, full payout membership, and the UI.
6. Exercise duplicate, delayed, mismatched, and unsupported evidence only through
   an explicitly authorized test fixture or delivery plan. Confirm no double
   application, no terminal regression, and safe unknown receipts.

None of these steps authorizes money movement, Stripe object creation, refunds,
webhook resends, migration application, deployment, or production access in this
implementation session.

Provider references: [Stripe refunds and reversals](https://docs.stripe.com/refunds),
[refund object](https://docs.stripe.com/api/refunds/object),
[payout reconciliation](https://docs.stripe.com/reports/payout-reconciliation),
[payout reporting limits](https://support.stripe.com/questions/payout-reporting-options).
