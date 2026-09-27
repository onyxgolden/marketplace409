import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { buildBankLedger } from "@/application/rental/bankLedger";

// Dedicated bank account ledger read route — the bank register: Date,
// Description, Check #, Debit, Credit, Balance, C/leared, per-row edit for
// manual entries. Bank entries that name a property or tenant also carry the
// labels so the register can link back to those ledgers; transfer legs carry
// their transfer-group and counterpart metadata.
//
// Sources: financial_events rows linked to the account via bank_account_id.
// Pure read model; the monolith GET /api/rental is intentionally untouched.
//
// Authorization: effective-owner/workspace scoping. The account is looked up with
// owner_id = effectiveOwnerId, so a cross-workspace account id 404s. Co-owners
// resolve to the canonical owner id and see the shared books.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const rawBankAccountId = new URL(request.url).searchParams.get("bankAccountId");
    if (!rawBankAccountId || !rawBankAccountId.trim()) {
      return NextResponse.json({ error: "bankAccountId is required." }, { status: 400 });
    }
    const bankAccountId = rawBankAccountId.trim();

    const { data: accounts, error: accountError } = await supabaseClient
      .from("financial_accounts")
      .select("id, name, official_name, type, active")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", bankAccountId)
      .limit(1);
    if (accountError) throw accountError;
    const account = (accounts || [])[0] || null;
    if (!account) {
      return NextResponse.json({ error: "Bank account was not found." }, { status: 404 });
    }

    // Paginated: PostgREST silently caps a plain .select() at 1000 rows.
    const events = await fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
      columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, payee, check_number, bank_account_id, cleared, cleared_at, source_system, status, is_deleted, transfer_group_id, metadata",
    });
    const accountEvents = (events || []).filter((event) => event.bank_account_id === bankAccountId);

    // Property / tenant labels for cross-links back to those ledgers. The
    // labels live on rental_units / rental_tenants; RLS scopes both to the
    // caller's workspace, so no explicit owner predicate is needed here.
    const [unitsResult, tenantsResult] = await Promise.all([
      supabaseClient.from("rental_units").select("property_id, label"),
      supabaseClient.from("rental_tenants").select("id, display_name"),
    ]);
    const unitLabelByPropertyId = new Map(
      ((unitsResult && unitsResult.data) || []).map((unit) => [unit.property_id, unit.label]),
    );
    const tenantLabelById = new Map(
      ((tenantsResult && tenantsResult.data) || []).map((tenant) => [tenant.id, tenant.display_name]),
    );
    for (const event of accountEvents) {
      if (event.property_id && unitLabelByPropertyId.has(event.property_id)) {
        event.property_label = unitLabelByPropertyId.get(event.property_id);
      }
      const tenantId = event.metadata?.tenant_id;
      if (tenantId) {
        event.tenant_id = tenantId;
        if (tenantLabelById.has(tenantId)) event.tenant_label = tenantLabelById.get(tenantId);
      }
    }

    const ledger = buildBankLedger({
      financialEvents: accountEvents,
      accountName: account.official_name || account.name || account.id,
    });

    return NextResponse.json({
      success: true,
      actingUserId: authenticated.user.id,
      canonicalOwnerId: effectiveOwnerId,
      account: { id: account.id, name: account.name, officialName: account.official_name, type: account.type, active: account.active },
      ledger,
    });
  } catch (error) {
    console.error("Bank ledger query error", error);
    return NextResponse.json({ error: "Unable to load the bank ledger." }, { status: 500 });
  }
}
