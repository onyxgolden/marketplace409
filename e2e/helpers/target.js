// Pure target gates for the tenant-portal smoke suite.
//
// These functions are deliberately free of I/O and never see a secret value:
// they validate shapes and names only, so the suite can prove it is pointed
// at a scratch target before any browser or API call happens. Unit-tested
// by target.test.js (runs in the repo's vitest job, not in Playwright).

// Hosts the suite must never run against. marketplace409.vercel.app is the
// production deployment (it is also the app's NEXT_PUBLIC_SITE_URL fallback);
// 409marketplace.online is the production domain.
export const PRODUCTION_HOSTS = Object.freeze([
  "409marketplace.online",
  "www.409marketplace.online",
  "marketplace409.vercel.app",
]);

// Production Supabase project ref, defense-in-depth only: the real control is
// that scratch credentials arrive via environment, never committed. A target
// URL containing this ref is refused outright.
export const PRODUCTION_SUPABASE_REF = "bzqvenxjlstinmgbuvvg";

// A base URL is allowed only when it is a local dev server or a Vercel
// preview deployment that is not the production deployment. Everything else
// (bare domains, staging hosts, production hosts) is refused. Returns the
// normalized origin (no trailing slash) or throws.
export function assertAllowedBaseUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("E2E_BASE_URL is required: set it to a Vercel preview deployment URL or a local dev URL.");
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: ${raw.trim()}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`E2E_BASE_URL must be http(s): ${raw.trim()}`);
  }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.includes(host)) {
    throw new Error(`Refusing production host: ${host}. The smoke suite never runs against production.`);
  }
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const isPreview = host.endsWith(".vercel.app");
  if (!isLocal && !isPreview) {
    throw new Error(
      `E2E_BASE_URL host is not an allowed test target: ${host}. Use localhost or a *.vercel.app preview deployment.`,
    );
  }
  return url.origin;
}

// A Supabase URL is refused when it names the production project. This is a
// backstop, not the control: scratch credentials must come from environment.
export function assertScratchSupabaseUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("E2E_SUPABASE_URL is required: set it to the scratch Supabase project URL.");
  }
  if (raw.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error("Refusing the production Supabase project. The smoke suite runs against a scratch project only.");
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("E2E_SUPABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("E2E_SUPABASE_URL must be https.");
  }
  return raw.trim();
}

// Stripe test-mode key shapes. Values are never logged; only prefixes are checked.
export function isTestSecretKey(value) {
  return typeof value === "string" && value.startsWith("sk_test_");
}

export function isTestPublishableKey(value) {
  return typeof value === "string" && value.startsWith("pk_test_");
}

export function assertTestStripeKeys(secret, publishable) {
  if (!isTestSecretKey(secret)) {
    throw new Error("E2E_STRIPE_SECRET_KEY must start with sk_test_. Live keys are never used by this suite.");
  }
  if (!isTestPublishableKey(publishable)) {
    throw new Error("E2E_STRIPE_PUBLISHABLE_KEY must start with pk_test_. Live keys are never used by this suite.");
  }
}

// Run-unique, URL/email/identifier-safe id: e2e-20261102-abcdef123456.
// The same run id prefixes every synthetic row, user, and email the suite
// creates, so teardown can sweep by prefix and a stale row is attributable.
export function makeRunId(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return `e2e-${stamp}-${rand}`;
}

// Non-deliverable test domain (.invalid can never resolve), run-unique so a
// re-run never collides with a previous run's rows.
export function syntheticEmail(runId, label) {
  return `smoke-${label}-${runId}@e2e.invalid`;
}

// Synthetic row ids: text primary keys, run-prefixed for teardown sweeps.
export function syntheticId(runId, kind, n) {
  return `e2e_${runId.replaceAll("-", "_")}_${kind}_${n}`;
}

// Reads the suite's environment and returns a validated target config, or
// throws naming every missing piece (names only, never values). This is the
// provisioning checklist: when it throws, the run is NOT-RUNNABLE, never
// skipped-silently and never faked green.
export function readTargetEnv(env = process.env) {
  const missing = [];
  const baseUrl = env.E2E_BASE_URL;
  const supabaseUrl = env.E2E_SUPABASE_URL;
  const serviceRoleKey = env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecret = env.E2E_STRIPE_SECRET_KEY;
  const stripePublishable = env.E2E_STRIPE_PUBLISHABLE_KEY;
  const connectedAccountId = env.E2E_STRIPE_CONNECTED_ACCOUNT_ID;
  const webhookSecret = env.E2E_STRIPE_WEBHOOK_SECRET;
  if (!baseUrl) missing.push("E2E_BASE_URL");
  if (!supabaseUrl) missing.push("E2E_SUPABASE_URL");
  if (!serviceRoleKey) missing.push("E2E_SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret) missing.push("E2E_STRIPE_SECRET_KEY");
  if (!stripePublishable) missing.push("E2E_STRIPE_PUBLISHABLE_KEY");
  if (!connectedAccountId) missing.push("E2E_STRIPE_CONNECTED_ACCOUNT_ID");
  if (!webhookSecret) missing.push("E2E_STRIPE_WEBHOOK_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `Smoke suite target is not provisioned. Missing environment: ${missing.join(", ")}. ` +
        `See e2e/docs/e2e-smoke-run.md for the provisioning checklist. The suite does not run without a target.`,
    );
  }
  return {
    baseUrl: assertAllowedBaseUrl(baseUrl),
    supabaseUrl: assertScratchSupabaseUrl(supabaseUrl),
    serviceRoleKey,
    stripeSecret,
    stripePublishable,
    connectedAccountId,
    webhookSecret,
  };
}
