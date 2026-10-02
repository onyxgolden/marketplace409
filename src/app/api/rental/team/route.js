import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";
import {
  RENTAL_PERMISSIONS,
  resolveEffectivePermissions,
  roleLabel,
} from "@/lib/rental/permissions";

function serializeMember(row) {
  return {
    id: row.id,
    memberUserId: row.member_user_id,
    email: row.invited_email,
    role: row.role,
    roleLabel: roleLabel(row.role),
    status: row.status,
    invitedAt: row.invited_at,
    activatedAt: row.activated_at,
    suspendedAt: row.suspended_at,
    permissionOverrides: row.permission_overrides || {},
    effectivePermissions: resolveEffectivePermissions({
      role: row.role,
      overrides: row.permission_overrides,
    }),
  };
}

// GET /api/rental/team -- list the workspace team with roles, overrides, and effective
// permissions. Owner/co-owner (team.manage) only.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({ authenticated, request });
    if (gate.response) return gate.response;

    const { data, error } = await authenticated.supabaseClient.rpc("get_workspace_team");
    if (error) return NextResponse.json({ error: "Unable to load the team." }, { status: 500 });

    return NextResponse.json({
      success: true,
      members: (data || []).map(serializeMember),
      permissionCatalog: RENTAL_PERMISSIONS,
      viewerId: authenticated.user.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to load the team." },
      { status: 500 }
    );
  }
}

// POST /api/rental/team -- invite a team member by email with a role.
// Body: { email, role }. The invitee must already have a confirmed FORGE account; no email is
// sent by this route (acceptance happens from the invitee's own account).
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({ authenticated, request });
    if (gate.response) return gate.response;

    const body = await request.json();
    const email = String(body?.email || "").trim();
    const role = String(body?.role || "").trim();
    if (!email) return NextResponse.json({ error: "An email address is required." }, { status: 400 });
    if (!role) return NextResponse.json({ error: "A role is required." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("invite_workspace_member", {
      p_email: email,
      p_role: role,
    });
    if (error) return NextResponse.json({ error: error.message || "Unable to invite that member." }, { status: 400 });

    return NextResponse.json({ success: true, member: serializeMember(data) });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to invite that member." },
      { status: 500 }
    );
  }
}

// PATCH /api/rental/team -- change a member's role, replace their permission overrides,
// or suspend/reactivate them.
// Body: { memberId, role?, permissionOverrides?, statusAction? } (statusAction: suspend|reactivate).
// Every change is audited by the update_workspace_member RPC.
export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({ authenticated, request });
    if (gate.response) return gate.response;

    const body = await request.json();
    const memberId = String(body?.memberId || "").trim();
    if (!memberId) return NextResponse.json({ error: "A member id is required." }, { status: 400 });

    const role = body?.role == null ? null : String(body.role).trim();
    const permissionOverrides =
      body?.permissionOverrides === undefined ? null : body.permissionOverrides;
    const statusAction = body?.statusAction == null ? null : String(body.statusAction).trim();
    if (role === "" ) return NextResponse.json({ error: "Role cannot be blank." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("update_workspace_member", {
      p_member_id: memberId,
      p_role: role || null,
      p_permission_overrides: permissionOverrides,
      p_status_action: statusAction || null,
    });
    if (error) return NextResponse.json({ error: error.message || "Unable to update that member." }, { status: 400 });

    return NextResponse.json({ success: true, member: serializeMember(data) });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to update that member." },
      { status: 500 }
    );
  }
}
