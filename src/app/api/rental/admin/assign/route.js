// POST /api/rental/admin/assign — assign a role to a user.
// Body: { userId, roleId, requestId? }. Requires rental.roles.manage.
// Replaying the same requestId returns the existing assignment (no second
// row). The target must be an active team member; the owner and co-owner
// already have full access and cannot be assigned a role.

import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { rentalAdminRpcErrorResponse, requireRentalRolesManager } from "@/lib/rental/adminRoleAuthorization";

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalRolesManager({ authenticated });
    if (gate.response) return gate.response;

    const body = await request.json();
    const userId = String(body?.userId || "").trim();
    const roleId = String(body?.roleId || "").trim();
    if (!userId) return NextResponse.json({ error: "A user id is required." }, { status: 400 });
    if (!roleId) return NextResponse.json({ error: "A role id is required." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("rental_assign_role", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_user_id: userId,
      p_role_id: roleId,
      p_request_id: String(body?.requestId || newRequestId()),
    });
    if (error) return rentalAdminRpcErrorResponse(error, "Unable to assign that role.");

    const roleName = data?.current_role?.display_name || "a role";
    const email = data?.email || "that user";
    return NextResponse.json({
      success: true,
      user: data || null,
      message: `Assigned the ${roleName} role to ${email}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to assign that role." },
      { status: 500 },
    );
  }
}
