// POST /api/auth/sign-up -- Layer 2 auth gateway: sign-up.
//
// Flow:
//   1. Validate {email, password, operationId}; 400 on malformed.
//   2. checkAdmission(signup, accountId=email, ip). Deny -> 429 with
//      Retry-After; unavailable -> generic 503, zero provider calls.
//   3. Provider signUp via the server transport.
//   4. ALWAYS return SIGNUP_SUBMITTED_MESSAGE on success, verbatim — the same
//      response whether the email is new, already confirmed, or already
//      registered-but-unconfirmed. Showing a different message per case would
//      be an account-enumeration oracle (see useCredentialAuth.js).
//
// The message below is copied verbatim from SIGNUP_SUBMITTED_MESSAGE in
// src/lib/auth/useCredentialAuth.js (a "use client" module that a server route
// must not import); keep the two in sync if either changes.

import { NextResponse } from "next/server";

import { createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_SIGNUP_FAILED,
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

// Verbatim from src/lib/auth/useCredentialAuth.js SIGNUP_SUBMITTED_MESSAGE.
const SIGNUP_SUBMITTED_MESSAGE =
  "Thanks! If this is a new email, check your inbox to confirm your account. If you already have " +
  "an account with this email, you can sign in above instead, or use \"Forgot password?\" if you " +
  "don't remember your password.";

export async function POST(request) {
  const body = await readJsonBody(request);
  const operationId = extractOperationId(body);
  const email = extractEmail(body);
  const password = extractPassword(body);
  if (!operationId || !email || !password) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }
  // Optional emailRedirectTo for the invited-borrower flow (see
  // useCredentialAuth.js emailRedirectTo): must be a same-origin relative
  // path or absolute URL on the request's own origin. Anything else is
  // dropped (open-redirect protection); sign-up still succeeds.
  let emailRedirectTo = null;
  if (typeof body?.emailRedirectTo === "string" && body.emailRedirectTo !== "") {
    try {
      const reqUrl = new URL(request.url);
      const candidate = new URL(body.emailRedirectTo, reqUrl.origin);
      if (candidate.origin === reqUrl.origin) emailRedirectTo = candidate.toString();
    } catch {
      emailRedirectTo = null;
    }
  }

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    return NextResponse.json({ error: MESSAGE_SIGNUP_FAILED }, { status: 500 });
  }

  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.SIGNUP,
    accountId: email,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  const { error } = await supabaseAdmin.auth.signUp({
    email,
    password,
    ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
  });
  if (error) {
    // Generic: the success message must not depend on provider internals,
    // and provider errors must not leak account-existence hints.
    return NextResponse.json({ error: MESSAGE_SIGNUP_FAILED }, { status: 500 });
  }

  const response = NextResponse.json({ status: "ok", message: SIGNUP_SUBMITTED_MESSAGE });
  if (!isActivationEnabled(ACTIVATION_CONFIG)) markInert(response);
  return response;
}
