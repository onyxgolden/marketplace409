import { roundToNearestCent } from "./currencyMath.js";
import { computeAccrual } from "./interestAccrual.js";
import { allocatePayment } from "./paymentAllocation.js";

function requireDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be an ISO date (YYYY-MM-DD)`);
  }
}

function requirePositiveCents(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer number of cents`);
  }
}

function requireComponent(component) {
  if (!component || typeof component.componentId !== "string" || component.componentId.trim() === "") {
    throw new TypeError("Every component requires a non-empty componentId");
  }
  requirePositiveCents(component.originalPrincipalCents, `${component.componentId}.originalPrincipalCents`);
  if (!Number.isSafeInteger(component.rateBps) || component.rateBps < 0) {
    throw new TypeError(`${component.componentId}.rateBps must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(component.scheduledComponentAmountCents) || component.scheduledComponentAmountCents < 0) {
    throw new TypeError(`${component.componentId}.scheduledComponentAmountCents must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(component.allocationPriority)) {
    throw new TypeError(`${component.componentId}.allocationPriority must be a safe integer`);
  }
}

export function buildHistoricalPrivateFinancingImportPreview({
  calculationStartDate,
  asOfDate,
  components,
  payments,
  proposedPrincipalCredits = [],
  allocationPolicy = "scheduled_component_order",
  extraPaymentAllocationPolicy = "highest_rate_first_extra",
}) {
  requireDate(calculationStartDate, "calculationStartDate");
  requireDate(asOfDate, "asOfDate");
  if (calculationStartDate > asOfDate) throw new RangeError("calculationStartDate must not follow asOfDate");
  if (!Array.isArray(components) || components.length === 0) throw new TypeError("components must be a non-empty array");
  if (!Array.isArray(payments)) throw new TypeError("payments must be an array");
  if (!Array.isArray(proposedPrincipalCredits)) throw new TypeError("proposedPrincipalCredits must be an array");

  const componentById = new Map();
  const remainingByComponentCents = {};
  const unpaidAccruedFractionalCentsByComponent = {};
  for (const component of components) {
    requireComponent(component);
    if (componentById.has(component.componentId)) throw new RangeError(`Duplicate componentId: ${component.componentId}`);
    componentById.set(component.componentId, { ...component });
    remainingByComponentCents[component.componentId] = component.originalPrincipalCents;
    unpaidAccruedFractionalCentsByComponent[component.componentId] = 0;
  }

  const orderedPayments = payments.map((payment, index) => {
    requireDate(payment.effectiveDate, `payments[${index}].effectiveDate`);
    requirePositiveCents(payment.amountCents, `payments[${index}].amountCents`);
    if (payment.effectiveDate < calculationStartDate || payment.effectiveDate > asOfDate) {
      throw new RangeError(`payments[${index}].effectiveDate is outside the preview period`);
    }
    if (typeof payment.sourceReference !== "string" || payment.sourceReference.trim() === "") {
      throw new TypeError(`payments[${index}].sourceReference is required`);
    }
    return { ...payment, inputIndex: index };
  }).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.inputIndex - b.inputIndex);

  const seenReferences = new Set();
  let lastAccrualDate = calculationStartDate;
  let totalCashCents = 0;
  let totalInterestPaidCents = 0;
  let totalPrincipalPaidCents = 0;
  let totalUnallocatedCents = 0;

  const paymentPreviews = orderedPayments.map((payment, index) => {
    if (seenReferences.has(payment.sourceReference)) {
      throw new RangeError(`Duplicate sourceReference: ${payment.sourceReference}`);
    }
    seenReferences.add(payment.sourceReference);

    const accruedInterestCentsByComponent = {};
    for (const component of components) {
      const id = component.componentId;
      const newlyAccrued = computeAccrual({
        principalRemainingCents: remainingByComponentCents[id],
        rateBps: component.rateBps,
        fromDate: lastAccrualDate,
        toDate: payment.effectiveDate,
      });
      const totalFractional = unpaidAccruedFractionalCentsByComponent[id] + newlyAccrued;
      accruedInterestCentsByComponent[id] = roundToNearestCent(totalFractional);
      unpaidAccruedFractionalCentsByComponent[id] = totalFractional;
    }

    const allocation = allocatePayment({
      components: components.map((component) => ({
        componentId: component.componentId,
        remainingPrincipalCents: remainingByComponentCents[component.componentId],
        scheduledComponentAmountCents: component.scheduledComponentAmountCents,
        rateBps: component.rateBps,
        allocationPriority: component.allocationPriority,
      })),
      accruedInterestCentsByComponent,
      paymentAmountCents: payment.amountCents,
      allocationPolicy,
      extraPaymentAllocationPolicy,
      selectedExtraComponentId: payment.selectedExtraComponentId ?? null,
    });

    let interestPaidCents = 0;
    let principalPaidCents = 0;
    for (const component of components) {
      const id = component.componentId;
      const interestPaid = allocation.interestPaidByComponentCents[id] || 0;
      const principalPaid = allocation.principalPaidByComponentCents[id] || 0;
      unpaidAccruedFractionalCentsByComponent[id] -= interestPaid;
      remainingByComponentCents[id] -= principalPaid;
      interestPaidCents += interestPaid;
      principalPaidCents += principalPaid;
    }

    totalCashCents += payment.amountCents;
    totalInterestPaidCents += interestPaidCents;
    totalPrincipalPaidCents += principalPaidCents;
    totalUnallocatedCents += allocation.unallocatedCents;
    lastAccrualDate = payment.effectiveDate;

    return Object.freeze({
      rowNumber: index + 1,
      sourceReference: payment.sourceReference,
      effectiveDate: payment.effectiveDate,
      amountCents: payment.amountCents,
      interestPaidByComponentCents: Object.freeze({ ...allocation.interestPaidByComponentCents }),
      principalPaidByComponentCents: Object.freeze({ ...allocation.principalPaidByComponentCents }),
      principalRemainingByComponentCents: Object.freeze({ ...remainingByComponentCents }),
      unallocatedCents: allocation.unallocatedCents,
    });
  });

  const principalBeforeCreditsCents = Object.values(remainingByComponentCents).reduce((sum, value) => sum + value, 0);
  let totalPrincipalCreditCents = 0;
  const creditPreviews = proposedPrincipalCredits.map((credit, index) => {
    const component = componentById.get(credit.componentId);
    if (!component) throw new RangeError(`proposedPrincipalCredits[${index}] references an unknown component`);
    requirePositiveCents(credit.amountCents, `proposedPrincipalCredits[${index}].amountCents`);
    if (credit.amountCents > remainingByComponentCents[credit.componentId]) {
      throw new RangeError(`proposedPrincipalCredits[${index}] exceeds remaining component principal`);
    }
    const beforeCents = remainingByComponentCents[credit.componentId];
    const afterCents = beforeCents - credit.amountCents;
    remainingByComponentCents[credit.componentId] = afterCents;
    totalPrincipalCreditCents += credit.amountCents;
    return Object.freeze({
      componentId: credit.componentId,
      amountCents: credit.amountCents,
      reason: credit.reason ?? null,
      principalBeforeCents: beforeCents,
      principalAfterCents: afterCents,
    });
  });

  return Object.freeze({
    status: "preview_only",
    calculationStartDate,
    asOfDate,
    paymentCount: paymentPreviews.length,
    totalCashCents,
    totalInterestPaidCents,
    totalCashAppliedToPrincipalCents: totalPrincipalPaidCents,
    totalUnallocatedCents,
    principalBeforeCreditsCents,
    totalPrincipalCreditCents,
    principalAfterCreditsCents: Object.values(remainingByComponentCents).reduce((sum, value) => sum + value, 0),
    principalRemainingByComponentCents: Object.freeze({ ...remainingByComponentCents }),
    paymentPreviews: Object.freeze(paymentPreviews),
    creditPreviews: Object.freeze(creditPreviews),
  });
}
