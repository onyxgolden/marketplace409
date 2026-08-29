import { describe, expect, it } from "vitest";
import { allocatePayment } from "../paymentAllocation.js";

const SOUTH_MAIN_SHAPE = {
  interestBearing: { remainingPrincipalCents: 4_500_000, regularPaymentCents: 43_452 },
  zeroInterest: { remainingPrincipalCents: 1_000_000, regularPaymentCents: 8_333 },
};

function sumOf(result) {
  return result.interestPaidCents + result.interestBearingPrincipalPaidCents + result.zeroInterestPrincipalPaidCents + result.unallocatedCents;
}

describe("allocatePayment", () => {
  it("applies a regular combined payment: interest first, then each component's own principal envelope", () => {
    const result = allocatePayment({
      ...SOUTH_MAIN_SHAPE,
      accruedInterestCents: 11_452, // less than the interest-bearing envelope
      paymentAmountCents: 51_785,
    });
    expect(result.interestPaidCents).toBe(11_452);
    expect(result.interestBearingPrincipalPaidCents).toBe(43_452 - 11_452); // remainder of that envelope
    expect(result.zeroInterestPrincipalPaidCents).toBe(8_333);
    expect(result.unallocatedCents).toBe(0);
  });

  it("every allocation sums exactly back to the input payment amount, across a wide range of amounts", () => {
    const amounts = [0, 1, 100, 8_333, 43_452, 51_785, 51_786, 60_000, 85_000, 100_000, 4_600_000];
    for (const paymentAmountCents of amounts) {
      const result = allocatePayment({ ...SOUTH_MAIN_SHAPE, accruedInterestCents: 11_452, paymentAmountCents });
      expect(sumOf(result)).toBe(paymentAmountCents);
    }
  });

  it("caps interest paid to the interest-bearing envelope, then covers any shortfall from the rest of the payment before principal", () => {
    // Accrued interest larger than the component's own regular envelope -- not expected for South Main,
    // but never assumed away.
    const result = allocatePayment({
      ...SOUTH_MAIN_SHAPE,
      accruedInterestCents: 50_000, // exceeds the 43,452 envelope
      paymentAmountCents: 51_785,
    });
    expect(result.interestPaidCents).toBe(50_000); // fully covered from the shortfall path
    expect(result.interestBearingPrincipalPaidCents).toBe(0); // envelope fully consumed by interest
    // 51,785 - 43,452 (envelope) leaves 8,333 remaining before the shortfall step; shortfall of
    // (50,000 - 43,452) = 6,548 consumed from it, leaving 1,785 for the zero-interest envelope.
    expect(result.zeroInterestPrincipalPaidCents).toBe(1_785);
    expect(result.unallocatedCents).toBe(0);
  });

  it("never allocates more principal to a component than it has remaining", () => {
    const result = allocatePayment({
      interestBearing: { remainingPrincipalCents: 100_00, regularPaymentCents: 43_452 },
      zeroInterest: { remainingPrincipalCents: 5_000, regularPaymentCents: 8_333 },
      accruedInterestCents: 0,
      paymentAmountCents: 51_785,
    });
    expect(result.interestBearingPrincipalPaidCents).toBeLessThanOrEqual(100_00);
    expect(result.zeroInterestPrincipalPaidCents).toBeLessThanOrEqual(5_000);
    // Everything above what both components can absorb is preserved, never dropped.
    expect(sumOf(result)).toBe(51_785);
    expect(result.unallocatedCents).toBeGreaterThan(0);
  });

  it("applies any amount above the combined regular payment to interest-bearing principal, so interest stops accruing sooner", () => {
    const result = allocatePayment({
      ...SOUTH_MAIN_SHAPE,
      accruedInterestCents: 11_452,
      paymentAmountCents: 100_000, // well above the 51,785 combined regular payment
    });
    const combinedRegular = 51_785;
    const extra = 100_000 - combinedRegular;
    expect(result.interestBearingPrincipalPaidCents).toBe(43_452 - 11_452 + extra);
    expect(result.zeroInterestPrincipalPaidCents).toBe(8_333);
    expect(result.unallocatedCents).toBe(0);
  });

  it("a component with zero remaining principal receives nothing further from its own envelope", () => {
    const result = allocatePayment({
      interestBearing: { remainingPrincipalCents: 0, regularPaymentCents: 43_452 },
      zeroInterest: { remainingPrincipalCents: 1_000_000, regularPaymentCents: 8_333 },
      accruedInterestCents: 0,
      paymentAmountCents: 51_785,
    });
    expect(result.interestBearingPrincipalPaidCents).toBe(0);
    expect(result.zeroInterestPrincipalPaidCents).toBe(8_333);
    // The interest-bearing envelope's unused principal share (since it's paid off) is preserved as
    // unallocated, not silently redirected -- redirecting it is a real design decision for a later
    // checkpoint (e.g. an event-driven "component paid off, redirect its share" rule), not assumed here.
    expect(sumOf(result)).toBe(51_785);
  });

  it("rejects a negative payment amount", () => {
    expect(() => allocatePayment({ ...SOUTH_MAIN_SHAPE, accruedInterestCents: 0, paymentAmountCents: -1 })).toThrow(/cannot be negative/);
  });

  it("rejects a negative accrued interest amount", () => {
    expect(() => allocatePayment({ ...SOUTH_MAIN_SHAPE, accruedInterestCents: -1, paymentAmountCents: 51_785 })).toThrow(/cannot be negative/);
  });

  it("rejects a negative remaining principal on either component", () => {
    expect(() =>
      allocatePayment({
        interestBearing: { remainingPrincipalCents: -1, regularPaymentCents: 43_452 },
        zeroInterest: SOUTH_MAIN_SHAPE.zeroInterest,
        accruedInterestCents: 0,
        paymentAmountCents: 51_785,
      }),
    ).toThrow(/cannot be negative/);
  });

  it("rejects any non-integer-cents input", () => {
    expect(() => allocatePayment({ ...SOUTH_MAIN_SHAPE, accruedInterestCents: 0, paymentAmountCents: 51_785.5 })).toThrow(/must be an integer/);
  });

  it("returns a frozen result object", () => {
    const result = allocatePayment({ ...SOUTH_MAIN_SHAPE, accruedInterestCents: 11_452, paymentAmountCents: 51_785 });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
