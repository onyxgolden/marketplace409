import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { aggregate1099Year, decryptTin, resolveFormType } from "@/application/rental/tax1099";
import { build1099FireExport, build1099SummaryCsv } from "@/application/rental/build1099FireExport";
import { loadPayerProfileForExport } from "@/app/api/rental/1099/payer-profile/route";

// R23 — 1099 export file generation.
// GET /api/rental/1099/export?taxYear=2026&format=fire|csv
// PRIMARY OWNER / ACTIVE CO-OWNER ONLY. This is the ONLY endpoint that
// decrypts full TINs, and it returns them solely inside the generated file
// (the FIRE file needs the full payee TINs; the CSV companion carries masked
// TINs). Managers, bookkeepers, and read-only members get 403 — a full TIN
// is the keys to identity theft and never leaves the owner's hands.
//
// GUIDANCE ONLY — NOT IRS-CERTIFIED. The file layout is modeled on IRS
// Publication 1220 (FIRE); see src/application/rental/IRS_FIRE_FORMAT.md.
// The CPA must validate against the current-year Pub 1220 before any real
// filing. Do not present this export as IRS-certified.
//
// Side effect: recipients included in a successful FIRE export move to filing
// status 'exported' (not_started -> ready -> exported applied atomically;
// already-filed_manually recipients are left untouched; re-export refreshes
// exported_at).

async function requireOwnerOrCoOwner(authenticated) {
  const role = await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id });
  // Primary owners have no workspace_members row (null role); active
  // co-owners have role 'co_owner'. Everyone else — manager, bookkeeper,
  // read_only — is denied: full TINs never leave the owner's hands.
  if (role !== null && role !== "co_owner") {
    return NextResponse.json({ error: "Only the primary owner or an active co-owner can export 1099 files with full TINs." }, { status: 403 });
  }
  return null;
}

const RECIPIENT_COLUMNS =
  "id, kind, linked_vendor_id, display_name, entity_type, address_line1, address_line2, city, state, zip, tin_ciphertext, tin_last4, tin_type, is_active";

function defaultTaxYear() {
  return new Date().getFullYear();
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const ownerBlock = await requireOwnerOrCoOwner(authenticated);
    if (ownerBlock) return ownerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const rawYear = url.searchParams.get("taxYear");
    const taxYear = rawYear ? Number(rawYear) : defaultTaxYear();
    const format = (url.searchParams.get("format") || "fire").toLowerCase();
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json({ error: "Tax year must be a valid year (e.g. 2026)." }, { status: 400 });
    }
    if (!["fire", "csv"].includes(format)) {
      return NextResponse.json({ error: "Format must be 'fire' or 'csv'." }, { status: 400 });
    }

    // Reuse the summary aggregation so the export can never disagree with the
    // year summary Brandy sees on screen — including the gross-rent basis for
    // 1099-MISC Box 1.
    const [recipientsResult, vendorPaymentsResult, entriesResult, statesResult, propsResult] = await Promise.all([
      supabaseClient.from("rental_1099_recipients").select(RECIPIENT_COLUMNS).eq("owner_id", effectiveOwnerId).eq("is_active", true),
      supabaseClient.from("rental_vendor_payments")
        .select("vendor_id, payment_date, amount_cents, status")
        .eq("owner_id", effectiveOwnerId).eq("status", "active")
        .gte("payment_date", `${taxYear}-01-01`).lte("payment_date", `${taxYear}-12-31`),
      supabaseClient.from("rental_1099_payment_entries")
        .select("recipient_id, tax_year, amount_cents, status, source")
        .eq("owner_id", effectiveOwnerId).eq("tax_year", taxYear).eq("status", "active"),
      supabaseClient.from("rental_1099_filing_states")
        .select("recipient_id, tax_year, status")
        .eq("owner_id", effectiveOwnerId).eq("tax_year", taxYear),
      supabaseClient.from("rental_1099_recipient_properties")
        .select("recipient_id, property_id")
        .eq("owner_id", effectiveOwnerId),
    ]);
    for (const result of [recipientsResult, vendorPaymentsResult, entriesResult, statesResult, propsResult]) {
      if (result.error) throw result.error;
    }

    const propertyIdsByRecipient = new Map();
    for (const link of propsResult.data || []) {
      if (!propertyIdsByRecipient.has(link.recipient_id)) {
        propertyIdsByRecipient.set(link.recipient_id, new Set());
      }
      propertyIdsByRecipient.get(link.recipient_id).add(link.property_id);
    }
    const allPropertyIds = [...new Set((propsResult.data || []).map((link) => link.property_id))];
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
        .gte("event_date", `${taxYear}-01-01`)
        .lte("event_date", `${taxYear}-12-31`);
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

    const recipientKindById = new Map((recipientsResult.data || []).map((r) => [r.id, r.kind]));
    const filteredEntries = (entriesResult.data || []).filter((entry) => {
      if (recipientKindById.get(entry.recipient_id) === "owner") {
        return entry.source === "adjustment";
      }
      return true;
    });

    const { rows } = aggregate1099Year({
      recipients: recipientsResult.data || [],
      vendorPayments: vendorPaymentsResult.data || [],
      paymentEntries: filteredEntries,
      filingStates: statesResult.data || [],
      grossRentByRecipient,
      taxYear,
    });

    if (format === "csv") {
      const file = build1099SummaryCsv({ taxYear, rows });
      return new NextResponse(file.content, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${file.filename}"`,
        },
      });
    }

    let payer;
    try {
      payer = await loadPayerProfileForExport(supabaseClient, effectiveOwnerId, taxYear);
    } catch (error) {
      if (error?.code === "TIN_KEY_MISSING") {
        return NextResponse.json({ error: "TIN encryption is not configured on the server (FORGE_1099_TIN_KEY). Export is unavailable until it is set." }, { status: 500 });
      }
      if (error?.code === "PAYER_TIN_MISSING") {
        return NextResponse.json({ error: "The payer profile (business name + TIN) is not complete for this tax year. Complete it on the Export tab before exporting." }, { status: 400 });
      }
      throw error;
    }
    if (!payer) {
      return NextResponse.json({ error: "Complete the payer profile (business name + TIN) for this tax year before exporting." }, { status: 400 });
    }

    // Decrypt recipient TINs — the only place in R23 this happens.
    const recipientsById = new Map((recipientsResult.data || []).map((row) => [row.id, row]));
    const fireRecipients = [];
    const skippedNoTin = [];
    for (const row of rows) {
      if (!row.reportable) continue;
      const stored = recipientsById.get(row.recipientId);
      if (!stored?.tin_ciphertext) {
        skippedNoTin.push({ recipientId: row.recipientId, displayName: row.displayName, reason: "No full TIN on file — collect the W-9 TIN before this recipient can be exported." });
        continue;
      }
      try {
        fireRecipients.push({
          recipientId: row.recipientId,
          displayName: row.displayName,
          tinType: stored.tin_type || "unknown",
          tin: decryptTin(stored.tin_ciphertext),
          addressLine1: stored.address_line1 || "",
          city: stored.city || "",
          state: stored.state || "",
          zip: stored.zip || "",
          totalCents: row.totalCents,
          formType: row.formType,
        });
      } catch (error) {
        if (error?.code === "TIN_KEY_MISSING") {
          return NextResponse.json({ error: "TIN encryption is not configured on the server (FORGE_1099_TIN_KEY). Export is unavailable until it is set." }, { status: 500 });
        }
        throw error;
      }
    }

    const file = build1099FireExport({ taxYear, payer, recipients: fireRecipients });

    // Mark included recipients exported (atomic ready->exported progression).
    const now = new Date().toISOString();
    for (const fireRecipient of fireRecipients) {
      const current = (statesResult.data || []).find((state) => state.recipient_id === fireRecipient.recipientId);
      const fromStatus = current?.status || "not_started";
      if (fromStatus === "filed_manually") continue; // already filed — leave it
      const stored = recipientsById.get(fireRecipient.recipientId);
      const patch = { status: "exported", exported_at: now };
      if (fromStatus === "not_started") patch.decided_at = now;
      if (current) {
        await supabaseClient
          .from("rental_1099_filing_states")
          .update(patch)
          .eq("owner_id", effectiveOwnerId)
          .eq("recipient_id", fireRecipient.recipientId)
          .eq("tax_year", taxYear);
      } else {
        await supabaseClient.from("rental_1099_filing_states").insert({
          owner_id: effectiveOwnerId,
          recipient_id: fireRecipient.recipientId,
          tax_year: taxYear,
          form_type: resolveFormType(stored?.kind || "vendor"),
          ...patch,
        });
      }
    }

    return new NextResponse(file.content, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        "x-1099-exported-records": String(file.bRecordCount),
        "x-1099-skipped": String(file.skipped.length + skippedNoTin.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to generate the 1099 export file." }, { status: 500 });
  }
}
