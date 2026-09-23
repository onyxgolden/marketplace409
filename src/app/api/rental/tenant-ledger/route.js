import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { buildTenantPaymentLedger, buildTenantDepositHistory } from "@/application/rental/tenantPaymentLedger";
import { buildImportedRentecHistory } from "@/application/rental/importedRentecHistory";

// Dedicated tenant payment-history read route. The monolith GET /api/rental is intentionally
// untouched: this route fetches the FULL authoritative record sets a ledger needs (all charge
// statuses, all payments, settlements, deposits, Rentec import links) scoped to one tenant,
// and builds the read model with the pure tenantPaymentLedger builders.
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

    const { data: tenant, error: tenantError } = await supabaseClient
      .from("rental_tenants")
      .select("id, display_name, email, status, source_record_id")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", tenantId.trim())
      .maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) {
      return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
    }

    // Imported Rentec transactions: read-only accounting evidence for the tenant card.
    // The migration set source_record_id on Rentec-origin tenants, and the Rentec
    // financial-history import stores the Rentec renter id in the event metadata —
    // the join is the migration's own identity linkage, never a guess. Tenants
    // without a migration renter id skip this fetch entirely.
    const renterId = tenant.source_record_id ? String(tenant.source_record_id) : null;
    const importedHistoryQuery = renterId
      ? supabaseClient.from("financial_events")
        .select("id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_record_id, metadata, status, is_deleted")
        .eq("owner_id", effectiveOwnerId)
        .eq("transaction_kind", "income")
        .eq("is_deleted", false)
        .filter("metadata->>rentec_renter_id", "eq", renterId)
      : Promise.resolve({ data: [], error: null });

    const [
      chargesResult, paymentsResult, settlementsResult, leasesResult, membershipsResult,
      unitsResult, rentecResult, depositsResult, depositTransactionsResult, importedHistoryResult,
    ] = await Promise.all([
      // All statuses: history must include paid and voided charges, not just open ones.
      supabaseClient.from("rent_charges")
        .select("id, lease_id, schedule_id, period, due_date, amount_cents, paid_amount_cents, currency_code, status, charge_type")
        .eq("owner_id", effectiveOwnerId).order("due_date", { ascending: true }),
      supabaseClient.from("rental_payments")
        .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, currency_code, status, payment_method, receipt_reference, notes, received_at, succeeded_at, created_at")
        .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id).order("created_at", { ascending: true }),
      supabaseClient.from("rental_settlements")
        .select("id, payment_id, status, net_amount_cents, provider_payout_id")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rental_leases").select("id, unit_id, property_id, status, start_date, end_date")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rental_lease_tenants").select("lease_id, tenant_id, occupancy_role")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rental_units").select("id, property_id, label, status")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rentec_transaction_imports")
        .select("id, rentec_transaction_id, lease_id, charge_id, payment_id, amount_cents, transaction_date, category_name, status")
        .eq("owner_id", effectiveOwnerId).eq("status", "applied"),
      supabaseClient.from("rental_security_deposits").select("*")
        .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id),
      supabaseClient.from("rental_security_deposit_transactions").select("*")
        .eq("owner_id", effectiveOwnerId).order("occurred_at", { ascending: true }),
      importedHistoryQuery,
    ]);
    const failed = [chargesResult, paymentsResult, settlementsResult, leasesResult, membershipsResult,
      unitsResult, rentecResult, depositsResult, depositTransactionsResult, importedHistoryResult].find((r) => r.error)?.error;
    if (failed) throw failed;

    const ledger = buildTenantPaymentLedger({
      tenantId: tenant.id,
      charges: chargesResult.data || [],
      payments: paymentsResult.data || [],
      settlements: settlementsResult.data || [],
      leases: leasesResult.data || [],
      leaseMemberships: membershipsResult.data || [],
      units: unitsResult.data || [],
      rentecImports: rentecResult.data || [],
    });
    const deposits = buildTenantDepositHistory({
      tenantId: tenant.id,
      deposits: depositsResult.data || [],
      depositTransactions: depositTransactionsResult.data || [],
    });

    // Dedup set: bare Rentec transaction ids already represented as authoritative
    // rental_payments via the payment-import flow (provider='rentec_external',
    // provider_payment_id=<bare transaction id>). Tenant-scoped — the payments query
    // above is already filtered to this tenant. The builder suppresses an imported
    // row only on this exact payment-identity tuple; financial_events.source_record_id
    // is the composite `${transactionId}:${splitId}` and is NOT used for dedup.
    const importedPaymentIds = new Set(
      (paymentsResult.data || [])
        .filter((payment) => payment.provider === "rentec_external" && payment.provider_payment_id)
        .map((payment) => String(payment.provider_payment_id)),
    );
    const importedHistory = buildImportedRentecHistory({
      renterId,
      events: importedHistoryResult.data || [],
      importedPaymentIds,
    });

    // Open charges this tenant can post income against: every charge on one of the
    // tenant's leases that is neither paid nor void and still has a remaining balance.
    // Sorted oldest-first so Post Income defaults to the oldest open charge, Rentec-style.
    const tenantLeaseIds = new Set(
      (membershipsResult.data || []).filter((m) => m.tenant_id === tenant.id).map((m) => m.lease_id),
    );
    const openCharges = (chargesResult.data || [])
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
      deposits,
      importedHistory,
      openCharges,
    });
  } catch (error) {
    console.error("Tenant ledger query error", error);
    return NextResponse.json({ error: "Unable to load the tenant payment history." }, { status: 500 });
  }
}
