import { describe, expect, it } from "vitest";
import { allocatePayment, UnsupportedAllocationPolicyError } from "../paymentAllocation.js";

const SCHEDULED = "scheduled_component_order";

function southMainComponents() {
  return [
    { componentId: "ib", remainingPrincipalCents: 4_500_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
    { componentId: "zi", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
  ];
}

function sumOf(result) {
  const interest = Object.values(result.interestPaidByComponentCents).reduce((sum, cents) => sum + cents, 0);
  const principal = Object.values(result.principalPaidByComponentCents).reduce((sum, cents) => sum + cents, 0);
  return interest + principal + result.unallocatedCents;
}

describe("allocatePayment", () => {
  it("applies a regular combined payment: interest first, then each component's own principal envelope, in priority order", () => {
    const result = allocatePayment({
      components: southMainComponents(),
      accruedInterestCentsByComponent: { ib: 11_452 }, // less than the ib envelope
      paymentAmountCents: 51_785,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.interestPaidByComponentCents.ib).toBe(11_452);
    expect(result.principalPaidByComponentCents.ib).toBe(43_452 - 11_452); // remainder of that envelope
    expect(result.principalPaidByComponentCents.zi).toBe(8_333);
    expect(result.unallocatedCents).toBe(0);
  });

  it("every allocation sums exactly back to the input payment amount, across a wide range of amounts", () => {
    const amounts = [0, 1, 100, 8_333, 43_452, 51_785, 51_786, 60_000, 85_000, 100_000, 4_600_000];
    for (const paymentAmountCents of amounts) {
      const result = allocatePayment({
        components: southMainComponents(),
        accruedInterestCentsByComponent: { ib: 11_452 },
        paymentAmountCents,
        allocationPolicy: SCHEDULED,
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      });
      expect(sumOf(result)).toBe(paymentAmountCents);
    }
  });

  it("caps interest paid to a component's own envelope, then covers any shortfall from the rest of the payment before the next component", () => {
    const result = allocatePayment({
      components: southMainComponents(),
      accruedInterestCentsByComponent: { ib: 50_000 }, // exceeds the 43,452 envelope
      paymentAmountCents: 51_785,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.interestPaidByComponentCents.ib).toBe(50_000); // fully covered from the shortfall path
    expect(result.principalPaidByComponentCents.ib).toBeUndefined(); // envelope fully consumed by interest
    // 51,785 - 43,452 (envelope) leaves 8,333 remaining before the shortfall step; shortfall of
    // (50,000 - 43,452) = 6,548 consumed from it, leaving 1,785 for the zero-interest envelope.
    expect(result.principalPaidByComponentCents.zi).toBe(1_785);
    expect(result.unallocatedCents).toBe(0);
  });

  it("never allocates more principal to a component than it has remaining", () => {
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 10_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 5_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 51_785,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.principalPaidByComponentCents.ib).toBeLessThanOrEqual(10_000);
    expect(result.principalPaidByComponentCents.zi).toBeLessThanOrEqual(5_000);
    // Everything above what every component can absorb is preserved, never dropped.
    expect(sumOf(result)).toBe(51_785);
    expect(result.unallocatedCents).toBeGreaterThan(0);
  });

  it("a component with zero remaining principal receives nothing further from its own required envelope -- the unused share flows to the next eligible component's extra-payment share, never silently dropped", () => {
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 0, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 51_785,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.principalPaidByComponentCents.ib).toBeUndefined();
    // "ib" is paid off, so it is not an ELIGIBLE extra-payment target -- the entire remaining amount
    // (both zi's own required envelope AND the leftover ib's envelope never used) flows to zi, the only
    // eligible component, rather than sitting unallocated.
    expect(result.principalPaidByComponentCents.zi).toBe(51_785);
    expect(result.unallocatedCents).toBe(0);
    expect(sumOf(result)).toBe(51_785);
  });

  it("rejects a negative payment amount", () => {
    expect(() =>
      allocatePayment({ components: southMainComponents(), accruedInterestCentsByComponent: {}, paymentAmountCents: -1, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "highest_rate_first_extra" }),
    ).toThrow(/cannot be negative/);
  });

  it("rejects a negative accrued interest amount", () => {
    expect(() =>
      allocatePayment({
        components: southMainComponents(),
        accruedInterestCentsByComponent: { ib: -1 },
        paymentAmountCents: 51_785,
        allocationPolicy: SCHEDULED,
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      }),
    ).toThrow(/cannot be negative/);
  });

  it("rejects a negative remaining principal on any component", () => {
    expect(() =>
      allocatePayment({
        components: [{ componentId: "ib", remainingPrincipalCents: -1, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 }],
        accruedInterestCentsByComponent: {},
        paymentAmountCents: 51_785,
        allocationPolicy: SCHEDULED,
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      }),
    ).toThrow(/cannot be negative/);
  });

  it("rejects any non-integer-cents input", () => {
    expect(() =>
      allocatePayment({ components: southMainComponents(), accruedInterestCentsByComponent: {}, paymentAmountCents: 51_785.5, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "highest_rate_first_extra" }),
    ).toThrow(/must be an integer/);
  });

  it("rejects an empty components array -- every account has at least one component", () => {
    expect(() =>
      allocatePayment({ components: [], accruedInterestCentsByComponent: {}, paymentAmountCents: 100, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "highest_rate_first_extra" }),
    ).toThrow(/non-empty array/);
  });

  it("rejects an unsupported allocationPolicy -- fails closed", () => {
    expect(() =>
      allocatePayment({ components: southMainComponents(), accruedInterestCentsByComponent: {}, paymentAmountCents: 100, allocationPolicy: "some_future_policy", extraPaymentAllocationPolicy: "highest_rate_first_extra" }),
    ).toThrow(UnsupportedAllocationPolicyError);
  });

  it("rejects an unsupported extraPaymentAllocationPolicy -- fails closed", () => {
    expect(() =>
      allocatePayment({ components: southMainComponents(), accruedInterestCentsByComponent: {}, paymentAmountCents: 100, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "not_a_real_policy" }),
    ).toThrow(UnsupportedAllocationPolicyError);
  });

  it("returns a frozen result object", () => {
    const result = allocatePayment({
      components: southMainComponents(),
      accruedInterestCentsByComponent: { ib: 11_452 },
      paymentAmountCents: 51_785,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("allocatePayment -- extra-payment allocation policies (section 3 of the terms-generalization checkpoint)", () => {
  // Three components at different rates -- the highest-rate-first policy must pick "hi" first, "mid"
  // second, never "lo" (0%) until both others are paid off. All three required envelopes are satisfied by
  // the payment amount below, leaving a genuine "extra" amount to route.
  function threeComponents() {
    return [
      { componentId: "hi", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 900, allocationPriority: 1 },
      { componentId: "mid", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 500, allocationPriority: 2 },
      { componentId: "lo", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 0, allocationPriority: 3 },
    ];
  }

  it("highest_rate_first_extra: extra principal goes to the highest-rate eligible component first", () => {
    const result = allocatePayment({
      components: threeComponents(),
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 3_000 + 5_000, // 3 x $10 required + $50 extra
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    // Required: 1,000 principal to each of hi/mid/lo. Extra 5,000 all goes to "hi" (900bps), none to
    // "mid" or "lo" until "hi" is exhausted (it has 99,000 remaining after the required phase, well above
    // the extra amount).
    expect(result.principalPaidByComponentCents.hi).toBe(1_000 + 5_000);
    expect(result.principalPaidByComponentCents.mid).toBe(1_000);
    expect(result.principalPaidByComponentCents.lo).toBe(1_000);
  });

  it("proportional_extra: extra principal is distributed proportionally to each eligible component's own remaining-after-required balance, losing no cent to rounding", () => {
    const components = [
      { componentId: "a", remainingPrincipalCents: 300_000, scheduledComponentAmountCents: 0, rateBps: 500, allocationPriority: 1 },
      { componentId: "b", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 0, rateBps: 300, allocationPriority: 2 },
    ];
    const result = allocatePayment({
      components,
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 4_001, // deliberately not evenly divisible by the 3:1 ratio
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "proportional_extra",
    });
    const total = (result.principalPaidByComponentCents.a || 0) + (result.principalPaidByComponentCents.b || 0);
    expect(total + result.unallocatedCents).toBe(4_001);
    // Roughly 3:1 (300k:100k) -- "a" gets substantially more than "b", and no cent is lost.
    expect(result.principalPaidByComponentCents.a).toBeGreaterThan(result.principalPaidByComponentCents.b);
  });

  it("selected_component_extra: extra principal requires an explicitly selected eligible component -- never inferred", () => {
    const result = allocatePayment({
      components: threeComponents(),
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 3_000 + 5_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "selected_component_extra",
      selectedExtraComponentId: "lo",
    });
    expect(result.principalPaidByComponentCents.lo).toBe(1_000 + 5_000);
    expect(result.principalPaidByComponentCents.hi).toBe(1_000);
    expect(result.principalPaidByComponentCents.mid).toBe(1_000);
  });

  it("selected_component_extra: a missing or ineligible selection leaves the extra amount entirely unallocated, never guessed", () => {
    const result = allocatePayment({
      components: threeComponents(),
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 3_000 + 5_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "selected_component_extra",
      selectedExtraComponentId: null,
    });
    expect(result.unallocatedCents).toBe(5_000);
  });
});

// Every South-Main-shaped test above proves allocatePayment works for one specific loan, not that it's
// actually generic. This block re-runs the same categories of scenario against account terms that share
// no numbers with South Main at all, proving the function is driven entirely by its own parameters.
function genericComponents() {
  return [
    { componentId: "note_a", remainingPrincipalCents: 250_000, scheduledComponentAmountCents: 6_000, rateBps: 500, allocationPriority: 1 },
    { componentId: "note_b", remainingPrincipalCents: 40_000, scheduledComponentAmountCents: 2_500, rateBps: 0, allocationPriority: 2 },
  ];
}

describe("allocatePayment -- independent account terms (proves genericity, not just South Main)", () => {
  it("applies a regular combined payment: interest first, then each component's own principal envelope", () => {
    const result = allocatePayment({
      components: genericComponents(),
      accruedInterestCentsByComponent: { note_a: 1_200 },
      paymentAmountCents: 8_500,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.interestPaidByComponentCents.note_a).toBe(1_200);
    expect(result.principalPaidByComponentCents.note_a).toBe(6_000 - 1_200);
    expect(result.principalPaidByComponentCents.note_b).toBe(2_500);
    expect(result.unallocatedCents).toBe(0);
  });

  it("every allocation sums exactly back to the input payment amount, across a wide range of amounts", () => {
    const amounts = [0, 1, 50, 2_500, 6_000, 8_500, 8_501, 20_000, 100_000, 290_000];
    for (const paymentAmountCents of amounts) {
      const result = allocatePayment({
        components: genericComponents(),
        accruedInterestCentsByComponent: { note_a: 1_200 },
        paymentAmountCents,
        allocationPolicy: SCHEDULED,
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      });
      expect(sumOf(result)).toBe(paymentAmountCents);
    }
  });

  it("applies any amount above the combined regular payment to the highest-rate component", () => {
    const result = allocatePayment({
      components: genericComponents(),
      accruedInterestCentsByComponent: { note_a: 1_200 },
      paymentAmountCents: 50_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const combinedRegular = 6_000 + 2_500;
    const extra = 50_000 - combinedRegular;
    expect(result.principalPaidByComponentCents.note_a).toBe((6_000 - 1_200) + extra);
  });

  it("works with a single fixed-interest-only component (no zero-interest component at all)", () => {
    const result = allocatePayment({
      components: [{ componentId: "only", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000, rateBps: 750, allocationPriority: 1 }],
      accruedInterestCentsByComponent: { only: 600 },
      paymentAmountCents: 5_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.interestPaidByComponentCents.only).toBe(600);
    expect(result.principalPaidByComponentCents.only).toBe(4_400);
  });

  it("works with a single zero-interest-only component (no fixed-rate component at all)", () => {
    const result = allocatePayment({
      components: [{ componentId: "only", remainingPrincipalCents: 60_000, scheduledComponentAmountCents: 5_000, rateBps: 0, allocationPriority: 1 }],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 5_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(result.interestPaidByComponentCents.only).toBeUndefined();
    expect(result.principalPaidByComponentCents.only).toBe(5_000);
  });

  it("works with three components at three different rates -- V1 imposes no maximum component count", () => {
    const result = allocatePayment({
      components: [
        { componentId: "a", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 900, allocationPriority: 1 },
        { componentId: "b", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 500, allocationPriority: 2 },
        { componentId: "c", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 1_000, rateBps: 0, allocationPriority: 3 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 3_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    expect(sumOf(result)).toBe(3_000);
    expect(Object.keys(result.principalPaidByComponentCents)).toHaveLength(3);
  });
});
