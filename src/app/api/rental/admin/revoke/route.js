// POST /api/rental/admin/revoke — revoke a user's active role.
// Body: { userId, requestId? }. Requires rental.roles.manage.

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
    if (!userId) return NextResponse.json({ error: "A user id is required." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("rental_revoke_role", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_user_id: userId,
      p_request_id: String(body?.requestId || newRequestId()),
    });
    if (error) return rentalAdminRpcErrorResponse(error, "Unable to revoke that role.");

    const email = data?.email || "that user";
    return NextResponse.json({
      success: true,
      user: data || null,
      message: `Removed the role from ${email}. They can no longer use the permissions that role gave them.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to revoke that role." },
      { status: 500 },
    );
  }
}
