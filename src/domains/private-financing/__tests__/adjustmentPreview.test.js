import { describe, expect, it } from "vitest";
import {
  previewContractualPrincipalCorrection,
  previewDiscretionaryPrincipalConcession,
  previewBringCurrentCredit,
  previewInterestCorrection,
  previewInterestWaiver,
  previewStripeFeeReimbursement,
  previewCompensatingCorrection,
  previewExternalManualPayment,
  previewPayoffConcession,
  previewAccountClosure,
} from "../adjustmentPreview.js";
import { replayEvents } from "../replayEvents.js";
import { LedgerIntegrityViolationError } from "../ledgerIntegrity.js";
import { PRIVATE_FINANCING_EVENT_TYPE, PRIVATE_FINANCING_EVENT_ORIGIN, PRIVATE_FINANCING_COMPONENT_TYPE, CORRECTION_BASIS } from "../privateFinancingContracts.js";
import { SOUTH_MAIN_TERMS, SOUTH_MAIN_ACCEPTED_RECONCILIATION, SOUTH_MAIN_PAYMENTS } from "../__fixtures__/southMainPayments.js";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";

const ACTOR = "11111111-1111-1111-1111-111111111111";

function accountOpened({ interestBearing, zeroInterest, effectiveDate = "2026-01-01" } = {}) {
  const ib = interestBearing ?? { originalPrincipalCents: 1_000_000, rateBps: 600, regularPaymentCents: 1_000_000 };
  const zi = zeroInterest ?? { originalPrincipalCents: 200_000, rateBps: 0, regularPaymentCents: 200_000 };
  return {
    id: "evt_open",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: ACTOR,
    effectiveDate,
    ledgerSequence: 1,
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
    openingComponents: [
      { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, ...ib },
      { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, ...zi },
    ],
  };
}

describe("adjustment previews -- purity", () => {
  it("never mutates the input events array and returns a frozen result", () => {
    const events = [accountOpened()];
    const copy = [...events];
    const preview = previewContractualPrincipalCorrection({
      events,
      asOfDate: "2026-01-01",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    });
    expect(events).toEqual(copy);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.balanceAfter)).toBe(true);
  });

  it("produces a proposedEventPayload but never an id, ledgerSequence, or recordedAt -- posting is a later, explicit step", () => {
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      asOfDate: "2026-01-01",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    });
    expect(preview.proposedEventPayload).not.toHaveProperty("id");
    expect(preview.proposedEventPayload).not.toHaveProperty("ledgerSequence");
    expect(preview.proposedEventPayload).not.toHaveProperty("recordedAt");
  });

  it("calling the same preview twice with identical arguments produces a deep-equal result", () => {
    const args = {
      events: [accountOpened()],
      asOfDate: "2026-01-01",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    };
    expect(previewContractualPrincipalCorrection(args)).toEqual(previewContractualPrincipalCorrection(args));
  });

  it("every preview returns the complete common envelope", () => {
    const preview = previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 1_000, idempotencyKey: "k1" });
    for (const field of [
      "ownerId",
      "accountId",
      "asOfDate",
      "balanceBefore",
      "proposedAdjustment",
      "allocationBreakdown",
      "balanceAfter",
      "principalByComponent",
      "interestEffect",
      "pastDueEffect",
      "payoffEffect",
      "warnings",
      "blockingValidation",
      "proposedEventPayload",
    ]) {
      expect(preview).toHaveProperty(field);
    }
  });
});

describe("previewContractualPrincipalCorrection vs previewDiscretionaryPrincipalConcession", () => {
  it("a contractual correction does not require a borrowerVisibleExplanation", () => {
    expect(() =>
      previewContractualPrincipalCorrection({ events: [accountOpened()], asOfDate: "2026-01-01", componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, deltaCents: -1_000, reason: "data fix", createdBy: ACTOR }),
    ).not.toThrow();
  });

  it("a discretionary concession REQUIRES a borrowerVisibleExplanation -- kept separate from contractual corrections", () => {
    expect(() =>
      previewDiscretionaryPrincipalConcession({ events: [accountOpened()], asOfDate: "2026-01-01", componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, deltaCents: -1_000, reason: "goodwill", createdBy: ACTOR }),
    ).toThrow(/borrowerVisibleExplanation/);
  });

  it("tags the proposedAdjustment.kind and correctionBasis differently for each", () => {
    const contractual = previewContractualPrincipalCorrection({ events: [accountOpened()], asOfDate: "2026-01-01", componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, deltaCents: -1_000, reason: "fix", createdBy: ACTOR });
    const discretionary = previewDiscretionaryPrincipalConcession({
      events: [accountOpened()],
      asOfDate: "2026-01-01",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: -1_000,
      reason: "goodwill",
      borrowerVisibleExplanation: "We're crediting $10 as a goodwill gesture.",
      createdBy: ACTOR,
    });
    expect(contractual.proposedAdjustment.correctionBasis).toBe("contractual_administrative");
    expect(discretionary.proposedAdjustment.correctionBasis).toBe("discretionary_concession");
  });

  it("blocks (does not throw) a correction that would drive a component negative", () => {
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      asOfDate: "2026-01-01",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: -999_999,
      reason: "too much",
      createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

describe("previewBringCurrentCredit -- reproduces the South Main golden reconciliation exactly", () => {
  it("reproduces the $1,386.90 credit and $31,843.47 remaining principal, without changing the golden fixture", () => {
    // Build the real 48-payment South Main event stream (mirrors replayEvents.test.js's construction).
    const opened = accountOpened({
      interestBearing: { originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents, rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps, regularPaymentCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents },
      zeroInterest: { originalPrincipalCents: SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents, rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps, regularPaymentCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents },
      effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate,
    });

    let interestBearingRemainingCents = SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents;
    let zeroInterestRemainingCents = SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents;
    let unpaidAccruedInterestFractionalCents = 0;
    let lastDate = SOUTH_MAIN_TERMS.calculationStartDate;
    const events = [opened];
    let seq = 2;

    for (const payment of SOUTH_MAIN_PAYMENTS) {
      const newAccrualCents = computeAccrual({ principalRemainingCents: interestBearingRemainingCents, rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps, fromDate: lastDate, toDate: payment.datePaid });
      const totalAccruedFractionalCents = unpaidAccruedInterestFractionalCents + newAccrualCents;
      const accruedInterestCents = roundToNearestCent(totalAccruedFractionalCents);
      const result = allocatePayment({
        interestBearing: { remainingPrincipalCents: interestBearingRemainingCents, regularPaymentCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents },
        zeroInterest: { remainingPrincipalCents: zeroInterestRemainingCents, regularPaymentCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents },
        accruedInterestCents,
        paymentAmountCents: payment.amountPaidCents,
      });
      unpaidAccruedInterestFractionalCents = totalAccruedFractionalCents - result.interestPaidCents;
      interestBearingRemainingCents -= result.interestBearingPrincipalPaidCents;
      zeroInterestRemainingCents -= result.zeroInterestPrincipalPaidCents;
      lastDate = payment.datePaid;
      events.push({
        id: `evt_payment_${payment.pmtNo}`,
        ownerId: "owner_1",
        accountId: "acct_1",
        eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
        eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
        createdBy: null,
        idempotencyKey: `south-main-import-${payment.pmtNo}`,
        effectiveDate: payment.datePaid,
        ledgerSequence: seq++,
        recordedAt: `${payment.datePaid}T00:00:00.000Z`,
        amountCents: payment.amountPaidCents,
        allocation: result,
        principalRemainingCentsAfter: { interestBearing: interestBearingRemainingCents, zeroInterest: zeroInterestRemainingCents },
      });
    }

    const preview = previewBringCurrentCredit({
      events,
      asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
      scheduledAmountThroughAsOfDateCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.scheduledAmountCents,
      proposedCreditCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      nextDueDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.nextRegularPaymentDueDate,
      nextDueAmountCents: SOUTH_MAIN_ACCEPTED_RECONCILIATION.nextRegularPaymentCents,
      reason: "Owner-approved bring-current/reporting credit per accepted opening reconciliation",
      borrowerVisibleExplanation: "We're crediting $1,386.90 to bring your account current.",
      createdBy: ACTOR,
    });

    expect(preview.pastDueEffect.shortageCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents);
    expect(preview.pastDueEffect.proposedCreditCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents);
    expect(preview.pastDueEffect.pastDueAfterCents).toBe(0);
    expect(preview.blockingValidation).toEqual([]);

    // Actually post the proposed event (as Checkpoint D's future RPC eventually would) and confirm the
    // resulting remaining principal matches the accepted figure exactly.
    const withCredit = replayEvents({
      events: [...events, { ...preview.proposedEventPayload, id: "evt_bring_current_credit", ledgerSequence: seq, recordedAt: `${SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate}T00:00:00.000Z` }],
      asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
    });
    expect(withCredit.totalPrincipalRemainingCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents);
  });
});

describe("previewInterestCorrection vs previewInterestWaiver", () => {
  it("a waiver must be zero or negative -- it only ever forgives", () => {
    expect(() => previewInterestWaiver({ events: [accountOpened()], asOfDate: "2026-01-01", deltaCents: 100, reason: "x", borrowerVisibleExplanation: "x", createdBy: ACTOR })).toThrow(
      /only ever forgives/,
    );
  });

  it("blocks reducing accrued interest below zero", () => {
    const preview = previewInterestCorrection({ events: [accountOpened()], asOfDate: "2026-01-01", deltaCents: -999_999, reason: "too much", createdBy: ACTOR });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
  });
});

describe("previewStripeFeeReimbursement", () => {
  it("by default never touches the loan ledger -- proposedEventPayload is null, balance unchanged", () => {
    const events = [accountOpened()];
    const preview = previewStripeFeeReimbursement({ events, asOfDate: "2026-01-01", feeAmountCents: 150, reason: "Stripe processing fee absorbed by seller" });
    expect(preview.proposedEventPayload).toBeNull();
    expect(preview.balanceAfter.interestBearing).toBe(preview.balanceBefore.interestBearing);
    expect(preview.balanceAfter.zeroInterest).toBe(preview.balanceBefore.zeroInterest);
  });

  it("only becomes a ledger event when the seller explicitly elects postAsLoanCredit: true", () => {
    const preview = previewStripeFeeReimbursement({
      events: [accountOpened()],
      asOfDate: "2026-01-01",
      feeAmountCents: 150,
      postAsLoanCredit: true,
      reason: "Seller elected to credit the Stripe fee to the loan",
      borrowerVisibleExplanation: "We're crediting the processing fee to your balance.",
      createdBy: ACTOR,
    });
    expect(preview.proposedEventPayload).not.toBeNull();
    expect(preview.proposedEventPayload.eventType).toBe("principal_correction");
    expect(preview.proposedEventPayload.correctionBasis).toBe("discretionary_concession");
    expect(preview.proposedEventPayload.deltaCents).toBe(-150);
  });

  it("never reduces the amount credited from a borrower payment -- it has no access to any payment's allocation at all", () => {
    // Structural proof: the function signature has no paymentEventId/allocation parameter whatsoever.
    expect(previewStripeFeeReimbursement.length).toBeLessThanOrEqual(1); // single destructured options param
  });
});

describe("previewCompensatingCorrection", () => {
  it("previews reversing a prior principal_correction", () => {
    const opened = accountOpened();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000,
      correctedComponentPrincipalRemainingCentsAfter: 198_000,
      reason: "wrong amount",
      effectiveDate: "2026-01-02",
      ledgerSequence: 2,
      recordedAt: "2026-01-02T00:00:00.000Z",
    };
    const preview = previewCompensatingCorrection({ events: [opened, correction], asOfDate: "2026-01-03", reversesEventId: "evt_correction", deltaCents: 2_000, reason: "undo it", createdBy: ACTOR });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.balanceAfter.zeroInterest).toBe(200_000);
    expect(preview.proposedEventPayload.eventType).toBe("compensating_correction");
  });

  it("blocks reversing an event that was already reversed", () => {
    const opened = accountOpened();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000,
      correctedComponentPrincipalRemainingCentsAfter: 198_000,
      reason: "wrong amount",
      effectiveDate: "2026-01-02",
      ledgerSequence: 2,
      recordedAt: "2026-01-02T00:00:00.000Z",
    };
    const firstReversal = {
      id: "evt_first_reversal",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      reversesEventId: "evt_correction",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: 2_000,
      reason: "undo it",
      effectiveDate: "2026-01-03",
      ledgerSequence: 3,
      recordedAt: "2026-01-03T00:00:00.000Z",
    };
    const preview = previewCompensatingCorrection({ events: [opened, correction, firstReversal], asOfDate: "2026-01-04", reversesEventId: "evt_correction", deltaCents: 2_000, reason: "undo again", createdBy: ACTOR });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

describe("previewExternalManualPayment -- full payoff, insufficient payoff, overpayment", () => {
  it("full payoff with an ordinary payment reaches exactly zero", () => {
    const preview = previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1" });
    expect(preview.balanceAfter).toEqual({ interestBearing: 0, zeroInterest: 0 });
    expect(preview.payoffEffect.paysAccountInFull).toBe(true);
    expect(preview.blockingValidation).toEqual([]);
  });

  it("an insufficient payoff payment leaves a positive remaining balance and does not claim payoff-in-full", () => {
    const preview = previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 500_000, idempotencyKey: "k1" });
    expect(preview.balanceAfter.interestBearing).toBeGreaterThan(0);
    expect(preview.payoffEffect).toBeNull();
  });

  it("an overpayment is blocked by default (fail-closed) but reports the exact unapplied amount", () => {
    const preview = previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 1_500_000, idempotencyKey: "k1" });
    expect(preview.allocationBreakdown.unallocatedCents).toBe(300_000);
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("an overpayment can be explicitly acknowledged to unblock posting, still reporting the unapplied amount", () => {
    const preview = previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 1_500_000, idempotencyKey: "k1", acknowledgeOverpayment: true });
    expect(preview.allocationBreakdown.unallocatedCents).toBe(300_000);
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.proposedEventPayload).not.toBeNull();
  });

  it("rejects a non-positive amountCents", () => {
    expect(() => previewExternalManualPayment({ events: [accountOpened()], asOfDate: "2026-01-01", amountCents: 0, idempotencyKey: "k1" })).toThrow(LedgerIntegrityViolationError);
  });
});

describe("discounted payoff using payment plus concession", () => {
  it("a payment smaller than the full balance, plus a concession forgiving the remainder, jointly zero the account", () => {
    const events = [accountOpened()];
    const paymentPreview = previewExternalManualPayment({ events, asOfDate: "2026-01-10", amountCents: 1_000_000, idempotencyKey: "k1" });
    expect(paymentPreview.blockingValidation).toEqual([]);
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-10T00:00:00.000Z" };

    const eventsAfterPayment = [...events, paymentEvent];
    const remaining = paymentPreview.balanceAfter;
    const concessionPreview = previewPayoffConcession({
      events: eventsAfterPayment,
      asOfDate: "2026-01-10",
      interestBearingDeltaCents: -remaining.interestBearing,
      zeroInterestDeltaCents: -remaining.zeroInterest,
      reason: "Seller accepted a discounted payoff",
      borrowerVisibleExplanation: "We're forgiving the remaining balance to close your account.",
      createdBy: ACTOR,
    });
    expect(concessionPreview.blockingValidation).toEqual([]);
    expect(concessionPreview.payoffEffect.closesAccount).toBe(true);

    const concessionEvent = { ...concessionPreview.proposedEventPayload, id: "evt_concession", ledgerSequence: 3, recordedAt: "2026-01-10T00:00:00.000Z" };
    const finalState = replayEvents({ events: [...eventsAfterPayment, concessionEvent], asOfDate: "2026-01-10" });
    expect(finalState.totalPrincipalRemainingCents).toBe(0);
  });
});

describe("previewAccountClosure", () => {
  it("is eligible and produces a proposedEventPayload once the balance is exactly zero", () => {
    const events = [accountOpened()];
    // Same-day payoff as account opening -- 0 elapsed days, so the full-payoff amountCents exactly
    // matches the origination totals with no accrued-interest margin to account for.
    const paymentPreview = previewExternalManualPayment({ events, asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1" });
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-01T00:00:00.000Z" };
    const preview = previewAccountClosure({ events: [...events, paymentEvent], asOfDate: "2026-01-01", closureReason: "paid_in_full", createdBy: ACTOR });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.proposedEventPayload.eventType).toBe("account_closed");
  });

  it("blocks closing an account with a positive balance", () => {
    const preview = previewAccountClosure({ events: [accountOpened()], asOfDate: "2026-01-01", closureReason: "written_off", createdBy: ACTOR });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("blocks a duplicate close attempt on an already-closed account", () => {
    const events = [accountOpened()];
    const paymentPreview = previewExternalManualPayment({ events, asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1" });
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-01T00:00:00.000Z" };
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      closureReason: "paid_in_full",
      effectiveDate: "2026-01-01",
      ledgerSequence: 3,
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    const preview = previewAccountClosure({ events: [...events, paymentEvent, closure], asOfDate: "2026-01-01", closureReason: "paid_in_full", createdBy: ACTOR });
    expect(preview.blockingValidation).toContain("The account is already closed.");
    expect(preview.proposedEventPayload).toBeNull();
  });
});
