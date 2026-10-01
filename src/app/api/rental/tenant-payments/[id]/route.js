import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  canCorrectPayment,
  serializePaymentCorrection,
  validatePaymentCorrection,
} from "@/application/rental/paymentCorrections";

// R18 (rentec-parity): tenant payment correction.
//
// Correcting a recorded payment rewrites a money fact — that trust sits with
// the owner/co-owner only. (R17's granular key for this sensitivity is
// payments.void_refund: bookkeepers record payments but never void/refund
// them; a correction is in the same trust class. Rewire to
// requireRentalPermission({ permission: "payments.void_refund" }) when R17
// lands.)
async function requireOwnerOrCoOwner(authenticated) {
  const role = await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  });
  // null = no membership row = the primary owner acting in their own
  // workspace (the constraint forbids a primary_owner row).
  if (role !== null && role !== "co_owner") {
    return NextResponse.json(
      { error: "Only the owner or co-owner can correct a recorded payment." },
      { status: 403 }
    );
  }
  return null;
}

const PAYMENT_COLUMNS =
  "id, charge_id, lease_id, tenant_id, provider, payment_method, amount_cents, refunded_amount_cents, currency_code, status, received_at, succeeded_at, created_at, receipt_reference, notes, recorded_by";

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

function serializePayment(payment) {
  const eligibility = canCorrectPayment(payment);
  const isOffline = payment.provider === "offline";
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amountCents: Number(payment.amount_cents || 0),
    refundedAmountCents: Number(payment.refunded_amount_cents || 0),
    currencyCode: payment.currency_code,
    receivedAt: payment.received_at,
    paymentMethod: payment.payment_method || null,
    receiptReference: payment.receipt_reference || null,
    notes: payment.notes || null,
    correctable: eligibility.ok,
    correctableReason: eligibility.reason,
    // Amount/date/method corrections are offline-only; provider payments
    // moved real money — their correctable surface is notes + reference.
    moneyFieldsCorrectable: eligibility.ok && isOffline && Number(payment.refunded_amount_cents || 0) === 0,
  };
}

async function loadCorrections(supabaseClient, ownerId, paymentId) {
  const { data, error } = await supabaseClient
    .from("rental_payment_corrections")
    .select("id, payment_id, corrected_at, corrected_by, reason, changes, balance_delta_cents, reconciled_warning")
    .eq("owner_id", ownerId)
    .eq("payment_id", paymentId)
    .order("corrected_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(serializePaymentCorrection);
}

// GET /api/rental/tenant-payments/[id] — the payment with its correction
// history (the audit trail, newest first). Read-only members may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const payment = await findOwnedPayment(supabaseClient, effectiveOwnerId, params.id);
    if (!payment) return NextResponse.json({ error: "The payment was not found." }, { status: 404 });

    const corrections = await loadCorrections(supabaseClient, effectiveOwnerId, payment.id);
    return NextResponse.json({ success: true, payment: serializePayment(payment), corrections });
  } catch (error) {
    console.error("Tenant payment detail error", error);
    return NextResponse.json({ error: "Unable to load the payment." }, { status: 500 });
  }
}
