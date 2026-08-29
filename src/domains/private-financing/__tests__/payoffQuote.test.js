import { describe, expect, it } from "vitest";
import { computePayoffQuote, isQuoteExpired, hasLedgerChangedSinceQuote } from "../payoffQuote.js";
import { allocatePayment } from "../paymentAllocation.js";
import { LedgerIntegrityViolationError } from "../ledgerIntegrity.js";
import { PRIVATE_FINANCING_EVENT_TYPE, PRIVATE_FINANCING_EVENT_ORIGIN, PRIVATE_FINANCING_COMPONENT_TYPE } from "../privateFinancingContracts.js";

function accountOpened({ effectiveDate = "2026-01-01", ledgerSequence = 1 } = {}) {
  return {
    id: "evt_open",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: "11111111-1111-1111-1111-111111111111",
    effectiveDate,
    ledgerSequence,
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
    openingComponents: [
      { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, originalPrincipalCents: 1_000_000, rateBps: 600, regularPaymentCents: 20_000 },
      { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, originalPrincipalCents: 200_000, rateBps: 0, regularPaymentCents: 5_000 },
    ],
  };
}

function baseQuoteArgs(overrides = {}) {
  return {
    events: [accountOpened()],
    asOfDate: "2026-06-01",
    payoffThroughDate: "2026-06-15",
    quoteId: "quote_1",
    issuedAt: "2026-06-01",
    expiresAt: "2026-06-08",
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
      "interestBearingPrincipalCents",
      "zeroInterestPrincipalCents",
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
  it("always includes lateChargesCents at exactly 0 for South Main -- never omitted, never nonzero", () => {
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
    expect(quote.interestBearingPrincipalCents).toBe(1_000_000);
    expect(quote.zeroInterestPrincipalCents).toBe(200_000);
    expect(quote.accruedInterestCents).toBeGreaterThan(0); // real accrual did happen, just kept separate
    expect(quote.calculatedPayoffCents).toBe(
      quote.interestBearingPrincipalCents + quote.zeroInterestPrincipalCents + quote.accruedInterestCents + quote.lateChargesCents + quote.authorizedAdditionalAmountsCents,
    );
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
    // A dedicated opening with regular-payment envelopes large enough to retire both components in one
    // lump-sum payment -- allocatePayment's step 5 overflow only ever reaches interest-bearing
    // principal, so a zero-interest component can only be fully retired within its OWN envelope.
    const opened = {
      ...accountOpened({ ledgerSequence: 1 }),
      openingComponents: [
        { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, originalPrincipalCents: 1_000_000, rateBps: 600, regularPaymentCents: 1_000_000 },
        { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, originalPrincipalCents: 200_000, rateBps: 0, regularPaymentCents: 200_000 },
      ],
    };
    // Same effectiveDate as account_opened -- 0 elapsed days, so accrued interest is genuinely 0 and
    // allocatePayment's real envelope logic is used rather than a hand-computed (and error-prone) split.
    const payResult = allocatePayment({
      interestBearing: { remainingPrincipalCents: 1_000_000, regularPaymentCents: 1_000_000 },
      zeroInterest: { remainingPrincipalCents: 200_000, regularPaymentCents: 200_000 },
      accruedInterestCents: 0,
      paymentAmountCents: 1_200_000,
    });
    const payoff = {
      id: "evt_payoff",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      effectiveDate: "2026-01-01",
      ledgerSequence: 2,
      recordedAt: "2026-01-01T00:00:00.000Z",
      amountCents: 1_200_000,
      allocation: payResult,
      principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
    };
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: "11111111-1111-1111-1111-111111111111",
      closureReason: "paid_in_full",
      effectiveDate: "2026-01-01",
      ledgerSequence: 3,
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() =>
      computePayoffQuote(baseQuoteArgs({ events: [opened, payoff, closure], asOfDate: "2026-01-01", payoffThroughDate: "2026-01-01" })),
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
      createdBy: "11111111-1111-1111-1111-111111111111",
      effectiveDate: "2026-06-02",
      ledgerSequence: 2,
      recordedAt: "2026-06-02T00:00:00.000Z",
      amountCents: 20_000,
      allocation: { interestPaidCents: 0, interestBearingPrincipalPaidCents: 15_000, zeroInterestPrincipalPaidCents: 5_000, unallocatedCents: 0 },
      principalRemainingCentsAfter: { interestBearing: 985_000, zeroInterest: 195_000 },
    };
    expect(hasLedgerChangedSinceQuote([opened, newPayment], quote)).toBe(true);
  });
});
