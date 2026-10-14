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
// Layer 2 (MFA/rate-limit) server-guard hook — WIRED, activation-gated:
//
// requireRentalPermission and requireTeamManager accept an optional
// `security` context ({ supabaseAdmin, session }) built by
// buildSecurityContext(). The TRUSTED server-side ACTIVATION_CONFIG decides
// whether enforcement applies: when activated, a missing/incomplete
// security context FAILS CLOSED (the route must be wired); when disabled,
// the gates behave EXACTLY as before Layer 2 — the guard module is not
// even imported on the inert path. The security guard never replaces
// the workspace ownership predicates, and the rental missing-membership
// fallback below is RENTAL-context behavior only (securityPolicy.js resolves
// cohorts independently — see its header).
//
// Wire points: requireRentalPermission (after preview + permission checks),
// requireTeamManager (after the role check). SECURITY_ASSURANCE_HOOK.status
// is "wired": the AND is implemented; activation (config.enabled) decides
// whether it enforces. Rental routes supply the context via
// buildSecurityContext(authenticated) — see the runbook's endpoint
// enforcement table for the wired-route inventory.

import { NextResponse } from "next/server";
import { ACTIVATION_CONFIG, isMfaLayer2Activated } from "@/lib/auth/securityPolicy.js";
import {
  RENTAL_PERMISSION_KEYS,
  RENTAL_PERMISSION_LABELS,
  hasRentalPermission,
  isFullAccessRole,
  resolveEffectivePermissions,
} from "./permissions";

// Documents where the Layer 2 server guard ANDs into the rental gates.
// status "wired": the AND below is implemented; enforcement is decided by
// the activation config (default off => exact pre-Layer-2 behavior).
export const SECURITY_ASSURANCE_HOOK = Object.freeze({
  status: "wired",
  guardModule: "@/lib/auth/requireSecurityAssurance.js",
  adminTransport: "@/lib/auth/serverAuthTransport.js",
  andSemantics: "deny-unless-both-assurance-and-rental-checks-pass",
  wirePoints: Object.freeze(["requireRentalPermission", "requireTeamManager"]),
  activationGated: true,
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

/**
 * Layer 2 AND: deny unless the server-side MFA guard authorizes the actor's
 * session. Returns a 403 response when the guard denies, or null when the
 * guard authorizes.
 *
 * L2-002: the TRUSTED server-side activation config decides FIRST whether
 * enforcement applies — never a caller-supplied override. When Layer 2 is
 * activated, the security context is MANDATORY: a route that was never
 * wired to supply it fails closed (403) instead of silently skipping the
 * guard. When activation is off (the shipped default), this returns null
 * without importing the guard module — exact pre-Layer-2 behavior.
 *
 * @param {{ supabaseAdmin, session }|null} security - caller-supplied
 *   context: service-role client + the request's session ({ access_token }).
 *   Built by buildSecurityContext() in the route layer.
 */
async function enforceSecurityAssurance(security, authenticated) {
  if (!isMfaLayer2Activated(ACTIVATION_CONFIG)) return null;
  if (!security?.supabaseAdmin || !security?.session?.access_token) {
    // Activated but the route was never wired (or wiring failed): fail
    // closed. A missing context under activation is a deployment bug, not
    // an exemption.
    return forbidden("Additional verification is unavailable. Please try again later.");
  }
  const { requireSecurityAssurance } = await import("@/lib/auth/requireSecurityAssurance.js");
  let assurance;
  try {
    assurance = await requireSecurityAssurance({
      supabaseAdmin: security.supabaseAdmin,
      user: { id: authenticated?.user?.id },
      session: security.session,
      config: ACTIVATION_CONFIG,
    });
  } catch {
    return forbidden("Additional verification is unavailable. Please try again later.");
  }
  if (assurance?.authorized) return null;
  return forbidden("Additional verification required. Complete MFA to continue.");
}

/**
 * Build the Layer 2 security context for a rental route from the shared
 * request authentication (createAuthenticatedRentalManagerApplication).
 *
 * Returns null when Layer 2 is not activated — the inert path does zero
 * extra work (no service-role client, no session read) so unwired routes
 * behave EXACTLY as before Layer 2. When activated, returns
 * { supabaseAdmin, session } with the request's cookie session; a missing
 * piece fails closed in enforceSecurityAssurance rather than throwing.
 *
 * Routes wire it as:
 *   const gate = await requireTeamManager({
 *     authenticated, request,
 *     security: await buildSecurityContext(authenticated),
 *   });
 */
export async function buildSecurityContext(authenticated) {
  if (!isMfaLayer2Activated(ACTIVATION_CONFIG)) return null;
  let supabaseAdmin = null;
  try {
    const { createServerAuthClient } = await import("@/lib/auth/serverAuthTransport.js");
    supabaseAdmin = createServerAuthClient();
  } catch {
    supabaseAdmin = null;
  }
  let accessToken = null;
  try {
    const { data } = await authenticated?.supabaseClient?.auth?.getSession();
    if (typeof data?.session?.access_token === "string" && data.session.access_token !== "") {
      accessToken = data.session.access_token;
    }
  } catch {
    accessToken = null;
  }
  return { supabaseAdmin, session: accessToken ? { access_token: accessToken } : null };
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
//
// Layer 2: when `security` ({ supabaseAdmin, session, config? }) is supplied
// AND Layer 2 is activated, requireSecurityAssurance is ANDed with the rental
// checks below. Without a security context, or with activation off, behavior
// is EXACTLY as before Layer 2.
export async function requireRentalPermission({ authenticated, request, permission, security = null }) {
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

  const assuranceDeny = await enforceSecurityAssurance(security, authenticated);
  if (assuranceDeny) return { response: assuranceDeny, authorization: null };

  return { response: null, authorization };
}

export async function requireTeamManager({ authenticated, request, security = null }) {
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

  const assuranceDeny = await enforceSecurityAssurance(security, authenticated);
  if (assuranceDeny) return { response: assuranceDeny, authorization: null };

  return { response: null, authorization };
}
