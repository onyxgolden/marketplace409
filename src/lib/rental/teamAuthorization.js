// R17 (rentec-parity): server-side team authorization for the Rental Manager.
//
// Two layers:
//   getActorRentalAuthorization -- resolves who the actor is in the workspace (primary owner,
//     co-owner, or staff member), their effective permission set (role defaults + per-user
//     overrides), and an optional "view as" preview session.
//   requireRentalPermission / requireTeamManager -- route-level gates. They return
//     { response: null, authorization } when allowed, or { response: <403> } when denied.
//
// "View as" preview (Rentec's "test the login as that user", safe shape):
//   - Only a team.manage holder (primary owner or co-owner) can start a preview.
//   - The target must be an ACTIVE staff member of the same workspace, never a co-owner
//     (no lateral/escalating preview) and never the actor themselves.
//   - Preview is READ-ONLY: every mutation route denied while previewing, with a clear message.
//   - Preview start/end are audited (log_team_audit); the session cookie is httpOnly and
//     expires after 4 hours.
//   - An unresolvable preview cookie fails closed (403), never silently ignored.
//
// Layer 2 (MFA/rate-limit) server-guard hook point — NOT YET WIRED (inert until activation):
//   Once Layer 2 activates, requireRentalPermission and requireTeamManager must AND the
//   server-side requireSecurityAssurance() result (src/lib/auth/requireSecurityAssurance.js)
//   with the rental authorization computed below:
//
//     const assurance = await requireSecurityAssurance({
//       supabaseAdmin,                       // service-role client (serverAuthTransport.js)
//       user: { id: authenticated.user.id }, // re-validated against the session token
//       session: <the request's session>,    // access_token validated server-side
//     });
//     // AND semantics: allow ONLY when assurance.authorized AND the existing
//     // rental permission/preview checks below pass. A deny from EITHER side
//     // is a 403. The security guard never replaces the workspace ownership
//     // predicates and never reuses the rental missing-membership fallback
//     // (securityPolicy.js resolves actual owned workspaces / active
//     // memberships only — see its header).
//
//   Wiring checklist (for the activation PR, not this one):
//   - requireRentalPermission: after the preview read-only check and the
//     hasRentalPermission check pass, AND assurance.authorized.
//   - requireTeamManager: after the role check passes, AND assurance.authorized.
//   - getActorRentalAuthorization's missing-membership => primary_owner fallback
//     is RENTAL-context behavior and MUST NOT change here; the security layer
//     performs its own strict cohort resolution independently.
//   - SECURITY_ASSURANCE_HOOK.status flips to "wired" when the AND is live.

import { NextResponse } from "next/server";
import {
  RENTAL_PERMISSION_KEYS,
  RENTAL_PERMISSION_LABELS,
  hasRentalPermission,
  isFullAccessRole,
  resolveEffectivePermissions,
} from "./permissions";

// Documents where the Layer 2 server guard ANDs into the rental gates.
// status "not-wired": the gates below behave EXACTLY as before Layer 2 —
// this constant is the hook point, not an enforcement change.
export const SECURITY_ASSURANCE_HOOK = Object.freeze({
  status: "not-wired",
  guardModule: "@/lib/auth/requireSecurityAssurance.js",
  adminTransport: "@/lib/auth/serverAuthTransport.js",
  andSemantics: "deny-unless-both-assurance-and-rental-checks-pass",
  wirePoints: Object.freeze(["requireRentalPermission", "requireTeamManager"]),
});

export const PREVIEW_COOKIE_NAME = "forge_rental_preview_as";
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = 4 * 60 * 60;

function parsePreviewMemberId(request) {
  try {
    const header = request?.headers?.get?.("cookie") || "";
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === PREVIEW_COOKIE_NAME) return decodeURIComponent(rest.join("=") || "").trim() || null;
    }
  } catch {
    // A malformed cookie header fails closed below (treated as no preview).
  }
  return null;
}

function forbidden(message) {
  return NextResponse.json({ error: message }, { status: 403 });
}

async function loadMembership(supabaseClient, actorUserId) {
  const { data, error } = await supabaseClient
    .from("workspace_members")
    .select("id, role, status, permission_overrides, invited_email, owner_id, member_user_id")
    .eq("member_user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Failed to resolve team membership: ${error.message}`);
  return data || null;
}

export async function getActorRentalAuthorization({ supabaseClient, actorUserId, effectiveOwnerId, request }) {
  let membership;
  try {
    membership = await loadMembership(supabaseClient, actorUserId);
  } catch (error) {
    return { forbidden: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  const isPrimaryOwner = !membership;
  const baseRole = isPrimaryOwner ? "primary_owner" : membership.role;
  const basePermissions = isFullAccessRole(baseRole)
    ? Object.freeze([...RENTAL_PERMISSION_KEYS])
    : resolveEffectivePermissions({ role: membership.role, overrides: membership.permission_overrides });

  const previewMemberId = parsePreviewMemberId(request);
  if (!previewMemberId) {
    return { isPrimaryOwner, role: baseRole, permissions: basePermissions, effectiveOwnerId, preview: null, forbidden: null };
  }

  // A preview session exists: only the primary owner or co-owner may hold one.
  // NO-GO fix 2026-10-01 (finding 2): explicit role check, not just the team.manage
  // permission bit — team.manage must never be grantable to staff.
  if (!isPrimaryOwner && baseRole !== "co_owner") {
    return { forbidden: forbidden("Only the owner or co-owner can preview as a team member.") };
  }

  let target;
  try {
    const { data, error } = await supabaseClient
      .from("workspace_members")
      .select("id, role, status, permission_overrides, invited_email, member_user_id")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", previewMemberId)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve preview target: ${error.message}`);
    target = data || null;
  } catch (error) {
    return { forbidden: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  // Fail closed: a preview cookie pointing at a missing/inactive/privileged member denies the
  // request instead of silently dropping back to full access.
  if (!target || target.status !== "active") {
    return { forbidden: forbidden("This preview session is invalid or expired. End the preview and start it again.") };
  }
  if (target.role === "co_owner" || target.member_user_id === actorUserId) {
    return { forbidden: forbidden("This preview session is invalid or expired. End the preview and start it again.") };
  }

  const targetPermissions = isFullAccessRole(target.role)
    ? Object.freeze([...RENTAL_PERMISSION_KEYS])
    : resolveEffectivePermissions({ role: target.role, overrides: target.permission_overrides });

  return {
    isPrimaryOwner,
    role: baseRole,
    permissions: targetPermissions,
    effectiveOwnerId,
    preview: Object.freeze({
      memberId: target.id,
      role: target.role,
      email: target.invited_email,
    }),
    forbidden: null,
  };
}

// Gate for a single permission. In preview mode EVERY mutation is denied -- the preview is a
// read-only verification surface, never a way to act as the other user.
export async function requireRentalPermission({ authenticated, request, permission }) {
  const authorization = await getActorRentalAuthorization({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
    effectiveOwnerId: authenticated.effectiveOwnerId,
    request,
  });
  if (authorization.forbidden) return { response: authorization.forbidden, authorization: null };

  if (authorization.preview) {
    return {
      response: forbidden(
        "Preview mode is read-only. You are viewing as this team member to verify their permissions -- end the preview to make changes."
      ),
      authorization: null,
    };
  }

  if (!hasRentalPermission(authorization.permissions, permission)) {
    const label = RENTAL_PERMISSION_LABELS[permission] || "perform this action";
    return {
      response: forbidden(`Your team role does not allow this. Missing permission: ${label}.`),
      authorization: null,
    };
  }

  return { response: null, authorization };
}

export async function requireTeamManager({ authenticated, request }) {
  const authorization = await getActorRentalAuthorization({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
    effectiveOwnerId: authenticated.effectiveOwnerId,
    request,
  });
  if (authorization.forbidden) return { response: authorization.forbidden, authorization: null };

  if (authorization.preview) {
    return {
      response: forbidden(
        "Preview mode is read-only. You are viewing as this team member to verify their permissions -- end the preview to make changes."
      ),
      authorization: null,
    };
  }

  // NO-GO fix 2026-10-01 (finding 2): team management requires the primary owner or co-owner
  // ROLE explicitly. The team.manage permission bit alone is not sufficient — it must never
  // be grantable to staff (enforced in resolveEffectivePermissions, has_rental_permission(),
  // and update_workspace_member()).
  if (!authorization.isPrimaryOwner && authorization.role !== "co_owner") {
    return { response: forbidden("Only the owner or co-owner can manage the team."), authorization: null };
  }

  return { response: null, authorization };
}
