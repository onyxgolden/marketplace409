// Security Layer 2 — MFA / rate-limit policy: state machine, cohort resolution,
// activation gate.
//
// This module is the policy surface only. Enforcement lives in
// requireSecurityAssurance.js; the two are deliberately separate so policy
// (who must use MFA) can never be confused with the guard (are they AAL2?).
//
// IMPORTANT: never reuse teamAuthorization.js's missing-membership fallback
// here. In the rental context, a user with no membership row is treated as the
// workspace's primary owner. If that fallback were reused for cohort
// classification, EVERY authenticated consumer (tenant/borrower/portal user)
// would be classified as a required owner. This module resolves actual owned
// workspaces and actual active memberships only.

export const MFA_STATES = Object.freeze({
  FIRST_FACTOR: "FIRST_FACTOR",
  ENROLL_REQUIRED: "ENROLL_REQUIRED",
  CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
  AUTHORIZED: "AUTHORIZED",
  RECOVERY_PENDING: "RECOVERY_PENDING",
});

// Valid MFA state-machine transitions. Any transition not listed here is a
// bug and must be rejected by callers building flows on these states.
export const MFA_TRANSITIONS = Object.freeze({
  FIRST_FACTOR: ["ENROLL_REQUIRED", "CHALLENGE_REQUIRED", "AUTHORIZED"],
  ENROLL_REQUIRED: ["AUTHORIZED", "FIRST_FACTOR"],
  CHALLENGE_REQUIRED: ["AUTHORIZED", "FIRST_FACTOR", "RECOVERY_PENDING"],
  AUTHORIZED: ["FIRST_FACTOR", "RECOVERY_PENDING"],
  RECOVERY_PENDING: ["ENROLL_REQUIRED", "FIRST_FACTOR"],
});

export function isValidMfaTransition(from, to) {
  return Boolean(MFA_TRANSITIONS[from] && MFA_TRANSITIONS[from].includes(to));
}

// Release gate. Layer 2 ships as inert, reviewed code until Jason explicitly
// activates it. Flipping this to true is a release action (with the migration
// applied, the endpoint-coverage feasibility checkpoint cleared, and a canary
// measured) — not a configuration tweak a test or an environment boolean may
// perform on its own. No other module may grant MFA exemptions based on
// environment variables.
export const ACTIVATION_CONFIG = Object.freeze({
  enabled: false,
});

export function isMfaLayer2Activated(config = ACTIVATION_CONFIG) {
  return config.enabled === true;
}

// Cohort constants.
export const COHORT_REQUIRED = "required";
export const COHORT_OPTIONAL = "optional";
export const COHORT_UNKNOWN = "unknown";

// A membership row counts toward the required cohort only when it is ACTIVE.
// Inactive, suspended, revoked, or missing rows never count — and missing
// rows NEVER fall back to "owner" in this module (see note at the top).
const ACTIVE_MEMBERSHIP_STATUSES = Object.freeze(["active"]);

function isActiveMembership(row) {
  if (!row) return false;
  const status = String(row.status ?? row.membership_status ?? "").toLowerCase();
  return ACTIVE_MEMBERSHIP_STATUSES.includes(status);
}

/**
 * Resolve the MFA cohort for a user from first-party data only.
 *
 * Queries `workspace_members` (active memberships for this user) and
 * `workspaces` (workspaces this user owns) directly. Returns:
 *
 *   { cohort, workspaceIds, memberships }
 *
 * - cohort "required": the user owns at least one workspace OR holds at least
 *   one active membership of any role (owner, co-owner, staff, restricted and
 *   read-only staff included). Ordinary tenant/borrower/consumer users have no
 *   membership rows and no owned workspaces, so they land in "optional".
 * - cohort "optional": resolution succeeded and the user owns nothing and
 *   holds no active membership.
 * - cohort "unknown": resolution failed (query error, malformed result).
 *   Callers must deny privileged access on "unknown" — it is never treated as
 *   an exemption.
 *
 * Client metadata, invite email, localStorage, and view-as targets must not
 * influence the result — this function takes only (supabaseAdmin, userId).
 */
export async function resolveActorEligibility(supabaseAdmin, userId) {
  if (typeof userId !== "string" || userId === "") {
    return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }

  try {
    const [membershipResult, ownershipResult] = await Promise.all([
      supabaseAdmin
        .from("workspace_members")
        .select("workspace_id, role, status")
        .eq("user_id", userId),
      supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("owner_id", userId),
    ]);

    if (membershipResult?.error) throw membershipResult.error;
    if (ownershipResult?.error) throw ownershipResult.error;

    const allMemberships = Array.isArray(membershipResult?.data) ? membershipResult.data : [];
    const activeMemberships = allMemberships.filter(isActiveMembership);
    const ownedWorkspaces = Array.isArray(ownershipResult?.data) ? ownershipResult.data : [];
    const ownedIds = ownedWorkspaces.map((w) => w.id).filter(Boolean);

    const workspaceIds = [
      ...new Set([
        ...ownedIds,
        ...activeMemberships.map((m) => m.workspace_id).filter(Boolean),
      ]),
    ];

    const cohort =
      ownedIds.length > 0 || activeMemberships.length > 0
        ? COHORT_REQUIRED
        : COHORT_OPTIONAL;

    return {
      cohort,
      workspaceIds,
      memberships: activeMemberships.map((m) => ({
        workspaceId: m.workspace_id,
        role: m.role,
        status: m.status,
      })),
    };
  } catch {
    // Fail closed: callers deny privileged access on "unknown".
    return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }
}
