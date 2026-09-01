import { describe, expect, it } from "vitest";
import {
  validatePrivateFinancingEvent,
  validatePrivateFinancingAccount,
  validatePrivateFinancingComponent,
  MalformedPrivateFinancingContractError,
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  CORRECTION_BASIS,
  ACCOUNT_CLOSURE_REASON,
  PRIVATE_FINANCING_DAY_COUNT_CONVENTION,
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

// V1 Terms Generalization: allocation/principalRemaining fields are generic {[componentId]: cents} maps
// now, not two fixed named keys -- this fixture uses two components ("note_a", "note_b") purely as an
// EXAMPLE shape, never as evidence the contract requires exactly two.
function paymentPostedEvent(overrides = {}) {
  return baseEvent({
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
    amountCents: 51_785,
    allocation: {
      interestPaidByComponentCents: { note_a: 11_452 },
      principalPaidByComponentCents: { note_a: 32_000, note_b: 8_333 },
      unallocatedCents: 0,
    },
    principalRemainingByComponentCents: { note_a: 4_468_000, note_b: 991_667 },
    ...overrides,
  });
}

describe("validatePrivateFinancingEvent -- account_opened", () => {
  it("accepts a well-formed account_opened event -- a pure lifecycle marker with no embedded terms", () => {
    const result = validatePrivateFinancingEvent(baseEvent({ eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED }));
    expect(result.eventType).toBe("account_opened");
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("validatePrivateFinancingEvent -- payment_posted", () => {
  it("accepts a well-formed payment with an allocation that sums exactly to amountCents, across any number of components", () => {
    const result = validatePrivateFinancingEvent(paymentPostedEvent());
    expect(result.amountCents).toBe(51_785);
    expect(Object.isFrozen(result.allocation)).toBe(true);
    expect(Object.isFrozen(result.principalRemainingByComponentCents)).toBe(true);
  });

  it("accepts a single-component payment (interest-only or zero-interest-only account)", () => {
    const result = validatePrivateFinancingEvent(
      paymentPostedEvent({
        allocation: { interestPaidByComponentCents: { only: 1_000 }, principalPaidByComponentCents: { only: 5_000 }, unallocatedCents: 0 },
        principalRemainingByComponentCents: { only: 95_000 },
        amountCents: 6_000,
      }),
    );
    expect(result.amountCents).toBe(6_000);
  });

  it("accepts a three-component payment -- V1 imposes no maximum component count", () => {
    const result = validatePrivateFinancingEvent(
      paymentPostedEvent({
        allocation: {
          interestPaidByComponentCents: { a: 100, b: 50 },
          principalPaidByComponentCents: { a: 200, b: 100, c: 50 },
          unallocatedCents: 0,
        },
        principalRemainingByComponentCents: { a: 1, b: 2, c: 3 },
        amountCents: 500,
      }),
    );
    expect(Object.keys(result.principalRemainingByComponentCents)).toHaveLength(3);
  });

  it("rejects an allocation that does not sum exactly to amountCents -- no event may manufacture or lose money", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        paymentPostedEvent({
          allocation: { interestPaidByComponentCents: { note_a: 11_452 }, principalPaidByComponentCents: { note_a: 32_000, note_b: 8_000 }, unallocatedCents: 0 },
        }),
      ),
    ).toThrow(/must sum exactly/);
  });

  it("rejects a non-positive amountCents", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ amountCents: 0 }))).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ amountCents: -100 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a negative principalRemainingByComponentCents entry", () => {
    expect(() =>
      validatePrivateFinancingEvent(paymentPostedEvent({ principalRemainingByComponentCents: { note_a: -1, note_b: 0 } })),
    ).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects reversesEventId being set on a non-reversal event type", () => {
    expect(() => validatePrivateFinancingEvent(paymentPostedEvent({ reversesEventId: "evt_0" }))).toThrow(/must not set reversesEventId/);
  });

  it("accepts an optional selectedExtraComponentId (selected_component_extra policy)", () => {
    const result = validatePrivateFinancingEvent(paymentPostedEvent({ selectedExtraComponentId: "note_a" }));
    expect(result.selectedExtraComponentId).toBe("note_a");
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
        interestPaidByComponentCents: { note_a: 11_452 },
        principalPaidByComponentCents: { note_a: 32_000, note_b: 8_333 },
        unallocatedCents: 0,
      },
      principalRemainingByComponentCents: { note_a: 4_500_000, note_b: 1_000_000 },
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
      componentId: "note_a",
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
    expect(result.componentId).toBe("note_a");
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

  it("requires componentId -- a free-form, account-specific identity, never a fixed enum of two", () => {
    expect(() => validatePrivateFinancingEvent(correctionEvent({ componentId: undefined }))).toThrow(/requires a non-empty componentId/);
    expect(() => validatePrivateFinancingEvent(correctionEvent({ componentId: "" }))).toThrow(/requires a non-empty componentId/);
  });

  it("accepts any non-empty componentId string -- component existence is a replay-time concern, not a shape-time one", () => {
    const result = validatePrivateFinancingEvent(correctionEvent({ componentId: "some_arbitrary_component_key" }));
    expect(result.componentId).toBe("some_arbitrary_component_key");
  });
});

describe("validatePrivateFinancingEvent -- interest_correction", () => {
  it("accepts a waiver (discretionary_concession) naming which component's accrued interest it adjusts", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
        componentId: "note_a",
        correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
        deltaCents: -2_000,
        reason: "Owner waived one month of interest as a goodwill gesture",
      }),
    );
    expect(result.deltaCents).toBe(-2_000);
    expect(result.componentId).toBe("note_a");
    expect(result.correctedComponentPrincipalRemainingCentsAfter).toBeUndefined();
  });

  it("requires componentId -- interest now accrues independently per component, never one shared bucket", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        baseEvent({
          eventType: PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
          correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
          deltaCents: -100,
          reason: "typo",
        }),
      ),
    ).toThrow(/requires a non-empty componentId/);
  });
});

describe("validatePrivateFinancingEvent -- compensating_correction", () => {
  it("accepts a correction reversing a prior principal_correction", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
        reversesEventId: "evt_wrong_correction",
        deltaCents: 138_690,
        componentId: "note_a",
        reason: "The original bring-current credit was entered against the wrong component",
      }),
    );
    expect(result.reversesEventId).toBe("evt_wrong_correction");
  });

  it("accepts a null componentId -- resolved from the target event at replay time when reversing an interest_correction", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
        reversesEventId: "evt_wrong_interest_correction",
        deltaCents: 2_000,
        reason: "The original waiver was granted in error",
      }),
    );
    expect(result.componentId).toBeNull();
  });
});

describe("validatePrivateFinancingEvent -- payoff_concession", () => {
  function payoffConcessionEvent(overrides = {}) {
    return baseEvent({
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
      deltaCentsByComponentCents: { note_a: -500, note_b: 0 },
      principalRemainingByComponentCents: { note_a: 0, note_b: 0 },
      reason: "Final $5 forgiven to close the account cleanly",
      ...overrides,
    });
  }

  it("accepts a concession that brings every component to exactly 0", () => {
    const result = validatePrivateFinancingEvent(payoffConcessionEvent());
    expect(result.principalRemainingByComponentCents).toEqual({ note_a: 0, note_b: 0 });
  });

  it("accepts a single-component payoff concession", () => {
    const result = validatePrivateFinancingEvent(
      payoffConcessionEvent({ deltaCentsByComponentCents: { only: -100 }, principalRemainingByComponentCents: { only: 0 } }),
    );
    expect(result.principalRemainingByComponentCents).toEqual({ only: 0 });
  });

  it("rejects a positive delta on any component -- a concession only ever forgives, never adds", () => {
    expect(() => validatePrivateFinancingEvent(payoffConcessionEvent({ deltaCentsByComponentCents: { note_a: 500, note_b: 0 } }))).toThrow(
      /must be zero or negative/,
    );
  });

  it("rejects every delta being zero", () => {
    expect(() => validatePrivateFinancingEvent(payoffConcessionEvent({ deltaCentsByComponentCents: { note_a: 0, note_b: 0 } }))).toThrow(
      /must forgive a non-zero amount/,
    );
  });

  it("rejects an after-balance that is not exactly 0 on every component -- bounded final adjustment only", () => {
    expect(() =>
      validatePrivateFinancingEvent(payoffConcessionEvent({ principalRemainingByComponentCents: { note_a: 1, note_b: 0 } })),
    ).toThrow(/must be exactly 0/);
    expect(() =>
      validatePrivateFinancingEvent(payoffConcessionEvent({ principalRemainingByComponentCents: { note_a: -1, note_b: 0 } })),
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

  it("accepts a personal_loan account", () => {
    const result = validatePrivateFinancingAccount(account({ product: "personal_loan", propertyId: null }));
    expect(result.product).toBe("personal_loan");
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
      componentKey: "note_a",
      label: "Primary note",
      originalPrincipalCents: 4_500_000,
      rateBps: 300,
      dayCountConvention: PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365,
      scheduledComponentAmountCents: 43_452,
      allocationPriority: 1,
      effectiveDate: "2022-03-23",
      versionNumber: 1,
      ...overrides,
    };
  }

  it("accepts a well-formed component", () => {
    const result = validatePrivateFinancingComponent(component());
    expect(result.componentKey).toBe("note_a");
    expect(result.label).toBe("Primary note");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts a zero-rate component -- a zero-interest component is one possible component, never required", () => {
    const result = validatePrivateFinancingComponent(component({ componentKey: "note_zero", rateBps: 0 }));
    expect(result.rateBps).toBe(0);
  });

  it("rejects a negative rateBps", () => {
    expect(() => validatePrivateFinancingComponent(component({ rateBps: -1 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects a non-positive originalPrincipalCents", () => {
    expect(() => validatePrivateFinancingComponent(component({ originalPrincipalCents: 0 }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects an empty componentKey or label", () => {
    expect(() => validatePrivateFinancingComponent(component({ componentKey: "" }))).toThrow(MalformedPrivateFinancingContractError);
    expect(() => validatePrivateFinancingComponent(component({ label: "" }))).toThrow(MalformedPrivateFinancingContractError);
  });

  it("rejects an unsupported dayCountConvention -- fails closed", () => {
    expect(() => validatePrivateFinancingComponent(component({ dayCountConvention: "thirty_360" }))).toThrow(MalformedPrivateFinancingContractError);
  });
});
