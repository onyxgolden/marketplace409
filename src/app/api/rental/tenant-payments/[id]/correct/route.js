import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  serializePaymentCorrection,
  validatePaymentCorrection,
} from "@/application/rental/paymentCorrections";

// R18 (rentec-parity): tenant payment correction.
//
// Correcting a recorded payment rewrites a money fact — owner/co-owner only.
// (R17's granular key for this sensitivity is payments.void_refund;
// rewire to requireRentalPermission({ permission: "payments.void_refund" })
// when R17 lands.)
async function requireOwnerOrCoOwner(authenticated) {
  const role = await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  });
  if (role !== null && role !== "co_owner") {
    return NextResponse.json(
      { error: "Only the owner or co-owner can correct a recorded payment." },
      { status: 403 }
    );
  }
  return null;
}

const PAYMENT_COLUMNS =
  "id, charge_id, lease_id, tenant_id, provider, payment_method, amount_cents, refunded_amount_cents, currency_code, status, received_at, succeeded_at, created_at, receipt_reference, notes, recorded_by, deposit_amount_cents";

async function findOwnedPayment(supabaseClient, ownerId, paymentId) {
  const { data, error } = await supabaseClient
    .from("rental_payments")
    .select(PAYMENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// POST /api/rental/tenant-payments/[id]/correct — correct a recorded tenant
// payment without deleting it.
// Body: { amountCents?, receivedAt?, paymentMethod?, receiptReference?,
//         notes?, reason* } — every supplied field is corrected; the original
// is preserved per-field in rental_payment_corrections (before/after).
//
// The correction is atomic (correct_rental_payment RPC): the payment row,
// the charge balance, and the mirrored ledger event all move together.
// Because the payment row keeps the corrected values, the tenant ledger,
// statements, and receipts reflect the correction — never the old error.
export async function POST(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireOwnerOrCoOwner(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const payment = await findOwnedPayment(supabaseClient, effectiveOwnerId, params.id);
    if (!payment) return NextResponse.json({ error: "The payment was not found." }, { status: 404 });

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    // Notes-only correction for payments that have not completed (Jason,
    // 2026-11-02): the RPC below refuses non-succeeded payments by design —
    // it moves money, charge balances, and mirrors together. This branch runs
    // BEFORE validation (the validator rejects non-succeeded payments) and
    // never calls the RPC. Only notes + receipt reference move, via a direct
    // owner-scoped UPDATE plus the same audit-row shape, so the change is
    // still trailed in the correction history. No money field can pass here.
    if (payment.status !== "succeeded") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) return NextResponse.json({ error: "A reason is required to correct a payment." }, { status: 400 });
      const moneyFields = ["amountCents", "receivedAt", "paymentMethod", "depositState", "depositAmountCents", "chargeId"];
      const blocked = moneyFields.filter((field) => body?.[field] !== undefined);
      if (blocked.length > 0) {
        return NextResponse.json({ error: "This payment has not completed, so its amount, date, method, and charge cannot be changed — only notes and the receipt reference." }, { status: 400 });
      }
      const patch = {};
      const changes = {};
      if (body?.receiptReference !== undefined) {
        const ref = typeof body.receiptReference === "string" ? body.receiptReference.trim() || null : null;
        if (ref !== (payment.receipt_reference || null)) {
          patch.receipt_reference = ref;
          changes.receipt_reference = { from: payment.receipt_reference || null, to: ref };
        }
      }
      if (body?.notes !== undefined) {
        const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
        if (notes !== (payment.notes || null)) {
          patch.notes = notes;
          changes.notes = { from: payment.notes || null, to: notes };
        }
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "Nothing to correct — change at least one field." }, { status: 400 });
      }
      const { error: updateError } = await supabaseClient.from("rental_payments")
        .update(patch).eq("owner_id", effectiveOwnerId).eq("id", payment.id);
      if (updateError) throw updateError;
      const { data: auditRow, error: auditError } = await supabaseClient.from("rental_payment_corrections")
        .insert({ owner_id: effectiveOwnerId, payment_id: payment.id, corrected_by: authenticated.user.id, reason, changes })
        .select("id, payment_id, corrected_at, corrected_by, reason, changes, balance_delta_cents, reconciled_warning")
        .single();
      if (auditError) throw auditError;
      return NextResponse.json({
        success: true,
        correction: serializePaymentCorrection(auditRow),
        reconciledWarning: false,
        balanceDeltaCents: 0,
      });
    }

    const check = validatePaymentCorrection(body, payment);
    if (!check.valid) {
      const status = check.errors.some((e) => e.includes("Only completed payments"))
        ? 409
        : 400;
      return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status });
    }

    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("correct_rental_payment", {
      p_owner_id: effectiveOwnerId,
      p_payment_id: payment.id,
      p_changes: check.value.changes,
      p_reason: check.value.reason,
    });
    if (rpcError) {
      const code = rpcError.code;
      const message = typeof rpcError.message === "string" ? rpcError.message : "";
      if (code === "P0001" && /already reconciled|credit applications/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      if (code === "P0002") {
        return NextResponse.json({ error: "The payment was not found." }, { status: 404 });
      }
      if (["22023", "22000"].includes(code)) {
        return NextResponse.json({ error: message || "The payment could not be corrected." }, { status: 400 });
      }
      console.error("correct_rental_payment error", rpcError);
      return NextResponse.json({ error: "Unable to correct the payment." }, { status: 500 });
    }

    // The audit row the RPC just wrote — the before/after trail for the UI.
    const { data: auditRows, error: auditError } = await supabaseClient
      .from("rental_payment_corrections")
      .select("id, payment_id, corrected_at, corrected_by, reason, changes, balance_delta_cents, reconciled_warning")
      .eq("owner_id", effectiveOwnerId)
      .eq("payment_id", payment.id)
      .order("corrected_at", { ascending: false })
      .limit(1);
    if (auditError) throw auditError;

    const correction = auditRows && auditRows[0] ? serializePaymentCorrection(auditRows[0]) : null;
    return NextResponse.json({
      success: true,
      correction,
      reconciledWarning: rpcData?.reconciledWarning === true,
      balanceDeltaCents: Number(rpcData?.balanceDeltaCents || 0),
    });
  } catch (error) {
    console.error("Tenant payment correction error", error);
    return NextResponse.json({ error: "Unable to correct the payment." }, { status: 500 });
  }
}
