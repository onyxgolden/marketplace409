import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  DEPRECIATION_METHODS,
  rowToAsset,
  validateDepreciationAsset,
} from "@/domains/rental-depreciation/depreciation";

export const runtime = "nodejs";

// Rentec parity R19: depreciation asset register per property.
// GET is readable by every workspace member (read-only included) — reading
// the register is not a write. POST is owner/co-owner only.
// GET ?propertyId= is required: assets are always scoped to one property.
//
// BOOKS INTEGRATION DECISION (report-only): depreciation is a non-cash
// expense. This API never posts to the property ledger or the bank register
// — the CPA hand-off report (GET ./schedule) reads the register and computes
// schedules on the fly. Nothing here moves cash.

const SELECT_COLUMNS =
  "id, property_id, description, category, placed_in_service, cost_basis_cents, method, useful_life_months, salvage_value_cents, notes, created_at, updated_at";

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export function rowToDepreciationAsset(row) {
  const asset = rowToAsset(row);
  return { ...asset, methodLabel: DEPRECIATION_METHODS[asset.method]?.label || asset.method };
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = (searchParams.get("propertyId") || "").trim();
    if (!propertyId) {
      return NextResponse.json({ error: "A propertyId is required to load depreciation assets." }, { status: 400 });
    }
    const { data, error } = await authenticated.supabaseClient
      .from("rental_depreciation_assets")
      .select(SELECT_COLUMNS)
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("property_id", propertyId)
      .order("placed_in_service", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, assets: (data || []).map(rowToDepreciationAsset) });
  } catch (error) {
    console.error("Depreciation assets load error", error);
    return NextResponse.json({ error: "Unable to load depreciation assets." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage depreciation assets." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const propertyId = String(body.propertyId || body.property_id || "").trim();
    if (!propertyId) {
      return NextResponse.json({ error: "A property is required for the depreciation asset." }, { status: 400 });
    }
    const validated = validateDepreciationAsset(body);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_depreciation_assets")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        property_id: propertyId,
        created_by: authenticated.user.id,
        ...validated.clean,
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, asset: rowToDepreciationAsset(data) }, { status: 201 });
  } catch (error) {
    console.error("Depreciation asset create error", error);
    return NextResponse.json({ error: "Unable to save the depreciation asset." }, { status: 500 });
  }
}
