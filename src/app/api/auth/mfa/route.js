// POST /api/auth/mfa -- Layer 2 auth gateway: TOTP enrollment / challenge / verify.
//
// Actions (all require a valid first-factor access_token; the provider is the
// only authority on that token):
//   {action:'enroll', access_token, operationId[, friendly_name]}
//     -> Supabase mfa.enroll(TOTP); returns the factor id, the QR code data
//        URI, and the manual key. These are TRANSIENT: returned once to the
//        caller, never logged, never persisted by this route.
//   {action:'list_factors', access_token, operationId}
//     -> the user's own VERIFIED factors (id, friendly_name, factor_type) for
//        challenge-mode discovery. No secrets, no unverified factors.
//   {action:'status', access_token, operationId}
//     -> the server-side requireSecurityAssurance verdict for this session:
//        { authorized, state, cohort }. Lets pages holding a session minted
//        outside the gateway sign-in (e.g. ?code= exchange) route AAL1
//        required-cohort sessions to the MFA ceremony.
//   {action:'challenge', access_token, factor_id, operationId}
//     -> Supabase mfa.challenge; returns {challenge_id}.
//   {action:'verify', access_token, factor_id, challenge_id, code, operationId}
//     -> Supabase mfa.verify; on success returns the provider-issued AAL2
//        session. An unverified factor grants nothing; a wrong/expired code
//        gets the same generic 401 as any other failure. When the user holds
//        a recovery latch, a successful verify COMPLETES the recovery: old
//        factors are deleted, recovery generations invalidated, the latch
//        cleared — the user must enroll and verify a real new TOTP factor
//        before privileged access resumes.
//   {action:'issue_recovery_codes', access_token, factor_id, operationId}
//     -> generates 10 one-time recovery codes after a newly enrolled factor
//        is verified; shown ONCE in the response, only digests stored.
//
// Admission is TWO-PHASE (L2-008):
//   Phase 1 (before token verification): mfa_challenge/mfa_verify buckets
//   keyed on the trusted IP only — decoding an unverified token for account
//   attribution is forbidden.
//   Phase 2 (after the provider validates the token): the same action's
//   buckets with the VERIFIED user id (account buckets) and the
//   independently authenticated session_id from the JWT claims (session
//   buckets, never the account hash).
// Provider-attempt outcomes are recorded (mfa_succeeded on verify) so the
// failure ladder advances and successes clear backoff.
//
// ACTIVATION_CONFIG: when disabled, this route still proxies the provider
// MFA operations (they exist natively) and marks the response with the inert
// label header. Layer 2 "enforcement" — AAL2 gating of privileged access —
// lives in requireSecurityAssurance, not here; this route never grants
// workspace access on its own.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  adminRecoveryAdapter,
  createServerAuthClient,
} from "@/lib/auth/serverAuthTransport.js";
import { generateRecoveryCodes, storeRecoveryGeneration } from "@/lib/auth/recoveryCodes.js";
import { accountKey, recordAttemptOutcome } from "@/lib/auth/authRateLimit.js";
import {
  requireSecurityAssurance,
  verifiedSessionClaims,
} from "@/lib/auth/requireSecurityAssurance.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_MFA_FAILED,
  createUserScopedAuthClient,
  extractOperationId,
  gateAdmission,
  isActivationEnabled,
  markInert,
  readJsonBody,
  trustedClientIp,
  verifiedUserFromToken,
} from "../_lib/gatewaySupport.js";

export const runtime = "nodejs";

const ENROLL_ACTION = "enroll";
const LIST_FACTORS_ACTION = "list_factors";
const CHALLENGE_ACTION = "challenge";
const VERIFY_ACTION = "verify";
const ISSUE_CODES_ACTION = "issue_recovery_codes";
const STATUS_ACTION = "status";

const MFA_ACTIONS = new Set([
  ENROLL_ACTION,
  LIST_FACTORS_ACTION,
  CHALLENGE_ACTION,
  VERIFY_ACTION,
  ISSUE_CODES_ACTION,
  STATUS_ACTION,
]);

export async function POST(request) {
  const body = await readJsonBody(request);
  const operationId = extractOperationId(body);
  const action = typeof body?.action === "string" ? body.action : null;
  const accessToken =
    typeof body?.access_token === "string" && body.access_token !== "" ? body.access_token : null;
  const factorId =
    typeof body?.factor_id === "string" && body.factor_id !== "" ? body.factor_id : null;
  const challengeId =
    typeof body?.challenge_id === "string" && body.challenge_id !== "" ? body.challenge_id : null;
  const code = typeof body?.code === "string" && body.code !== "" ? body.code : null;

  if (!operationId || !accessToken) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  if (!MFA_ACTIONS.has(action)) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  if (
    (action === CHALLENGE_ACTION || action === VERIFY_ACTION || action === ISSUE_CODES_ACTION) &&
    !factorId
  ) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  if (action === VERIFY_ACTION && (!challengeId || !code)) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
  }

  const finalize = (payload, status = 200) => {
    const response = NextResponse.json(payload, { status });
    if (!isActivationEnabled(ACTIVATION_CONFIG)) markInert(response);
    return response;
  };

  // Phase 1 admission: IP-keyed only (the user is not yet verified).
  const gate = await gateAdmission({
    supabaseAdmin,
    action: action === VERIFY_ACTION ? AUTH_ACTIONS.MFA_VERIFY : AUTH_ACTIONS.MFA_CHALLENGE,
    accountId: null,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  // The provider validates the session; only the verified user may proceed.
  const verifiedUser = await verifiedUserFromToken(supabaseAdmin, accessToken);
  if (!verifiedUser) {
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 401 });
  }
  const userId = verifiedUser.id;

  // Phase 2 admission: verified account + independently authenticated
  // session_id from the JWT claims (never the account hash, never an
  // unverified decode). Uses a derived operation id so the two phases are
  // separately accountable.
  const verifiedOperationId = `${operationId}:verified`;
  let sessionId = null;
  try {
    const claims = await verifiedSessionClaims(supabaseAdmin, accessToken, userId);
    if (claims && typeof claims.session_id === "string" && claims.session_id !== "") {
      sessionId = claims.session_id;
    }
  } catch {
    // getClaims failure: session bucket is skipped, account+IP still apply.
  }
  const gate2 = await gateAdmission({
    supabaseAdmin,
    action: action === VERIFY_ACTION ? AUTH_ACTIONS.MFA_VERIFY : AUTH_ACTIONS.MFA_CHALLENGE,
    accountId: userId,
    sessionId,
    ip,
    operationId: verifiedOperationId,
    env,
  });
  if (!gate2.allowed) return gate2.response;

  let accountKeyHex = null;
  try {
    accountKeyHex = accountKey(userId, env.AUTH_LIMITER_HMAC_KEY);
  } catch {
    // HMAC key misconfiguration: outcome recording is skipped, the request
    // itself was already admitted.
  }

  // Lightweight MFA status for sessions established outside the gateway
  // sign-in (e.g. a ?code= exchange landing an AAL1 session for a
  // required-cohort user). Runs the server-side guard and reports
  // { authorized, state, cohort } so the /auth page can route
  // ENROLL_REQUIRED/CHALLENGE_REQUIRED to /auth/mfa instead of blindly
  // redirecting to `next`. When Layer 2 is disabled the guard passes
  // through as authorized (inert).
  if (action === STATUS_ACTION) {
    const assurance = await requireSecurityAssurance({
      supabaseAdmin,
      user: { id: userId },
      session: { access_token: accessToken },
    });
    return finalize({
      status: "ok",
      authorized: assurance.authorized,
      state: assurance.state,
      cohort: assurance.cohort,
    });
  }

  // Factor discovery for challenge mode (GAP-3): the user's own verified
  // factors only — no secrets, no unverified factors, no other users.
  if (action === LIST_FACTORS_ACTION) {
    const { data, error } = await supabaseAdmin.auth.admin._listFactors({ userId });
    if (error) {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
    }
    const factors = (Array.isArray(data?.factors) ? data.factors : [])
      .filter((f) => f?.status === "verified")
      .map((f) => ({
        id: f.id,
        friendly_name: f.friendly_name ?? null,
        factor_type: f.factor_type ?? null,
        created_at: f.created_at ?? null,
      }));
    return finalize({ status: "ok", factors });
  }

  // Issue one-time recovery codes after a newly enrolled factor is verified.
  // The factor must exist, belong to this user, and be in verified status;
  // codes are shown ONCE in this response and only digests are stored.
  if (action === ISSUE_CODES_ACTION) {
    const { data: factorsData, error: factorsError } =
      await supabaseAdmin.auth.admin._listFactors({ userId });
    const factor = (Array.isArray(factorsData?.factors) ? factorsData.factors : []).find(
      (f) => f.id === factorId
    );
    if (factorsError || !factor || factor.status !== "verified") {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 403 });
    }
    const { codes } = generateRecoveryCodes();
    try {
      await storeRecoveryGeneration(supabaseAdmin, userId, codes, { env });
    } catch {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
    }
    // Plaintext codes leave this process only in this response, once.
    // They are never logged, never persisted, never returned again.
    return finalize({ status: "ok", recovery_codes: codes });
  }

  let userClient;
  try {
    userClient = createUserScopedAuthClient(accessToken, env);
  } catch {
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
  }

  if (action === ENROLL_ACTION) {
    const friendlyName =
      typeof body?.friendly_name === "string" && body.friendly_name.trim() !== ""
        ? body.friendly_name.trim().slice(0, 64)
        : "Authenticator app";
    const { data, error } = await userClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
    });
    if (error || !data?.id || !data?.totp?.qr_code || !data?.totp?.secret) {
      // Never log the secret/QR: generic message only.
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
    }
    // Transient by design: QR data URI + manual key leave this process only
    // in this response, once, to the authenticated user.
    return finalize({
      status: "ok",
      factor_id: data.id,
      qr_code: data.totp.qr_code,
      manual_key: data.totp.secret,
    });
  }

  if (action === CHALLENGE_ACTION) {
    const { data, error } = await userClient.auth.mfa.challenge({ factorId });
    if (error || !data?.id) {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 400 });
    }
    return finalize({ status: "ok", challenge_id: data.id });
  }

  // VERIFY_ACTION
  const { data, error } = await userClient.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  });
  if (error || !data) {
    // Same generic response for wrong code, expired challenge, or bad factor.
    // The failure ladder is driven by phase-2 admission accounting; no
    // explicit failure outcome is recorded here because a wrong TOTP code
    // is not a credential failure against the account buckets (the account
    // already proved its first factor to reach this step).
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 401 });
  }

  // Successful MFA clears applicable failure backoff (never refunds IP budgets).
  await recordAttemptOutcome({
    supabaseAdmin,
    operationId: verifiedOperationId,
    outcome: "mfa_succeeded",
    accountKey: accountKeyHex,
  });

  // L2-006: when the user holds a recovery latch, a successful verify of a
  // real new TOTP factor COMPLETES the recovery: delete the lost factors,
  // invalidate all recovery generations, clear the latch, and mark the
  // recovery operation completed. The latch is never cleared merely because
  // a provider call failed — only this verified ceremony clears it.
  try {
    const { data: latch } = await supabaseAdmin
      .from("mfa_security_latch")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (latch) {
      await completeRecoveryAfterVerify(supabaseAdmin, userId, factorId);
    }
  } catch {
    // Recovery completion is best-effort after the verify succeeded: the
    // latch still denies privileged access, and the user can retry the
    // ceremony. Never fail the verify response itself here.
  }

  // The provider issues the AAL2 session on a successful verify. Workspace
  // access still requires requireSecurityAssurance downstream; this response
  // grants no privileged access by itself.
  return finalize({ status: "ok", session: data.session ?? null });
}

/**
 * Complete a latched recovery after the user verified a real new TOTP
 * factor: remove every OTHER verified factor (the lost ones), invalidate
 * all recovery generations, clear the latch, and mark latched recovery
 * operations completed. Audited under a fresh audit id.
 */
async function completeRecoveryAfterVerify(supabaseAdmin, userId, newFactorId) {
  const auditId = randomUUID();
  const adapter = adminRecoveryAdapter(supabaseAdmin);

  const { data: factorsData, error: factorsError } =
    await supabaseAdmin.auth.admin._listFactors({ userId });
  if (factorsError) throw factorsError;
  const factors = Array.isArray(factorsData?.factors) ? factorsData.factors : [];
  for (const factor of factors) {
    if (factor?.id && factor.id !== newFactorId && factor.status === "verified") {
      await adapter.deleteFactor(userId, factor.id, auditId);
    }
  }

  const { error: genError } = await supabaseAdmin
    .from("mfa_recovery_generations")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("invalidated_at", null);
  if (genError) throw genError;

  const { error: opError } = await supabaseAdmin
    .from("mfa_recovery_operations")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "latched");
  if (opError) throw opError;

  const { error: latchError } = await supabaseAdmin
    .from("mfa_security_latch")
    .delete()
    .eq("user_id", userId);
  if (latchError) throw latchError;
}
