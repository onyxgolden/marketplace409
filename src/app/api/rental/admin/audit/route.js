// GET /api/rental/admin/audit — the role change log for this workspace
// (newest first). Requires rental.audit.read (owner/co-owner hold every
// key). Query: ?limit= (1..500, default 100).

import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalAdminKey } from "@/lib/rental/adminRoleAuthorization";

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalAdminKey({ authenticated, key: "rental.audit.read" });
    if (gate.response) return gate.response;

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100) || 100));

    const { data, error } = await authenticated.supabaseClient.rpc("rental_get_role_audit", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_limit: limit,
    });
    if (error) return NextResponse.json({ error: error.message || "Unable to load the change log." }, { status: 500 });

    return NextResponse.json({ success: true, entries: data || [] });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to load the change log." },
      { status: 500 },
    );
  }
}
