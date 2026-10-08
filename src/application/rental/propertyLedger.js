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
// does: an expense financial_events row is suppressed when it references the contractor
// payment id AND the amounts agree. Income rows are never suppressed by a contractor
// link — an income event is money coming in, not the same money as the contractor debit.
//
// Property identity: property-slug comparisons resolve BOTH sides through
// canonicalPropertySlug (the explicit alias map in
// src/domains/property/propertyAliases.js) so the variant slugs two historical
// import pipelines wrote for the same house match here. Unit-ID comparisons
// stay exact membership — a unit ID is an identifier, never a property slug,
// and is never canonicalized. A null property_id never matches this ledger.

import { canonicalPropertySlug } from "@/domains/property/propertyAliases";
import {
  FINANCIAL_EVENT_SAFE_SOURCES,
  FINANCIAL_EVENT_EXCLUDED_STATUSES,
  contractorPaymentIdOf,
} from "@/domains/rental/financialEventRules.js";

export { contractorPaymentIdOf };

const SAFE_SOURCES = FINANCIAL_EVENT_SAFE_SOURCES;
const EXCLUDED_STATUSES = FINANCIAL_EVENT_EXCLUDED_STATUSES;
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

// Property-slug comparison: canonicalized on BOTH sides through
// canonicalPropertySlug (explicit alias map only) so the variant slugs the
// two historical import pipelines wrote for one house resolve together.
function propertySlugMatches(slug, propertyId) {
  if (!slug || !propertyId) return false;
  return canonicalPropertySlug(slug) === canonicalPropertySlug(propertyId);
}

// Unit-ID comparison: exact membership only — unit IDs are identifiers, not
// property slugs, so they are never canonicalized or alias-resolved.
function unitIdMatches(id, unitIds) {
  return Boolean(id) && unitIds.has(id);
}

// Rows keyed by a property reference (financial_events.property_id, contractor
// payments, lease.property_id) historically hold either the property slug or
// one of the property's unit IDs; accept either, slug path canonicalized,
// unit path exact. A null slug never matches.
function propertyMatches(slug, propertyId, unitIds) {
  if (!slug) return false;
  return propertySlugMatches(slug, propertyId) || unitIdMatches(slug, unitIds);
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
  attachmentEventIds = null,
} = {}) {
  const unitIdSet = new Set(unitIds);
  const contractorById = new Map(contractors.map((c) => [c.id, c]));
  // Lease -> property mapping for the income side: a payment belongs to this property
  // when its lease's property slug (canonicalized) matches, or when its unit_id is
  // exactly one of this property's unit IDs. lease.unit_id is a unit ID, not a
  // property slug, so it takes the exact path only — the previous combined
  // helper also equated a unit_id string equal to the property slug, which
  // conflated the two kinds of identifier and is removed deliberately.
  const leasePropertyMatches = new Map();
  for (const lease of leases) {
    leasePropertyMatches.set(
      lease.id,
      propertyMatches(lease.property_id, propertyId, unitIdSet) ||
        unitIdMatches(lease.unit_id, unitIdSet),
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

    // Explicit contractor link with agreeing amounts collapses into the contractor
    // entry — expenses only. An income event referencing a contractor payment id is
    // money coming in, never the same money as the contractor debit, so it must
    // never be suppressed.
    const linkedContractorId = contractorPaymentIdOf(event);
    const linked = linkedContractorId ? contractorEntryById.get(linkedContractorId) : null;
    const amountsMatch = linked ? Math.abs(toEventCents(event.amount)) === linked.debitCents : false;
    if (linked && amountsMatch && kind === "expense") {
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
      checkNumber: event.check_number || null,
      cleared: event.cleared === true,
      hasAttachment: attachmentEventIds instanceof Set ? attachmentEventIds.has(event.id) : false,
      payee: event.payee || null,
      memo: event.metadata?.memo || null,
      notes: linked && !amountsMatch ? "Possible linked mismatch — review source records" : null,
      possibleDuplicate: Boolean(linked) && !amountsMatch,
    });
  }

  // rental_payments: succeeded payments on this property's leases post to Credit.
  for (const payment of rentalPayments) {
    if (!leasePropertyMatches.get(payment.lease_id)) continue;
    const tenantName = tenantsById[payment.tenant_id]?.display_name || null;
    const hasBalanceEffect = BALANCE_EFFECT_STATUSES.has(payment.status);
    const refundedCents = signedCents(payment.refunded_amount_cents || 0);
    const amountCents = signedCents(payment.amount_cents) - refundedCents;
    // rental_payments has no refund timestamp column (verified across migrations and
    // app code), so a refund cannot become a separate dated entry without inventing a
    // date — which we never do. The credit stays netted into the original payment,
    // and the entry is annotated so the historical running balance is not mistaken
    // for exact chronology around the refund.
    const refundNote = refundedCents > 0
      ? `Includes $${(refundedCents / 100).toFixed(2)} refund — refund date not recorded, timing approximate`
      : null;
    const statusNote = hasBalanceEffect ? null : `No balance effect — status: ${label(payment.status)}`;
    const notes = [refundNote, statusNote].filter(Boolean).join("; ") || null;
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
      notes,
      possibleDuplicate: false,
    });
  }

  // Ambiguous overlap: same amount + same direction + same date across different
  // sources, no explicit link. Flagged, never collapsed. Direction is part of the
  // key — a debit and a credit of the same amount on the same date are financially
  // distinct transactions, not duplicates of each other.
  const byAmountDate = new Map();
  for (const entry of entries) {
    if (!entry.date) continue;
    const magnitude = entry.debitCents + entry.creditCents;
    const direction = entry.debitCents > 0 ? "debit" : entry.creditCents > 0 ? "credit" : "neither";
    const key = `${magnitude}|${direction}|${entry.date}`;
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
