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
  freshFirstFactorAt,
  freshSecondFactorAt,
  requireSecurityAssurance,
  verifiedAal2,
  verifiedSessionClaims,
} from "@/lib/auth/requireSecurityAssurance.js";
import {
  AUTH_ACTIONS,
  ACTIVATION_CONFIG,
  MESSAGE_INVALID_REQUEST,
  MESSAGE_MFA_FAILED,
  MESSAGE_UNAVAILABLE,
  claimExecution,
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

// L2-004 (round 3): recovery-code issuance binds to a RECENT second-factor
// ceremony — the session's AMR second-factor event timestamp and the factor
// creation must both be this fresh. claims.iat is never the ceremony clock.
const RECOVERY_ISSUE_MAX_AGE_SECONDS = 600;

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

  // Phase 1 admission: L2-008 pre-verification abuse reservation. The user
  // is not yet verified, so this debits ONLY a small separate IP namespace
  // (mfa_{challenge,verify}_pre) — deliberately NOT the full verified
  // budget, so one MFA operation does not double-charge the IP budget
  // across its two admission phases. The full budget (account + ip +
  // session) is debited exactly once, in phase 2.
  const gate = await gateAdmission({
    supabaseAdmin,
    action: action === VERIFY_ACTION ? AUTH_ACTIONS.MFA_VERIFY_PRE : AUTH_ACTIONS.MFA_CHALLENGE_PRE,
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
  // L2-004 (round 3): issuance requires VERIFIED RECENT SECOND-FACTOR
  // AUTHORITY bound to THIS session — a recent second-factor AMR event
  // (the actual MFA ceremony clock), not claims.iat. An AAL1 session for
  // an existing verified factor is NOT enough, and neither is a stale
  // AAL2 session whose token was merely refreshed: iat records JWT
  // issuance, not when MFA last completed. The recently created verified
  // factor binds the issuance to the enrollment ceremony. The generation
  // replacement itself is one atomic transaction
  // (mfa_replace_recovery_generation).
  if (action === ISSUE_CODES_ACTION) {
    const { data: factorsData, error: factorsError } =
      await supabaseAdmin.auth.admin._listFactors({ userId });
    const factor = (Array.isArray(factorsData?.factors) ? factorsData.factors : []).find(
      (f) => f.id === factorId
    );
    if (factorsError || !factor || factor.status !== "verified") {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 403 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    let issueClaims = null;
    try {
      issueClaims = await verifiedSessionClaims(supabaseAdmin, accessToken, userId);
    } catch {
      issueClaims = null;
    }
    // The MFA ceremony receipt: the latest second-factor AMR timestamp
    // bound to this session. Missing/future/stale second-factor events
    // refuse — iat is NEVER the ceremony clock.
    const secondFactorAt = freshSecondFactorAt(issueClaims);
    const secondFactorFresh =
      Number.isFinite(secondFactorAt) &&
      secondFactorAt <= nowSeconds + 60 &&
      nowSeconds - secondFactorAt >= 0 &&
      nowSeconds - secondFactorAt <= RECOVERY_ISSUE_MAX_AGE_SECONDS;
    const claimsFresh = issueClaims && verifiedAal2(issueClaims) && secondFactorFresh;
    const factorCreatedAt = factor.created_at ? Date.parse(factor.created_at) / 1000 : NaN;
    const factorFresh =
      Number.isFinite(factorCreatedAt) &&
      nowSeconds - factorCreatedAt <= RECOVERY_ISSUE_MAX_AGE_SECONDS &&
      nowSeconds - factorCreatedAt >= 0;
    if (!claimsFresh || !factorFresh) {
      // Generic: no oracle distinguishing "not AAL2" from "stale ceremony".
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

  // L2-007: claim the execution lease BEFORE any provider MFA call. The
  // lease is bound to the phase-2 (verified) operation id; a duplicate
  // in-flight request defers without executing a second provider attempt.
  // Read-only actions (status, list_factors) and code issuance (atomic via
  // its own generation RPC) do not take the lease.
  if (action === ENROLL_ACTION || action === CHALLENGE_ACTION || action === VERIFY_ACTION) {
    const claim = await claimExecution({
      supabaseAdmin,
      operationId: verifiedOperationId,
      ownerToken: randomUUID(),
      context: { intent: `mfa_${action}`, factor_id: factorId },
    });
    if (!claim.granted) return claim.response;
  }

  if (action === ENROLL_ACTION) {
    const friendlyName =
      typeof body?.friendly_name === "string" && body.friendly_name.trim() !== ""
        ? body.friendly_name.trim().slice(0, 64)
        : "Authenticator app";
    let enrollData;
    let enrollError;
    try {
      ({ data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      }));
    } catch {
      await recordAttemptOutcome({
        supabaseAdmin,
        operationId: verifiedOperationId,
        outcome: "uncertain",
        accountKey: accountKeyHex,
      });
      return NextResponse.json({ error: MESSAGE_UNAVAILABLE }, { status: 503 });
    }
    if (enrollError || !enrollData?.id || !enrollData?.totp?.qr_code || !enrollData?.totp?.secret) {
      // Never log the secret/QR: generic message only.
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 500 });
    }
    // Transient by design: QR data URI + manual key leave this process only
    // in this response, once, to the authenticated user.
    return finalize({
      status: "ok",
      factor_id: enrollData.id,
      qr_code: enrollData.totp.qr_code,
      manual_key: enrollData.totp.secret,
    });
  }

  if (action === CHALLENGE_ACTION) {
    let challengeData;
    let challengeError;
    try {
      ({ data: challengeData, error: challengeError } = await userClient.auth.mfa.challenge({ factorId }));
    } catch {
      await recordAttemptOutcome({
        supabaseAdmin,
        operationId: verifiedOperationId,
        outcome: "uncertain",
        accountKey: accountKeyHex,
      });
      return NextResponse.json({ error: MESSAGE_UNAVAILABLE }, { status: 503 });
    }
    if (challengeError || !challengeData?.id) {
      return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 400 });
    }
    return finalize({ status: "ok", challenge_id: challengeData.id });
  }

  // VERIFY_ACTION
  let verifyData;
  let verifyError;
  try {
    ({ data: verifyData, error: verifyError } = await userClient.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    }));
  } catch {
    // Ambiguous provider outcome: reconcile before any refire.
    await recordAttemptOutcome({
      supabaseAdmin,
      operationId: verifiedOperationId,
      outcome: "uncertain",
      accountKey: accountKeyHex,
    });
    return NextResponse.json({ error: MESSAGE_UNAVAILABLE }, { status: 503 });
  }
  if (verifyError || !verifyData) {
    // L2-007/L2-008: wrong/expired codes ARE recorded — they drive the MFA
    // failure/backoff ladder. Same generic 401 to the caller (no oracle).
    await recordAttemptOutcome({
      supabaseAdmin,
      operationId: verifiedOperationId,
      outcome: "mfa_failed",
      accountKey: accountKeyHex,
    });
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 401 });
  }
  const data = verifyData;

  // L2-006B: validate the COMPLETE usable provider verification response
  // BEFORE success accounting or any recovery side effect. An error-free
  // but malformed response is not verification authority: it must carry a
  // real session token AND bind the returned user to the verified caller
  // (and, when the provider reports an assurance level, it must be AAL2).
  // A rejected verify performs ZERO recovery mutation — no mfa_succeeded,
  // no latch resolution, no factor deletion, no finalize.
  const responseUser =
    data !== null && typeof data === "object" && data.user !== null && typeof data.user === "object"
      ? data.user
      : null;
  const responseAal =
    typeof responseUser?.aal === "string" ? responseUser.aal.toLowerCase() : null;
  const verifyUsable =
    data !== null &&
    typeof data === "object" &&
    typeof data.access_token === "string" &&
    data.access_token !== "" &&
    responseUser !== null &&
    responseUser.id === userId &&
    (responseAal === null || responseAal === "aal2");
  if (!verifyUsable) {
    // A malformed/error-free response is a failed verify for the failure
    // ladder — same generic 401, no success accounting.
    await recordAttemptOutcome({
      supabaseAdmin,
      operationId: verifiedOperationId,
      outcome: "mfa_failed",
      accountKey: accountKeyHex,
    });
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
  // NEW TOTP factor COMPLETES the recovery through the phased, resumable
  // completion workflow (begin -> mark_factors_removed -> finalize). The
  // first-factor clock is the AMR ceremony timestamp bound to this
  // session, never claims.iat. Partial failure is NEVER reported as ok:
  // the response carries the completion disposition and the latch still
  // denies privileged access until the completion commits.
  let recoveryCompletion = null;
  try {
    const { data: latch } = await supabaseAdmin
      .from("mfa_security_latch")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (latch) {
      let verifyClaims = null;
      try {
        verifyClaims = await verifiedSessionClaims(supabaseAdmin, accessToken, userId);
      } catch {
        verifyClaims = null;
      }
      const firstFactorAt = verifyClaims ? freshFirstFactorAt(verifyClaims) : null;
      recoveryCompletion = await completeRecoveryAfterVerify(supabaseAdmin, {
        userId,
        newFactorId: factorId,
        firstFactorAtMs: firstFactorAt === null ? NaN : firstFactorAt * 1000,
      });
    }
  } catch (err) {
    // Infrastructure failure during completion: the operation stays
    // resumable. Report it; never claim a completed recovery.
    recoveryCompletion = { completed: false, reason: "completion infrastructure failure" };
  }

  // L2-003: the locked SDK's mfa.verify returns the session tokens at
  // data's TOP LEVEL (access_token, refresh_token, expires_in, user) —
  // there is NO data.session. The response was already validated as
  // complete and usable above, so this adaptation cannot produce a null
  // session; the shape check stays as defense in depth.
  const session =
    data && typeof data.access_token === "string" && data.access_token !== ""
      ? {
          access_token: data.access_token,
          refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : null,
          expires_in: typeof data.expires_in === "number" ? data.expires_in : null,
          expires_at: typeof data.expires_at === "number" ? data.expires_at : null,
          token_type: typeof data.token_type === "string" ? data.token_type : "bearer",
          user: data.user ?? null,
        }
      : null;
  if (!session) {
    await recordAttemptOutcome({
      supabaseAdmin,
      operationId: verifiedOperationId,
      outcome: "mfa_failed",
      accountKey: accountKeyHex,
    });
    return NextResponse.json({ error: MESSAGE_MFA_FAILED }, { status: 401 });
  }

  // The provider issues the AAL2 session on a successful verify. Workspace
  // access still requires requireSecurityAssurance downstream; this response
  // grants no privileged access by itself. When a recovery latch was
  // present, the recovery disposition is included — a failed completion is
  // resumable via another verify ceremony, and the latch still denies
  // privileged access until it commits.
  return finalize({
    status: "ok",
    session,
    ...(recoveryCompletion ? { recovery: recoveryCompletion } : {}),
  });
}

/**
 * Complete a latched recovery after the user verified a NEW TOTP factor.
 * L2-006 boundaries:
 *  (a) fresh first-factor event: firstFactorAtMs is the AMR-derived ceremony
 *      timestamp bound to this session (never claims.iat); missing/future/
 *      stale timestamps refuse.
 *  (b) NEW factor binding: newFactorId must be a verified TOTP factor OWNED
 *      by the user and CREATED AFTER the recovery operation started.
 *      Verifying the OLD lost factor does NOT complete the recovery.
 *  (c) terminal replay: completed/failed operations replay their
 *      disposition — never re-latched, never re-deleted.
 *  (d) durable phased transitions via mfa_recovery_{begin_completion,
 *      mark_factors_removed, finalize}: provider factor deletion is
 *      idempotent on retry (the new factor is never deleted); a crash
 *      resumes from the last committed phase. NEVER returns
 *      { completed: true } after a partial failure.
 *
 * L2-006A (round 3) — fenced completion: the chosen new factor id plus a
 * fenced (owner, generation) pair are persisted atomically on the
 * recovery operation by mfa_recovery_begin_completion BEFORE any provider
 * deletion. Every phase call presents the fence lineage begin returned;
 * stale lineages are refused by the RPCs. A competing ceremony with a
 * different chosen factor is refused while the claim stands (never two
 * completions deleting each other's factors). A same-factor resume
 * re-enters under the fence. An older operation is refused when a newer
 * non-terminal operation exists — it can never delete factors or clear a
 * newer latch. Before atomic finalize, the chosen factor is revalidated
 * (still verified); on revalidation failure the claim is released so a
 * later ceremony is not wedged.
 *
 * Returns { completed: true, operationId } or
 * { completed: false, reason, operationId? }.
 */
async function completeRecoveryAfterVerify(supabaseAdmin, { userId, newFactorId, firstFactorAtMs }) {
  const nowMs = Date.now();
  if (!Number.isFinite(firstFactorAtMs) || firstFactorAtMs > nowMs + 60000) {
    return { completed: false, reason: "first-factor event missing or in the future" };
  }
  if (nowMs - firstFactorAtMs > FRESH_FIRST_FACTOR_MAX_AGE_MS) {
    return { completed: false, reason: "first-factor event is stale" };
  }

  // Resolve the user's latest recovery operation (terminal replays
  // short-circuit below). The latch row itself proves RECOVERY_PENDING.
  const { data: latch, error: latchError } = await supabaseAdmin
    .from("mfa_security_latch")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (latchError) throw latchError;
  if (!latch) return { completed: false, reason: "no recovery latch" };

  const { data: opRow, error: opError } = await supabaseAdmin
    .from("mfa_recovery_operations")
    .select("id, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (opError) throw opError;

  // (c) Terminal replay: completed/failed operations replay their
  // disposition — never re-latch, never delete, never report a fresh ok.
  if (opRow && (opRow.status === "completed" || opRow.status === "failed")) {
    return { completed: opRow.status === "completed", operationId: opRow.id, replayed: true };
  }
  const operationId =
    opRow && opRow.status !== "completed" && opRow.status !== "failed"
      ? opRow.id
      : `recovery_${randomUUID()}`;
  // The operation's authoritative start for the new-factor binding. For an
  // existing operation this is the stored created_at (immutable); for a
  // freshly minted one begin() stamps it ~now, so the estimate is exact
  // enough that no claim is ever persisted for a failing binding.
  const estimatedOpStartMs =
    opRow && opRow.created_at ? Date.parse(opRow.created_at) : nowMs;

  // (b) NEW factor binding BEFORE begin: verified TOTP, owned by the user,
  // created AFTER the recovery operation started. The old lost factor
  // fails this binding. Binding before begin means a failing factor never
  // persists a fence claim (no poisoned operation).
  const { data: factorsData, error: factorsError } =
    await supabaseAdmin.auth.admin._listFactors({ userId });
  if (factorsError) throw factorsError;
  const factors = Array.isArray(factorsData?.factors) ? factorsData.factors : [];
  const newFactor = factors.find((f) => f?.id === newFactorId);
  const newFactorCreatedAtMs = newFactor?.created_at ? Date.parse(newFactor.created_at) : NaN;
  const newFactorType = String(newFactor?.factor_type ?? newFactor?.type ?? "").toLowerCase();
  if (
    !newFactor ||
    newFactor.status !== "verified" ||
    newFactorType !== "totp" ||
    !Number.isFinite(newFactorCreatedAtMs) ||
    !Number.isFinite(estimatedOpStartMs) ||
    newFactorCreatedAtMs <= estimatedOpStartMs
  ) {
    return { completed: false, reason: "new-factor binding failed", operationId };
  }

  // L2-006A: fence the completion BEFORE any provider deletion. The RPC
  // persists (chosen_factor_id, completion_owner, completion_generation)
  // atomically under the operation row lock and refuses a competing
  // ceremony (different chosen factor) or a stale operation (a newer
  // non-terminal operation exists). The returned fence lineage must be
  // presented on every subsequent phase call.
  const completionOwner = randomUUID();
  const auditId = randomUUID();
  const { data: beginRows, error: beginError } = await supabaseAdmin.rpc(
    "mfa_recovery_begin_completion",
    {
      p_user_id: userId,
      p_operation_id: operationId,
      p_audit_id: auditId,
      p_chosen_factor_id: newFactorId,
      p_completion_owner: completionOwner,
    }
  );
  if (beginError) throw beginError;
  const beginRow = Array.isArray(beginRows) ? beginRows[0] : beginRows;
  if (!beginRow) throw new Error("mfa_recovery_begin_completion returned no row.");
  if (beginRow.terminal) {
    return {
      completed: beginRow.status === "completed",
      operationId,
      replayed: true,
    };
  }
  if (beginRow.refused) {
    // Another ceremony owns this completion (different chosen factor), or
    // a newer recovery operation supersedes this one. Zero side effects:
    // no deletions, no phase advance.
    return {
      completed: false,
      reason:
        beginRow.refused_reason === "stale_operation"
          ? "a newer recovery operation supersedes this one"
          : "completion owned by another ceremony",
      operationId,
    };
  }
  const fenceOwner = beginRow.completion_owner;
  const fenceGeneration = beginRow.completion_generation;
  if (typeof fenceOwner !== "string" || fenceOwner === "" || !Number.isFinite(Number(fenceGeneration))) {
    throw new Error("mfa_recovery_begin_completion returned no fence.");
  }
  const authoritativeOpStartMs = beginRow.operation_created_at
    ? Date.parse(beginRow.operation_created_at)
    : NaN;

  // Idempotent provider step: delete every OTHER verified factor. On retry
  // the already-deleted ones are gone; the chosen new factor is never
  // deleted. Only the fenced ceremony reaches this point, so two
  // ceremonies can never delete each other's chosen factors.
  const adapter = adminRecoveryAdapter(supabaseAdmin);
  for (const factor of factors) {
    if (!factor?.id || factor.id === newFactorId) continue;
    if (factor.status !== "verified") continue;
    try {
      await adapter.deleteFactor(userId, factor.id, auditId);
    } catch {
      // (d) Partial failure: NEVER report ok. The operation stays resumable
      // in its current phase; the caller surfaces the incomplete state.
      return { completed: false, reason: "factor deletion failed", operationId };
    }
  }

  const { data: markOk, error: markError } = await supabaseAdmin.rpc(
    "mfa_recovery_mark_factors_removed",
    {
      p_user_id: userId,
      p_operation_id: operationId,
      p_audit_id: auditId,
      p_completion_owner: fenceOwner,
      p_completion_generation: fenceGeneration,
    }
  );
  if (markError) throw markError;
  if (markOk !== true) {
    return { completed: false, reason: "mark_factors_removed refused", operationId };
  }

  // Revalidate the chosen factor immediately before atomic finalize: it
  // must STILL be a verified TOTP factor created after the operation
  // started. On failure the fence claim is RELEASED (so a later ceremony
  // with a live factor is not wedged) and completion is refused — never
  // finalize a recovery around a dead factor.
  let revalidatedFactor = null;
  try {
    const { data: refactorsData, error: refactorsError } =
      await supabaseAdmin.auth.admin._listFactors({ userId });
    if (refactorsError) throw refactorsError;
    const refactors = Array.isArray(refactorsData?.factors) ? refactorsData.factors : [];
    revalidatedFactor = refactors.find((f) => f?.id === newFactorId) ?? null;
  } catch {
    revalidatedFactor = null;
  }
  const revalidatedType = String(
    revalidatedFactor?.factor_type ?? revalidatedFactor?.type ?? ""
  ).toLowerCase();
  const revalidatedCreatedAtMs = revalidatedFactor?.created_at
    ? Date.parse(revalidatedFactor.created_at)
    : NaN;
  if (
    !revalidatedFactor ||
    revalidatedFactor.status !== "verified" ||
    revalidatedType !== "totp" ||
    !Number.isFinite(revalidatedCreatedAtMs) ||
    !Number.isFinite(authoritativeOpStartMs) ||
    revalidatedCreatedAtMs <= authoritativeOpStartMs
  ) {
    try {
      await supabaseAdmin.rpc("mfa_recovery_release_completion", {
        p_user_id: userId,
        p_operation_id: operationId,
        p_audit_id: auditId,
        p_completion_owner: fenceOwner,
        p_completion_generation: fenceGeneration,
      });
    } catch {
      // Release is best-effort self-healing; the refusal stands regardless.
    }
    return { completed: false, reason: "chosen factor no longer verified", operationId };
  }

  // Finalize: invalidate generations + completed + latch deletion in ONE
  // transaction. Strict phase order and the fence lineage are enforced by
  // the RPC; it additionally refuses when a newer non-terminal operation
  // exists, so an older operation can never clear a newer latch.
  const { data: finalizeOk, error: finalizeError } = await supabaseAdmin.rpc(
    "mfa_recovery_finalize",
    {
      p_user_id: userId,
      p_operation_id: operationId,
      p_audit_id: auditId,
      p_completion_owner: fenceOwner,
      p_completion_generation: fenceGeneration,
    }
  );
  if (finalizeError) throw finalizeError;
  if (finalizeOk !== true) {
    return { completed: false, reason: "finalize refused", operationId };
  }

  return { completed: true, operationId, chosenFactorId: newFactorId };
}

const FRESH_FIRST_FACTOR_MAX_AGE_MS = 600 * 1000;
