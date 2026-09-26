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
