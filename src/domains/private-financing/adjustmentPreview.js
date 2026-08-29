// Pure, side-effect-free previews for every adjustment/payment kind the owner can propose. A preview
// NEVER creates an event, reserves a ledgerSequence, mutates an account, or implies approval -- it is
// read-only, built entirely on replayEvents' current state, and every function here returns the exact
// same common envelope (see buildPreviewEnvelope) so a UI or API layer can treat any adjustment kind
// uniformly. Malformed/type-level input throws (fail closed); a business-rule problem (would go negative,
// quote expired, insufficient funds) is surfaced in the envelope's blockingValidation array instead of
// throwing, so the caller can inspect exactly why an action isn't currently postable.

import { replayEvents, evaluateClosureEligibility } from "./replayEvents.js";
import { allocatePayment } from "./paymentAllocation.js";
import {
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  PRIVATE_FINANCING_COMPONENT_TYPE,
  CORRECTION_BASIS,
} from "./privateFinancingContracts.js";
import { LedgerIntegrityViolationError, validateReversalReference } from "./ledgerIntegrity.js";

function violate(reason) {
  throw new LedgerIntegrityViolationError(reason);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) violate(`${label} must be a non-empty string.`);
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) violate(`${label} must be an integer.`);
}

function requireComponentType(value, label) {
  if (!Object.values(PRIVATE_FINANCING_COMPONENT_TYPE).includes(value)) {
    violate(`${label} must be one of ${Object.values(PRIVATE_FINANCING_COMPONENT_TYPE).join(", ")}.`);
  }
}

// The single common shape every preview function returns -- see file header and Checkpoint C section 1.
function buildPreviewEnvelope({
  snapshot,
  asOfDate,
  proposedAdjustment,
  allocationBreakdown,
  balanceAfter,
  interestEffect,
  pastDueEffect = null,
  payoffEffect = null,
  warnings,
  blockingValidation,
  proposedEventPayload,
}) {
  return Object.freeze({
    ownerId: snapshot.ownerId,
    accountId: snapshot.accountId,
    asOfDate,
    balanceBefore: Object.freeze({
      interestBearing: snapshot.interestBearingRemainingCents,
      zeroInterest: snapshot.zeroInterestRemainingCents,
      unpaidAccruedInterestCents: snapshot.unpaidAccruedInterestCents,
    }),
    proposedAdjustment: Object.freeze(proposedAdjustment),
    allocationBreakdown: allocationBreakdown ? Object.freeze(allocationBreakdown) : null,
    balanceAfter: Object.freeze(balanceAfter),
    principalByComponent: Object.freeze({
      interestBearing: Object.freeze({ before: snapshot.interestBearingRemainingCents, after: balanceAfter.interestBearing }),
      zeroInterest: Object.freeze({ before: snapshot.zeroInterestRemainingCents, after: balanceAfter.zeroInterest }),
    }),
    interestEffect: Object.freeze(interestEffect),
    pastDueEffect: pastDueEffect ? Object.freeze(pastDueEffect) : null,
    payoffEffect: payoffEffect ? Object.freeze(payoffEffect) : null,
    warnings: Object.freeze([...warnings]),
    blockingValidation: Object.freeze([...blockingValidation]),
    proposedEventPayload: proposedEventPayload ? Object.freeze(proposedEventPayload) : null,
  });
}

function replayFor(events, asOfDate) {
  return replayEvents({ events, asOfDate });
}

// -- 1/2. Principal correction (contractual) and principal concession (discretionary) --------------------

function previewPrincipalAdjustment({ events, asOfDate, componentType, deltaCents, correctionBasis, reason, borrowerVisibleExplanation = null, createdBy }) {
  requireComponentType(componentType, "componentType");
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");
  if (correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION) {
    requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  }

  const snapshot = replayFor(events, asOfDate);
  const priorBalance = componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? snapshot.interestBearingRemainingCents : snapshot.zeroInterestRemainingCents;
  const afterBalance = priorBalance + deltaCents;

  const warnings = [];
  const blockingValidation = [];
  if (afterBalance < 0) {
    blockingValidation.push(`This correction would reduce ${componentType} principal below zero (from ${priorBalance} by ${deltaCents}).`);
  }
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const balanceAfter = {
    interestBearing: componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? afterBalance : snapshot.interestBearingRemainingCents,
    zeroInterest: componentType === PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST ? afterBalance : snapshot.zeroInterestRemainingCents,
  };

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION ? "discretionary_principal_concession" : "contractual_principal_correction", componentType, deltaCents, correctionBasis },
    allocationBreakdown: { componentType, deltaCents },
    balanceAfter,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            componentType,
            correctionBasis,
            deltaCents,
            correctedComponentPrincipalRemainingCentsAfter: afterBalance,
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

export function previewContractualPrincipalCorrection(args) {
  return previewPrincipalAdjustment({ ...args, correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE });
}

export function previewDiscretionaryPrincipalConcession(args) {
  return previewPrincipalAdjustment({ ...args, correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION });
}

// -- 3. Bring-current / reporting credit -------------------------------------------------------------

// South Main's own bring-current credit is applied to the interest-bearing component, per the accepted
// reconciliation -- see __tests__/adjustmentPreview.test.js for the exact reproduction.
export function previewBringCurrentCredit({
  events,
  asOfDate,
  scheduledAmountThroughAsOfDateCents,
  proposedCreditCents,
  nextDueDate,
  nextDueAmountCents,
  componentType = PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING,
  reason,
  borrowerVisibleExplanation,
  createdBy,
}) {
  requireInteger(scheduledAmountThroughAsOfDateCents, "scheduledAmountThroughAsOfDateCents");
  requireInteger(proposedCreditCents, "proposedCreditCents");
  if (proposedCreditCents < 0) violate("proposedCreditCents cannot be negative.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  requireNonEmptyString(nextDueDate, "nextDueDate");
  requireInteger(nextDueAmountCents, "nextDueAmountCents");
  requireComponentType(componentType, "componentType");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, asOfDate);
  // "Qualifying payments and credits already posted": every dollar of interest paid, cash applied to
  // principal, and principal already forgiven by a prior correction/concession -- exactly what replay
  // has independently reconstructed, never a separately-tracked running total.
  const alreadyPostedCents = snapshot.cumulativeInterestPaidCents + snapshot.cumulativeCashPrincipalPaidCents + snapshot.cumulativePrincipalForgivenCents;
  const shortageCents = Math.max(scheduledAmountThroughAsOfDateCents - alreadyPostedCents, 0);
  const pastDueBeforeCents = shortageCents;
  const pastDueAfterCents = Math.max(shortageCents - proposedCreditCents, 0);

  const warnings = [];
  const blockingValidation = [];
  if (proposedCreditCents > shortageCents) {
    warnings.push(`The proposed credit (${proposedCreditCents}) exceeds the calculated shortage (${shortageCents}) -- this is extra seller-granted goodwill beyond bringing the account current.`);
  }

  const priorBalance = componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? snapshot.interestBearingRemainingCents : snapshot.zeroInterestRemainingCents;
  const afterBalance = priorBalance - proposedCreditCents;
  if (afterBalance < 0) blockingValidation.push(`The proposed credit would reduce ${componentType} principal below zero.`);
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const balanceAfter = {
    interestBearing: componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? afterBalance : snapshot.interestBearingRemainingCents,
    zeroInterest: componentType === PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST ? afterBalance : snapshot.zeroInterestRemainingCents,
  };

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "bring_current_credit", componentType, proposedCreditCents },
    allocationBreakdown: { componentType, deltaCents: -proposedCreditCents },
    balanceAfter,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    pastDueEffect: {
      scheduledAmountCents: scheduledAmountThroughAsOfDateCents,
      alreadyPostedCents,
      shortageCents,
      proposedCreditCents,
      pastDueBeforeCents,
      pastDueAfterCents,
      nextDueDate,
      nextDueAmountCents,
    },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            componentType,
            correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
            deltaCents: -proposedCreditCents,
            correctedComponentPrincipalRemainingCentsAfter: afterBalance,
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- 4/5. Interest correction (contractual) and interest waiver (discretionary) -----------------------

function previewInterestAdjustment({ events, asOfDate, deltaCents, correctionBasis, reason, borrowerVisibleExplanation = null, createdBy }) {
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");
  if (correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION) {
    requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  }

  const snapshot = replayFor(events, asOfDate);
  const afterInterest = snapshot.unpaidAccruedInterestCents + deltaCents;

  const warnings = [];
  const blockingValidation = [];
  if (afterInterest < 0) blockingValidation.push(`This correction would reduce unpaid accrued interest below zero (from ${snapshot.unpaidAccruedInterestCents} by ${deltaCents}).`);
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION ? "interest_waiver" : "interest_correction", deltaCents, correctionBasis },
    allocationBreakdown: { deltaCents },
    balanceAfter: { interestBearing: snapshot.interestBearingRemainingCents, zeroInterest: snapshot.zeroInterestRemainingCents },
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: Math.max(afterInterest, 0) },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            correctionBasis,
            deltaCents,
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

export function previewInterestCorrection(args) {
  return previewInterestAdjustment({ ...args, correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE });
}

export function previewInterestWaiver(args) {
  if (Number.isInteger(args.deltaCents) && args.deltaCents > 0) {
    violate("An interest waiver only ever forgives interest -- deltaCents must be zero or negative.");
  }
  return previewInterestAdjustment({ ...args, correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION });
}

// -- 6. Stripe-fee reimbursement -----------------------------------------------------------------------

// By default this NEVER touches the loan ledger -- proposedEventPayload is null and balanceAfter equals
// balanceBefore -- because a Stripe processing fee the seller absorbs is tracked separately from
// principal and interest (South Main: "Stripe fee is borne by seller, never reduces buyer credit"). Only
// when the seller EXPLICITLY elects postAsLoanCredit: true does this become a real
// discretionary_concession principal_correction -- and even then it never touches a payment_posted
// event's own allocation; it is always its own separate event.
export function previewStripeFeeReimbursement({ events, asOfDate, feeAmountCents, postAsLoanCredit = false, componentType = PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, reason, borrowerVisibleExplanation = null, createdBy = null }) {
  requireInteger(feeAmountCents, "feeAmountCents");
  if (feeAmountCents <= 0) violate("feeAmountCents must be a positive integer.");
  requireNonEmptyString(reason, "reason");

  const snapshot = replayFor(events, asOfDate);

  if (!postAsLoanCredit) {
    return buildPreviewEnvelope({
      snapshot,
      asOfDate,
      proposedAdjustment: { kind: "stripe_fee_reimbursement", feeAmountCents, postAsLoanCredit: false },
      allocationBreakdown: null,
      balanceAfter: { interestBearing: snapshot.interestBearingRemainingCents, zeroInterest: snapshot.zeroInterestRemainingCents },
      interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
      warnings: [
        "This reimbursement does not affect the loan ledger. It is tracked separately from principal and interest, and never reduces the amount credited from a borrower payment.",
      ],
      blockingValidation: [],
      proposedEventPayload: null,
    });
  }

  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  const preview = previewPrincipalAdjustment({
    events,
    asOfDate,
    componentType,
    deltaCents: -feeAmountCents,
    correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
    reason,
    borrowerVisibleExplanation,
    createdBy,
  });
  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "stripe_fee_reimbursement", feeAmountCents, postAsLoanCredit: true, componentType },
    allocationBreakdown: preview.allocationBreakdown,
    balanceAfter: preview.balanceAfter,
    interestEffect: preview.interestEffect,
    warnings: ["The seller explicitly elected to post this Stripe-fee reimbursement as a loan credit -- an unusual, deliberate action, not the default."],
    blockingValidation: preview.blockingValidation,
    proposedEventPayload: preview.proposedEventPayload,
  });
}

// -- 7. Compensating correction ------------------------------------------------------------------------

export function previewCompensatingCorrection({ events, asOfDate, reversesEventId, deltaCents, componentType = null, reason, createdBy }) {
  requireNonEmptyString(reversesEventId, "reversesEventId");
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, asOfDate);
  const target = events.find((event) => event.id === reversesEventId);

  const warnings = [];
  const blockingValidation = [];
  const candidateReversal = {
    id: "__preview__",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
    ownerId: snapshot.ownerId,
    accountId: snapshot.accountId,
    reversesEventId,
    effectiveDate: asOfDate,
  };
  try {
    validateReversalReference(candidateReversal, target, events);
  } catch (error) {
    blockingValidation.push(error.message);
  }

  let afterBalance = null;
  let resolvedComponentType = componentType;
  if (blockingValidation.length === 0) {
    if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
      resolvedComponentType = target.componentType;
      const priorBalance = resolvedComponentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? snapshot.interestBearingRemainingCents : snapshot.zeroInterestRemainingCents;
      afterBalance = priorBalance + deltaCents;
      if (afterBalance < 0) blockingValidation.push(`This compensating correction would reduce ${resolvedComponentType} principal below zero.`);
    } else if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
      afterBalance = snapshot.unpaidAccruedInterestCents + deltaCents;
      if (afterBalance < 0) blockingValidation.push("This compensating correction would reduce unpaid accrued interest below zero.");
    } else {
      blockingValidation.push(`replayEvents does not support reversing a ${target.eventType} event via compensating_correction.`);
    }
  }

  const balanceAfter = {
    interestBearing: resolvedComponentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING && afterBalance !== null ? afterBalance : snapshot.interestBearingRemainingCents,
    zeroInterest: resolvedComponentType === PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST && afterBalance !== null ? afterBalance : snapshot.zeroInterestRemainingCents,
  };
  const isInterestTarget = target?.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION;

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "compensating_correction", reversesEventId, deltaCents, componentType: resolvedComponentType },
    allocationBreakdown: { reversesEventId, deltaCents },
    balanceAfter,
    interestEffect: {
      accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
      accruedInterestAfterCents: isInterestTarget && afterBalance !== null ? afterBalance : snapshot.unpaidAccruedInterestCents,
    },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            reversesEventId,
            componentType: resolvedComponentType,
            deltaCents,
            reason,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- 8. External/manual payment (also covers an ordinary payment preview generally) --------------------

export function previewExternalManualPayment({
  events,
  asOfDate,
  amountCents,
  eventOrigin = PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
  idempotencyKey,
  reason = null,
  acknowledgeOverpayment = false,
}) {
  requireInteger(amountCents, "amountCents");
  if (amountCents <= 0) violate("amountCents must be a positive integer.");
  requireNonEmptyString(idempotencyKey, "idempotencyKey");

  const snapshot = replayFor(events, asOfDate);
  const warnings = [];
  const blockingValidation = [];
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const result = allocatePayment({
    interestBearing: { remainingPrincipalCents: snapshot.interestBearingRemainingCents, regularPaymentCents: snapshot.interestBearingRegularPaymentCents },
    zeroInterest: { remainingPrincipalCents: snapshot.zeroInterestRemainingCents, regularPaymentCents: snapshot.zeroInterestRegularPaymentCents },
    accruedInterestCents: snapshot.unpaidAccruedInterestCents,
    paymentAmountCents: amountCents,
  });

  // An overpayment must become an explicit unapplied amount, never disappear and never go negative -- it
  // is ALWAYS reported here (see allocationBreakdown.unallocatedCents), and by default blocks posting
  // until the caller explicitly acknowledges how it should be handled (fail-closed default).
  if (result.unallocatedCents > 0) {
    warnings.push(`This payment exceeds everything currently owed by ${result.unallocatedCents} cent(s) -- an unapplied/refundable amount, never silently dropped.`);
    if (!acknowledgeOverpayment) {
      blockingValidation.push(`An unapplied overpayment of ${result.unallocatedCents} cent(s) requires explicit acknowledgement (acknowledgeOverpayment: true) before this payment can be posted as-is.`);
    }
  }

  const balanceAfter = {
    interestBearing: snapshot.interestBearingRemainingCents - result.interestBearingPrincipalPaidCents,
    zeroInterest: snapshot.zeroInterestRemainingCents - result.zeroInterestPrincipalPaidCents,
  };

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "external_manual_payment", amountCents, eventOrigin },
    allocationBreakdown: result,
    balanceAfter,
    interestEffect: {
      accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
      accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents - result.interestPaidCents,
      interestPaidCents: result.interestPaidCents,
    },
    payoffEffect: balanceAfter.interestBearing === 0 && balanceAfter.zeroInterest === 0 ? { paysAccountInFull: true } : null,
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin,
            idempotencyKey,
            amountCents,
            allocation: result,
            principalRemainingCentsAfter: balanceAfter,
            reason,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- 9. Payoff concession -------------------------------------------------------------------------------

export function previewPayoffConcession({ events, asOfDate, interestBearingDeltaCents, zeroInterestDeltaCents, reason, borrowerVisibleExplanation, createdBy }) {
  requireInteger(interestBearingDeltaCents, "interestBearingDeltaCents");
  requireInteger(zeroInterestDeltaCents, "zeroInterestDeltaCents");
  if (interestBearingDeltaCents > 0 || zeroInterestDeltaCents > 0) violate("A payoff concession only ever forgives -- both deltas must be zero or negative.");
  if (interestBearingDeltaCents === 0 && zeroInterestDeltaCents === 0) violate("A payoff concession must forgive a non-zero amount on at least one component.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, asOfDate);
  const afterInterestBearing = snapshot.interestBearingRemainingCents + interestBearingDeltaCents;
  const afterZeroInterest = snapshot.zeroInterestRemainingCents + zeroInterestDeltaCents;

  const warnings = [];
  const blockingValidation = [];
  if (afterInterestBearing !== 0 || afterZeroInterest !== 0) {
    blockingValidation.push(
      `A payoff_concession must bring both components to exactly zero -- these deltas would leave {interestBearing: ${afterInterestBearing}, zeroInterest: ${afterZeroInterest}}.`,
    );
  }
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const balanceAfter = { interestBearing: afterInterestBearing, zeroInterest: afterZeroInterest };

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "payoff_concession", interestBearingDeltaCents, zeroInterestDeltaCents },
    allocationBreakdown: { interestBearingDeltaCents, zeroInterestDeltaCents },
    balanceAfter,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    payoffEffect: { closesAccount: blockingValidation.length === 0, forgivenCents: -interestBearingDeltaCents + -zeroInterestDeltaCents },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            interestBearingDeltaCents,
            zeroInterestDeltaCents,
            principalRemainingCentsAfter: balanceAfter,
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- Account closure preview (not one of the 9 adjustment kinds, but required by section 7) ------------

export function previewAccountClosure({ events, asOfDate, closureReason, payoffConcessionEventId = null, createdBy }) {
  requireNonEmptyString(closureReason, "closureReason");
  requireNonEmptyString(createdBy, "createdBy");
  const snapshot = replayFor(events, asOfDate);
  const eligibility = evaluateClosureEligibility(snapshot);

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "account_closure", closureReason, payoffConcessionEventId },
    allocationBreakdown: null,
    balanceAfter: { interestBearing: snapshot.interestBearingRemainingCents, zeroInterest: snapshot.zeroInterestRemainingCents },
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    payoffEffect: { closesAccount: eligibility.eligible },
    warnings: [],
    blockingValidation: eligibility.blockers,
    proposedEventPayload:
      eligibility.eligible
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            closureReason,
            payoffConcessionEventId,
            effectiveDate: asOfDate,
          }
        : null,
  });
}
