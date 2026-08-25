import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const ASSET_CLASSES = new Set(["real_estate", "vehicle", "equipment", "trailer", "collectible", "crypto", "other"]);
const OWNERSHIP_SCOPES = new Set(["business", "personal", "mixed"]);

function rowToAsset(row, valuation = null) {
  return {
    id: row.id,
    name: row.name,
    assetClass: row.asset_class,
    ownershipScope: row.ownership_scope,
    linkedPropertyId: row.linked_property_id,
    purchaseDate: row.purchase_date,
    purchaseCostCents: row.purchase_cost_cents,
    notes: row.notes,
    active: row.active,
    latestValuation: valuation ? {
      amountCents: valuation.amount_cents,
      effectiveDate: valuation.effective_date,
      source: valuation.source,
    } : null,
  };
}

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  const { data: assets, error } = await authenticated.supabaseClient
    .from("financial_assets")
    .select("*")
    .eq("owner_id", authenticated.user.id)
    .eq("active", true)
    .order("asset_class")
    .order("name");
  if (error) return NextResponse.json({ error: "Unable to load assets." }, { status: 500 });

  const { data: valuations, error: valuationError } = await authenticated.supabaseClient
    .from("financial_asset_valuations")
    .select("*")
    .eq("owner_id", authenticated.user.id)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (valuationError) return NextResponse.json({ error: "Unable to load asset valuations." }, { status: 500 });

  const latestByAsset = new Map();
  for (const valuation of valuations || []) {
    if (!latestByAsset.has(valuation.asset_id)) latestByAsset.set(valuation.asset_id, valuation);
  }
  return NextResponse.json({
    success: true,
    assets: (assets || []).map((asset) => rowToAsset(asset, latestByAsset.get(asset.id))),
  });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const name = String(body?.name || "").trim();
  const assetClass = String(body?.assetClass || "").trim();
  const ownershipScope = String(body?.ownershipScope || "").trim();
  const valueCents = Number(body?.valueCents);
  const valueDate = String(body?.valueDate || "").trim();
  const purchaseCostCents = body?.purchaseCostCents === null || body?.purchaseCostCents === ""
    ? null : Number(body?.purchaseCostCents);

  if (!name) return NextResponse.json({ error: "Asset name is required." }, { status: 400 });
  if (!ASSET_CLASSES.has(assetClass)) return NextResponse.json({ error: "Asset class is invalid." }, { status: 400 });
  if (!OWNERSHIP_SCOPES.has(ownershipScope)) return NextResponse.json({ error: "Ownership scope is invalid." }, { status: 400 });
  if (!Number.isInteger(valueCents) || valueCents < 0) return NextResponse.json({ error: "Current value must be whole cents and cannot be negative." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) return NextResponse.json({ error: "Valuation date is invalid." }, { status: 400 });
  if (purchaseCostCents !== null && (!Number.isInteger(purchaseCostCents) || purchaseCostCents < 0)) {
    return NextResponse.json({ error: "Purchase cost must be whole cents and cannot be negative." }, { status: 400 });
  }

  const assetId = `financial_asset_${randomUUID()}`;
  const { data, error } = await authenticated.supabaseClient.rpc("create_financial_asset_with_valuation", {
    p_id: assetId,
    p_name: name,
    p_asset_class: assetClass,
    p_ownership_scope: ownershipScope,
    p_linked_property_id: String(body?.linkedPropertyId || "").trim() || null,
    p_purchase_date: String(body?.purchaseDate || "").trim() || null,
    p_purchase_cost_cents: purchaseCostCents,
    p_notes: String(body?.notes || "").trim() || null,
    p_valuation_id: `financial_asset_valuation_${randomUUID()}`,
    p_value_cents: valueCents,
    p_value_date: valueDate,
    p_value_source: "manual",
  });
  if (error) return NextResponse.json({ error: "Unable to create asset." }, { status: 500 });
  return NextResponse.json({ success: true, asset: rowToAsset(data, {
    amount_cents: valueCents, effective_date: valueDate, source: "manual",
  }) });
}
