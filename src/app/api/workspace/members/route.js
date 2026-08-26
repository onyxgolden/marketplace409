import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

function rowToMember(row) {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    invitedEmail: row.invited_email,
    invitedAt: row.invited_at,
    activatedAt: row.activated_at,
    suspendedAt: row.suspended_at,
  };
}

// RLS drives the scoping here on purpose, not an explicit .eq("owner_id", ...) filter: the primary
// owner's workspace_members_owner_all policy returns every member row in their workspace, while
// anyone else's workspace_members_self_select policy returns at most their own row -- matching
// requirement 9's "minimal Workspace Members UI" being a primary-owner-only surface without needing
// duplicate authorization logic here.
export async function GET() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const { data, error } = await authenticated.supabaseClient
    .from("workspace_members")
    .select("*")
    .order("invited_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Unable to load workspace members." }, { status: 500 });

  return NextResponse.json({ success: true, members: (data || []).map(rowToMember) });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const body = await request.json();
  const email = String(body?.email || "").trim();
  const role = String(body?.role || "co_owner").trim();
  if (!email) return NextResponse.json({ error: "An email address is required." }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("invite_workspace_member", {
    p_email: email,
    p_role: role,
  });
  if (error) return NextResponse.json({ error: error.message || "Unable to invite that member." }, { status: 400 });

  return NextResponse.json({ success: true, member: rowToMember(data) });
}

export async function PATCH(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const body = await request.json();
  const memberId = String(body?.memberId || "").trim();
  const action = String(body?.action || "").trim();
  if (!memberId) return NextResponse.json({ error: "A member id is required." }, { status: 400 });
  if (action !== "suspend" && action !== "reactivate") {
    return NextResponse.json({ error: "Action must be 'suspend' or 'reactivate'." }, { status: 400 });
  }

  const rpcName = action === "suspend" ? "suspend_workspace_member" : "reactivate_workspace_member";
  const { data, error } = await authenticated.supabaseClient.rpc(rpcName, { p_member_id: memberId });
  if (error) return NextResponse.json({ error: error.message || "Unable to update that member." }, { status: 400 });

  return NextResponse.json({ success: true, member: rowToMember(data) });
}
