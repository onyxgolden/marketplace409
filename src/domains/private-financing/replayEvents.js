// Reconstructs a Private Financing account's current state by folding its full event history through
// exactly the same primitives Checkpoint A's golden replay proved correct against South Main
// (computeAccrual, allocatePayment) and Checkpoint B's deterministic ordering (sortEventsForReplay). This
// is the ONLY way current state is ever computed -- no stored running balance is ever trusted. Every
// event's own stored allocation/after-balance is independently recomputed and cross-checked here rather
// than trusted at face value, so a corrupted or hand-edited event is caught by replay, not silently
// believed.
//
// V1 TERMS GENERALIZATION: components and account terms are no longer embedded once in the account_opened
// event -- they are separate, versioned entities (componentVersions, accountTermsVersions), each resolved
// AS OF the date being processed, exactly the same "prospective only, never rewrites history" discipline
// already established for components by the migration's own version-ordering trigger. A later amendment
// changes behavior from its own effectiveDate forward; it can never change how an earlier date replayed.
// Simplification, deliberately scoped for V1: when accruing interest across a gap that spans an amendment
// boundary, the component/rate definition active AT THE END of that gap (the event's own effectiveDate) is
// used for the entire gap, rather than pro-rating day-by-day across the exact amendment date. This matches
// prior (pre-generalization) behavior exactly for the common case of zero mid-life amendments, and is a
// disclosed, bounded simplification for the rare amended-mid-life case -- not a silent inaccuracy.

import {
  PRIVATE_FINANCING_EVENT_TYPE,
  validatePrivateFinancingEvent,
} from "./privateFinancingContracts.js";
import { resolveAccountTermsAsOf } from "./financingTermsContracts.js";
import { sortEventsForReplay } from "./ledgerOrdering.js";
import { computeAccrual } from "./interestAccrual.js";
import { allocatePayment } from "./paymentAllocation.js";
import { roundToNearestCent } from "./currencyMath.js";
import { assertBalanceAfterMatchesDelta, LedgerIntegrityViolationError } from "./ledgerIntegrity.js";

function violate(reason) {
  throw new LedgerIntegrityViolationError(reason);
}

// Resolves the components active as of a date: for each distinct componentKey, the latest version whose
// effectiveDate is on or before asOfDate. A component with no version yet as of asOfDate is simply absent.
export function resolveComponentsAsOf(componentVersions, asOfDate) {
  const latestByKey = new Map();
  for (const component of componentVersions) {
    if (component.effectiveDate > asOfDate) continue;
    const current = latestByKey.get(component.componentKey);
    if (!current || component.versionNumber > current.versionNumber) latestByKey.set(component.componentKey, component);
  }
  return [...latestByKey.values()].sort((a, b) => a.allocationPriority - b.allocationPriority);
}

function centsMapsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

// Replays every event with effectiveDate <= asOfDate, in deterministic order, and returns the account's
// state as of that date. Pure function: never mutates its inputs, never performs I/O, never depends on
// wall-clock "now" (asOfDate is always caller-supplied) -- calling it twice with identical arguments
// always produces an identical (deep-equal) result.
export function replayEvents({ events, componentVersions, accountTermsVersions, asOfDate }) {
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

  const componentsAtOpen = resolveComponentsAsOf(componentVersions, opening.effectiveDate);
  if (componentsAtOpen.length === 0) {
    violate(`replayEvents found no financing components effective as of the account_opened date (${opening.effectiveDate}) -- every account has at least one.`);
  }

  const remainingByComponent = {};
  const unpaidAccruedInterestFractionalByComponent = {};
  for (const component of componentsAtOpen) {
    remainingByComponent[component.componentKey] = component.originalPrincipalCents;
    unpaidAccruedInterestFractionalByComponent[component.componentKey] = 0;
  }

  let cumulativeInterestPaidCents = 0;
  let cumulativeCashPrincipalPaidCents = 0;
  let cumulativePrincipalForgivenCents = 0;
  let unappliedCents = 0;
  let lastAccrualDate = opening.effectiveDate;
  let closed = false;
  let closureReason = null;
  let closingEventId = null;

  for (const event of sorted) {
    if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED) continue;

    if (event.effectiveDate < lastAccrualDate) {
      // Structurally unreachable given sortEventsForReplay's own ordering guarantee -- kept as
      // defense-in-depth, since interest can never be asked to accrue backward.
      violate(`event "${event.id}" is out of chronological order relative to accrual.`);
    }

    const activeComponents = resolveComponentsAsOf(componentVersions, event.effectiveDate);
    for (const component of activeComponents) {
      if (remainingByComponent[component.componentKey] === undefined) {
        // A component added after account opening (a later amendment) starts at its own original
        // principal -- never retroactively affecting balances already replayed before its effective date.
        remainingByComponent[component.componentKey] = component.originalPrincipalCents;
        unpaidAccruedInterestFractionalByComponent[component.componentKey] = 0;
      }
      unpaidAccruedInterestFractionalByComponent[component.componentKey] += computeAccrual({
        principalRemainingCents: remainingByComponent[component.componentKey],
        rateBps: component.rateBps,
        fromDate: lastAccrualDate,
        toDate: event.effectiveDate,
      });
    }
    lastAccrualDate = event.effectiveDate;

    if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED) {
      const terms = resolveAccountTermsAsOf(accountTermsVersions, event.effectiveDate);
      const accruedInterestCentsByComponent = {};
      for (const component of activeComponents) {
        accruedInterestCentsByComponent[component.componentKey] = roundToNearestCent(unpaidAccruedInterestFractionalByComponent[component.componentKey]);
      }
      const result = allocatePayment({
        components: activeComponents.map((component) => ({
          componentId: component.componentKey,
          remainingPrincipalCents: remainingByComponent[component.componentKey],
          scheduledComponentAmountCents: component.scheduledComponentAmountCents,
          rateBps: component.rateBps,
          allocationPriority: component.allocationPriority,
        })),
        accruedInterestCentsByComponent,
        paymentAmountCents: event.amountCents,
        allocationPolicy: terms.allocationPolicy,
        extraPaymentAllocationPolicy: terms.extraPaymentAllocationPolicy,
        selectedExtraComponentId: event.selectedExtraComponentId,
      });
      if (
        !centsMapsEqual(result.interestPaidByComponentCents, event.allocation.interestPaidByComponentCents) ||
        !centsMapsEqual(result.principalPaidByComponentCents, event.allocation.principalPaidByComponentCents) ||
        result.unallocatedCents !== event.allocation.unallocatedCents
      ) {
        violate(`event "${event.id}"'s stored allocation does not match independently recomputed allocation -- ledger corruption detected.`);
      }
      for (const [componentId, interestPaid] of Object.entries(result.interestPaidByComponentCents)) {
        unpaidAccruedInterestFractionalByComponent[componentId] -= interestPaid;
        cumulativeInterestPaidCents += interestPaid;
      }
      for (const [componentId, principalPaid] of Object.entries(result.principalPaidByComponentCents)) {
        remainingByComponent[componentId] -= principalPaid;
        cumulativeCashPrincipalPaidCents += principalPaid;
      }
      unappliedCents += result.unallocatedCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL) {
      if (!eventsById.has(event.reversesEventId)) {
        violate(`payment_reversal "${event.id}" references an event not present in this replay.`);
      }
      for (const [componentId, principalPaid] of Object.entries(event.allocation.principalPaidByComponentCents)) {
        if (remainingByComponent[componentId] === undefined) violate(`payment_reversal "${event.id}" references an unknown component "${componentId}".`);
        remainingByComponent[componentId] += principalPaid;
        cumulativeCashPrincipalPaidCents -= principalPaid;
      }
      for (const [componentId, interestPaid] of Object.entries(event.allocation.interestPaidByComponentCents)) {
        unpaidAccruedInterestFractionalByComponent[componentId] += interestPaid;
        cumulativeInterestPaidCents -= interestPaid;
      }
      unappliedCents -= event.allocation.unallocatedCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
      const priorBalance = remainingByComponent[event.componentId];
      if (priorBalance === undefined) violate(`principal_correction "${event.id}" references unknown component "${event.componentId}".`);
      assertBalanceAfterMatchesDelta(priorBalance, event.deltaCents, event.correctedComponentPrincipalRemainingCentsAfter, `principal_correction "${event.id}"`);
      remainingByComponent[event.componentId] = event.correctedComponentPrincipalRemainingCentsAfter;
      if (event.deltaCents < 0) cumulativePrincipalForgivenCents += -event.deltaCents;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
      const priorFractional = unpaidAccruedInterestFractionalByComponent[event.componentId];
      if (priorFractional === undefined) violate(`interest_correction "${event.id}" references unknown component "${event.componentId}".`);
      const priorUnpaid = roundToNearestCent(priorFractional);
      const after = priorUnpaid + event.deltaCents;
      if (after < 0) violate(`interest_correction "${event.id}" would create negative accrued interest.`);
      unpaidAccruedInterestFractionalByComponent[event.componentId] = after;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION) {
      const target = eventsById.get(event.reversesEventId);
      if (!target) violate(`compensating_correction "${event.id}" references an event not present in this replay.`);
      if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION) {
        const priorBalance = remainingByComponent[target.componentId];
        if (priorBalance === undefined) violate(`compensating_correction "${event.id}" targets an unknown component "${target.componentId}".`);
        const after = priorBalance + event.deltaCents;
        if (after < 0) violate(`compensating_correction "${event.id}" would create negative principal.`);
        remainingByComponent[target.componentId] = after;
        cumulativePrincipalForgivenCents += event.deltaCents < 0 ? -event.deltaCents : event.deltaCents;
      } else if (target.eventType === PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION) {
        const priorUnpaid = roundToNearestCent(unpaidAccruedInterestFractionalByComponent[target.componentId]);
        const after = priorUnpaid + event.deltaCents;
        if (after < 0) violate(`compensating_correction "${event.id}" would create negative accrued interest.`);
        unpaidAccruedInterestFractionalByComponent[target.componentId] = after;
      } else {
        violate(`compensating_correction "${event.id}" targets an unsupported event type "${target.eventType}" for replay.`);
      }
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION) {
      const afterByComponent = {};
      for (const [componentId, delta] of Object.entries(event.deltaCentsByComponentCents)) {
        if (remainingByComponent[componentId] === undefined) violate(`payoff_concession "${event.id}" references unknown component "${componentId}".`);
        afterByComponent[componentId] = remainingByComponent[componentId] + delta;
      }
      // Every OTHER component (not named in this concession's deltas) must already independently be at
      // zero for the account to genuinely reach a full payoff via this concession.
      for (const [componentId, balance] of Object.entries(remainingByComponent)) {
        if (!(componentId in afterByComponent)) afterByComponent[componentId] = balance;
      }
      const stillOwed = Object.entries(afterByComponent).filter(([, balance]) => balance !== 0);
      if (stillOwed.length > 0) {
        violate(
          `payoff_concession "${event.id}"'s deltas do not exactly zero the actual remaining balance -- computed nonzero balance on: ${stillOwed.map(([id]) => id).join(", ")}.`,
        );
      }
      cumulativePrincipalForgivenCents += Object.values(event.deltaCentsByComponentCents).reduce((sum, delta) => sum - delta, 0);
      for (const componentId of Object.keys(remainingByComponent)) remainingByComponent[componentId] = 0;
    } else if (event.eventType === PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED) {
      const totalRemaining = Object.values(remainingByComponent).reduce((sum, balance) => sum + balance, 0);
      const totalUnpaidInterest = Object.values(unpaidAccruedInterestFractionalByComponent).reduce((sum, fractional) => sum + roundToNearestCent(fractional), 0);
      if (totalRemaining !== 0 || totalUnpaidInterest !== 0) {
        violate(
          `account_closed "${event.id}" was posted while a balance remained (principal ${totalRemaining}, unpaid interest ${totalUnpaidInterest}) -- closure requires exactly zero owed.`,
        );
      }
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
    if (closed && Object.values(remainingByComponent).some((balance) => balance > 0)) {
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
  const componentsAtAsOfDate = resolveComponentsAsOf(componentVersions, asOfDate);
  for (const component of componentsAtAsOfDate) {
    if (remainingByComponent[component.componentKey] === undefined) {
      remainingByComponent[component.componentKey] = component.originalPrincipalCents;
      unpaidAccruedInterestFractionalByComponent[component.componentKey] = 0;
    }
    unpaidAccruedInterestFractionalByComponent[component.componentKey] += computeAccrual({
      principalRemainingCents: remainingByComponent[component.componentKey],
      rateBps: component.rateBps,
      fromDate: lastAccrualDate,
      toDate: asOfDate,
    });
  }

  const unpaidAccruedInterestByComponentCents = {};
  for (const [componentId, fractional] of Object.entries(unpaidAccruedInterestFractionalByComponent)) {
    unpaidAccruedInterestByComponentCents[componentId] = roundToNearestCent(fractional);
  }
  const totalPrincipalRemainingCents = Object.values(remainingByComponent).reduce((sum, balance) => sum + balance, 0);
  const unpaidAccruedInterestCents = Object.values(unpaidAccruedInterestByComponentCents).reduce((sum, cents) => sum + cents, 0);

  return Object.freeze({
    ownerId: opening.ownerId,
    accountId: opening.accountId,
    asOfDate,
    remainingPrincipalByComponentCents: Object.freeze({ ...remainingByComponent }),
    totalPrincipalRemainingCents,
    unpaidAccruedInterestByComponentCents: Object.freeze(unpaidAccruedInterestByComponentCents),
    unpaidAccruedInterestFractionalByComponentCents: Object.freeze({ ...unpaidAccruedInterestFractionalByComponent }),
    unpaidAccruedInterestCents,
    cumulativeInterestPaidCents,
    cumulativeCashPrincipalPaidCents,
    cumulativePrincipalForgivenCents,
    unappliedCents,
    closed,
    closureReason,
    closingEventId,
    components: Object.freeze(componentsAtAsOfDate),
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
