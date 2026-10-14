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
// - Session identity is independently validated via auth.getUser(accessToken).
// - AAL2 means a provider-issued AAL2 claim (amr containing an enrolled
//   factor, or aal === "aal2"). AAL1 with no enrolled factor is NOT
//   sufficient for a required-cohort new session — the brief is explicit.
// - The recovery latch (`mfa_security_latch`) denies latched users even with
//   otherwise-valid tokens, independent of provider revocation propagation.
// - The grandfather registry (`mfa_session_families`) covers pre-activation
//   session families by (user_id, session_id). Refresh of the same family
//   preserves eligibility; new families cannot join. A browser timestamp or a
//   newly refreshed JWT iat NEVER determines grandfathering.
// - Grandfathering applies to the session family that existed at activation,
//   not to the person: revoked and recovery-pending families never regain
//   access via grandfathering.

import {
  ACTIVATION_CONFIG,
  COHORT_REQUIRED,
  COHORT_UNKNOWN,
  MFA_STATES,
  isMfaLayer2Activated,
  resolveActorEligibility,
} from "./securityPolicy.js";

const RECOVERY_PENDING_STATES = new Set([MFA_STATES.RECOVERY_PENDING]);

async function readLatch(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("mfa_security_latch")
    .select("user_id, latched_at, reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readGrandfatherFamily(supabaseAdmin, userId, sessionId) {
  if (!sessionId) return null;
  const { data, error } = await supabaseAdmin
    .from("mfa_session_families")
    .select("user_id, session_id, state, revoked_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function listVerifiedFactors(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin.auth.admin.listFactors({ id: userId });
  if (error) throw error;
  const factors = Array.isArray(data?.all) ? data.all : Array.isArray(data?.totp) ? data.totp : [];
  return factors.filter((f) => f?.status === "verified");
}

function verifiedAal2(verifiedUser) {
  if (!verifiedUser) return false;
  if (verifiedUser.aal === "aal2") return true;
  const amr = verifiedUser.amr;
  if (Array.isArray(amr) && amr.some((m) => String(m?.method ?? m).toLowerCase() !== "password")) {
    return true;
  }
  return false;
}

/**
 * Server-side authorization guard.
 *
 * @param {{ supabaseAdmin, user, session, config }} args
 *   user: { id } claimed by the caller (re-validated against the session token).
 *   session: { access_token, user?: { id, aal, amr } } — the session to check.
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

  // 2. Resolve the cohort from actual owned workspaces / active memberships.
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

  // 4. Provider-issued AAL2 on the verified session is sufficient.
  if (verifiedAal2(verifiedUser)) {
    return {
      authorized: true,
      state: MFA_STATES.AUTHORIZED,
      cohort: eligibility.cohort,
      reason: "aal2",
    };
  }

  // 5. Below AAL2: distinguish "must enroll" from "must challenge".
  let verifiedFactors;
  try {
    verifiedFactors = await listVerifiedFactors(supabaseAdmin, verifiedUser.id);
  } catch {
    return deny(MFA_STATES.FIRST_FACTOR, eligibility.cohort, "factor-check-failed");
  }

  if (verifiedFactors.length === 0) {
    return deny(MFA_STATES.ENROLL_REQUIRED, eligibility.cohort, "no-enrolled-factor");
  }

  // 6. Factor exists but session is AAL1: grandfather registry check for a
  //    pre-activation session family. Keyed by (user, Supabase session_id) —
  //    never by browser timestamps or refreshed JWT iat.
  try {
    const family = await readGrandfatherFamily(supabaseAdmin, verifiedUser.id, session?.user?.session_id ?? session?.session_id);
    if (family && !family.revoked_at && !RECOVERY_PENDING_STATES.has(family.state)) {
      return {
        authorized: true,
        state: MFA_STATES.AUTHORIZED,
        cohort: eligibility.cohort,
        reason: "grandfathered-session-family",
      };
    }
  } catch {
    return deny(MFA_STATES.CHALLENGE_REQUIRED, eligibility.cohort, "grandfather-check-failed");
  }

  return deny(MFA_STATES.CHALLENGE_REQUIRED, eligibility.cohort, "challenge-required");
}
