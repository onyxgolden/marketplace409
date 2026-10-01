import { NextResponse } from "next/server";
import { createAuthenticatedTenantPortalApplication } from "@/lib/supabase/createAuthenticatedTenantPortalApplication";
import { loadTenantLedgerData } from "@/application/rental/loadTenantLedgerData";
import { buildTenantPaymentLedger } from "@/application/rental/tenantPaymentLedger";
import { buildTenantStatementPeriod, normalizeStatementPeriod } from "@/application/rental/tenantStatementPeriod";

export const runtime = "nodejs";

// Tenant portal statement — Rentec parity R14. The tenant's own ledger,
// period-sliced (one calendar month) with opening balance, line items with
// running balances, and closing balance. It is the same read model the owner
// sees on the tenant ledger (buildTenantPaymentLedger), scoped to the
// signed-in tenant only.
//
// Security (highest-risk part of this slice):
//   1. The tenant identity comes from the authenticated session ONLY. A
//      tenantId query parameter that does not match the session's tenant is
//      rejected with 403 — tenant A can never ask for tenant B's statement.
//   2. Every query runs through the tenant's RLS-scoped client (the same
//      client as GET /api/rental/portal): the row-level policies
//      independently limit all reads to this tenant's own lease data.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedTenantPortalApplication();
    if (authenticated.response) return authenticated.response;

    const { data: tenantRow, error: tenantError } = await authenticated.supabaseClient
      .from("rental_tenants").select("id, owner_id, display_name, email")
      .eq("auth_user_id", authenticated.user.id).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenantRow) {
      return NextResponse.json({ error: "No tenant portal access is linked to this account." }, { status: 404 });
    }

    const url = new URL(request.url);
    const requestedTenantId = url.searchParams.get("tenantId");
    if (requestedTenantId && requestedTenantId !== tenantRow.id) {
      return NextResponse.json({ error: "Statements are only available for your own account." }, { status: 403 });
    }

    let period;
    try {
      period = normalizeStatementPeriod(url.searchParams.get("period"));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "period must be YYYY-MM." }, { status: 400 });
    }

    // RLS-scoped client + the session's own tenant id: the loader cannot see
    // another tenant's rows even if it were handed the wrong id.
    const loaded = await loadTenantLedgerData(authenticated.supabaseClient, tenantRow.owner_id, tenantRow.id);
    const ledger = buildTenantPaymentLedger({
      tenantId: tenantRow.id, charges: loaded.charges, payments: loaded.payments,
      settlements: loaded.settlements, leases: loaded.leases,
      leaseMemberships: loaded.leaseMemberships, units: loaded.units,
      rentecImports: loaded.rentecImports, credits: loaded.credits,
      creditApplications: loaded.creditApplications,
    });
    const sliced = buildTenantStatementPeriod({
      entries: ledger.entries, periodStart: period.start, periodEndExclusive: period.endExclusive,
    });
    const context = ledger.entries[0] || null;
    // Project each line to the statement's display fields only — ledger entries
    // carry operational detail (payment notes, deposit state, settlement
    // evidence) that the portal does not otherwise show the tenant.
    const lines = sliced.entries.map((line) => ({
      id: line.id,
      kind: line.kind,
      date: line.date,
      label: line.label,
      status: line.status,
      method: line.method,
      period: line.period,
      reference: line.reference,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      balanceAfterCents: line.balanceAfterCents,
      remainingCents: line.remainingCents ?? null,
    }));
    return NextResponse.json({
      success: true,
      statement: Object.freeze({
        tenantName: loaded.tenant?.display_name || tenantRow.display_name,
        propertyLabel: context?.propertyLabel && !String(context.propertyLabel).startsWith("Unknown")
          ? String(context.propertyLabel) : null,
        unitLabel: context?.unitLabel && !String(context.unitLabel).startsWith("Unknown")
          ? String(context.unitLabel) : null,
        period: Object.freeze({ start: period.start, end: period.end, label: period.label }),
        openingBalanceCents: sliced.openingBalanceCents,
        entries: lines,
        closingBalanceCents: sliced.closingBalanceCents,
        totals: sliced.totals,
      }),
    });
  } catch (error) {
    console.error("Tenant statement error", error);
    return NextResponse.json({ error: "Unable to load your statement." }, { status: 500 });
  }
}
