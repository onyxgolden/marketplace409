import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { buildOwnerStatement } from "@/application/rental/ownerStatements";

// Owner statement (Rentec-parity R9): a monthly owner statement — period,
// income lines, expense lines, disbursements, contributions, beginning and
// ending balance due to the owner. Read surface; the printable view lives in
// OwnerStatementsPanel.
//
// GET /api/rental/owner-statement?month=YYYY-MM[&propertyId=]

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const lastDate = new Date(Date.UTC(year, monthIndex, 0));
  const lastDay = `${month}-${String(lastDate.getUTCDate()).padStart(2, "0")}`;
  return { firstDay, lastDay };
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const params = new URL(request.url).searchParams;
    const month = params.get("month");
    const propertyId = params.get("propertyId") || null;
    if (!month || !MONTH_PATTERN.test(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
    }
    const { firstDay, lastDay } = monthRange(month);

    const [financialEvents, movements] = await Promise.all([
      fetchAllOwnerFinancialEvents(supabaseClient, effectiveOwnerId, {
        columns: "id, event_date, description, amount, transaction_kind, normalized_category, property_id, status, is_deleted",
      }),
      supabaseClient
        .from("owner_cash_movements")
        .select("id, property_id, kind, amount, movement_date, method, memo, status")
        .eq("owner_id", effectiveOwnerId),
    ]);
    if (movements.error) throw movements.error;

    const statement = buildOwnerStatement({
      financialEvents,
      cashMovements: movements.data || [],
      periodStart: firstDay,
      periodEnd: lastDay,
      propertyId,
      ownerLabel: "Owner",
    });

    return NextResponse.json({ success: true, statement });
  } catch (error) {
    console.error("Owner statement error", error);
    return NextResponse.json({ error: "Unable to build the owner statement." }, { status: 500 });
  }
}
