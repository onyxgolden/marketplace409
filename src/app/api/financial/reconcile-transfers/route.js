import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { transferClassificationSchemaUnavailableResponse } from "@/lib/supabase/transferClassificationSchemaUnavailableResponse";
import { needsDirectionCorrection } from "@/domains/financial-event/correctRawBankFeedDirection";
import { isInternalTransferDescription, classifyTransferPairs } from "@/domains/financial-event/classifyTransferPairs";
import { buildApplyPayloads } from "@/domains/financial-event/buildTransferApplyPayloads";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

async function fetchAllTransactionRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, description, transaction_kind, normalized_category, financial_account_id")
      .eq("owner_id", ownerId)
      .eq("is_deleted", false)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchAccountScopeById(supabaseClient, ownerId, accountIds) {
  const scopeById = new Map();
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return scopeById;
  const { data, error } = await supabaseClient.from("financial_accounts").select("id, business_scope").eq("owner_id", ownerId).in("id", uniqueIds);
  if (error) throw error;
  for (const row of data ?? []) scopeById.set(row.id, row.business_scope);
  return scopeById;
}

// Fetches fresh and re-derives both classifications every time -- GET and POST both call this so
// the apply action can never diverge from what a human most recently reviewed as a preview.
async function computePreview(supabaseClient, ownerId) {
  const transactionRows = await fetchAllTransactionRows(supabaseClient, ownerId);
  const scopeByAccountId = await fetchAccountScopeById(
    supabaseClient,
    ownerId,
    transactionRows.map((row) => row.financial_account_id),
  );
  const rowsById = new Map(transactionRows.map((row) => [row.id, row]));

  const transferRows = transactionRows.filter((row) => isInternalTransferDescription(row.description));
  const transferRowIds = new Set(transferRows.map((row) => row.id));

  // Direction-only fixes: the generic "unmapped fallback got the sign/kind wrong" case, excluding
  // anything the transfer classifier will handle instead (a transfer row needs both a kind AND a
  // category correction together, not just a sign flip).
  const directionFixes = transactionRows
    .filter((row) => !transferRowIds.has(row.id))
    .filter((row) => needsDirectionCorrection({ transactionKind: row.transaction_kind, normalizedCategory: row.normalized_category, amount: Number(row.amount) }))
    .map((row) => ({
      eventId: row.id,
      eventDate: row.event_date,
      amount: Number(row.amount),
      description: row.description,
    }));

  const transferMatch = classifyTransferPairs({
    rows: transferRows.map((row) => ({
      id: row.id,
      eventDate: row.event_date,
      amount: Number(row.amount),
      businessScope: scopeByAccountId.get(row.financial_account_id) ?? null,
    })),
  });

  const describePair = (id) => {
    const row = rowsById.get(id);
    return { eventId: id, eventDate: row.event_date, amount: Number(row.amount), description: row.description };
  };

  const internalTransfers = transferMatch.internalTransfers.map((pair) => ({
    inbound: describePair(pair.inboundId),
    outbound: describePair(pair.outboundId),
  }));
  const distributions = transferMatch.distributions.map((pair) => ({
    inbound: { ...describePair(pair.inboundId), businessScope: pair.inboundScope },
    outbound: { ...describePair(pair.outboundId), businessScope: pair.outboundScope },
  }));
  // entry.side tells whether eventId is the inbound or outbound leg -- an ambiguous row can be
  // either (e.g. an outbound-only transfer with no inbound counterpart at all in this owner's
  // data), so this is never assumed to be inbound the way it was before this was made symmetric.
  const ambiguousTransfers = transferMatch.ambiguous.map((entry) => ({
    ...describePair(entry.eventId),
    side: entry.side,
    reason: entry.reason,
    candidates: entry.candidateIds.map((id) => describePair(id)),
  }));

  const totalDirectionFixAmountCents = directionFixes.reduce((total, entry) => total + Math.round(Math.abs(entry.amount) * 100), 0);
  const totalDistributionAmountCents = distributions.reduce((total, entry) => total + Math.round(Math.abs(entry.inbound.amount) * 100), 0);

  return {
    directionFixes,
    totalDirectionFixAmountCents,
    internalTransfers,
    distributions,
    totalDistributionAmountCents,
    ambiguousTransfers,
    scannedCount: transactionRows.length,
  };
}

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const result = await computePreview(authenticated.supabaseClient, authenticated.effectiveOwnerId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return transferClassificationSchemaUnavailableResponse();
    console.error("Reconcile transfers preview error", error);
    return NextResponse.json({ error: "Unable to preview transfer/distribution classification." }, { status: 500 });
  }
}

// Applies the CURRENT preview (freshly recomputed, never client-supplied): direction fixes flip
// kind income<->expense and take the absolute value; internal transfers keep signed amounts so
// re-running the preview can still pair them; distributions use positive magnitudes.
// Ambiguous transfer rows are never written.
export async function POST() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let preview;
  try {
    preview = await computePreview(authenticated.supabaseClient, authenticated.effectiveOwnerId);
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return transferClassificationSchemaUnavailableResponse();
    console.error("Reconcile transfers apply (preview stage) error", error);
    return NextResponse.json({ error: "Unable to compute transfer/distribution classification." }, { status: 500 });
  }

  const applied = [];
  const failed = [];

  const applyOne = async ({ eventId, transactionKind, normalizedCategory, pAmount }) => {
    const { data, error } = await authenticated.supabaseClient.rpc("reclassify_transaction_financial_event", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_event_id: eventId,
      p_transaction_kind: transactionKind,
      p_normalized_category: normalizedCategory,
      p_amount: pAmount,
    });
    if (error) failed.push({ eventId, error: error.message });
    else applied.push({ eventId: data.id, transactionKind: data.transaction_kind, normalizedCategory: data.normalized_category });
  };

  for (const payload of buildApplyPayloads(preview)) {
    await applyOne(payload);
  }

  return NextResponse.json({
    success: failed.length === 0,
    appliedCount: applied.length,
    failedCount: failed.length,
    applied,
    failed,
    ambiguousCount: preview.ambiguousTransfers.length,
  });
}
