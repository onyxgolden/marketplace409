// The single lookup both the preview route and the confirm route call through, so the two endpoints can
// never silently diverge in which pure function computes a given action's effect -- the confirm route
// always re-runs the SAME function the preview route ran, against fresh data.

import {
  previewContractualPrincipalCorrection,
  previewDiscretionaryPrincipalConcession,
  previewBringCurrentCredit,
  previewInterestCorrection,
  previewInterestWaiver,
  previewStripeFeeReimbursement,
  previewCompensatingCorrection,
  previewPaymentReversal,
  previewAccountClosure,
} from "./adjustmentPreview.js";

export const ADJUSTMENT_ACTION_TYPES = Object.freeze({
  CONTRACTUAL_PRINCIPAL_CORRECTION: "contractual_principal_correction",
  DISCRETIONARY_PRINCIPAL_CONCESSION: "discretionary_principal_concession",
  BRING_CURRENT_CREDIT: "bring_current_credit",
  INTEREST_CORRECTION: "interest_correction",
  INTEREST_WAIVER: "interest_waiver",
  STRIPE_FEE_REIMBURSEMENT: "stripe_fee_reimbursement",
  COMPENSATING_CORRECTION: "compensating_correction",
  PAYMENT_REVERSAL: "payment_reversal",
  ACCOUNT_CLOSURE: "account_closure",
});

// Principal concessions, reversals, and correction/closure actions all warrant the UI's stronger
// confirmation step, per explicit instruction -- everything except the two purely contractual/
// administrative corrections and the fee-reimbursement preview (which by default doesn't even touch the
// ledger).
export const HIGH_IMPACT_ACTION_TYPES = new Set([
  ADJUSTMENT_ACTION_TYPES.DISCRETIONARY_PRINCIPAL_CONCESSION,
  ADJUSTMENT_ACTION_TYPES.BRING_CURRENT_CREDIT,
  ADJUSTMENT_ACTION_TYPES.INTEREST_WAIVER,
  ADJUSTMENT_ACTION_TYPES.COMPENSATING_CORRECTION,
  ADJUSTMENT_ACTION_TYPES.PAYMENT_REVERSAL,
  ADJUSTMENT_ACTION_TYPES.ACCOUNT_CLOSURE,
]);

const PREVIEW_FUNCTIONS = Object.freeze({
  [ADJUSTMENT_ACTION_TYPES.CONTRACTUAL_PRINCIPAL_CORRECTION]: previewContractualPrincipalCorrection,
  [ADJUSTMENT_ACTION_TYPES.DISCRETIONARY_PRINCIPAL_CONCESSION]: previewDiscretionaryPrincipalConcession,
  [ADJUSTMENT_ACTION_TYPES.BRING_CURRENT_CREDIT]: previewBringCurrentCredit,
  [ADJUSTMENT_ACTION_TYPES.INTEREST_CORRECTION]: previewInterestCorrection,
  [ADJUSTMENT_ACTION_TYPES.INTEREST_WAIVER]: previewInterestWaiver,
  [ADJUSTMENT_ACTION_TYPES.STRIPE_FEE_REIMBURSEMENT]: previewStripeFeeReimbursement,
  [ADJUSTMENT_ACTION_TYPES.COMPENSATING_CORRECTION]: previewCompensatingCorrection,
  [ADJUSTMENT_ACTION_TYPES.PAYMENT_REVERSAL]: previewPaymentReversal,
  [ADJUSTMENT_ACTION_TYPES.ACCOUNT_CLOSURE]: previewAccountClosure,
});

export function isKnownAdjustmentActionType(actionType) {
  return Object.prototype.hasOwnProperty.call(PREVIEW_FUNCTIONS, actionType);
}

// The single entry point used by both the preview and confirm routes. `inputs` is the caller-supplied,
// action-specific field set (componentId/deltaCents/reason/... -- never ledgerSequence, ownerId,
// eventOrigin, or createdBy, none of which any preview function accepts as an `inputs`-shaped field in
// the first place). Throws (fail closed) for an unknown actionType or malformed inputs -- the same
// validation every preview function already performs.
export function computeAdjustmentPreview(actionType, { events, componentVersions, accountTermsVersions, asOfDate, inputs, createdBy }) {
  const previewFn = PREVIEW_FUNCTIONS[actionType];
  if (!previewFn) throw new Error(`Unknown adjustment action type: ${actionType}`);
  return previewFn({ ...inputs, events, componentVersions, accountTermsVersions, asOfDate, createdBy });
}
