import { describe, expect, it } from "vitest";
import {
  validatePayoffOffer,
  buildPayoffOfferFromQuote,
  assertValidPayoffOfferTransition,
  isPayoffOfferExpired,
  PAYOFF_OFFER_STATUS,
  MalformedPayoffOfferError,
} from "../payoffOffer.js";

function pendingOffer(overrides = {}) {
  return {
    id: "offer_1",
    ownerId: "owner_1",
    accountId: "acct_1",
    quoteId: "quote_1",
    quoteSnapshot: {
      calculatedPayoffCents: 500_000,
      offeredPayoffCents: 480_000,
      sellerConcessionCents: 20_000,
      accruedInterestCents: 5_000,
      interestBearingPrincipalCents: 400_000,
      zeroInterestPrincipalCents: 95_000,
      calculatedThroughDate: "2026-09-01",
    },
    status: PAYOFF_OFFER_STATUS.PENDING,
    issuedAt: "2026-08-01",
    expiresAt: "2026-08-15",
    sellerActingUserId: "11111111-1111-1111-1111-111111111111",
    borrowerAcceptanceEvidence: null,
    createdAt: "2026-08-01",
    ...overrides,
  };
}

describe("validatePayoffOffer", () => {
  it("accepts a well-formed pending offer", () => {
    const result = validatePayoffOffer(pendingOffer());
    expect(result.status).toBe("pending");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.quoteSnapshot)).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(() => validatePayoffOffer(null)).toThrow(MalformedPayoffOfferError);
  });

  it("rejects an unrecognized status", () => {
    expect(() => validatePayoffOffer(pendingOffer({ status: "made_up_status" }))).toThrow(MalformedPayoffOfferError);
  });

  it("rejects expiresAt on or before issuedAt", () => {
    expect(() => validatePayoffOffer(pendingOffer({ expiresAt: "2026-08-01" }))).toThrow(/strictly after issuedAt/);
  });

  it("requires sellerActingUserId -- an offer is never created by the system alone", () => {
    expect(() => validatePayoffOffer(pendingOffer({ sellerActingUserId: null }))).toThrow(/sellerActingUserId/);
  });

  it("rejects borrowerAcceptanceEvidence being present on a pending offer", () => {
    expect(() =>
      validatePayoffOffer(pendingOffer({ borrowerAcceptanceEvidence: { acceptedAt: "2026-08-05", method: "e-sign" } })),
    ).toThrow(/must be null before the offer has been accepted/);
  });

  it("requires borrowerAcceptanceEvidence once status is accepted", () => {
    expect(() => validatePayoffOffer(pendingOffer({ status: PAYOFF_OFFER_STATUS.ACCEPTED }))).toThrow(
      /borrowerAcceptanceEvidence is required/,
    );
  });

  it("accepts an accepted offer with valid borrowerAcceptanceEvidence", () => {
    const result = validatePayoffOffer(
      pendingOffer({ status: PAYOFF_OFFER_STATUS.ACCEPTED, borrowerAcceptanceEvidence: { acceptedAt: "2026-08-05", method: "e-sign", reference: "doc_9" } }),
    );
    expect(result.borrowerAcceptanceEvidence.method).toBe("e-sign");
  });

  it("rejects a quoteSnapshot missing a required field", () => {
    const bad = pendingOffer();
    delete bad.quoteSnapshot.calculatedPayoffCents;
    expect(() => validatePayoffOffer(bad)).toThrow(/quoteSnapshot.calculatedPayoffCents/);
  });
});

describe("assertValidPayoffOfferTransition", () => {
  it("allows pending -> accepted, expired, withdrawn, cancelled", () => {
    for (const to of [PAYOFF_OFFER_STATUS.ACCEPTED, PAYOFF_OFFER_STATUS.EXPIRED, PAYOFF_OFFER_STATUS.WITHDRAWN, PAYOFF_OFFER_STATUS.CANCELLED]) {
      expect(() => assertValidPayoffOfferTransition(PAYOFF_OFFER_STATUS.PENDING, to)).not.toThrow();
    }
  });

  it("allows accepted -> paid or cancelled", () => {
    expect(() => assertValidPayoffOfferTransition(PAYOFF_OFFER_STATUS.ACCEPTED, PAYOFF_OFFER_STATUS.PAID)).not.toThrow();
    expect(() => assertValidPayoffOfferTransition(PAYOFF_OFFER_STATUS.ACCEPTED, PAYOFF_OFFER_STATUS.CANCELLED)).not.toThrow();
  });

  it("rejects any transition out of a terminal state", () => {
    for (const terminal of [PAYOFF_OFFER_STATUS.EXPIRED, PAYOFF_OFFER_STATUS.WITHDRAWN, PAYOFF_OFFER_STATUS.PAID, PAYOFF_OFFER_STATUS.CANCELLED]) {
      expect(() => assertValidPayoffOfferTransition(terminal, PAYOFF_OFFER_STATUS.PENDING)).toThrow(/cannot transition/);
    }
  });

  it("rejects skipping straight from pending to paid", () => {
    expect(() => assertValidPayoffOfferTransition(PAYOFF_OFFER_STATUS.PENDING, PAYOFF_OFFER_STATUS.PAID)).toThrow(/cannot transition/);
  });
});

describe("buildPayoffOfferFromQuote", () => {
  it("builds a valid pending offer snapshotting the quote's financial terms", () => {
    const quote = {
      ownerId: "owner_1",
      accountId: "acct_1",
      quoteId: "quote_1",
      calculatedPayoffCents: 500_000,
      offeredPayoffCents: 480_000,
      sellerConcessionCents: 20_000,
      accruedInterestCents: 5_000,
      interestBearingPrincipalCents: 400_000,
      zeroInterestPrincipalCents: 95_000,
      calculatedThroughDate: "2026-09-01",
    };
    const offer = buildPayoffOfferFromQuote(quote, {
      id: "offer_1",
      sellerActingUserId: "11111111-1111-1111-1111-111111111111",
      issuedAt: "2026-08-01",
      expiresAt: "2026-08-15",
    });
    expect(offer.status).toBe("pending");
    expect(offer.quoteSnapshot.offeredPayoffCents).toBe(480_000);
    expect(offer.quoteId).toBe("quote_1");
  });

  it("later changes to the original quote object never affect an already-built offer's snapshot", () => {
    const quote = {
      ownerId: "owner_1",
      accountId: "acct_1",
      quoteId: "quote_1",
      calculatedPayoffCents: 500_000,
      offeredPayoffCents: 480_000,
      sellerConcessionCents: 20_000,
      accruedInterestCents: 5_000,
      interestBearingPrincipalCents: 400_000,
      zeroInterestPrincipalCents: 95_000,
      calculatedThroughDate: "2026-09-01",
    };
    const offer = buildPayoffOfferFromQuote(quote, {
      id: "offer_1",
      sellerActingUserId: "11111111-1111-1111-1111-111111111111",
      issuedAt: "2026-08-01",
      expiresAt: "2026-08-15",
    });
    quote.offeredPayoffCents = 1; // mutate the original object after the offer was built
    expect(offer.quoteSnapshot.offeredPayoffCents).toBe(480_000); // unaffected
  });
});

describe("isPayoffOfferExpired", () => {
  it("is false before expiration and true after", () => {
    const offer = pendingOffer({ expiresAt: "2026-08-15" });
    expect(isPayoffOfferExpired(offer, "2026-08-10")).toBe(false);
    expect(isPayoffOfferExpired(offer, "2026-08-16")).toBe(true);
  });
});
