// POST /api/auth/recovery -- Layer 2 auth gateway: MFA recovery via
// one-time recovery codes.
//
// Actions:
//   {action:'initiate', access_token, operationId}
//     Requires a valid first-factor session. Returns nothing sensitive —
//     only an acknowledgement that a recovery code may now be presented.
//   {action:'complete', access_token, recovery_code, operationId}
//     Requires a FRESH first-factor ceremony (claims.iat within the fresh
//     window — a current refreshed access token is NOT evidence of one).
//     Atomically consumes one recovery code AND enters RECOVERY_PENDING via
//     the mfa_consume_recovery_code RPC (consume + latch + operation row +
//     audit row + grandfather-registry deletion in ONE transaction; one
//     concurrent winner only), then revokes the user's sessions through the
//     narrow admin recovery adapter (JWT-based; the latch is the real guard
//     while revocation propagates). Returns {status:'recovery_pending'}.
//     Failures are generic and identical (no oracle): wrong code,
//     already-consumed code, wrong generation, wrong user, or mismatched
//     replay all answer the same 401.
//
// What recovery IS and IS NOT:
//   - IS permission to reset enrollment (re-enroll a real TOTP factor).
//   - IS NOT AAL2 and IS NOT workspace access. The recovery latch denies
//     even otherwise-valid tokens until the user enrolls and verifies a new
//     TOTP factor (via /api/auth/mfa verify, which completes the recovery),
//     at which point privileged access resumes through the normal
//     requireSecurityAssurance path.
//   - Consumed codes are NEVER restored, and the latch is never cleared
//     merely because a provider call failed.
//
// Admission is TWO-PHASE (L2-008): IP-keyed before token verification, then
// verified account + session_id from the JWT claims before the consume.
//
// With Layer 2 DISABLED this route does nothing at all (no code is consumed,
// no latch is set): it returns 501 with the inert label header. There is no
// "existing behavior" to pass through to — recovery is a Layer 2-only flow.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { adminRecoveryAdapter, createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import { consumeRecoveryCode } from "@/lib/auth/recoveryCodes.js";
import { freshFirstFactorAt, verifiedSessionClaims } from "@/lib/auth/requireSecurityAssurance.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_RECOVERY_FAILED,
  claimExecution,
  extractOperationId,
  gateAdmission,
  isActivationEnabled,
  markInert,
  readJsonBody,
  trustedClientIp,
  verifiedUserFromToken,
} from "../_lib/gatewaySupport.js";

export const runtime = "nodejs";

const INITIATE_ACTION = "initiate";
const COMPLETE_ACTION = "complete";

// A first-factor ceremony counts as "fresh" for recovery when the
// validated JWT was issued within this window. A refreshed access token
// (old iat, rotated by the provider) is NOT evidence of a fresh ceremony —
// the user must sign in again with their password.
const FRESH_FIRST_FACTOR_MAX_AGE_SECONDS = 600;
// Small allowance for clock skew between the token issuer and this server;
// anything further in the future is refused, not clamped.
const CLOCK_SKEW_SECONDS = 60;

export async function POST(request) {
  const body = await readJsonBody(request);
  const operationId = extractOperationId(body);
  const action = typeof body?.action === "string" ? body.action : null;
  const accessToken =
    typeof body?.access_token === "string" && body.access_token !== "" ? body.access_token : null;
  const recoveryCode =
    typeof body?.recovery_code === "string" && body.recovery_code !== "" ? body.recovery_code : null;

  if (!operationId || !accessToken) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  if (action !== INITIATE_ACTION && action !== COMPLETE_ACTION) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  if (action === COMPLETE_ACTION && !recoveryCode) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }

  // Recovery is a Layer 2-only flow: with activation disabled there is
  // nothing to pass through to, so fail inertly before any side effect.
  if (!isActivationEnabled(ACTIVATION_CONFIG)) {
    return markInert(
      NextResponse.json(
        { status: "recovery_disabled", error: MESSAGE_RECOVERY_FAILED },
        { status: 501 }
      )
    );
  }

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 500 });
  }

  // Phase 1 admission: IP-keyed only (the user is not yet verified).
  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.RECOVERY,
    accountId: null,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  // The provider is the only authority on the token.
  const verifiedUser = await verifiedUserFromToken(supabaseAdmin, accessToken);
  if (!verifiedUser) {
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }
  const userId = verifiedUser.id;

  // Independently validated claims, bound to the verified user.
  const claims = await verifiedSessionClaims(supabaseAdmin, accessToken, userId);
  if (!claims) {
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }
  const sessionId =
    typeof claims.session_id === "string" && claims.session_id !== "" ? claims.session_id : null;

  // Phase 2 admission: verified account + authenticated session.
  const verifiedOperationId = `${operationId}:verified`;
  const gate2 = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.RECOVERY,
    accountId: userId,
    sessionId,
    ip,
    operationId: verifiedOperationId,
    env,
  });
  if (!gate2.allowed) return gate2.response;

  if (action === INITIATE_ACTION) {
    // Nothing sensitive leaves here: the caller already holds a valid
    // first-factor session; this only acknowledges the recovery step.
    return NextResponse.json({ status: "recovery_initiated" });
  }

  // COMPLETE_ACTION: require a FRESH first-factor ceremony bound to THIS
  // session. L2-006: the clock is the AMR first-factor method timestamps
  // (the actual auth ceremony), NOT claims.iat (token issuance — a
  // refreshed token carries an old iat and proves nothing). A current iat
  // with a day-old password AMR does NOT consume. Missing AMR, missing
  // timestamps, or timestamps in the future are all refused.
  const firstFactorAt = freshFirstFactorAt(claims);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    firstFactorAt === null ||
    firstFactorAt > nowSeconds + CLOCK_SKEW_SECONDS ||
    nowSeconds - firstFactorAt > FRESH_FIRST_FACTOR_MAX_AGE_SECONDS
  ) {
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }

  // L2-007: claim the execution lease BEFORE the consume RPC. A duplicate
  // in-flight request with the same verified operation id defers without
  // executing a second consume attempt. The consume RPC itself is also
  // atomic (one concurrent winner), but the lease is the HTTP-level fence.
  const claim = await claimExecution({
    supabaseAdmin,
    operationId: verifiedOperationId,
    ownerToken: randomUUID(),
    context: { intent: "recovery_consume" },
  });
  if (!claim.granted) return claim.response;

  // Atomic consume + RECOVERY_PENDING entry (one transaction, one concurrent
  // winner). There is NO separate latch insert and NO "use a different
  // code" retry path: the RPC either commits consume+latch together or
  // reports consumed=false.
  const auditId = randomUUID();
  let consumed;
  let generationId;
  try {
    ({ consumed, generationId } = await consumeRecoveryCode(supabaseAdmin, userId, recoveryCode, operationId, {
      auditId,
      env,
    }));
  } catch {
    // RPC/store failure: fail closed, generic message. The code may or may
    // not have been consumed server-side; never retry-restore it.
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 500 });
  }
  if (!consumed) {
    // Same generic response for wrong code, already-consumed code, wrong
    // generation, wrong user, or mismatched replay: no oracle.
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }

  // Belt-and-braces: revoke provider sessions with the user's own JWT. The
  // locked SDK has no by-user-id revocation; if revocation fails, the latch
  // (set atomically above) still denies old JWTs — report recovery_pending
  // and reconcile later. Never log raw provider errors.
  try {
    await adminRecoveryAdapter(supabaseAdmin).revokeSessions(accessToken, userId, auditId);
  } catch {
    // Coarse label only — no provider error text, no token material.
    console.error("Recovery session revocation failed", { operationId });
  }

  // The lost factor is NOT deleted here: the user re-enrolls a real new TOTP
  // factor through /api/auth/mfa (action 'enroll' + 'verify') while
  // RECOVERY_PENDING; factor removal, generation invalidation, and latch
  // clearance happen as part of that verified re-enrollment. This response
  // is NOT AAL2 and grants NO workspace access.
  return NextResponse.json({
    status: "recovery_pending",
    generation_id: generationId,
    message: "Enroll and verify a new authenticator before privileged access resumes.",
  });
}
