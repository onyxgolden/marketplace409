// Property ledger — pure read model for the per-property Rentec-style ledger.
//
// Sources (authoritative only):
//   financial_events            active, non-deleted income/expense rows whose property_id
//                               matches the property (or one of its units). Safe
//                               source_systems only — never guessed, never fuzzy-matched.
//   rental_contractor_payments  contractor payouts recorded against the property (expenses).
//   rental_payments              succeeded payments on this property's leases (rental income).
//   rental_leases                maps a payment's lease_id to the property.
//
// Rentec convention carried through: Debit = money out (expense), Credit = money in
// (income). The running balance is cumulative credits minus debits — the property's net
// cash position for the ledger period, starting at 0 before the oldest entry.
//
// Overlap (deliberate, documented): a manual income posting and a rental_payment for the
// same rent are different sources with no explicit link between them. Same amount +
// same date across different sources is flagged possibleDuplicate — never collapsed, so
// a real coincidence can never be silently erased. The owner resolves it by deleting one
// source. Explicit contractor-payment links collapse the same way propertyExpenseLedger
// does: the financial_events row is suppressed when it references the contractor payment
// id AND the amounts agree.

const SAFE_SOURCES = new Set(["manual", "rentec", "rentec_api"]);
const EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);
// Only payments that actually moved money affect the balance. Failed/cancelled/
// processing payments stay visible with their status but contribute nothing.
const BALANCE_EFFECT_STATUSES = new Set(["succeeded", "paid", "settled"]);

const SOURCE_LABELS = {
  manual: "Manual entry",
  rentec: "Rentec import",
  rentec_api: "Rentec import",
  contractor_payment: "Contractor payment",
  rental_payment: "Rent payment",
};

const signedCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : 0;
};

// financial_events.amount is a decimal — round deliberately to cents.
const toEventCents = (decimalAmount) => signedCents(Math.round(Number(decimalAmount) * 100));

const label = (value) => String(value ?? "").replaceAll("_", " ");

function propertyMatches(slug, propertyId, unitIds) {
  if (!slug) return false;
  if (slug === propertyId) return true;
  return unitIds.has(slug);
}

function contractorPaymentIdOf(event) {
  if (!event) return null;
  const PREFIX = "rental_contractor_payment_";
  if (typeof event.source_record_id === "string" && event.source_record_id.startsWith(PREFIX)) {
    return event.source_record_id.slice(PREFIX.length);
  }
  const viaMetadata = event.metadata && typeof event.metadata === "object"
    ? event.metadata.contractor_payment_id
    : null;
  return typeof viaMetadata === "string" && viaMetadata ? viaMetadata : null;
}

export function buildPropertyLedger({
  propertyId,
  propertyLabel = null,
  unitIds = [],
  financialEvents = [],
  contractorPayments = [],
  contractors = [],
  rentalPayments = [],
  leases = [],
  tenantsById = {},
} = {}) {
  const unitIdSet = new Set(unitIds);
  const contractorById = new Map(contractors.map((c) => [c.id, c]));
  // Lease -> property mapping for the income side: a payment belongs to this property
  // when its lease's property_id (or unit_id) matches.
  const leasePropertyMatches = new Map();
  for (const lease of leases) {
    leasePropertyMatches.set(
      lease.id,
      propertyMatches(lease.property_id, propertyId, unitIdSet) ||
        propertyMatches(lease.unit_id, propertyId, unitIdSet),
    );
  }

  const entries = [];
  const contractorEntryById = new Map();
  const suppressedEventIds = new Set();

  // Contractor payments: canonical record of a contractor payout (debit).
  for (const payment of contractorPayments) {
    if (!propertyMatches(payment.property_id, propertyId, unitIdSet)) continue;
    const contractor = contractorById.get(payment.contractor_id);
    const entry = {
      id: `contractor:${payment.id}`,
      sourceId: payment.id,
      source: "contractor_payment",
      sourceLabel: SOURCE_LABELS.contractor_payment,
      date: payment.paid_at ? String(payment.paid_at).slice(0, 10) : null,
      description: contractor?.business_name || "Contractor payment",
      debitCents: signedCents(payment.amount_cents),
      creditCents: 0,
      category: contractor?.trade ? `Contractor — ${contractor.trade}` : "Contractor payment",
      reference: payment.invoice_reference || payment.reference || null,
      method: payment.payment_method || null,
      status: "paid",
      notes: payment.notes || null,
      possibleDuplicate: false,
    };
    entries.push(entry);
    contractorEntryById.set(payment.id, entry);
  }

  // financial_events: income posts to Credit, expense posts to Debit.
  for (const event of financialEvents) {
    if (event.is_deleted === true) continue;
    if (EXCLUDED_STATUSES.has(event.status)) continue;
    if (!SAFE_SOURCES.has(event.source_system)) continue;
    if (!propertyMatches(event.property_id, propertyId, unitIdSet)) continue;
    const kind = event.transaction_kind;
    if (kind !== "income" && kind !== "expense") continue;

    // Explicit contractor link with agreeing amounts collapses into the contractor entry.
    const linkedContractorId = contractorPaymentIdOf(event);
    const linked = linkedContractorId ? contractorEntryById.get(linkedContractorId) : null;
    const amountsMatch = linked ? Math.abs(toEventCents(event.amount)) === linked.debitCents : false;
    if (linked && amountsMatch) {
      suppressedEventIds.add(event.id);
      const labelText = SOURCE_LABELS[event.source_system] || event.source_system;
      if (!linked.alsoRecordedAs) linked.alsoRecordedAs = [];
      if (!linked.alsoRecordedAs.includes(labelText)) linked.alsoRecordedAs.push(labelText);
      continue;
    }

    const amountCents = Math.abs(toEventCents(event.amount));
    entries.push({
      id: `event:${event.id}`,
      sourceId: event.id,
      source: event.source_system,
      sourceLabel: SOURCE_LABELS[event.source_system] || event.source_system,
      date: event.event_date || null,
      description: event.description || (kind === "income" ? "Income" : "Expense"),
      debitCents: kind === "expense" ? amountCents : 0,
      creditCents: kind === "income" ? amountCents : 0,
      category: event.normalized_category ? label(event.normalized_category) : (kind === "income" ? "Income" : "Expense"),
      reference: event.source_record_id || null,
      method: event.metadata?.payment_method || null,
      status: event.status || "active",
      notes: linked && !amountsMatch ? "Possible linked mismatch — review source records" : null,
      possibleDuplicate: Boolean(linked) && !amountsMatch,
    });
  }

  // rental_payments: succeeded payments on this property's leases post to Credit.
  for (const payment of rentalPayments) {
    if (!leasePropertyMatches.get(payment.lease_id)) continue;
    const tenantName = tenantsById[payment.tenant_id]?.display_name || null;
    const hasBalanceEffect = BALANCE_EFFECT_STATUSES.has(payment.status);
    const amountCents = signedCents(payment.amount_cents) - signedCents(payment.refunded_amount_cents || 0);
    entries.push({
      id: `payment:${payment.id}`,
      sourceId: payment.id,
      source: "rental_payment",
      sourceLabel: SOURCE_LABELS.rental_payment,
      date: payment.received_at ? String(payment.received_at).slice(0, 10)
        : payment.succeeded_at ? String(payment.succeeded_at).slice(0, 10)
        : payment.created_at ? String(payment.created_at).slice(0, 10) : null,
      description: tenantName ? `Rent payment — ${tenantName}` : "Rent payment",
      debitCents: 0,
      creditCents: hasBalanceEffect ? Math.max(0, amountCents) : 0,
      category: "Rental income",
      reference: payment.receipt_reference || payment.provider_payment_id || null,
      method: payment.payment_method || payment.provider || null,
      status: payment.status,
      notes: hasBalanceEffect ? null : `No balance effect — status: ${label(payment.status)}`,
      possibleDuplicate: false,
    });
  }

  // Ambiguous overlap: same amount + same date across different sources, no explicit
  // link. Flagged, never collapsed.
  const byAmountDate = new Map();
  for (const entry of entries) {
    if (!entry.date) continue;
    const magnitude = entry.debitCents + entry.creditCents;
    const key = `${magnitude}|${entry.date}`;
    const group = byAmountDate.get(key) || [];
    group.push(entry);
    byAmountDate.set(key, group);
  }
  for (const group of byAmountDate.values()) {
    const kinds = new Set(group.map((entry) => entry.source));
    if (group.length > 1 && kinds.size > 1) {
      for (const entry of group) entry.possibleDuplicate = true;
    }
  }

  // Chronological for the running balance (oldest first), then newest-first for display.
  const chronological = [...entries].sort(
    (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.id).localeCompare(String(b.id)),
  );
  let runningCents = 0;
  for (const entry of chronological) {
    runningCents += entry.creditCents - entry.debitCents;
    entry.balanceAfterCents = runningCents;
  }
  const displayEntries = [...chronological].reverse();

  const totalDebitCents = entries.reduce((sum, e) => sum + e.debitCents, 0);
  const totalCreditCents = entries.reduce((sum, e) => sum + e.creditCents, 0);

  return Object.freeze({
    propertyId,
    propertyLabel,
    entries: Object.freeze(displayEntries.map((e) => Object.freeze(e))),
    totalDebitCents,
    totalCreditCents,
    balanceCents: runningCents,
    entryCount: entries.length,
    suppressedDuplicateCount: suppressedEventIds.size,
    possibleDuplicateCount: entries.filter((entry) => entry.possibleDuplicate).length,
  });
}
