import { NextResponse } from "next/server";
import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { transferClassificationSchemaUnavailableResponse } from "@/lib/supabase/transferClassificationSchemaUnavailableResponse";
import { needsDirectionCorrection } from "@/domains/financial-event/correctRawBankFeedDirection";
import { isInternalTransferDescription, classifyTransferPairs } from "@/domains/financial-event/classifyTransferPairs";
import { buildApplyPayloads } from "@/domains/financial-event/buildTransferApplyPayloads";
import { isPairAlreadyApplied } from "@/domains/financial-event/isPairAlreadyApplied";
import { isAmbiguousRowResolved } from "@/domains/financial-event/isAmbiguousRowResolved";
import { loanPaymentCategory } from "@/domains/financial-event/loanPaymentCategory";
import { trainCategorizer, suggestTopCategory } from "@/domains/ledger/brain/categorize.js";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";

// Target state the apply writes for a plain internal-transfer pair (both legs).
const TRANSFER_INTERNAL_TARGET = Object.freeze({ kind: "transfer", category: "internal_transfer" });

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

// financial_accounts.type === 'credit' means a loan/HELOC/credit line, not a plain checking/savings
// account -- a transfer that touches one is real debt service, never a no-op internal shuffle. See
// classifyTransferPairs.js's isLoanAccount doc comment for the production example this came from.
async function fetchAccountDetailsById(supabaseClient, ownerId, accountIds) {
  const detailsById = new Map();
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return detailsById;
  const { data, error } = await supabaseClient.from("financial_accounts").select("id, business_scope, type, name").eq("owner_id", ownerId).in("id", uniqueIds);
  if (error) throw error;
  for (const row of data ?? []) detailsById.set(row.id, { businessScope: row.business_scope, isLoanAccount: row.type === "credit", accountName: row.name });
  return detailsById;
}

// Fetches fresh and re-derives both classifications every time -- GET and POST both call this so
// the apply action can never diverge from what a human most recently reviewed as a preview.
// withSuggestions trains the Brain auto-categorizer on the owner's decided rows and attaches a
// top suggestion to each ambiguous entry. Read-only: suggestions never apply anything.
async function computePreview(supabaseClient, ownerId, { withSuggestions = false } = {}) {
  const transactionRows = await fetchAllTransactionRows(supabaseClient, ownerId);
  const accountDetailsById = await fetchAccountDetailsById(
    supabaseClient,
    ownerId,
    transactionRows.map((row) => row.financial_account_id),
  );
  const rowsById = new Map(transactionRows.map((row) => [row.id, row]));

  // Brain auto-categorizer (slice 2): learn from every decided row -- anything
  // not carrying the 'other'/null undecided marker, i.e. the owner's own
  // history including previous applies and manual corrections.
  const suggestionModel = withSuggestions
    ? trainCategorizer(
        transactionRows
          .filter((row) => isAmbiguousRowResolved(row.normalized_category))
          .map((row) => ({
            description: row.description,
            amount: Number(row.amount),
            category: row.normalized_category,
          })),
      )
    : null;

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
    rows: transferRows.map((row) => {
      const details = accountDetailsById.get(row.financial_account_id);
      return {
        id: row.id,
        eventDate: row.event_date,
        amount: Number(row.amount),
        businessScope: details?.businessScope ?? null,
        isLoanAccount: details?.isLoanAccount ?? false,
      };
    }),
  });

  const describePair = (id) => {
    const row = rowsById.get(id);
    return { eventId: id, eventDate: row.event_date, amount: Number(row.amount), description: row.description };
  };

  // The expense category a debt-payment pair's depository leg will be written with --
  // shared by the already-applied filter and the preview entry so they can't disagree.
  const debtExpenseCategory = (pair) => {
    const inRow = rowsById.get(pair.inboundId);
    const loanAccountName = accountDetailsById.get(inRow.financial_account_id)?.accountName ?? "Loan";
    return { loanAccountName, expenseCategory: loanPaymentCategory(loanAccountName) };
  };

  const internalTransfers = transferMatch.internalTransfers
    // Already in the target state? Re-applying is a no-op, so hide it -- otherwise the
    // panel never empties after a successful apply and the user re-confirms done work.
    .filter(
      (pair) =>
        !isPairAlreadyApplied({
          inboundId: pair.inboundId,
          outboundId: pair.outboundId,
          expectedInbound: TRANSFER_INTERNAL_TARGET,
          expectedOutbound: TRANSFER_INTERNAL_TARGET,
          rowById: rowsById,
        }),
    )
    .map((pair) => ({
      inbound: describePair(pair.inboundId),
      outbound: describePair(pair.outboundId),
    }));
  const distributions = transferMatch.distributions
    .filter(
      (pair) =>
        !isPairAlreadyApplied({
          inboundId: pair.inboundId,
          outboundId: pair.outboundId,
          expectedInbound: { kind: "income", category: "owner_distribution" },
          expectedOutbound: { kind: "expense", category: "owner_distribution" },
          rowById: rowsById,
        }),
    )
    .map((pair) => ({
      inbound: { ...describePair(pair.inboundId), businessScope: pair.inboundScope },
      outbound: { ...describePair(pair.outboundId), businessScope: pair.outboundScope },
    }));
  // outbound = the depository account the payment left (the real, budget-visible expense);
  // inbound = the loan account receiving it (kept signed so the pair stays re-pairable).
  // expenseCategory is resolved here (not in buildApplyPayloads) so the preview shows the human
  // exactly the category the apply will write.
  const debtPayments = transferMatch.debtPayments
    .filter(
      (pair) =>
        !isPairAlreadyApplied({
          inboundId: pair.inboundId,
          outboundId: pair.outboundId,
          expectedInbound: TRANSFER_INTERNAL_TARGET,
          expectedOutbound: { kind: "expense", category: debtExpenseCategory(pair).expenseCategory },
          rowById: rowsById,
        }),
    )
    .map((pair) => {
      const { loanAccountName, expenseCategory } = debtExpenseCategory(pair);
      return {
        inbound: describePair(pair.inboundId),
        outbound: describePair(pair.outboundId),
        loanAccountName,
        expenseCategory,
      };
    });
  // entry.side tells whether eventId is the inbound or outbound leg -- an ambiguous row can be
  // either (e.g. an outbound-only transfer with no inbound counterpart at all in this owner's
  // data), so this is never assumed to be inbound the way it was before this was made symmetric.
  // Rows that already carry a decided classification are hidden here: 'other' is the
  // system's "undecided" marker, so anything else means a human or a previous apply
  // already made the call (e.g. one-sided transfers to an unconnectable external
  // account, or already-applied distribution legs).
  const ambiguousTransfers = transferMatch.ambiguous
    .filter((entry) => !isAmbiguousRowResolved(rowsById.get(entry.eventId)?.normalized_category))
    .map((entry) => {
      const row = describePair(entry.eventId);
      return {
        ...row,
        side: entry.side,
        reason: entry.reason,
        candidates: entry.candidateIds.map((id) => describePair(id)),
        // Advisory only: the Brain's best guess from the owner's own history.
        // Ambiguous rows are never written by the apply flow.
        suggestion: withSuggestions
          ? suggestTopCategory(suggestionModel, { description: row.description, amount: row.amount })
          : null,
      };
    });

  const totalDirectionFixAmountCents = directionFixes.reduce((total, entry) => total + Math.round(Math.abs(entry.amount) * 100), 0);
  const totalDistributionAmountCents = distributions.reduce((total, entry) => total + Math.round(Math.abs(entry.inbound.amount) * 100), 0);
  const totalDebtPaymentAmountCents = debtPayments.reduce((total, entry) => total + Math.round(Math.abs(entry.outbound.amount) * 100), 0);

  return {
    directionFixes,
    totalDirectionFixAmountCents,
    internalTransfers,
    distributions,
    totalDistributionAmountCents,
    debtPayments,
    totalDebtPaymentAmountCents,
    ambiguousTransfers,
    scannedCount: transactionRows.length,
  };
}

export async function GET() {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  try {
    const result = await computePreview(authenticated.supabaseClient, authenticated.effectiveOwnerId, {
      withSuggestions: true,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) return transferClassificationSchemaUnavailableResponse();
    console.error("Reconcile transfers preview error", error);
    return NextResponse.json({ error: "Unable to preview transfer/distribution classification." }, { status: 500 });
  }
}

// Applies the CURRENT preview (freshly recomputed, never client-supplied): direction fixes flip
// kind income<->expense and take the absolute value; internal transfers keep signed amounts so
// re-running the preview can still pair them; distributions use positive magnitudes; debt payments
// write the depository leg as a real expense (heloc_payment/loan_payment/...) and keep the loan
// leg signed as an internal_transfer so the pair stays re-pairable.
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
