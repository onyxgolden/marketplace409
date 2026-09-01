import { roundToNearestCent } from "./currencyMath.js";
import { addCalendarMonthsClamped } from "./dueState.js";
import { computeAccrual } from "./interestAccrual.js";
import { allocatePayment, UnsupportedAllocationPolicyError } from "./paymentAllocation.js";

const MAX_PROJECTED_PAYMENTS = 1200;

export class UnsupportedBorrowerProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedBorrowerProjectionError";
  }
}

function total(values) {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

export function projectBorrowerPayoff({ snapshot, accountTerms, paymentAmountCents, firstProjectedPaymentDate }) {
  if (!Number.isInteger(paymentAmountCents) || paymentAmountCents <= 0) {
    throw new UnsupportedBorrowerProjectionError("The projected monthly payment must be a positive whole-cent amount.");
  }
  if (accountTerms.paymentFrequency !== "monthly") {
    throw new UnsupportedBorrowerProjectionError("The payoff simulator currently supports monthly payment schedules only.");
  }
  if (!firstProjectedPaymentDate || firstProjectedPaymentDate < snapshot.asOfDate) {
    throw new UnsupportedBorrowerProjectionError("The first projected payment date must be on or after the balance date.");
  }

  const principal = { ...snapshot.remainingPrincipalByComponentCents };
  const accruedFractional = { ...snapshot.unpaidAccruedInterestFractionalByComponentCents };
  const components = snapshot.components.map((component) => ({
    componentId: component.componentKey,
    scheduledComponentAmountCents: component.scheduledComponentAmountCents,
    rateBps: component.rateBps,
    allocationPriority: component.allocationPriority,
  }));
  let lastAccrualDate = snapshot.asOfDate;
  let projectedInterestCents = 0;
  let projectedPaymentTotalCents = 0;
  const balanceSeries = [{ paymentNumber: 0, date: snapshot.asOfDate, principalRemainingCents: total(principal) }];

  for (let paymentNumber = 1; paymentNumber <= MAX_PROJECTED_PAYMENTS; paymentNumber += 1) {
    const paymentDate = addCalendarMonthsClamped(firstProjectedPaymentDate, paymentNumber - 1);
    for (const component of components) {
      accruedFractional[component.componentId] = (accruedFractional[component.componentId] ?? 0) + computeAccrual({
        principalRemainingCents: principal[component.componentId] ?? 0,
        rateBps: component.rateBps,
        fromDate: lastAccrualDate,
        toDate: paymentDate,
      });
    }
    lastAccrualDate = paymentDate;

    const accruedInterestCentsByComponent = Object.fromEntries(
      components.map((component) => [component.componentId, roundToNearestCent(accruedFractional[component.componentId] ?? 0)]),
    );
    let allocation;
    try {
      allocation = allocatePayment({
        components: components.map((component) => ({
          ...component,
          remainingPrincipalCents: principal[component.componentId] ?? 0,
        })),
        accruedInterestCentsByComponent,
        paymentAmountCents,
        allocationPolicy: accountTerms.allocationPolicy,
        extraPaymentAllocationPolicy: accountTerms.extraPaymentAllocationPolicy,
      });
    } catch (error) {
      if (error instanceof UnsupportedAllocationPolicyError) {
        throw new UnsupportedBorrowerProjectionError(error.message);
      }
      throw error;
    }

    const interestPaid = total(allocation.interestPaidByComponentCents);
    const principalPaid = total(allocation.principalPaidByComponentCents);
    for (const component of components) {
      const key = component.componentId;
      accruedFractional[key] -= allocation.interestPaidByComponentCents[key] ?? 0;
      principal[key] -= allocation.principalPaidByComponentCents[key] ?? 0;
    }
    projectedInterestCents += interestPaid;
    projectedPaymentTotalCents += interestPaid + principalPaid;

    const principalRemainingCents = total(principal);
    if (paymentNumber % 6 === 0 || principalRemainingCents === 0) {
      balanceSeries.push({ paymentNumber, date: paymentDate, principalRemainingCents });
    }
    if (principalRemainingCents === 0 && total(Object.fromEntries(
      Object.entries(accruedFractional).map(([key, value]) => [key, roundToNearestCent(value)]),
    )) === 0) {
      return Object.freeze({
        paymentAmountCents,
        paymentCount: paymentNumber,
        payoffDate: paymentDate,
        projectedFutureInterestCents: projectedInterestCents,
        projectedPaymentTotalCents,
        balanceSeries: Object.freeze(balanceSeries.map((point) => Object.freeze({ ...point }))),
      });
    }

    if (principalPaid === 0 && paymentNumber >= 12) {
      throw new UnsupportedBorrowerProjectionError("This payment amount does not reduce principal under the account's current terms.");
    }
  }

  throw new UnsupportedBorrowerProjectionError("The projected payoff exceeds the simulator's 100-year safety limit.");
}

export function compareBorrowerPayoffScenarios(baseline, scenario) {
  return Object.freeze({
    paymentsSaved: Math.max(baseline.paymentCount - scenario.paymentCount, 0),
    interestSavedCents: Math.max(baseline.projectedFutureInterestCents - scenario.projectedFutureInterestCents, 0),
  });
}
