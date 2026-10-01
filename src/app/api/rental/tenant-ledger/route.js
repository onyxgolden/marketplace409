import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { buildTenantPaymentLedger, buildTenantDepositHistory } from "@/application/rental/tenantPaymentLedger";
import { buildImportedRentecHistory } from "@/application/rental/importedRentecHistory";
import { loadTenantLedgerData } from "@/application/rental/loadTenantLedgerData";

// Dedicated tenant payment-history read route. The monolith GET /api/rental is intentionally
// untouched: this route fetches the FULL authoritative record sets a ledger needs (all charge
// statuses, all payments, settlements, deposits, Rentec import links) scoped to one tenant,
// and builds the read model with the pure tenantPaymentLedger builders. Record-set loading
// lives in loadTenantLedgerData (shared with the statement-email route) so the emailed
// statement and the printed ledger can never diverge at the data layer.
//
// Authorization: effective-owner/workspace scoping. The tenant row itself is looked up with
// owner_id = effectiveOwnerId, so a cross-workspace tenant id 404s — no history ever leaks
// across workspaces. Co-owners resolve to the canonical owner id and see the shared books.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const tenantId = new URL(request.url).searchParams.get("tenantId");
    if (!tenantId || !tenantId.trim()) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    let loaded;
    try {
      loaded = await loadTenantLedgerData(supabaseClient, effectiveOwnerId, tenantId.trim());
    } catch (error) {
      if (error?.code === "TENANT_NOT_FOUND") {
        return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
      }
      throw error;
    }
    const { tenant, charges, payments, settlements, leases, leaseMemberships, units,
      rentecImports, deposits, depositTransactions, importedHistoryEvents, renterId,
      credits, creditApplications } = loaded;

    const ledger = buildTenantPaymentLedger({
      tenantId: tenant.id,
      charges,
      payments,
      settlements,
      leases,
      leaseMemberships,
      units,
      rentecImports,
      credits,
      creditApplications,
    });
    const depositsHistory = buildTenantDepositHistory({
      tenantId: tenant.id,
      deposits,
      depositTransactions,
    });

    // Dedup set: bare Rentec transaction ids already represented as authoritative
    // rental_payments via the payment-import flow (provider='rentec_external',
    // provider_payment_id=<bare transaction id>). Tenant-scoped — the payments query
    // above is already filtered to this tenant. The builder suppresses an imported
    // row only on this exact payment-identity tuple; financial_events.source_record_id
    // is the composite `${transactionId}:${splitId}` and is NOT used for dedup.
    const importedPaymentIds = new Set(
      payments
        .filter((payment) => payment.provider === "rentec_external" && payment.provider_payment_id)
        .map((payment) => String(payment.provider_payment_id)),
    );
    const importedHistory = buildImportedRentecHistory({
      renterId,
      events: importedHistoryEvents,
      importedPaymentIds,
    });

    // Open charges this tenant can post income against: every charge on one of the
    // tenant's leases that is neither paid nor void and still has a remaining balance.
    // Sorted oldest-first so Post Income defaults to the oldest open charge, Rentec-style.
    const tenantLeaseIds = new Set(
      leaseMemberships.filter((m) => m.tenant_id === tenant.id).map((m) => m.lease_id),
    );
    const openCharges = charges
      .filter((charge) => tenantLeaseIds.has(charge.lease_id)
        && !["paid", "void"].includes(charge.status)
        && Number(charge.amount_cents || 0) - Number(charge.paid_amount_cents || 0) > 0)
      .map((charge) => ({
        id: charge.id,
        leaseId: charge.lease_id,
        period: charge.period || null,
        dueDate: charge.due_date || null,
        chargeType: charge.charge_type || "rent",
        amountCents: Number(charge.amount_cents || 0),
        paidCents: Number(charge.paid_amount_cents || 0),
        remainingCents: Number(charge.amount_cents || 0) - Number(charge.paid_amount_cents || 0),
        status: charge.status || "unknown",
      }))
      .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || ""))
        || String(a.id).localeCompare(String(b.id)));

    return NextResponse.json({
      success: true,
      actingUserId: authenticated.user.id,
      canonicalOwnerId: effectiveOwnerId,
      tenant,
      ledger,
      deposits: depositsHistory,
      importedHistory,
      openCharges,
      // Overpayment credits + their applications, for the ledger's credit section.
      // Additive only — the ledger entries above already carry the memo rows.
      credits,
      creditApplications,
    });
  } catch (error) {
    console.error("Tenant ledger query error", error);
    return NextResponse.json({ error: "Unable to load the tenant payment history." }, { status: 500 });
  }
}
