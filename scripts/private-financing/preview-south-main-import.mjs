import {
  SOUTH_MAIN_ACCEPTED_RECONCILIATION,
  SOUTH_MAIN_PAYMENTS,
  SOUTH_MAIN_TERMS,
} from "../../src/domains/private-financing/__fixtures__/southMainPayments.js";
import { buildHistoricalPrivateFinancingImportPreview } from "../../src/domains/private-financing/historicalImportPreview.js";

const preview = buildHistoricalPrivateFinancingImportPreview({
  calculationStartDate: SOUTH_MAIN_TERMS.calculationStartDate,
  asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
  components: [
    {
      componentId: "interest-bearing",
      label: "Interest-bearing note",
      originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
      rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
      scheduledComponentAmountCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents,
      allocationPriority: 1,
    },
    {
      componentId: "financed-down-payment",
      label: "Financed down payment",
      originalPrincipalCents: SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents,
      rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps,
      scheduledComponentAmountCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents,
      allocationPriority: 2,
    },
  ],
  payments: SOUTH_MAIN_PAYMENTS.map((payment) => ({
    sourceReference: `south-main-workbook-payment-${payment.pmtNo}`,
    effectiveDate: payment.datePaid,
    amountCents: payment.amountPaidCents,
  })),
  proposedPrincipalCredits: [
    {
      componentId: "interest-bearing",
      amountCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      reason: "Owner-approved one-time bring-current/reporting credit",
    },
  ],
});

function dollars(cents) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const summary = {
  status: preview.status,
  calculationStartDate: preview.calculationStartDate,
  asOfDate: preview.asOfDate,
  paymentCount: preview.paymentCount,
  actualCashReceived: dollars(preview.totalCashCents),
  interestPaid: dollars(preview.totalInterestPaidCents),
  cashAppliedToPrincipal: dollars(preview.totalCashAppliedToPrincipalCents),
  unallocatedCash: dollars(preview.totalUnallocatedCents),
  principalBeforeCredit: dollars(preview.principalBeforeCreditsCents),
  proposedOneTimeCredit: dollars(preview.totalPrincipalCreditCents),
  correctedPrincipalRemaining: dollars(preview.principalAfterCreditsCents),
  nextRegularPayment: dollars(SOUTH_MAIN_ACCEPTED_RECONCILIATION.nextRegularPaymentCents),
  nextRegularPaymentDueDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.nextRegularPaymentDueDate,
  pastDueAfterProposedCredit: dollars(SOUTH_MAIN_ACCEPTED_RECONCILIATION.pastDueAfterCreditCents),
};

console.log("FORGE Private Financing — South Main import preview");
console.log("READ-ONLY: no account, payment, credit, or borrower record was written.\n");
console.table(summary);
console.log("\nPayment allocations");
console.table(
  preview.paymentPreviews.map((payment) => ({
    row: payment.rowNumber,
    reference: payment.sourceReference,
    date: payment.effectiveDate,
    amount: dollars(payment.amountCents),
    interest: dollars(
      Object.values(payment.interestPaidByComponentCents).reduce((sum, value) => sum + value, 0),
    ),
    principal: dollars(
      Object.values(payment.principalPaidByComponentCents).reduce((sum, value) => sum + value, 0),
    ),
    remaining: dollars(
      Object.values(payment.principalRemainingByComponentCents).reduce((sum, value) => sum + value, 0),
    ),
  })),
);
console.log("\nProposed seller credit");
console.table(
  preview.creditPreviews.map((credit) => ({
    component: credit.componentId,
    reason: credit.reason,
    credit: dollars(credit.amountCents),
    componentBefore: dollars(credit.principalBeforeCents),
    componentAfter: dollars(credit.principalAfterCents),
  })),
);
console.log("\nApproval boundary: this report is evidence only. A separate explicit owner approval is required before any Production import.");
