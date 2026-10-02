import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import {
  canEditPayment,
  canVoidPayment,
  paymentIsReconciled,
  serializeVendorPayment,
  validateVendorPaymentEdit,
} from "@/application/rental/vendorPayments";

// R17: editing a vendor payment needs vendor_payments.record; voiding needs
// payments.void_refund (was: read_only-only check for both).
async function requireVendorPaymentRecorder(authenticated, request) {
  const gate = await requireRentalPermission({ authenticated, request, permission: "vendor_payments.record" });
  return gate.response;
}

async function requireVoidRefund(authenticated, request) {
  const gate = await requireRentalPermission({ authenticated, request, permission: "payments.void_refund" });
  return gate.response;
}

const PAYMENT_COLUMNS =
  "id, vendor_id, payment_date, payment_method, amount_cents, bank_account_id, check_number, memo, financial_event_ids, status, void_reason, voided_at, reissued_from_payment_id, created_at, updated_at";
const RECONCILIATION_COLUMNS = "status, cleared_event_ids";

async function findOwnedPayment(supabaseClient, ownerId, paymentId) {
  const { data, error } = await supabaseClient
    .from("rental_vendor_payments")
    .select(PAYMENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadDetail(supabaseClient, ownerId, payment) {
  const { data: apps, error: appsError } = await supabaseClient
    .from("rental_vendor_payment_applications")
    .select("payment_id, bill_id, amount_cents, rental_vendor_bills!inner(bill_date, due_date, amount_cents)")
    .eq("owner_id", ownerId)
    .eq("payment_id", payment.id);
  if (appsError) throw appsError;
  const applications = (apps || []).map((app) => ({
    bill_id: app.bill_id,
    amount_cents: app.amount_cents,
    bill_bill_date: app.rental_vendor_bills?.bill_date || null,
    bill_due_date: app.rental_vendor_bills?.due_date || null,
    bill_amount_cents: app.rental_vendor_bills?.amount_cents ?? null,
  }));
  let vendorName = null;
  const { data: vendor, error: vendorError } = await supabaseClient
    .from("rental_vendors")
    .select("name")
    .eq("owner_id", ownerId)
    .eq("id", payment.vendor_id)
    .maybeSingle();
  if (vendorError) throw vendorError;
  vendorName = vendor?.name || null;
  // R18: re-issue linkage — the voided original names the live re-issue
  // (if any), and a re-issue names the voided payment it replaces.
  let reissuePaymentId = null;
  let reissueCheckNumber = null;
  if (payment.status === "voided") {
    const { data: reissue, error: reissueError } = await supabaseClient
      .from("rental_vendor_payments")
      .select("id, check_number")
      .eq("owner_id", ownerId)
      .eq("reissued_from_payment_id", payment.id)
      .eq("status", "active")
      .maybeSingle();
    if (reissueError) throw reissueError;
    if (reissue) {
      reissuePaymentId = reissue.id;
      reissueCheckNumber = reissue.check_number || null;
    }
  }
  return serializeVendorPayment(payment, { applications, vendorName, reissuePaymentId, reissueCheckNumber });
}

async function loadReconciliations(supabaseClient, ownerId, payment) {
  if (!payment.bank_account_id) return [];
  const { data, error } = await supabaseClient
    .from("bank_reconciliations")
    .select(RECONCILIATION_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("bank_account_id", payment.bank_account_id)
    .eq("status", "active");
  if (error) throw error;
  return data || [];
}

function eventIdsOf(payment) {
  return Array.isArray(payment.financial_event_ids) ? payment.financial_event_ids.map(String) : [];
}

// GET /api/rental/vendor-payments/[id] — one payment with its bill
// applications. Read-only members may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const payment = await findOwnedPayment(supabaseClient, effectiveOwnerId, params.id);
    if (!payment) return NextResponse.json({ error: "The payment was not found." }, { status: 404 });

    // R18: the re-issue audit trail, newest first — visible on the record.
    const { data: audits, error: auditsError } = await supabaseClient
      .from("rental_void_audits")
      .select("id, entity_type, entity_id, action, reason, actor_id, created_at")
      .eq("owner_id", effectiveOwnerId)
      .eq("entity_type", "vendor_payment")
      .eq("entity_id", payment.id)
      .order("created_at", { ascending: false });
    if (auditsError) throw auditsError;

    return NextResponse.json({
      success: true,
      payment: await loadDetail(supabaseClient, effectiveOwnerId, payment),
      audits: (audits || []).map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Vendor payment detail error", error);
    return NextResponse.json({ error: "Unable to load the payment." }, { status: 500 });
  }
}

// PATCH /api/rental/vendor-payments/[id] — two shapes, never both:
//   edit: { memo?, checkNumber?, paymentDate? } — the financial facts (amount,
//         method, bank account, bill lines) are immutable after posting.
//   void: { void: true, voidReason } — reverses the payment: the ledger events
//         are soft-deleted and every bill's balance rolls back.
// Both are blocked once the payment's events sit on an active reconciliation.
export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    // R17: voiding needs payments.void_refund; editing needs vendor_payments.record.
    const gate = body?.void === true
      ? await requireVoidRefund(authenticated, request)
      : await requireVendorPaymentRecorder(authenticated, request);
    if (gate) return gate;

    const payment = await findOwnedPayment(supabaseClient, effectiveOwnerId, params.id);
    if (!payment) return NextResponse.json({ error: "The payment was not found." }, { status: 404 });

    // ---- Void -------------------------------------------------------------
    if (body?.void === true) {
      if (!canVoidPayment(payment)) {
        return NextResponse.json({ error: "Only active payments can be voided." }, { status: 409 });
      }
      const reason = typeof body.voidReason === "string" ? body.voidReason.trim() : "";
      if (!reason) {
        return NextResponse.json({ error: "A reason is required to void a payment." }, { status: 400 });
      }

      const { data: rpcData, error: rpcError } = await supabaseClient.rpc("void_vendor_payment", {
        p_owner_id: effectiveOwnerId,
        p_payment_id: payment.id,
        p_reason: reason,
      });
      if (rpcError) {
        const code = rpcError.code;
        const message = typeof rpcError.message === "string" ? rpcError.message : "";
        if (code === "P0001" && message.toLowerCase().includes("already reconciled")) {
          return NextResponse.json(
            { error: "This payment is already reconciled and cannot be voided. Undo the bank reconciliation first." },
            { status: 409 }
          );
        }
        if (["22023", "22000", "P0002"].includes(code)) {
          return NextResponse.json({ error: message || "The payment could not be voided." }, { status: 400 });
        }
        console.error("void_vendor_payment error", rpcError);
        return NextResponse.json({ error: "Unable to void the payment." }, { status: 500 });
      }

      const voided = await findOwnedPayment(supabaseClient, effectiveOwnerId, payment.id);
      return NextResponse.json({
        success: true,
        reversedEvents: rpcData?.reversedEvents ?? null,
        payment: voided ? await loadDetail(supabaseClient, effectiveOwnerId, voided) : null,
      });
    }

    // ---- Edit -------------------------------------------------------------
    if (!canEditPayment(payment)) {
      return NextResponse.json({ error: "Voided payments cannot be edited." }, { status: 409 });
    }
    const { valid, errors, value } = validateVendorPaymentEdit(body);
    if (!valid) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }
    if (payment.payment_method !== "check" && value.checkNumber !== undefined && value.checkNumber !== "") {
      return NextResponse.json({ error: "Only check payments have a check number." }, { status: 400 });
    }
    const reconciliations = await loadReconciliations(supabaseClient, effectiveOwnerId, payment);
    if (paymentIsReconciled(eventIdsOf(payment), reconciliations)) {
      return NextResponse.json(
        { error: "This payment is already reconciled and cannot be edited. Undo the bank reconciliation first." },
        { status: 409 }
      );
    }

    const updates = {};
    if (value.memo !== undefined) updates.memo = value.memo || null;
    if (value.paymentDate !== undefined) updates.payment_date = value.paymentDate;
    if (value.checkNumber !== undefined) updates.check_number = value.checkNumber || null;

    const { data: updated, error: updateError } = await supabaseClient
      .from("rental_vendor_payments")
      .update(updates)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", payment.id)
      .eq("status", "active")
      .select(PAYMENT_COLUMNS)
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json({ error: "The payment was changed while editing." }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      payment: await loadDetail(supabaseClient, effectiveOwnerId, updated),
    });
  } catch (error) {
    console.error("Vendor payment update error", error);
    return NextResponse.json({ error: "Unable to update the payment." }, { status: 500 });
  }
}
