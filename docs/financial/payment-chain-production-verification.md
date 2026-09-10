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

## Local-environment issue found and worked around (needs separate production verification)

While building this proof, `service_role` was found to have **no SELECT/INSERT/UPDATE grant on any
table checked** (`private_financing_events`, `private_financing_components`,
`private_financing_account_terms_versions`, `private_financing_online_payments`,
`payment_webhook_events`, `landlord_payment_accounts`, `rental_payments`,
`rental_autopay_enrollments`) on the local Supabase stack used for this proof — meaning the real
webhook route's own direct `db.from(...).select(...)` calls (using exactly this service_role client)
would fail with `permission denied` before this proof could exercise anything. No migration in this
repo grants these privileges to `service_role`; a schema-wide `GRANT ALL ON ALL TABLES IN SCHEMA
public TO service_role` was applied **directly to the local Docker Postgres instance only** (never
committed, never touching any migration file or production) to unblock this proof.

**This needs verification against actual production**, which this session has no access to check:
if production's `service_role` has the same restricted grant, the private-financing Stripe webhook
path is completely non-functional for real payments right now (every real webhook would fail on its
first database read); if production's baseline grant differs from this local CLI stack's (plausible,
since Supabase's local-dev bootstrap and hosted-platform bootstrap are maintained separately), this
is a local-only artifact and not a real concern. **Do not treat this as confirmed production-broken
or confirmed production-fine — it is unverified from here.**

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
- Rental payment chain — see follow-up plan below.

## Follow-up plan: rental payment chain

Same method (real local stack, real webhook route, real RPC, signed synthetic events, deterministic
provider substitution only for the `charge.succeeded`/settlement path), different fixture graph:
`landlord_payment_accounts` (already have this pattern from this slice) + a minimal
`rental_properties`/`rental_units`/`rental_tenants`/`rental_leases`/`rental_charges` chain + a
`rental_payments` row instead of `private_financing_online_payments`. The webhook branches to
`process_stripe_rental_payment_event` (the `else` branch already read while building this proof) for
`payment_intent.*` events without a `pf_payment_` prefix — same idempotency guard, same signature
verification, same no-Stripe-network-call approach applies. Estimate: similar size to this slice,
should reuse this file's `psql`/`signInFreshClient`/`signedRequest` helpers directly (candidate for
extracting a small shared test-helper module rather than duplicating them). Needs its own
authorization to start.
