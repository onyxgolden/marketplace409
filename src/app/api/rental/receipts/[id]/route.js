import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { isValidReceiptId, validateReceiptEdit } from "@/application/rental/receipts";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot manage receipts." }, { status: 403 });
  }
  return null;
}

const RECEIPT_COLUMNS =
  "id, vendor_id, vendor_name_hint, property_id, receipt_date, amount_cents, tax_cents, line_items, document_id, notes, status, applied_bill_id, applied_payment_id, extraction_status, created_by, created_at, updated_at";

function invalidId() {
  return NextResponse.json({ error: "A valid receipt is required." }, { status: 400 });
}

async function findOwnedReceipt(supabaseClient, ownerId, receiptId) {
  const { data, error } = await supabaseClient
    .from("rental_receipts")
    .select(RECEIPT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", receiptId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadVendorName(supabaseClient, ownerId, vendorId) {
  if (!vendorId) return null;
  const { data, error } = await supabaseClient
    .from("rental_vendors")
    .select("name")
    .eq("owner_id", ownerId)
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw error;
  return data?.name || null;
}

function serialize(row, vendorName) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName,
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

// GET /api/rental/receipts/[id] — receipt detail. Read-only members may read.
export async function GET(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) return invalidId();
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const receipt = await findOwnedReceipt(supabaseClient, effectiveOwnerId, receiptId);
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    const vendorName = await loadVendorName(supabaseClient, effectiveOwnerId, receipt.vendor_id);
    return NextResponse.json({ success: true, receipt: serialize(receipt, vendorName) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to load the receipt." }, { status: 500 });
  }
}

// PATCH /api/rental/receipts/[id] — edit an inbox receipt (manual entry).
export async function PATCH(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) return invalidId();
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const blocked = await requireWriter(authenticated);
    if (blocked) return blocked;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const receipt = await findOwnedReceipt(supabaseClient, effectiveOwnerId, receiptId);
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const check = validateReceiptEdit(body, receipt);
    if (!check.valid) return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status: 400 });

    if (check.value.vendor_id) {
      const { data: vendor, error: vendorError } = await supabaseClient
        .from("rental_vendors")
        .select("id")
        .eq("owner_id", effectiveOwnerId)
        .eq("id", check.value.vendor_id)
        .maybeSingle();
      if (vendorError) throw vendorError;
      if (!vendor) return NextResponse.json({ error: "The selected vendor was not found." }, { status: 400 });
    }
    if (check.value.document_id) {
      const { data: document, error: documentError } = await supabaseClient
        .from("rental_documents")
        .select("id")
        .eq("id", check.value.document_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return NextResponse.json({ error: "The linked document was not found." }, { status: 400 });
    }

    const { data, error } = await supabaseClient
      .from("rental_receipts")
      .update(check.value)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId)
      .select(RECEIPT_COLUMNS)
      .single();
    if (error) throw error;
    const vendorName = await loadVendorName(supabaseClient, effectiveOwnerId, data.vendor_id);
    return NextResponse.json({ success: true, receipt: serialize(data, vendorName) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to update the receipt." }, { status: 500 });
  }
}

// DELETE /api/rental/receipts/[id] — void with a reason (reversal, never delete).
// Body: { reason }.
export async function DELETE(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) return invalidId();
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const blocked = await requireWriter(authenticated);
    if (blocked) return blocked;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const receipt = await findOwnedReceipt(supabaseClient, effectiveOwnerId, receiptId);
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    if (receipt.status === "applied") {
      return NextResponse.json(
        { error: "This receipt was applied to a bill — void the vendor payment first." },
        { status: 409 }
      );
    }
    if (receipt.status === "voided") {
      return NextResponse.json({ error: "This receipt is already voided." }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "A reason is required to void a receipt." }, { status: 400 });

    const { data, error } = await supabaseClient
      .from("rental_receipts")
      .update({ status: "voided", void_reason: reason, voided_at: new Date().toISOString() })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId)
      .select(RECEIPT_COLUMNS)
      .single();
    if (error) throw error;
    const vendorName = await loadVendorName(supabaseClient, effectiveOwnerId, data.vendor_id);
    return NextResponse.json({ success: true, receipt: serialize(data, vendorName) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to void the receipt." }, { status: 500 });
  }
}
