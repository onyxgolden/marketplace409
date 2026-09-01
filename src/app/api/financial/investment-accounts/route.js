import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const ACCOUNT_TYPES = new Set([
  "taxable_brokerage", "ira", "roth_ira", "401k", "pension",
  "crypto_exchange", "crypto_wallet", "metals_vault", "private_investment", "other",
]);
const TAX_TREATMENTS = new Set(["taxable", "tax_deferred", "tax_exempt", "unknown"]);
const OWNERSHIP_SCOPES = new Set(["business", "personal", "mixed"]);

function rowToAccount(row, valuation = null) {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institution_name,
    accountType: row.account_type,
    taxTreatment: row.tax_treatment,
    ownershipScope: row.ownership_scope,
    notes: row.notes,
    active: row.active,
    latestValuation: valuation ? {
      amountCents: valuation.amount_cents,
      effectiveDate: valuation.effective_date,
      source: valuation.source,
    } : null,
  };
}

function parseAccountBody(body) {
  const name = String(body?.name || "").trim();
  const accountType = String(body?.accountType || "").trim();
  const taxTreatment = String(body?.taxTreatment || "").trim();
  const ownershipScope = String(body?.ownershipScope || "").trim();
  const valueCents = Number(body?.valueCents);
  const valueDate = String(body?.valueDate || "").trim();

  if (!name) return { error: "Account name is required." };
  if (!ACCOUNT_TYPES.has(accountType)) return { error: "Account type is invalid." };
  if (!TAX_TREATMENTS.has(taxTreatment)) return { error: "Tax treatment is invalid." };
  if (!OWNERSHIP_SCOPES.has(ownershipScope)) return { error: "Ownership scope is invalid." };
  if (!Number.isInteger(valueCents) || valueCents < 0) return { error: "Current value must be whole cents and cannot be negative." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) return { error: "Valuation date is invalid." };

  return {
    value: {
      name, accountType, taxTreatment, ownershipScope, valueCents, valueDate,
      institutionName: String(body?.institutionName || "").trim() || null,
      notes: String(body?.notes || "").trim() || null,
    },
  };
}

function rpcArguments(account, valuationId) {
  return {
    p_name: account.name,
    p_institution_name: account.institutionName,
    p_account_type: account.accountType,
    p_tax_treatment: account.taxTreatment,
    p_ownership_scope: account.ownershipScope,
    p_notes: account.notes,
    p_valuation_id: valuationId,
    p_value_cents: account.valueCents,
    p_value_date: account.valueDate,
    p_value_source: "manual",
  };
}

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  const { data: accounts, error } = await authenticated.supabaseClient
    .from("investment_accounts")
    .select("*")
    .eq("owner_id", authenticated.user.id)
    .eq("active", true)
    .order("account_type")
    .order("name");
  if (error) return NextResponse.json({ error: "Unable to load investment accounts." }, { status: 500 });

  const { data: valuations, error: valuationError } = await authenticated.supabaseClient
    .from("investment_account_valuations")
    .select("*")
    .eq("owner_id", authenticated.user.id)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (valuationError) return NextResponse.json({ error: "Unable to load investment account valuations." }, { status: 500 });

  const latestByAccount = new Map();
  for (const valuation of valuations || []) {
    if (!latestByAccount.has(valuation.account_id)) latestByAccount.set(valuation.account_id, valuation);
  }

  return NextResponse.json({
    success: true,
    accounts: (accounts || []).map((account) => rowToAccount(account, latestByAccount.get(account.id))),
  });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const parsed = parseAccountBody(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const account = parsed.value;

  const accountId = `investment_account_${randomUUID()}`;
  const { data, error } = await authenticated.supabaseClient.rpc("create_investment_account_with_valuation", {
    p_id: accountId,
    ...rpcArguments(account, `investment_account_valuation_${randomUUID()}`),
  });
  if (error) {
    const message = error?.code === "23505"
      ? "An active investment account with this name already exists."
      : "Unable to create investment account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ success: true, account: rowToAccount(data, {
    amount_cents: account.valueCents, effective_date: account.valueDate, source: "manual",
  }) });
}

export async function PATCH(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const accountId = String(body?.accountId || "").trim();
  if (!accountId) return NextResponse.json({ error: "Account id is required." }, { status: 400 });
  const parsed = parseAccountBody(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("update_investment_account_with_valuation", {
    p_account_id: accountId,
    ...rpcArguments(parsed.value, `investment_account_valuation_${randomUUID()}`),
  });
  if (error) return NextResponse.json({ error: "Unable to update investment account." }, { status: 500 });
  return NextResponse.json({ success: true, account: rowToAccount(data, {
    amount_cents: parsed.value.valueCents,
    effective_date: parsed.value.valueDate,
    source: "manual",
  }) });
}

export async function DELETE(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json();
  const accountId = String(body?.accountId || "").trim();
  if (!accountId) return NextResponse.json({ error: "Account id is required." }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("deactivate_investment_account", {
    p_account_id: accountId,
  });
  if (error) return NextResponse.json({ error: "Unable to retire investment account." }, { status: 500 });
  return NextResponse.json({ success: true, account: rowToAccount(data) });
}
