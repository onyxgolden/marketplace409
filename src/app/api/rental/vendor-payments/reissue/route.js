import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildVendorPaymentId,
  canReissuePayment,
  serializeVendorPayment,
  validateReissueInput,
} from "@/application/rental/vendorPayments";

// R18 (rentec-parity): re-issue a voided vendor payment (check run).
//
// A voided check is never un-voided (the ledger events were soft-deleted and
// bill balances rolled back — the bills may have moved on). Instead, R18
// records a NEW payment through the same validated record_vendor_payment
// path, with a new check number, linked to the voided original via
// reissued_from_payment_id. The original stays voided as history.
//
// Supersession guard: a voided payment with a live re-issue cannot be
// re-issued again — that would double-pay the vendor. (A re-issue that was
// itself voided may be re-issued again.)

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot re-issue payments." }, { status: 403 });
  }
  return null;
}

const PAYMENT_COLUMNS =
  "id, vendor_id, payment_date, payment_method, amount_cents, bank_account_id, check_number, memo, financial_event_ids, status, void_reason, voided_at, reissued_from_payment_id, created_at, updated_at";

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
  const { data: vendor } = await supabaseClient
    .from("rental_vendors")
    .select("name")
    .eq("owner_id", ownerId)
    .eq("id", payment.vendor_id)
    .maybeSingle();
  return serializeVendorPayment(payment, { applications, vendorName: vendor?.name || null });
}

// POST /api/rental/vendor-payments/reissue — re-issue a voided payment.
// Body: { voidedPaymentId*, checkNumber? (new, required for checks),
//         paymentDate?, memo?, reason* }.
// The new payment copies the voided payment's vendor, method, amount, bank
// account, and bill applications; the bills are re-validated at their
// CURRENT balances, so a bill that was re-paid or voided since fails with a
// plain-English message instead of double-paying.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    const voidedPaymentId = typeof body?.voidedPaymentId === "string" ? body.voidedPaymentId.trim() : "";
    if (!voidedPaymentId) {
      return NextResponse.json({ error: "The voided payment to re-issue is required." }, { status: 400 });
    }

    const original = await findOwnedPayment(supabaseClient, effectiveOwnerId, voidedPaymentId);
    if (!original) return NextResponse.json({ error: "The voided payment was not found." }, { status: 404 });
    if (!canReissuePayment(original)) {
      return NextResponse.json({ error: "Only a voided payment can be re-issued." }, { status: 409 });
    }

    const check = validateReissueInput(body, original);
    if (!check.valid) {
      return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status: 400 });
    }

    // Supersession guard, read before the write: a live re-issue already
    // exists → name it so the denial is actionable. The RPC re-checks
    // atomically at insert time.
    const { data: existingReissue, error: reissueLookupError } = await supabaseClient
      .from("rental_vendor_payments")
      .select("id, check_number, payment_date")
      .eq("owner_id", effectiveOwnerId)
      .eq("reissued_from_payment_id", original.id)
      .eq("status", "active")
      .maybeSingle();
    if (reissueLookupError) throw reissueLookupError;
    if (existingReissue) {
      const label = original.payment_method === "check" && existingReissue.check_number
        ? `check #${existingReissue.check_number}`
        : `payment from ${existingReissue.payment_date}`;
      return NextResponse.json({
        error: `This voided payment was already re-issued (${label}). Re-issuing again would pay the vendor twice.`,
      }, { status: 409 });
    }

    // The re-issue replays the original's bill applications at their current
    // balances — the record RPC re-validates every line (open bill, enough
    // balance) and fails closed with a plain-English message.
    const { data: originalApps, error: appsError } = await supabaseClient
      .from("rental_vendor_payment_applications")
      .select("bill_id, amount_cents")
      .eq("owner_id", effectiveOwnerId)
      .eq("payment_id", original.id);
    if (appsError) throw appsError;
    if (!originalApps || originalApps.length === 0) {
      return NextResponse.json({ error: "The voided payment has no bill lines to re-issue." }, { status: 409 });
    }

    const paymentDate = check.value.paymentDate || new Date().toISOString().slice(0, 10);
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("record_vendor_payment", {
      p_owner_id: effectiveOwnerId,
      p_payment: {
        id: buildVendorPaymentId(),
        vendorId: original.vendor_id,
        paymentDate,
        paymentMethod: original.payment_method,
        checkNumber: original.payment_method === "check" ? check.value.checkNumber : "",
        bankAccountId: original.bank_account_id,
        memo: check.value.memo !== undefined ? check.value.memo : (original.memo || ""),
        amountCents: Number(original.amount_cents),
        applications: originalApps.map((app) => ({ billId: app.bill_id, amountCents: Number(app.amount_cents) })),
        reissuedFrom: original.id,
      },
    });
    if (rpcError) {
      const code = rpcError.code;
      const message = typeof rpcError.message === "string" ? rpcError.message : "";
      if (code === "P0001" && message.toLowerCase().includes("already has a live re-issue")) {
        return NextResponse.json({
          error: "This voided payment was already re-issued. Re-issuing again would pay the vendor twice.",
        }, { status: 409 });
      }
      if (["22023", "22000", "P0002"].includes(code)) {
        return NextResponse.json({ error: message || "The payment could not be re-issued." }, { status: 400 });
      }
      console.error("reissue record_vendor_payment error", rpcError);
      return NextResponse.json({ error: "Unable to re-issue the payment." }, { status: 500 });
    }

    const created = await findOwnedPayment(supabaseClient, effectiveOwnerId, rpcData?.paymentId);
    const { error: auditError } = await supabaseClient
      .from("rental_void_audits")
      .insert({
        owner_id: effectiveOwnerId,
        entity_type: "vendor_payment",
        entity_id: original.id,
        action: "reissue",
        reason: check.value.reason.slice(0, 500),
        actor_id: authenticated.user.id,
      });
    if (auditError) throw auditError;

    return NextResponse.json({
      success: true,
      payment: created ? await loadDetail(supabaseClient, effectiveOwnerId, created) : null,
      reissuedFromPaymentId: original.id,
    });
  } catch (error) {
    console.error("Vendor payment re-issue error", error);
    return NextResponse.json({ error: "Unable to re-issue the payment." }, { status: 500 });
  }
}
