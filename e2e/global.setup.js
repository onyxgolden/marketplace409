// Playwright global setup for the tenant-portal smoke suite.
//
// Order matters, and every step fails the run instead of faking it:
//  1. Validate the target (allowlist gate, scratch project, test keys).
//     A missing or production target aborts with the provisioning checklist.
//  2. Prove the target serves no live Stripe key material (best-effort
//     served-code scan of the portal page and its same-origin scripts).
//  3. Prove the Stripe test account exists under the test secret key.
//  4. Seed all fixtures, then write the run state for specs + teardown.
//
// If any step throws, the suite is NOT-RUNNABLE. It is never skipped
// silently and never reported green without a target.
import Stripe from "stripe";
import { readTargetEnv } from "./helpers/target.js";
import { seedRun } from "./helpers/seed.js";
import { writeRunState } from "./helpers/fixtures.js";

async function assertNoLiveKeyMaterial(baseUrl) {
  const response = await fetch(`${baseUrl}/forge/rental/portal`, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Smoke target unreachable: GET /forge/rental/portal returned HTTP ${response.status}. Is the preview deployment up?`);
  }
  const html = await response.text();
  const bodies = [html];
  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter(Boolean).slice(0, 20);
  for (const src of scriptSrcs) {
    try {
      const absolute = new URL(src, baseUrl).toString();
      if (new URL(absolute).origin !== new URL(baseUrl).origin) continue;
      const chunk = await (await fetch(absolute)).text();
      bodies.push(chunk);
    } catch {
      // An unfetchable chunk is not evidence of live keys; the hard gates
      // (allowlist, test-key formats, Stripe API proof) still apply.
    }
  }
  if (bodies.some((body) => body.includes("pk_live_"))) {
    throw new Error("Smoke target serves live Stripe key material (pk_live_ found in served code). Refusing to run.");
  }
}

export default async function globalSetup() {
  const config = readTargetEnv();
  await assertNoLiveKeyMaterial(config.baseUrl);
  const stripe = new Stripe(config.stripeSecret);
  try {
    await stripe.accounts.retrieve(config.connectedAccountId);
  } catch (error) {
    throw new Error(
      `Smoke target Stripe proof failed: cannot retrieve connected account with the test secret key (${error.message}). ` +
        `Provisioning needed: a Stripe test-mode Connect account id in E2E_STRIPE_CONNECTED_ACCOUNT_ID and its test secret key.`,
    );
  }
  const state = await seedRun(config);
  state.baseUrl = config.baseUrl;
  writeRunState(state);
  console.log(`[smoke-setup] run ${state.runId} seeded against ${config.baseUrl}`);
}
