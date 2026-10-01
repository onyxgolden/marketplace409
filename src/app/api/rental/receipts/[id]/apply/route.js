import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { isValidReceiptId } from "@/application/rental/receipts";
import { buildVendorPaymentId } from "@/application/rental/vendorPayments";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot apply receipts." }, { status: 403 });
  }
  return null;
}

function mapRpcError(error) {
  if (!error) return null;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "23505") return "duplicate";
  if (["22023", "22000", "P0002"].includes(code)) {
    return { status: 400, error: message || "The receipt could not be applied." };
  }
  return null;
}

const dollars = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

// POST /api/rental/receipts/[id]/apply — one-click "pay this bill with this
// receipt". The whole operation is ONE atomic database call: the
// apply_receipt_to_bill RPC locks the receipt, runs the validated R4
// record_vendor_payment logic, and marks the receipt applied in the same
// transaction — the payment and the receipt linkage can never diverge, and a
// failed apply leaves nothing half-committed. Body: { billId*,
// bankAccountId*, paymentMethod* ('check'|'ach'), checkNumber?, memo? }.
//
// One-click apply is whole-receipt only: the receipt total must EXACTLY equal
// the bill's remaining balance. Either direction of mismatch is a clear
// split-required error — never a silent partial application. (Split
// allocation does not exist yet; pay the bill from the vendor payment screen
// instead and the receipt stays in the inbox.) The route keeps these
// application-level prechecks for fast UX failures; the RPC enforces them
// again under row locks.
export async function POST(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) {
      return NextResponse.json({ error: "A valid receipt is required." }, { status: 400 });
    }
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const blocked = await requireWriter(authenticated);
    if (blocked) return blocked;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const billId = typeof body?.billId === "string" ? body.billId.trim() : "";
    const bankAccountId = typeof body?.bankAccountId === "string" ? body.bankAccountId.trim() : "";
    const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : "";
    const checkNumber = typeof body?.checkNumber === "string" ? body.checkNumber.trim() : "";
    const memo = typeof body?.memo === "string" ? body.memo.trim().slice(0, 2000) : "";
    if (!billId) return NextResponse.json({ error: "A bill is required." }, { status: 400 });
    if (!bankAccountId) return NextResponse.json({ error: "A bank account is required." }, { status: 400 });
    if (!["check", "ach"].includes(paymentMethod)) {
      return NextResponse.json({ error: "Payment method must be check or ach." }, { status: 400 });
    }
    if (paymentMethod === "check" && !checkNumber) {
      return NextResponse.json({ error: "A check number is required for check payments." }, { status: 400 });
    }

    const { data: receipt, error: receiptError } = await supabaseClient
      .from("rental_receipts")
      .select("id, vendor_id, vendor_name_hint, receipt_date, amount_cents, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId)
      .maybeSingle();
    if (receiptError) throw receiptError;
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    if (receipt.status !== "inbox") {
      return NextResponse.json({ error: "Only inbox receipts can be applied." }, { status: 409 });
    }

    const { data: bill, error: billError } = await supabaseClient
      .from("rental_vendor_bills")
      .select("id, vendor_id, amount_cents, paid_amount_cents, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", billId)
      .maybeSingle();
    if (billError) throw billError;
    if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    if (!["open", "partial"].includes(bill.status)) {
      return NextResponse.json({ error: "Only open bills can be paid." }, { status: 409 });
    }
    if (receipt.vendor_id && receipt.vendor_id !== bill.vendor_id) {
      return NextResponse.json({ error: "The receipt's vendor does not match this bill's vendor." }, { status: 400 });
    }

    const billBalance = Number(bill.amount_cents) - Number(bill.paid_amount_cents || 0);
    const receiptCents = Number(receipt.amount_cents);
    if (billBalance <= 0) return NextResponse.json({ error: "This bill has no remaining balance." }, { status: 409 });
    if (receiptCents !== billBalance) {
      return NextResponse.json(
        {
          error:
            `The receipt total (${dollars(receiptCents)}) does not match the bill's remaining balance ` +
            `(${dollars(billBalance)}). Split application is not supported yet — pay the bill from the ` +
            `vendor payment screen instead; this receipt stays in the inbox.`,
        },
        { status: 400 }
      );
    }

    // One RPC, one transaction: receipt lock + R4 payment + receipt linkage.
    // No ledger logic is duplicated here and no second request can leave the
    // operation half-done.
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("apply_receipt_to_bill", {
      p_owner_id: effectiveOwnerId,
      p_receipt_id: receiptId,
      p_payment: {
        id: buildVendorPaymentId(),
        vendorId: bill.vendor_id,
        paymentDate: receipt.receipt_date,
        paymentMethod,
        checkNumber: checkNumber || null,
        bankAccountId,
        memo: memo || `Applied from receipt ${receiptId}`,
        amountCents: billBalance,
        applications: [{ billId, amountCents: billBalance }],
      },
    });
    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped === "duplicate") {
        return NextResponse.json({ error: "This payment was already recorded — please reload." }, { status: 409 });
      }
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      console.error("apply_receipt_to_bill error (receipt apply)", rpcError);
      throw rpcError;
    }

    return NextResponse.json({
      success: true,
      paymentId: rpcData?.paymentId,
      receiptId,
      billId: bill.id,
      appliedAmountCents: rpcData?.appliedAmountCents ?? billBalance,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to apply the receipt." }, { status: 500 });
  }
}
