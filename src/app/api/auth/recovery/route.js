// POST /api/auth/recovery -- Layer 2 auth gateway: MFA recovery via
// one-time recovery codes.
//
// Actions:
//   {action:'initiate', access_token, operationId}
//     Requires a valid first-factor session. Returns nothing sensitive —
//     only an acknowledgement that a recovery code may now be presented.
//   {action:'complete', access_token, recovery_code, operationId}
//     Atomically consumes one recovery code (one concurrent winner via the
//     auth_recovery_consume/mfa_consume_recovery_code RPC), enters
//     RECOVERY_PENDING by setting the mfa_security_latch row, and revokes
//     the user's sessions through the narrow admin recovery adapter.
//     Returns {status:'recovery_pending'}.
//
// What recovery IS and IS NOT:
//   - IS permission to reset enrollment (re-enroll a real TOTP factor).
//   - IS NOT AAL2 and IS NOT workspace access. The recovery latch denies
//     even otherwise-valid tokens until the user enrolls and verifies a new
//     TOTP factor, at which point privileged access resumes through the
//     normal requireSecurityAssurance path.
//   - Consumed codes are NEVER restored, and the latch is never cleared
//     merely because a provider call failed (see partial-failure handling
//     below).
//
// With Layer 2 DISABLED this route does nothing at all (no code is consumed,
// no latch is set): it returns 501 with the inert label header. There is no
// "existing behavior" to pass through to — recovery is a Layer 2-only flow.

import { NextResponse } from "next/server";

import { adminRecoveryAdapter, createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import { consumeRecoveryCode } from "@/lib/auth/recoveryCodes.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_MFA_FAILED,
  MESSAGE_RECOVERY_FAILED,
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

  // Fail-closed admission before any provider call. Keyed on the trusted IP
  // bucket: the user id comes from the verified token, after admission.
  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.RECOVERY,
    accountId: null,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  // Fresh first factor required for both steps. The provider is the only
  // authority on the token; freshness is bounded by the provider's short
  // access-token lifetime (validated here, never decoded client-side).
  const verifiedUser = await verifiedUserFromToken(supabaseAdmin, accessToken);
  if (!verifiedUser) {
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }
  const userId = verifiedUser.id;

  if (action === INITIATE_ACTION) {
    // Nothing sensitive leaves here: the caller already holds a valid
    // first-factor session; this only acknowledges the recovery step.
    return NextResponse.json({ status: "recovery_initiated" });
  }

  // COMPLETE_ACTION: atomic consume first — one concurrent winner only.
  let consumed;
  let generationId;
  try {
    ({ consumed, generationId } = await consumeRecoveryCode(supabaseAdmin, userId, recoveryCode, operationId));
  } catch {
    // RPC/store failure: fail closed, generic message. The code may or may
    // not have been consumed server-side; never retry-restore it.
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 500 });
  }
  if (!consumed) {
    // Same generic response for wrong code, already-consumed code, wrong
    // generation, or wrong user: no oracle.
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 401 });
  }

  // Enter RECOVERY_PENDING: set the latch BEFORE any further provider call.
  // requireSecurityAssurance denies latched users independently of provider
  // revocation propagation, so the latch is the real guard.
  const { error: latchError } = await supabaseAdmin.from("mfa_security_latch").insert({
    user_id: userId,
    latched_at: new Date().toISOString(),
    reason: "recovery_code_consumed",
  });
  if (latchError) {
    // The code stays consumed (never restored). The user retries 'complete'
    // with a DIFFERENT unused code; that attempt will set the latch.
    console.error("Recovery latch set failed", { operationId });
    return NextResponse.json({ error: MESSAGE_RECOVERY_FAILED }, { status: 500 });
  }

  // Belt-and-braces: revoke provider sessions. If this fails, the latch
  // still denies old JWTs — report recovery_pending and reconcile later.
  try {
    await adminRecoveryAdapter(supabaseAdmin).revokeSessions(userId, operationId);
  } catch (error) {
    console.error("Recovery session revocation failed", { operationId, error });
  }

  // The lost factor is NOT deleted here: the user re-enrolls a real new TOTP
  // factor through /api/auth/mfa (action 'enroll' + 'verify') while
  // RECOVERY_PENDING; factor removal and generation invalidation happen as
  // part of that re-enrollment per the brief's sequence. This response is
  // NOT AAL2 and grants NO workspace access.
  return NextResponse.json({
    status: "recovery_pending",
    generation_id: generationId,
    message: "Enroll and verify a new authenticator before privileged access resumes.",
  });
}
