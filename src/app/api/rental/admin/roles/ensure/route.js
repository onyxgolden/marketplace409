// POST /api/rental/admin/roles/ensure — materialize the four starter roles
// for this workspace (idempotent). Owner/co-owner only. Creates role
// definitions, never assignments: no one gains permissions from this call.

import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireTeamManager } from "@/lib/rental/teamAuthorization";
import { buildSecurityContext } from "@/lib/rental/teamAuthorization";

export async function POST() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireTeamManager({
      authenticated,
      request: null,
      security: await buildSecurityContext(authenticated),
    });
    if (gate.response) return gate.response;

    const { data, error } = await authenticated.supabaseClient.rpc("rental_ensure_starter_roles", {
      p_owner_id: authenticated.effectiveOwnerId,
    });
    if (error) return NextResponse.json({ error: error.message || "Unable to set up roles." }, { status: 400 });

    return NextResponse.json({
      success: true,
      roles: data || [],
      message: "Set up the four starter roles: Rental Admin, Manager, Bookkeeper, and Read-only.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Unable to set up roles." },
      { status: 500 },
    );
  }
}
