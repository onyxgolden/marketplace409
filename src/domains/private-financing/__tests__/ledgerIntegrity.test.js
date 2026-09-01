import { describe, expect, it } from "vitest";
import {
  validateReversalReference,
  assertIdempotencyKeyIsUnique,
  assertPaymentAttemptIsPostable,
  LedgerIntegrityViolationError,
  PAYMENT_ATTEMPT_STATUS,
} from "../ledgerIntegrity.js";
import { PRIVATE_FINANCING_EVENT_TYPE } from "../privateFinancingContracts.js";

function paymentPosted(overrides = {}) {
  return {
    id: "evt_payment",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
    effectiveDate: "2026-08-23",
    ...overrides,
  };
}

function paymentReversal(overrides = {}) {
  return {
    id: "evt_reversal",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
    reversesEventId: "evt_payment",
    effectiveDate: "2026-08-24",
    ...overrides,
  };
}

describe("validateReversalReference", () => {
  it("accepts a payment_reversal correctly targeting a payment_posted event", () => {
    expect(() => validateReversalReference(paymentReversal(), paymentPosted(), [])).not.toThrow();
  });

  it("rejects a payment_reversal targeting a non-payment event", () => {
    const target = { id: "evt_correction", ownerId: "owner_1", accountId: "acct_1", eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION, effectiveDate: "2026-08-01" };
    expect(() => validateReversalReference(paymentReversal({ reversesEventId: "evt_correction" }), target, [])).toThrow(
      /cannot reverse a principal_correction/,
    );
  });

  it("rejects a compensating_correction targeting a payment_posted event -- that's payment_reversal's job", () => {
    const reversal = {
      id: "evt_comp",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
      reversesEventId: "evt_payment",
      effectiveDate: "2026-08-24",
    };
    expect(() => validateReversalReference(reversal, paymentPosted(), [])).toThrow(/cannot reverse a payment_posted/);
  });

  it("rejects a non-reversal event type being passed as the reversal", () => {
    expect(() => validateReversalReference(paymentPosted(), paymentPosted(), [])).toThrow(/is not a reversal-type event/);
  });

  it("rejects when the target does not exist", () => {
    expect(() => validateReversalReference(paymentReversal(), null, [])).toThrow(/does not reference an existing event/);
  });

  it("rejects when target.id does not match reversesEventId", () => {
    expect(() => validateReversalReference(paymentReversal(), paymentPosted({ id: "evt_different" }), [])).toThrow(
      /target event id does not match/,
    );
  });

  it("rejects a reversal crossing owner boundaries", () => {
    expect(() => validateReversalReference(paymentReversal(), paymentPosted({ ownerId: "owner_2" }), [])).toThrow(/cross owner boundaries/);
  });

  it("rejects a reversal crossing financing-account boundaries", () => {
    expect(() => validateReversalReference(paymentReversal(), paymentPosted({ accountId: "acct_2" }), [])).toThrow(
      /cross financing-account boundaries/,
    );
  });

  it("rejects a reversal effectiveDate earlier than the target's -- cannot undo something before it happened", () => {
    expect(() => validateReversalReference(paymentReversal({ effectiveDate: "2026-08-01" }), paymentPosted({ effectiveDate: "2026-08-23" }), [])).toThrow(
      /cannot be earlier than/,
    );
  });

  it("accepts a same-day reversal (effectiveDate equal to the target's)", () => {
    expect(() =>
      validateReversalReference(paymentReversal({ effectiveDate: "2026-08-23" }), paymentPosted({ effectiveDate: "2026-08-23" }), []),
    ).not.toThrow();
  });

  it("rejects reversing the same event twice", () => {
    const target = paymentPosted();
    const priorEvents = [paymentReversal({ id: "evt_first_reversal" })]; // already reverses evt_payment
    expect(() => validateReversalReference(paymentReversal({ id: "evt_second_reversal" }), target, priorEvents)).toThrow(
      /has already been reversed/,
    );
  });

  it("throws a LedgerIntegrityViolationError specifically", () => {
    try {
      validateReversalReference(paymentReversal(), null, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerIntegrityViolationError);
    }
  });
});

describe("assertIdempotencyKeyIsUnique", () => {
  it("allows a candidate with a null idempotencyKey through (interactive_user events never carry one)", () => {
    expect(() => assertIdempotencyKeyIsUnique({ idempotencyKey: null }, [{ idempotencyKey: "some-key" }])).not.toThrow();
  });

  it("rejects a duplicate idempotencyKey on the same account", () => {
    const candidate = { id: "evt_new", idempotencyKey: "import-batch-7-row-12" };
    const priorEvents = [{ id: "evt_old", idempotencyKey: "import-batch-7-row-12" }];
    expect(() => assertIdempotencyKeyIsUnique(candidate, priorEvents)).toThrow(/duplicate submission rejected/);
  });

  it("allows the same idempotencyKey to be reused on a genuinely different account -- caller must scope priorEvents itself", () => {
    // This function only checks what it's given; scoping to "same account" is the caller's job
    // (privateFinancingContracts' accountId is what makes two events "the same account" in practice).
    // Passing an empty priorEvents list here simulates that correct account-scoped call.
    const candidate = { id: "evt_new", idempotencyKey: "import-batch-7-row-12" };
    expect(() => assertIdempotencyKeyIsUnique(candidate, [])).not.toThrow();
  });
});

describe("assertPaymentAttemptIsPostable", () => {
  it("allows only succeeded", () => {
    expect(() => assertPaymentAttemptIsPostable(PAYMENT_ATTEMPT_STATUS.SUCCEEDED)).not.toThrow();
  });

  it("rejects every non-succeeded lifecycle status", () => {
    for (const status of [
      PAYMENT_ATTEMPT_STATUS.INITIATED,
      PAYMENT_ATTEMPT_STATUS.PENDING,
      PAYMENT_ATTEMPT_STATUS.FAILED,
      PAYMENT_ATTEMPT_STATUS.CANCELED,
      PAYMENT_ATTEMPT_STATUS.REFUNDED,
      PAYMENT_ATTEMPT_STATUS.DISPUTED,
    ]) {
      expect(() => assertPaymentAttemptIsPostable(status)).toThrow(LedgerIntegrityViolationError);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => assertPaymentAttemptIsPostable("processing_via_carrier_pigeon")).toThrow(/Unknown payment attempt status/);
  });
});
