import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isValidReceiptId } from "@/application/rental/receipts";
import { rankBillMatches } from "@/application/rental/receiptMatching";

const BILL_COLUMNS = "id, vendor_id, property_id, bill_date, due_date, amount_cents, paid_amount_cents, expense_account_code, memo, status";

// GET /api/rental/receipts/[id]/matches — deterministic suggested matches
// against open/partial vendor bills (R3/R4). Read-only members may read.
// No match rows are stored: the engine is a pure function of receipt + bills.
export async function GET(request, { params }) {
  try {
    const receiptId = (await params)?.id;
    if (!isValidReceiptId(receiptId)) {
      return NextResponse.json({ error: "A valid receipt is required." }, { status: 400 });
    }
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const { data: receipt, error: receiptError } = await supabaseClient
      .from("rental_receipts")
      .select("id, vendor_id, vendor_name_hint, receipt_date, amount_cents, status")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", receiptId)
      .maybeSingle();
    if (receiptError) throw receiptError;
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

    const { data: bills, error: billsError } = await supabaseClient
      .from("rental_vendor_bills")
      .select(BILL_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .in("status", ["open", "partial"])
      .order("due_date", { ascending: true });
    if (billsError) throw billsError;

    const vendorIds = [...new Set((bills || []).map((bill) => bill.vendor_id).filter(Boolean))];
    let vendorNames = new Map();
    if (vendorIds.length > 0) {
      const { data: vendors, error: vendorsError } = await supabaseClient
        .from("rental_vendors")
        .select("id, name")
        .eq("owner_id", effectiveOwnerId)
        .in("id", vendorIds);
      if (vendorsError) throw vendorsError;
      vendorNames = new Map((vendors || []).map((vendor) => [vendor.id, vendor.name]));
    }

    const ranked = rankBillMatches(receipt, bills || [], vendorNames, { limit: 5 });
    const matches = ranked.map((match) => {
      const bill = (bills || []).find((row) => row.id === match.billId);
      return {
        ...match,
        bill: bill
          ? {
              id: bill.id,
              vendorId: bill.vendor_id,
              vendorName: vendorNames.get(bill.vendor_id) || null,
              billDate: bill.bill_date,
              dueDate: bill.due_date,
              amountCents: bill.amount_cents,
              paidAmountCents: bill.paid_amount_cents,
              balanceCents: Number(bill.amount_cents) - Number(bill.paid_amount_cents || 0),
              status: bill.status,
            }
          : null,
      };
    });
    return NextResponse.json({ success: true, receiptId, matches });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to match the receipt." }, { status: 500 });
  }
}
