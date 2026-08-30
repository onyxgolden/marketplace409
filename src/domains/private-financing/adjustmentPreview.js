// Pure, side-effect-free previews for every adjustment/payment kind the owner can propose. A preview
// NEVER creates an event, reserves a ledgerSequence, mutates an account, or implies approval -- it is
// read-only, built entirely on replayEvents' current state, and every function here returns the exact
// same common envelope (see buildPreviewEnvelope) so a UI or API layer can treat any adjustment kind
// uniformly. Malformed/type-level input throws (fail closed); a business-rule problem (would go negative,
// quote expired, insufficient funds) is surfaced in the envelope's blockingValidation array instead of
// throwing, so the caller can inspect exactly why an action isn't currently postable.
//
// V1 TERMS GENERALIZATION: every function now takes componentVersions/accountTermsVersions (the account's
// full, versioned component/terms history -- replayEvents.js resolves what's active as of asOfDate) and
// operates on a generic {[componentId]: cents} shape throughout. componentId is always REQUIRED where a
// specific component matters (bring-current credit, principal/interest corrections, fee reimbursement) --
// there is no default component anymore, since a default would silently pick one of possibly several
// components. The seller/lender always selects explicitly (see PrivateFinancingSellerActions.jsx).

import { replayEvents, evaluateClosureEligibility } from "./replayEvents.js";
import { allocatePayment } from "./paymentAllocation.js";
import { resolveAccountTermsAsOf } from "./financingTermsContracts.js";
import { computeDueState, UnsupportedDueStateError } from "./dueState.js";
import {
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
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

// The single common shape every preview function returns -- see file header. principalByComponent /
// balanceBefore / balanceAfter are all {[componentId]: cents} maps now, covering however many components
// the account actually has (one or more), never two fixed named slots.
function buildPreviewEnvelope({
  snapshot,
  asOfDate,
  proposedAdjustment,
  allocationBreakdown,
  balanceAfterByComponent,
  interestEffect,
  pastDueEffect = null,
  payoffEffect = null,
  warnings,
  blockingValidation,
  proposedEventPayload,
  proposedEventPayloads = null,
}) {
  const principalByComponent = {};
  for (const componentId of Object.keys(snapshot.remainingPrincipalByComponentCents)) {
    principalByComponent[componentId] = Object.freeze({
      before: snapshot.remainingPrincipalByComponentCents[componentId],
      after: balanceAfterByComponent[componentId] ?? snapshot.remainingPrincipalByComponentCents[componentId],
    });
  }
  return Object.freeze({
    ownerId: snapshot.ownerId,
    accountId: snapshot.accountId,
    asOfDate,
    balanceBeforeByComponentCents: Object.freeze({ ...snapshot.remainingPrincipalByComponentCents }),
    unpaidAccruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
    proposedAdjustment: Object.freeze(proposedAdjustment),
    allocationBreakdown: allocationBreakdown ? Object.freeze(allocationBreakdown) : null,
    balanceAfterByComponentCents: Object.freeze({ ...balanceAfterByComponent }),
    principalByComponent: Object.freeze(principalByComponent),
    interestEffect: Object.freeze(interestEffect),
    pastDueEffect: pastDueEffect ? Object.freeze(pastDueEffect) : null,
    payoffEffect: payoffEffect ? Object.freeze(payoffEffect) : null,
    warnings: Object.freeze([...warnings]),
    blockingValidation: Object.freeze([...blockingValidation]),
    proposedEventPayload: proposedEventPayload ? Object.freeze(proposedEventPayload) : null,
    proposedEventPayloads: proposedEventPayloads ? Object.freeze(proposedEventPayloads.map((payload) => Object.freeze(payload))) : null,
  });
}

function replayFor(events, componentVersions, accountTermsVersions, asOfDate) {
  return replayEvents({ events, componentVersions, accountTermsVersions, asOfDate });
}

// -- 1/2. Principal correction (contractual) and principal concession (discretionary) --------------------

function previewPrincipalAdjustment({ events, componentVersions, accountTermsVersions, asOfDate, componentId, deltaCents, correctionBasis, reason, borrowerVisibleExplanation = null, createdBy }) {
  requireNonEmptyString(componentId, "componentId");
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");
  if (correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION) {
    requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  }

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const warnings = [];
  const blockingValidation = [];
  const priorBalance = snapshot.remainingPrincipalByComponentCents[componentId];
  if (priorBalance === undefined) {
    blockingValidation.push(`Component "${componentId}" does not exist on this account as of ${asOfDate}.`);
  }
  const afterBalance = (priorBalance ?? 0) + deltaCents;
  if (priorBalance !== undefined && afterBalance < 0) {
    blockingValidation.push(`This correction would reduce component "${componentId}" principal below zero (from ${priorBalance} by ${deltaCents}).`);
  }
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const balanceAfterByComponent = { ...snapshot.remainingPrincipalByComponentCents, [componentId]: priorBalance !== undefined ? afterBalance : priorBalance };

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION ? "discretionary_principal_concession" : "contractual_principal_correction", componentId, deltaCents, correctionBasis },
    allocationBreakdown: { componentId, deltaCents },
    balanceAfterByComponent,
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
            componentId,
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

// componentId is always the seller/lender's own explicit choice -- see
// PrivateFinancingSellerActions.jsx's componentId select field for this action. No default is offered:
// with an ordered collection of one or more components, defaulting to "the first one" or "the
// highest-rate one" would silently pick for the seller/lender rather than let them choose, which section 6
// of the terms-generalization checkpoint explicitly requires.
//
// AUTHORITATIVE DUE-STATE ONLY: the scheduled-amount/next-due-date/next-due-amount figures this credit is
// calculated against are never seller-typed input -- they come from computeDueState (dueState.js), the
// same engine the account-detail read model uses, so a bring-current credit can never be computed against
// a number the seller made up or against a stale/incorrect schedule. For an account outside V1's due-state
// support envelope (non-monthly frequency, or prepaymentPolicy "unsupported"), this action is not
// computable at all and fails closed via blockingValidation, exactly like every other "unsupported terms"
// case in this codebase -- never a guessed or partially-computed credit.
export function previewBringCurrentCredit({
  events,
  componentVersions,
  accountTermsVersions,
  asOfDate,
  componentId,
  reason,
  borrowerVisibleExplanation,
  createdBy,
}) {
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const terms = resolveAccountTermsAsOf(accountTermsVersions, asOfDate);
  const warnings = [];
  const blockingValidation = [];

  let dueState = null;
  try {
    dueState = computeDueState({ snapshot, accountTerms: terms, asOfDate });
  } catch (error) {
    if (!(error instanceof UnsupportedDueStateError)) throw error;
    blockingValidation.push(`A bring-current credit requires a computable due schedule for this account, which is not available: ${error.message}`);
  }

  const shortageCents = dueState ? dueState.currentAmountDueCents + dueState.pastDueAmountCents : 0;
  if (dueState && shortageCents === 0) blockingValidation.push("This account is already current; no bring-current credit is needed.");
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  let allocation = null;
  if (dueState && shortageCents > 0) {
    allocation = allocatePayment({
      components: snapshot.components.map((component) => ({
        componentId: component.componentKey,
        remainingPrincipalCents: snapshot.remainingPrincipalByComponentCents[component.componentKey],
        scheduledComponentAmountCents: component.scheduledComponentAmountCents,
        rateBps: component.rateBps,
        allocationPriority: component.allocationPriority,
      })),
      accruedInterestCentsByComponent: {},
      paymentAmountCents: shortageCents,
      allocationPolicy: terms.allocationPolicy,
      extraPaymentAllocationPolicy: terms.extraPaymentAllocationPolicy,
      selectedExtraComponentId: componentId ?? null,
    });
    if (allocation.unallocatedCents > 0) {
      const selectionHelp = terms.extraPaymentAllocationPolicy === "selected_component_extra"
        ? " Select the component that should receive credit above the scheduled component amounts."
        : "";
      blockingValidation.push(`The account's allocation policy could not apply ${allocation.unallocatedCents} cents of the exact bring-current credit.${selectionHelp}`);
    }
  }

  const creditedByComponentCents = allocation?.principalPaidByComponentCents ?? {};
  const balanceAfterByComponent = { ...snapshot.remainingPrincipalByComponentCents };
  for (const [allocatedComponentId, creditCents] of Object.entries(creditedByComponentCents)) {
    balanceAfterByComponent[allocatedComponentId] -= creditCents;
  }
  const allocatedCreditCents = Object.values(creditedByComponentCents).reduce((sum, cents) => sum + cents, 0);
  if (allocation && allocatedCreditCents + allocation.unallocatedCents !== shortageCents) {
    blockingValidation.push("The bring-current allocation did not conserve the exact shortage amount.");
  }

  const proposedEventPayloads =
    blockingValidation.length === 0
      ? Object.entries(creditedByComponentCents)
          .filter(([, creditCents]) => creditCents > 0)
          .map(([allocatedComponentId, creditCents]) => ({
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            componentId: allocatedComponentId,
            correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
            deltaCents: -creditCents,
            correctedComponentPrincipalRemainingCentsAfter: balanceAfterByComponent[allocatedComponentId],
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }))
      : null;

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: {
      kind: "bring_current_credit",
      exactCreditCents: shortageCents,
      allocationPolicy: terms.allocationPolicy,
      extraPaymentAllocationPolicy: terms.extraPaymentAllocationPolicy,
      selectedExtraComponentId: componentId ?? null,
    },
    allocationBreakdown: { creditedByComponentCents, unallocatedCents: allocation?.unallocatedCents ?? 0 },
    balanceAfterByComponent,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    pastDueEffect: dueState
      ? {
          scheduledAmountCents: dueState.scheduledThroughAsOfDateCents,
          alreadyPostedCents: dueState.alreadyPostedCents,
          shortageCents,
          proposedCreditCents: shortageCents,
          pastDueBeforeCents: shortageCents,
          pastDueAfterCents: blockingValidation.length === 0 ? 0 : shortageCents,
          nextDueDate: dueState.nextDueDate,
          nextDueAmountCents: dueState.regularScheduledPaymentAmountCents,
        }
      : null,
    warnings,
    blockingValidation,
    proposedEventPayload: proposedEventPayloads?.length === 1 ? proposedEventPayloads[0] : null,
    proposedEventPayloads,
  });
}

// -- 4/5. Interest correction (contractual) and interest waiver (discretionary) -----------------------

function previewInterestAdjustment({ events, componentVersions, accountTermsVersions, asOfDate, componentId, deltaCents, correctionBasis, reason, borrowerVisibleExplanation = null, createdBy }) {
  requireNonEmptyString(componentId, "componentId");
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");
  if (correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION) {
    requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  }

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const warnings = [];
  const blockingValidation = [];
  const priorInterest = snapshot.unpaidAccruedInterestByComponentCents[componentId];
  if (priorInterest === undefined) blockingValidation.push(`Component "${componentId}" does not exist on this account as of ${asOfDate}.`);
  const afterInterest = (priorInterest ?? 0) + deltaCents;
  if (priorInterest !== undefined && afterInterest < 0) {
    blockingValidation.push(`This correction would reduce unpaid accrued interest on component "${componentId}" below zero (from ${priorInterest} by ${deltaCents}).`);
  }
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: correctionBasis === CORRECTION_BASIS.DISCRETIONARY_CONCESSION ? "interest_waiver" : "interest_correction", componentId, deltaCents, correctionBasis },
    allocationBreakdown: { componentId, deltaCents },
    balanceAfterByComponent: snapshot.remainingPrincipalByComponentCents,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents + (afterInterest - (priorInterest ?? 0)) },
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
            componentId,
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
// balanceBefore -- because a processor fee the seller/lender personally absorbed is bookkeeping, tracked
// separately from principal and interest, never assumed to reduce a borrower's credit for a payment they
// already made in full. This is a general rule for every account, independent of that account's own
// fee_payer servicing policy. Only when the seller/lender EXPLICITLY elects postAsLoanCredit: true does
// this become a real discretionary_concession principal_correction against an explicitly selected
// component -- and even then it never touches a payment_posted event's own allocation; it is always its
// own separate event.
export function previewStripeFeeReimbursement({ events, componentVersions, accountTermsVersions, asOfDate, feeAmountCents, postAsLoanCredit = false, componentId = null, reason, borrowerVisibleExplanation = null, createdBy = null }) {
  requireInteger(feeAmountCents, "feeAmountCents");
  if (feeAmountCents <= 0) violate("feeAmountCents must be a positive integer.");
  requireNonEmptyString(reason, "reason");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);

  if (!postAsLoanCredit) {
    return buildPreviewEnvelope({
      snapshot,
      asOfDate,
      proposedAdjustment: { kind: "stripe_fee_reimbursement", feeAmountCents, postAsLoanCredit: false },
      allocationBreakdown: null,
      balanceAfterByComponent: snapshot.remainingPrincipalByComponentCents,
      interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
      warnings: [
        "This reimbursement does not affect the loan ledger. It is tracked separately from principal and interest, and never reduces the amount credited from a borrower payment.",
      ],
      blockingValidation: [],
      proposedEventPayload: null,
    });
  }

  requireNonEmptyString(componentId, "componentId");
  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  const preview = previewPrincipalAdjustment({
    events,
    componentVersions,
    accountTermsVersions,
    asOfDate,
    componentId,
    deltaCents: -feeAmountCents,
    correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
    reason,
    borrowerVisibleExplanation,
    createdBy,
  });
  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "stripe_fee_reimbursement", feeAmountCents, postAsLoanCredit: true, componentId },
    allocationBreakdown: preview.allocationBreakdown,
    balanceAfterByComponent: preview.balanceAfterByComponentCents,
    interestEffect: preview.interestEffect,
    warnings: ["The seller/lender explicitly elected to post this Stripe-fee reimbursement as a loan credit -- an unusual, deliberate action, not the default."],
    blockingValidation: preview.blockingValidation,
    proposedEventPayload: preview.proposedEventPayload,
  });
}

// -- 7. Compensating correction ------------------------------------------------------------------------

export function previewCompensatingCorrection({ events, componentVersions, accountTermsVersions, asOfDate, reversesEventId, deltaCents, reason, createdBy }) {
  requireNonEmptyString(reversesEventId, "reversesEventId");
  requireInteger(deltaCents, "deltaCents");
  if (deltaCents === 0) violate("deltaCents must be non-zero.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
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
  let resolvedComponentId = null;
  let isInterestTarget = false;
  if (blockingValidation.length === 0) {
    if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
      resolvedComponentId = target.componentId;
      const priorBalance = snapshot.remainingPrincipalByComponentCents[resolvedComponentId];
      afterBalance = (priorBalance ?? 0) + deltaCents;
      if (afterBalance < 0) blockingValidation.push(`This compensating correction would reduce component "${resolvedComponentId}" principal below zero.`);
    } else if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
      resolvedComponentId = target.componentId;
      isInterestTarget = true;
      const priorInterest = snapshot.unpaidAccruedInterestByComponentCents[resolvedComponentId] ?? 0;
      afterBalance = priorInterest + deltaCents;
      if (afterBalance < 0) blockingValidation.push(`This compensating correction would reduce unpaid accrued interest on component "${resolvedComponentId}" below zero.`);
    } else {
      blockingValidation.push(`replayEvents does not support reversing a ${target.eventType} event via compensating_correction.`);
    }
  }

  const balanceAfterByComponent =
    resolvedComponentId && !isInterestTarget && afterBalance !== null
      ? { ...snapshot.remainingPrincipalByComponentCents, [resolvedComponentId]: afterBalance }
      : snapshot.remainingPrincipalByComponentCents;

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "compensating_correction", reversesEventId, deltaCents, componentId: resolvedComponentId },
    allocationBreakdown: { reversesEventId, deltaCents },
    balanceAfterByComponent,
    interestEffect: {
      accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
      accruedInterestAfterCents: isInterestTarget && afterBalance !== null ? snapshot.unpaidAccruedInterestCents + (afterBalance - (snapshot.unpaidAccruedInterestByComponentCents[resolvedComponentId] ?? 0)) : snapshot.unpaidAccruedInterestCents,
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
            componentId: resolvedComponentId,
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
  componentVersions,
  accountTermsVersions,
  asOfDate,
  amountCents,
  eventOrigin = PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
  idempotencyKey,
  reason = null,
  acknowledgeOverpayment = false,
  selectedExtraComponentId = null,
}) {
  requireInteger(amountCents, "amountCents");
  if (amountCents <= 0) violate("amountCents must be a positive integer.");
  requireNonEmptyString(idempotencyKey, "idempotencyKey");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const terms = resolveAccountTermsAsOf(accountTermsVersions, asOfDate);
  const warnings = [];
  const blockingValidation = [];
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  const accruedInterestCentsByComponent = {};
  for (const component of snapshot.components) accruedInterestCentsByComponent[component.componentKey] = snapshot.unpaidAccruedInterestByComponentCents[component.componentKey] ?? 0;

  const result = allocatePayment({
    components: snapshot.components.map((component) => ({
      componentId: component.componentKey,
      remainingPrincipalCents: snapshot.remainingPrincipalByComponentCents[component.componentKey],
      scheduledComponentAmountCents: component.scheduledComponentAmountCents,
      rateBps: component.rateBps,
      allocationPriority: component.allocationPriority,
    })),
    accruedInterestCentsByComponent,
    paymentAmountCents: amountCents,
    allocationPolicy: terms.allocationPolicy,
    extraPaymentAllocationPolicy: terms.extraPaymentAllocationPolicy,
    selectedExtraComponentId,
  });

  // An overpayment must become an explicit unapplied amount, never disappear and never go negative -- it
  // is ALWAYS reported here (see allocationBreakdown.unallocatedCents), and by default blocks posting
  // until the caller explicitly acknowledges how it should be handled (fail-closed default).
  if (result.unallocatedCents > 0) {
    warnings.push(`This payment leaves ${result.unallocatedCents} cent(s) unapplied -- an unapplied/refundable amount, never silently dropped.`);
    if (!acknowledgeOverpayment) {
      blockingValidation.push(`An unapplied amount of ${result.unallocatedCents} cent(s) requires explicit acknowledgement (acknowledgeOverpayment: true) before this payment can be posted as-is.`);
    }
  }

  const balanceAfterByComponent = { ...snapshot.remainingPrincipalByComponentCents };
  for (const [componentId, principalPaid] of Object.entries(result.principalPaidByComponentCents)) {
    balanceAfterByComponent[componentId] -= principalPaid;
  }
  const paysAccountInFull = Object.values(balanceAfterByComponent).every((balance) => balance === 0);

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "external_manual_payment", amountCents, eventOrigin },
    allocationBreakdown: result,
    balanceAfterByComponent,
    interestEffect: {
      accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
      accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents - Object.values(result.interestPaidByComponentCents).reduce((sum, cents) => sum + cents, 0),
      interestPaidCents: Object.values(result.interestPaidByComponentCents).reduce((sum, cents) => sum + cents, 0),
    },
    payoffEffect: paysAccountInFull ? { paysAccountInFull: true } : null,
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
            principalRemainingByComponentCents: balanceAfterByComponent,
            selectedExtraComponentId,
            reason,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- 9. Payoff concession -------------------------------------------------------------------------------

export function previewPayoffConcession({ events, componentVersions, accountTermsVersions, asOfDate, deltaCentsByComponentCents, reason, borrowerVisibleExplanation, createdBy }) {
  if (typeof deltaCentsByComponentCents !== "object" || deltaCentsByComponentCents === null) {
    violate("deltaCentsByComponentCents must be an object keyed by componentId.");
  }
  const entries = Object.entries(deltaCentsByComponentCents);
  if (entries.length === 0) violate("deltaCentsByComponentCents must have at least one entry.");
  for (const [componentId, delta] of entries) {
    if (!Number.isInteger(delta) || delta > 0) violate(`deltaCentsByComponentCents.${componentId} must be a non-positive integer.`);
  }
  if (entries.every(([, delta]) => delta === 0)) violate("A payoff concession must forgive a non-zero amount on at least one component.");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(borrowerVisibleExplanation, "borrowerVisibleExplanation");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const balanceAfterByComponent = { ...snapshot.remainingPrincipalByComponentCents };
  for (const [componentId, delta] of entries) {
    if (balanceAfterByComponent[componentId] === undefined) {
      balanceAfterByComponent[componentId] = undefined;
    } else {
      balanceAfterByComponent[componentId] += delta;
    }
  }

  const warnings = [];
  const blockingValidation = [];
  for (const [componentId, delta] of entries) {
    if (snapshot.remainingPrincipalByComponentCents[componentId] === undefined) {
      blockingValidation.push(`Component "${componentId}" does not exist on this account as of ${asOfDate}.`);
    }
  }
  if (blockingValidation.length === 0) {
    const stillOwed = Object.entries(balanceAfterByComponent).filter(([, balance]) => balance !== 0);
    if (stillOwed.length > 0) {
      blockingValidation.push(
        `A payoff_concession must bring every component to exactly zero -- these deltas would leave a nonzero balance on: ${stillOwed.map(([id]) => id).join(", ")}.`,
      );
    }
  }
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "payoff_concession", deltaCentsByComponentCents },
    allocationBreakdown: { deltaCentsByComponentCents },
    balanceAfterByComponent,
    interestEffect: { accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents, accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents },
    payoffEffect: { closesAccount: blockingValidation.length === 0, forgivenCents: entries.reduce((sum, [, delta]) => sum - delta, 0) },
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
            deltaCentsByComponentCents,
            principalRemainingByComponentCents: balanceAfterByComponent,
            reason,
            borrowerVisibleExplanation,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- 10. Payment reversal (undoes a specific payment_posted event) -------------------------------------

// Reverses EXACTLY the allocation the target payment made -- the reversal event's own amountCents and
// allocation are a direct copy of the target's (positive numbers, matching validatePaymentReversalFields'
// contract exactly), never negated here: replayEvents.js's own PAYMENT_REVERSAL fold ADDS the allocation
// back onto the running balance, so the sign convention is "undo this much," not "this much backward."
export function previewPaymentReversal({ events, componentVersions, accountTermsVersions, asOfDate, reversesEventId, reason, createdBy }) {
  requireNonEmptyString(reversesEventId, "reversesEventId");
  requireNonEmptyString(reason, "reason");
  requireNonEmptyString(createdBy, "createdBy");

  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const target = events.find((event) => event.id === reversesEventId);

  const warnings = [];
  const blockingValidation = [];
  const candidateReversal = {
    id: "__preview__",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
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
  if (snapshot.closed) blockingValidation.push("The account is already closed.");

  let balanceAfterByComponent = snapshot.remainingPrincipalByComponentCents;
  let allocation = null;
  if (blockingValidation.length === 0) {
    allocation = { ...target.allocation };
    balanceAfterByComponent = { ...snapshot.remainingPrincipalByComponentCents };
    for (const [componentId, principalPaid] of Object.entries(target.allocation.principalPaidByComponentCents)) {
      balanceAfterByComponent[componentId] = (balanceAfterByComponent[componentId] ?? 0) + principalPaid;
    }
  }

  const interestPaidTotal = allocation ? Object.values(allocation.interestPaidByComponentCents).reduce((sum, cents) => sum + cents, 0) : 0;

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "payment_reversal", reversesEventId, amountCents: target?.amountCents ?? null },
    allocationBreakdown: allocation,
    balanceAfterByComponent,
    interestEffect: {
      accruedInterestBeforeCents: snapshot.unpaidAccruedInterestCents,
      accruedInterestAfterCents: snapshot.unpaidAccruedInterestCents + interestPaidTotal,
    },
    warnings,
    blockingValidation,
    proposedEventPayload:
      blockingValidation.length === 0
        ? {
            eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
            ownerId: snapshot.ownerId,
            accountId: snapshot.accountId,
            eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
            createdBy,
            reversesEventId,
            amountCents: target.amountCents,
            allocation,
            principalRemainingByComponentCents: balanceAfterByComponent,
            reason,
            effectiveDate: asOfDate,
          }
        : null,
  });
}

// -- Account closure preview (not one of the 9 adjustment kinds, but required by section 7) ------------

export function previewAccountClosure({ events, componentVersions, accountTermsVersions, asOfDate, closureReason, payoffConcessionEventId = null, createdBy }) {
  requireNonEmptyString(closureReason, "closureReason");
  requireNonEmptyString(createdBy, "createdBy");
  const snapshot = replayFor(events, componentVersions, accountTermsVersions, asOfDate);
  const eligibility = evaluateClosureEligibility(snapshot);

  return buildPreviewEnvelope({
    snapshot,
    asOfDate,
    proposedAdjustment: { kind: "account_closure", closureReason, payoffConcessionEventId },
    allocationBreakdown: null,
    balanceAfterByComponent: snapshot.remainingPrincipalByComponentCents,
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
