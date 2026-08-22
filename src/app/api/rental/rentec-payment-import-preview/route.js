import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { buildRentecPaymentImportPreview } from "@/domains/rental-payment-reconciliation/rentecPaymentImportPreview";

// Read-only, end to end. Never writes anything — mirrors reconciliation-preview/route.js's
// "preview only" contract. Scoped to one Rentec property per call (the same "one property at a
// time" boundary already used by the units/tenants/leases import), and bounded to a fixed page
// count so a single request can never run away against a very large ledger.
const MAX_TRANSACTION_PAGES = 50;

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const body = await request.json();
    const propertyId = String(body?.propertyId || "").trim();
    if (!/^\d+$/.test(propertyId)) return NextResponse.json({ error: "A valid Rentec property id is required." }, { status: 400 });

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;

    const client = createRentecApiClient();
    const rentecTransactions = [];
    let page = 1;
    for (; page <= MAX_TRANSACTION_PAGES; page++) {
      const result = await client.transactionLedger({ propertyId, page });
      rentecTransactions.push(...result.transactions);
      if (!result.moreRecords) break;
    }

    const [tenantsResult, unitsResult, leasesResult, leaseTenantsResult, schedulesResult, chargesResult, importsResult] = await Promise.all([
      database.from("rental_tenants").select("id, source_record_id").eq("owner_id", ownerId).eq("source_system", "rentec"),
      database.from("rental_units").select("id, source_record_id").eq("owner_id", ownerId).eq("source_system", "rentec"),
      database.from("rental_leases").select("id, unit_id").eq("owner_id", ownerId),
      database.from("rental_lease_tenants").select("lease_id, tenant_id").eq("owner_id", ownerId),
      database.from("rent_schedules").select("id, lease_id, collection_mode, effective_start_date").eq("owner_id", ownerId),
      database.from("rent_charges").select("id, lease_id, period, due_date, amount_cents, paid_amount_cents, status").eq("owner_id", ownerId),
      database.from("rentec_transaction_imports")
        .select("rentec_transaction_id, lease_id, charge_id, amount_cents, transaction_date, category_name, rentec_renter_id, rentec_property_id")
        .eq("owner_id", ownerId).eq("status", "applied"),
    ]);
    const fetchError = tenantsResult.error || unitsResult.error || leasesResult.error || leaseTenantsResult.error
      || schedulesResult.error || chargesResult.error || importsResult.error;
    if (fetchError) throw fetchError;

    const preview = buildRentecPaymentImportPreview({
      rentecTransactions,
      tenants: (tenantsResult.data || []).map((row) => ({ id: row.id, rentecRenterId: row.source_record_id })),
      units: (unitsResult.data || []).map((row) => ({ id: row.id, rentecPropertyId: row.source_record_id })),
      leases: (leasesResult.data || []).map((row) => ({ id: row.id, unitId: row.unit_id })),
      leaseTenants: (leaseTenantsResult.data || []).map((row) => ({ leaseId: row.lease_id, tenantId: row.tenant_id })),
      schedules: (schedulesResult.data || []).map((row) => ({
        id: row.id, leaseId: row.lease_id, collectionMode: row.collection_mode, effectiveStartDate: row.effective_start_date,
      })),
      charges: (chargesResult.data || []).map((row) => ({
        id: row.id, leaseId: row.lease_id, period: row.period, dueDate: row.due_date,
        amountCents: Number(row.amount_cents), paidAmountCents: Number(row.paid_amount_cents), status: row.status,
      })),
      alreadyImportedTransactions: (importsResult.data || []).map((row) => ({
        transactionId: row.rentec_transaction_id, leaseId: row.lease_id, chargeId: row.charge_id,
        amountCents: Number(row.amount_cents), transactionDate: row.transaction_date, categoryName: row.category_name,
        renterId: row.rentec_renter_id, propertyId: row.rentec_property_id,
      })),
    });

    return NextResponse.json({
      success: true, status: "preview_only",
      notice: "Preparatory preview only — no data was written. Approve specific matched transactions separately to apply them.",
      importBatchId: `rentec_import_batch_${crypto.randomUUID()}`,
      propertyId, pagesFetched: page, preview,
    });
  } catch (error) {
    console.error("Rentec payment import preview error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview Rentec payments." }, { status: 500 });
  }
}
