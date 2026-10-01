import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

// R24 — pet record details on the existing rental_animals rows (weight,
// vaccination record on file, vaccination expiry). The animal identity
// (name, breed, classification, approval workflow) stays owned by the
// pet-liability code; this route only updates the R24 detail columns.
// PATCH /api/rental/insurance/pet-records
//   body: { animalId, weightLbs?, vaccinationRecordOnFile?, vaccinationExpiresOn? }
// Read-only members may not write (403).

const TABLE = "rental_animals";

function parseWeight(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.5 || value > 500)
    throw new Error("Pet weight must be between 0.5 and 500 lbs when provided.");
  return value;
}

function parseVaccinationDate(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim()))
    throw new Error("Vaccination expiry must be a YYYY-MM-DD date when provided.");
  return String(raw).trim();
}

export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const role = await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id });
    if (role === "read_only") return NextResponse.json({ error: "Read-only members cannot update pet records." }, { status: 403 });

    const body = await request.json();
    const animalId = String(body.animalId || "").trim();
    if (!animalId) return NextResponse.json({ error: "animalId is required." }, { status: 400 });

    let weightLbs, vaccinationExpiresOn;
    try {
      weightLbs = parseWeight(body.weightLbs);
      vaccinationExpiresOn = parseVaccinationDate(body.vaccinationExpiresOn);
    } catch (validationError) {
      return NextResponse.json({ error: validationError.message }, { status: 400 });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (weightLbs !== null) patch.weight_lbs = weightLbs;
    if (body.weightLbs === null) patch.weight_lbs = null;
    if (typeof body.vaccinationRecordOnFile === "boolean") patch.vaccination_record_on_file = body.vaccinationRecordOnFile;
    if (vaccinationExpiresOn !== null) patch.vaccination_expires_on = vaccinationExpiresOn;
    if (body.vaccinationExpiresOn === null) patch.vaccination_expires_on = null;

    const { data, error } = await authenticated.supabaseClient
      .from(TABLE).update(patch).eq("owner_id", authenticated.effectiveOwnerId).eq("id", animalId).select().single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Pet record was not found in this workspace." }, { status: 404 });
    return NextResponse.json({ success: true, animal: data });
  } catch (error) {
    console.error("Pet record update error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the pet record." }, { status: 500 });
  }
}
