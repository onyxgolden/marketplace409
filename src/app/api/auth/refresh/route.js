// POST /api/auth/refresh -- Layer 2 auth gateway: session refresh.
//
// Flow:
//   1. Validate {refresh_token, operationId}; 400 on malformed.
//   2. checkAdmission(refresh, ip). The user id is NOT known before the
//      provider validates the refresh token, and an unverified token must
//      never be decoded for account attribution — so admission here is keyed
//      on the trusted IP bucket only (see ACTION_BUCKETS.refresh).
//   3. Provider refreshSession via the server transport (no persistence).
//
// MULTI-TAB CONTRACT: the gateway is stateless and performs exactly one
// provider refresh per request. The client MUST coordinate refreshes across
// tabs with a single refresh leader per session family and bounded retries
// (the provider's rotation invalidates the old refresh token on use, so two
// tabs racing the same token will lose one race). The provider's replay
// protections apply; this route adds no extra rotation of its own.
// Already-issued tokens stay usable under their existing validity; only the
// refresh operation itself is admission-gated.

import { NextResponse } from "next/server";

import { createServerAuthClient } from "@/lib/auth/serverAuthTransport.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_REFRESH_FAILED,
  extractOperationId,
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
  const refreshToken =
    typeof body?.refresh_token === "string" && body.refresh_token !== "" ? body.refresh_token : null;
  if (!operationId || !refreshToken) {
    return NextResponse.json({ error: MESSAGE_INVALID_REQUEST }, { status: 400 });
  }

  const env = process.env;
  const ip = trustedClientIp(request, env);
  let supabaseAdmin;
  try {
    supabaseAdmin = createServerAuthClient(env);
  } catch {
    return NextResponse.json({ error: MESSAGE_REFRESH_FAILED }, { status: 500 });
  }

  // Fail closed before the provider call. accountId is null here by design:
  // the user id is established only by the provider validating the token.
  const gate = await gateAdmission({
    supabaseAdmin,
    action: AUTH_ACTIONS.REFRESH,
    accountId: null,
    ip,
    operationId,
    env,
  });
  if (!gate.allowed) return gate.response;

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    // Generic: same response for expired, revoked, or malformed tokens.
    return NextResponse.json({ error: MESSAGE_REFRESH_FAILED }, { status: 401 });
  }

  const response = NextResponse.json({ status: "ok", session: data.session });
  if (!isActivationEnabled(ACTIVATION_CONFIG)) markInert(response);
  return response;
}
