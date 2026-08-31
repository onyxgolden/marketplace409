import {
  SOUTH_MAIN_ACCEPTED_RECONCILIATION,
  SOUTH_MAIN_PAYMENTS,
  SOUTH_MAIN_TERMS,
} from "../../src/domains/private-financing/__fixtures__/southMainPayments.js";
import { buildHistoricalPrivateFinancingImportPreview } from "../../src/domains/private-financing/historicalImportPreview.js";
import { writeFile } from "node:fs/promises";

const plan = {
  sourceKey: "south-main-owner-approved-through-2026-08-23-v1",
  calculationStartDate: SOUTH_MAIN_TERMS.calculationStartDate,
  asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
  account: {
    product: "seller_financing",
    openedDate: SOUTH_MAIN_TERMS.calculationStartDate,
    lateFeePolicy: "disabled",
    platformFeeCents: 0,
    feePayer: "lender",
    paymentAcceptancePolicy: "partial_allowed",
    paymentFrequency: "monthly",
    firstPaymentDueDate: SOUTH_MAIN_TERMS.calculationStartDate,
    regularScheduledPaymentAmountCents: SOUTH_MAIN_TERMS.regularCombinedPaymentCents,
    allocationPolicy: "scheduled_component_order",
    extraPaymentAllocationPolicy: "highest_rate_first_extra",
    prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date",
    dayCountConvention: "actual_365",
    components: [
      {
      componentKey: "interest-bearing",
      label: "Interest-bearing note",
      originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
      rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
      scheduledComponentAmountCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents,
      allocationPriority: 1,
      dayCountConvention: "actual_365",
      },
      {
      componentKey: "financed-down-payment",
      label: "Financed down payment",
      originalPrincipalCents: SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents,
      rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps,
      scheduledComponentAmountCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents,
      allocationPriority: 2,
      dayCountConvention: "actual_365",
      },
    ],
  },
  payments: SOUTH_MAIN_PAYMENTS.map((payment) => ({
    sourceReference: `south-main-workbook-payment-${payment.pmtNo}`,
    effectiveDate: payment.datePaid,
    amountCents: payment.amountPaidCents,
  })),
  proposedPrincipalCredits: [
    {
      componentId: "interest-bearing",
      amountCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      effectiveDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
      sourceReference: "south-main-owner-approved-bring-current-credit-2026-08-23",
      correctionBasis: "discretionary_concession",
      reason: "Owner-approved one-time bring-current/reporting credit",
      borrowerVisibleExplanation: "One-time seller credit applied to bring the historical account current for reporting.",
    },
  ],
};

const preview = buildHistoricalPrivateFinancingImportPreview({
  calculationStartDate: plan.calculationStartDate,
  asOfDate: plan.asOfDate,
  components: plan.account.components.map((component) => ({ ...component, componentId: component.componentKey })),
  payments: plan.payments,
  proposedPrincipalCredits: plan.proposedPrincipalCredits,
  allocationPolicy: plan.account.allocationPolicy,
  extraPaymentAllocationPolicy: plan.account.extraPaymentAllocationPolicy,
});

const jsonOutputIndex = process.argv.indexOf("--json");
if (jsonOutputIndex !== -1) {
  const outputPath = process.argv[jsonOutputIndex + 1];
  if (!outputPath) throw new Error("--json requires an output path");
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote ${outputPath}`);
  process.exit(0);
}

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
