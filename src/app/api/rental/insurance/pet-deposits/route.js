import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

// R24 — one-time pet deposit records (RECORD-ONLY: the money movement stays in
// the existing deposit flows; this table records the pet-deposit facts).
// GET  /api/rental/insurance/pet-deposits?animalId=<optional>  — list (read-only members may read)
// POST /api/rental/insurance/pet-deposits                     — record a pet deposit
//   body: { animalId, amountCents, status?, note? }
// Pet deposits are prohibited for assistance-animal review records (the DB
// trigger enforces the same rule as monthly_pet_fees).

const TABLE = "rental_pet_deposits";
const COLUMNS = "id,animal_id,tenant_id,lease_id,amount_cents,status,collected_at,released_at,note,created_at,updated_at";
const STATUSES = ["held", "applied_to_balance", "refunded", "forfeited"];

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);
    const animalId = String(url.searchParams.get("animalId") || "").trim();
    let query = authenticated.supabaseClient.from(TABLE).select(COLUMNS).eq("owner_id", authenticated.effectiveOwnerId);
    if (animalId) query = query.eq("animal_id", animalId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ deposits: data || [] });
  } catch (error) {
    console.error("Pet deposit load error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load pet deposits." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const role = await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id });
    if (role === "read_only") return NextResponse.json({ error: "Read-only members cannot record pet deposits." }, { status: 403 });

    const body = await request.json();
    const animalId = String(body.animalId || "").trim();
    const amountCents = Number(body.amountCents);
    const status = body.status ? String(body.status) : "held";
    if (!animalId) return NextResponse.json({ error: "animalId is required." }, { status: 400 });
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
      return NextResponse.json({ error: "Pet deposit amount must be a positive integer of cents." }, { status: 400 });
    if (!STATUSES.includes(status))
      return NextResponse.json({ error: `Pet deposit status must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });

    // Resolve tenant + lease from the animal so the deposit is always tied to
    // the canonical pet-liability animal record (no duplicated identity).
    const { data: animal, error: animalError } = await authenticated.supabaseClient
      .from("rental_animals").select("id,tenant_id,lease_id")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", animalId).maybeSingle();
    if (animalError) throw animalError;
    if (!animal) return NextResponse.json({ error: "Pet record was not found in this workspace." }, { status: 404 });

    const row = {
      owner_id: authenticated.effectiveOwnerId,
      id: `rental_pet_deposit_${crypto.randomUUID()}`,
      animal_id: animal.id,
      tenant_id: animal.tenant_id,
      lease_id: animal.lease_id,
      amount_cents: amountCents,
      status,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    };
    const { data, error } = await authenticated.supabaseClient.from(TABLE).insert(row).select(COLUMNS).single();
    if (error) throw error;
    return NextResponse.json({ success: true, deposit: data });
  } catch (error) {
    console.error("Pet deposit save error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record the pet deposit." }, { status: 500 });
  }
}
