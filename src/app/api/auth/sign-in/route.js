// POST /api/auth/sign-in -- Layer 2 auth gateway: password sign-in.
//
// Flow:
//   1. Validate {email, password, operationId}; 400 on malformed, no stack traces.
//   2. checkAdmission(password_signin, accountId=email, ip). Deny -> 429 with
//      Retry-After; unavailable counter -> generic 503 with ZERO provider calls.
//   3. Provider signInWithPassword via the server transport.
//   4. When Layer 2 is ACTIVATED: run requireSecurityAssurance on the fresh
//      session. A required-cohort session below AAL2 returns
//      {status:'mfa_required', next:'enroll'|'challenge'} and is NOT granted
//      privileged access. Unknown cohort fails closed (403).
//      When Layer 2 is DISABLED: pass through to existing behavior (the
//      provider session) with the inert label header; do NOT enforce.
//
// Enumeration discipline: wrong password and unknown email return the SAME
// 401 and the SAME generic message. The 400 shape check reveals nothing about
// account existence. Secrets (passwords) are never logged.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import { requireSecurityAssurance } from "@/lib/auth/requireSecurityAssurance.js";
import { accountKey, recordAttemptOutcome } from "@/lib/auth/authRateLimit.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_SIGNIN_FAILED,
  MESSAGE_UNAVAILABLE,
  claimExecution,
  extractEmail,
  extractOperationId,
  extractPassword,
  gateAdmission,
  isActivationEnabled,
  markInert,
  readJsonBody,
  trustedClientIp,
} from "../_lib/gatewaySupport.js";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await readJsonBody(request);
  const operationId = extractOperationId(body);
  const email = extractEmail(body);
  const password = extractPassword(body);
  if (!operationId || !email || !password) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    // Server misconfiguration: never leak the cause.
    return NextResponse.json({ error: MESSAGE_SIGNIN_FAILED }, { status: 500 });
  }

  // Fail-closed admission BEFORE any provider call.
  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.PASSWORD_SIGNIN,
    accountId: email,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  // L2-007: claim the execution lease BEFORE the provider call. A duplicate
  // in-flight request with the same operationId is denied the lease and
  // defers without executing signInWithPassword a second time.
  const ownerToken = randomUUID();
  const claim = await claimExecution({
    supabaseAdmin,
    operationId,
    ownerToken,
    context: { intent: "password_signin" },
  });
  if (!claim.granted) return claim.response;

  let data;
  let error;
  try {
    ({ data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password }));
  } catch {
    // Ambiguous provider outcome: reconcile before any refire.
    await recordAttemptOutcome({ supabaseAdmin, operationId, outcome: "uncertain", accountKey: null });
    return NextResponse.json({ error: MESSAGE_UNAVAILABLE }, { status: 503 });
  }

  // Drive the failure ladder / clear backoff. The account key is the
  // HMAC of the normalized email (pre-authentication attribution).
  let accountKeyHex = null;
  try {
    accountKeyHex = accountKey(email, env.AUTH_LIMITER_HMAC_KEY);
  } catch {
    // HMAC misconfiguration: outcome recording is skipped.
  }
  const recordOutcome = (outcome) =>
    recordAttemptOutcome({ supabaseAdmin, operationId, outcome, accountKey: accountKeyHex });

  if (error || !data?.session || !data?.user) {
    await recordOutcome("credential_failed");
    // Generic on purpose: identical response for bad password vs no-such-user.
    return NextResponse.json({ error: MESSAGE_SIGNIN_FAILED }, { status: 401 });
  }
  await recordOutcome("credential_succeeded");

  const session = data.session;
  const user = data.user;

  // Inert pass-through: existing behavior only, labeled, no MFA gating.
  if (!isActivationEnabled(ACTIVATION_CONFIG)) {
    return markInert(NextResponse.json({ status: "ok", session }));
  }

  // Layer 2 active: authoritative MFA gate on the fresh session. The
  // browser's own AAL reading guides UX only; this guard re-validates
  // server-side from the session token.
  const assurance = await requireSecurityAssurance({
    supabaseAdmin,
    user: { id: user.id },
    session,
  });

  if (assurance.authorized) {
    return NextResponse.json({ status: "ok", session, cohort: assurance.cohort });
  }

  // The AAL1 session is INCLUDED in the mfa_required response: it is the
  // ceremony token the user needs to enroll/challenge via /api/auth/mfa.
  // It grants NO privileged access — requireSecurityAssurance denies it on
  // every privileged surface until AAL2 (or grandfathering) is established.
  const ceremony = { status: "mfa_required", session };

  if (assurance.state === "ENROLL_REQUIRED") {
    // Required cohort, first factor only, no enrolled factor: the user must
    // enroll TOTP before privileged access. The session itself is withheld
    // from privileged surfaces (no session granted here).
    return NextResponse.json({ ...ceremony, next: "enroll" }, { status: 403 });
  }
  if (assurance.state === "CHALLENGE_REQUIRED") {
    return NextResponse.json({ ...ceremony, next: "challenge" }, { status: 403 });
  }

  // FIRST_FACTOR / RECOVERY_PENDING / unknown-cohort / invalid-session:
  // fail closed with the same non-enumerating shape.
  return NextResponse.json({ ...ceremony, next: "challenge" }, { status: 403 });
}
