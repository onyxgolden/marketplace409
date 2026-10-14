// Security Layer 2 — MFA / rate-limit policy: state machine, cohort resolution,
// activation gate.
//
// This module is the policy surface only. Enforcement lives in
// requireSecurityAssurance.js; the two are deliberately separate so policy
// (who must use MFA) can never be confused with the guard (are they AAL2?).
//
// IMPORTANT: cohort classification distinguishes primary owners from
// tenant/borrower consumers WITHOUT a workspaces table (none exists in
// the deployed schema). The data-plane's own predicate (see
// getActorRentalAuthorization in teamAuthorization.js) treats a user with
// no membership row as the primary owner of their own workspace; this
// module applies the same fallback ONLY after excluding users linked as
// tenants/borrowers via rental_tenants.auth_user_id and
// private_financing_borrowers.auth_user_id. Consumers linked in those
// tables (and holding no active membership) are OPTIONAL; everyone else
// with no active membership is REQUIRED (primary owner).

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
// Inactive, suspended, revoked, or missing rows never count.
const ACTIVE_MEMBERSHIP_STATUSES = Object.freeze(["active"]);

function isActiveMembership(row) {
  if (!row) return false;
  const status = String(row.status ?? row.membership_status ?? "").toLowerCase();
  return ACTIVE_MEMBERSHIP_STATUSES.includes(status);
}

/**
 * Resolve the MFA cohort for a user from first-party data only.
 *
 * Uses the ACTUAL deployed schema (see module header and
 * src/lib/rental/teamAuthorization.js):
 *   workspace_members(member_user_id uuid, owner_id text, role, status)
 *   rental_tenants(auth_user_id uuid)
 *   private_financing_borrowers(auth_user_id uuid)
 *
 * Returns { cohort, workspaceIds, memberships }:
 * - cohort "required": the user holds at least one ACTIVE workspace
 *   membership of any role (owner, co-owner, staff, restricted and
 *   read-only staff included), OR has no membership row and is not linked
 *   as a tenant/borrower -- the data-plane's own fallback treats that as
 *   primary owner of their own workspace (see getActorRentalAuthorization).
 * - cohort "optional": the user is linked as a tenant or borrower
 *   (auth_user_id match) and holds no active membership.
 * - cohort "unknown": resolution failed (query error or MALFORMED result
 *   shape). A successful query returning a non-array payload is malformed
 *   and yields UNKNOWN -- never "optional". Callers must deny privileged
 *   access on "unknown"; it is never an exemption.
 *
 * Client metadata, invite email, localStorage, and view-as targets must not
 * influence the result -- this function takes only (supabaseAdmin, userId).
 */
export async function resolveActorEligibility(supabaseAdmin, userId) {
  if (typeof userId !== "string" || userId === "") {
    return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }

  try {
    const [membershipResult, tenantResult, borrowerResult] = await Promise.all([
      supabaseAdmin
        .from("workspace_members")
        .select("owner_id, role, status")
        .eq("member_user_id", userId),
      supabaseAdmin.from("rental_tenants").select("id").eq("auth_user_id", userId).limit(1),
      supabaseAdmin
        .from("private_financing_borrowers")
        .select("id")
        .eq("auth_user_id", userId)
        .limit(1),
    ]);

    if (membershipResult?.error) throw membershipResult.error;
    if (tenantResult?.error) throw tenantResult.error;
    if (borrowerResult?.error) throw borrowerResult.error;

    // Malformed successful results fail closed: a query that "succeeded"
    // but returned a non-array payload is not evidence of "no rows".
    if (
      !Array.isArray(membershipResult?.data) ||
      !Array.isArray(tenantResult?.data) ||
      !Array.isArray(borrowerResult?.data)
    ) {
      return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
    }

    const activeMemberships = membershipResult.data.filter(isActiveMembership);
    const ownerIds = [...new Set(activeMemberships.map((m) => m.owner_id).filter(Boolean))];
    const isLinkedConsumer = tenantResult.data.length > 0 || borrowerResult.data.length > 0;

    const cohort =
      activeMemberships.length > 0 || !isLinkedConsumer ? COHORT_REQUIRED : COHORT_OPTIONAL;

    return {
      cohort,
      workspaceIds: ownerIds,
      memberships: activeMemberships.map((m) => ({
        workspaceId: m.owner_id,
        role: m.role,
        status: m.status,
      })),
    };
  } catch {
    // Fail closed: callers deny privileged access on "unknown".
    return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }
}
