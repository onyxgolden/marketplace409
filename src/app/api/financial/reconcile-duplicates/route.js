import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { reconcileSchemaUnavailableResponse } from "@/lib/supabase/reconcileSchemaUnavailableResponse";
import { reconcileTransactionDuplicates } from "@/domains/financial-event/reconcileTransactionDuplicates";

const PAGE_SIZE = 1000;
const RENTEC_SOURCE_SYSTEMS = ["rentec", "rentec_api"];
const TRANSACTION_SOURCE_SYSTEM = "transaction";

async function fetchAllPages(supabaseClient, ownerId, sourceSystemFilter) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, description, source_system")
      .eq("owner_id", ownerId)
      .eq("is_deleted", false);
    query = Array.isArray(sourceSystemFilter) ? query.in("source_system", sourceSystemFilter) : query.eq("source_system", sourceSystemFilter);
    const { data, error } = await query.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function toRowsById(rows) {
  return new Map(rows.map((row) => [row.id, row]));
}

// Fetches both sides fresh and re-runs the matching logic every time -- there is no cached/stored
// "preview" a caller can go stale against. GET and POST both call this so the apply action can
// never diverge from what a human most recently reviewed as a preview.
async function computeMatch(supabaseClient, ownerId) {
  const [transactionRows, rentecRows] = await Promise.all([
    fetchAllPages(supabaseClient, ownerId, TRANSACTION_SOURCE_SYSTEM),
    fetchAllPages(supabaseClient, ownerId, RENTEC_SOURCE_SYSTEMS),
  ]);

  const transactionById = toRowsById(transactionRows);
  const rentecById = toRowsById(rentecRows);

  const match = reconcileTransactionDuplicates({
    transactionRows: transactionRows.map((row) => ({ id: row.id, eventDate: row.event_date, amount: Number(row.amount) })),
    rentecRows: rentecRows.map((row) => ({ id: row.id, eventDate: row.event_date, amount: Number(row.amount) })),
  });

  const confirmedDuplicates = match.confirmedDuplicates.map((entry) => {
    const transactionRow = transactionById.get(entry.transactionId);
    const rentecRow = rentecById.get(entry.rentecId);
    return {
      transactionId: entry.transactionId,
      transactionDate: transactionRow.event_date,
      transactionAmount: Number(transactionRow.amount),
      transactionDescription: transactionRow.description,
      rentecId: entry.rentecId,
      rentecDate: rentecRow.event_date,
      rentecAmount: Number(rentecRow.amount),
      rentecDescription: rentecRow.description,
    };
  });

  const ambiguous = match.ambiguous.map((entry) => {
    const transactionRow = transactionById.get(entry.transactionId);
    return {
      transactionId: entry.transactionId,
      transactionDate: transactionRow.event_date,
      transactionAmount: Number(transactionRow.amount),
      transactionDescription: transactionRow.description,
      reason: entry.reason,
      candidates: entry.candidateRentecIds.map((rentecId) => {
        const rentecRow = rentecById.get(rentecId);
        return { rentecId, rentecDate: rentecRow.event_date, rentecAmount: Number(rentecRow.amount), rentecDescription: rentecRow.description };
      }),
    };
  });

  const totalConfirmedAmountCents = confirmedDuplicates.reduce((total, entry) => total + Math.round(Math.abs(entry.transactionAmount) * 100), 0);

  return { confirmedDuplicates, ambiguous, totalConfirmedAmountCents, scannedTransactionCount: transactionRows.length, scannedRentecCount: rentecRows.length };
}

// Read-only preview: never writes anything. Safe to call as often as needed.
export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const result = await computeMatch(authenticated.supabaseClient, authenticated.effectiveOwnerId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return reconcileSchemaUnavailableResponse();
    console.error("Reconcile duplicates preview error", error);
    return NextResponse.json({ error: "Unable to preview duplicate transactions." }, { status: 500 });
  }
}

// Applies the CURRENT confirmed-duplicate set (freshly recomputed, never client-supplied) via
// mark_financial_event_as_duplicate. Ambiguous rows are never written -- they always require a
// human decision this endpoint doesn't make. Idempotent: an already-marked row is excluded from
// future scans (is_deleted = false filter above), so re-running finds only what's left to mark.
export async function POST() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let preview;
  try {
    preview = await computeMatch(authenticated.supabaseClient, authenticated.effectiveOwnerId);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return reconcileSchemaUnavailableResponse();
    console.error("Reconcile duplicates apply (preview stage) error", error);
    return NextResponse.json({ error: "Unable to compute duplicate transactions." }, { status: 500 });
  }

  const applied = [];
  const failed = [];

  for (const entry of preview.confirmedDuplicates) {
    const { data, error } = await authenticated.supabaseClient.rpc("mark_financial_event_as_duplicate", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_event_id: entry.transactionId,
      p_duplicate_of_event_id: entry.rentecId,
    });
    if (error) {
      failed.push({ transactionId: entry.transactionId, error: error.message });
    } else {
      applied.push({ transactionId: data.id, duplicateOfEventId: data.duplicate_of_event_id });
    }
  }

  return NextResponse.json({
    success: failed.length === 0,
    appliedCount: applied.length,
    failedCount: failed.length,
    applied,
    failed,
    ambiguousCount: preview.ambiguous.length,
  });
}
