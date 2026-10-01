import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { validateDepreciationAsset } from "@/domains/rental-depreciation/depreciation";
import { rowToDepreciationAsset } from "../route";

export const runtime = "nodejs";

// Rentec parity R19: single-asset CRUD. Reads are open to every workspace
// member; PUT/DELETE are owner/co-owner only (managers, bookkeepers, and
// read-only members get 403).
// Report-only books decision: nothing here posts to any ledger or register.

const SELECT_COLUMNS =
  "id, property_id, description, category, placed_in_service, cost_basis_cents, method, useful_life_months, salvage_value_cents, notes, created_at, updated_at";

async function loadOne(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_depreciation_assets")
    .select(SELECT_COLUMNS)
    .eq("owner_id", authenticated.effectiveOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Owner/co-owner only — same boundary as the collection route.
async function writeBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const row = await loadOne(authenticated, params.id);
    if (!row) return NextResponse.json({ error: "Depreciation asset was not found." }, { status: 404 });
    return NextResponse.json({ success: true, asset: rowToDepreciationAsset(row) });
  } catch (error) {
    console.error("Depreciation asset load error", error);
    return NextResponse.json({ error: "Unable to load the depreciation asset." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await writeBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can manage depreciation assets." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const existing = await loadOne(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Depreciation asset was not found." }, { status: 404 });
    const merged = {
      description: body.description ?? existing.description,
      category: body.category ?? existing.category,
      placed_in_service: body.placed_in_service ?? body.placedInService ?? existing.placed_in_service,
      cost_basis_cents: body.cost_basis_cents ?? body.costBasisCents ?? existing.cost_basis_cents,
      method: body.method ?? existing.method,
      useful_life_months: body.useful_life_months ?? body.usefulLifeMonths ?? existing.useful_life_months,
      salvage_value_cents: body.salvage_value_cents ?? body.salvageValueCents ?? existing.salvage_value_cents,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    };
    const validated = validateDepreciationAsset(merged);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_depreciation_assets")
      .update({ ...validated.clean, updated_at: new Date().toISOString() })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, asset: rowToDepreciationAsset(data) });
  } catch (error) {
    console.error("Depreciation asset update error", error);
    return NextResponse.json({ error: "Unable to save the depreciation asset." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await writeBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can manage depreciation assets." }, { status: 403 });
  }
  try {
    const existing = await loadOne(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Depreciation asset was not found." }, { status: 404 });
    const { error } = await authenticated.supabaseClient
      .from("rental_depreciation_assets")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Depreciation asset delete error", error);
    return NextResponse.json({ error: "Unable to delete the depreciation asset." }, { status: 500 });
  }
}
