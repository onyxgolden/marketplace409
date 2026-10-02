import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { createFundTransfer, validateFundTransferInput } from "@/application/rental/fundTransfers";

// R17: moving funds needs transfers.record (was: read_only-only check).
async function requireTransferRecorder(authenticated, request) {
  const gate = await requireRentalPermission({ authenticated, request, permission: "transfers.record" });
  return gate.response;
}

// POST /api/rental/transfers — move money between two of the owner's bank
// accounts. Body: { fromAccountId, toAccountId, eventDate, amount, memo?,
// checkNumber? }.
//
// The write is a single create_fund_transfer RPC call: one database
// transaction that inserts exactly two linked financial_events (an expense leg
// out of the source account, an income leg into the destination account).
// Any failure rolls back both legs, so a one-sided transfer is impossible.
// The RPC also re-validates everything server-side (accounts differ, positive
// amount, both accounts owned by the caller) — the checks below are the fast
// client-facing versions.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireTransferRecorder(authenticated, request);
    if (forbidden) return forbidden;

    const body = await request.json();
    const { valid, errors, value } = validateFundTransferInput(body);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    const result = await createFundTransfer(authenticated.supabaseClient, value);
    return NextResponse.json({ success: true, transfer: result });
  } catch (error) {
    // The RPC raises plain-English validation errors (same account, unknown
    // account, bad amount); surface those as 400s, not 500s.
    const message = error?.message || "Unable to save the transfer.";
    const status = /must be|was not found|required|not authenticated/i.test(message) ? 400 : 500;
    if (status === 500) console.error("Fund transfer error", error);
    return NextResponse.json({ error: message }, { status });
  }
}
