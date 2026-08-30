import { describe, expect, it } from "vitest";
import { computeDueState, addCalendarMonthsClamped, paymentAdvancesDueDate, UnsupportedDueStateError } from "../dueState.js";

function terms(overrides = {}) {
  return {
    paymentFrequency: "monthly",
    firstPaymentDueDate: "2026-01-31",
    regularScheduledPaymentAmountCents: 100_000,
    prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date",
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    cumulativeInterestPaidCents: 0,
    cumulativeCashPrincipalPaidCents: 0,
    cumulativePrincipalForgivenCents: 0,
    totalPrincipalRemainingCents: 1_000_000,
    unpaidAccruedInterestCents: 0,
    ...overrides,
  };
}

describe("addCalendarMonthsClamped", () => {
  it("clamps to the target month's last day only when that month is too short", () => {
    expect(addCalendarMonthsClamped("2026-01-31", 1)).toBe("2026-02-28"); // Feb 2026 has only 28 days
  });

  it("returns to the original day-of-month once the target month is long enough again -- not stuck at the clamped day", () => {
    expect(addCalendarMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(addCalendarMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("rolls over the year boundary correctly", () => {
    expect(addCalendarMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("paymentAdvancesDueDate", () => {
  it("is false for allowed_without_penalty_does_not_advance_due_date", () => {
    expect(paymentAdvancesDueDate("allowed_without_penalty_does_not_advance_due_date")).toBe(false);
  });

  it("is true for allowed_without_penalty_advances_due_date", () => {
    expect(paymentAdvancesDueDate("allowed_without_penalty_advances_due_date")).toBe(true);
  });

  it("throws UnsupportedDueStateError for 'unsupported'", () => {
    expect(() => paymentAdvancesDueDate("unsupported")).toThrow(UnsupportedDueStateError);
  });
});

describe("computeDueState -- basic calculation", () => {
  it("reports nothing due yet before the first scheduled installment", () => {
    const state = computeDueState({ snapshot: snapshot(), accountTerms: terms(), asOfDate: "2026-01-15" });
    expect(state.currentAmountDueCents).toBe(0);
    expect(state.pastDueAmountCents).toBe(0);
    expect(state.nextDueDate).toBe("2026-01-31");
    expect(state.regularScheduledPaymentAmountCents).toBe(100_000);
  });

  it("splits a multi-installment shortfall into current (the most recent installment) and past-due (everything before it) -- and the month-end due dates clamp/un-clamp correctly across Jan 31 -> Feb 28 -> Mar 31", () => {
    // asOfDate is after both the Jan 31 and Feb 28 due dates but before Mar 31 -- two installments are due,
    // none paid, so the split into "current" (the most recent) and "past due" (the one before it) exercises
    // the exact calendar-clamping behavior V1 requires to be explicit and tested.
    const state = computeDueState({ snapshot: snapshot(), accountTerms: terms(), asOfDate: "2026-03-05" });
    expect(state.currentAmountDueCents).toBe(100_000);
    expect(state.pastDueAmountCents).toBe(100_000);
    expect(state.nextDueDate).toBe("2026-03-31"); // not stuck at Feb 28 -- the 31st returns once March is long enough
  });

  it("reports the true replayed balance (principal + unpaid accrued interest) as the remaining obligation, never schedule-count arithmetic", () => {
    const state = computeDueState({
      snapshot: snapshot({ totalPrincipalRemainingCents: 750_000, unpaidAccruedInterestCents: 1_250 }),
      accountTerms: terms(),
      asOfDate: "2026-01-15",
    });
    expect(state.remainingScheduledObligationCents).toBe(751_250);
  });
});

describe("computeDueState -- partial payment", () => {
  it("reduces the shortfall by exactly what qualifying payments/credits already covered", () => {
    const state = computeDueState({
      snapshot: snapshot({ cumulativeCashPrincipalPaidCents: 50_000 }),
      accountTerms: terms(),
      asOfDate: "2026-02-01",
    });
    expect(state.currentAmountDueCents).toBe(50_000);
    expect(state.pastDueAmountCents).toBe(0);
  });
});

describe("computeDueState -- extra payment and prepayment policy", () => {
  it("an extra payment does NOT advance the due date under allowed_without_penalty_does_not_advance_due_date -- the next due date is simply the next calendar installment, regardless of how far ahead the account has paid", () => {
    const state = computeDueState({
      snapshot: snapshot({ cumulativeCashPrincipalPaidCents: 250_000 }), // 2.5 installments' worth paid
      accountTerms: terms({ prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date" }),
      asOfDate: "2026-02-01",
    });
    expect(state.currentAmountDueCents).toBe(0);
    expect(state.pastDueAmountCents).toBe(0);
    expect(state.nextDueDate).toBe("2026-02-28"); // the next calendar installment after Jan 31, not advanced by the extra
  });

  it("an extra payment DOES advance the due date under allowed_without_penalty_advances_due_date -- the same extra payment pushes the next due date forward by however many installments it satisfies", () => {
    const state = computeDueState({
      snapshot: snapshot({ cumulativeCashPrincipalPaidCents: 250_000 }), // same 2.5-installments-ahead scenario
      accountTerms: terms({ prepaymentPolicy: "allowed_without_penalty_advances_due_date" }),
      asOfDate: "2026-02-01",
    });
    expect(state.nextDueDate).toBe("2026-03-31"); // advances past the 3rd installment, which the extra fully satisfies
  });
});

describe("computeDueState -- fails closed outside V1's supported envelope", () => {
  it("throws UnsupportedDueStateError for any payment frequency other than monthly", () => {
    expect(() => computeDueState({ snapshot: snapshot(), accountTerms: terms({ paymentFrequency: "biweekly" }), asOfDate: "2026-01-15" })).toThrow(
      UnsupportedDueStateError,
    );
  });

  it("throws UnsupportedDueStateError for prepaymentPolicy 'unsupported'", () => {
    expect(() => computeDueState({ snapshot: snapshot(), accountTerms: terms({ prepaymentPolicy: "unsupported" }), asOfDate: "2026-01-15" })).toThrow(
      UnsupportedDueStateError,
    );
  });

  it("throws UnsupportedDueStateError for a non-positive regularScheduledPaymentAmountCents", () => {
    expect(() => computeDueState({ snapshot: snapshot(), accountTerms: terms({ regularScheduledPaymentAmountCents: 0 }), asOfDate: "2026-01-15" })).toThrow(
      UnsupportedDueStateError,
    );
    expect(() => computeDueState({ snapshot: snapshot(), accountTerms: terms({ regularScheduledPaymentAmountCents: -100 }), asOfDate: "2026-01-15" })).toThrow(
      UnsupportedDueStateError,
    );
  });
});
