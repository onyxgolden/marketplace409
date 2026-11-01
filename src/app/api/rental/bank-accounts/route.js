import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// Active bank-type accounts for the bank ledger account picker. Workspace-scoped:
// effectiveOwnerId is the canonical owner id, so a co-owner sees the shared
// books' accounts, not just their own.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const { data, error } = await supabaseClient
      .from("financial_accounts")
      .select("id, name, official_name, type")
      .eq("owner_id", effectiveOwnerId)
      .eq("active", true)
      .in("type", ["depository", "credit", "loan"])
      .order("name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({ success: true, accounts: data || [] });
  } catch (error) {
    console.error("Bank accounts list error", error);
    return NextResponse.json({ error: "Unable to load bank accounts." }, { status: 500 });
  }
}

// Controls-sweep follow-up G14 (M-20): the bank ledger's empty state used to
// dead-end ("Add an account first, then come back") with no creation path
// in the rental screens. This POST is the rental-scoped twin of the
// financial dashboard's /api/financial/accounts creation: a manual account
// (provider/institution "manual") plus its opening balance row, owned by the
// workspace owner so the rental picker sees it immediately for every member.
// Same three creatable types, same validators. A fuller Plaid-linked account
// still comes from the financial dashboard's link flow, not from here.
const CREATABLE_TYPES = new Set(["depository", "credit", "loan"]);

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

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

    const accountId = `financial_account_manual_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const accountInsert = await supabaseClient.from("financial_accounts").insert({
      id: accountId, owner_id: effectiveOwnerId, connection_id: "manual", provider: "manual_account",
      provider_account_id: accountId, institution_id: "manual", name, official_name: null, mask: null,
      type, subtype: "manual", currency_code: "USD", active: true, created_at: timestamp, updated_at: timestamp,
    });
    if (accountInsert.error) throw accountInsert.error;

    const balanceInsert = await supabaseClient.from("account_balances").insert({
      id: `account_balance_${randomUUID()}`, owner_id: effectiveOwnerId, financial_account_id: accountId,
      connection_id: "manual", provider: "manual", provider_account_id: accountId,
      currency_code: "USD", current_balance_cents: currentBalanceCents, available_balance_cents: null,
      as_of: asOf, created_at: timestamp,
    });
    if (balanceInsert.error) throw balanceInsert.error;

    return NextResponse.json({ success: true, account: { id: accountId, name, official_name: null, type } }, { status: 201 });
  } catch (error) {
    console.error("Bank account creation error", error);
    const message = error?.message || "Unable to create the bank account.";
    return NextResponse.json({ error: message }, { status: /required|supported|non-negative|invalid/i.test(message) ? 400 : 500 });
  }
}
