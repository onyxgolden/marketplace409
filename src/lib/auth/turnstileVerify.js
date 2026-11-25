// Server-side Cloudflare Turnstile verification (Siteverify) — custom forms.
//
// SERVER-ONLY: this module reads TURNSTILE_SECRET_KEY, which must never
// reach the browser. Import it only from server routes / server modules,
// never from a "use client" file.
//
// This is the verification authority for CUSTOM forms (contact/demo writes
// when one lands — none exists in the app today; see the runbook). Auth
// flows (signup / sign-in / password reset) do NOT use this module: their
// authority is the provider, via the captchaToken passed to Supabase Auth
// (ChatGPT condition 3). A Turnstile token is single-use — one verifier
// per token, never a FORGE Siteverify call AND a provider captchaToken on
// the same token (ChatGPT condition 4).
//
// Fail-closed: a missing secret in production, a Cloudflare outage, a
// timeout, or an unreadable response all refuse the write. Nothing here
// ever logs a token or the secret.
//
// Dummy-secret note (Cloudflare's own testing docs): test secrets answer
// with an unreliable hostname and no action, so hostname/action matching is
// skipped while a dummy secret is in use. Tests that need hostname/action
// enforcement must use a non-dummy secret. A dummy secret in production
// refuses every check — it can never silently switch verification off.

import {
  DUMMY_SECRET_PASS,
  MAX_TURNSTILE_TOKEN_LENGTH,
  TURNSTILE_SITEVERIFY_URL,
  isDummySecret,
} from "./turnstilePolicy.js";

const VERIFY_TIMEOUT_MS = 5000;

/**
 * Resolve the server-side secret. Prefers TURNSTILE_SECRET_KEY; in
 * non-production falls back to Cloudflare's always-pass dummy secret so
 * local dev and CI can verify tokens without live keys. In production with
 * no secret configured returns null — the caller must fail closed.
 */
export function getTurnstileSecret(env = process.env) {
  const configured =
    typeof env?.TURNSTILE_SECRET_KEY === "string" ? env.TURNSTILE_SECRET_KEY.trim() : "";
  if (configured !== "") return configured;
  if (env?.NODE_ENV !== "production") return DUMMY_SECRET_PASS;
  return null;
}

function isTokenShape(token) {
  return (
    typeof token === "string" &&
    token.trim() !== "" &&
    token.length <= MAX_TURNSTILE_TOKEN_LENGTH
  );
}

/**
 * Verify one Turnstile token against Cloudflare Siteverify.
 *
 * @param {object} args
 * @param {string} args.token — the cf-turnstile-response token from the client.
 * @param {string|null} [args.action] — expected action label; checked when
 *   the secret is not a dummy test secret (see module header).
 * @param {string|null} [args.expectedHostname] — expected hostname; checked
 *   under the same condition as `action`.
 * @param {string|null} [args.remoteIp] — client IP, forwarded when known.
 * @param {object} [args.env] — defaults to process.env (injectable for tests).
 * @param {Function} [args.fetchImpl] — defaults to global fetch (injectable).
 * @returns {Promise<{ok:true}|{ok:false,reason:string}>} reason is one of
 *   "missing-token" | "missing-secret" | "invalid-token" |
 *   "wrong-hostname" | "wrong-action" | "unavailable".
 */
export async function verifyTurnstileToken({
  token,
  action = null,
  expectedHostname = null,
  remoteIp = null,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!isTokenShape(token)) {
    return { ok: false, reason: "missing-token" };
  }

  const secret = getTurnstileSecret(env);
  if (secret === null) {
    // No secret to verify with: fail closed, never allow.
    return { ok: false, reason: "missing-secret" };
  }
  if (env?.NODE_ENV === "production" && isDummySecret(secret)) {
    // A dummy secret in production would silently switch verification off.
    return { ok: false, reason: "missing-secret" };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  });

  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network error, timeout, or abort: fail closed.
    return { ok: false, reason: "unavailable" };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!payload || payload.success !== true) {
    return { ok: false, reason: "invalid-token" };
  }

  // Hostname/action matching is skipped for dummy test secrets: Cloudflare's
  // own docs state test secrets answer with an unreliable hostname and no
  // action. Real secrets always carry both checks.
  if (!isDummySecret(secret)) {
    if (
      typeof expectedHostname === "string" &&
      expectedHostname !== "" &&
      payload.hostname !== expectedHostname
    ) {
      return { ok: false, reason: "wrong-hostname" };
    }
    if (
      typeof action === "string" &&
      action !== "" &&
      payload.action !== action
    ) {
      return { ok: false, reason: "wrong-action" };
    }
  }

  return { ok: true };
}
