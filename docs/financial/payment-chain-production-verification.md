# Payment-Chain Production Verification — Private Financing (Phase 2)

**Prepared:** 2026-09-10, Phase 2 of `FORGE_PRODUCTION_USER_FEEDBACK_AND_ACTIVATION_PLAN.md`.

## Scope decision: private financing first, rental as a follow-up

Both chains share the same webhook boundary (`src/app/api/rental/stripe-webhook/route.js` handles
rental and private-financing events alike, branching on `metadata.forge_payment_id`'s `pf_payment_`
prefix), but private financing is materially higher-risk (interest/principal allocation math,
Stripe-fee credit-back, borrower-facing dollar amounts) and was the one this plan explicitly called
out as needing verification. Building both into one slice would have doubled the fixture/account
setup complexity (rental needs a property/unit/tenant/lease graph; private financing needs an
account/component/terms graph) for a single test file, risking exactly the "oversized or misleading
test" the plan warned against. **Private financing was implemented first; the rental chain is a
same-shaped follow-up** (see "Follow-up plan" below) — not because rental is lower priority, but
because the two fixture graphs are different enough to deserve separate, equally-focused slices.

## Architecture traced

`Stripe webhook event → POST /api/rental/stripe-webhook (route.js) → in-process allocation math
(stripePaymentProjection.js, deterministic, separately unit-tested) → RPC-posted immutable ledger
event (private_financing_events, via complete_private_financing_stripe_payment /
credit_private_financing_stripe_fee, both service_role-only, sequence-locked) → running-balance read
model (summarizeBorrowerEvents in the borrower-portal route) → borrower/owner views.`

Key boundaries, by file:
- Webhook ingress + dedup + branching: `src/app/api/rental/stripe-webhook/route.js`
- Signature verification: `src/infrastructure/billing/StripeBillingProvider.js`'s
  `constructWebhookEvent` (real `stripe` SDK, pure local HMAC, no network call)
- Event normalization: `src/infrastructure/billing/normalizeStripeConnectEvent.js`
- Allocation math (deterministic, reused not reimplemented): `previewExternalManualPayment` /
  `previewStripeFeeReimbursement` in `src/domains/private-financing/adjustmentPreview.js`, driven by
  `src/domains/private-financing/paymentAllocation.js`
- Ledger write (atomic, sequence-locked, service_role-only):
  `complete_private_financing_stripe_payment`, `credit_private_financing_stripe_fee`,
  `update_private_financing_stripe_payment_status` — all in
  `supabase/migrations/20260831000200_add_private_financing_stripe_payments.sql`
- Running-balance / reporting read model: `summarizeBorrowerEvents` in
  `src/app/api/private-financing/portal/route.js`

## Method

Real local Supabase stack (Postgres + GoTrue + PostgREST, Docker), real synthetic auth users, real
signed-in sessions, the real webhook route (`POST` imported and invoked directly, not reimplemented),
real Stripe webhook signatures generated with the official `stripe` SDK's offline test-signing
helper and verified for real by the route's own `constructWebhookEvent` — **no live Stripe network
call anywhere in this proof.** `payment_intent.*` events (successful payment, duplicate, failure,
delayed-event scenarios) never reach a Stripe API method in route.js's own branching. The one
scenario that does (`charge.succeeded`, for fee-credit reconciliation) substitutes a deterministic
fake for exactly the two provider methods it reaches (`retrieveCharge`, `retrieveBalanceTransaction`)
via `vi.doMock` + `vi.importActual`, keeping real signature verification and the real RPC/ledger path
— this is currently the one scenario not yet passing (see below).

Test file: `src/domains/private-financing/__tests__/stripePaymentChain.integration.test.js`. Mirrors
the existing `reservationRpcs.integration.test.js` / `healthRpcs.integration.test.js` convention:
self-skips (not fails) when no local Supabase stack is reachable at `127.0.0.1:54321`.

## What this proof covers

- **Successful exact-cent allocation**: a real `payment_intent.succeeded` webhook, real signature,
  real RPC, asserted against the real posted `private_financing_events` row's
  `principal_paid_by_component_cents` / `principal_remaining_by_component_cents` (exact integers, no
  floating point).
- **Duplicate webhook/retry idempotency**: the identical signed event POSTed twice; second call
  returns `{received:true, duplicate:true}` and the ledger is asserted to carry exactly one posted
  event, not two.
- **Provider failure with no partial residue**: `payment_intent.payment_failed` leaves the payment
  row `status: 'failed'`, `ledger_event_id: null`, and no matching ledger event at all.
- **Delayed/replayed event**: a `payment_intent.processing` event delivered *after* the matching
  `payment_intent.succeeded` for the same PaymentIntent (a different event id, so the dedup guard
  doesn't catch it). **Finding, not fixed**: `update_private_financing_stripe_payment_status` has no
  guard against overwriting a terminal status with an earlier-stage one — the payment's displayed
  `status` regresses from `succeeded` back to `processing`, though the ledger event itself is
  unaffected (still points at the same posted event). Documented as a known gap.
- **Cross-workspace and unauthorized-user denial**: a real, unrelated signed-in stranger gets an
  empty result (not an error) reading this account's events/payments under real RLS, and is denied
  by name (`Owner does not match authenticated workspace`) when attempting the account-opening RPC.
- **No unsupported late fee**: the account's `late_fee_policy` is `disabled` (the RPC itself refuses
  `'enabled'` — not yet implemented, matching the plan's own constraint), and no late-fee event type
  ever appears on the ledger.
- **Acting-user and provider-reference auditability**: the posted ledger event is attributable to no
  human actor (`created_by: null`, `event_origin: 'stripe_webhook'`), and the webhook-delivery audit
  row (`payment_webhook_events`) carries the real Stripe event id and `status: 'processed'`.
- **Agreement among ledger, balance/read model, and reporting** — tested; originally **found to
  disagree** (see below), **now verified to agree** after PR #154.

## Defect found by this proof — corrected by PR #154

`summarizeBorrowerEvents` (`src/app/api/private-financing/portal/route.js`), the function backing
the borrower portal's "Principal remaining" / "Total payments" display, read column names
(`principal_remaining_interest_bearing_cents`, `principal_remaining_zero_interest_cents`,
`interest_paid_cents`, `component_type`) that **did not exist** on the current
`private_financing_events` schema. The schema was generalized (V1 Terms Generalization,
`20260830000300_add_private_financing_v1_terms_generalization.sql`) to carry
`interest_paid_by_component_cents` / `principal_paid_by_component_cents` /
`principal_remaining_by_component_cents` as jsonb maps keyed by `componentKey`, with no
`component_type` column at all — but this one summarization function had never been updated to
match. Every field it read from those old column names came back `undefined`, so
`principalRemainingCents` computed as `0` unconditionally, regardless of real ledger state. This
proof's first test originally caught that directly: the real ledger event showed $250 paid / $750
remaining on a $1,000 zero-interest loan, but the same rows fed through the live
`summarizeBorrowerEvents` reported $0 remaining.

**Corrected by PR #154 (merge commit `6833451785487fe665712c4c7d4db5ee8944e900`)**:
`summarizeBorrowerEvents` was rewritten to walk the current schema's per-component snapshot fields
in ledger order (`principal_remaining_by_component_cents` on `payment_posted`/`payment_reversal`/
`payoff_concession`, `corrected_component_principal_remaining_cents_after` on
`principal_correction`, `interest_paid_by_component_cents` for interest), and to fail closed with a
`BorrowerSummaryUnavailableError` rather than fabricate a wrong number on data it can't safely
interpret. This proof's first test now asserts the corrected value (`principalRemainingCents ===
75000`, agreeing with the raw ledger row's `principal_remaining_by_component_cents.zero_interest`),
confirming ledger and read-model agreement rather than just documenting the prior disagreement.

## Local-environment issue found and worked around — RESOLVED by PR #174

**Update (2026-09-12): root-caused and fixed.** The restricted local `service_role` grant described
below was never a local-only quirk — it was a genuine, systemic migration gap. Production has
always worked only because Supabase-hosted projects run migrations as `supabase_admin`, which
carries an `ALTER DEFAULT PRIVILEGES` configuration that auto-grants full table privileges to
`anon`/`authenticated`/`service_role`/`postgres` on every newly created object. The local Supabase
CLI stack runs migrations as plain `postgres`, which has no such default ACL — so any table created
without an explicit `GRANT` statement in its own migration has always had zero real privileges for
these roles locally, while production silently carried (and still carries) an unintended full grant
on the exact same tables. This was invisible in practice only because every affected table has RLS
forced with policies scoped to `authenticated` (or none at all), so `anon`/`authenticated` were
denied at the row level regardless of the unintended table-level grant — `service_role`, which
bypasses RLS, was the one role where the gap was load-bearing.

PR #174 (`fix/payment-webhook-events-grant-contract`, migration
`20260912020000_establish_stripe_webhook_chain_grant_contract.sql`) traces the full extent of this
gap, starting from a single reported failure on `payment_webhook_events` and expanding twice as each
fix advanced the same two failing integration tests to the next permission-denied error:
1. `payment_webhook_events` alone (the original, narrower finding).
2. Six more rental-domain tables sharing the same root cause: `landlord_payment_accounts`,
   `rental_payments`, `rental_settlements`, `rent_charges`, `rental_autopay_enrollments`,
   `ach_authorizations` (the last confirmed dead code — no grant given).
3. The four private-financing tables this doc already flagged above — `private_financing_online_
   payments`, `private_financing_events`, `private_financing_components`,
   `private_financing_account_terms_versions` — discovered because `stripe-webhook/route.js`
   unconditionally probes `private_financing_online_payments` on every `charge.succeeded`/
   `charge.updated`/`refund.updated`/`pf_payment_*` event regardless of which domain the event
   actually belongs to, so even a purely rental-domain refund test failed on a private-financing
   table it never otherwise touches. Plus one load-bearing dependency, `rental_tenants`
   (`authenticated: select` — required both by `rental_autopay_enrollments`'s own tenant-read
   policy and, independently, by the tenant portal's own page-load query).

**Explicitly investigated and NOT granted, each for a distinct, evidenced reason** (see the
migration's own header comment for the full writeup): `financial_events` has no production
service_role reader anywhere in this codebase (every real route reads it via the authenticated
client) — the assertions that appeared to need it were a test-only gap, fixed by rewriting them to
read via the local Postgres administrator instead of granting a privilege no real caller needs.
`rental_lease_tenants` and `rent_schedules` are both read only by the tenant-invoked autopay-
enrollment RPC, which has its own separate, unrelated RLS defect (see below) — deferred together to
a future PR rather than granted here for no functional benefit.

**Confirmed final state, fresh-stack empirical proof**: both `stripePaymentChain.integration.test.js`
and `rentalPaymentChain.integration.test.js` pass in full (16 passed, 1 documented skip, 0 failed,
out of 17 total) on a completely destroyed-and-recreated local Supabase stack running only
repository migrations — no ad hoc grant, schema-wide `GRANT ALL`, or other local-only patch of any
kind. The full regression suite passes at 1,013/1,013 files and 7,422/7,422 tests (1 pre-existing
documented skip), zero failures.

**A related, separate, still-open finding surfaced along the way (deliberately not fixed by PR
#174)**: `request_rental_autopay_enrollment`/`cancel_rental_autopay_enrollment` are tenant-invoked
`SECURITY INVOKER` RPCs that insert/update `rental_autopay_enrollments` with `owner_id` set to the
tenant's landlord, not the tenant's own `auth.uid()` — but the only insert/update-permitting policy
on that table (`rental_autopay_owner_all`) requires `has_workspace_access(owner_id)`, true only for
the landlord or an active co-owner, never a mere tenant. Proven directly: a real tenant JWT
performing the RPC's own insert shape is denied with `new row violates row-level security policy for
table "rental_autopay_enrollments"`. This means a tenant can never successfully self-enroll in or
self-cancel autopay today. Tracked as its own future, bounded correction — see "Follow-up:
tenant-autopay RLS defect" below.

## What this proof cannot cover

- **Stripe fee credit-back for private financing** — required scenario, not yet passing. The
  deterministic-provider version of this scenario is written (`it.skip` in the test file, see its
  inline comment) but hits a `"createdBy must be a non-empty string."` validation error not yet
  root-caused in the time available this slice. This is the one required scenario left incomplete.
- A true Stripe test-mode network call was deliberately not used anywhere (see Method) — this proof
  cannot catch a drift between Stripe's real webhook payload shape and this file's hand-built
  fixtures, only between the route's own parsing/branching logic and the ledger/RPC layer. The
  existing route-level test (`route.test.js`, fully mocked at the DB layer) plus this proof (fully
  real at the DB layer, fixture-shaped at the Stripe layer) together cover both halves; neither alone
  is a complete substitute for a real Stripe test-mode payment, which the plan itself gates behind
  separate authorization before ever running one.
- Rental payment chain — see follow-up plan below (now done).

## Follow-up plan: rental payment chain — DONE

Completed as `src/domains/rental/__tests__/rentalPaymentChain.integration.test.js`, using exactly
this method and reusing this file's `psql`/`signInFreshClient`/`signedRequest` helpers (extracted to
the shared `src/test-helpers/stripeWebhookIntegrationTestHelpers.js` module, as anticipated below).
Building it out is what surfaced the grant-parity gap resolved by PR #174 above.

## Follow-up: tenant-autopay RLS defect — separate, bounded, future PR

Not fixed by PR #174 (deliberately out of scope — see above). `request_rental_autopay_enrollment`
and `cancel_rental_autopay_enrollment` (`supabase/migrations/20260822010000_add_rent_schedule_
collection_authority.sql` and `20260813002800_create_rental_autopay_controls.sql`) are `SECURITY
INVOKER` RPCs invoked by an authenticated tenant session
(`src/app/api/rental/portal/route.js`'s `POST` handler) that insert/update `rental_autopay_
enrollments` with `owner_id` set to the tenant's landlord — but the only insert/update-permitting
policy, `rental_autopay_owner_all`, requires `has_workspace_access(owner_id)`, which is false for a
mere tenant. A tenant can never successfully self-enroll in or self-cancel autopay today. Fixing it
requires a genuine RLS policy change (e.g., a tenant-scoped write policy gated by real lease
membership), which is a materially different, larger change than a grants-only PR should make in
the same breath — needs its own authorization, design, and test coverage to start.
