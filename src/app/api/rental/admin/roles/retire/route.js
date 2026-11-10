// POST /api/rental/admin/roles/retire — retire a custom role.
// Body: { roleId, reassignRoleId?, requestId? }. Refuses when the role
// still has active members unless a reassignment role is given (every
// member is moved first). Starter roles cannot be retired.

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
    const roleId = String(body?.roleId || "").trim();
    const reassignRoleId = body?.reassignRoleId == null ? null : String(body.reassignRoleId).trim() || null;
    if (!roleId) return NextResponse.json({ error: "A role id is required." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("rental_retire_role", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_role_id: roleId,
      p_reassign_role_id: reassignRoleId,
      p_request_id: String(body?.requestId || newRequestId()),
    });
    if (error) return rentalAdminRpcErrorResponse(error, "Unable to retire that role.");

    const reassigned = Number(data?.reassigned_count || 0);
    const displayName = data?.role?.display_name || "the role";
    return NextResponse.json({
      success: true,
      role: data?.role || null,
      reassignedCount: reassigned,
      message: reassigned > 0
        ? `Retired the ${displayName} role and moved ${reassigned} staff member${reassigned === 1 ? "" : "s"} to another role.`
        : `Retired the ${displayName} role.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to retire that role." },
      { status: 500 },
    );
  }
}
