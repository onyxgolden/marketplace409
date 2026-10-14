// Server-side auth admission limiter client (Layer 2).
//
// ALL custom auth admission buckets are evaluated atomically in Postgres by
// the `auth_admission_check` RPC — there is no in-memory production counter.
// This module is a thin, fail-closed client around that RPC.
//
// RPC contract (supabase/migrations/20261013225000_auth_rate_limit_buckets.sql):
//   auth_admission_check(
//     p_action text,          -- one of the ACTION namespaces below
//     p_keys text[],          -- positional bucket keys (opaque strings)
//     p_limits jsonb,         -- positional [{capacity, window_seconds}]
//     p_operation_id text,    -- idempotency key; replay is bound to
//                              action+key-set and to one provider attempt
//     p_now timestamptz       -- NULL in production (server clock governs)
//   ) RETURNS TABLE (
//     allowed boolean,
//     retry_after_seconds integer,
//     backoff_seconds integer,
//     unavailable boolean
//   )
//
// Fail-closed contract: ANY store error (RPC error, network failure,
// unexpected shape) returns { allowed: false, unavailable: true } and the
// caller must NOT call the provider. Already-issued tokens stay usable under
// their existing validity; only NEW auth operations and refresh are gated.
//
// Keying rules:
// - Account key = HMAC-SHA256(normalized identifier) with the server-held
//   AUTH_LIMITER_HMAC_KEY. Normalization is trim + lowercase ONLY — no
//   Gmail dot/plus collapsing, matching provider behavior.
// - Session key = an independently authenticated session identifier, used
//   AS-IS (callers pre-hash bearer material with opaqueKey()). It is NEVER
//   derived from the account hash.
// - IP is the trusted deployment-derived value passed in by the caller (edge
//   / load-balancer extraction the deployment controls). NEVER trust an
//   arbitrary X-Forwarded-For value here; header handling belongs to the
//   deployment's trusted-proxy configuration, documented alongside it.
// - Use a verified user/session id for refresh and authenticated actions;
//   never decode an unverified token for account attribution.

import { createHmac } from "node:crypto";

export const AUTH_ACTIONS = Object.freeze({
  PASSWORD_SIGNIN: "password_signin",
  SIGNUP: "signup",
  RESET_REQUEST: "reset_request",
  PASSWORD_UPDATE: "password_update",
  REFRESH: "refresh",
  MFA_CHALLENGE: "mfa_challenge",
  MFA_VERIFY: "mfa_verify",
  // L2-008: pre-verification abuse reservations. Phase 1 of an MFA
  // challenge/verify debits a SMALL separate namespace (abuse reservation)
  // instead of the full verified budget, so one MFA operation does not
  // double-charge the IP budget across its two admission phases.
  MFA_CHALLENGE_PRE: "mfa_challenge_pre",
  MFA_VERIFY_PRE: "mfa_verify_pre",
  RECOVERY: "recovery",
});

// Staging defaults from the Layer 2 brief. These are TUNABLE staging values,
// not hardcoded policy: the migration owns the canonical bucket definitions
// and a future admin surface may adjust them without a code change. Keep this
// table in sync with the migration when it lands.
export const DEFAULT_LIMITS = Object.freeze({
  password_signin: Object.freeze({
    account_ip: "5 failed attempts / 5 minutes",
    account: "30 failed attempts / 15 minutes",
    ip: "100 admissions / 5 minutes",
  }),
  signup: Object.freeze({
    ip: "20 / 10 minutes",
    account: "3 / hour",
  }),
  reset_request: Object.freeze({
    account: "3 / hour",
    ip: "30 / hour",
  }),
  password_update: Object.freeze({
    account: "30 failed attempts / 15 minutes",
    ip: "100 admissions / 5 minutes",
  }),
  refresh: Object.freeze({
    // L2-008: the per-CREDENTIAL abuse bucket (HMAC of the presented
    // refresh token). A refresh token is a ROTATING credential, not a
    // stable session — the bucket bounds abuse per presented credential,
    // not per session family. Account-level refresh budgeting is
    // NOT YET IMPLEMENTED (the account is unknown until the provider
    // validates the token, and an unverified token is never decoded for
    // attribution); see the runbook inventory.
    credential: "30 / 5 minutes",
    ip: "1000 / 5 minutes",
  }),
  mfa_challenge: Object.freeze({ account: "5 failures / 5 minutes", ip: "60 / 5 minutes" }),
  mfa_verify: Object.freeze({ account: "5 failures / 5 minutes", ip: "60 / 5 minutes" }),
  // L2-008: pre-verification abuse reservations — small, separate
  // namespaces so the two admission phases of one MFA op do not
  // double-charge the IP budget.
  mfa_challenge_pre: Object.freeze({ ip: "60 / 5 minutes (abuse reservation)" }),
  mfa_verify_pre: Object.freeze({ ip: "60 / 5 minutes (abuse reservation)" }),
  recovery: Object.freeze({ account: "5 failures / 5 minutes", ip: "60 / 5 minutes" }),
});

// Backoff ladder after repeated failures (seconds), capped at 60, then a
// bounded bucket cooldown. Successful MFA clears applicable failure backoff
// (the RPC owns that logic); backoff never refunds IP abuse budgets.
export const BACKOFF_LADDER_SECONDS = Object.freeze([2, 4, 8, 16, 32, 60]);

/**
 * Machine-readable bucket config per action, aligned with the
 * `auth_admission_check(p_action, p_keys, p_limits, p_operation_id, p_now)`
 * migration. Each entry: { kinds: ['account_ip'|'account'|'ip'|'session'|
 * 'credential'], capacity, windowSeconds }. Keys are built as
 * `${action}:${kind}:${accountKeyHex}:${ip}` (components omitted when null).
 *
 * L2-008: the 'credential' kind is the honest name for the refresh bucket
 * keyed on HMAC(refresh_token) — a per-credential abuse bucket, not a
 * session bucket. The 'session' kind remains for actions whose sessionId
 * is a verified stable session id (claims session_id).
 */
export const ACTION_BUCKETS = Object.freeze({
  password_signin: Object.freeze([
    Object.freeze({ kinds: ["account_ip"], capacity: 5, windowSeconds: 300 }),
    Object.freeze({ kinds: ["account"], capacity: 30, windowSeconds: 900 }),
    Object.freeze({ kinds: ["ip"], capacity: 100, windowSeconds: 300 }),
  ]),
  signup: Object.freeze([
    Object.freeze({ kinds: ["ip"], capacity: 20, windowSeconds: 600 }),
    Object.freeze({ kinds: ["account"], capacity: 3, windowSeconds: 3600 }),
  ]),
  reset_request: Object.freeze([
    Object.freeze({ kinds: ["account"], capacity: 3, windowSeconds: 3600 }),
    Object.freeze({ kinds: ["ip"], capacity: 30, windowSeconds: 3600 }),
  ]),
  password_update: Object.freeze([
    Object.freeze({ kinds: ["account"], capacity: 30, windowSeconds: 900 }),
    Object.freeze({ kinds: ["ip"], capacity: 100, windowSeconds: 300 }),
  ]),
  refresh: Object.freeze([
    // L2-008: per-credential abuse bucket (HMAC of the presented refresh
    // token). NOT a session bucket: the credential rotates.
    Object.freeze({ kinds: ["credential"], capacity: 30, windowSeconds: 300 }),
    Object.freeze({ kinds: ["ip"], capacity: 1000, windowSeconds: 300 }),
  ]),
  mfa_challenge: Object.freeze([
    Object.freeze({ kinds: ["session"], capacity: 30, windowSeconds: 300 }),
    Object.freeze({ kinds: ["account"], capacity: 5, windowSeconds: 300 }),
    Object.freeze({ kinds: ["ip"], capacity: 60, windowSeconds: 300 }),
  ]),
  mfa_verify: Object.freeze([
    Object.freeze({ kinds: ["session"], capacity: 30, windowSeconds: 300 }),
    Object.freeze({ kinds: ["account"], capacity: 5, windowSeconds: 300 }),
    Object.freeze({ kinds: ["ip"], capacity: 60, windowSeconds: 300 }),
  ]),
  // L2-008: pre-verification abuse reservations. Phase 1 of an MFA op
  // debits ONLY this small separate IP namespace; the full verified
  // budget (account + ip + session) is debited once in phase 2.
  mfa_challenge_pre: Object.freeze([
    Object.freeze({ kinds: ["ip"], capacity: 60, windowSeconds: 300 }),
  ]),
  mfa_verify_pre: Object.freeze([
    Object.freeze({ kinds: ["ip"], capacity: 60, windowSeconds: 300 }),
  ]),
  recovery: Object.freeze([
    Object.freeze({ kinds: ["session"], capacity: 30, windowSeconds: 300 }),
    Object.freeze({ kinds: ["account"], capacity: 5, windowSeconds: 300 }),
    Object.freeze({ kinds: ["ip"], capacity: 60, windowSeconds: 300 }),
  ]),
});

function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Auth rate limiter requires ${name}.`);
  }
  return value;
}

/** Normalize an account identifier: trim + lowercase only. */
export function normalizeAccountIdentifier(identifier) {
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw new Error("normalizeAccountIdentifier requires a non-empty identifier string.");
  }
  return identifier.trim().toLowerCase();
}

/** HMAC-SHA256 hex of the normalized identifier with the server-held key. */
export function accountKey(identifier, hmacKey) {
  const normalized = normalizeAccountIdentifier(identifier);
  if (typeof hmacKey !== "string" || hmacKey === "") {
    throw new Error("accountKey requires a server-side HMAC key.");
  }
  return createHmac("sha256", hmacKey).update(normalized, "utf8").digest("hex");
}

/**
 * Opaque HMAC key for values that must NOT be normalized — case-sensitive
 * bearer material such as refresh tokens. Unlike accountKey, the input is
 * hashed byte-for-byte (no trim/lowercase). The output reveals nothing about
 * the input and is safe to send as a bucket key or session identifier.
 */
export function opaqueKey(value, hmacKey) {
  if (typeof value !== "string" || value === "") {
    throw new Error("opaqueKey requires a non-empty value.");
  }
  if (typeof hmacKey !== "string" || hmacKey === "") {
    throw new Error("opaqueKey requires a server-side HMAC key.");
  }
  return createHmac("sha256", hmacKey).update(value, "utf8").digest("hex");
}

/**
 * Record a provider-attempt outcome against the operation id claimed by
 * auth_admission_check. Drives the failure ladder (credential_failed) and
 * clears failure backoff on success (credential_succeeded / mfa_succeeded).
 * Never throws: outcome recording must not break the auth path.
 *
 * @param {object} args - { supabaseAdmin, operationId, outcome, accountKey }
 *   outcome: 'credential_failed' | 'credential_succeeded' | 'mfa_succeeded'
 *   accountKey: HMAC hex from accountKey()/opaqueKey(), or null
 * @returns {Promise<boolean>} true when the outcome is (now) recorded.
 */
export async function recordAttemptOutcome({ supabaseAdmin, operationId, outcome, accountKey = null }) {
  try {
    if (!supabaseAdmin) return false;
    if (typeof operationId !== "string" || operationId === "") return false;
    const { data, error } = await supabaseAdmin.rpc("auth_record_attempt_outcome", {
      p_operation_id: operationId,
      p_outcome: outcome,
      p_account_key: accountKey,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Check admission for an auth action.
 *
 * @param {{
 *   supabaseAdmin,            // service-role client with the RPC visible
 *   action: string,           // one of AUTH_ACTIONS values
 *   accountId?: string,        // raw identifier (email/user id); hashed here
 *   sessionId?: string,        // independently authenticated session id
 *                              // (verified claims session_id, or
 *                              // opaqueKey(refresh_token)); used AS-IS for
 *                              // session-kind buckets, never the account hash
 *   ip?: string,              // trusted deployment-derived IP
 *   operationId: string,      // idempotency key for failed-attempt recording
 *   env?: object,             // default process.env; AUTH_LIMITER_HMAC_KEY
 * }} args
 * @returns { allowed: boolean, retryAfterSeconds: number, backoffSeconds: number,
 *            limitName?: string, unavailable?: boolean }
 *   unavailable: true means the counter store failed — fail closed, do not
 *   call the provider, return a generic 503 upstream.
 *
 * L2-008: when the action's buckets REQUIRE an IP bucket and no trusted IP
 * is available, this returns unavailable (fail closed) instead of silently
 * dropping the IP bucket. A missing trusted IP means the deployment's
 * ingress policy is misconfigured; proceeding without the IP bucket would
 * silently weaken the limiter.
 */
export async function checkAdmission({
  supabaseAdmin,
  action,
  accountId = null,
  sessionId = null,
  ip = null,
  operationId,
  env = process.env,
}) {
  if (!supabaseAdmin) throw new Error("checkAdmission requires supabaseAdmin.");
  if (!Object.values(AUTH_ACTIONS).includes(action)) {
    throw new Error(`checkAdmission: unknown action "${action}".`);
  }
  if (typeof operationId !== "string" || operationId === "") {
    throw new Error("checkAdmission requires an operationId idempotency key.");
  }

  let accountKeyHex = null;
  if (accountId !== null && accountId !== undefined) {
    try {
      accountKeyHex = accountKey(accountId, requiredEnv(env, "AUTH_LIMITER_HMAC_KEY"));
    } catch {
      // Key misconfiguration or bad identifier: fail closed.
      return { allowed: false, retryAfterSeconds: 0, backoffSeconds: 0, unavailable: true };
    }
  }

  try {
    // Build positional keys + limits for the migration's
    // auth_admission_check(p_action, p_keys, p_limits, p_operation_id, p_now).
    const buckets = ACTION_BUCKETS[action];

    // L2-008: required IP buckets are never silently dropped. If any bucket
    // needs the IP and none is available, the deployment's trusted-ingress
    // policy is misconfigured — fail closed.
    const ipRequired = buckets.some((b) => b.kinds.some((k) => k === "ip" || k === "account_ip"));
    if (ipRequired && !ip) {
      return { allowed: false, retryAfterSeconds: 0, backoffSeconds: 0, unavailable: true };
    }

    const pKeys = [];
    const pLimits = [];
    for (const bucket of buckets) {
      const needsAccount = bucket.kinds.some((k) => k === "account" || k === "account_ip");
      // L2-008: 'credential' is the honest kind for per-credential abuse
      // buckets (HMAC of a presented rotating credential); it consumes the
      // sessionId slot (the caller passes the opaque credential digest).
      const needsSession = bucket.kinds.some((k) => k === "session" || k === "credential");
      const needsIp = bucket.kinds.some((k) => k === "ip" || k === "account_ip");
      if (needsAccount && !accountKeyHex) continue;
      if (needsSession && !sessionId) continue;
      if (needsIp && !ip) continue;
      const parts = [action, bucket.kinds.join("+")];
      if (needsAccount) parts.push(accountKeyHex);
      if (needsSession) parts.push(String(sessionId));
      if (needsIp) parts.push(ip);
      pKeys.push(parts.join(":"));
      pLimits.push({ capacity: bucket.capacity, window_seconds: bucket.windowSeconds });
    }
    if (pKeys.length === 0) {
      // No attributable key available: fail closed.
      return { allowed: false, retryAfterSeconds: 0, backoffSeconds: 0, unavailable: true };
    }
    const { data, error } = await supabaseAdmin.rpc("auth_admission_check", {
      p_action: action,
      p_keys: pKeys,
      p_limits: pLimits,
      p_operation_id: operationId,
      p_now: null,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") {
      throw new Error("auth_admission_check returned an unexpected shape.");
    }
    // In-band unavailability: fail closed even when the call succeeded.
    if (row.unavailable === true) {
      return { allowed: false, retryAfterSeconds: 0, backoffSeconds: 0, unavailable: true };
    }
    return {
      allowed: row.allowed,
      retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
      backoffSeconds: Number(row.backoff_seconds ?? 0),
      limitName: row.limit_name ?? undefined,
    };
  } catch {
    // No allow-on-error fallback: an unavailable store must produce zero
    // provider calls.
    return { allowed: false, retryAfterSeconds: 0, backoffSeconds: 0, unavailable: true };
  }
}
