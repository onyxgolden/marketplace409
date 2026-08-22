# Stripe live-mode rollout runbook

## Release boundary

This runbook governs the one-time switch of FORGE Rental Manager's Stripe integration from sandbox/test keys to live keys. Code merge, database migration, sandbox verification, and live activation are separate approvals. `STRIPE_MODE`, `STRIPE_SECRET_KEY`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` must always be changed together, in the same deploy — see "No mixed-key partial state" below for why.

## Why this order

`resolveStripeMode()` fails closed if `STRIPE_MODE` and `STRIPE_SECRET_KEY`'s prefix disagree; `validatePublishableKeyMode()` fails closed if `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`'s prefix disagrees with `STRIPE_MODE`. Every table that stores a Stripe identifier now requires `provider_mode` whenever `provider = 'stripe'`, and every Stripe RPC requires an explicit `p_provider_mode` matching the row(s) it touches. The rollout order below exists so that at every step, either everything agrees (safe) or the application refuses to run rather than silently mixing sandbox and live money.

## Deployment-order hazard: merging to `main` *is* deploying

**`main` is wired to automatic Vercel production deployment — advancing it is not a separate step from deploying, it *is* the deploy.** The sequence below was corrected from an earlier draft that treated "merge code and migrations" (step 1) and "deploy" (step 4) as separate, ordered actions with database migration safely sandwiched in between. That draft is unsafe: applying either migration while the *previously deployed* (old) application code is still serving breaks every live Stripe write path immediately —
- `landlord_payment_accounts`, `billing_customer_references`, `rental_payments`, and `payment_webhook_events` gain a CHECK requiring `provider_mode is not null` whenever `provider = 'stripe'`; the old code's inserts/upserts never set that column, so every one starts failing the constraint the instant the migration commits.
- `rental_autopay_attempts` gains an unconditional `provider_mode not null`; the old autopay-sweep insert fails the same way.
- The old code's `payment_webhook_events` upsert targets `onConflict: "provider,provider_event_id"`; the migration drops that exact unique constraint and replaces it with a three-column one. The old upsert has no matching constraint left and fails outright (Postgres `42P10`).
- `20260821000100` (the RPC migration) cannot even be applied before `20260821000000` — its function bodies reference the `provider_mode` column, which does not exist until the first migration runs. **The two migrations have a hard ordering dependency: `...000000` before `...000100`, always, no exceptions.**

There is no ordering of "migrate" vs. "advance `main`" that avoids *some* window where live Stripe write paths return errors — Supabase migration and Vercel deployment are two separate systems and cannot be made atomic with each other. The sequence below chooses the smaller of the two windows and states it as an explicit, scoped maintenance window rather than leaving it implicit.

## Sequence

1. **Set `STRIPE_MODE=test`** in Production, while the existing sandbox `STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are still installed. Safe to do at any time, independent of everything else below: old code never reads `STRIPE_MODE` at all (it doesn't exist yet in that codebase), so setting it early has zero effect on old code's behavior. It only takes effect once the new code (step 2) is live.
2. **Merge to `main`.** This is the deploy — there is no separate step 4 anymore. Confirm the build succeeds and the app boots; nothing reads Stripe or touches the new `provider_mode` column at import time, so a clean boot is expected even though the migrations haven't run yet.
   - **Expected, scoped breakage from this point until step 3 completes**: every Stripe write path — landlord onboarding (`/api/rental/stripe-account`), payment-session create/resume, both webhook routes, and the autopay-sweep cron — returns a controlled per-request error (missing `provider_mode` column / missing RPC parameter), never a crash or a silent wrong write. Because `STRIPE_MODE` was already set in step 1, non-Stripe rental functionality, including all six core reports under `/api/rental/reports`, is unaffected. Treat this as a short, explicit maintenance window scoped to Stripe payment functionality only — see "Is a maintenance window required?" below.
3. **Apply the database migrations immediately**, in order: `20260821000000_add_stripe_provider_mode_isolation.sql` then `20260821000100_add_provider_mode_to_stripe_rpcs.sql`. Every existing Stripe row — including the historical sandbox payment — is backfilled to `provider_mode = 'test'`, never deleted or rewritten. Manual/offline payments keep `provider_mode = null`. Minimize the gap between step 2 and this step; there is no way to close it to zero.
4. **Confirm the preserved sandbox connected account is still retrievable** through the V2 status endpoint (`/api/rental/stripe-account` GET). This is also the point at which you should independently verify (a real test-mode call, outside this repo's automated tests) that a V1-created account's capabilities and requirements populate the exact fields this code reads — `configuration.merchant.capabilities.{card_payments,ach_debit_payments,stripe_balance.payouts}.status` and `requirements.entries[]` — see the flagged residual risk below.

   **Do not proceed past this step yet.** `stripe-webhook/route.js` and `stripe-account-webhook/route.js` both call `.upsert(..., { onConflict: "provider,provider_event_id" })` against `payment_webhook_events` — the two-column target the migration in step 3 just dropped. Every webhook delivery will fail with Postgres `42P10` until those two `onConflict` strings are corrected to `"provider,provider_mode,provider_event_id"` (matching the constraint the migration actually creates) and redeployed. This is a code defect, not an ordering problem — no sequencing of these steps avoids it. A failing regression test proving this is at `src/domains/billing-provider/__tests__/payment-webhook-events-onconflict-matches-migration.test.js`.
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
10. **Create a new live landlord connected account** — this is a genuinely new V2 Core Account (`dashboard: "full"`, `provider_mode: "live"`); the preserved sandbox account and its `test`-tagged rows are never touched or reused for this.
11. **Complete live onboarding** for that account through Stripe's hosted flow.
12. **Perform one controlled, low-value live payment and refund** as the final end-to-end check, then confirm it appears correctly in live operational reports (see `excludeOffModeStripePayments`) and that the historical sandbox transaction still appears in the raw transaction/audit view but not in any live total.

## Why live accounts use `dashboard: "full"`, not `"express"`

Test-mode account creation used `dashboard: "express"` throughout this project and it worked. The first live account-creation attempt on Production failed with Stripe error `account_controller_unsupported_configuration`, HTTP 400. Per Stripe's Connect "design an integration" guide: combining Express Dashboard access with Stripe holding negative-balance liability (`losses_collector: "stripe"`) is in **public preview** — it requires pinning the Stripe client to API version `2026-07-29.preview` *and* replacing hosted Account Link onboarding with Connect embedded components (onboarding, account management, and the notification banner are all mandatory in that combination). This app does neither, so the stable API version this app runs on rejects that permutation outright — test mode never exercised this specific rejection path, which is why it surfaced only on the first live attempt.

FORGE's approved financial policy — the landlord pays Stripe's processing fees, Stripe carries negative-balance liability, FORGE assumes neither — is unchanged. `fees_collector`/`losses_collector` are still both `"stripe"`. What changed is `dashboard: "full"` instead of `"express"`, which **is** supported for this fee/loss combination on the stable API. The trade-off: a full-dashboard connected account gets its own unrestricted Stripe Dashboard login (`dashboard.stripe.com`) rather than a FORGE-branded Express flow, and Stripe treats dashboard type as immutable per account — changing it later means creating a new `Account` object, not updating the existing one. Revisit Express + preview API + embedded components as a deliberate future feature if a branded, headless onboarding experience is wanted for landlords beyond the initial operator.

## No mixed-key partial state

The three live variables in step 8 are set together because:
- `STRIPE_SECRET_KEY` alone controls what Stripe API calls actually do (test vs. live account/PaymentIntent).
- `STRIPE_MODE` alone controls which `provider_mode` every new database row is tagged with, and which mode every webhook/RPC predicate requires.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` alone controls what the tenant's browser confirms against.

If any one lagged behind the other two, `resolveStripeMode()` or `validatePublishableKeyMode()` throws before any Stripe call or tenant payment session is created — the application never falls back to guessing, and never serves a payment session under mismatched configuration. This is enforced in code (`src/infrastructure/billing/stripeMode.js`), not just by this runbook's ordering.

## Is a maintenance window required?

Yes, scoped to Stripe payment functionality, not the whole site. Between "merge to `main`" (step 2) and "migrations applied" (step 3) completing, landlord onboarding, tenant payment-session creation, both webhook routes, and the autopay-sweep cron all return controlled errors — no crash, no silent bad write, no data loss, but no successful Stripe operation either. Every other rental feature, including all reports, is unaffected as long as `STRIPE_MODE` was set in step 1 first. Keep this window as short as possible by having the migrations ready to run the moment the step-2 deploy is confirmed live.

## Rollback procedures

**Application deployment failure (build fails, or the new deployment misbehaves after going live):** Use Vercel's Instant Rollback to repoint production traffic at the last known-good deployment — this does not require a new build and takes effect in seconds. A `git revert` of the merge commit, pushed to `main`, is the durable follow-up so the git history and the live deployment agree, but it triggers a full rebuild and is slower. Either way: the migrations are additive (no `drop table`, no `delete from`, confirmed by `stripe-provider-mode-isolation.migration.test.js`), so rolling back the app alone is safe with respect to data — but if the migrations already applied, rolling back to the *old* app code reintroduces every write-path failure described above ("Deployment-order hazard"), since old code still doesn't set `provider_mode`. Rolling back the app after migrations are applied only makes sense as a very short bridge back to a fixed forward deploy, not as a stable end state.

**Migration failure:** Every statement in both migration files runs inside a single transaction per file (neither uses `create index concurrently` or any other statement that forces running outside a transaction — confirmed by grepping every migration in this repo), so a failure partway through either file rolls back that entire file automatically; there is no partial-column, partial-constraint state to clean up by hand. There are no down-migrations anywhere in this repo (`supabase/migrations/` is forward-only, confirmed by listing the directory) — the recovery path for a genuine migration bug is always a new forward-fixing migration, never a hand-authored reverse script.

**Sandbox regression failure (step 6):** No live money is at risk yet at this point — everything is still in test mode against the preserved sandbox account. "Rollback" here just means: do not proceed to creating live webhook destinations or setting live keys. Fix forward, redeploy, and re-run the sandbox regression from the start before continuing.

## Residual risk flagged for step 4

Primary Stripe documentation confirms V2 `accounts.retrieve` works against a legacy V1-created account without modification. This was independently verified with a real test-mode call against the preserved sandbox connected account: `configuration.merchant.capabilities.{card_payments,ach_debit_payments,stripe_balance.payouts}.status` and `requirements.entries[]` (an array, possibly empty) were both present as expected. `requirements.summary` was **absent** on that response — Stripe omits it when there is nothing to summarize. This app's `retrieveAccountStatus()` only ever reads `requirements.entries[]`, never `requirements.summary`, so an absent summary is a normal, valid state, not an error and not a signal of "restricted" — see the tests in `StripeBillingProvider.test.js` guarding this contract.
