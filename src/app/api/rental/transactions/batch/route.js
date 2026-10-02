import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";
import { validateTransaction } from "@/application/rental/validateTransaction";
import { ChartUnavailableError, resolvePostingCategories } from "@/application/rental/chartOfAccounts";

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
    const gate = await requireRentalPermission({ authenticated, request, permission: "payments.record" });
    if (gate.response) return gate.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

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
      // The inserts AND the active-category checks happen in one RPC,
      // coordinated with concurrent deactivation via the chart row locks
      // (PR #420 retrospective finding 1). All rows insert in the RPC's
      // single implicit transaction, so a failure anywhere rolls back the
      // whole batch -- same as the old multi-row insert.
      const { data: batchResult, error: batchError } = await supabaseClient.rpc("create_ledger_transactions", {
        p_owner_id: effectiveOwnerId,
        p_events: validRows.map(({ value }) => ({
          propertyId: value.propertyId,
          eventDate: value.eventDate,
          description: value.description,
          amount: value.amount,
          transactionKind: value.transactionKind,
          normalizedCategory: value.normalizedCategory,
          payee: value.payee,
          checkNumber: value.checkNumber,
          bankAccountId: value.bankAccountId,
          cleared: value.cleared,
          displayAs: value.displayAs,
          refNumber: value.refNumber,
          payeeMailingAddress: value.payeeMailingAddress,
          assignedTo: value.assignedTo,
          paymentMethod: value.paymentMethod,
          isRecurring: value.isRecurring,
          recurrenceRule: value.recurrenceRule,
          depreciate: value.depreciate,
          memo: value.memo,
          tenantId: value.tenantId,
        })),
      });
      if (batchError) {
        const message = batchError.message || "";
        // Validation rejections from the RPC (unknown or deactivated
        // account) are the caller's fault, not a server fault.
        if (["22000", "22023", "P0002"].includes(batchError.code)) {
          return NextResponse.json(
            { error: message || "Unable to post the batch." },
            { status: 400 }
          );
        }
        throw batchError;
      }
      created = Number(batchResult?.created || 0);
    }

    return NextResponse.json({ success: true, created, errors }, { status: 201 });
  } catch (error) {
    console.error("Batch expense post error", error);
    return NextResponse.json({ error: "Unable to post the batch." }, { status: 500 });
  }
}
