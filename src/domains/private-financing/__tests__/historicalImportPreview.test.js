import { describe, expect, it } from "vitest";
import { buildHistoricalPrivateFinancingImportPreview } from "../historicalImportPreview.js";
import {
  SOUTH_MAIN_ACCEPTED_RECONCILIATION,
  SOUTH_MAIN_PAYMENTS,
  SOUTH_MAIN_TERMS,
} from "../__fixtures__/southMainPayments.js";

function southMainInput() {
  return {
    calculationStartDate: SOUTH_MAIN_TERMS.calculationStartDate,
    asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
    components: [
      {
        componentId: "interest-bearing",
        originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
        rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
        scheduledComponentAmountCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents,
        allocationPriority: 1,
      },
      {
        componentId: "financed-down-payment",
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
  };
}

describe("buildHistoricalPrivateFinancingImportPreview", () => {
  it("reproduces the accepted South Main reconciliation without writing anything", () => {
    const preview = buildHistoricalPrivateFinancingImportPreview(southMainInput());

    expect(preview.status).toBe("preview_only");
    expect(preview.paymentCount).toBe(48);
    expect(preview.totalCashCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.actualCashCents);
    expect(preview.totalInterestPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.interestPaidCents);
    expect(preview.totalCashAppliedToPrincipalCents).toBe(
      SOUTH_MAIN_ACCEPTED_RECONCILIATION.cashAppliedToPrincipalCents,
    );
    expect(preview.totalUnallocatedCents).toBe(0);
    expect(preview.principalBeforeCreditsCents).toBe(
      SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents +
        SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
    );
    expect(preview.totalPrincipalCreditCents).toBe(
      SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
    );
    expect(preview.principalAfterCreditsCents).toBe(
      SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents,
    );
    expect(preview.paymentPreviews).toHaveLength(48);
    expect(preview.creditPreviews).toEqual([
      expect.objectContaining({
        componentId: "interest-bearing",
        amountCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      }),
    ]);
  });

  it("preserves same-day payments in source order with unique durable references", () => {
    const preview = buildHistoricalPrivateFinancingImportPreview(southMainInput());
    const sameDay = preview.paymentPreviews.filter((payment) => payment.effectiveDate === "2025-03-08");

    expect(sameDay.map((payment) => payment.sourceReference)).toEqual([
      "south-main-workbook-payment-33",
      "south-main-workbook-payment-34",
      "south-main-workbook-payment-35",
      "south-main-workbook-payment-36",
    ]);
  });

  it("fails closed on duplicate source references", () => {
    const input = southMainInput();
    input.payments[1] = { ...input.payments[1], sourceReference: input.payments[0].sourceReference };

    expect(() => buildHistoricalPrivateFinancingImportPreview(input)).toThrow(/Duplicate sourceReference/);
  });

  it("fails closed when a proposed credit exceeds its component balance", () => {
    const input = southMainInput();
    input.proposedPrincipalCredits[0] = {
      ...input.proposedPrincipalCredits[0],
      amountCents: 9_999_999,
    };

    expect(() => buildHistoricalPrivateFinancingImportPreview(input)).toThrow(/exceeds remaining/);
  });

  it("does not mutate the supplied payment history", () => {
    const input = southMainInput();
    const before = structuredClone(input);

    buildHistoricalPrivateFinancingImportPreview(input);

    expect(input).toEqual(before);
  });
});
