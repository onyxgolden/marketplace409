import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { buildReceiptId, validateReceiptInput } from "@/application/rental/receipts";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot manage receipts." }, { status: 403 });
  }
  return null;
}

const RECEIPT_COLUMNS =
  "id, vendor_id, vendor_name_hint, property_id, receipt_date, amount_cents, tax_cents, line_items, document_id, notes, status, applied_bill_id, applied_payment_id, extraction_status, created_by, created_at, updated_at";

async function loadVendorNames(supabaseClient, ownerId, vendorIds) {
  if (vendorIds.length === 0) return new Map();
  const { data, error } = await supabaseClient
    .from("rental_vendors")
    .select("id, name")
    .eq("owner_id", ownerId)
    .in("id", vendorIds);
  if (error) throw error;
  return new Map((data || []).map((vendor) => [vendor.id, vendor.name]));
}

async function verifyDocument(supabaseClient, ownerId, documentId) {
  const { data, error } = await supabaseClient
    .from("rental_documents")
    .select("id, category")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { valid: false, error: "The linked document was not found." };
  return { valid: true };
}

function serializeReceipt(row, vendorNames) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: row.vendor_id ? vendorNames.get(row.vendor_id) || null : null,
    vendorNameHint: row.vendor_name_hint,
    propertyId: row.property_id,
    receiptDate: row.receipt_date,
    amountCents: row.amount_cents,
    taxCents: row.tax_cents,
    lineItems: row.line_items || [],
    documentId: row.document_id,
    notes: row.notes,
    status: row.status,
    appliedBillId: row.applied_bill_id,
    appliedPaymentId: row.applied_payment_id,
    extractionStatus: row.extraction_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/rental/receipts?status=&vendorId=&unmatched=1
// status: inbox | applied | voided | all (default all). Read-only members may read.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "all";
    const vendorId = url.searchParams.get("vendorId");
    const unmatchedOnly = url.searchParams.get("unmatched") === "1";
    if (!["all", "inbox", "applied", "voided"].includes(status)) {
      return NextResponse.json({ error: "Unknown receipt status." }, { status: 400 });
    }

    let query = supabaseClient
      .from("rental_receipts")
      .select(RECEIPT_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .order("receipt_date", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    else if (unmatchedOnly) query = query.eq("status", "inbox");
    if (vendorId) query = query.eq("vendor_id", vendorId);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const vendorNames = await loadVendorNames(
      supabaseClient,
      effectiveOwnerId,
      [...new Set(rows.map((row) => row.vendor_id).filter(Boolean))]
    );
    return NextResponse.json({ success: true, receipts: rows.map((row) => serializeReceipt(row, vendorNames)) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to load receipts." }, { status: 500 });
  }
}

// POST /api/rental/receipts — record a receipt (manual entry; the free layer).
// Body: { vendorId?, vendorNameHint?, propertyId?, receiptDate*, amountCents*,
//         taxCents?, lineItems?, documentId?, notes? }. Idempotent on the id.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const blocked = await requireWriter(authenticated);
    if (blocked) return blocked;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const check = validateReceiptInput(body);
    if (!check.valid) return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status: 400 });
    const value = check.value;

    if (value.vendorId) {
      const { data: vendor, error: vendorError } = await supabaseClient
        .from("rental_vendors")
        .select("id")
        .eq("owner_id", effectiveOwnerId)
        .eq("id", value.vendorId)
        .maybeSingle();
      if (vendorError) throw vendorError;
      if (!vendor) return NextResponse.json({ error: "The selected vendor was not found." }, { status: 400 });
    }

    if (value.documentId) {
      const documentCheck = await verifyDocument(supabaseClient, effectiveOwnerId, value.documentId);
      if (!documentCheck.valid) return NextResponse.json({ error: documentCheck.error }, { status: 400 });
    }

    const id = buildReceiptId();
    const { data, error } = await supabaseClient
      .from("rental_receipts")
      .insert({
        owner_id: effectiveOwnerId,
        id,
        vendor_id: value.vendorId,
        vendor_name_hint: value.vendorNameHint,
        property_id: value.propertyId,
        receipt_date: value.receiptDate,
        amount_cents: value.amountCents,
        tax_cents: value.taxCents,
        line_items: value.lineItems,
        document_id: value.documentId,
        notes: value.notes,
        status: "inbox",
        created_by: authenticated.user.id,
      })
      .select(RECEIPT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabaseClient
          .from("rental_receipts")
          .select(RECEIPT_COLUMNS)
          .eq("owner_id", effectiveOwnerId)
          .eq("id", id)
          .maybeSingle();
        if (existing) {
          const vendorNames = await loadVendorNames(supabaseClient, effectiveOwnerId, existing.vendor_id ? [existing.vendor_id] : []);
          return NextResponse.json({ success: true, receipt: serializeReceipt(existing, vendorNames), duplicate: true });
        }
      }
      throw error;
    }
    const vendorNames = await loadVendorNames(supabaseClient, effectiveOwnerId, value.vendorId ? [value.vendorId] : []);
    return NextResponse.json({ success: true, receipt: serializeReceipt(data, vendorNames) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to record the receipt." }, { status: 500 });
  }
}
