// Pure matching logic for the Rentec/raw-bank-feed duplicate problem: some `source_system =
// 'transaction'` rows (a raw Stripe Financial Connections bank feed, no merchant/category data,
// often mis-signed) describe the exact same real-world rent/expense as a `rentec`/`rentec_api` row
// (the canonical, correctly-signed, correctly-categorized source). No DB access here -- callers
// fetch both row sets and pass them in.
//
// Matching policy is deliberately conservative: a transaction row is only ever a "confirmed
// duplicate" when the match is unambiguous in BOTH directions.
//   - Zero candidate rentec rows within the amount+date window -> not a duplicate, left alone.
//   - More than one candidate -> ambiguous, never auto-resolved (e.g. several tenants who happen to
//     owe the same rent within a few days of each other).
//   - Exactly one candidate, but that same rentec row is also the sole candidate for a DIFFERENT
//     transaction row -> both become ambiguous. A rentec row can back at most one confirmed
//     duplicate; letting the first transaction row "win" it by iteration order would be an
//     arbitrary, unreviewable choice about real money.
//
// Amounts are compared at the cent level via rounding (see minorUnitsToDecimalDollars.ts for the
// same idiom elsewhere in this domain) rather than direct float equality, since `amount` values
// read back from Postgres `numeric` and re-parsed as JS numbers can carry sub-cent float noise.
function toCents(amount) {
  return Math.round(Math.abs(amount) * 100);
}

function daysBetween(dateA, dateB) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs((new Date(dateA).getTime() - new Date(dateB).getTime()) / msPerDay);
}

export function reconcileTransactionDuplicates({ transactionRows, rentecRows, toleranceDays = 3 }) {
  if (!Array.isArray(transactionRows)) throw new Error("transactionRows must be an array");
  if (!Array.isArray(rentecRows)) throw new Error("rentecRows must be an array");
  if (!Number.isFinite(toleranceDays) || toleranceDays < 0) throw new Error("toleranceDays must be a non-negative number");

  const candidatesByTransactionId = new Map();
  for (const transaction of transactionRows) {
    const transactionCents = toCents(transaction.amount);
    const candidates = rentecRows.filter(
      (rentecRow) => toCents(rentecRow.amount) === transactionCents && daysBetween(transaction.eventDate, rentecRow.eventDate) <= toleranceDays,
    );
    candidatesByTransactionId.set(transaction.id, candidates);
  }

  // Tentative single-candidate matches, then find which rentec rows more than one transaction
  // row would claim -- those claims are all voided (moved to ambiguous) rather than picking a
  // winner.
  const tentativeMatchByTransactionId = new Map();
  for (const [transactionId, candidates] of candidatesByTransactionId) {
    if (candidates.length === 1) tentativeMatchByTransactionId.set(transactionId, candidates[0]);
  }

  const claimantsByRentecId = new Map();
  for (const [transactionId, rentecRow] of tentativeMatchByTransactionId) {
    const claimants = claimantsByRentecId.get(rentecRow.id) ?? [];
    claimants.push(transactionId);
    claimantsByRentecId.set(rentecRow.id, claimants);
  }
  const contendedRentecIds = new Set([...claimantsByRentecId.entries()].filter(([, claimants]) => claimants.length > 1).map(([rentecId]) => rentecId));

  const confirmedDuplicates = [];
  const ambiguous = [];

  for (const [transactionId, candidates] of candidatesByTransactionId) {
    if (candidates.length === 0) continue;

    if (candidates.length > 1) {
      ambiguous.push(Object.freeze({ transactionId, candidateRentecIds: Object.freeze(candidates.map((c) => c.id)), reason: "multiple_candidates" }));
      continue;
    }

    const rentecRow = candidates[0];
    if (contendedRentecIds.has(rentecRow.id)) {
      ambiguous.push(Object.freeze({ transactionId, candidateRentecIds: Object.freeze([rentecRow.id]), reason: "contended_rentec_row" }));
      continue;
    }

    confirmedDuplicates.push(Object.freeze({ transactionId, rentecId: rentecRow.id }));
  }

  return Object.freeze({ confirmedDuplicates: Object.freeze(confirmedDuplicates), ambiguous: Object.freeze(ambiguous) });
}
