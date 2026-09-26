import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { buildPropertyLedger } from "@/application/rental/propertyLedger";

// Dedicated property ledger read route — the Rentec-style per-property ledger:
// Date | Description | Debit | Credit | Balance, with a running balance.
//
// Sources: financial_events (income + expense, property-scoped), rental_contractor_payments,
// and succeeded rental_payments on the property's leases (rental income). Pure read model;
// the monolith GET /api/rental is intentionally untouched.
//
// Authorization: effective-owner/workspace scoping. The unit is looked up with
// owner_id = effectiveOwnerId, so a cross-workspace property id 404s. Co-owners resolve
// to the canonical owner id and see the shared books.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const rawPropertyId = new URL(request.url).searchParams.get("propertyId");
    if (!rawPropertyId || !rawPropertyId.trim()) {
      return NextResponse.json({ error: "propertyId is required." }, { status: 400 });
    }
    const propertyId = rawPropertyId.trim();

    const { data: units, error: unitsError } = await supabaseClient
      .from("rental_units")
      .select("id, property_id, label, status")
      .eq("owner_id", effectiveOwnerId)
      .or(`property_id.eq.${propertyId},id.eq.${propertyId}`);
    if (unitsError) throw unitsError;
    const unit = (units || [])[0] || null;
    if (!unit) {
      return NextResponse.json({ error: "Property was not found." }, { status: 404 });
    }
    const propertySlug = unit.property_id;
    const unitIds = (units || []).map((u) => u.id);

    const [
      eventsResult,
      contractorPaymentsResult,
      contractorsResult,
      paymentsResult,
      leasesResult,
      tenantsResult,
    ] = await Promise.all([
      // Paginated: PostgREST silently caps a plain .select() at 1000 rows.
      fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
        columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, metadata, status, is_deleted",
      }).then((data) => ({ data, error: null })).catch((caught) => ({ data: null, error: caught })),
      supabaseClient.from("rental_contractor_payments")
        .select("id, contractor_id, work_order_id, property_id, paid_at, amount_cents, payment_method, reference, invoice_reference, notes")
        .eq("owner_id", effectiveOwnerId)
        .or([`property_id.eq.${propertySlug}`, ...unitIds.map((id) => `property_id.eq.${id}`)].join(",")),
      supabaseClient.from("rental_contractors")
        .select("id, business_name, trade")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rental_payments")
        .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, status, payment_method, receipt_reference, notes, received_at, succeeded_at, created_at")
        .eq("owner_id", effectiveOwnerId)
        .order("created_at", { ascending: true }),
      supabaseClient.from("rental_leases")
        .select("id, unit_id, property_id, status, start_date, end_date")
        .eq("owner_id", effectiveOwnerId),
      supabaseClient.from("rental_tenants")
        .select("id, display_name")
        .eq("owner_id", effectiveOwnerId),
    ]);
    const failed = [eventsResult, contractorPaymentsResult, contractorsResult, paymentsResult, leasesResult, tenantsResult]
      .find((r) => r.error)?.error;
    if (failed) throw failed;

    const tenantsById = Object.fromEntries((tenantsResult.data || []).map((t) => [t.id, t]));

    const ledger = buildPropertyLedger({
      propertyId: propertySlug,
      propertyLabel: unit.label || propertySlug,
      unitIds,
      financialEvents: eventsResult.data || [],
      contractorPayments: contractorPaymentsResult.data || [],
      contractors: contractorsResult.data || [],
      rentalPayments: paymentsResult.data || [],
      leases: leasesResult.data || [],
      tenantsById,
    });

    return NextResponse.json({
      success: true,
      actingUserId: authenticated.user.id,
      canonicalOwnerId: effectiveOwnerId,
      unit,
      ledger,
    });
  } catch (error) {
    console.error("Property ledger query error", error);
    return NextResponse.json({ error: "Unable to load the property ledger." }, { status: 500 });
  }
}
