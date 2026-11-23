// POST /api/auth/reset -- Layer 2 auth gateway: password-reset request.
//
// Flow:
//   1. Validate {email, operationId}; 400 on malformed.
//   2. checkAdmission(reset_request, accountId=email, ip). Deny -> 429 with
//      Retry-After; unavailable -> generic 503, zero provider calls.
//   3. Provider resetPasswordForEmail via the server transport. The response
//      is generic either way (provider already avoids leaking existence).
//
// HARD INVARIANT (brief): a password reset NEVER clears MFA. Factor
// enrollment, recovery generations, and the recovery latch are untouched by
// this route; resetting the password does not disable, remove, or bypass
// any TOTP factor. Fresh password alone can never disable mandatory MFA.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_RESET_FAILED,
  extractCaptchaToken,
  extractEmail,
  extractOperationId,
  claimExecution,
  gateAdmission,
  isActivationEnabled,
  markInert,
  readJsonBody,
  requireHumanVerification,
  trustedClientIp,
} from "../_lib/gatewaySupport.js";

export const runtime = "nodejs";

const RESET_SUBMITTED_MESSAGE = "Check your email for a secure password-reset link.";

function resetRedirectTo(env) {
  const site = (env?.NEXT_PUBLIC_SITE_URL || "https://409marketplace.online").replace(/\/$/, "");
  return `${site}/auth/reset-password`;
}

export async function POST(request) {
  const body = await readJsonBody(request);
  const operationId = extractOperationId(body);
  const email = extractEmail(body);
  if (!operationId || !email) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }

  // Turnstile: when enabled, a missing challenge token is refused here —
  // before admission, lease, or any provider call. When disabled this is a
  // no-op and the route behaves exactly as before.
  const human = requireHumanVerification({ captchaToken: extractCaptchaToken(body) });
  if (!human.ok) return human.response;

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    return NextResponse.json({ error: MESSAGE_RESET_FAILED }, { status: 500 });
  }

  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.RESET_REQUEST,
    accountId: email,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  // L2-007: claim the execution lease BEFORE the provider call. A
  // duplicate in-flight request with the same operationId defers
  // without executing a second provider attempt.
  const claim = await claimExecution({
    supabaseAdmin,
    operationId,
    ownerToken: randomUUID(),
    context: { intent: "reset_request" },
  });
  if (!claim.granted) return claim.response;

  // MFA invariant: this call touches only the password credential. It does
  // not read, modify, or clear mfa_* tables, enrolled factors, or the
  // recovery latch.
  let error;
  try {
    // Provider is the verification authority for auth tokens (one verifier
    // per single-use token): the captchaToken is validated by Supabase once
    // dashboard CAPTCHA is enabled with the same site key. FORGE never
    // Siteverifies an auth token as well.
    ({ error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectTo(env),
      ...(human.captchaToken ? { captchaToken: human.captchaToken } : {}),
    }));
  } catch {
    // Ambiguous provider outcome: reconcile before any refire.
    return NextResponse.json({ error: MESSAGE_RESET_FAILED }, { status: 503 });
  }
  if (error) {
    return NextResponse.json({ error: MESSAGE_RESET_FAILED }, { status: 500 });
  }

  const response = NextResponse.json({ status: "ok", message: RESET_SUBMITTED_MESSAGE });
  if (!isActivationEnabled(ACTIVATION_CONFIG)) markInert(response);
  return response;
}
