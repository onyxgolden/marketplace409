import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { aggregate1099Year, FORM_TYPE_GUIDE, REPORTING_THRESHOLD_CENTS } from "@/application/rental/tax1099";

// R23 — 1099 year summary: aggregate reportable payments per recipient.
// GET /api/rental/1099/summary?taxYear=2026
// Read-only members may read (it is a report, not a write).
//
// Cash basis: an ACTIVE vendor payment counts in the tax year of its
// payment_date (read from the merged R3/R4 rental_vendor_payments table —
// R23 creates no second payment system). Voided payments never count.
// Owner distributions arrive as rental_1099_payment_entries rows:
//   - source 'manual' / 'adjustment' — Brandy's today path (entered on the
//     Tax / 1099 surface until R9 exists);
//   - source 'r9_owner_distribution' — the R9 owner-statement/disbursement
//     system is NOT on origin/main yet, so there is no R9 table to read.
//     When R9 merges, its disbursement loader feeds this same entries array
//     (see the adapter note in aggregate1099Year) — no schema change needed.
//
// Recipients under the $600 IRS threshold are NOT dropped silently: they are
// returned with thresholdMet=false and an exclusionReason so the UI flags
// exactly who was excluded and why.

const RECIPIENT_COLUMNS =
  "id, kind, linked_vendor_id, display_name, entity_type, address_line1, city, state, zip, tin_ciphertext, tin_last4, tin_type, is_active";

function defaultTaxYear() {
  return new Date().getFullYear();
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const rawYear = url.searchParams.get("taxYear");
    const taxYear = rawYear ? Number(rawYear) : defaultTaxYear();
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json({ error: "Tax year must be a valid year (e.g. 2026)." }, { status: 400 });
    }

    const { data: recipients, error: recipientsError } = await supabaseClient
      .from("rental_1099_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("is_active", true)
      .order("display_name");
    if (recipientsError) throw recipientsError;

    const yearStart = `${taxYear}-01-01`;
    const yearEnd = `${taxYear}-12-31`;
    const { data: vendorPayments, error: paymentsError } = await supabaseClient
      .from("rental_vendor_payments")
      .select("vendor_id, payment_date, amount_cents, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("status", "active")
      .gte("payment_date", yearStart)
      .lte("payment_date", yearEnd);
    if (paymentsError) throw paymentsError;

    const { data: paymentEntries, error: entriesError } = await supabaseClient
      .from("rental_1099_payment_entries")
      .select("recipient_id, tax_year, amount_cents, status, source")
      .eq("owner_id", effectiveOwnerId)
      .eq("tax_year", taxYear)
      .eq("status", "active");
    if (entriesError) throw entriesError;

    const { data: filingStates, error: statesError } = await supabaseClient
      .from("rental_1099_filing_states")
      .select("recipient_id, tax_year, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("tax_year", taxYear);
    if (statesError) throw statesError;

    // Gross-rent basis (R23 CHANGES fix): Box 1 for owners comes from the
    // ledger, not from net disbursements. Load each owner recipient's linked
    // properties, then sum rental_income events on those properties.
    const { data: recipientProperties, error: propsError } = await supabaseClient
      .from("rental_1099_recipient_properties")
      .select("recipient_id, property_id")
      .eq("owner_id", effectiveOwnerId);
    if (propsError) throw propsError;

    const propertyIdsByRecipient = new Map();
    for (const link of recipientProperties || []) {
      if (!propertyIdsByRecipient.has(link.recipient_id)) {
        propertyIdsByRecipient.set(link.recipient_id, new Set());
      }
      propertyIdsByRecipient.get(link.recipient_id).add(link.property_id);
    }

    const allPropertyIds = [...new Set((recipientProperties || []).map((link) => link.property_id))];
    let grossRentEvents = [];
    if (allPropertyIds.length > 0) {
      const { data: events, error: eventsError } = await supabaseClient
        .from("financial_events")
        .select("property_id, event_date, amount")
        .eq("owner_id", effectiveOwnerId)
        .eq("transaction_kind", "income")
        .eq("normalized_category", "rental_income")
        .eq("status", "active")
        .eq("is_deleted", false)
        .in("property_id", allPropertyIds)
        .gte("event_date", yearStart)
        .lte("event_date", yearEnd);
      if (eventsError) throw eventsError;
      grossRentEvents = events || [];
    }

    const grossRentByRecipient = new Map();
    for (const [recipientId, propertyIds] of propertyIdsByRecipient) {
      let totalCents = 0;
      let eventCount = 0;
      for (const event of grossRentEvents) {
        if (!propertyIds.has(event.property_id)) continue;
        totalCents += Math.round(Number(event.amount || 0) * 100);
        eventCount += 1;
      }
      grossRentByRecipient.set(recipientId, { totalCents, eventCount });
    }

    // Owner payment entries: only 'adjustment' sources count toward Box 1
    // (CPA corrections). 'manual' / 'r9_owner_distribution' are disbursements.
    // Vendor entries keep all sources (they are 1099-NEC compensation).
    const recipientKindById = new Map((recipients || []).map((r) => [r.id, r.kind]));
    const filteredEntries = (paymentEntries || []).filter((entry) => {
      if (recipientKindById.get(entry.recipient_id) === "owner") {
        return entry.source === "adjustment";
      }
      return true;
    });

    const { rows, summary } = aggregate1099Year({
      recipients: recipients || [],
      vendorPayments: vendorPayments || [],
      paymentEntries: filteredEntries,
      filingStates: filingStates || [],
      grossRentByRecipient,
      linkedPropertyIdsByRecipient: propertyIdsByRecipient,
      taxYear,
    });

    return NextResponse.json({
      success: true,
      taxYear,
      rows,
      summary,
      thresholdCents: REPORTING_THRESHOLD_CENTS,
      formGuide: FORM_TYPE_GUIDE,
      complianceNote:
        "Filing deadlines and rules change — confirm with your CPA; this is not tax advice.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to build the 1099 year summary." }, { status: 500 });
  }
}
