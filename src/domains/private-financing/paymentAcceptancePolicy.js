// Pure, fail-closed decision function for whether a BORROWER-INITIATED ONLINE payment amount would be
// accepted under a seller's payment_acceptance_policy. See the migration's own "NEW 2" header section for
// the full design (supabase/migrations/20260830000200_create_private_financing_foundation.sql).
//
// This module invents no second balance engine: amountDueCents must already be an authoritative figure
// computed by the existing replayEvents.js/payoffQuote.js engine, including only the current scheduled
// obligation, valid arrears, and applicable account credits -- and excluding seller-paid processor fees,
// FORGE lender subscription fees, unauthorized late charges, unrelated Rental Manager obligations, and
// future interest beyond the calculation date. This module never imports replayEvents.js,
// paymentAllocation.js, or interestAccrual.js -- it only ever compares the numbers it is given.
//
// Staleness is detected the SAME way computePayoffQuote/hasLedgerChangedSinceQuote already do it
// (payoffQuote.js) -- a ledger-sequence snapshot comparison, never wall-clock time. amountDueCents was
// computed as of some known ledger state; if the ledger has moved since (a new event posted), the amount
// due may no longer be correct, and this function fails closed rather than evaluating a stale figure.
//
// This module does not initiate, record, or reject an actual payment, and is never called by
// append_private_financing_event or any manual_external/manual_import recording path -- recording a
// seller-confirmed external payment (Venmo, Cash App, Zelle, PayPal, bank transfer, cash, check, money
// order) is a completely separate, untouched write path this validator never gates. Server-side
// enforcement of this policy at actual online-payment initiation remains SF-2/SF-3 scope; this module is
// the pure boundary a future initiation path would be structurally required to consult.

export const PAYMENT_ACCEPTANCE_POLICY = Object.freeze({
  PARTIAL_ALLOWED: "partial_allowed",
  FULL_AMOUNT_OR_MORE: "full_amount_or_more",
  EXACT_AMOUNT_ONLY: "exact_amount_only",
});

const VALID_POLICIES = new Set(Object.values(PAYMENT_ACCEPTANCE_POLICY));

export const PAYMENT_ACCEPTANCE_REJECTION_REASON = Object.freeze({
  UNKNOWN_POLICY: "unknown_policy",
  INVALID_REQUESTED_AMOUNT: "invalid_requested_amount",
  INVALID_AMOUNT_DUE: "invalid_amount_due",
  INVALID_EXTRA_PRINCIPAL_FLAG: "invalid_extra_principal_flag",
  INVALID_LEDGER_STATE_IDENTITY: "invalid_ledger_state_identity",
  STALE_AMOUNT_DUE: "stale_amount_due",
  AMOUNT_BELOW_DUE: "amount_below_due",
  AMOUNT_ABOVE_DUE: "amount_above_due",
  EXTRA_PRINCIPAL_NOT_PERMITTED: "extra_principal_not_permitted",
});

function rejected(reasonCode) {
  return Object.freeze({ accepted: false, reasonCode });
}

const ACCEPTED = Object.freeze({ accepted: true, reasonCode: null });

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// A ledger-sequence snapshot value is either -1 (no events posted yet -- matches payoffQuote.js's own
// `events.reduce((max, event) => Math.max(max, event.ledgerSequence ?? -1), -1)` idiom) or a positive
// integer (a real ledgerSequence, which the schema requires to be > 0).
function isValidLedgerStateIdentity(value) {
  return Number.isInteger(value) && value >= -1;
}

// Pure and fail-closed: every branch returns a frozen { accepted, reasonCode } object -- this function
// never throws, so a caller cannot accidentally treat an unrecognized input as "allowed" by failing to
// check a return value the way an uncaught exception would force them to. Unknown, missing, malformed,
// stale, or negative inputs are always rejected before any policy-specific comparison runs.
export function evaluatePaymentAcceptance({
  policy,
  requestedAmountCents,
  amountDueCents,
  extraPrincipalAllowed,
  amountDueAsOfLedgerSequence,
  currentLedgerSequence,
} = {}) {
  if (!VALID_POLICIES.has(policy)) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.UNKNOWN_POLICY);
  if (!isPositiveInteger(requestedAmountCents)) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_REQUESTED_AMOUNT);
  if (!isNonNegativeInteger(amountDueCents)) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_AMOUNT_DUE);
  if (typeof extraPrincipalAllowed !== "boolean") return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_EXTRA_PRINCIPAL_FLAG);
  if (!isValidLedgerStateIdentity(amountDueAsOfLedgerSequence) || !isValidLedgerStateIdentity(currentLedgerSequence)) {
    return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_LEDGER_STATE_IDENTITY);
  }
  // The authoritative amount-due figure was computed as of a specific ledger state; if the ledger has
  // moved since (any new event posted -- a payment, a correction, a reversal), that figure can no longer
  // be trusted and must be recalculated before any acceptance decision is made.
  if (amountDueAsOfLedgerSequence !== currentLedgerSequence) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.STALE_AMOUNT_DUE);

  if (policy === PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED) {
    if (requestedAmountCents > amountDueCents && !extraPrincipalAllowed) {
      return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.EXTRA_PRINCIPAL_NOT_PERMITTED);
    }
    return ACCEPTED;
  }

  if (policy === PAYMENT_ACCEPTANCE_POLICY.FULL_AMOUNT_OR_MORE) {
    if (requestedAmountCents < amountDueCents) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_BELOW_DUE);
    if (requestedAmountCents > amountDueCents && !extraPrincipalAllowed) {
      return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.EXTRA_PRINCIPAL_NOT_PERMITTED);
    }
    return ACCEPTED;
  }

  // exact_amount_only: rejects both less and more, unconditionally -- extraPrincipalAllowed has no
  // bearing here, since "exact" permits no extra under any authorization.
  if (requestedAmountCents < amountDueCents) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_BELOW_DUE);
  if (requestedAmountCents > amountDueCents) return rejected(PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_ABOVE_DUE);
  return ACCEPTED;
}
