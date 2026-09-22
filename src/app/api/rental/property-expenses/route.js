import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { buildPropertyExpenseLedger } from "@/application/rental/propertyExpenseLedger";

// Dedicated property expenses-history read route. The monolith GET /api/rental is
// intentionally untouched: this route resolves one property (by property_id slug or unit
// id), pulls that property's expense financial_events plus its contractor payments, and
// builds the read model with the pure propertyExpenseLedger builder.
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

    const [eventsResult, contractorPaymentsResult, contractorsResult] = await Promise.all([
      // Paginated: PostgREST silently caps a plain .select() at 1000 rows, and this owner
      // has more financial_events history than that. Same helper the monolith uses.
      fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
        columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, metadata, status, is_deleted, business_scope",
      }).then((data) => ({ data, error: null })).catch((caught) => ({ data: null, error: caught })),
      supabaseClient.from("rental_contractor_payments")
        .select("id, contractor_id, work_order_id, property_id, paid_at, amount_cents, payment_method, reference, invoice_reference, notes")
        .eq("owner_id", effectiveOwnerId)
        .or(`property_id.eq.${unit.property_id},property_id.eq.${unit.id}`)
        .order("paid_at", { ascending: false }),
      supabaseClient.from("rental_contractors")
        .select("id, business_name, trade")
        .eq("owner_id", effectiveOwnerId),
    ]);
    const failed = [eventsResult, contractorPaymentsResult, contractorsResult].find((r) => r.error)?.error;
    if (failed) throw failed;

    const ledger = buildPropertyExpenseLedger({
      propertyId: unit.property_id,
      unitId: unit.id,
      financialEvents: eventsResult.data || [],
      contractorPayments: contractorPaymentsResult.data || [],
      contractors: contractorsResult.data || [],
    });

    return NextResponse.json({
      success: true,
      actingUserId: authenticated.user.id,
      canonicalOwnerId: effectiveOwnerId,
      unit,
      ledger,
    });
  } catch (error) {
    console.error("Property expenses query error", error);
    return NextResponse.json({ error: "Unable to load the property expense history." }, { status: 500 });
  }
}
