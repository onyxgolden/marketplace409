// Resolves and validates the server's Stripe mode from explicit configuration — never inferred
// from an object ID prefix (a landlord row could theoretically be mis-tagged; the *server's own*
// declared mode is the only thing every write in a request is allowed to trust). Fails closed:
// missing, invalid, or key/mode-mismatched configuration always throws rather than guessing.
//
// NEXT_PUBLIC_* variables are never read here — those are build-time-inlined and client-visible,
// unsuitable as the authority for a server-side financial-mode decision.
const VALID_MODES = new Set(["test", "live"]);
const MODE_SECRET_KEY_PREFIX = Object.freeze({ test: "sk_test_", live: "sk_live_" });
const MODE_PUBLISHABLE_KEY_PREFIX = Object.freeze({ test: "pk_test_", live: "pk_live_" });

export function resolveStripeMode(env = process.env) {
  const mode = env.STRIPE_MODE;
  if (!VALID_MODES.has(mode)) {
    throw new Error('STRIPE_MODE must be set to exactly "test" or "live".');
  }
  const secretKey = env.STRIPE_SECRET_KEY;
  if (typeof secretKey !== "string" || secretKey.trim() === "") {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }
  const expectedPrefix = MODE_SECRET_KEY_PREFIX[mode];
  // Only the expected (constant, publicly-documented) prefix is ever referenced — the actual
  // configured key and its real prefix are never read into an error message, log, or response.
  if (!secretKey.startsWith(expectedPrefix)) {
    throw new Error(`STRIPE_MODE is "${mode}" but the configured Stripe secret key does not start with "${expectedPrefix}".`);
  }
  return Object.freeze({ mode, secretKey });
}

// The publishable key is not secret (it's shipped to the browser by design via NEXT_PUBLIC_*),
// but it must still be validated against the server's authoritative mode before a tenant is
// handed a clientSecret to confirm with it — a pk_live_ key used against a test PaymentIntent
// (or vice versa) fails on Stripe's side in a confusing way instead of failing safely here first.
// Callers invoke this only on the tenant-payment path (payment-session create/resume) — not on
// every Stripe operation — since the publishable key is only ever used there.
export function validatePublishableKeyMode(mode, env = process.env) {
  const publishableKey = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (typeof publishableKey !== "string" || publishableKey.trim() === "") {
    throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required.");
  }
  const expectedPrefix = MODE_PUBLISHABLE_KEY_PREFIX[mode];
  if (!publishableKey.startsWith(expectedPrefix)) {
    throw new Error(`Stripe mode "${mode}" requires a publishable key starting with "${expectedPrefix}".`);
  }
}
