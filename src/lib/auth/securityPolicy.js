// Security Layer 2 — MFA / rate-limit policy: state machine, cohort resolution,
// activation gate.
//
// This module is the policy surface only. Enforcement lives in
// requireSecurityAssurance.js; the two are deliberately separate so policy
// (who must use MFA) can never be confused with the guard (are they AAL2?).
//
// IMPORTANT: cohort classification is grounded in REAL ownership evidence,
// never in the absence of rows. The data-plane's missing-membership fallback
// (see getActorRentalAuthorization in teamAuthorization.js) is RENTAL-context
// behavior only and the authorized brief EXPLICITLY excluded it for security
// cohorts. This module therefore:
//   - resolves owned workspaces from real workspace_members rows where the
//     user is the canonical owner (owner_id = user id) — no workspaces table
//     is invented;
//   - resolves active staff/owner/co-owner memberships independently;
//   - gives owner/staff status PRECEDENCE over tenant/borrower consumer links
//     (dual roles are REQUIRED, never OPTIONAL);
//   - classifies an ordinary unlinked consumer (no membership, no ownership,
//     no consumer link) as UNKNOWN (fail closed) — never REQUIRED by absence.

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
 *   read-only staff included), OR is the canonical owner of at least one
 *   workspace (a workspace_members row with owner_id = the user id).
 *   Owner/staff status takes PRECEDENCE over tenant/borrower links: a
 *   dual-role owner/consumer is REQUIRED, never OPTIONAL.
 * - cohort "optional": the user is linked as a tenant or borrower
 *   (auth_user_id match) and holds no active membership and no ownership.
 * - cohort "unknown": resolution failed (query error or MALFORMED result
 *   shape), or the user has no membership, no ownership, and no consumer
 *   link — an ordinary unlinked consumer must NOT be classified by absence
 *   (the brief explicitly excluded the missing-membership fallback here).
 *   Callers must deny privileged access on "unknown"; it is never an
 *   exemption.
 *
 * Client metadata, invite email, localStorage, and view-as targets must not
 * influence the result -- this function takes only (supabaseAdmin, userId).
 */
export async function resolveActorEligibility(supabaseAdmin, userId) {
  if (typeof userId !== "string" || userId === "") {
    return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
  }

  try {
    const [membershipResult, ownershipResult, tenantResult, borrowerResult] =
      await Promise.all([
        supabaseAdmin
          .from("workspace_members")
          .select("owner_id, role, status")
          .eq("member_user_id", userId),
        // Ownership evidence WITHOUT a workspaces table: a
        // workspace_members row whose canonical owner_id is this user.
        // Existence check only (limit 1).
        supabaseAdmin.from("workspace_members").select("id").eq("owner_id", userId).limit(1),
        supabaseAdmin.from("rental_tenants").select("id").eq("auth_user_id", userId).limit(1),
        supabaseAdmin
          .from("private_financing_borrowers")
          .select("id")
          .eq("auth_user_id", userId)
          .limit(1),
      ]);

    const results = [membershipResult, ownershipResult, tenantResult, borrowerResult];
    for (const r of results) {
      if (r?.error) throw r.error;
    }

    // Malformed successful results fail closed: a query that "succeeded"
    // but returned a non-array payload is not evidence of "no rows".
    for (const r of results) {
      if (!Array.isArray(r?.data)) {
        return { cohort: COHORT_UNKNOWN, workspaceIds: [], memberships: [] };
      }
    }

    const activeMemberships = membershipResult.data.filter(isActiveMembership);
    const memberOwnerIds = [...new Set(activeMemberships.map((m) => m.owner_id).filter(Boolean))];
    const ownsWorkspace = ownershipResult.data.length > 0;
    const isLinkedConsumer = tenantResult.data.length > 0 || borrowerResult.data.length > 0;

    // Owner/staff precedence: real ownership or an active membership makes
    // the user REQUIRED even when also linked as a tenant/borrower.
    // No classification by absence: without membership, ownership, or a
    // consumer link, the cohort is UNKNOWN (fail closed).
    let cohort;
    if (activeMemberships.length > 0 || ownsWorkspace) {
      cohort = COHORT_REQUIRED;
    } else if (isLinkedConsumer) {
      cohort = COHORT_OPTIONAL;
    } else {
      cohort = COHORT_UNKNOWN;
    }

    // A workspace is identified by its canonical owner id; an owned
    // workspace is therefore the user's own id.
    const workspaceIds = [...new Set([...memberOwnerIds, ...(ownsWorkspace ? [userId] : [])])];

    return {
      cohort,
      workspaceIds,
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
