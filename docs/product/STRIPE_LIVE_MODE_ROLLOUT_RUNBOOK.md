# Stripe live-mode rollout runbook

## Release boundary

This runbook governs the one-time switch of FORGE Rental Manager's Stripe integration from sandbox/test keys to live keys. Code merge, database migration, sandbox verification, and live activation are separate approvals. `STRIPE_MODE`, `STRIPE_SECRET_KEY`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` must always be changed together, in the same deploy — see "No mixed-key partial state" below for why.

## Why this order

`resolveStripeMode()` fails closed if `STRIPE_MODE` and `STRIPE_SECRET_KEY`'s prefix disagree; `validatePublishableKeyMode()` fails closed if `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`'s prefix disagrees with `STRIPE_MODE`. Every table that stores a Stripe identifier now requires `provider_mode` whenever `provider = 'stripe'`, and every Stripe RPC requires an explicit `p_provider_mode` matching the row(s) it touches. The rollout order below exists so that at every step, either everything agrees (safe) or the application refuses to run rather than silently mixing sandbox and live money.

## Sequence

1. **Merge code and migrations** into `main`. Nothing here reads Stripe yet — no route calls `createStripeBillingProvider()` at import time.
2. **Set `STRIPE_MODE=test`** in Production, while the existing sandbox `STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are still installed. This is a no-op change in effect (the app was already running on sandbox keys) — it only makes the mode explicit and turns on mode validation.
3. **Apply the database migrations** (`20260821000000_add_stripe_provider_mode_isolation.sql`, `20260821000100_add_provider_mode_to_stripe_rpcs.sql`) to Production Supabase. Every existing Stripe row — including the historical sandbox payment — is backfilled to `provider_mode = 'test'`, never deleted or rewritten. Manual/offline payments keep `provider_mode = null`.
4. **Deploy** and confirm the preserved sandbox connected account is still retrievable through the V2 status endpoint (`/api/rental/stripe-account` GET). This is also the point at which you should independently verify (a real test-mode call, outside this repo's automated tests) that a V1-created account's capabilities and requirements populate the exact fields this code reads — `configuration.merchant.capabilities.{card_payments,ach_debit_payments,stripe_balance.payouts}.status` and `requirements.entries[]` — see the flagged residual risk below.
5. **Register the account thin-event destination** in the Stripe Dashboard (test mode) for the two event types this app handles, and set `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` to its test secret. Do this before any live equivalent exists, so there is only ever one active secret per mode at a time.
6. **Run one sandbox regression**: onboarding link → status sync → a test payment → webhook-driven settlement. This is the last checkpoint before touching live configuration.
7. **Create and configure the live payment and account webhook destinations** in the Stripe Dashboard (live mode). Do not set their secrets in Vercel yet — creating the destination and installing the secret are separate steps precisely so step 8 can set every live variable atomically.
8. **Set all live Stripe variables together, in one deploy**:
   - `STRIPE_MODE=live`
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`
   - the live payment webhook secret (`STRIPE_CONNECT_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_PLATFORM`)
   - the live account thin-webhook secret (`STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`)

   Never change only one of these. `resolveStripeMode()`/`validatePublishableKeyMode()` will refuse to serve a tenant payment if any single one is stale relative to the others — see below.
9. **Redeploy** so the new environment variables take effect everywhere (server routes, cron, webhooks, and the client bundle carrying the publishable key).
10. **Create a new live landlord connected account** — this is a genuinely new V2 Core Account (`dashboard: "express"`, `provider_mode: "live"`); the preserved sandbox account and its `test`-tagged rows are never touched or reused for this.
11. **Complete live onboarding** for that account through Stripe's hosted flow.
12. **Perform one controlled, low-value live payment and refund** as the final end-to-end check, then confirm it appears correctly in live operational reports (see `excludeOffModeStripePayments`) and that the historical sandbox transaction still appears in the raw transaction/audit view but not in any live total.

## No mixed-key partial state

The three live variables in step 8 are set together because:
- `STRIPE_SECRET_KEY` alone controls what Stripe API calls actually do (test vs. live account/PaymentIntent).
- `STRIPE_MODE` alone controls which `provider_mode` every new database row is tagged with, and which mode every webhook/RPC predicate requires.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` alone controls what the tenant's browser confirms against.

If any one lagged behind the other two, `resolveStripeMode()` or `validatePublishableKeyMode()` throws before any Stripe call or tenant payment session is created — the application never falls back to guessing, and never serves a payment session under mismatched configuration. This is enforced in code (`src/infrastructure/billing/stripeMode.js`), not just by this runbook's ordering.

## Residual risk flagged for step 4

Primary Stripe documentation confirms V2 `accounts.retrieve` works against a legacy V1-created account without modification. This was independently verified with a real test-mode call against the preserved sandbox connected account: `configuration.merchant.capabilities.{card_payments,ach_debit_payments,stripe_balance.payouts}.status` and `requirements.entries[]` (an array, possibly empty) were both present as expected. `requirements.summary` was **absent** on that response — Stripe omits it when there is nothing to summarize. This app's `retrieveAccountStatus()` only ever reads `requirements.entries[]`, never `requirements.summary`, so an absent summary is a normal, valid state, not an error and not a signal of "restricted" — see the tests in `StripeBillingProvider.test.js` guarding this contract.
