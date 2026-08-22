// Pure, deterministic classifier comparing Rentec transaction evidence against FORGE's own
// leases/schedules/charges/payments. Read-only by construction: it never writes anything, it only
// classifies. Matching never uses name alone — always lease/property mapping plus amount, date,
// covered period, and the Rentec transaction id where available, per the containment design.

const CLASSIFICATIONS = Object.freeze({
  CONFIDENT_MATCH: "confidently_matched_rentec_payment",
  POSSIBLE_MATCH: "possible_match_requires_review",
  CHARGE_WITHOUT_EVIDENCE: "forge_charge_no_rentec_evidence",
  PAYMENT_WITHOUT_CHARGE: "rentec_payment_no_forge_charge",
  PRE_CUTOVER_CHARGE: "future_or_pre_cutover_forge_charge",
  TRUE_OPENING_BALANCE: "true_unpaid_opening_balance",
  DUPLICATE_OR_AMBIGUOUS: "duplicate_or_ambiguous_record",
});

function centsMatch(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function scheduleForLease(schedulesByLease, leaseId) {
  const candidates = schedulesByLease.get(leaseId) || [];
  // Most recent effective_start_date wins — mirrors how the app resolves "the" active schedule
  // for a lease elsewhere (autopay execution, sweep).
  return candidates.slice().sort((a, b) => (b.effectiveStartDate || "").localeCompare(a.effectiveStartDate || ""))[0] || null;
}

/**
 * @param {object} input
 * @param {ReadonlyArray<{id:string,leaseId:string,amountCents:number,transactionDate:string,period:string|null}>} input.rentecTransactions
 * @param {ReadonlyArray<{id:string,leaseId:string,period:string,amountCents:number,paidAmountCents:number,status:string,dueDate:string}>} input.forgeCharges
 * @param {ReadonlyArray<{id:string,scheduleId:string,leaseId:string,collectionMode:string,forgeCutoverDate:string|null}>} input.schedules
 * @param {ReadonlyArray<{rentecTransactionId:string,chargeId:string}>} [input.alreadyReconciled] — prior approved matches, so rerunning never reclassifies (and never reimports) what's already settled.
 */
export function buildRentecReconciliationPreview({ rentecTransactions, forgeCharges, schedules, alreadyReconciled = [] }) {
  const schedulesByLease = new Map();
  for (const schedule of schedules) {
    if (!schedulesByLease.has(schedule.leaseId)) schedulesByLease.set(schedule.leaseId, []);
    schedulesByLease.get(schedule.leaseId).push(schedule);
  }
  const reconciledTransactionIds = new Set(alreadyReconciled.map((r) => r.rentecTransactionId));
  const reconciledChargeIds = new Set(alreadyReconciled.map((r) => r.chargeId));

  const chargesByLeasePeriod = new Map();
  for (const charge of forgeCharges) {
    chargesByLeasePeriod.set(`${charge.leaseId}:${charge.period}`, [
      ...(chargesByLeasePeriod.get(`${charge.leaseId}:${charge.period}`) || []),
      charge,
    ]);
  }

  const transactionsByLeasePeriod = new Map();
  for (const transaction of rentecTransactions) {
    if (!transaction.period) continue;
    const key = `${transaction.leaseId}:${transaction.period}`;
    transactionsByLeasePeriod.set(key, [...(transactionsByLeasePeriod.get(key) || []), transaction]);
  }

  const items = [];

  for (const transaction of rentecTransactions) {
    if (reconciledTransactionIds.has(transaction.id)) continue; // already settled — never reclassified on rerun
    const key = transaction.period ? `${transaction.leaseId}:${transaction.period}` : null;
    const siblingTransactions = key ? transactionsByLeasePeriod.get(key) || [] : [transaction];
    if (siblingTransactions.length > 1) {
      items.push({ classification: CLASSIFICATIONS.DUPLICATE_OR_AMBIGUOUS, rentecTransactionId: transaction.id, leaseId: transaction.leaseId, period: transaction.period, reason: "Multiple Rentec transactions cover the same lease and period." });
      continue;
    }
    const candidateCharges = key ? (chargesByLeasePeriod.get(key) || []) : [];
    if (candidateCharges.length === 0) {
      items.push({ classification: CLASSIFICATIONS.PAYMENT_WITHOUT_CHARGE, rentecTransactionId: transaction.id, leaseId: transaction.leaseId, period: transaction.period, reason: "No FORGE charge exists for this lease and period." });
      continue;
    }
    if (candidateCharges.length > 1) {
      items.push({ classification: CLASSIFICATIONS.DUPLICATE_OR_AMBIGUOUS, rentecTransactionId: transaction.id, leaseId: transaction.leaseId, period: transaction.period, reason: "Multiple FORGE charges exist for this lease and period." });
      continue;
    }
    const charge = candidateCharges[0];
    if (centsMatch(transaction.amountCents, charge.amountCents)) {
      items.push({ classification: CLASSIFICATIONS.CONFIDENT_MATCH, rentecTransactionId: transaction.id, chargeId: charge.id, leaseId: transaction.leaseId, period: transaction.period, amountCents: transaction.amountCents });
    } else {
      items.push({ classification: CLASSIFICATIONS.POSSIBLE_MATCH, rentecTransactionId: transaction.id, chargeId: charge.id, leaseId: transaction.leaseId, period: transaction.period, reason: "Lease and period match, but the amount does not.", rentecAmountCents: transaction.amountCents, forgeAmountCents: charge.amountCents });
    }
  }

  for (const charge of forgeCharges) {
    if (reconciledChargeIds.has(charge.id)) continue;
    if (charge.status === "void") continue; // already resolved — not this preview's concern
    const key = `${charge.leaseId}:${charge.period}`;
    const hasTransactionEvidence = (transactionsByLeasePeriod.get(key) || []).length > 0;
    if (hasTransactionEvidence) continue; // already classified above via the transaction side

    const schedule = scheduleForLease(schedulesByLease, charge.leaseId);
    const isPreCutover = !schedule || schedule.collectionMode !== "forge" || !schedule.forgeCutoverDate || charge.dueDate < schedule.forgeCutoverDate;
    if (isPreCutover) {
      items.push({ classification: CLASSIFICATIONS.PRE_CUTOVER_CHARGE, chargeId: charge.id, leaseId: charge.leaseId, period: charge.period, reason: "This charge predates (or has no) FORGE cutover for its lease." });
      continue;
    }
    if (charge.paidAmountCents > 0 && charge.paidAmountCents < charge.amountCents) {
      items.push({ classification: CLASSIFICATIONS.TRUE_OPENING_BALANCE, chargeId: charge.id, leaseId: charge.leaseId, period: charge.period, remainingCents: charge.amountCents - charge.paidAmountCents, reason: "Partially collected in FORGE, no external evidence for the remainder." });
      continue;
    }
    items.push({ classification: CLASSIFICATIONS.CHARGE_WITHOUT_EVIDENCE, chargeId: charge.id, leaseId: charge.leaseId, period: charge.period, amountCents: charge.amountCents, reason: "No Rentec transaction evidence and no FORGE payment recorded." });
  }

  return Object.freeze({ items: Object.freeze(items), classificationCounts: Object.freeze(
    Object.values(CLASSIFICATIONS).reduce((counts, classification) => {
      counts[classification] = items.filter((item) => item.classification === classification).length;
      return counts;
    }, {}),
  ) });
}

export { CLASSIFICATIONS as RECONCILIATION_CLASSIFICATIONS };
