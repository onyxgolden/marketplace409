import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { buildRentecPaymentImportPreview } from "@/domains/rental-payment-reconciliation/rentecPaymentImportPreview";

// Read-only, end to end. Never writes anything — mirrors reconciliation-preview/route.js's
// "preview only" contract. Scoped to one Rentec property per call (the same "one property at a
// time" boundary already used by the units/tenants/leases import), and bounded to a fixed page
// count so a single request can never run away against a very large ledger.
//
// propertyId in the request body is a FORGE property (rental_units.id) the browser picked from
// this owner's own linked-properties list — never a raw Rentec provider id. The real Rentec
// property id is resolved here, from that unit's stored source_record_id, scoped to the
// authenticated owner. An arbitrary or cross-owner value never reaches the Rentec API: a
// propertyId that isn't one of this owner's own Rentec-linked units is rejected before any Rentec
// call is made.
const MAX_TRANSACTION_PAGES = 50;

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const body = await request.json();
    const forgePropertyId = String(body?.propertyId || "").trim();
    if (!forgePropertyId) return NextResponse.json({ error: "A property is required." }, { status: 400 });

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;

    const { data: linkedUnit, error: linkedUnitError } = await database.from("rental_units")
      .select("id, source_record_id").eq("owner_id", ownerId).eq("id", forgePropertyId).eq("source_system", "rentec")
      .not("source_record_id", "is", null).maybeSingle();
    if (linkedUnitError) throw linkedUnitError;
    if (!linkedUnit) return NextResponse.json({ error: "This property is not linked to Rentec, or does not belong to your account." }, { status: 404 });
    const rentecPropertyId = linkedUnit.source_record_id;

    const client = createRentecApiClient();
    const rentecTransactions = [];
    let page = 1;
    for (; page <= MAX_TRANSACTION_PAGES; page++) {
      const result = await client.transactionLedger({ propertyId: rentecPropertyId, page });
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
      // propertyId is the FORGE property the browser picked; rentecPropertyId is the real Rentec
      // provider id resolved server-side from it. Approval keeps using rentecPropertyId — the
      // browser never has to (and never should) know or handle the raw Rentec id itself.
      propertyId: forgePropertyId, rentecPropertyId, pagesFetched: page, preview,
    });
  } catch (error) {
    console.error("Rentec payment import preview error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview Rentec payments." }, { status: 500 });
  }
}
