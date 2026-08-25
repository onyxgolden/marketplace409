import { NextResponse } from "next/server";

import { buildSimplifiAssetRegistryPreview } from "@/domains/simplifi-import/buildSimplifiAssetRegistryPreview";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const PAGE_SIZE = 1000;

async function fetchScopeEvidence(database, ownerId) {
  const result = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await database.from("financial_events")
      .select("financial_account_id,metadata")
      .eq("owner_id", ownerId)
      .eq("source_system", "quicken_simplifi_csv")
      .eq("status", "active")
      .eq("is_deleted", false)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    result.push(...page.map((row) => ({
      financial_account_id: row.financial_account_id,
      account_scope: row.metadata?.account_scope ?? null,
    })));
    if (page.length < PAGE_SIZE) return result;
  }
}

async function fetchLatestBalances(database, ownerId) {
  const seenAccounts = new Set();
  const latestBalances = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await database.from("account_balances")
      .select("financial_account_id,current_balance_cents,as_of")
      .eq("owner_id", ownerId)
      .order("financial_account_id", { ascending: true })
      .order("as_of", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const balance of page) {
      if (!seenAccounts.has(balance.financial_account_id)) {
        seenAccounts.add(balance.financial_account_id);
        latestBalances.push(balance);
      }
    }
    if (page.length < PAGE_SIZE) return latestBalances;
  }
}

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;
    const [accountsResult, latestBalances, assetsResult, scopeEvidence] = await Promise.all([
      database.from("financial_accounts").select("id,name,type,provider,active")
        .eq("owner_id", ownerId).eq("active", true).eq("provider", "quicken_simplifi_csv"),
      fetchLatestBalances(database, ownerId),
      database.from("financial_assets").select("name,active")
        .eq("owner_id", ownerId).eq("active", true),
      fetchScopeEvidence(database, ownerId),
    ]);
    if (accountsResult.error) throw accountsResult.error;
    if (assetsResult.error) throw assetsResult.error;

    return NextResponse.json({
      success: true,
      ...buildSimplifiAssetRegistryPreview({
        accounts: accountsResult.data ?? [],
        balances: latestBalances,
        existingAssets: assetsResult.data ?? [],
        scopeEvidence,
      }),
      readOnly: true,
    });
  } catch (error) {
    console.error("Simplifi asset registry preview error", error);
    return NextResponse.json({ error: "Unable to preview Simplifi asset accounts." }, { status: 500 });
  }
}
