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

// Pure, exported for tests: normalize a client-supplied id list. Non-string
// entries and blanks are dropped; duplicates collapsed. Returns [] when the
// client sent nothing usable.
export function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const id = String(entry ?? "").trim();
    if (id && !seen.has(id)) seen.add(id);
  }
  return [...seen];
}

// Pure, exported for tests: scope a duplicate apply to the requested ids.
// requestedIds null/undefined/[] means "the whole confirmed set" (bulk).
// Anything requested that is not currently confirmed comes back in `unknown`
// and is never applied -- the anti-drift rule.
export function selectConfirmedEntries(preview, requestedIds) {
  const confirmed = preview?.confirmedDuplicates ?? [];
  const wanted = normalizeIdList(requestedIds);
  if (wanted.length === 0) return { selected: confirmed, unknown: [] };
  const wantedSet = new Set(wanted);
  const selected = confirmed.filter((entry) => wantedSet.has(entry.transactionId));
  const selectedIds = new Set(selected.map((entry) => entry.transactionId));
  return { selected, unknown: wanted.filter((id) => !selectedIds.has(id)) };
}

// Pure, exported for tests: scope an undo to rows currently marked as
// duplicates. Anything requested that isn't marked comes back in `unknown`.
export function selectMarkedRows(markedRows, requestedIds) {
  const wantedSet = new Set(normalizeIdList(requestedIds));
  const selected = (markedRows ?? []).filter((row) => wantedSet.has(row.id));
  const selectedIds = new Set(selected.map((row) => row.id));
  return { selected, unknown: [...wantedSet].filter((id) => !selectedIds.has(id)) };
}

// Rows this owner has excluded as duplicates (soft-deleted with the link set).
// Used to scope undo; the unmark RPC re-checks marked-state server-side.
async function fetchMarkedDuplicateRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .eq("is_deleted", true)
      .not("duplicate_of_event_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Applies the CURRENT confirmed-duplicate set (freshly recomputed, never client-supplied) via
// mark_financial_event_as_duplicate. Ambiguous rows are never written -- they always require a
// human decision this endpoint doesn't make. Idempotent: an already-marked row is excluded from
// future scans (is_deleted = false filter above), so re-running finds only what's left to mark.
//
// Optional body { transactionIds: [...] } scopes the apply to one row or a subset (per-row
// one-click exclude). Requested IDs are intersected with the freshly recomputed confirmed set --
// the anti-drift rule: a client-invented ID is reported as failed, never applied. Omitting
// transactionIds applies the whole confirmed set (the reviewed table, one click).
export async function POST(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null; // No body is fine -- it means "apply the whole confirmed set".
  }

  let preview;
  try {
    preview = await computeMatch(authenticated.supabaseClient, authenticated.effectiveOwnerId);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return reconcileSchemaUnavailableResponse();
    console.error("Reconcile duplicates apply (preview stage) error", error);
    return NextResponse.json({ error: "Unable to compute duplicate transactions." }, { status: 500 });
  }

  const { selected, unknown } = selectConfirmedEntries(preview, body?.transactionIds);
  const applied = [];
  const failed = unknown.map((transactionId) => ({ transactionId, error: "Not a confirmed duplicate right now." }));

  for (const entry of selected) {
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

// Undoes an exclusion: restores soft-deleted rows via unmark_financial_event_as_duplicate.
// Body { transactionIds: [...] } is required. Only rows currently marked as duplicates for
// this owner are unmarked -- anything else is reported as failed, never touched. The RPC
// re-checks ownership and marked-state server-side; the intersection below is just hygiene
// for clean errors.
export async function DELETE(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body with transactionIds is required." }, { status: 400 });
  }
  const requestedIds = normalizeIdList(body?.transactionIds);
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: "transactionIds must be a non-empty array." }, { status: 400 });
  }

  let markedRows;
  try {
    markedRows = await fetchMarkedDuplicateRows(authenticated.supabaseClient, authenticated.effectiveOwnerId);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return reconcileSchemaUnavailableResponse();
    console.error("Reconcile duplicates undo (fetch stage) error", error);
    return NextResponse.json({ error: "Unable to find excluded duplicates." }, { status: 500 });
  }

  const { selected, unknown } = selectMarkedRows(markedRows, requestedIds);
  const restored = [];
  const failed = unknown.map((transactionId) => ({ transactionId, error: "Not currently excluded as a duplicate." }));

  for (const row of selected) {
    const { data, error } = await authenticated.supabaseClient.rpc("unmark_financial_event_as_duplicate", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_event_id: row.id,
    });
    if (error) {
      failed.push({ transactionId: row.id, error: error.message });
    } else {
      restored.push({ transactionId: data.id });
    }
  }

  return NextResponse.json({
    success: failed.length === 0,
    restoredCount: restored.length,
    failedCount: failed.length,
    restored,
    failed,
  });
}
