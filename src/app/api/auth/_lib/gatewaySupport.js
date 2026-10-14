// Shared helpers for the Layer 2 auth gateway routes
// (src/app/api/auth/{sign-in,sign-up,reset,refresh,mfa,recovery}/route.js).
//
// Conventions every gateway route follows:
// - The request body must be JSON with a valid `operationId` (client-generated
//   UUIDv7/v4). Malformed bodies get 400; responses never carry stack traces.
// - Auth admission is checked BEFORE any provider call via checkAdmission()
//   from @/lib/auth/authRateLimit.js. A deny is 429 with a Retry-After header;
//   an unavailable counter store is a generic 503 with ZERO provider calls.
// - Secrets (passwords, codes, keys, tokens) are never logged. Logs carry at
//   most the operationId and a coarse outcome label.
// - Trusted client IP comes from a deployment-configured header name
//   (env TRUSTED_IP_HEADER, default "x-forwarded-for", first entry). Arbitrary
//   forwarded headers are UNTRUSTED: the deployment's trusted-proxy config
//   decides which header the edge may set; this code never trusts a value the
//   client could have supplied itself.
// - ACTIVATION_CONFIG.enabled === false means Layer 2 is inert: routes pass
//   through to existing provider behavior (no MFA gating, no latch/recovery
//   side effects) and mark every such response with the inert label header
//   below. This is the auditable "ships as inert code" state from the brief.

import { NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";
import { ACTIVATION_CONFIG, isMfaLayer2Activated } from "@/lib/auth/securityPolicy.js";
import { AUTH_ACTIONS, checkAdmission } from "@/lib/auth/authRateLimit.js";

export { ACTIVATION_CONFIG, AUTH_ACTIONS };

// Label header applied to every response produced while Layer 2 is inert.
// Any client or auditor reading this header knows the route did NOT enforce
// Layer 2 policy on this request.
export const INERT_HEADER_NAME = "x-forge-layer2";
export const INERT_HEADER_VALUE = "inert-disabled";

// Generic, non-enumerating response messages. Never include provider error
// text, user existence hints, or field-level detail in these.
export const MESSAGE_INVALID_REQUEST = "Invalid request.";
export const MESSAGE_SIGNIN_FAILED = "Sign-in failed. Check your email and password and try again.";
export const MESSAGE_RATE_LIMITED = "Too many attempts. Please wait and try again.";
export const MESSAGE_UNAVAILABLE = "Authentication is temporarily unavailable. Please try again later.";
export const MESSAGE_SIGNUP_FAILED = "Unable to process sign-up. Please try again later.";
export const MESSAGE_RESET_FAILED = "Unable to process the password-reset request. Please try again later.";
export const MESSAGE_REFRESH_FAILED = "Session refresh failed. Please sign in again.";
export const MESSAGE_MFA_FAILED = "Verification failed. Please try again.";
export const MESSAGE_RECOVERY_FAILED = "Recovery failed. Check your details and try again.";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isActivationEnabled(config = ACTIVATION_CONFIG) {
  return isMfaLayer2Activated(config);
}

export function markInert(response) {
  response.headers.set(INERT_HEADER_NAME, INERT_HEADER_VALUE);
  return response;
}

/** Read a JSON body; returns null when the body is missing or unparseable. */
export async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Extract and validate operationId. Returns the id string, or null when it
 * is missing/malformed (caller responds 400).
 */
export function extractOperationId(body) {
  const id = asNonEmptyString(body?.operationId);
  return id && UUID_RE.test(id.trim()) ? id.trim() : null;
}

export function extractEmail(body) {
  return asNonEmptyString(body?.email);
}

export function extractPassword(body) {
  return typeof body?.password === "string" && body.password !== "" ? body.password : null;
}

/**
 * Trusted client IP for limiter keying. Reads the deployment-configured
 * header (env TRUSTED_IP_HEADER, default "x-forwarded-for") and takes the
 * first entry. The deployment MUST strip/set this header at its trusted
 * edge; values arriving from anywhere else are attacker-controlled and this
 * code deliberately treats the configured header as the deployment's
 * attestation, not as a client claim.
 */
export function trustedClientIp(request, env = process.env) {
  const headerName = String(env?.TRUSTED_IP_HEADER ?? "x-forwarded-for").toLowerCase();
  const raw = request.headers.get(headerName);
  const first = raw ? raw.split(",")[0].trim() : "";
  return first || null;
}

/**
 * Fail-closed admission gate. Calls checkAdmission() and converts the result
 * into either { allowed: true } or { allowed: false, response } where the
 * response is a 429 (deny, with Retry-After) or a generic 503 (unavailable).
 * On any deny, the caller must make ZERO provider calls.
 */
export async function gateAdmission({ supabaseAdmin, action, accountId = null, ip = null, operationId, env = process.env }) {
  let decision;
  try {
    decision = await checkAdmission({ supabaseAdmin, action, accountId, ip, operationId, env });
  } catch {
    // checkAdmission throws only on programmer error (unknown action,
    // missing client/operationId); treat as unavailable rather than allowing.
    decision = { allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 };
  }

  if (decision.unavailable) {
    return {
      allowed: false,
      response: NextResponse.json({ error: MESSAGE_UNAVAILABLE }, { status: 503 }),
    };
  }
  if (!decision.allowed) {
    const retryAfter = Math.max(0, Number(decision.retryAfterSeconds ?? 0) || 0);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: MESSAGE_RATE_LIMITED, retryAfterSeconds: retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      ),
    };
  }
  return { allowed: true };
}

/**
 * User-scoped server client for provider MFA operations (enroll / challenge /
 * verify). Built with the ANON key — never the service-role key — and the
 * caller's verified access token, so the request carries exactly the user's
 * own authority and nothing more. No session persistence, no refresh.
 */
export function createUserScopedAuthClient(accessToken, env = process.env) {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("User-scoped auth client requires NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (typeof anonKey !== "string" || anonKey.trim() === "") {
    throw new Error("User-scoped auth client requires NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const client = createClient(url.trim(), anonKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // setSession attaches the user's access token to subsequent calls
  // (Authorization header) without persisting anything server-side.
  return client.auth.setSession({ access_token: accessToken, refresh_token: "" }).then(() => client);
}

/**
 * Validate a presented bearer access token against the provider and return
 * the verified user, or null. The only identity a route may act on is the
 * provider-verified one — never a user id from the request body.
 */
export async function verifiedUserFromToken(supabaseAdmin, accessToken) {
  if (typeof accessToken !== "string" || accessToken === "") return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data?.user?.id) return null;
    return data.user;
  } catch {
    return null;
  }
}
