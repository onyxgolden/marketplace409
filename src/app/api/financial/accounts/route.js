import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

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
