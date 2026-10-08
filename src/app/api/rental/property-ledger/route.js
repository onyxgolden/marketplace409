import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { propertySlugsResolvingTo } from "@/domains/property/propertyAliases";
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
const PAGE_SIZE = 1000;

// PostgREST silently caps a plain .select() at 1000 rows. Page through the full set
// for every source so a property with long history never gets a silently truncated
// ledger (and a wrong balance). Each query orders deterministically so paging is
// stable; buildPropertyLedger re-sorts chronologically anyway, so the order chosen
// here changes nothing downstream.
// PostgREST `or(...)` filter values are comma-separated, so each value is
// double-quoted: a stored slug or unit ID containing a reserved character
// (comma, parenthesis, quote) can then never be parsed as filter syntax.
// The slugs and unit IDs filtered on here are [a-z0-9-] in practice, but the
// expanded multi-value filters below stay correct by construction.
const orEqValue = (value) => `"${String(value).replace(/(["\\])/g, "\\$1")}"`;

export async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

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

    // Known limitations, deferred to separately scoped follow-ups (NOT fixed
    // here — see the PR #589 ChatGPT review, 2026-10-08):
    //  1. The units lookup above resolves ?propertyId= by exact match against
    //     rental_units.property_id or id, so addressing this ledger by a
    //     variant (alias) slug 404s. The UI addresses properties by their
    //     canonical rental_units.property_id, so the ledger is reached by
    //     canonical slug and every alias-tagged row shows once it is fetched.
    //  2. GET /api/rental/owner-movements?propertyId= filters its movement
    //     list by raw stored slug; canonicalized display filtering of that
    //     list is likewise deferred.

    const paged = (promise) =>
      promise.then((data) => ({ data, error: null })).catch((caught) => ({ data: null, error: caught }));

    const [
      eventsResult,
      contractorPaymentsResult,
      contractorsResult,
      paymentsResult,
      leasesResult,
      tenantsResult,
      attachmentsResult,
    ] = await Promise.all([
      // Paginated: PostgREST silently caps a plain .select() at 1000 rows.
      paged(fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
        columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_system, source_record_id, metadata, status, is_deleted, check_number, cleared, display_as, payee",
      })),
      // Contractor payments are filtered at the database, before
      // buildPropertyLedger runs, so the filter must name every stored slug
      // the builder's canonicalized comparison would accept: the canonical
      // slug plus each explicit alias key resolving to it
      // (propertySlugsResolvingTo — finite, alias-map derived, no fuzzy
      // matching). Unit IDs remain exact matches, never canonicalized.
      // Owner scoping is the eq("owner_id") below, unchanged.
      paged(fetchAllPages(() => supabaseClient.from("rental_contractor_payments")
        .select("id, contractor_id, work_order_id, property_id, paid_at, amount_cents, payment_method, reference, invoice_reference, notes")
        .eq("owner_id", effectiveOwnerId)
        .or([...propertySlugsResolvingTo(propertySlug), ...unitIds]
          .map((ref) => `property_id.eq.${orEqValue(ref)}`)
          .join(","))
        .order("id", { ascending: true }))),
      paged(fetchAllPages(() => supabaseClient.from("rental_contractors")
        .select("id, business_name, trade")
        .eq("owner_id", effectiveOwnerId)
        .order("id", { ascending: true }))),
      paged(fetchAllPages(() => supabaseClient.from("rental_payments")
        .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, status, payment_method, receipt_reference, notes, received_at, succeeded_at, created_at")
        .eq("owner_id", effectiveOwnerId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }))),
      paged(fetchAllPages(() => supabaseClient.from("rental_leases")
        .select("id, unit_id, property_id, status, start_date, end_date")
        .eq("owner_id", effectiveOwnerId)
        .order("id", { ascending: true }))),
      paged(fetchAllPages(() => supabaseClient.from("rental_tenants")
        .select("id, display_name")
        .eq("owner_id", effectiveOwnerId)
        .order("id", { ascending: true }))),
      // Attachment presence per event — just the ids, counted in JS.
      paged(fetchAllPages(() => supabaseClient.from("financial_event_attachments")
        .select("event_id")
        .eq("owner_id", effectiveOwnerId)
        .order("event_id", { ascending: true }))),
    ]);
    const failed = [eventsResult, contractorPaymentsResult, contractorsResult, paymentsResult, leasesResult, tenantsResult, attachmentsResult]
      .find((r) => r.error)?.error;
    if (failed) throw failed;

    const tenantsById = Object.fromEntries((tenantsResult.data || []).map((t) => [t.id, t]));
    const attachmentEventIds = new Set((attachmentsResult.data || []).map((row) => row.event_id));

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
      attachmentEventIds,
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
