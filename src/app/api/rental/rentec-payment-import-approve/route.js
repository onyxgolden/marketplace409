import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { buildRentecPaymentImportPreview } from "@/domains/rental-payment-reconciliation/rentecPaymentImportPreview";

// The one route in this workflow that writes anything — deliberately separate from the preview
// route, same reasoning as rentec-commit/route.js. A caller's request only ever names WHICH
// transactionId/leaseId/chargeId pairing they want approved — the financial facts actually applied
// (amount, date, category) always come from a fresh Rentec re-fetch and a freshly recomputed match
// here, exactly mirroring the preview classification, never from the request body. A caller cannot
// fabricate a "Rentec external" payment, or redirect a real transaction onto a different charge,
// by constructing a POST body: anything that doesn't match the fresh recomputation is rejected
// before the RPC is ever called. Every entry is then applied through
// approve_rentec_payment_import(), which independently rechecks the charge/schedule against
// current database state and is idempotent. Each entry is its own RPC call/transaction, so one
// rejected or failed item never blocks or rolls back the others in the same batch.
const MAX_TRANSACTION_PAGES = 50;

function isValidApproval(entry) {
  return entry && typeof entry.transactionId === "string" && entry.transactionId.trim() !== ""
    && typeof entry.leaseId === "string" && entry.leaseId.trim() !== ""
    && typeof entry.chargeId === "string" && entry.chargeId.trim() !== "";
}

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const body = await request.json();
    const importBatchId = String(body?.importBatchId || "").trim();
    const propertyId = String(body?.propertyId || "").trim();
    const approvals = Array.isArray(body?.approvals) ? body.approvals : [];
    if (!importBatchId) return NextResponse.json({ error: "importBatchId is required." }, { status: 400 });
    if (!/^\d+$/.test(propertyId)) return NextResponse.json({ error: "A valid Rentec property id is required." }, { status: 400 });
    if (approvals.length === 0) return NextResponse.json({ error: "At least one approved transaction is required." }, { status: 400 });
    if (approvals.length > 200) return NextResponse.json({ error: "Approve at most 200 transactions per batch." }, { status: 400 });
    if (!approvals.every(isValidApproval)) {
      return NextResponse.json({ error: "Every approval requires transactionId, leaseId, and chargeId." }, { status: 400 });
    }

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;

    const client = createRentecApiClient();
    const rentecTransactions = [];
    for (let page = 1; page <= MAX_TRANSACTION_PAGES; page++) {
      const result = await client.transactionLedger({ propertyId, page });
      rentecTransactions.push(...result.transactions);
      if (!result.moreRecords) break;
    }
    const rentecTransactionById = new Map(rentecTransactions.map((txn) => [txn.transactionId, txn]));

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

    const freshPreview = buildRentecPaymentImportPreview({
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
    const freshByTransactionId = new Map(freshPreview.items.map((item) => [item.transactionId, item]));

    const results = [];
    for (const entry of approvals) {
      const fresh = freshByTransactionId.get(entry.transactionId);
      if (!fresh || fresh.classification !== "matched" || fresh.leaseId !== entry.leaseId || fresh.chargeId !== entry.chargeId) {
        results.push({
          transactionId: entry.transactionId, status: "error",
          reason: "This transaction's Rentec evidence or match has changed since it was previewed. Re-preview before approving.",
        });
        continue;
      }
      const rentecTransaction = rentecTransactionById.get(entry.transactionId);
      const { data, error } = await database.rpc("approve_rentec_payment_import", {
        p_owner_id: ownerId,
        p_lease_id: fresh.leaseId,
        p_charge_id: fresh.chargeId,
        p_rentec_transaction_id: entry.transactionId,
        p_amount_cents: fresh.amountCents,
        p_transaction_date: rentecTransaction?.transactionDate || null,
        p_category_name: rentecTransaction?.categoryName || null,
        p_rentec_renter_id: rentecTransaction?.renterId || null,
        p_rentec_property_id: rentecTransaction?.propertyId || null,
        p_import_batch_id: importBatchId,
      });
      if (error) {
        results.push({ transactionId: entry.transactionId, status: "error", reason: error.message });
        continue;
      }
      results.push({ transactionId: entry.transactionId, ...data });
    }

    return NextResponse.json({ success: true, importBatchId, results });
  } catch (error) {
    console.error("Rentec payment import approval error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to approve Rentec payment import." }, { status: 500 });
  }
}
