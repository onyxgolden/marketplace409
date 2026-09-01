import { describe, expect, it } from "vitest";
import { computePayoffQuote, isQuoteExpired, hasLedgerChangedSinceQuote, UnsupportedAccountPolicyError } from "../payoffQuote.js";
import { allocatePayment } from "../paymentAllocation.js";
import { LedgerIntegrityViolationError } from "../ledgerIntegrity.js";
import { PRIVATE_FINANCING_EVENT_TYPE, PRIVATE_FINANCING_EVENT_ORIGIN } from "../privateFinancingContracts.js";

const ACTOR = "11111111-1111-1111-1111-111111111111";

function accountOpened({ effectiveDate = "2026-01-01", ledgerSequence = 1 } = {}) {
  return {
    id: "evt_open",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: ACTOR,
    effectiveDate,
    ledgerSequence,
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
  };
}

function componentVersions({ ib, zi, effectiveDate = "2026-01-01" } = {}) {
  const ibFields = { originalPrincipalCents: 1_000_000, rateBps: 600, scheduledComponentAmountCents: 20_000, ...ib };
  const ziFields = { originalPrincipalCents: 200_000, rateBps: 0, scheduledComponentAmountCents: 5_000, ...zi };
  return [
    { ownerId: "owner_1", id: "comp_ib", accountId: "acct_1", componentKey: "ib", label: "Interest-bearing note", dayCountConvention: "actual_365", allocationPriority: 1, effectiveDate, versionNumber: 1, ...ibFields },
    { ownerId: "owner_1", id: "comp_zi", accountId: "acct_1", componentKey: "zi", label: "Zero-interest note", dayCountConvention: "actual_365", allocationPriority: 2, effectiveDate, versionNumber: 1, ...ziFields },
  ];
}

function accountTermsVersions({ effectiveDate = "2026-01-01", regularScheduledPaymentAmountCents = 25_000 } = {}) {
  return [
    {
      ownerId: "owner_1", id: "terms_1", accountId: "acct_1", versionNumber: 1, paymentFrequency: "monthly",
      firstPaymentDueDate: "2026-02-01", regularScheduledPaymentAmountCents, maturityDate: null,
      allocationPolicy: "scheduled_component_order", extraPaymentAllocationPolicy: "highest_rate_first_extra",
      prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date", dayCountConvention: "actual_365",
      effectiveDate, actingSellerId: "owner_1", amendmentReason: null,
    },
  ];
}

function baseQuoteArgs(overrides = {}) {
  return {
    events: [accountOpened()],
    componentVersions: componentVersions(),
    accountTermsVersions: accountTermsVersions(),
    asOfDate: "2026-06-01",
    payoffThroughDate: "2026-06-15",
    quoteId: "quote_1",
    issuedAt: "2026-06-01",
    expiresAt: "2026-06-08",
    lateFeePolicy: "disabled",
    ...overrides,
  };
}

describe("computePayoffQuote -- required fields", () => {
  it("returns every required field", () => {
    const quote = computePayoffQuote(baseQuoteArgs());
    for (const field of [
      "quoteId",
      "calculatedThroughDate",
      "expirationDate",
      "principalByComponentCents",
      "totalPrincipalCents",
      "accruedInterestByComponentCents",
      "accruedInterestCents",
      "authorizedAdditionalAmountsCents",
      "calculatedPayoffCents",
      "sellerConcessionCents",
      "offeredPayoffCents",
      "isEstimate",
      "estimateDisclaimer",
    ]) {
      expect(quote).toHaveProperty(field);
    }
    expect(quote.isEstimate).toBe(true);
    expect(typeof quote.estimateDisclaimer).toBe("string");
    expect(quote.estimateDisclaimer.length).toBeGreaterThan(0);
  });

  it("is deterministic -- identical arguments produce a deep-equal quote", () => {
    const first = computePayoffQuote(baseQuoteArgs());
    const second = computePayoffQuote(baseQuoteArgs());
    expect(second).toEqual(first);
  });

  it("never mutates the input events array", () => {
    const args = baseQuoteArgs();
    const copy = [...args.events];
    computePayoffQuote(args);
    expect(args.events).toEqual(copy);
  });
});

describe("computePayoffQuote -- late charges and fee exclusion", () => {
  it("always includes lateChargesCents at exactly 0 when the account's own policy disables late fees -- never omitted, never nonzero", () => {
    const quote = computePayoffQuote(baseQuoteArgs());
    expect(quote.lateChargesCents).toBe(0);
  });

  it("never includes a Stripe or FORGE servicing fee field in principal, interest, or the calculated payoff", () => {
    const quote = computePayoffQuote(baseQuoteArgs());
    const keys = Object.keys(quote).map((k) => k.toLowerCase());
    for (const key of keys) {
      expect(key).not.toContain("stripe");
      expect(key).not.toContain("servicingfee");
      expect(key).not.toContain("processingfee");
    }
  });
});

describe("computePayoffQuote -- no silent capitalization of unpaid interest", () => {
  it("keeps accruedInterestCents as its own line, never folded into principal", () => {
    const quote = computePayoffQuote(baseQuoteArgs());
    // The account had no payments, so principal must exactly equal the ORIGINAL origination amounts --
    // if interest were being silently capitalized into principal, these would be inflated instead.
    expect(quote.principalByComponentCents.ib).toBe(1_000_000);
    expect(quote.principalByComponentCents.zi).toBe(200_000);
    expect(quote.totalPrincipalCents).toBe(1_200_000);
    expect(quote.accruedInterestCents).toBeGreaterThan(0); // real accrual did happen, just kept separate
    expect(quote.calculatedPayoffCents).toBe(quote.totalPrincipalCents + quote.accruedInterestCents + quote.lateChargesCents + quote.authorizedAdditionalAmountsCents);
  });
});

describe("computePayoffQuote -- seller concession", () => {
  it("offeredPayoffCents is calculatedPayoffCents minus sellerConcessionCents", () => {
    const quote = computePayoffQuote(baseQuoteArgs({ sellerConcessionCents: 5_000 }));
    expect(quote.offeredPayoffCents).toBe(quote.calculatedPayoffCents - 5_000);
  });

  it("rejects a sellerConcessionCents larger than the calculated payoff", () => {
    const quote = computePayoffQuote(baseQuoteArgs());
    expect(() => computePayoffQuote(baseQuoteArgs({ sellerConcessionCents: quote.calculatedPayoffCents + 1 }))).toThrow(
      /cannot exceed the calculated payoff/,
    );
  });
});

describe("computePayoffQuote -- validation, fails closed", () => {
  it("rejects payoffThroughDate before asOfDate", () => {
    expect(() => computePayoffQuote(baseQuoteArgs({ payoffThroughDate: "2026-05-01" }))).toThrow(LedgerIntegrityViolationError);
  });

  it("rejects expiresAt on or before issuedAt", () => {
    expect(() => computePayoffQuote(baseQuoteArgs({ expiresAt: "2026-06-01" }))).toThrow(/strictly after issuedAt/);
    expect(() => computePayoffQuote(baseQuoteArgs({ expiresAt: "2026-05-01" }))).toThrow(/strictly after issuedAt/);
  });

  it("rejects a negative authorizedAdditionalAmountsCents", () => {
    expect(() => computePayoffQuote(baseQuoteArgs({ authorizedAdditionalAmountsCents: -1 }))).toThrow(/non-negative integer/);
  });

  it("rejects quoting an already-closed account", () => {
    // A dedicated opening with scheduled-component-amount envelopes large enough to retire both
    // components in one lump-sum payment.
    const comps = componentVersions({ ib: { scheduledComponentAmountCents: 1_000_000 }, zi: { scheduledComponentAmountCents: 200_000 } });
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 1_200_000 });
    const opened = accountOpened({ ledgerSequence: 1 });
    // Same effectiveDate as account_opened -- 0 elapsed days, so accrued interest is genuinely 0 and
    // allocatePayment's real envelope logic is used rather than a hand-computed (and error-prone) split.
    const payResult = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 1_000_000, rateBps: 600, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 200_000, scheduledComponentAmountCents: 200_000, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 1_200_000,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const payoff = {
      id: "evt_payoff",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      effectiveDate: "2026-01-01",
      ledgerSequence: 2,
      recordedAt: "2026-01-01T00:00:00.000Z",
      amountCents: 1_200_000,
      allocation: payResult,
      principalRemainingByComponentCents: { ib: 0, zi: 0 },
    };
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
    expect(() =>
      computePayoffQuote(baseQuoteArgs({ events: [opened, payoff, closure], componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", payoffThroughDate: "2026-01-01" })),
    ).toThrow(/already closed/);
  });
});

describe("isQuoteExpired", () => {
  it("is false before expiration and true after", () => {
    const quote = computePayoffQuote(baseQuoteArgs({ expiresAt: "2026-06-08" }));
    expect(isQuoteExpired(quote, "2026-06-05")).toBe(false);
    expect(isQuoteExpired(quote, "2026-06-08")).toBe(false); // valid through end of expiration date itself
    expect(isQuoteExpired(quote, "2026-06-09")).toBe(true);
  });
});

describe("hasLedgerChangedSinceQuote", () => {
  it("is false when no event has been added since the quote was computed", () => {
    const events = [accountOpened()];
    const quote = computePayoffQuote(baseQuoteArgs({ events }));
    expect(hasLedgerChangedSinceQuote(events, quote)).toBe(false);
  });

  it("is true once a new event with a higher ledgerSequence is appended -- the quote must be recalculated", () => {
    const opened = accountOpened({ ledgerSequence: 1 });
    const quote = computePayoffQuote(baseQuoteArgs({ events: [opened] }));
    const newPayment = {
      id: "evt_new_payment",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      effectiveDate: "2026-06-02",
      ledgerSequence: 2,
      recordedAt: "2026-06-02T00:00:00.000Z",
      amountCents: 20_000,
      allocation: { interestPaidByComponentCents: { ib: 15_000 }, principalPaidByComponentCents: { ib: 0, zi: 5_000 }, unallocatedCents: 0 },
      principalRemainingByComponentCents: { ib: 1_000_000, zi: 195_000 },
    };
    expect(hasLedgerChangedSinceQuote([opened, newPayment], quote)).toBe(true);
  });
});

describe("computePayoffQuote -- late-fee policy fails closed, never fabricates a $0 charge", () => {
  it("computes lateChargesCents = 0 for an account whose own policy disables late fees", () => {
    const quote = computePayoffQuote(baseQuoteArgs({ lateFeePolicy: "disabled" }));
    expect(quote.lateChargesCents).toBe(0);
  });

  it("throws UnsupportedAccountPolicyError, never silently returning 0, for an account with late fees enabled", () => {
    expect(() => computePayoffQuote(baseQuoteArgs({ lateFeePolicy: "enabled" }))).toThrow(UnsupportedAccountPolicyError);
    expect(() => computePayoffQuote(baseQuoteArgs({ lateFeePolicy: "enabled" }))).toThrow(/not yet implemented/);
  });

  it("fails closed for any unrecognized lateFeePolicy value too, not only a specific known 'wrong' one", () => {
    expect(() => computePayoffQuote(baseQuoteArgs({ lateFeePolicy: "some_future_policy" }))).toThrow(UnsupportedAccountPolicyError);
    expect(() => computePayoffQuote(baseQuoteArgs({ lateFeePolicy: undefined }))).toThrow(UnsupportedAccountPolicyError);
  });
});
