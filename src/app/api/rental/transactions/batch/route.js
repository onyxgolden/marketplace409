import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { validateTransaction } from "@/application/rental/validateTransaction";
import { ChartUnavailableError, resolvePostingCategories } from "@/application/rental/chartOfAccounts";
import { toRow } from "@/application/rental/transactionRow";

const MAX_ROWS = 50;

// POST /api/rental/transactions/batch — post many expenses in one call.
// Body: { rows: [{ eventDate, description, amount, normalizedCategory, payee?,
//   memo?, propertyId? }] }. Every row is forced to transactionKind "expense".
// Valid rows are inserted together; invalid rows are reported per-row and no
// input is lost server-side -- the client keeps every row on screen.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
      return NextResponse.json({ error: "Read-only members cannot post expenses." }, { status: 403 });
    }
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "At least one expense row is required." }, { status: 400 });
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Batch entry is limited to ${MAX_ROWS} rows at a time.` }, { status: 400 });
    }

    let allowedCategories;
    try {
      allowedCategories = await resolvePostingCategories(supabaseClient, effectiveOwnerId);
    } catch (error) {
      // Fail closed: a chart read error rejects the whole batch so a
      // transient failure can never post to a deliberately deactivated
      // account. Legacy mode (chart table not yet created) resolves to null
      // and keeps the built-in fallback.
      if (error instanceof ChartUnavailableError) {
        return NextResponse.json(
          { error: "The chart of accounts is temporarily unavailable. Please try again — no transactions were recorded." },
          { status: 503 }
        );
      }
      throw error;
    }

    const validRows = [];
    const errors = [];
    rows.forEach((row, index) => {
      const { valid, errors: rowErrors, value } = validateTransaction(
        { ...row, transactionKind: "expense", chargeTenant: false },
        { allowedCategories }
      );
      if (!valid) {
        errors.push({ index, errors: rowErrors });
        return;
      }
      validRows.push({ index, value });
    });

    let created = 0;
    if (validRows.length > 0) {
      const payload = validRows.map(({ value }) =>
        toRow({ ownerId: effectiveOwnerId, userId: user.id, value })
      );
      const { error: insertError } = await supabaseClient.from("financial_events").insert(payload);
      if (insertError) throw insertError;
      created = validRows.length;
    }

    return NextResponse.json({ success: true, created, errors }, { status: 201 });
  } catch (error) {
    console.error("Batch expense post error", error);
    return NextResponse.json({ error: "Unable to post the batch." }, { status: 500 });
  }
}
