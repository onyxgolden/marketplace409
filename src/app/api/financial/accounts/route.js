import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

// Plain bank/credit/loan accounts have never had a "create new" path -- Simplifi CSV import
// bootstraps them in bulk, and Plaid links them, but there was no way to add a single one by hand
// (unlike Assets/Investments, which each have their own dedicated create form). Scoped to these
// three types only; investment/asset creation stays on their own tabs' existing forms.
const CREATABLE_TYPES = new Set(["depository", "credit", "loan"]);
const MANUAL_PROVIDER = "manual";

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const { data, error } = await authenticated.supabaseClient
      .from("financial_accounts")
      .select("id,name,type")
      .eq("owner_id", authenticated.user.id)
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({ success: true, accounts: data || [] });
  } catch (error) {
    console.error("Financial accounts list error", error);
    const message = error?.message || "Unable to load financial accounts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const body = await request.json();
    const name = String(body?.name || "").trim();
    const type = String(body?.type || "").trim();
    const currentBalanceCents = Number(body?.currentBalanceCents);
    const asOf = String(body?.asOf || "").trim() || new Date().toISOString().slice(0, 10);

    if (!name) return NextResponse.json({ error: "An account name is required." }, { status: 400 });
    if (!CREATABLE_TYPES.has(type)) return NextResponse.json({ error: "A supported account type is required." }, { status: 400 });
    if (!Number.isFinite(currentBalanceCents) || !Number.isInteger(currentBalanceCents) || currentBalanceCents < 0) {
      return NextResponse.json({ error: "Balance must be a non-negative whole number of cents." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(asOf)) return NextResponse.json({ error: "As-of date is invalid." }, { status: 400 });

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;
    const accountId = `financial_account_manual_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const accountInsert = await database.from("financial_accounts").insert({
      id: accountId, owner_id: ownerId, connection_id: "manual", provider: "manual_account",
      provider_account_id: accountId, institution_id: "manual", name, official_name: null, mask: null,
      type, subtype: "manual", currency_code: "USD", active: true, created_at: timestamp, updated_at: timestamp,
    });
    if (accountInsert.error) throw accountInsert.error;

    const balanceInsert = await database.from("account_balances").insert({
      id: `account_balance_${randomUUID()}`, owner_id: ownerId, financial_account_id: accountId,
      connection_id: "manual", provider: MANUAL_PROVIDER, provider_account_id: accountId,
      currency_code: "USD", current_balance_cents: currentBalanceCents, available_balance_cents: null,
      as_of: asOf, created_at: timestamp,
    });
    if (balanceInsert.error) throw balanceInsert.error;

    return NextResponse.json({ success: true, accountId });
  } catch (error) {
    console.error("Financial account creation error", error);
    const message = error?.message || "Unable to create the financial account.";
    return NextResponse.json({ error: message }, { status: /required|supported|non-negative|invalid/i.test(message) ? 400 : 500 });
  }
}
