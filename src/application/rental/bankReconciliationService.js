// Bank reconciliation service — loads the register, saves reconciliations,
// and undoes them. Takes the Supabase client as a parameter (owner-scoped
// queries only), so it is testable without a network.
//
// Trust model: the server never takes figures from the client. On save it
// re-reads the account's register from financial_events, verifies the
// client's cleared-state changes actually landed (they are applied through
// the existing PATCH /api/rental/financial-event, behind the UI's CONFIRM
// gate), and computes every total with the pure domain function. Undo
// restores each changed item's exact prior cleared/cleared_at from the
// snapshot, then marks the record undone — never deletes it.

import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { buildBankLedger } from "@/application/rental/bankLedger";
import { planUndo, reconcileStatement, validateStatement } from "@/domains/rental/bankReconciliation";

const EVENT_COLUMNS =
  "id, event_date, description, amount, transaction_kind, normalized_category, property_id, payee, check_number, bank_account_id, cleared, cleared_at, source_system, status, is_deleted";

export class ReconciliationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** True when a Supabase/PostgREST error means the table doesn't exist yet (migration not applied). */
export function isMissingTableError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /42P01|PGRST205|relation .* does not exist|Could not find the table/i.test(text);
}

async function loadAccount(db, ownerId, bankAccountId) {
  const { data, error } = await db
    .from("financial_accounts")
    .select("id, name, official_name, type, active")
    .eq("owner_id", ownerId)
    .eq("id", bankAccountId)
    .limit(1);
  if (error) throw error;
  const account = (data || [])[0];
  if (!account) throw new ReconciliationError("Bank account was not found.", 404);
  return account;
}

/** The account's register (buildBankLedger) from financial_events. */
export async function loadAccountRegister(db, ownerId, bankAccountId) {
  const account = await loadAccount(db, ownerId, bankAccountId);
  const events = await fetchAllOwnerFinancialEvents(db, ownerId, { columns: EVENT_COLUMNS });
  const ledger = buildBankLedger({
    financialEvents: (events || []).filter((e) => e.bank_account_id === bankAccountId),
    accountName: account.official_name || account.name || account.id,
  });
  return { account, ledger };
}

/** Reconciliations for an account, newest statement first. { available, reconciliations } */
export async function listReconciliations(db, ownerId, bankAccountId) {
  const { data, error } = await db
    .from("bank_reconciliations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("bank_account_id", bankAccountId)
    .order("period_end", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { available: false, reconciliations: [] };
    throw error;
  }
  return { available: true, reconciliations: data || [] };
}

function assertSnapshot(snapshot, entriesById) {
  if (!Array.isArray(snapshot)) throw new ReconciliationError("The cleared-state snapshot is missing.");
  const seen = new Set();
  for (const s of snapshot) {
    if (!s || typeof s.eventId !== "string" || typeof s.clearedBefore !== "boolean" || typeof s.clearedAfter !== "boolean") {
      throw new ReconciliationError("The cleared-state snapshot is malformed.");
    }
    if (seen.has(s.eventId)) throw new ReconciliationError("The cleared-state snapshot lists a transaction twice.");
    seen.add(s.eventId);
    if (!entriesById.has(s.eventId)) throw new ReconciliationError("The snapshot names a transaction that isn't on this account.");
  }
}

/**
 * Save a reconciliation after the cleared changes have been applied.
 * input: { bankAccountId, periodStart, periodEnd, statementEndingBalanceCents, snapshot }
 */
export async function saveReconciliation(db, { ownerId, userId }, input) {
  const { bankAccountId, periodStart, periodEnd, statementEndingBalanceCents, snapshot } = input || {};
  const problems = validateStatement({ periodStart, periodEnd, statementEndingBalanceCents });
  if (problems.length) throw new ReconciliationError(problems.join(" "));
  if (typeof bankAccountId !== "string" || !bankAccountId.trim()) throw new ReconciliationError("bankAccountId is required.");

  const { ledger } = await loadAccountRegister(db, ownerId, bankAccountId);
  const entriesById = new Map(ledger.entries.map((e) => [e.sourceId, e]));
  assertSnapshot(snapshot, entriesById);
  const notApplied = snapshot.filter((s) => entriesById.get(s.eventId).cleared !== s.clearedAfter);
  if (notApplied.length) {
    throw new ReconciliationError(`${notApplied.length} cleared change(s) weren't saved yet — nothing was recorded. Try again.`, 409);
  }

  const existing = await listReconciliations(db, ownerId, bankAccountId);
  if (!existing.available) throw new ReconciliationError("Reconciliation records aren't enabled yet (the database update hasn't been applied).", 503);
  const latest = existing.reconciliations.find((r) => r.status === "active");
  if (latest && periodEnd <= latest.period_end) {
    throw new ReconciliationError(`This account is already reconciled through ${latest.period_end}. Start the next statement after that date.`, 409);
  }

  // Figures from the database's current state — never from the client.
  const result = reconcileStatement({ entries: ledger.entries, periodStart, periodEnd, statementEndingBalanceCents });
  const clearedEventIds = ledger.entries.filter((e) => e.cleared && e.date && e.date >= periodStart && e.date <= periodEnd).map((e) => e.sourceId);
  const row = {
    owner_id: ownerId,
    bank_account_id: bankAccountId,
    period_start: periodStart,
    period_end: periodEnd,
    statement_ending_balance_cents: statementEndingBalanceCents,
    cleared_balance_cents: result.clearedBalanceCents,
    book_balance_cents: result.bookBalanceCents,
    difference_cents: result.differenceCents,
    outstanding_count: result.outstandingCount,
    outstanding_deposits_cents: result.outstandingDepositsCents,
    outstanding_payments_cents: result.outstandingPaymentsCents,
    cleared_snapshot: snapshot,
    cleared_event_ids: clearedEventIds,
    outstanding_event_ids: result.outstanding.map((e) => e.sourceId),
    status: "active",
    created_by: userId,
  };
  const { data, error } = await db.from("bank_reconciliations").insert(row).select("*").limit(1);
  if (error) throw error;
  return { reconciliation: (data || [])[0] || null, result };
}

/** Undo a reconciliation: restore every changed item exactly, then mark it undone (never delete). */
export async function undoReconciliation(db, { ownerId, userId }, { id, reason }) {
  if (typeof id !== "string" || !id.trim()) throw new ReconciliationError("A reconciliation id is required.");
  const { data, error } = await db.from("bank_reconciliations").select("*").eq("owner_id", ownerId).eq("id", id).limit(1);
  if (error) {
    if (isMissingTableError(error)) throw new ReconciliationError("Reconciliation records aren't enabled yet.", 503);
    throw error;
  }
  const rec = (data || [])[0];
  if (!rec) throw new ReconciliationError("Reconciliation was not found.", 404);
  const { reconciliations } = await listReconciliations(db, ownerId, rec.bank_account_id);
  const plan = planUndo(rec, reconciliations);
  if (!plan.ok) throw new ReconciliationError(plan.reason, 409);

  // Idempotent restores: re-running an interrupted undo is safe.
  for (const r of plan.restores) {
    const { error: restoreError } = await db
      .from("financial_events")
      .update({ cleared: r.cleared, cleared_at: r.clearedAt, updated_by: userId })
      .eq("owner_id", ownerId)
      .eq("id", r.eventId);
    if (restoreError) throw restoreError;
  }
  const { data: undone, error: undoError } = await db
    .from("bank_reconciliations")
    .update({ status: "undone", undone_by: userId, undone_at: new Date().toISOString(), undo_reason: String(reason || "").slice(0, 500) || null })
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("*")
    .limit(1);
  if (undoError) throw undoError;
  return { reconciliation: (undone || [])[0] || null, restored: plan.restores.length };
}
