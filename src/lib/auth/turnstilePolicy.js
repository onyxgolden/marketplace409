// Cloudflare Turnstile human verification — policy surface only.
//
// This module is the policy surface (who must be challenged, which keys to
// use). Enforcement lives in the gateway routes (auth flows, via the
// provider's captchaToken path) and in turnstileVerify.js (custom forms, via
// a server-side Siteverify round-trip). The two are deliberately separate so
// policy can never be confused with verification.
//
// Release gate. Turnstile ships as inert, reviewed code until Jason
// explicitly activates it — the same discipline as the MFA Layer 2 flag in
// securityPolicy.js. Flipping `enabled` to true is a release action (real
// keys in the deployment, Supabase dashboard CAPTCHA enabled with the same
// site key, a canary measured) — not a configuration tweak a test or an
// environment boolean may perform on its own. No other module may grant
// Turnstile exemptions based on environment variables.
//
// WHY THE SECRET IS NOT HERE: this module is imported by client components
// (the auth pages render the widget from it). The Turnstile SECRET key must
// never reach the browser — it lives only in turnstileVerify.js, imported by
// server routes. Do not add a secret reader to this file.
//
// Dummy test keys below are Cloudflare's own published test values
// (developers.cloudflare.com/turnstile/troubleshooting/testing/): they are
// public, predictable, and work on any hostname including localhost. They
// are NEVER valid in production — a dummy secret in production refuses
// every check (see isDummySecret / turnstileVerify.js).

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Cloudflare's published dummy test keys. Always-pass pair (visible widget):
// sitekey 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA.
// Always-fail secret: 2x0000000000000000000000000000000AA. The dummy token
// is XXXX.DUMMY.TOKEN.XXXX; test secrets accept only it, real secrets refuse
// it — so sitekey and secret must always be swapped as a pair.
export const DUMMY_SITE_KEY_PASS = "1x00000000000000000000AA";
export const DUMMY_SITE_KEY_FAIL = "2x00000000000000000000AB";
export const DUMMY_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const DUMMY_SECRET_FAIL = "2x0000000000000000000000000000000AA";
export const DUMMY_SECRET_DUPLICATE = "3x0000000000000000000000000000000AA";

// Action labels carried on the widget and validated server-side for custom
// forms. The auth surfaces share one widget (sign-in, sign-up and reset all
// submit from the same form), so they share one label: "auth". The provider
// validates success/hostname for auth tokens; the action label is
// informational there. Custom forms get one fixed action each, checked by
// turnstileVerify.js.
export const TURNSTILE_ACTIONS = Object.freeze({
  AUTH: "auth",
});

// A Turnstile token is a short opaque string. Bound the accepted length so a
// junk body cannot smuggle megabytes into a provider call or a log line.
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

// Generic, non-enumerating message for a missing/invalid challenge token.
// It reveals nothing about account existence.
export const MESSAGE_TURNSTILE_REQUIRED =
  "Please complete the human-verification check and try again.";

// Release gate — see the module header. Ships inert (false).
export const TURNSTILE_CONFIG = Object.freeze({
  enabled: false,
});

export function isTurnstileEnabled(config = TURNSTILE_CONFIG) {
  return config.enabled === true;
}

/**
 * The public site key for the widget. Prefers the deployment's
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY; in non-production falls back to
 * Cloudflare's always-pass dummy sitekey so local dev and CI can render a
 * working widget without live keys. In production with no key configured
 * returns null — the widget cannot render, and the route fails closed.
 */
export function getTurnstileSiteKey(env = process.env) {
  const configured = typeof env?.NEXT_PUBLIC_TURNSTILE_SITE_KEY === "string"
    ? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY.trim()
    : "";
  if (configured !== "") return configured;
  if (env?.NODE_ENV !== "production") return DUMMY_SITE_KEY_PASS;
  return null;
}

/** True when the secret is one of Cloudflare's published dummy test secrets. */
export function isDummySecret(secret) {
  return (
    typeof secret === "string" &&
    (secret === DUMMY_SECRET_PASS ||
      secret === DUMMY_SECRET_FAIL ||
      secret === DUMMY_SECRET_DUPLICATE)
  );
}
