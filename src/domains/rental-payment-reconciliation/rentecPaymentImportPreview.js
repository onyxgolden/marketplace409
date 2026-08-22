// Pure classifier for the Rentec external-payment reconciliation import. Distinct in purpose from
// rentecReconciliationPreview.js (which flags gaps in FORGE's own charge coverage against Rentec
// evidence at the charge/period level). This module answers a narrower, stricter question: for each
// individual Rentec transaction, which FORGE rent charge — if any — should it be recorded against,
// using only trustworthy identity evidence (owner-scoped inputs, a Rentec-import-linked tenant/unit
// reference, transaction date, and amount)? It never guesses between two plausible charges — those
// cases classify as ambiguous, for a human to resolve.
//
// Only externally-managed schedules are eligible: a lease whose active schedule is already
// collection_mode='forge' is FORGE's own responsibility, not this reconciliation workflow's.

export const RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS = Object.freeze({
  MATCHED: "matched",
  ALREADY_IMPORTED: "already_imported",
  AMBIGUOUS: "ambiguous",
  UNMATCHED: "unmatched",
  IGNORED_NON_RENT: "ignored_non_rent",
  CONFLICT: "conflict",
});

// Allowlist, not a denylist: only a category recognized here as a genuine tenant rent payment is
// ever eligible to match a charge. Everything else fails closed to ignored_non_rent — an
// unrecognized or undocumented category is never treated as "probably fine." The specific non-rent
// patterns below exist only to give the landlord an informative reason; deleting all of them would
// still fail closed via the allowlist alone, never open a hole.
const RENT_PAYMENT_CATEGORY_PATTERNS = [/^rent$/i, /^rent payment$/i, /^rental income$/i, /^monthly rent$/i];
const NON_RENT_CATEGORY_REASONS = [
  { pattern: /deposit/i, reason: "a security deposit" },
  { pattern: /late\s*fee|other\s*charge/i, reason: "a late fee or other charge" },
  { pattern: /refund/i, reason: "a refund" },
  { pattern: /revers/i, reason: "a reversal" },
  { pattern: /owner\s*(contribution|deposit|draw)/i, reason: "an owner contribution" },
  { pattern: /transfer/i, reason: "a transfer" },
  { pattern: /vendor|payable/i, reason: "a vendor transaction" },
  { pattern: /adjustment|journal/i, reason: "an accounting adjustment" },
  { pattern: /returned\s*payment|nsf|bounced|chargeback/i, reason: "a returned payment" },
];

function classifyRentecCategory(categoryName) {
  const text = String(categoryName || "").trim();
  if (RENT_PAYMENT_CATEGORY_PATTERNS.some((pattern) => pattern.test(text))) return { eligible: true };
  const known = NON_RENT_CATEGORY_REASONS.find(({ pattern }) => pattern.test(text));
  if (known) return { eligible: false, reason: `Category "${text}" is ${known.reason}, not a rent payment.` };
  return {
    eligible: false,
    reason: text
      ? `Category "${text}" is not a recognized rent-payment type — review manually.`
      : "No Rentec transaction category was provided — review manually.",
  };
}

function resolveActiveSchedule(scheduleList) {
  if (!scheduleList || scheduleList.length === 0) return null;
  return scheduleList.reduce((latest, schedule) =>
    !latest || schedule.effectiveStartDate > latest.effectiveStartDate ? schedule : latest, null);
}

/**
 * @param {object} input
 * @param {Array<{transactionId:string, renterId:string|null, propertyId:string, amountCents:number, transactionDate:string|null, categoryName:string}>} input.rentecTransactions
 * @param {Array<{id:string, rentecRenterId:string|null}>} input.tenants
 * @param {Array<{id:string, rentecPropertyId:string|null}>} input.units
 * @param {Array<{id:string, unitId:string|null}>} input.leases
 * @param {Array<{leaseId:string, tenantId:string}>} input.leaseTenants
 * @param {Array<{id:string, leaseId:string, collectionMode:string, effectiveStartDate:string}>} input.schedules
 * @param {Array<{id:string, leaseId:string, period:string, dueDate:string, amountCents:number, paidAmountCents:number, status:string}>} input.charges
 * @param {Array<{transactionId:string, amountCents:number, transactionDate:string|null, categoryName:string|null, renterId:string|null, propertyId:string|null, leaseId:string, chargeId:string|null}>} [input.alreadyImportedTransactions]
 *   Stored immutable evidence for every previously-*applied* import (not rejected attempts), used
 *   to detect drift against the freshly fetched Rentec data — a transaction whose stored evidence
 *   no longer matches what Rentec reports now (or that has disappeared from Rentec entirely) is a
 *   conflict, not a silent already_imported.
 */
export function buildRentecPaymentImportPreview({
  rentecTransactions = [], tenants = [], units = [], leases = [], leaseTenants = [],
  schedules = [], charges = [], alreadyImportedTransactions = [],
} = {}) {
  const tenantIdByRenterId = new Map(tenants.filter((t) => t.rentecRenterId).map((t) => [t.rentecRenterId, t.id]));
  const unitIdByPropertyId = new Map(units.filter((u) => u.rentecPropertyId).map((u) => [u.rentecPropertyId, u.id]));
  const leaseById = new Map(leases.map((l) => [l.id, l]));
  const leaseIdsByTenantId = new Map();
  for (const membership of leaseTenants) {
    const list = leaseIdsByTenantId.get(membership.tenantId) || [];
    list.push(membership.leaseId);
    leaseIdsByTenantId.set(membership.tenantId, list);
  }
  const schedulesByLease = new Map();
  for (const schedule of schedules) {
    const list = schedulesByLease.get(schedule.leaseId) || [];
    list.push(schedule);
    schedulesByLease.set(schedule.leaseId, list);
  }
  const chargesByLease = new Map();
  for (const charge of charges) {
    if (charge.status === "void") continue;
    const list = chargesByLease.get(charge.leaseId) || [];
    list.push(charge);
    chargesByLease.set(charge.leaseId, list);
  }

  const classificationCounts = Object.fromEntries(
    Object.values(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS).map((value) => [value, 0]),
  );
  const items = [];
  function record(classification, entry) {
    classificationCounts[classification] += 1;
    items.push(Object.freeze({ classification, transactionId: entry.transactionId, ...entry }));
  }

  const freshByTransactionId = new Map(rentecTransactions.map((txn) => [txn.transactionId, txn]));
  const storedImportedIds = new Set(alreadyImportedTransactions.map((row) => row.transactionId));

  // Drift detection runs first, over every previously-applied import — whether or not it still
  // appears in this fresh fetch. A transaction that has vanished from Rentec (deleted, voided, or
  // reversed away) is exactly as much a conflict as one whose amount/date/type/attribution changed;
  // neither case alters the FORGE payment already recorded for it.
  for (const stored of alreadyImportedTransactions) {
    const fresh = freshByTransactionId.get(stored.transactionId);
    if (!fresh) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.CONFLICT, {
        transactionId: stored.transactionId, leaseId: stored.leaseId, chargeId: stored.chargeId,
        reason: "This previously imported transaction no longer appears in Rentec — it may have been deleted, voided, or reversed. The previously applied FORGE payment was not altered; review before taking further action.",
      });
      continue;
    }
    const driftFields = [];
    if (fresh.amountCents !== stored.amountCents) driftFields.push("amount");
    if ((fresh.transactionDate || null) !== (stored.transactionDate || null)) driftFields.push("date");
    if ((fresh.categoryName || null) !== (stored.categoryName || null)) driftFields.push("transaction type");
    if ((fresh.renterId || null) !== (stored.renterId || null)) driftFields.push("renter attribution");
    if ((fresh.propertyId || null) !== (stored.propertyId || null)) driftFields.push("property attribution");
    if (driftFields.length > 0) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.CONFLICT, {
        transactionId: stored.transactionId, leaseId: stored.leaseId, chargeId: stored.chargeId,
        reason: `This transaction was already imported, but its Rentec ${driftFields.join(", ")} has since changed. The previously applied FORGE payment was not altered; review before taking further action.`,
      });
      continue;
    }
    record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.ALREADY_IMPORTED, { transactionId: stored.transactionId });
  }

  for (const txn of rentecTransactions) {
    if (storedImportedIds.has(txn.transactionId)) continue; // already classified above, from stored evidence

    const categoryVerdict = classifyRentecCategory(txn.categoryName);
    if (!categoryVerdict.eligible) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.IGNORED_NON_RENT, {
        transactionId: txn.transactionId, reason: categoryVerdict.reason,
      });
      continue;
    }
    // A category that reads as a rent payment but carries a non-positive amount is a contradictory
    // signal (e.g. a rent reversal recorded under a "Rent" category) — flagged for review rather
    // than either silently importing it or silently discarding it as merely non-rent. Never infer
    // "rent payment" from amount sign alone; this check only ever narrows an already-eligible
    // category, never substitutes for one.
    if (!(txn.amountCents > 0)) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.CONFLICT, {
        transactionId: txn.transactionId,
        reason: "This transaction's category indicates a rent payment, but its amount is not a positive debit — check the transaction direction before approving.",
      });
      continue;
    }

    const tenantId = txn.renterId ? tenantIdByRenterId.get(txn.renterId) : undefined;
    if (!tenantId) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.UNMATCHED, {
        transactionId: txn.transactionId,
        reason: "No FORGE tenant is linked to this Rentec renter.",
      });
      continue;
    }

    let candidateLeaseIds = leaseIdsByTenantId.get(tenantId) || [];
    const expectedUnitId = txn.propertyId ? unitIdByPropertyId.get(txn.propertyId) : undefined;
    if (expectedUnitId) {
      const narrowedByProperty = candidateLeaseIds.filter((leaseId) => leaseById.get(leaseId)?.unitId === expectedUnitId);
      if (narrowedByProperty.length > 0) candidateLeaseIds = narrowedByProperty;
    }
    candidateLeaseIds = candidateLeaseIds.filter((leaseId) => {
      const activeSchedule = resolveActiveSchedule(schedulesByLease.get(leaseId));
      return activeSchedule?.collectionMode === "external";
    });

    if (candidateLeaseIds.length === 0) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.UNMATCHED, {
        transactionId: txn.transactionId,
        reason: "No externally-managed FORGE lease is linked to this tenant.",
      });
      continue;
    }
    if (candidateLeaseIds.length > 1) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.AMBIGUOUS, {
        transactionId: txn.transactionId,
        reason: "Multiple externally-managed leases match this tenant/property; pick one manually.",
        candidateLeaseIds: Object.freeze([...candidateLeaseIds]),
      });
      continue;
    }

    const leaseId = candidateLeaseIds[0];
    const openCharges = (chargesByLease.get(leaseId) || []).filter((c) => c.amountCents > c.paidAmountCents);
    if (openCharges.length === 0) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.UNMATCHED, {
        transactionId: txn.transactionId, leaseId,
        reason: "This lease has no open rent charge to apply the payment against.",
      });
      continue;
    }

    const txnPeriod = txn.transactionDate ? txn.transactionDate.slice(0, 7) : null;
    const periodMatches = txnPeriod ? openCharges.filter((c) => c.period === txnPeriod) : [];
    const exactAmountMatches = openCharges.filter((c) => c.amountCents - c.paidAmountCents === txn.amountCents);

    let matchedCharge = null;
    if (exactAmountMatches.length === 1 && (periodMatches.length === 0 || periodMatches.some((c) => c.id === exactAmountMatches[0].id))) {
      matchedCharge = exactAmountMatches[0];
    } else if (exactAmountMatches.length > 1) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.AMBIGUOUS, {
        transactionId: txn.transactionId, leaseId,
        reason: "Multiple open charges on this lease exactly match this transaction's amount.",
        candidateChargeIds: Object.freeze(exactAmountMatches.map((c) => c.id)),
      });
      continue;
    } else if (periodMatches.length === 1) {
      const [candidate] = periodMatches;
      const remainingCents = candidate.amountCents - candidate.paidAmountCents;
      if (txn.amountCents > remainingCents) {
        record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.CONFLICT, {
          transactionId: txn.transactionId, leaseId, chargeId: candidate.id,
          reason: `Transaction amount exceeds the charge's remaining balance (${remainingCents} cents remaining).`,
          amountCents: txn.amountCents, remainingCents,
        });
        continue;
      }
      matchedCharge = candidate;
    } else if (periodMatches.length > 1) {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.AMBIGUOUS, {
        transactionId: txn.transactionId, leaseId,
        reason: "Multiple open charges share this transaction's period; pick one manually.",
        candidateChargeIds: Object.freeze(periodMatches.map((c) => c.id)),
      });
      continue;
    } else {
      record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.UNMATCHED, {
        transactionId: txn.transactionId, leaseId,
        reason: "No open charge on this lease matches this transaction's period or amount.",
      });
      continue;
    }

    const remainingCents = matchedCharge.amountCents - matchedCharge.paidAmountCents;
    record(RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS.MATCHED, {
      transactionId: txn.transactionId, leaseId, chargeId: matchedCharge.id,
      amountCents: txn.amountCents,
      isPartial: txn.amountCents < remainingCents,
    });
  }

  return Object.freeze({ items: Object.freeze(items), classificationCounts: Object.freeze(classificationCounts) });
}
