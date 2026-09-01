import { describe, expect, it } from "vitest";
import { replayEvents, evaluateClosureEligibility, resolveComponentsAsOf } from "../replayEvents.js";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";
import {
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  CORRECTION_BASIS,
  ACCOUNT_CLOSURE_REASON,
} from "../privateFinancingContracts.js";
import { SOUTH_MAIN_TERMS, SOUTH_MAIN_PAYMENTS, SOUTH_MAIN_ACCEPTED_RECONCILIATION } from "../__fixtures__/southMainPayments.js";

let seq = 0;
function nextSeq() {
  seq += 1;
  return seq;
}

const SCHEDULED = "scheduled_component_order";
const OWNER = "owner_1";
const ACCOUNT = "acct_1";
const CREATED_BY = "11111111-1111-1111-1111-111111111111";

function accountOpened({ effectiveDate }) {
  return {
    id: "evt_open",
    ownerId: OWNER,
    accountId: ACCOUNT,
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: CREATED_BY,
    effectiveDate,
    ledgerSequence: nextSeq(),
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
  };
}

function componentVersion({ componentKey, label = componentKey, originalPrincipalCents, rateBps, scheduledComponentAmountCents, effectiveDate, allocationPriority, versionNumber = 1 }) {
  return {
    ownerId: OWNER, id: `comp_${componentKey}_v${versionNumber}`, accountId: ACCOUNT, componentKey, label,
    originalPrincipalCents, rateBps, dayCountConvention: "actual_365", scheduledComponentAmountCents,
    allocationPriority, effectiveDate, versionNumber,
  };
}

function accountTerms({
  effectiveDate,
  versionNumber = 1,
  extraPaymentAllocationPolicy = "highest_rate_first_extra",
  prepaymentPolicy = "allowed_without_penalty_does_not_advance_due_date",
  regularScheduledPaymentAmountCents = 0,
  firstPaymentDueDate = effectiveDate,
} = {}) {
  return {
    ownerId: OWNER, id: `terms_v${versionNumber}`, accountId: ACCOUNT, versionNumber,
    paymentFrequency: "monthly", firstPaymentDueDate, regularScheduledPaymentAmountCents, maturityDate: null,
    allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy, prepaymentPolicy, dayCountConvention: "actual_365",
    effectiveDate, actingSellerId: OWNER, amendmentReason: versionNumber > 1 ? "test amendment" : null,
  };
}

function paymentPosted({ id, effectiveDate, amountCents, allocation, principalRemainingByComponentCents, eventOrigin = PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy = CREATED_BY, idempotencyKey = null }) {
  return {
    id, ownerId: OWNER, accountId: ACCOUNT, eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
    eventOrigin, createdBy, idempotencyKey, effectiveDate, ledgerSequence: nextSeq(),
    recordedAt: `${effectiveDate}T00:00:00.000Z`, amountCents, allocation, principalRemainingByComponentCents,
  };
}

// A minimal single-component test account: $1,000.00 at 10%, small enough to hand-verify. Builds a
// correctly-allocated payment_posted event using the SAME computeAccrual/allocatePayment primitives
// replayEvents itself uses internally, so the fixture's stored allocation always matches what replay will
// independently recompute (unless a test deliberately corrupts it to test the cross-check).
function smallAccountFixture() {
  seq = 0;
  const opened = accountOpened({ effectiveDate: "2026-01-01" });
  const componentVersions = [componentVersion({ componentKey: "ib", originalPrincipalCents: 100_000, rateBps: 1000, scheduledComponentAmountCents: 10_000, effectiveDate: "2026-01-01", allocationPriority: 1 })];
  const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 10_000, firstPaymentDueDate: "2026-02-01" })];

  const accrual1 = computeAccrual({ principalRemainingCents: 100_000, rateBps: 1000, fromDate: "2026-01-01", toDate: "2026-02-01" });
  const accruedInterestCents1 = roundToNearestCent(accrual1);
  const result1 = allocatePayment({
    components: [{ componentId: "ib", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 10_000, rateBps: 1000, allocationPriority: 1 }],
    accruedInterestCentsByComponent: { ib: accruedInterestCents1 },
    paymentAmountCents: 10_000,
    allocationPolicy: SCHEDULED,
    extraPaymentAllocationPolicy: "highest_rate_first_extra",
  });
  const payment1 = paymentPosted({
    id: "evt_payment_1",
    effectiveDate: "2026-02-01",
    amountCents: 10_000,
    allocation: result1,
    principalRemainingByComponentCents: { ib: 100_000 - (result1.principalPaidByComponentCents.ib || 0) },
  });
  return { opened, componentVersions, accountTermsVersions, payment1, result1, accruedInterestCents1 };
}

describe("replayEvents -- basic reconstruction", () => {
  it("reconstructs opening balances from account_opened alone (no payments yet)", () => {
    const { opened, componentVersions, accountTermsVersions } = smallAccountFixture();
    const result = replayEvents({ events: [opened], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" });
    expect(result.remainingPrincipalByComponentCents.ib).toBe(100_000);
    expect(result.cumulativeInterestPaidCents).toBe(0);
    expect(result.closed).toBe(false);
  });

  it("reconstructs state after one payment, matching independently-computed allocation exactly", () => {
    const { opened, componentVersions, accountTermsVersions, payment1, result1 } = smallAccountFixture();
    const result = replayEvents({ events: [opened, payment1], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    expect(result.cumulativeInterestPaidCents).toBe(result1.interestPaidByComponentCents.ib);
    expect(result.cumulativeCashPrincipalPaidCents).toBe(result1.principalPaidByComponentCents.ib);
    expect(result.remainingPrincipalByComponentCents.ib).toBe(100_000 - result1.principalPaidByComponentCents.ib);
  });

  it("only replays events on or before asOfDate", () => {
    const { opened, componentVersions, accountTermsVersions, payment1 } = smallAccountFixture();
    const result = replayEvents({ events: [opened, payment1], componentVersions, accountTermsVersions, asOfDate: "2026-01-15" }); // before payment1's effectiveDate
    expect(result.remainingPrincipalByComponentCents.ib).toBe(100_000);
    expect(result.cumulativeInterestPaidCents).toBe(0);
  });

  it("requires exactly one account_opened event", () => {
    const { componentVersions, accountTermsVersions } = smallAccountFixture();
    expect(() => replayEvents({ events: [], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" })).toThrow(/exactly one account_opened/);
  });

  it("is deterministic -- identical inputs produce a deep-equal result on every call", () => {
    const { opened, componentVersions, accountTermsVersions, payment1 } = smallAccountFixture();
    const first = replayEvents({ events: [opened, payment1], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    const second = replayEvents({ events: [opened, payment1], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    expect(second).toEqual(first);
  });

  it("never mutates the input events array", () => {
    const { opened, componentVersions, accountTermsVersions, payment1 } = smallAccountFixture();
    const events = [opened, payment1];
    const copy = [...events];
    replayEvents({ events, componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    expect(events).toEqual(copy);
  });

  it("rejects an event whose stored allocation does not match independently recomputed allocation -- ledger corruption detected", () => {
    const { opened, componentVersions, accountTermsVersions, payment1 } = smallAccountFixture();
    // Shift one cent from principal to interest -- the sum still equals amountCents (so it passes the
    // contract-level shape check), but the split no longer matches what replay independently recomputes
    // from the account's real accrued interest, which is exactly what the cross-check must catch.
    const corrupted = {
      ...payment1,
      allocation: {
        ...payment1.allocation,
        interestPaidByComponentCents: { ib: (payment1.allocation.interestPaidByComponentCents.ib || 0) + 1 },
        principalPaidByComponentCents: { ib: (payment1.allocation.principalPaidByComponentCents.ib || 0) - 1 },
      },
    };
    expect(() => replayEvents({ events: [opened, corrupted], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" })).toThrow(/ledger corruption detected/);
  });

  it("rejects an event referencing more than one reversal of the same target", () => {
    const { opened, componentVersions, accountTermsVersions, payment1 } = smallAccountFixture();
    const reversalPayload = {
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: CREATED_BY,
      ownerId: OWNER,
      accountId: ACCOUNT,
      reversesEventId: "evt_payment_1",
      reason: "test double reversal",
      amountCents: payment1.amountCents,
      allocation: payment1.allocation,
      principalRemainingByComponentCents: { ib: 100_000 },
    };
    const reversal1 = { ...reversalPayload, id: "evt_reversal_1", effectiveDate: "2026-02-02", ledgerSequence: nextSeq(), recordedAt: "2026-02-02T00:00:00.000Z" };
    const reversal2 = { ...reversalPayload, id: "evt_reversal_2", effectiveDate: "2026-02-03", ledgerSequence: nextSeq(), recordedAt: "2026-02-03T00:00:00.000Z" };
    expect(() => replayEvents({ events: [opened, payment1, reversal1, reversal2], componentVersions, accountTermsVersions, asOfDate: "2026-02-03" })).toThrow(
      /reversed by more than one event/,
    );
  });
});

describe("resolveComponentsAsOf", () => {
  it("resolves the latest version of each component effective as of a date, one per componentKey", () => {
    const versions = [
      componentVersion({ componentKey: "a", originalPrincipalCents: 1000, rateBps: 100, scheduledComponentAmountCents: 100, effectiveDate: "2026-01-01", allocationPriority: 1, versionNumber: 1 }),
      componentVersion({ componentKey: "a", originalPrincipalCents: 900, rateBps: 200, scheduledComponentAmountCents: 100, effectiveDate: "2026-06-01", allocationPriority: 1, versionNumber: 2 }),
      componentVersion({ componentKey: "b", originalPrincipalCents: 500, rateBps: 0, scheduledComponentAmountCents: 50, effectiveDate: "2026-01-01", allocationPriority: 2, versionNumber: 1 }),
    ];
    expect(resolveComponentsAsOf(versions, "2026-03-01").map((c) => c.rateBps)).toEqual([100, 0]);
    expect(resolveComponentsAsOf(versions, "2026-07-01").map((c) => c.rateBps)).toEqual([200, 0]);
  });

  it("omits a component with no version yet effective as of the given date", () => {
    const versions = [componentVersion({ componentKey: "a", originalPrincipalCents: 1000, rateBps: 100, scheduledComponentAmountCents: 100, effectiveDate: "2026-06-01", allocationPriority: 1 })];
    expect(resolveComponentsAsOf(versions, "2026-01-01")).toHaveLength(0);
  });
});

// V1's engine supports one or more components -- these tests prove BOTH single-component shapes work
// correctly and independently, using account terms that share nothing with South Main's own numbers.
describe("replayEvents -- component generality: single-component accounts, independent of South Main's numbers", () => {
  it("an interest-bearing-only account (no zero-interest component at all) replays correctly", () => {
    const { opened, componentVersions, accountTermsVersions, payment1, result1 } = smallAccountFixture();
    expect(componentVersions).toHaveLength(1);
    const result = replayEvents({ events: [opened, payment1], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    expect(result.remainingPrincipalByComponentCents.ib).toBe(100_000 - result1.principalPaidByComponentCents.ib);
  });

  it("a zero-rate-only account replays correctly -- a personal loan with no interest, for example", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2025-06-01" });
    const componentVersions = [componentVersion({ componentKey: "zi", originalPrincipalCents: 60_000, rateBps: 0, scheduledComponentAmountCents: 5_000, effectiveDate: "2025-06-01", allocationPriority: 1 })];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2025-06-01", regularScheduledPaymentAmountCents: 5_000, firstPaymentDueDate: "2025-07-01" })];

    const opening = replayEvents({ events: [opened], componentVersions, accountTermsVersions, asOfDate: "2025-06-01" });
    expect(opening.remainingPrincipalByComponentCents.zi).toBe(60_000);
    expect(opening.unpaidAccruedInterestCents).toBe(0);

    const payment = paymentPosted({
      id: "evt_zi_payment_1",
      effectiveDate: "2025-07-01",
      amountCents: 5_000,
      allocation: { interestPaidByComponentCents: {}, principalPaidByComponentCents: { zi: 5_000 }, unallocatedCents: 0 },
      principalRemainingByComponentCents: { zi: 55_000 },
    });
    const afterPayment = replayEvents({ events: [opened, payment], componentVersions, accountTermsVersions, asOfDate: "2025-07-01" });
    expect(afterPayment.remainingPrincipalByComponentCents.zi).toBe(55_000);
    // No interest ever accrues when the only component has rateBps 0 -- not merely 0 by coincidence, but
    // structurally guaranteed by computeAccrual's own zero-rate short-circuit.
    expect(afterPayment.cumulativeInterestPaidCents).toBe(0);
  });

  it("a three-component account (three different rates) replays correctly -- V1 imposes no maximum", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [
      componentVersion({ componentKey: "a", originalPrincipalCents: 100_000, rateBps: 900, scheduledComponentAmountCents: 1_000, effectiveDate: "2026-01-01", allocationPriority: 1 }),
      componentVersion({ componentKey: "b", originalPrincipalCents: 100_000, rateBps: 500, scheduledComponentAmountCents: 1_000, effectiveDate: "2026-01-01", allocationPriority: 2 }),
      componentVersion({ componentKey: "c", originalPrincipalCents: 100_000, rateBps: 0, scheduledComponentAmountCents: 1_000, effectiveDate: "2026-01-01", allocationPriority: 3 }),
    ];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 3_000, firstPaymentDueDate: "2026-02-01" })];
    const opening = replayEvents({ events: [opened], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" });
    expect(opening.totalPrincipalRemainingCents).toBe(300_000);
    expect(Object.keys(opening.remainingPrincipalByComponentCents)).toHaveLength(3);
  });
});

// The account's own terms drive which of the 3 closed extraPaymentAllocationPolicy values governs extra
// principal above the required envelope -- these tests exercise proportional_extra and
// selected_component_extra at the FULL replay level (not just allocatePayment's own unit tests), proving
// the terms-resolution wiring actually reaches the real policy, not just "highest_rate_first_extra" (the
// only value every other replayEvents.test.js fixture uses).
describe("replayEvents -- extra-payment allocation policies other than the default", () => {
  function twoEqualComponentsFixture(extraPaymentAllocationPolicy) {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [
      componentVersion({ componentKey: "ib", originalPrincipalCents: 100_000, rateBps: 1000, scheduledComponentAmountCents: 5_000, effectiveDate: "2026-01-01", allocationPriority: 1 }),
      componentVersion({ componentKey: "zi", originalPrincipalCents: 100_000, rateBps: 0, scheduledComponentAmountCents: 5_000, effectiveDate: "2026-01-01", allocationPriority: 2 }),
    ];
    const accountTermsVersions = [
      accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 10_000, firstPaymentDueDate: "2026-02-01", extraPaymentAllocationPolicy }),
    ];
    return { opened, componentVersions, accountTermsVersions };
  }

  it("proportional_extra splits extra principal proportionally across eligible components, at the full replay level", () => {
    const { opened, componentVersions, accountTermsVersions } = twoEqualComponentsFixture("proportional_extra");
    // Same effectiveDate as account_opened -- 0 elapsed days, so accrued interest is genuinely 0 and the
    // required envelope is exactly the two components' combined scheduled amount (10,000).
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000, rateBps: 1000, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 30_000, // 10,000 required + 20,000 extra
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "proportional_extra",
    });
    const payment = paymentPosted({
      id: "evt_payment_proportional",
      effectiveDate: "2026-01-01",
      amountCents: 30_000,
      allocation: result,
      principalRemainingByComponentCents: {
        ib: 100_000 - result.principalPaidByComponentCents.ib,
        zi: 100_000 - result.principalPaidByComponentCents.zi,
      },
    });
    const replayed = replayEvents({ events: [opened, payment], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" });
    // Both components had equal remaining balance after the required phase (95,000 each), so the 20,000
    // extra splits exactly evenly -- 10,000/10,000 -- via allocateCentsByRatio's largest-remainder method.
    expect(replayed.remainingPrincipalByComponentCents.ib).toBe(85_000);
    expect(replayed.remainingPrincipalByComponentCents.zi).toBe(85_000);
  });

  it("selected_component_extra directs extra principal only to the account's explicitly selected component, at the full replay level", () => {
    const { opened, componentVersions, accountTermsVersions } = twoEqualComponentsFixture("selected_component_extra");
    const result = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000, rateBps: 1000, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 30_000,
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "selected_component_extra",
      // Deliberately the LOWER-rate (zero-interest) component -- proving the explicit selection is
      // honored rather than an automatic highest-rate-first choice.
      selectedExtraComponentId: "zi",
    });
    const payment = {
      ...paymentPosted({
        id: "evt_payment_selected",
        effectiveDate: "2026-01-01",
        amountCents: 30_000,
        allocation: result,
        principalRemainingByComponentCents: {
          ib: 100_000 - result.principalPaidByComponentCents.ib,
          zi: 100_000 - result.principalPaidByComponentCents.zi,
        },
      }),
      selectedExtraComponentId: "zi",
    };
    const replayed = replayEvents({ events: [opened, payment], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" });
    // Only the required envelope touches ib -- all 20,000 extra goes to the explicitly selected zi.
    expect(replayed.remainingPrincipalByComponentCents.ib).toBe(95_000);
    expect(replayed.remainingPrincipalByComponentCents.zi).toBe(75_000);
  });

  it("fails closed when an account's own terms carry an unrecognized extraPaymentAllocationPolicy value -- never silently falls back to a default", () => {
    const { opened, componentVersions, accountTermsVersions } = twoEqualComponentsFixture("some_future_policy_not_yet_supported");
    const payment = paymentPosted({
      id: "evt_payment_unsupported_policy",
      effectiveDate: "2026-01-01",
      amountCents: 10_000,
      allocation: { interestPaidByComponentCents: {}, principalPaidByComponentCents: { ib: 5_000, zi: 5_000 }, unallocatedCents: 0 },
      principalRemainingByComponentCents: { ib: 95_000, zi: 95_000 },
    });
    expect(() => replayEvents({ events: [opened, payment], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" })).toThrow(
      /extraPaymentAllocationPolicy .* is not supported/,
    );
  });
});

describe("replayEvents -- overpayment", () => {
  it("an overpayment produces an explicit, non-negative unappliedCents, never dropped and never negative principal", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [componentVersion({ componentKey: "ib", originalPrincipalCents: 5_000, rateBps: 0, scheduledComponentAmountCents: 5_000, effectiveDate: "2026-01-01", allocationPriority: 1 })];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 5_000, firstPaymentDueDate: "2026-02-01" })];
    const overpayResult = allocatePayment({
      components: [{ componentId: "ib", remainingPrincipalCents: 5_000, scheduledComponentAmountCents: 5_000, rateBps: 0, allocationPriority: 1 }],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 8_000, // 3,000 more than owed
      allocationPolicy: SCHEDULED,
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const overpayment = paymentPosted({
      id: "evt_overpay",
      effectiveDate: "2026-01-01",
      amountCents: 8_000,
      allocation: overpayResult,
      principalRemainingByComponentCents: { ib: 0 },
    });
    const result = replayEvents({ events: [opened, overpayment], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" });
    expect(result.remainingPrincipalByComponentCents.ib).toBe(0); // never negative
    expect(result.unappliedCents).toBe(3_000); // explicitly modeled, never silently dropped
    expect(result.unappliedCents).toBeGreaterThanOrEqual(0);
  });
});

describe("replayEvents -- corrections", () => {
  function correctionFixture() {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [
      componentVersion({ componentKey: "ib", originalPrincipalCents: 10_000, rateBps: 0, scheduledComponentAmountCents: 1_000, effectiveDate: "2026-01-01", allocationPriority: 1 }),
      componentVersion({ componentKey: "zi", originalPrincipalCents: 5_000, rateBps: 0, scheduledComponentAmountCents: 500, effectiveDate: "2026-01-01", allocationPriority: 2 }),
    ];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 1_500, firstPaymentDueDate: "2026-02-01" })];
    return { opened, componentVersions, accountTermsVersions };
  }

  it("a discretionary principal correction can reduce a component to exactly zero", () => {
    const { opened, componentVersions, accountTermsVersions } = correctionFixture();
    const correction = {
      id: "evt_correction", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "zi", correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -5_000, correctedComponentPrincipalRemainingCentsAfter: 0,
      reason: "Goodwill credit", effectiveDate: "2026-01-05", ledgerSequence: nextSeq(), recordedAt: "2026-01-05T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, correction], componentVersions, accountTermsVersions, asOfDate: "2026-01-05" });
    expect(result.remainingPrincipalByComponentCents.zi).toBe(0);
    expect(result.cumulativePrincipalForgivenCents).toBe(5_000);
  });

  it("rejects a principal_correction referencing a component that does not exist on this account", () => {
    const { opened, componentVersions, accountTermsVersions } = correctionFixture();
    const correction = {
      id: "evt_correction", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "not_a_real_component", correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -100, correctedComponentPrincipalRemainingCentsAfter: 0,
      reason: "typo", effectiveDate: "2026-01-05", ledgerSequence: nextSeq(), recordedAt: "2026-01-05T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, correction], componentVersions, accountTermsVersions, asOfDate: "2026-01-05" })).toThrow(/unknown component/);
  });

  it("rejects a principal correction whose claimed after-value is not exactly supported by its delta", () => {
    const { opened, componentVersions, accountTermsVersions } = correctionFixture();
    const badCorrection = {
      id: "evt_bad_correction", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "zi", correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -100, correctedComponentPrincipalRemainingCentsAfter: 0, // 5,000 - 100 = 4,900, not 0
      reason: "Data fix", effectiveDate: "2026-01-05", ledgerSequence: nextSeq(), recordedAt: "2026-01-05T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, badCorrection], componentVersions, accountTermsVersions, asOfDate: "2026-01-05" })).toThrow(/does not match priorBalanceCents/);
  });

  it("a compensating_correction reversing a principal_correction restores the balance exactly", () => {
    const { opened, componentVersions, accountTermsVersions } = correctionFixture();
    const correction = {
      id: "evt_correction", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "zi", correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000, correctedComponentPrincipalRemainingCentsAfter: 3_000,
      reason: "Entered against wrong component", effectiveDate: "2026-01-05", ledgerSequence: nextSeq(), recordedAt: "2026-01-05T00:00:00.000Z",
    };
    const compensating = {
      id: "evt_compensating", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      reversesEventId: "evt_correction", deltaCents: 2_000,
      reason: "Undoing the wrong-component correction", effectiveDate: "2026-01-06", ledgerSequence: nextSeq(), recordedAt: "2026-01-06T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, correction, compensating], componentVersions, accountTermsVersions, asOfDate: "2026-01-06" });
    expect(result.remainingPrincipalByComponentCents.zi).toBe(5_000); // fully restored
  });

  it("an interest_correction (waiver) can reduce a component's unpaid accrued interest to exactly zero, never negative", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [componentVersion({ componentKey: "ib", originalPrincipalCents: 1_000_000, rateBps: 500, scheduledComponentAmountCents: 100_000, effectiveDate: "2026-01-01", allocationPriority: 1 })];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 100_000, firstPaymentDueDate: "2026-02-01" })];
    const preview = replayEvents({ events: [opened], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    const waiver = {
      id: "evt_waiver", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "ib", correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -preview.unpaidAccruedInterestByComponentCents.ib,
      reason: "Owner waived accrued interest as a goodwill gesture", effectiveDate: "2026-02-01", ledgerSequence: nextSeq(), recordedAt: "2026-02-01T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, waiver], componentVersions, accountTermsVersions, asOfDate: "2026-02-01" });
    expect(result.unpaidAccruedInterestCents).toBe(0);
  });

  it("rejects an interest_correction that would create negative accrued interest", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [componentVersion({ componentKey: "ib", originalPrincipalCents: 1_000_000, rateBps: 500, scheduledComponentAmountCents: 100_000, effectiveDate: "2026-01-01", allocationPriority: 1 })];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 100_000, firstPaymentDueDate: "2026-02-01" })];
    const badWaiver = {
      id: "evt_bad_waiver", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "ib", correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -999_999_999, reason: "Way too large a waiver", effectiveDate: "2026-01-01", ledgerSequence: nextSeq(), recordedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, badWaiver], componentVersions, accountTermsVersions, asOfDate: "2026-01-01" })).toThrow(/negative accrued interest/);
  });
});

describe("replayEvents -- payoff concession and account closure", () => {
  function smallPayoffFixture() {
    seq = 0;
    const opened = accountOpened({ effectiveDate: "2026-01-01" });
    const componentVersions = [componentVersion({ componentKey: "ib", originalPrincipalCents: 10_000, rateBps: 0, scheduledComponentAmountCents: 1_000, effectiveDate: "2026-01-01", allocationPriority: 1 })];
    const accountTermsVersions = [accountTerms({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 1_000, firstPaymentDueDate: "2026-02-01" })];
    return { opened, componentVersions, accountTermsVersions };
  }

  it("a payment plus a payoff concession may jointly close the account", () => {
    const { opened, componentVersions, accountTermsVersions } = smallPayoffFixture();
    const payResult = allocatePayment({
      components: [{ componentId: "ib", remainingPrincipalCents: 10_000, scheduledComponentAmountCents: 1_000, rateBps: 0, allocationPriority: 1 }],
      accruedInterestCentsByComponent: {}, paymentAmountCents: 6_000, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const remainingAfterPayment = 10_000 - (payResult.principalPaidByComponentCents.ib || 0);
    const payment = paymentPosted({
      id: "evt_payment", effectiveDate: "2026-01-10", amountCents: 6_000, allocation: payResult,
      principalRemainingByComponentCents: { ib: remainingAfterPayment },
    });
    const concession = {
      id: "evt_concession", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      deltaCentsByComponentCents: { ib: -remainingAfterPayment },
      principalRemainingByComponentCents: { ib: 0 },
      reason: "Seller accepted the payment as payoff in full, forgiving the small remainder",
      effectiveDate: "2026-01-10", ledgerSequence: nextSeq(), recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const closure = {
      id: "evt_closed", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      closureReason: ACCOUNT_CLOSURE_REASON.PAYOFF_CONCESSION_APPLIED, payoffConcessionEventId: "evt_concession",
      effectiveDate: "2026-01-10", ledgerSequence: nextSeq(), recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const result = replayEvents({ events: [opened, payment, concession, closure], componentVersions, accountTermsVersions, asOfDate: "2026-01-10" });
    expect(result.totalPrincipalRemainingCents).toBe(0);
    expect(result.closed).toBe(true);
    expect(result.closureReason).toBe("payoff_concession_applied");
  });

  it("rejects account_closed posted while a positive balance remains", () => {
    const { opened, componentVersions, accountTermsVersions } = smallPayoffFixture();
    const closure = {
      id: "evt_closed", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      closureReason: ACCOUNT_CLOSURE_REASON.WRITTEN_OFF,
      effectiveDate: "2026-01-10", ledgerSequence: nextSeq(), recordedAt: "2026-01-10T00:00:00.000Z",
    };
    expect(() => replayEvents({ events: [opened, closure], componentVersions, accountTermsVersions, asOfDate: "2026-01-10" })).toThrow(/closure requires exactly zero owed/);
  });

  it("reopens only through an explicit reversal, not mutation -- a full payoff followed by reversing the final payment reopens the account", () => {
    const { opened, componentVersions, accountTermsVersions } = smallPayoffFixture();
    const payResult = allocatePayment({
      components: [{ componentId: "ib", remainingPrincipalCents: 10_000, scheduledComponentAmountCents: 1_000, rateBps: 0, allocationPriority: 1 }],
      accruedInterestCentsByComponent: {}, paymentAmountCents: 10_000, allocationPolicy: SCHEDULED, extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const payment = paymentPosted({
      id: "evt_final_payment", effectiveDate: "2026-01-10", amountCents: 10_000, allocation: payResult,
      principalRemainingByComponentCents: { ib: 0 },
    });
    const closure = {
      id: "evt_closed", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      closureReason: ACCOUNT_CLOSURE_REASON.PAID_IN_FULL,
      effectiveDate: "2026-01-10", ledgerSequence: nextSeq(), recordedAt: "2026-01-10T00:00:00.000Z",
    };
    const closedResult = replayEvents({ events: [opened, payment, closure], componentVersions, accountTermsVersions, asOfDate: "2026-01-10" });
    expect(closedResult.closed).toBe(true);

    const reversal = {
      id: "evt_reversal", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      reversesEventId: "evt_final_payment", reason: "Final payment bounced after closure",
      amountCents: 10_000, allocation: payResult, principalRemainingByComponentCents: { ib: 10_000 },
      effectiveDate: "2026-01-15", ledgerSequence: nextSeq(), recordedAt: "2026-01-15T00:00:00.000Z",
    };
    const reopenedResult = replayEvents({ events: [opened, payment, closure, reversal], componentVersions, accountTermsVersions, asOfDate: "2026-01-15" });
    expect(reopenedResult.closed).toBe(false); // reopened by an appended reversal event, never by mutating the closure
    expect(reopenedResult.remainingPrincipalByComponentCents.ib).toBe(10_000);
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

describe("replayEvents -- South Main golden reconciliation, expressed entirely through ordinary component/terms configuration", () => {
  it("reproduces the owner-approved interest paid and cash-to-principal totals when the 48-payment history is expressed as real ledger events", () => {
    seq = 0;
    const opened = accountOpened({ effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate });
    const componentVersions = [
      componentVersion({
        componentKey: "interest_bearing", label: "Interest-bearing note",
        originalPrincipalCents: SOUTH_MAIN_TERMS.interestBearing.originalPrincipalCents,
        rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps,
        scheduledComponentAmountCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents,
        effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate, allocationPriority: 1,
      }),
      componentVersion({
        componentKey: "zero_interest", label: "Zero-interest note",
        originalPrincipalCents: SOUTH_MAIN_TERMS.zeroInterest.originalPrincipalCents,
        rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps,
        scheduledComponentAmountCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents,
        effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate, allocationPriority: 2,
      }),
    ];
    const accountTermsVersions = [
      accountTerms({
        effectiveDate: SOUTH_MAIN_TERMS.calculationStartDate,
        regularScheduledPaymentAmountCents: SOUTH_MAIN_TERMS.regularCombinedPaymentCents,
        firstPaymentDueDate: SOUTH_MAIN_PAYMENTS[0].datePaid,
        // South Main's own real historical behavior -- excess above the combined regular payment always
        // reduced the interest-bearing component's principal. Expressed here as ordinary account
        // configuration (highest_rate_first_extra correctly selects the only rate>0 component), never as
        // a special code branch.
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      }),
    ];

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
        components: [
          { componentId: "interest_bearing", remainingPrincipalCents: interestBearingRemainingCents, scheduledComponentAmountCents: SOUTH_MAIN_TERMS.interestBearing.regularPaymentCents, rateBps: SOUTH_MAIN_TERMS.interestBearing.rateBps, allocationPriority: 1 },
          { componentId: "zero_interest", remainingPrincipalCents: zeroInterestRemainingCents, scheduledComponentAmountCents: SOUTH_MAIN_TERMS.zeroInterest.regularPaymentCents, rateBps: SOUTH_MAIN_TERMS.zeroInterest.rateBps, allocationPriority: 2 },
        ],
        accruedInterestCentsByComponent: { interest_bearing: accruedInterestCents },
        paymentAmountCents: payment.amountPaidCents,
        allocationPolicy: SCHEDULED,
        extraPaymentAllocationPolicy: "highest_rate_first_extra",
      });
      const interestPaid = result.interestPaidByComponentCents.interest_bearing || 0;
      const ibPrincipalPaid = result.principalPaidByComponentCents.interest_bearing || 0;
      const ziPrincipalPaid = result.principalPaidByComponentCents.zero_interest || 0;
      unpaidAccruedInterestFractionalCents = totalAccruedFractionalCents - interestPaid;
      interestBearingRemainingCents -= ibPrincipalPaid;
      zeroInterestRemainingCents -= ziPrincipalPaid;
      lastDate = payment.datePaid;

      events.push(
        paymentPosted({
          id: `evt_payment_${payment.pmtNo}`,
          eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
          createdBy: null,
          idempotencyKey: `south-main-import-evt_payment_${payment.pmtNo}`,
          effectiveDate: payment.datePaid,
          amountCents: payment.amountPaidCents,
          allocation: result,
          principalRemainingByComponentCents: { interest_bearing: interestBearingRemainingCents, zero_interest: zeroInterestRemainingCents },
        }),
      );
    }

    const result = replayEvents({ events, componentVersions, accountTermsVersions, asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate });
    expect(result.cumulativeInterestPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.interestPaidCents);
    expect(result.cumulativeCashPrincipalPaidCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.cashAppliedToPrincipalCents);

    // Now apply the owner-approved bring-current credit as a REAL principal_correction event (not raw
    // subtraction) and confirm the corrected remaining principal matches exactly.
    const priorBalance = result.totalPrincipalRemainingCents;
    const bringCurrentCredit = {
      id: "evt_bring_current_credit", ownerId: OWNER, accountId: ACCOUNT,
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: CREATED_BY,
      componentId: "interest_bearing", correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      correctedComponentPrincipalRemainingCentsAfter: result.remainingPrincipalByComponentCents.interest_bearing - SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents,
      reason: "Owner-approved bring-current/reporting credit per accepted opening reconciliation",
      effectiveDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate, ledgerSequence: nextSeq(), recordedAt: `${SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate}T00:00:00.000Z`,
    };
    const finalResult = replayEvents({ events: [...events, bringCurrentCredit], componentVersions, accountTermsVersions, asOfDate: SOUTH_MAIN_ACCEPTED_RECONCILIATION.asOfDate });
    expect(finalResult.totalPrincipalRemainingCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.correctedPrincipalRemainingCents);
    expect(priorBalance - finalResult.totalPrincipalRemainingCents).toBe(SOUTH_MAIN_ACCEPTED_RECONCILIATION.bringCurrentCreditCents);
  });
});
