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

function parseAssetBody(body) {
  const name = String(body?.name || "").trim();
  const assetClass = String(body?.assetClass || "").trim();
  const ownershipScope = String(body?.ownershipScope || "").trim();
  const valueCents = Number(body?.valueCents);
  const valueDate = String(body?.valueDate || "").trim();
  const purchaseCostCents = body?.purchaseCostCents === null || body?.purchaseCostCents === undefined || body?.purchaseCostCents === ""
    ? null : Number(body?.purchaseCostCents);

  if (!name) return { error: "Asset name is required." };
  if (!ASSET_CLASSES.has(assetClass)) return { error: "Asset class is invalid." };
  if (!OWNERSHIP_SCOPES.has(ownershipScope)) return { error: "Ownership scope is invalid." };
  if (!Number.isInteger(valueCents) || valueCents < 0) return { error: "Current value must be whole cents and cannot be negative." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) return { error: "Valuation date is invalid." };
  if (purchaseCostCents !== null && (!Number.isInteger(purchaseCostCents) || purchaseCostCents < 0)) {
    return { error: "Purchase cost must be whole cents and cannot be negative." };
  }

  return {
    value: {
      name, assetClass, ownershipScope, valueCents, valueDate, purchaseCostCents,
      linkedPropertyId: String(body?.linkedPropertyId || "").trim() || null,
      purchaseDate: String(body?.purchaseDate || "").trim() || null,
      notes: String(body?.notes || "").trim() || null,
    },
  };
}

function rpcArguments(asset, valuationId) {
  return {
    p_name: asset.name,
    p_asset_class: asset.assetClass,
    p_ownership_scope: asset.ownershipScope,
    p_linked_property_id: asset.linkedPropertyId,
    p_purchase_date: asset.purchaseDate,
    p_purchase_cost_cents: asset.purchaseCostCents,
    p_notes: asset.notes,
    p_valuation_id: valuationId,
    p_value_cents: asset.valueCents,
    p_value_date: asset.valueDate,
    p_value_source: "manual",
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

  const { data: units, error: unitError } = await authenticated.supabaseClient
    .from("rental_units")
    .select("property_id,label")
    .eq("owner_id", authenticated.user.id)
    .order("label");
  if (unitError) return NextResponse.json({ error: "Unable to load linked properties." }, { status: 500 });

  const propertiesById = new Map();
  for (const unit of units || []) {
    if (!propertiesById.has(unit.property_id)) {
      propertiesById.set(unit.property_id, { id: unit.property_id, label: unit.label || unit.property_id });
    }
  }

  const latestByAsset = new Map();
  for (const valuation of valuations || []) {
    if (!latestByAsset.has(valuation.asset_id)) latestByAsset.set(valuation.asset_id, valuation);
  }
  return NextResponse.json({
    success: true,
    assets: (assets || []).map((asset) => rowToAsset(asset, latestByAsset.get(asset.id))),
    properties: [...propertiesById.values()],
  });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const parsed = parseAssetBody(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const asset = parsed.value;

  const assetId = `financial_asset_${randomUUID()}`;
  const { data, error } = await authenticated.supabaseClient.rpc("create_financial_asset_with_valuation", {
    p_id: assetId,
    ...rpcArguments(asset, `financial_asset_valuation_${randomUUID()}`),
  });
  if (error) return NextResponse.json({ error: "Unable to create asset." }, { status: 500 });
  return NextResponse.json({ success: true, asset: rowToAsset(data, {
    amount_cents: asset.valueCents, effective_date: asset.valueDate, source: "manual",
  }) });
}

export async function PATCH(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const assetId = String(body?.assetId || "").trim();
  if (!assetId) return NextResponse.json({ error: "Asset id is required." }, { status: 400 });
  const parsed = parseAssetBody(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("update_financial_asset_with_valuation", {
    p_asset_id: assetId,
    ...rpcArguments(parsed.value, `financial_asset_valuation_${randomUUID()}`),
  });
  if (error) return NextResponse.json({ error: "Unable to update asset." }, { status: 500 });
  return NextResponse.json({ success: true, asset: rowToAsset(data, {
    amount_cents: parsed.value.valueCents,
    effective_date: parsed.value.valueDate,
    source: "manual",
  }) });
}

export async function DELETE(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const assetId = String(body?.assetId || "").trim();
  if (!assetId) return NextResponse.json({ error: "Asset id is required." }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("deactivate_financial_asset", {
    p_asset_id: assetId,
  });
  if (error) return NextResponse.json({ error: "Unable to retire asset." }, { status: 500 });
  return NextResponse.json({ success: true, asset: rowToAsset(data) });
}
