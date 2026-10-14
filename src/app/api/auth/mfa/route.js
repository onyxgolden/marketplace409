// POST /api/auth/mfa -- Layer 2 auth gateway: TOTP enrollment / challenge / verify.
//
// Actions (all require a valid first-factor access_token; the provider is the
// only authority on that token):
//   {action:'enroll', access_token, operationId[, friendly_name]}
//     -> Supabase mfa.enroll(TOTP); returns the factor id, the QR code data
//        URI, and the manual key. These are TRANSIENT: returned once to the
//        caller, never logged, never persisted by this route.
//   {action:'challenge', access_token, factor_id, operationId}
//     -> Supabase mfa.challenge; returns {challenge_id}.
//   {action:'verify', access_token, factor_id, challenge_id, code, operationId}
//     -> Supabase mfa.verify; on success returns the provider-issued AAL2
//        session. An unverified factor grants nothing; a wrong/expired code
//        gets the same generic 401 as any other failure.
//
// Admission: mfa_challenge bucket for enroll/challenge, mfa_verify for verify
// (see AUTH_ACTIONS / ACTION_BUCKETS). Admission is keyed on the trusted IP
// bucket only: the user id is established by the provider validating the
// access token, which happens AFTER admission — decoding an unverified token
// for account attribution is forbidden, so per-account buckets cannot apply
// at this step.
//
// ACTIVATION_CONFIG: when disabled, this route still proxies the provider
// MFA operations (they exist natively) and marks the response with the inert
// label header. Layer 2 "enforcement" — AAL2 gating of privileged access —
// lives in requireSecurityAssurance, not here; this route never grants
// workspace access on its own.

import { NextResponse } from "next/server";

import { createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import { generateRecoveryCodes, storeRecoveryGeneration } from "@/lib/auth/recoveryCodes.js";
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
const CHALLENGE_ACTION = "challenge";
const VERIFY_ACTION = "verify";
const ISSUE_CODES_ACTION = "issue_recovery_codes";

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
  if (
    action !== ENROLL_ACTION &&
    action !== CHALLENGE_ACTION &&
    action !== VERIFY_ACTION &&
    action !== ISSUE_CODES_ACTION
  ) {
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

  // Issue one-time recovery codes after a newly enrolled factor is verified.
  // The factor must exist, belong to this user, and be in verified status;
  // codes are shown ONCE in this response and only digests are stored.
  if (action === ISSUE_CODES_ACTION) {
    const { data: factorsData, error: factorsError } =
      await supabaseAdmin.auth.admin.listFactors({ userId: verifiedUser.id });
    const factor = factorsData?.totp?.find((f) => f.id === factorId);
    if (factorsError || !factor || factor.status !== "verified") {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 403 });
    }
    const { codes } = generateRecoveryCodes();
    try {
      await storeRecoveryGeneration(supabaseAdmin, verifiedUser.id, codes, { env });
    } catch {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
    }
    // Plaintext codes leave this process only in this response, once.
    // They are never logged, never persisted, never returned again.
    return finalize({ status: "ok", recovery_codes: codes });
  }

  let userClient;
  try {
    userClient = await createUserScopedAuthClient(accessToken, env);
  } catch {
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
  }

  const finalize = (payload, status = 200) => {
    const response = NextResponse.json(payload, { status });
    if (!isActivationEnabled(ACTIVATION_CONFIG)) markInert(response);
    return response;
  };

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
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 401 });
  }
  // The provider issues the AAL2 session on a successful verify. Workspace
  // access still requires requireSecurityAssurance downstream; this response
  // grants no privileged access by itself.
  return finalize({ status: "ok", session: data.session ?? null });
}
