// Reconstructs a Private Financing account's current state by folding its full event history through
// exactly the same primitives Checkpoint A's golden replay proved correct against South Main
// (computeAccrual, allocatePayment) and Checkpoint B's deterministic ordering (sortEventsForReplay). This
// is the ONLY way current state is ever computed -- no stored running balance is ever trusted. Every
// event's own stored allocation/after-balance is independently recomputed and cross-checked here rather
// than trusted at face value, so a corrupted or hand-edited event is caught by replay, not silently
// believed.

import {
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_COMPONENT_TYPE,
  validatePrivateFinancingEvent,
} from "./privateFinancingContracts.js";
import { sortEventsForReplay } from "./ledgerOrdering.js";
import { computeAccrual } from "./interestAccrual.js";
import { allocatePayment } from "./paymentAllocation.js";
import { roundToNearestCent } from "./currencyMath.js";
import { assertBalanceAfterMatchesDelta, LedgerIntegrityViolationError } from "./ledgerIntegrity.js";

function violate(reason) {
  throw new LedgerIntegrityViolationError(reason);
}

// Replays every event with effectiveDate <= asOfDate, in deterministic order, and returns the account's
// state as of that date. Pure function: never mutates `events`, never performs I/O, never depends on
// wall-clock "now" (asOfDate is always caller-supplied) -- calling it twice with identical arguments
// always produces an identical (deep-equal) result.
export function replayEvents({ events, asOfDate }) {
  // Re-validate every event's own shape before folding, even though a real write path would already have
  // validated at post time -- defense-in-depth against a hand-edited or legacy-format row, and it
  // normalizes every optional field to its canonical null/default in one place.
  const validated = events.map((event) => validatePrivateFinancingEvent(event));
  const sorted = sortEventsForReplay(validated.filter((event) => event.effectiveDate <= asOfDate));

  const openingEvents = sorted.filter((event) => event.eventType === PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED);
  if (openingEvents.length !== 1) {
    violate(`replayEvents requires exactly one account_opened event on or before asOfDate; found ${openingEvents.length}.`);
  }
  const opening = openingEvents[0];

  const eventsById = new Map(sorted.map((event) => [event.id, event]));
  const reversedTargetIds = new Set();
  for (const event of sorted) {
    if (event.reversesEventId == null) continue;
    if (reversedTargetIds.has(event.reversesEventId)) {
      violate(`event "${event.reversesEventId}" is reversed by more than one event in this history.`);
    }
    reversedTargetIds.add(event.reversesEventId);
  }

  const componentTerms = {};
  for (const component of opening.openingComponents) componentTerms[component.componentType] = component;
  const interestBearingTerms = componentTerms[PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING];
  const zeroInterestTerms = componentTerms[PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST];

  let interestBearingRemainingCents = interestBearingTerms?.originalPrincipalCents ?? 0;
  let zeroInterestRemainingCents = zeroInterestTerms?.originalPrincipalCents ?? 0;
  const interestBearingRateBps = interestBearingTerms?.rateBps ?? 0;
  const interestBearingRegularPaymentCents = interestBearingTerms?.regularPaymentCents ?? 0;
  const zeroInterestRegularPaymentCents = zeroInterestTerms?.regularPaymentCents ?? 0;

  let unpaidAccruedInterestFractionalCents = 0;
  let cumulativeInterestPaidCents = 0;
  let cumulativeCashPrincipalPaidCents = 0;
  let cumulativePrincipalForgivenCents = 0;
  let unappliedCents = 0;
  let lastAccrualDate = opening.effectiveDate;
  let closed = false;
  let closureReason = null;
  let closingEventId = null;

  function currentComponentBalance(componentType) {
    return componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING ? interestBearingRemainingCents : zeroInterestRemainingCents;
  }
  function setComponentBalance(componentType, value) {
    if (componentType === PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING) interestBearingRemainingCents = value;
    else zeroInterestRemainingCents = value;
  }

  for (const event of sorted) {
    if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED) continue;

    if (event.effectiveDate < lastAccrualDate) {
      // Structurally unreachable given sortEventsForReplay's own ordering guarantee -- kept as
      // defense-in-depth, since interest can never be asked to accrue backward.
      violate(`event "${event.id}" is out of chronological order relative to accrual.`);
    }
    unpaidAccruedInterestFractionalCents += computeAccrual({
      principalRemainingCents: interestBearingRemainingCents,
      rateBps: interestBearingRateBps,
      fromDate: lastAccrualDate,
      toDate: event.effectiveDate,
    });
    lastAccrualDate = event.effectiveDate;

    if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED) {
      const accruedInterestCents = roundToNearestCent(unpaidAccruedInterestFractionalCents);
      const result = allocatePayment({
        interestBearing: { remainingPrincipalCents: interestBearingRemainingCents, regularPaymentCents: interestBearingRegularPaymentCents },
        zeroInterest: { remainingPrincipalCents: zeroInterestRemainingCents, regularPaymentCents: zeroInterestRegularPaymentCents },
        accruedInterestCents,
        paymentAmountCents: event.amountCents,
      });
      if (
        result.interestPaidCents !== event.allocation.interestPaidCents ||
        result.interestBearingPrincipalPaidCents !== event.allocation.interestBearingPrincipalPaidCents ||
        result.zeroInterestPrincipalPaidCents !== event.allocation.zeroInterestPrincipalPaidCents ||
        result.unallocatedCents !== event.allocation.unallocatedCents
      ) {
        violate(`event "${event.id}"'s stored allocation does not match independently recomputed allocation -- ledger corruption detected.`);
      }
      unpaidAccruedInterestFractionalCents -= result.interestPaidCents;
      interestBearingRemainingCents -= result.interestBearingPrincipalPaidCents;
      zeroInterestRemainingCents -= result.zeroInterestPrincipalPaidCents;
      cumulativeInterestPaidCents += result.interestPaidCents;
      cumulativeCashPrincipalPaidCents += result.interestBearingPrincipalPaidCents + result.zeroInterestPrincipalPaidCents;
      unappliedCents += result.unallocatedCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL) {
      if (!eventsById.has(event.reversesEventId)) {
        violate(`payment_reversal "${event.id}" references an event not present in this replay.`);
      }
      interestBearingRemainingCents += event.allocation.interestBearingPrincipalPaidCents;
      zeroInterestRemainingCents += event.allocation.zeroInterestPrincipalPaidCents;
      cumulativeInterestPaidCents -= event.allocation.interestPaidCents;
      cumulativeCashPrincipalPaidCents -= event.allocation.interestBearingPrincipalPaidCents + event.allocation.zeroInterestPrincipalPaidCents;
      unpaidAccruedInterestFractionalCents += event.allocation.interestPaidCents;
      unappliedCents -= event.allocation.unallocatedCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
      const priorBalance = currentComponentBalance(event.componentType);
      assertBalanceAfterMatchesDelta(priorBalance, event.deltaCents, event.correctedComponentPrincipalRemainingCentsAfter, `principal_correction "${event.id}"`);
      setComponentBalance(event.componentType, event.correctedComponentPrincipalRemainingCentsAfter);
      if (event.deltaCents < 0) cumulativePrincipalForgivenCents += -event.deltaCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
      const priorUnpaid = roundToNearestCent(unpaidAccruedInterestFractionalCents);
      const after = priorUnpaid + event.deltaCents;
      if (after < 0) violate(`interest_correction "${event.id}" would create negative accrued interest.`);
      unpaidAccruedInterestFractionalCents = after;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION) {
      const target = eventsById.get(event.reversesEventId);
      if (!target) violate(`compensating_correction "${event.id}" references an event not present in this replay.`);
      if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
        const priorBalance = currentComponentBalance(target.componentType);
        const after = priorBalance + event.deltaCents;
        if (after < 0) violate(`compensating_correction "${event.id}" would create negative principal.`);
        setComponentBalance(target.componentType, after);
        cumulativePrincipalForgivenCents += event.deltaCents < 0 ? -event.deltaCents : event.deltaCents;
      } else if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
        const priorUnpaid = roundToNearestCent(unpaidAccruedInterestFractionalCents);
        const after = priorUnpaid + event.deltaCents;
        if (after < 0) violate(`compensating_correction "${event.id}" would create negative accrued interest.`);
        unpaidAccruedInterestFractionalCents = after;
      } else {
        violate(`compensating_correction "${event.id}" targets an unsupported event type "${target.eventType}" for replay.`);
      }
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION) {
      const afterInterestBearing = interestBearingRemainingCents + event.interestBearingDeltaCents;
      const afterZeroInterest = zeroInterestRemainingCents + event.zeroInterestDeltaCents;
      if (afterInterestBearing !== 0 || afterZeroInterest !== 0) {
        // The contract already requires the STORED after-snapshot to be exactly {0, 0}; this
        // independently recomputes it from the account's REAL prior state and rejects a concession whose
        // deltas don't actually zero the true balance, rather than trusting the stored snapshot.
        violate(
          `payoff_concession "${event.id}"'s deltas do not exactly zero the actual remaining balance -- computed {${afterInterestBearing}, ${afterZeroInterest}}, expected {0, 0}.`,
        );
      }
      cumulativePrincipalForgivenCents += -event.interestBearingDeltaCents + -event.zeroInterestDeltaCents;
      interestBearingRemainingCents = 0;
      zeroInterestRemainingCents = 0;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED) {
      const unpaidAccruedInterestCentsNow = roundToNearestCent(unpaidAccruedInterestFractionalCents);
      if (interestBearingRemainingCents !== 0 || zeroInterestRemainingCents !== 0 || unpaidAccruedInterestCentsNow !== 0) {
        violate(
          `account_closed "${event.id}" was posted while a balance remained (principal {${interestBearingRemainingCents}, ${zeroInterestRemainingCents}}, unpaid interest ${unpaidAccruedInterestCentsNow}) -- closure requires exactly zero owed.`,
        );
      }
      // Lifecycle status only -- no branch above this one touches a balance for this event type.
      closed = true;
      closureReason = event.closureReason;
      closingEventId = event.id;
    } else {
      violate(`replayEvents does not know how to apply event type "${event.eventType}".`);
    }

    // "closed" is a fact DERIVED fresh on every replay, never a stored flag an event can leave stale. If
    // a later event (a payment_reversal undoing the final payment, most naturally) brings the balance
    // back above zero, the account is no longer closed -- reopening happens only by appending a real
    // event that changes the replayed balance, never by mutating a status field.
    if (closed && (interestBearingRemainingCents > 0 || zeroInterestRemainingCents > 0)) {
      closed = false;
      closureReason = null;
      closingEventId = null;
    }
  }

  // Catch-up accrual: the loop above only advances interest as a side effect of processing an event. If
  // asOfDate falls after the last event (the common case for "what's owed today" queries -- there is
  // rarely an event landing on exactly today's date), the gap between the last event and asOfDate must
  // still accrue. computeAccrual is a no-op once the balance is 0, so this is always safe to run,
  // including on an already-closed account.
  unpaidAccruedInterestFractionalCents += computeAccrual({
    principalRemainingCents: interestBearingRemainingCents,
    rateBps: interestBearingRateBps,
    fromDate: lastAccrualDate,
    toDate: asOfDate,
  });

  return Object.freeze({
    ownerId: opening.ownerId,
    accountId: opening.accountId,
    asOfDate,
    interestBearingRemainingCents,
    zeroInterestRemainingCents,
    totalPrincipalRemainingCents: interestBearingRemainingCents + zeroInterestRemainingCents,
    unpaidAccruedInterestCents: roundToNearestCent(unpaidAccruedInterestFractionalCents),
    unpaidAccruedInterestFractionalCents,
    cumulativeInterestPaidCents,
    cumulativeCashPrincipalPaidCents,
    cumulativePrincipalForgivenCents,
    unappliedCents,
    closed,
    closureReason,
    closingEventId,
    interestBearingRegularPaymentCents,
    zeroInterestRegularPaymentCents,
    interestBearingRateBps,
  });
}

// Whether an account is eligible to be closed RIGHT NOW, given its current replayed state -- the
// pre-check a preview/write-path function must run before ever proposing an account_closed event.
// Closure requires exactly zero owed (principal and accrued interest) and no unresolved unapplied
// (overpayment) amount, and refuses a second attempt on an already-closed account.
export function evaluateClosureEligibility(replaySnapshot) {
  const blockers = [];
  if (replaySnapshot.closed) blockers.push("The account is already closed.");
  if (replaySnapshot.totalPrincipalRemainingCents !== 0) blockers.push("Remaining principal is not zero.");
  if (replaySnapshot.unpaidAccruedInterestCents !== 0) blockers.push("Unpaid accrued interest is not zero.");
  if (replaySnapshot.unappliedCents !== 0) blockers.push("An unapplied (overpayment) amount is unresolved.");
  return Object.freeze({ eligible: blockers.length === 0, blockers: Object.freeze(blockers) });
}
