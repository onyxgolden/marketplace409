import { describe, expect, it } from "vitest";
import {
  validatePrivateFinancingEvent,
  validatePrivateFinancingAccount,
  validatePrivateFinancingComponent,
  MalformedPrivateFinancingContractError,
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  CORRECTION_BASIS,
  PRIVATE_FINANCING_COMPONENT_TYPE,
  ACCOUNT_CLOSURE_REASON,
} from "../privateFinancingContracts.js";

function baseEvent(overrides = {}) {
  return {
    id: "evt_1",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: "11111111-1111-1111-1111-111111111111",
    effectiveDate: "2026-08-23",
    ledgerSequence: 1,
    recordedAt: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

function paymentPostedEvent(overrides = {}) {
  return baseEvent({
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
    amountCents: 51_785,
    allocation: {
      interestPaidCents: 11_452,
      interestBearingPrincipalPaidCents: 32_000,
      zeroInterestPrincipalPaidCents: 8_333,
      unallocatedCents: 0,
    },
    principalRemainingCentsAfter: { interestBearing: 4_468_000, zeroInterest: 991_667 },
    ...overrides,
  });
}

describe("validatePrivateFinancingEvent -- account_opened", () => {
  it("accepts a well-formed account_opened event", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
        openingComponents: [
          { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, originalPrincipalCents: 4_500_000, rateBps: 300, regularPaymentCents: 43_452 },
          { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST, originalPrincipalCents: 1_000_000, rateBps: 0, regularPaymentCents: 8_333 },
        ],
      }),
    );
    expect(result.openingComponents).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects an empty openingComponents array", () => {
    expect(() => validatePrivateFinancingEvent(baseEvent({ eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED, openingComponents: [] }))).toThrow(
      MalformedPrivateFinancingContractError,
    );
  });

  it("rejects a duplicate componentType within openingComponents", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        baseEvent({
          eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
          openingComponents: [
            { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, originalPrincipalCents: 100, rateBps: 100, regularPaymentCents: 10 },
            { componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING, originalPrincipalCents: 200, rateBps: 200, regularPaymentCents: 20 },
          ],
        }),
      ),
    ).toThrow(/must not repeat/);
  });
});

describe("validatePrivateFinancingEvent -- payment_posted", () => {
  it("accepts a well-formed payment with an allocation that sums exactly to amountCents", () => {
    const result = validatePrivateFinancingEvent(paymentPostedEvent());
    expect(result.amountCents).toBe(51_785);
    expect(Object.isFrozen(result.allocation)).toBe(true);
    expect(Object.isFrozen(result.principalRemainingCentsAfter)).toBe(true);
  });

  it("rejects an allocation that does not sum exactly to amountCents -- no event may manufacture or lose money", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        paymentPostedEvent({
          allocation: { interestPaidCents: 11_452, interestBearingPrincipalPaidCents: 32_000, zeroInterestPrincipalPaidCents: 8_000, unallocatedCents: 0 },
        }),
      ),
    ).toThrow(/must sum exactly/);
  });

  it("rejects a non-positive amountCents", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ amountCents: 0 }))).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ amountCents: -100 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a negative principalRemainingCentsAfter component", () => {
    expect(() =>
      validatePrivateFinancingEvent(paymentPostedEvent({ principalRemainingCentsAfter: { interestBearing: -1, zeroInterest: 0 } })),
    ).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects reversesEventId being set on a non-reversal event type", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ reversesEventId: "evt_0" }))).toThrow(/must not set reversesEventId/);
  });
});

describe("validatePrivateFinancingEvent -- truthful attribution (Decision 3)", () => {
  it("requires createdBy for an interactive_user event", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ createdBy: null }))).toThrow(/createdBy is required/);
  });

  it("forbids createdBy for a stripe_webhook event -- never impersonate the owner as the acting user", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.STRIPE_WEBHOOK, createdBy: "owner_1", sourceReference: "stripe:live:evt_abc" }),
      ),
    ).toThrow(/createdBy must be null/);
  });

  it("does not invent a fake auth user -- a webhook event with null createdBy and a sourceReference is valid", () => {
    const result = validatePrivateFinancingEvent(
      paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.STRIPE_WEBHOOK, createdBy: null, sourceReference: "stripe:live:evt_abc" }),
    );
    expect(result.createdBy).toBeNull();
    expect(result.eventOrigin).toBe("stripe_webhook");
  });

  it("requires sourceReference for a stripe_webhook event", () => {
    expect(() =>
      validatePrivateFinancingEvent(paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.STRIPE_WEBHOOK, createdBy: null })),
    ).toThrow(/sourceReference is required/);
  });

  it("requires idempotencyKey for manual_import and system_import events", () => {
    expect(() =>
      validatePrivateFinancingEvent(paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT, createdBy: null })),
    ).toThrow(/idempotencyKey is required/);
    expect(() =>
      validatePrivateFinancingEvent(paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.SYSTEM_IMPORT, createdBy: null })),
    ).toThrow(/idempotencyKey is required/);
  });

  it("accepts a manual_import event with an idempotencyKey and no createdBy", () => {
    const result = validatePrivateFinancingEvent(
      paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT, createdBy: null, idempotencyKey: "import-batch-7-row-12" }),
    );
    expect(result.idempotencyKey).toBe("import-batch-7-row-12");
  });

  it("forbids sourceReference and idempotencyKey on an interactive_user event", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ sourceReference: "stripe:live:evt_x" }))).toThrow(/sourceReference must be null/);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ idempotencyKey: "some-key" }))).toThrow(/idempotencyKey must be null/);
  });

  describe("manual_external -- a seller-confirmed off-platform payment (Venmo/Cash App/Zelle/etc.)", () => {
    function externalPaymentEvent(overrides = {}) {
      return paymentPostedEvent({
        eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL,
        createdBy: "11111111-1111-1111-1111-111111111111",
        sourceReference: "venmo:txn_9F3K2",
        idempotencyKey: "external-payment-acct_1-2026-08-23-51785",
        ...overrides,
      });
    }

    it("requires createdBy -- unlike manual_import, this is a real, interactive, attributable seller action", () => {
      expect(() => validatePrivateFinancingEvent(externalPaymentEvent({ createdBy: null }))).toThrow(/createdBy is required/);
    });

    it("requires sourceReference (the external transaction/reference number)", () => {
      expect(() => validatePrivateFinancingEvent(externalPaymentEvent({ sourceReference: null }))).toThrow(/sourceReference is required/);
    });

    it("requires idempotencyKey -- duplicate protection for a manually re-enterable off-platform payment", () => {
      expect(() => validatePrivateFinancingEvent(externalPaymentEvent({ idempotencyKey: null }))).toThrow(/idempotencyKey is required/);
    });

    it("accepts a well-formed manual_external event carrying createdBy, sourceReference, AND idempotencyKey together", () => {
      const result = validatePrivateFinancingEvent(externalPaymentEvent());
      expect(result.createdBy).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.sourceReference).toBe("venmo:txn_9F3K2");
      expect(result.idempotencyKey).toBe("external-payment-acct_1-2026-08-23-51785");
      expect(result.eventOrigin).toBe("manual_external");
    });

    it("is distinct from manual_import -- manual_import still forbids createdBy while manual_external requires it", () => {
      const manualImport = validatePrivateFinancingEvent(
        paymentPostedEvent({ eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT, createdBy: null, idempotencyKey: "import-row-1" }),
      );
      const manualExternal = validatePrivateFinancingEvent(externalPaymentEvent());
      expect(manualImport.createdBy).toBeNull();
      expect(manualExternal.createdBy).not.toBeNull();
    });
  });

  it("rejects an unrecognized eventOrigin -- closed enum, fails closed", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ eventOrigin: "some_other_origin" }))).toThrow(MalformedPrivateFinancingContractError);
  });
});

describe("validatePrivateFinancingEvent -- immutability at the JS layer", () => {
  it("rejects an event carrying updatedBy or updatedAt -- private_financing_events is never updated", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ updatedBy: "someone" }))).toThrow(/is immutable/);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ updatedAt: "2026-08-23T00:00:00.000Z" }))).toThrow(/is immutable/);
  });

  it("returns a frozen object on success", () => {
    const result = validatePrivateFinancingEvent(paymentPostedEvent());
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      result.amountCents = 999;
    }).toThrow();
  });
});

describe("validatePrivateFinancingEvent -- payment_reversal", () => {
  function reversalEvent(overrides = {}) {
    return baseEvent({
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      reversesEventId: "evt_original_payment",
      reason: "ACH payment bounced -- insufficient funds",
      amountCents: 51_785,
      allocation: {
        interestPaidCents: 11_452,
        interestBearingPrincipalPaidCents: 32_000,
        zeroInterestPrincipalPaidCents: 8_333,
        unallocatedCents: 0,
      },
      principalRemainingCentsAfter: { interestBearing: 4_500_000, zeroInterest: 1_000_000 },
      ...overrides,
    });
  }

  it("accepts a well-formed payment_reversal", () => {
    const result = validatePrivateFinancingEvent(reversalEvent());
    expect(result.reversesEventId).toBe("evt_original_payment");
  });

  it("requires reversesEventId", () => {
    expect(() => validatePrivateFinancingEvent(reversalEvent({ reversesEventId: null }))).toThrow(/requires reversesEventId/);
  });

  it("requires a non-empty reason -- never permit an adjustment to silently rewrite payment history", () => {
    expect(() => validatePrivateFinancingEvent(reversalEvent({ reason: null }))).toThrow(/requires a non-empty reason/);
  });
});

describe("validatePrivateFinancingEvent -- principal_correction", () => {
  function correctionEvent(overrides = {}) {
    return baseEvent({
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING,
      correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
      deltaCents: -138_690,
      correctedComponentPrincipalRemainingCentsAfter: 4_361_310,
      reason: "Owner-approved bring-current credit per accepted opening reconciliation",
      ...overrides,
    });
  }

  it("accepts a discretionary concession (the South Main bring-current credit shape)", () => {
    const result = validatePrivateFinancingEvent(correctionEvent());
    expect(result.correctionBasis).toBe("discretionary_concession");
    expect(result.deltaCents).toBe(-138_690);
  });

  it("accepts a contractual/administrative correction with a positive delta", () => {
    const result = validatePrivateFinancingEvent(
      correctionEvent({ correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE, deltaCents: 500, correctedComponentPrincipalRemainingCentsAfter: 4_500_500, reason: "Fixed a data-entry duplicate" }),
    );
    expect(result.correctionBasis).toBe("contractual_administrative");
  });

  it("rejects a zero deltaCents", () => {
    expect(() => validatePrivateFinancingEvent(correctionEvent({ deltaCents: 0 }))).toThrow(/non-zero integer deltaCents/);
  });

  it("rejects an unrecognized correctionBasis", () => {
    expect(() => validatePrivateFinancingEvent(correctionEvent({ correctionBasis: "because_i_felt_like_it" }))).toThrow(
      MalformedPrivateFinancingContractError,
    );
  });

  it("requires componentType", () => {
    expect(() => validatePrivateFinancingEvent(correctionEvent({ componentType: undefined }))).toThrow(/componentType to be one of/);
  });
});

describe("validatePrivateFinancingEvent -- interest_correction", () => {
  it("accepts a waiver (discretionary_concession) with no principal-balance field at all", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
        correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
        deltaCents: -2_000,
        reason: "Owner waived one month of interest as a goodwill gesture",
      }),
    );
    expect(result.deltaCents).toBe(-2_000);
    expect(result.correctedComponentPrincipalRemainingCentsAfter).toBeUndefined();
  });
});

describe("validatePrivateFinancingEvent -- compensating_correction", () => {
  it("accepts a correction reversing a prior principal_correction", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
        reversesEventId: "evt_wrong_correction",
        deltaCents: 138_690,
        componentType: PRIVATE_FINANCING_COMPONENT_TYPE.INTEREST_BEARING,
        reason: "The original bring-current credit was entered against the wrong component",
      }),
    );
    expect(result.reversesEventId).toBe("evt_wrong_correction");
  });
});

describe("validatePrivateFinancingEvent -- payoff_concession", () => {
  function payoffConcessionEvent(overrides = {}) {
    return baseEvent({
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
      interestBearingDeltaCents: -500,
      zeroInterestDeltaCents: 0,
      principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
      reason: "Final $5 forgiven to close the account cleanly",
      ...overrides,
    });
  }

  it("accepts a concession that brings both components to exactly 0", () => {
    const result = validatePrivateFinancingEvent(payoffConcessionEvent());
    expect(result.principalRemainingCentsAfter).toEqual({ interestBearing: 0, zeroInterest: 0 });
  });

  it("rejects a positive deltaCents on either component -- a concession only ever forgives, never adds", () => {
    expect(() => validatePrivateFinancingEvent(payoffConcessionEvent({ interestBearingDeltaCents: 500 }))).toThrow(
      /non-positive integer interestBearingDeltaCents/,
    );
  });

  it("rejects both deltas being zero", () => {
    expect(() => validatePrivateFinancingEvent(payoffConcessionEvent({ interestBearingDeltaCents: 0, zeroInterestDeltaCents: 0 }))).toThrow(
      /must forgive a non-zero amount/,
    );
  });

  it("rejects an after-balance that is not exactly {0, 0} -- bounded final adjustment only", () => {
    expect(() =>
      validatePrivateFinancingEvent(payoffConcessionEvent({ principalRemainingCentsAfter: { interestBearing: 1, zeroInterest: 0 } })),
    ).toThrow(/exactly 0/);
    expect(() =>
      validatePrivateFinancingEvent(payoffConcessionEvent({ principalRemainingCentsAfter: { interestBearing: -1, zeroInterest: 0 } })),
    ).toThrow(MalformedPrivateFinancingContractError);
  });
});

describe("validatePrivateFinancingEvent -- account_closed", () => {
  it("accepts paid_in_full with no payoffConcessionEventId", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({ eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED, closureReason: ACCOUNT_CLOSURE_REASON.PAID_IN_FULL }),
    );
    expect(result.payoffConcessionEventId).toBeNull();
  });

  it("requires payoffConcessionEventId when closureReason is payoff_concession_applied", () => {
    expect(() =>
      validatePrivateFinancingEvent(baseEvent({ eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED, closureReason: ACCOUNT_CLOSURE_REASON.PAYOFF_CONCESSION_APPLIED })),
    ).toThrow(/requires payoffConcessionEventId/);
  });

  it("rejects payoffConcessionEventId being set for any other closureReason", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        baseEvent({
          eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
          closureReason: ACCOUNT_CLOSURE_REASON.PAID_IN_FULL,
          payoffConcessionEventId: "evt_concession",
        }),
      ),
    ).toThrow(/must be null unless/);
  });
});

describe("validatePrivateFinancingEvent -- malformed input fails closed", () => {
  it("rejects a non-object", () => {
    expect(() => validatePrivateFinancingEvent(null)).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingEvent("not an event")).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects an unknown eventType", () => {
    expect(() => validatePrivateFinancingEvent(baseEvent({ eventType: "some_future_event_nobody_approved" }))).toThrow(
      MalformedPrivateFinancingContractError,
    );
  });

  it("rejects a malformed effectiveDate", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ effectiveDate: "08/23/2026" }))).toThrow(/effectiveDate must be a valid/);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ effectiveDate: "not-a-date" }))).toThrow(/effectiveDate must be a valid/);
  });

  it("rejects a non-integer or negative ledgerSequence", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ ledgerSequence: 1.5 }))).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ ledgerSequence: -1 }))).toThrow(MalformedPrivateFinancingContractError);
  });
});

describe("validatePrivateFinancingAccount", () => {
  function account(overrides = {}) {
    return {
      ownerId: "owner_1",
      id: "acct_1",
      product: "seller_financing",
      propertyId: "prop_1",
      status: "active",
      openedDate: "2022-03-23",
      originationPrincipalCents: 5_500_000,
      lateFeePolicy: "disabled",
      interestDayCountConvention: "actual_365",
      platformFeeCents: 0,
      feePayer: "lender",
      createdBy: null,
      updatedBy: null,
      ...overrides,
    };
  }

  it("accepts a well-formed account", () => {
    const result = validatePrivateFinancingAccount(account());
    expect(result.status).toBe("active");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects an unrecognized product", () => {
    expect(() => validatePrivateFinancingAccount(account({ product: "credit_card" }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a platformFeeCents outside 0-1000", () => {
    expect(() => validatePrivateFinancingAccount(account({ platformFeeCents: 1001 }))).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingAccount(account({ platformFeeCents: -1 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a non-positive originationPrincipalCents", () => {
    expect(() => validatePrivateFinancingAccount(account({ originationPrincipalCents: 0 }))).toThrow(MalformedPrivateFinancingContractError);
  });
});

describe("validatePrivateFinancingComponent", () => {
  function component(overrides = {}) {
    return {
      ownerId: "owner_1",
      id: "comp_1",
      accountId: "acct_1",
      componentType: "interest_bearing",
      originalPrincipalCents: 4_500_000,
      rateBps: 300,
      regularPaymentCents: 43_452,
      applicationPriority: 1,
      ...overrides,
    };
  }

  it("accepts a well-formed component", () => {
    const result = validatePrivateFinancingComponent(component());
    expect(result.componentType).toBe("interest_bearing");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a negative rateBps", () => {
    expect(() => validatePrivateFinancingComponent(component({ rateBps: -1 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a non-positive originalPrincipalCents", () => {
    expect(() => validatePrivateFinancingComponent(component({ originalPrincipalCents: 0 }))).toThrow(MalformedPrivateFinancingContractError);
  });
});
