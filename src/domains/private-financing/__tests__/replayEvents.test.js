import { describe, expect, it } from "vitest";
import { replayEvents, evaluateClosureEligibility } from "../replayEvents.js";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";
import {
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  PRIVATE_FINANCING_COMPONENT_TYPE,
  CORRECTION_BASIS,
  ACCOUNT_CLOSURE_REASON,
} from "../privateFinancingContracts.js";
import { LedgerIntegrityViolationError } from "../ledgerIntegrity.js";
import { SOUTH_MAIN_TERMS, SOUTH_MAIN_PAYMENTS, SOUTH_MAIN_ACCEPTED_RECONCILIATION } from "../__fixtures__/southMainPayments.js";

let seq = 0;
function nextSeq() {
  seq += 1;
  return seq;
}

function accountOpened({ ownerId = "owner_1", accountId = "acct_1", effectiveDate, interestBearing, zeroInterest }) {
  return {
    id: `evt_open_${accountId}`,
    ownerId,
    accountId,
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: "11111111-1111-1111-1111-111111111111",
    effectiveDate,
    ledgerSequence: nextSeq(),
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
    // originalPrincipalCents must be positive per the contract -- a component with nothing financed
    // through it is not a component at all, so it is simply omitted rather than included at $0.
    openingComponents: [
      interestBearing.originalPrincipalCents > 0 ? { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, ...interestBearing } : null,
      zeroInterest.originalPrincipalCents > 0 ? { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, ...zeroInterest } : null,
    ].filter(Boolean),
  };
}

function paymentPosted({ ownerId = "owner_1", accountId = "acct_1", id, effectiveDate, amountCents, allocation, principalRemainingCentsAfter }) {
  return {
    id,
    ownerId,
    accountId,
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: "11111111-1111-1111-1111-111111111111",
    effectiveDate,
    ledgerSequence: nextSeq(),
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
    amountCents,
    allocation,
    principalRemainingCentsAfter,
  };
}

// A minimal two-payment test account: $1,000.00 interest-bearing at 10%, no zero-interest component,
// small enough to hand-verify. Builds a correctly-allocated payment_posted event using the SAME
// computeAccrual/allocatePayment primitives replayEvents itself uses internally, so the fixture's stored
// allocation always matches what replay will independently recompute (unless a test deliberately corrupts
// it to test the cross-check).
function smallAccountFixture() {
  seq = 0;
  const opened = accountOpened({
    effectiveDate: "2026-01-01",
    interestBearing: { originalPrincipalCents: 100_000, rateBps: 1000, regularPaymentCents: 10_000 },
    zeroInterest: { originalPrincipalCents: 0, rateBps: 0, regularPaymentCents: 0 },
  });
  const accrual1 = computeAccrual({ principalRemainingCents: 100_000, rateBps: 1000, fromDate: "2026-01-01", toDate: "2026-02-01" });
  const accruedInterestCents1 = roundToNearestCent(accrual1);
  const result1 = allocatePayment({
    interestBearing: { remainingPrincipalCents: 100_000, regularPaymentCents: 10_000 },
    zeroInterest: { remainingPrincipalCents: 0, regularPaymentCents: 0 },
    accruedInterestCents: accruedInterestCents1,
    paymentAmountCents: 10_000,
  });
  const payment1 = paymentPosted({
    id: "evt_payment_1",
    effectiveDate: "2026-02-01",
    amountCents: 10_000,
    allocation: result1,
    principalRemainingCentsAfter: {
      interestBearing: 100_000 - result1.interestBearingPrincipalPaidCents,
      zeroInterest: 0,
    },
  });
  return { opened, payment1, result1, accruedInterestCents1 };
}

describe("replayEvents -- basic reconstruction", () => {
  it("reconstructs opening balances from account_opened alone (no payments yet)", () => {
    const { opened } = smallAccountFixture();
    const result = replayEvents({ events: [opened], asOfDate: "2026-01-01" });
    expect(result.interestBearingRemainingCents).toBe(100_000);
    expect(result.zeroInterestRemainingCents).toBe(0);
    expect(result.cumulativeInterestPaidCents).toBe(0);
    expect(result.closed).toBe(false);
  });

  it("reconstructs state after one payment, matching independently-computed allocation exactly", () => {
    const { opened, payment1, result1 } = smallAccountFixture();
    const result = replayEvents({ events: [opened, payment1], asOfDate: "2026-02-01" });
    expect(result.cumulativeInterestPaidCents).toBe(result1.interestPaidCents);
    expect(result.cumulativeCashPrincipalPaidCents).toBe(result1.interestBearingPrincipalPaidCents);
    expect(result.interestBearingRemainingCents).toBe(100_000 - result1.interestBearingPrincipalPaidCents);
  });

  it("only replays events on or before asOfDate", () => {
    const { opened, payment1 } = smallAccountFixture();
    const result = replayEvents({ events: [opened, payment1], asOfDate: "2026-01-15" }); // before payment1's effectiveDate
    expect(result.interestBearingRemainingCents).toBe(100_000);
    expect(result.cumulativeInterestPaidCents).toBe(0);
  });

  it("requires exactly one account_opened event", () => {
    expect(() => replayEvents({ events: [], asOfDate: "2026-01-01" })).toThrow(/exactly one account_opened/);
  });

  it("is deterministic -- identical inputs produce a deep-equal result on every call", () => {
    const { opened, payment1 } = smallAccountFixture();
    const first = replayEvents({ events: [opened, payment1], asOfDate: "2026-02-01" });
    const second = replayEvents({ events: [opened, payment1], asOfDate: "2026-02-01" });
    expect(second).toEqual(first);
  });

  it("never mutates the input events array", () => {
    const { opened, payment1 } = smallAccountFixture();
    const events = [opened, payment1];
    const copy = [...events];
    replayEvents({ events, asOfDate: "2026-02-01" });
    expect(events).toEqual(copy);
  });

  it("rejects an event whose stored allocation does not match independently recomputed allocation -- ledger corruption detected", () => {
    const { opened, payment1 } = smallAccountFixture();
    // Shift one cent from principal to interest -- the sum still equals amountCents (so it passes the
    // contract-level shape check), but the split no longer matches what replay independently recomputes
    // from the account's real accrued interest, which is exactly what the cross-check must catch.
    const corrupted = {
      ...payment1,
      allocation: {
        ...payment1.allocation,
        interestPaidCents: payment1.allocation.interestPaidCents + 1,
        interestBearingPrincipalPaidCents: payment1.allocation.interestBearingPrincipalPaidCents - 1,
      },
    };
    expect(() => replayEvents({ events: [opened, corrupted], asOfDate: "2026-02-01" })).toThrow(/ledger corruption detected/);
  });

  it("rejects an event referencing more than one reversal of the same target", () => {
    seq = 0;
    const { opened, payment1 } = smallAccountFixture();
    const reversalPayload = {
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      ownerId: "owner_1",
      accountId: "acct_1",
      reversesEventId: "evt_payment_1",
      reason: "test double reversal",
      amountCents: payment1.amountCents,
      allocation: payment1.allocation,
      principalRemainingCentsAfter: { interestBearing: 100_000, zeroInterest: 0 },
    };
    const reversal1 = { ...reversalPayload, id: "evt_reversal_1", effectiveDate: "2026-02-02", ledgerSequence: nextSeq(), recordedAt: "2026-02-02T00:00:00.000Z" };
    const reversal2 = { ...reversalPayload, id: "evt_reversal_2", effectiveDate: "2026-02-03", ledgerSequence: nextSeq(), recordedAt: "2026-02-03T00:00:00.000Z" };
    expect(() => replayEvents({ events: [opened, payment1, reversal1, reversal2], asOfDate: "2026-02-03" })).toThrow(
      /reversed by more than one event/,
    );
  });
});

describe("replayEvents -- overpayment", () => {
  it("an overpayment produces an explicit, non-negative unappliedCents, never dropped and never negative principal", () => {
    seq = 0;
    const opened = accountOpened({
      effectiveDate: "2026-01-01",
      interestBearing: { originalPrincipalCents: 5_000, rateBps: 0, regularPaymentCents: 5_000 },
      zeroInterest: { originalPrincipalCents: 0, rateBps: 0, regularPaymentCents: 0 },
    });
    const accruedInterestCents = 0;
    const overpayResult = allocatePayment({
      interestBearing: { remainingPrincipalCents: 5_000, regularPaymentCents: 5_000 },
      zeroInterest: { remainingPrincipalCents: 0, regularPaymentCents: 0 },
      accruedInterestCents,
      paymentAmountCents: 8_000, // 3,000 more than owed
    });
    const overpayment = paymentPosted({
      id: "evt_overpay",
      effectiveDate: "2026-01-01",
      amountCents: 8_000,
      allocation: overpayResult,
      principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
    });
    const result = replayEvents({ events: [opened, overpayment], asOfDate: "2026-01-01" });
    expect(result.interestBearingRemainingCents).toBe(0); // never negative
    expect(result.unappliedCents).toBe(3_000); // explicitly modeled, never silently dropped
    expect(result.unappliedCents).toBeGreaterThanOrEqual(0);
  });
});

describe("replayEvents -- corrections", () => {
  function correctionFixture() {
    seq = 0;
    return accountOpened({
      effectiveDate: "2026-01-01",
      interestBearing: { originalPrincipalCents: 10_000, rateBps: 0, regularPaymentCents: 1_000 },
      zeroInterest: { originalPrincipalCents: 5_000, rateBps: 0, regularPaymentCents: 500 },
    });
  }

  it("a discretionary principal correction can reduce a component to exactly zero", () => {
    const opened = correctionFixture();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -5_000,
      correctedComponentPrincipalRemainingCentsAfter: 0,
      reason: "Goodwill credit",
      effectiveDate: "2026-01-05",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-05T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, correction], asOfDate: "2026-01-05" });
    expect(result.zeroInterestRemainingCents).toBe(0);
    expect(result.cumulativePrincipalForgivenCents).toBe(5_000);
  });

  it("rejects a principal correction whose claimed after-value is not exactly supported by its delta", () => {
    const opened = correctionFixture();
    const badCorrection = {
      id: "evt_bad_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -100,
      correctedComponentPrincipalRemainingCentsAfter: 0, // 5,000 - 100 = 4,900, not 0 -- inconsistent
      reason: "Data fix",
      effectiveDate: "2026-01-05",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-05T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, badCorrection], asOfDate: "2026-01-05" })).toThrow(/does not match priorBalanceCents/);
  });

  it("a compensating_correction reversing a principal_correction restores the balance exactly", () => {
    const opened = correctionFixture();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000,
      correctedComponentPrincipalRemainingCentsAfter: 3_000,
      reason: "Entered against wrong component",
      effectiveDate: "2026-01-05",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-05T00:00:00.000Z",
    };
    const compensating = {
      id: "evt_compensating",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      reversesEventId: "evt_correction",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
      deltaCents: 2_000,
      reason: "Undoing the wrong-component correction",
      effectiveDate: "2026-01-06",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-06T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, correction, compensating], asOfDate: "2026-01-06" });
    expect(result.zeroInterestRemainingCents).toBe(5_000); // fully restored
  });

  it("an interest_correction (waiver) can reduce unpaid accrued interest to exactly zero, never negative", () => {
    seq = 0;
    const opened = accountOpened({
      effectiveDate: "2026-01-01",
      interestBearing: { originalPrincipalCents: 1_000_000, rateBps: 500, regularPaymentCents: 100_000 },
      zeroInterest: { originalPrincipalCents: 0, rateBps: 0, regularPaymentCents: 0 },
    });
    // Advance time with no payment so interest accrues, then waive the last known accrued cents exactly.
    const preview = replayEvents({ events: [opened], asOfDate: "2026-02-01" });
    const waiver = {
      id: "evt_waiver",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -preview.unpaidAccruedInterestCents,
      reason: "Owner waived accrued interest as a goodwill gesture",
      effectiveDate: "2026-02-01",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-02-01T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, waiver], asOfDate: "2026-02-01" });
    expect(result.unpaidAccruedInterestCents).toBe(0);
  });

  it("rejects an interest_correction that would create negative accrued interest", () => {
    seq = 0;
    const opened = accountOpened({
      effectiveDate: "2026-01-01",
      interestBearing: { originalPrincipalCents: 1_000_000, rateBps: 500, regularPaymentCents: 100_000 },
      zeroInterest: { originalPrincipalCents: 0, rateBps: 0, regularPaymentCents: 0 },
    });
    const badWaiver = {
      id: "evt_bad_waiver",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -999_999_999,
      reason: "Way too large a waiver",
      effectiveDate: "2026-01-01",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, badWaiver], asOfDate: "2026-01-01" })).toThrow(/negative accrued interest/);
  });
});

describe("replayEvents -- payoff concession and account closure", () => {
  function smallPayoffFixture() {
    seq = 0;
    return accountOpened({
      effectiveDate: "2026-01-01",
      interestBearing: { originalPrincipalCents: 10_000, rateBps: 0, regularPaymentCents: 1_000 },
      zeroInterest: { originalPrincipalCents: 0, rateBps: 0, regularPaymentCents: 0 },
    });
  }

  it("a payment plus a payoff concession may jointly close the account", () => {
    const opened = smallPayoffFixture();
    const payResult = allocatePayment({
      interestBearing: { remainingPrincipalCents: 10_000, regularPaymentCents: 1_000 },
      zeroInterest: { remainingPrincipalCents: 0, regularPaymentCents: 0 },
      accruedInterestCents: 0,
      paymentAmountCents: 6_000,
    });
    const payment = paymentPosted({
      id: "evt_payment",
      effectiveDate: "2026-01-10",
      amountCents: 6_000,
      allocation: payResult,
      principalRemainingCentsAfter: { interestBearing: 10_000 - payResult.interestBearingPrincipalPaidCents, zeroInterest: 0 },
    });
    const remainingAfterPayment = 10_000 - payResult.interestBearingPrincipalPaidCents;
    const concession = {
      id: "evt_concession",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      interestBearingDeltaCents: -remainingAfterPayment,
      zeroInterestDeltaCents: 0,
      principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
      reason: "Seller accepted the payment as payoff in full, forgiving the small remainder",
      effectiveDate: "2026-01-10",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      closureReason: ACCOUNT_CLOSURE_REASON.PAYOFF_CONCESSION_APPLIED,
      payoffConcessionEventId: "evt_concession",
      effectiveDate: "2026-01-10",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, payment, concession, closure], asOfDate: "2026-01-10" });
    expect(result.totalPrincipalRemainingCents).toBe(0);
    expect(result.closed).toBe(true);
    expect(result.closureReason).toBe("payoff_concession_applied");
  });

  it("rejects account_closed posted while a positive balance remains", () => {
    const opened = smallPayoffFixture();
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      closureReason: ACCOUNT_CLOSURE_REASON.WRITTEN_OFF,
      effectiveDate: "2026-01-10",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-10T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, closure], asOfDate: "2026-01-10" })).toThrow(/closure requires exactly zero owed/);
  });

  it("reopens only through an explicit reversal, not mutation -- a full payoff followed by reversing the final payment reopens the account", () => {
    const opened = smallPayoffFixture();
    const payResult = allocatePayment({
      interestBearing: { remainingPrincipalCents: 10_000, regularPaymentCents: 1_000 },
      zeroInterest: { remainingPrincipalCents: 0, regularPaymentCents: 0 },
      accruedInterestCents: 0,
      paymentAmountCents: 10_000,
    });
    const payment = paymentPosted({
      id: "evt_final_payment",
      effectiveDate: "2026-01-10",
      amountCents: 10_000,
      allocation: payResult,
      principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
    });
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      closureReason: ACCOUNT_CLOSURE_REASON.PAID_IN_FULL,
      effectiveDate: "2026-01-10",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const closedResult = replayEvents({ events: [opened, payment, closure], asOfDate: "2026-01-10" });
    expect(closedResult.closed).toBe(true);

    const reversal = {
      id: "evt_reversal",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      reversesEventId: "evt_final_payment",
      reason: "Final payment bounced after closure",
      amountCents: 10_000,
      allocation: payResult,
      principalRemainingCentsAfter: { interestBearing: 10_000, zeroInterest: 0 },
      effectiveDate: "2026-01-15",
      ledgerSequence: nextSeq(),
      recordedAt: "2026-01-15T00:00:00.000Z",
    };
    const reopenedResult = replayEvents({ events: [opened, payment, closure, reversal], asOfDate: "2026-01-15" });
    expect(reopenedResult.closed).toBe(false); // reopened by an appended reversal event, never by mutating the closure
    expect(reopenedResult.interestBearingRemainingCents).toBe(10_000);
  });
});

describe("evaluateClosureEligibility", () => {
  it("is eligible when zero owed and not already closed", () => {
    const snapshot = { closed: false, totalPrincipalRemainingCents: 0, unpaidAccruedInterestCents: 0, unappliedCents: 0 };
    expect(evaluateClosureEligibility(snapshot)).toEqual({ eligible: true, blockers: [] });
  });

  it("blocks closing an account with a positive balance", () => {
    const snapshot = { closed: false, totalPrincipalRemainingCents: 500, unpaidAccruedInterestCents: 0, unappliedCents: 0 };
    const result = evaluateClosureEligibility(snapshot);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Remaining principal is not zero.");
  });

  it("blocks a duplicate close attempt on an already-closed account", () => {
    const snapshot = { closed: true, totalPrincipalRemainingCents: 0, unpaidAccruedInterestCents: 0, unappliedCents: 0 };
    const result = evaluateClosureEligibility(snapshot);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("The account is already closed.");
  });

  it("blocks closure while an unapplied overpayment amount is unresolved", () => {
    const snapshot = { closed: false, totalPrincipalRemainingCents: 0, unpaidAccruedInterestCents: 0, unappliedCents: 500 };
    const result = evaluateClosureEligibility(snapshot);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("An unapplied (overpayment) amount is unresolved.");
  });
});

describe("replayEvents -- South Main golden reconciliation via the real event-sourced engine", () => {
  it("reproduces the owner-approved interest paid and cash-to-principal totals when the 48-payment history is expressed as real ledger events", () => {
    seq = 0;
    const opened = accountOpened({
      effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate,
      interestBearing: {
        originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
        rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
        regularPaymentCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents,
      },
      zeroInterest: {
        originalPrincipalCents: SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents,
        rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps,
        regularPaymentCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents,
      },
    });

    // Build one payment_posted event per real payment, folding sequentially with the exact same
    // fractional-carry discipline as southMainGoldenReplay.test.js's foldGoldenPayments -- this
    // constructs a REAL, valid event stream (not just a totals fold) whose stored allocations are correct
    // by construction, so replayEvents' own cross-check (independently recomputing each allocation) will
    // agree with them.
    let interestBearingRemainingCents = SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents;
    let zeroInterestRemainingCents = SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents;
    let unpaidAccruedInterestFractionalCents = 0;
    let lastDate = SOUTH_MAIN_TERMS.calculationStartDate;
    const events = [opened];

    for (const payment of SOUTH_MAIN_PAYMENTS) {
      const newAccrualCents = computeAccrual({
        principalRemainingCents: interestBearingRemainingCents,
        rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
        fromDate: lastDate,
        toDate: payment.datePaid,
      });
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

      events.push(
        paymentPosted({
          id: `evt_payment_${payment.pmtNo}`,
          eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
          effectiveDate: payment.datePaid,
          amountCents: payment.amountPaidCents,
          allocation: result,
          principalRemainingCentsAfter: { interestBearing: interestBearingRemainingCents, zeroInterest: zeroInterestRemainingCents },
        }),
      );
    }
    // paymentPosted's default eventOrigin is interactive_user with a createdBy -- overwrite each to the
    // real manual_import shape (null createdBy, an idempotencyKey) since these represent historical
    // imported payments, not a human clicking a button in real time.
    for (const event of events) {
      if (event.eventType !== PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED) continue;
      event.eventOrigin = PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT;
      event.createdBy = null;
      event.idempotencyKey = `south-main-import-${event.id}`;
    }

    const result = replayEvents({ events, asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate });
    expect(result.cumulativeInterestPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.interestPaidCents);
    expect(result.cumulativeCashPrincipalPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.cashAppliedToPrincipalCents);

    // Now apply the owner-approved bring-current credit as a REAL principal_correction event (not raw
    // subtraction) and confirm the corrected remaining principal matches exactly.
    const priorBalance = result.totalPrincipalRemainingCents;
    const bringCurrentCredit = {
      id: "evt_bring_current_credit",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING,
      correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      correctedComponentPrincipalRemainingCentsAfter: result.interestBearingRemainingCents - SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      reason: "Owner-approved bring-current/reporting credit per accepted opening reconciliation",
      effectiveDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate,
      ledgerSequence: nextSeq(),
      recordedAt: `${SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate}T00:00:00.000Z`,
    };
    const finalResult = replayEvents({ events: [...events, bringCurrentCredit], asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate });
    expect(finalResult.totalPrincipalRemainingCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents);
    expect(priorBalance - finalResult.totalPrincipalRemainingCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents);
  });
});
