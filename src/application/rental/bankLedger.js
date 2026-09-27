// Bank account ledger — pure read model for the bank register.
//
// Source (authoritative only): financial_events rows linked to the selected bank
// account via bank_account_id. Active, non-deleted income/expense rows only —
// never guessed, never fuzzy-matched.
//
// Register convention: expenses post to the Debit column, income to
// the Credit column. The running balance is cumulative credits minus debits for
// the account, starting at 0 before the oldest entry. Rows sort by event_date,
// then by id for a stable order on same-date entries.
//
// The cleared flag is carried per entry so the register can show cleared/uncleared
// state and the reconcile summary can count them.

const EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);

const signedCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : 0;
};

// financial_events.amount is a decimal — round deliberately to cents.
const toEventCents = (decimalAmount) => signedCents(Math.round(Number(decimalAmount) * 100));

const label = (value) => String(value ?? "").replaceAll("_", " ");

export function buildBankLedger({ financialEvents = [], accountName = null } = {}) {
  const entries = [];
  for (const event of financialEvents) {
    if (event.is_deleted === true) continue;
    if (EXCLUDED_STATUSES.has(event.status)) continue;
    const kind = event.transaction_kind;
    if (kind !== "income" && kind !== "expense") continue;

    const amountCents = Math.abs(toEventCents(event.amount));
    entries.push({
      id: `event:${event.id}`,
      sourceId: event.id,
      date: event.event_date ? String(event.event_date).slice(0, 10) : null,
      description: event.description || "—",
      payee: event.payee || null,
      checkNumber: event.check_number || null,
      debitCents: kind === "expense" ? amountCents : 0,
      creditCents: kind === "income" ? amountCents : 0,
      category: label(event.normalized_category) || "—",
      propertyId: event.property_id || null,
      propertyLabel: event.property_label || null,
      tenantId: event.tenant_id || null,
      tenantLabel: event.tenant_label || null,
      transferGroupId: event.transfer_group_id || null,
      transferDirection: event.metadata?.transfer_direction || null,
      counterpartAccountId: event.metadata?.counterpart_account_id || null,
      counterpartAccountName: event.metadata?.counterpart_account_name || null,
      counterpartEventId: event.metadata?.counterpart_event_id || null,
      memo: event.metadata?.memo || null,
      cleared: event.cleared === true,
      clearedAt: event.cleared_at || null,
      status: event.status || "active",
      sourceSystem: event.source_system || null,
    });
  }

  // Chronological register: date first, id second for same-date stability.
  entries.sort((a, b) => {
    if (a.date !== b.date) return (a.date || "") < (b.date || "") ? -1 : 1;
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });

  let balanceCents = 0;
  let clearedBalanceCents = 0;
  let unclearedCount = 0;
  for (const entry of entries) {
    balanceCents += entry.creditCents - entry.debitCents;
    entry.balanceAfterCents = balanceCents;
    if (entry.cleared) {
      clearedBalanceCents += entry.creditCents - entry.debitCents;
    } else {
      unclearedCount += 1;
    }
  }

  return Object.freeze({
    accountName,
    entries: Object.freeze(entries),
    balanceCents,
    clearedBalanceCents,
    unclearedCount,
    entryCount: entries.length,
  });
}
