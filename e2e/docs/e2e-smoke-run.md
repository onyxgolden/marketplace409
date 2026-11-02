# Tenant-portal Playwright smoke suite

Scope: `briefs/rental/rental-tenant-portal-playwright-smoke-scope-2026-11-02.md`
(filed in forge-ai-drop). Three flows, verified against marketplace409 main
`5c1c7a6`: pay, invite claim, lease creation — plus axe-core on every page
the flows touch and Lighthouse at phone widths on unauthenticated surfaces
only. Zero production-code changes: this tree, one workflow file, one npm
script, and `.gitignore` entries are the entire touch surface.

## What runs

| Spec | Covers |
| --- | --- |
| `e2e/specs/pay.e2e.js` | Pay gate both sides (Pay now vs Managed in Rentec vs no button on paid/void vs disabled Payment pending), Stripe-init failure state, full card payment + signed webhook + balance drop, card fee agreement gating + fee on the payment row, resume of an unsubmitted payment |
| `e2e/specs/invite-claim.e2e.js` | UI send flips `invited` + `invited_at` only on actual send, wrong-email and duplicate-email negatives, first-load auto-claim via `claim_rental_tenant_portal`, unconfirmed signup claims nothing, API negatives (claimed 409, cross-workspace 404, read-only 403, delete claimed 409) |
| `e2e/specs/lease-create.e2e.js` | No-primary warning on the pre-seeded primary-less lease, create lands the first picked tenant as primary (+ schedule + deposit), co-tenant add then make-primary swap, read-only save-lease 403 |
| `e2e/specs/lighthouse.e2e.js` | Unauthenticated `/forge/rental/portal` (signed-out card) and `/auth` at 390px: accessibility + best-practices ≥ 90, performance reported only |

Axe runs inside the flow specs (`e2e/helpers/axe.js`): critical violations
fail the run; serious violations are annotated and logged, never silently
waived — serious becomes failing only by a deliberate promotion, not by
accident.

## Run it

```sh
# From the repo root, with the seven env vars below exported:
npm run test:e2e:smoke
```

Global setup seeds the scratch project, then global teardown deletes
everything seeded. **A run that leaves synthetic rows behind is a failed
run**, even if every assertion passed — teardown throws on leftovers.
Stripe test-mode objects (customers, PaymentIntents) are not deleted:
test mode is a sandbox, and the suite asserts against them via the API.

Seed/teardown run standalone only through the suite (there is no separate
seed command — the run state file `e2e/.e2e-run.json` is written by global
setup and consumed by the specs).

## Required environment (all seven, no defaults)

| Variable | What it is |
| --- | --- |
| `E2E_BASE_URL` | Target deployment URL. Localhost or a `*.vercel.app` preview deployment only — production hosts are refused by the target gate. |
| `E2E_SUPABASE_URL` | Scratch Supabase project URL (https). Must have the repo migrations applied. |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | Scratch project service-role key. Used for seeding, Admin-API user creation, and teardown only. |
| `E2E_STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_…`). Live keys abort the run. |
| `E2E_STRIPE_PUBLISHABLE_KEY` | Stripe test publishable key (`pk_test_…`). |
| `E2E_STRIPE_CONNECTED_ACCOUNT_ID` | Test-mode Connect account id (`acct_…`) with charges, payouts, and card payments enabled. |
| `E2E_STRIPE_WEBHOOK_SECRET` | Webhook signing secret. Must equal the target's `STRIPE_CONNECT_WEBHOOK_SECRET` (or `STRIPE_WEBHOOK_SECRET_PLATFORM`). |

If any piece is missing, global setup aborts fast with a provisioning
message and the run is **NOT-RUNNABLE** — never worked around with a
production target, dummy credentials, or a mocked backend.

## Provisioning checklist (what Jason / the operator must provide)

1. **Scratch Supabase project** with every repo migration applied, plus its
   URL and service-role key. Auth must have email confirmation **enabled**
   (the default): the unconfirmed-signup test and the claim RPC's
   confirmed-email gate both depend on it. Pre-confirmed synthetic users
   are created through the Admin API, scratch only.
2. **Stripe test keys** (`sk_test_` / `pk_test_`) and a **test-mode Connect
   account** (`acct_…`, charges/payouts/card enabled).
3. **Webhook secret** shared between the suite (`E2E_STRIPE_WEBHOOK_SECRET`)
   and the target (`STRIPE_CONNECT_WEBHOOK_SECRET` or
   `STRIPE_WEBHOOK_SECRET_PLATFORM`).
4. **Target preview deployment env**: `STRIPE_MODE=test`, the Stripe test
   keys, the scratch Supabase URL + anon key, a **Resend API key + sender**
   (required for the UI invite-send test — without it the send action
   returns 502 and flips nothing, which is the app's honest behavior),
   and the webhook secret above.
5. **Preview URL wiring**: `E2E_BASE_URL` must point at a preview
   deployment whose env matches items 1–4. How a per-PR preview URL is
   discovered (stable preview alias vs per-PR derivation) must be verified
   in Vercel project settings — it is not guessed here, and the CI job
   fails fast while it is unwired. CI PRs must come from repo branches
   (the team's normal flow), not forks, or secrets are unavailable.
6. **CI secrets** for all seven variables above.

## CI job

`.github/workflows/e2e-smoke.yml` — modeled on `typecheck.yml` (pull_request
+ push to main, ubuntu-latest, Node 22, `npm ci`, Playwright chromium
install, `npm run test:e2e:smoke`, report artifact on failure).

**NON-BLOCKING until promoted.** The job fails honestly when the suite
fails (no `continue-on-error` — that would make "green" meaningless), but
it must NOT be listed as a required status check in branch protection
until Jason says so after **10 consecutive green runs**. Only then, on his
word, does it become required.

## Data rules (non-negotiable)

- Synthetic data only: run-unique ids, `@e2e.invalid` emails, no real
  tenant, owner, or property records — never Steven Crabtree, the
  Parmenters, or Eric Carrillo.
- Scratch Supabase + Stripe test keys only; production-host denylist and
  test-mode fail-closed gates in `e2e/helpers/target.js`.
- No real outbound email is asserted: the suite asserts the invite send +
  the `invited` flip and the claim, NOT delivery or the confirmation click.
  Confirmation is exercised via pre-confirmed synthetic users (Admin API,
  scratch only).
- No real money: one-time test payments against test-mode PaymentIntents,
  settled by a signed test webhook the suite itself delivers (transport
  simulated, handler real — the webhook route, signature check, and
  projection all run for real).
- The webhook helper posts to the target's real `/api/rental/stripe-webhook`
  with a real Stripe signature over a real test-mode PaymentIntent. If the
  signature or the connected account is wrong, the route rejects it —
  that is the test working, not the harness failing.

## Known limits

- A local end-to-end run needs a provisioned target (above). Without one,
  the expected outcome is the global-setup provisioning abort — report it
  as NOT-RUNNABLE, never as green.
- The suite pins UI text and selectors from main `5c1c7a6`. A UI copy
  change in the portal, lease panel, or auth page will fail the affected
  test honestly; update the selector, not the assertion's meaning.
- Lighthouse performance is reported, never gated: phone-width numbers on
  a shared CI runner are too noisy to fail a smoke run.
