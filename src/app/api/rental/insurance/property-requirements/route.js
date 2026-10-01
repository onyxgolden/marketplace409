import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { createPropertyInsuranceRequirement } from "@/domains/insurance-requirements";

// R24 — per-property insurance requirements (owner defaults).
// GET  /api/rental/insurance/property-requirements          — list (read-only members may read)
// POST /api/rental/insurance/property-requirements          — upsert one property's requirements
//   body: { propertyId, requiresRentersInsurance?, minimumLiabilityCents?, requiresPetRecords?, notes? }
// The effective rule for a lease is the per-lease renters_insurance_requirements
// row when present, otherwise this property default.

const TABLE = "rental_property_insurance_requirements";
const COLUMNS = "property_id,requires_renters_insurance,minimum_liability_cents,requires_pet_records,notes,created_at,updated_at";

async function requireWriter(authenticated) {
  const role = await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id });
  return role !== "read_only" ? null : NextResponse.json({ error: "Read-only members cannot manage insurance requirements." }, { status: 403 });
}

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient
      .from(TABLE).select(COLUMNS).eq("owner_id", authenticated.effectiveOwnerId).order("property_id");
    if (error) throw error;
    return NextResponse.json({ requirements: data || [] });
  } catch (error) {
    console.error("Property insurance requirements load error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load property insurance requirements." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const gate = await requireWriter(authenticated);
    if (gate) return gate;

    const body = await request.json();
    let requirement;
    try {
      requirement = createPropertyInsuranceRequirement({
        propertyId: body.propertyId,
        requiresRentersInsurance: body.requiresRentersInsurance,
        minimumLiabilityCents: body.minimumLiabilityCents,
        requiresPetRecords: body.requiresPetRecords,
      });
    } catch (validationError) {
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }

    const row = {
      owner_id: authenticated.effectiveOwnerId,
      property_id: requirement.propertyId,
      requires_renters_insurance: requirement.requiresRentersInsurance,
      minimum_liability_cents: requirement.minimumLiabilityCents,
      requires_pet_records: requirement.requiresPetRecords,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await authenticated.supabaseClient
      .from(TABLE).upsert(row, { onConflict: "owner_id,property_id" }).select(COLUMNS).single();
    if (error) throw error;
    return NextResponse.json({ success: true, requirement: data });
  } catch (error) {
    console.error("Property insurance requirement save error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save the property insurance requirement." }, { status: 500 });
  }
}
