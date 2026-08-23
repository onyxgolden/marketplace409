import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { buildRentecFinancialHistoryImportPreview } from "@/domains/rentec-financial-history-import/rentecFinancialHistoryImportPreview";
import { fetchAllRentecFinancialHistoryTransactions } from "@/domains/rentec-financial-history-import/fetchAllRentecFinancialHistoryTransactions";

// The one route in this workflow that writes anything — deliberately separate from the preview
// route, same reasoning as rentec-payment-import-approve/route.js and rentec-commit/route.js. A
// caller's request only ever names WHICH sourceRecordId values it wants approved — the financial
// facts actually applied (property, date, amount, direction, category, provenance metadata) always
// come from a fresh Rentec re-fetch and a freshly recomputed classification here, exactly mirroring
// the preview, never from the request body. A caller cannot fabricate a financial_events row, or
// smuggle an ambiguous/conflict row through as if it were safe, by constructing a POST body:
// anything the fresh recomputation doesn't call safeMissing is rejected before the RPC is ever
// called. approve_rentec_financial_history_import() then independently revalidates every row's
// shape/semantics and is idempotent via financial_events' own unique index, so a retried or
// concurrently-resubmitted batch can never insert a duplicate.
//
// The fetch itself shares fetchAllRentecFinancialHistoryTransactions() with the preview route so the
// two paths can never apply a different (or missing) pagination safety cap — approval must never act
// on a source snapshot the preview never actually showed.
const MAX_ROWS_PER_RPC_CALL = 1000;

export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const body = await request.json();
    const importBatchId = String(body?.importBatchId || "").trim() || `rentec_financial_history_batch_${crypto.randomUUID()}`;
    const requestedSourceRecordIds = Array.isArray(body?.sourceRecordIds)
      ? [...new Set(body.sourceRecordIds.filter((id) => typeof id === "string" && id.trim() !== ""))]
      : [];
    if (requestedSourceRecordIds.length === 0) {
      return NextResponse.json({ error: "At least one approved sourceRecordId is required." }, { status: 400 });
    }

    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;

    const client = createRentecApiClient();
    const inventory = await client.inventory();
    const propertyLabelById = new Map(inventory.propertyReferences.map((property) => [property.id, property.label]));

    const { rentecTransactions } = await fetchAllRentecFinancialHistoryTransactions(client, inventory.propertyIds);

    const { data: existingFinancialEvents, error: fetchError } = await database
      .from("financial_events")
      .select("id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, status, is_deleted")
      .eq("owner_id", ownerId);
    if (fetchError) throw fetchError;

    const freshPreview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions,
      existingFinancialEvents: existingFinancialEvents || [],
      propertyLabelById,
    });
    const freshBySourceRecordId = new Map(freshPreview.items.map((item) => [item.sourceRecordId, item]));

    const rejected = [];
    const approvedRows = [];
    for (const sourceRecordId of requestedSourceRecordIds) {
      const fresh = freshBySourceRecordId.get(sourceRecordId);
      if (!fresh || fresh.classification !== "safeMissing") {
        rejected.push({
          sourceRecordId,
          reason: fresh
            ? `This row is now classified as "${fresh.classification}", not safe to import automatically. Re-preview before approving.`
            : "This row is no longer present in a fresh Rentec fetch. Re-preview before approving.",
        });
        continue;
      }
      approvedRows.push(fresh.financialEventRow);
    }

    if (approvedRows.length === 0) {
      return NextResponse.json({
        success: true, importBatchId, requestedCount: requestedSourceRecordIds.length,
        insertedCount: 0, skippedCount: 0, rejected,
      });
    }

    let insertedCount = 0;
    let skippedCount = 0;
    for (let start = 0; start < approvedRows.length; start += MAX_ROWS_PER_RPC_CALL) {
      const chunk = approvedRows.slice(start, start + MAX_ROWS_PER_RPC_CALL);
      const { data, error } = await database.rpc("approve_rentec_financial_history_import", {
        p_owner_id: ownerId,
        p_import_batch_id: importBatchId,
        p_rows: chunk,
      });
      if (error) throw error;
      insertedCount += data.insertedCount;
      skippedCount += data.skippedCount;
    }

    return NextResponse.json({
      success: true, importBatchId,
      requestedCount: requestedSourceRecordIds.length,
      insertedCount, skippedCount, rejected,
    });
  } catch (error) {
    console.error("Rentec financial history import approval error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to approve the Rentec financial history import." }, { status: 500 });
  }
}
