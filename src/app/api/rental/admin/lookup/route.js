// POST /api/rental/admin/lookup — look one user up by exact user ID or
// verified email. No account enumeration: the search must match exactly.
// Body: { search }. Requires rental.roles.read.

import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { rentalAdminRpcErrorResponse, requireRentalAdminKey } from "@/lib/rental/adminRoleAuthorization";

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireRentalAdminKey({ authenticated, key: "rental.roles.read" });
    if (gate.response) return gate.response;

    const body = await request.json();
    const search = String(body?.search || "").trim();
    if (!search) return NextResponse.json({ error: "Enter an exact user ID or email address." }, { status: 400 });

    const { data, error } = await authenticated.supabaseClient.rpc("rental_lookup_user", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_search: search,
    });
    if (error) return rentalAdminRpcErrorResponse(error, "No account was found for that exact user ID or verified email.");

    return NextResponse.json({ success: true, user: data || null });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to look that user up." },
      { status: 500 },
    );
  }
}
