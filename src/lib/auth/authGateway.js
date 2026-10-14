// Client-side transport for the Layer 2 auth gateway routes.
//
// When ACTIVATION_CONFIG.enabled is true, credential flows go through the
// same-origin gateway routes (which apply the distributed admission limits,
// generic anti-enumeration errors, and MFA state handling server-side)
// instead of calling Supabase auth directly from the browser.
//
// ACTUAL ROUTE CONTRACTS (verified 2026-10-13 against the landed routes in
// src/app/api/auth/*/route.js and src/app/api/auth/_lib/gatewaySupport.js;
// reconciled with the pre-existing UI brief — see ROUTE GAPS below).
//
// Shared conventions:
// - Every POST body carries `operationId`: a client-generated UUID. The
//   gateway 400s on a missing/malformed id (UUID_RE in gatewaySupport.js),
//   so this module only ever sends crypto.randomUUID() output (with a
//   UUIDv4-shaped fallback for non-secure contexts).
// - Responses are `{ status: 'ok', ... }` on success or `{ error: "<generic>" }`
//   on failure, with HTTP semantics: 200 ok; 400 malformed; 401 auth failure;
//   403 mfa_required; 429 rate-limited (Retry-After header + `retryAfterSeconds`
//   body field); 503 admission store unavailable (ZERO provider calls made).
// - Error strings are generic server-side (anti-enumeration); the UI displays
//   them verbatim and never branches on their text.
//
// Per-route:
//   POST /api/auth/sign-in  { operationId, email, password }
//     -> 200 { status:'ok', session, cohort? }   (browser must establish the
//        session via supabase.auth.setSession(session))
//     -> 403 { status:'mfa_required', next:'enroll'|'challenge' } (NO session;
//        see ROUTE GAP 1)
//     -> 401 { error } | 429 { error, retryAfterSeconds } | 503 { error }
//   POST /api/auth/sign-up  { operationId, email, password }
//     -> 200 { status:'ok', message }  (message is SIGNUP_SUBMITTED_MESSAGE,
//        verbatim, for new/existing/confirmed/unconfirmed alike)
//     -> 4xx/5xx { error }
//     NOTE: the route currently ignores `emailRedirectTo` (see ROUTE GAP 4).
//   POST /api/auth/reset  { operationId, email }
//     -> 200 { status:'ok', message } ("Check your email for a secure
//        password-reset link.") | 4xx/5xx { error }
//     (Server-side redirectTo; the client MUST NOT send its own. Password
//     reset never touches MFA factors, recovery generations, or the latch.)
//   POST /api/auth/refresh  { operationId, refresh_token }
//     -> 200 { status:'ok', session } | 401 { error } | 429/503 { error }
//     (Multi-tab: the gateway does one provider refresh per request; the
//     CLIENT must elect a single refresh leader per session family.)
//   POST /api/auth/mfa  { operationId, access_token, action:'enroll' }
//     -> 200 { status:'ok', factor_id, qr_code, manual_key }
//        (qr_code is the provider-generated data URI — rendered client-side
//        in an <img>; no third-party QR service. Transient: never logged.)
//   POST /api/auth/mfa  { operationId, access_token, action:'challenge', factor_id }
//     -> 200 { status:'ok', challenge_id }
//   POST /api/auth/mfa  { operationId, access_token, action:'verify',
//                         factor_id, challenge_id, code }
//     -> 200 { status:'ok', session } (provider-issued AAL2; the browser
//        establishes it via setSession) | 401 { error } (wrong/expired code —
//        same generic response)
//   POST /api/auth/recovery  { operationId, access_token, action:'initiate' }
//     -> 200 { status:'recovery_initiated' } (requires a valid first-factor
//        session; the access_token IS the fresh first factor)
//   POST /api/auth/recovery  { operationId, access_token, action:'complete',
//                              recovery_code }
//     -> 200 { status:'recovery_pending', generation_id, message }
//        (RECOVERY_PENDING: permission to re-enroll, NOT AAL2, NOT workspace
//        access. With Layer 2 disabled the route 501s — recovery is L2-only.)
//
// ROUTE GAPS (flagged for the route builder; the UI degrades gracefully and
// does NOT invent workarounds):
//   GAP-1 (CLOSED 2026-10-14): POST /api/auth/sign-in now includes the AAL1
//     ceremony session in the 403 { status:'mfa_required' } response. It
//     grants no privileged access by itself — requireSecurityAssurance still
//     gates everything server-side — but the MFA page can establish it via
//     setSession and run the enroll/challenge ceremony.
//   GAP-2 (CLOSED 2026-10-14): the mfa issue_recovery_codes action generates
//     a generation and returns the plaintext codes ONCE after a newly
//     enrolled factor is verified.
//   GAP-3 (CLOSED 2026-10-14): the mfa list_factors action returns the
//     caller's own verified factors for challenge-mode discovery.
//   GAP-4: POST /api/auth/sign-up drops `emailRedirectTo` (invited-borrower
//     confirmation links won't carry ?next=&email=). Likely fix: pass
//     options.emailRedirectTo through to supabaseAdmin.auth.signUp.
//   GAP-5 (CLOSED 2026-10-14): the mfa status action reports the
//     server-side guard verdict { authorized, state, cohort } for a session,
//     so /auth routes sessions established outside the gateway sign-in
//     (e.g. ?code= exchange) to the MFA ceremony when required.

export function newOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // UUIDv4-shaped fallback for non-secure contexts (the gateway validates UUID format).
  const hex4 = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex4()}${hex4()}-${hex4()}-4${hex4().slice(1)}-${variant}${hex4().slice(1)}-${hex4()}${hex4()}${hex4()}`;
}

const GATEWAY_UNAVAILABLE_MESSAGE =
  "We couldn't reach the sign-in service. Check your connection and try again.";

async function postGateway(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    return { httpStatus: 0, transportError: GATEWAY_UNAVAILABLE_MESSAGE };
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    return { httpStatus: res.status, transportError: GATEWAY_UNAVAILABLE_MESSAGE };
  }
  const normalized = { httpStatus: res.status, ...(payload ?? {}) };
  if (typeof payload?.retryAfterSeconds === "number") {
    normalized.retryAfterSeconds = payload.retryAfterSeconds;
  } else {
    const header = res.headers?.get?.("Retry-After");
    if (header != null && header !== "") normalized.retryAfterSeconds = Number(header);
  }
  return normalized;
}

// The verbatim generic message for a result the UI can't otherwise classify.
// Callers display `result.error ?? result.transportError`.
export function gatewayErrorMessage(result) {
  return result?.error ?? result?.transportError ?? GATEWAY_UNAVAILABLE_MESSAGE;
}

export function gatewaySignIn({ operationId, email, password }) {
  return postGateway("/api/auth/sign-in", { operationId, email, password });
}

export function gatewaySignUp({ operationId, email, password, emailRedirectTo }) {
  return postGateway("/api/auth/sign-up", {
    operationId,
    email,
    password,
    ...(emailRedirectTo ? { emailRedirectTo } : {}),
  });
}

export function gatewayResetPassword({ operationId, email }) {
  // The route uses a server-side redirectTo; the client must not send its own.
  return postGateway("/api/auth/reset", { operationId, email });
}

export function gatewayRefresh({ operationId, refreshToken }) {
  return postGateway("/api/auth/refresh", { operationId, refresh_token: refreshToken });
}

export function gatewayMfaEnroll({ operationId, accessToken }) {
  return postGateway("/api/auth/mfa", { operationId, access_token: accessToken, action: "enroll" });
}

export function gatewayMfaChallenge({ operationId, accessToken, factorId }) {
  return postGateway("/api/auth/mfa", {
    operationId,
    access_token: accessToken,
    action: "challenge",
    factor_id: factorId,
  });
}

export function gatewayMfaListFactors({ operationId, accessToken }) {
  // Factor discovery for challenge mode: returns the user's own verified
  // factors (no secrets). Replaces the temporary ?factor_id= bridge.
  return postGateway("/api/auth/mfa", {
    operationId,
    access_token: accessToken,
    action: "list_factors",
  });
}

export function gatewayMfaStatus({ operationId, accessToken }) {
  // Lightweight MFA status for a session: { authorized, state, cohort }.
  // Used by /auth to route sessions established outside the gateway
  // sign-in to the MFA ceremony when required.
  return postGateway("/api/auth/mfa", {
    operationId,
    access_token: accessToken,
    action: "status",
  });
}

export function gatewayMfaVerify({ operationId, accessToken, factorId, challengeId, code }) {
  return postGateway("/api/auth/mfa", {
    operationId,
    access_token: accessToken,
    action: "verify",
    factor_id: factorId,
    challenge_id: challengeId,
    code,
  });
}

export function gatewayMfaIssueRecoveryCodes({ operationId, accessToken, factorId }) {
  // Called once after a newly enrolled factor is verified. Returns the 10
  // recovery codes in plaintext exactly once; the UI must display them with
  // a mandatory acknowledgement and never persist them.
  return postGateway("/api/auth/mfa", {
    operationId,
    access_token: accessToken,
    action: "issue_recovery_codes",
    factor_id: factorId,
  });
}

export function gatewayRecoveryInitiate({ operationId, accessToken }) {
  // The access_token IS the fresh first factor (validated server-side).
  return postGateway("/api/auth/recovery", { operationId, access_token: accessToken, action: "initiate" });
}

export function gatewayRecoveryComplete({ operationId, accessToken, recoveryCode }) {
  return postGateway("/api/auth/recovery", {
    operationId,
    access_token: accessToken,
    action: "complete",
    recovery_code: recoveryCode,
  });
}

/**
 * Read the current browser session's access token (for gateway calls that
 * require it: mfa enroll/challenge/verify, recovery initiate/complete).
 * Returns null when there is no session — callers show the signed-out state
 * instead of calling the gateway unauthenticated.
 */
export async function getBrowserAccessToken(supabase) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return typeof token === "string" && token !== "" ? token : null;
  } catch {
    return null;
  }
}
