// Property expense ledger — pure read model for the property card "Expenses History"
// slice.
//
// Sources (authoritative only):
//   financial_events            active, non-deleted expense rows whose property_id matches
//                               the unit's property_id (or unit id as a fallback). Only safe
//                               source_systems, following buildRentalFinancialPerformance's
//                               conservative scoping — never guessed, never fuzzy-matched.
//   rental_contractor_payments  contractor payments recorded against the same property.
//
// Overlap resolution (deliberate, documented):
//   1. Explicit link wins: a financial_event whose source_record_id or
//      metadata.contractor_payment_id references a contractor payment id is the SAME
//      economic event — the financial_events row is suppressed and the contractor entry
//      notes both sources. This is a collapse, not a guess.
//   2. Ambiguous pairs (same amount, same date, same property, no explicit link) are NOT
//      collapsed — both rows stay, each flagged possibleDuplicate, so a real coincidence
//      can never be silently erased. The owner resolves it by deleting one source.

const SAFE_EXPENSE_SOURCES = new Set(["manual", "rentec", "rentec_api"]);
const EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);

const SOURCE_LABELS = {
  manual: "Manual entry",
  rentec: "Rentec import",
  rentec_api: "Rentec import",
  contractor_payment: "Contractor payment",
};

const signedCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : 0;
};

// financial_events.amount is a decimal — round deliberately to cents instead of depending
// on floating-point integer exactness (e.g. 19.99 * 100 === 1998.9999999999998).
const toEventCents = (decimalAmount) => signedCents(Math.round(Number(decimalAmount) * 100));

function eventPropertyMatches(event, propertyId, unitId) {
  const slug = event.property_id;
  return Boolean(slug) && (slug === propertyId || (unitId && slug === unitId));
}

function contractorPropertyMatches(payment, propertyId, unitId) {
  const slug = payment.property_id;
  return Boolean(slug) && (slug === propertyId || (unitId && slug === unitId));
}

function contractorPaymentIdOf(event) {
  if (!event) return null;
  if (typeof event.source_record_id === "string" && event.source_record_id.startsWith("rental_contractor_payment_")) {
    return event.source_record_id;
  }
  const viaMetadata = event.metadata && typeof event.metadata === "object"
    ? event.metadata.contractor_payment_id
    : null;
  return typeof viaMetadata === "string" && viaMetadata ? viaMetadata : null;
}

export function buildPropertyExpenseLedger({
  propertyId,
  unitId = null,
  financialEvents = [],
  contractorPayments = [],
  contractors = [],
} = {}) {
  const contractorById = new Map(contractors.map((c) => [c.id, c]));
  const contractorEntryById = new Map();
  const suppressedEventIds = new Set();

  // Contractor payments first: they are the canonical record of a contractor payout.
  const contractorEntries = [];
  for (const payment of contractorPayments) {
    if (!contractorPropertyMatches(payment, propertyId, unitId)) continue;
    const contractor = contractorById.get(payment.contractor_id);
    const entry = {
      id: `contractor:${payment.id}`,
      sourceId: payment.id,
      source: "contractor_payment",
      sourceLabel: SOURCE_LABELS.contractor_payment,
      date: payment.paid_at || null,
      amountCents: signedCents(payment.amount_cents),
      vendor: contractor?.business_name || payment.contractor_id || "Contractor",
      category: contractor?.trade ? `Contractor — ${contractor.trade}` : "Contractor payment",
      method: payment.payment_method || null,
      status: "paid",
      reference: payment.invoice_reference || payment.reference || null,
      notes: payment.notes || null,
      alsoRecordedAs: [],
      possibleDuplicate: false,
    };
    contractorEntries.push(entry);
    contractorEntryById.set(payment.id, entry);
  }

  // Manual / imported financial events — explicit links to a contractor payment collapse
  // into the contractor entry instead of double-counting.
  const eventEntries = [];
  for (const event of financialEvents) {
    if (event.transaction_kind !== "expense") continue;
    if (event.is_deleted === true) continue;
    if (EXCLUDED_STATUSES.has(event.status)) continue;
    if (!SAFE_EXPENSE_SOURCES.has(event.source_system)) continue;
    if (!eventPropertyMatches(event, propertyId, unitId)) continue;
    const linkedContractorId = contractorPaymentIdOf(event);
    const linked = linkedContractorId ? contractorEntryById.get(linkedContractorId) : null;
    if (linked) {
      suppressedEventIds.add(event.id);
      if (!linked.alsoRecordedAs.includes(SOURCE_LABELS[event.source_system] || event.source_system)) {
        linked.alsoRecordedAs.push(SOURCE_LABELS[event.source_system] || event.source_system);
      }
      continue;
    }
    eventEntries.push({
      id: `event:${event.id}`,
      sourceId: event.id,
      source: event.source_system,
      sourceLabel: SOURCE_LABELS[event.source_system] || event.source_system,
      date: event.event_date || null,
      amountCents: Math.abs(toEventCents(event.amount)),
      vendor: event.description || "Expense",
      category: event.normalized_category ? String(event.normalized_category).replaceAll("_", " ") : "Expense",
      method: event.metadata?.payment_method || null,
      status: event.status || "active",
      reference: event.source_record_id || null,
      notes: null,
      alsoRecordedAs: [],
      possibleDuplicate: false,
    });
  }

  // Ambiguous overlap: same amount + same date + same property, no explicit link.
  // Flagged, never collapsed.
  const byAmountDate = new Map();
  for (const entry of [...contractorEntries, ...eventEntries]) {
    if (!entry.date) continue;
    const key = `${entry.amountCents}|${entry.date}`;
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

  const entries = [...contractorEntries, ...eventEntries]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id).localeCompare(String(b.id)));

  const totalCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);

  return Object.freeze({
    propertyId,
    entries: Object.freeze(entries),
    totalCents,
    suppressedDuplicateCount: suppressedEventIds.size,
    possibleDuplicateCount: entries.filter((entry) => entry.possibleDuplicate).length,
  });
}
