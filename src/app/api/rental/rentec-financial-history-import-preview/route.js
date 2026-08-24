import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { buildRentecFinancialHistoryImportPreview } from "@/domains/rentec-financial-history-import/rentecFinancialHistoryImportPreview";
import { fetchAllRentecFinancialHistoryTransactions } from "@/domains/rentec-financial-history-import/fetchAllRentecFinancialHistoryTransactions";
import { buildRentecFinancialHistoryImportBatchPlan } from "@/domains/rentec-financial-history-import/rentecFinancialHistoryImportBatchPlan";

// Read-only, end to end — never writes anything, mirrors the "preview only" contract already used
// by rentec-payment-import-preview/route.js and reconciliation-preview/route.js. Unlike the payment
// reconciliation preview (scoped to one FORGE-linked property per call), this covers the whole
// account in one pass: the goal is to see every place Rentec's own financial history and FORGE's
// financial_events table have drifted apart, including properties that were never linked into
// rental_units at all (e.g. archived properties, or properties only ever touched by the historical
// CSV import). client.inventory() already fetches Rentec properties with archived:true, so nothing
// is silently excluded here.

export async function POST() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const ownerId = authenticated.user.id;
    const database = authenticated.supabaseClient;

    const client = createRentecApiClient();
    const inventory = await client.inventory();
    const propertyLabelById = new Map(inventory.propertyReferences.map((property) => [property.id, property.label]));

    const { rentecTransactions, fetchSummary: bareFetchSummary } = await fetchAllRentecFinancialHistoryTransactions(client, inventory.propertyIds);
    const fetchSummary = bareFetchSummary.map((entry) => ({ ...entry, label: propertyLabelById.get(entry.rentecPropertyId) || null }));

    const { data: existingFinancialEvents, error: fetchError } = await database
      .from("financial_events")
      .select("id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, status, is_deleted")
      .eq("owner_id", ownerId);
    if (fetchError) throw fetchError;

    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions,
      existingFinancialEvents: existingFinancialEvents || [],
      propertyLabelById,
    });

    // batchPlan is the shape the authenticated import-control UI actually drives off — one row per
    // year with counts/dollar totals and the sourceRecordIds needed to approve it, with every
    // "Commissions"-category row (real-estate-purchase collision risk — see
    // rentecFinancialHistoryImportBatchPlan.js) already held back out of every year's batch.
    const batchPlan = buildRentecFinancialHistoryImportBatchPlan(preview.items);

    return NextResponse.json({
      success: true, status: "preview_only",
      notice: "Preparatory preview only — no data was written. Approve the safe-missing rows separately to import them.",
      propertiesScanned: inventory.propertyIds.length,
      fetchSummary,
      preview,
      batchPlan,
    });
  } catch (error) {
    console.error("Rentec financial history import preview error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview the Rentec financial history import." }, { status: 500 });
  }
}
