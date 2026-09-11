// Shared plumbing for real-infrastructure Stripe webhook integration proofs (currently:
// stripePaymentChain.integration.test.js for private financing, rentalPaymentChain.integration.test.js
// for rental) -- both post to the exact same webhook boundary
// (src/app/api/rental/stripe-webhook/route.js handles rental and private-financing events alike,
// branching on metadata.forge_payment_id's pf_payment_ prefix), so these helpers are domain-neutral
// by construction, not something either domain owns.
//
// Extracted rather than duplicated: before this module existed, both integration-test files defined
// their own copies of these functions/constants. A behavior-preserving extraction -- confirmed by
// running stripePaymentChain.integration.test.js immediately after the extraction and getting an
// identical pass count to before.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const LOCAL_URL = "http://127.0.0.1:54321";
// Well-known, publicly documented Supabase CLI local-dev demo keys -- identical on every
// `supabase start` unless explicitly overridden, never secrets.
export const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
export const TEST_PASSWORD = "correct-horse-battery-staple-1";

// Not real Stripe credentials -- STRIPE_MODE/STRIPE_SECRET_KEY only need to satisfy
// resolveStripeMode's shape check (a "sk_test_" prefix) since no scenario in either proof ever
// calls a Stripe network method; the webhook secret is a signing key these proofs invent and use
// only to sign+verify their own synthetic events via the real `stripe` SDK, entirely offline.
export const FAKE_STRIPE_SECRET_KEY = "sk_test_FAKE_KEY_FOR_LOCAL_INTEGRATION_TEST_ONLY_0000000000000000";
export const FAKE_WEBHOOK_SECRET = "whsec_fake_local_integration_test_secret_0000000000000000";

export function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

export async function isLocalStackReachable() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function signInFreshClient(email) {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

export function signedRequest(event, secret = FAKE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/rental/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

// Sets every env var the webhook route + Stripe billing provider read, to the fake/local values
// above. Both integration-test files' beforeAll call this identically.
export function installFakeStripeEnv() {
  for (const key of ["STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_PLATFORM", "STRIPE_MODE", "STRIPE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    process.env[key] = key === "STRIPE_CONNECT_WEBHOOK_SECRET" || key === "STRIPE_WEBHOOK_SECRET_PLATFORM"
      ? FAKE_WEBHOOK_SECRET
      : key === "STRIPE_MODE" ? "test"
      : key === "STRIPE_SECRET_KEY" ? FAKE_STRIPE_SECRET_KEY
      : key === "NEXT_PUBLIC_SUPABASE_URL" ? LOCAL_URL
      : LOCAL_SERVICE_ROLE_KEY;
  }
}
