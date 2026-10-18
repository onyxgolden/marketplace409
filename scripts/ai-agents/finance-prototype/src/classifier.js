/**
 * classifier.js — account classification via the host-supplied versioned
 * chart of accounts. Exact code lookup only; no keyword-based accounting
 * interpretation, ever. Unknown codes produce UNKNOWN_CLASSIFICATION and
 * leave income-measure fields unavailable for that record.
 * Pure Node 24 ESM, zero dependencies.
 */

/** Classify an account code against the trusted chart.
 *  Returns {class, known} where class is one of the ACCOUNT_CLASSES. */
export function classifyAccount(accountCode, chart) {
  const cls = chart[accountCode];
  if (cls === undefined) {
    return { class: "UNKNOWN", known: false };
  }
  return { class: cls, known: true };
}

/** Cash movement for a validated transaction: IN adds the signed amount,
 *  OUT subtracts the signed amount, TRANSFER contributes zero here (its
 *  balance effect is verified separately via pairing). Signed contra
 *  entries flow through unchanged — never silently absolute-valued. */
export function cashMovement(txn) {
  if (txn.direction === "IN") return txn.amount_minor;
  if (txn.direction === "OUT") return -txn.amount_minor;
  return 0n; // TRANSFER: verified via transfer pairing
}
