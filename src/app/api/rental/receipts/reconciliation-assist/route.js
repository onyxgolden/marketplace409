import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { matchReceiptsToBankEvents, RECONCILE_DEFAULT_WINDOW_DAYS } from "@/application/rental/receiptReconciliation";

// GET /api/rental/receipts/reconciliation-assist?bankAccountId=&dateFrom=&dateTo=&windowDays=
// Deterministic assist (R26 free layer): match unapplied receipts and unpaid
// vendor bills to bank-side financial_events by amount + date window, and
// surface what is unmatched on BOTH sides. Read-only members may read — it
// never writes.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const bankAccountId = url.searchParams.get("bankAccountId");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const windowDaysRaw = Number(url.searchParams.get("windowDays"));
    const windowDays =
      Number.isSafeInteger(windowDaysRaw) && windowDaysRaw >= 0 && windowDaysRaw <= 30
        ? windowDaysRaw
        : RECONCILE_DEFAULT_WINDOW_DAYS;

    const { data: receipts, error: receiptsError } = await supabaseClient
      .from("rental_receipts")
      .select("id, vendor_id, vendor_name_hint, receipt_date, amount_cents")
      .eq("owner_id", effectiveOwnerId)
      .eq("status", "inbox")
      .order("receipt_date", { ascending: false });
    if (receiptsError) throw receiptsError;

    const { data: bills, error: billsError } = await supabaseClient
      .from("rental_vendor_bills")
      .select("id, vendor_id, bill_date, amount_cents, paid_amount_cents")
      .eq("owner_id", effectiveOwnerId)
      .in("status", ["open", "partial"])
      .order("bill_date", { ascending: false });
    if (billsError) throw billsError;

    let eventsQuery = supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, bank_account_id, payee, metadata, status, is_deleted")
      .eq("owner_id", effectiveOwnerId)
      .eq("is_deleted", false)
      .neq("status", "deleted")
      .not("bank_account_id", "is", null)
      .order("event_date", { ascending: false })
      .limit(500);
    if (bankAccountId) eventsQuery = eventsQuery.eq("bank_account_id", bankAccountId);
    if (dateFrom) eventsQuery = eventsQuery.gte("event_date", dateFrom);
    if (dateTo) eventsQuery = eventsQuery.lte("event_date", dateTo);
    const { data: bankEvents, error: eventsError } = await eventsQuery;
    if (eventsError) throw eventsError;

    const result = matchReceiptsToBankEvents(
      { receipts: receipts || [], bills: bills || [], bankEvents: bankEvents || [] },
      { windowDays }
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to run the reconciliation assist." }, { status: 500 });
  }
}
