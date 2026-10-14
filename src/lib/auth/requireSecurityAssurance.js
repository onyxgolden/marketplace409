// Server-side MFA security guard (Layer 2).
//
// AND this with the existing workspace ownership predicates — it never
// replaces them. It answers only "has this actor proven AAL2 for this
// session (or is AAL2 not required of them)?". Browser AAL checks guide UX
// only; this guard re-validates everything server-side from the session
// token, never from client claims (metadata, localStorage, view-as target,
// invite email).
//
// Contract notes:
// - `supabaseAdmin` must be a service-role client (see serverAuthTransport.js).
// - Session identity is independently validated via auth.getUser(accessToken),
//   and the AAL/AMR/session_id claims via auth.getClaims(accessToken) — the
//   two are bound together (claims.sub === user.id). getUser's user object
//   is NOT treated as carrying JWT claims: aal/amr/session_id come only
//   from the independently validated claims.
// - AAL2 means a provider-issued `aal === "aal2"` claim, or an `amr` claim
//   containing a REAL second factor (totp, phone, webauthn). An AAL1 session
//   whose amr lists only first-factor methods (password, oauth, magiclink,
//   otp, email) is NOT AAL2 — oauth/magiclink never count as a second factor.
// - The recovery latch (`mfa_security_latch`) denies latched users even with
//   otherwise-valid tokens, independent of provider revocation propagation.
// - The grandfather registry (`session_grandfather_registry`, keyed by
//   (user_id, session_id)) covers pre-activation session families. Refresh of
//   the same family preserves eligibility; new families cannot join. The
//   session_id comes from the validated JWT claims, never from a
//   caller-supplied field. A browser timestamp or a newly refreshed JWT iat
//   NEVER determines grandfathering. Revoked and recovery-pending families
//   never regain access via grandfathering — recovery deletes the user's
//   registry rows when the latch is set, so row existence IS the eligibility
//   signal (the table has no revoked_at/state columns by design).
// - Factor listing uses the admin `_listFactors({ userId })` surface — the
//   only admin factor-listing method in the locked @supabase/auth-js 2.110.5
//   (public listFactors/deleteFactor do not exist there). Return shape is
//   { data: { factors: [...] } }; only status === "verified" factors count.

import {
  ACTIVATION_CONFIG,
  COHORT_REQUIRED,
  COHORT_UNKNOWN,
  MFA_STATES,
  isMfaLayer2Activated,
  resolveActorEligibility,
} from "./securityPolicy.js";

async function readLatch(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("mfa_security_latch")
    .select("user_id, latched_at, reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readGrandfatherRow(supabaseAdmin, userId, sessionId) {
  if (!sessionId) return null;
  const { data, error } = await supabaseAdmin
    .from("session_grandfather_registry")
    .select("user_id, session_id")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function listVerifiedFactors(supabaseAdmin, userId) {
  // Locked SDK 2.110.5: the admin factor surface is the underscore-prefixed
  // _listFactors({ userId }) (public listFactors does not exist). Return
  // shape: { data: { factors: [...] } }. Pinned by adapter tests.
  const { data, error } = await supabaseAdmin.auth.admin._listFactors({ userId });
  if (error) throw error;
  const factors = Array.isArray(data?.factors) ? data.factors : [];
  return factors.filter((f) => f?.status === "verified");
}

// Real second-factor methods. First-factor methods (password, oauth,
// magiclink, otp, email, sso, saml, ...) NEVER satisfy AAL2, even when they
// appear in amr alongside password on an AAL1 session.
const SECOND_FACTOR_METHODS = new Set(["totp", "phone", "webauthn"]);

export function verifiedAal2(claims) {
  if (!claims) return false;
  if (claims.aal === "aal2") return true;
  const amr = claims.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((m) => SECOND_FACTOR_METHODS.has(String(m?.method ?? m).toLowerCase()));
}

/**
 * L2-006: derive the freshest permitted FIRST-factor event from the JWT
 * claims' AMR method timestamps — the actual auth ceremony clock. Token
 * issuance (claims.iat) is NOT the ceremony: a refreshed token carries an
 * old iat and proves nothing about when the user last authenticated.
 *
 * Returns the latest first-factor method timestamp in SECONDS, or null when
 * the AMR is missing/empty, contains no permitted first-factor method, or
 * any present method lacks a timestamp. Callers must ALSO refuse timestamps
 * in the future (beyond a small skew allowance).
 *
 * Supabase/GoTrue AMR entries are { method, timestamp } with timestamp in
 * Unix seconds.
 */
const FIRST_FACTOR_METHODS = new Set([
  "password",
  "oauth",
  "magiclink",
  "otp",
  "email",
  "sso",
  "saml",
]);

export function freshFirstFactorAt(claims) {
  const amr = claims?.amr;
  if (!Array.isArray(amr) || amr.length === 0) return null;
  let latest = null;
  for (const entry of amr) {
    const method = String(entry?.method ?? entry ?? "").toLowerCase();
    if (!FIRST_FACTOR_METHODS.has(method)) continue;
    const ts = Number(entry?.timestamp);
    // A present first-factor method WITHOUT a timestamp is not evidence of
    // a fresh ceremony — refuse rather than fall back to iat.
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
}

/**
 * Validate the JWT claims for a session token, independently bound to the
 * verified user. Returns the claims ({ sub, aal, amr, session_id, iat, ... })
 * or null when the token is invalid or the binding fails.
 */
export async function verifiedSessionClaims(supabaseAdmin, accessToken, userId) {
  try {
    const { data, error } = await supabaseAdmin.auth.getClaims(accessToken);
    if (error || !data?.claims) return null;
    const claims = data.claims;
    if (!claims || typeof claims !== "object") return null;
    // Bind the claims to the independently verified user: the claims must
    // name the same subject. Without this binding, claims from any valid
    // token could be presented for another user.
    if (String(claims.sub ?? "") !== String(userId ?? "")) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Server-side authorization guard.
 *
 * @param {{ supabaseAdmin, user, session, config }} args
 *   user: { id } claimed by the caller (re-validated against the session token).
 *   session: { access_token } — the session to check.
 * @returns { authorized: boolean, state, cohort, reason }
 */
export async function requireSecurityAssurance({
  supabaseAdmin,
  user,
  session,
  config = ACTIVATION_CONFIG,
}) {
  const deny = (state, cohort, reason) => ({ authorized: false, state, cohort, reason });

  if (!supabaseAdmin || !user?.id || !session?.access_token) {
    return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "missing-session");
  }

  // Layer not activated: explicit, labeled pass-through. Activation stays
  // disabled until Jason's release step; this branch makes the disabled state
  // auditable rather than silently permissive.
  if (!isMfaLayer2Activated(config)) {
    return {
      authorized: true,
      state: MFA_STATES.AUTHORIZED,
      cohort: COHORT_UNKNOWN,
      reason: "layer2-disabled",
    };
  }

  // 1. Independently validate the session token. Client claims about user or
  //    AAL are ignored; only the provider-verified identity counts.
  let verifiedUser;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(session.access_token);
    if (error || !data?.user) return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "invalid-session");
    if (data.user.id !== user.id) return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "identity-mismatch");
    verifiedUser = data.user;
  } catch {
    return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "session-validation-failed");
  }

  // 1b. Independently validate the JWT claims (aal/amr/session_id) and bind
  //     them to the verified user. The getUser user object is NOT treated
  //     as carrying JWT claims.
  const claims = await verifiedSessionClaims(supabaseAdmin, session.access_token, verifiedUser.id);
  if (!claims) {
    return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "claims-validation-failed");
  }

  // 2. Resolve the cohort from the deployed ownership schema.
  let eligibility;
  try {
    eligibility = await resolveActorEligibility(supabaseAdmin, verifiedUser.id);
  } catch {
    eligibility = { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }

  if (eligibility.cohort === COHORT_UNKNOWN) {
    // Failed role resolution denies privileged access — never assumes exemption.
    return deny(MFA_STATES.FIRST_FACTOR, COHORT_UNKNOWN, "unknown-cohort");
  }

  if (eligibility.cohort !== COHORT_REQUIRED) {
    // Optional cohort: MFA may be enrolled but is not required.
    return {
      authorized: true,
      state: MFA_STATES.AUTHORIZED,
      cohort: eligibility.cohort,
      reason: "optional-cohort",
    };
  }

  // 3. Recovery latch: latched users are denied even with valid tokens.
  try {
    const latch = await readLatch(supabaseAdmin, verifiedUser.id);
    if (latch) return deny(MFA_STATES.RECOVERY_PENDING, eligibility.cohort, "recovery-latch");
  } catch {
    return deny(MFA_STATES.FIRST_FACTOR, eligibility.cohort, "latch-check-failed");
  }

  // 4. Provider-issued AAL2 on the validated claims is sufficient.
  if (verifiedAal2(claims)) {
    return {
      authorized: true,
      state: MFA_STATES.AUTHORIZED,
      cohort: eligibility.cohort,
      reason: "aal2",
    };
  }

  // 5. Below AAL2: the grandfather registry covers pre-activation session
  //    families. The session_id comes from the VALIDATED claims, never from
  //    a caller-supplied field. A legitimate old family authorizes even with
  //    no enrolled factor — that is the entire point of the snapshot.
  try {
    const grandfathered = await readGrandfatherRow(
      supabaseAdmin,
      verifiedUser.id,
      typeof claims.session_id === "string" ? claims.session_id : null
    );
    if (grandfathered) {
      return {
        authorized: true,
        state: MFA_STATES.AUTHORIZED,
        cohort: eligibility.cohort,
        reason: "grandfathered",
      };
    }
  } catch {
    return deny(MFA_STATES.FIRST_FACTOR, eligibility.cohort, "grandfather-check-failed");
  }

  // 6. Not grandfathered and below AAL2: distinguish "must enroll" from
  //    "must challenge".
  let verifiedFactors;
  try {
    verifiedFactors = await listVerifiedFactors(supabaseAdmin, verifiedUser.id);
  } catch {
    return deny(MFA_STATES.FIRST_FACTOR, eligibility.cohort, "factor-check-failed");
  }

  if (verifiedFactors.length === 0) {
    return deny(MFA_STATES.ENROLL_REQUIRED, eligibility.cohort, "no-enrolled-factor");
  }

  return deny(MFA_STATES.CHALLENGE_REQUIRED, eligibility.cohort, "aal1-with-factor");
}
