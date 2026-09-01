import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYMENT_ACCEPTANCE_POLICY, PAYMENT_ACCEPTANCE_REJECTION_REASON, evaluatePaymentAcceptance } from "../paymentAcceptancePolicy.js";

// A fresh, valid, non-stale base call -- every test overrides only what it means to exercise.
const base = Object.freeze({
  requestedAmountCents: 51_785,
  amountDueCents: 51_785,
  extraPrincipalAllowed: false,
  amountDueAsOfLedgerSequence: 48,
  currentLedgerSequence: 48,
});

describe("evaluatePaymentAcceptance -- partial_allowed", () => {
  const policy = PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED;

  it("accepts less than amount due (partial accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 10_000, amountDueCents: 51_785 });
    expect(result).toEqual({ accepted: true, reasonCode: null });
  });

  it("accepts exactly the amount due (exact accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 51_785, amountDueCents: 51_785 });
    expect(result.accepted).toBe(true);
  });

  it("accepts more than amount due when extra principal is permitted (extra accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 60_000, amountDueCents: 51_785, extraPrincipalAllowed: true });
    expect(result.accepted).toBe(true);
  });

  it("rejects more than amount due when extra principal is not permitted (extra rejected)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 60_000, amountDueCents: 51_785, extraPrincipalAllowed: false });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.EXTRA_PRINCIPAL_NOT_PERMITTED });
  });
});

describe("evaluatePaymentAcceptance -- full_amount_or_more", () => {
  const policy = PAYMENT_ACCEPTANCE_POLICY.FULL_AMOUNT_OR_MORE;

  it("rejects less than amount due (partial rejected)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 10_000, amountDueCents: 51_785 });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_BELOW_DUE });
  });

  it("accepts exactly the amount due (exact accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 51_785, amountDueCents: 51_785 });
    expect(result.accepted).toBe(true);
  });

  it("accepts more when extra principal is permitted (extra accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 60_000, amountDueCents: 51_785, extraPrincipalAllowed: true });
    expect(result.accepted).toBe(true);
  });

  it("rejects more when extra principal is not permitted (extra rejected)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 60_000, amountDueCents: 51_785, extraPrincipalAllowed: false });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.EXTRA_PRINCIPAL_NOT_PERMITTED });
  });
});

describe("evaluatePaymentAcceptance -- exact_amount_only", () => {
  const policy = PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY;

  it("rejects less than amount due (partial rejected)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 10_000, amountDueCents: 51_785 });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_BELOW_DUE });
  });

  it("accepts exactly the amount due (exact accepted)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 51_785, amountDueCents: 51_785 });
    expect(result.accepted).toBe(true);
  });

  it("rejects more than amount due (extra rejected), even when extraPrincipalAllowed is true", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy, requestedAmountCents: 60_000, amountDueCents: 51_785, extraPrincipalAllowed: true });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_ABOVE_DUE });
  });
});

describe("evaluatePaymentAcceptance -- fail-closed on malformed/unknown input", () => {
  it("rejects an unknown policy string", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy: "some_other_policy" });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.UNKNOWN_POLICY });
  });

  it("rejects a missing policy (undefined)", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy: undefined });
    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.UNKNOWN_POLICY);
  });

  it("rejects a null policy", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy: null });
    expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.UNKNOWN_POLICY);
  });

  it("rejects a call with no arguments at all", () => {
    const result = evaluatePaymentAcceptance();
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.UNKNOWN_POLICY });
  });

  it("rejects a zero, negative, or non-integer requestedAmountCents", () => {
    for (const bad of [0, -100, 51_785.5, "51785", null, undefined]) {
      const result = evaluatePaymentAcceptance({ ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED, requestedAmountCents: bad });
      expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_REQUESTED_AMOUNT);
    }
  });

  it("rejects a negative or non-integer amountDueCents", () => {
    for (const bad of [-1, 51_785.5, "51785", null, undefined]) {
      const result = evaluatePaymentAcceptance({ ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED, amountDueCents: bad });
      expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_AMOUNT_DUE);
    }
  });

  it("accepts amountDueCents of exactly 0 (a fully paid-off account) as a valid, non-malformed input", () => {
    const result = evaluatePaymentAcceptance({
      ...base,
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      requestedAmountCents: 1,
      amountDueCents: 0,
    });
    expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_ABOVE_DUE);
  });

  it("rejects a non-boolean extraPrincipalAllowed", () => {
    for (const bad of ["true", 1, null, undefined]) {
      const result = evaluatePaymentAcceptance({ ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED, extraPrincipalAllowed: bad });
      expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_EXTRA_PRINCIPAL_FLAG);
    }
  });

  it("rejects a malformed ledger-state identity (non-integer, or less than -1)", () => {
    for (const bad of [1.5, "48", null, undefined, -2]) {
      const result = evaluatePaymentAcceptance({ ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED, amountDueAsOfLedgerSequence: bad });
      expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_LEDGER_STATE_IDENTITY);
    }
  });

  it("accepts -1 as a valid ledger-state identity (an account with no events posted yet)", () => {
    const result = evaluatePaymentAcceptance({
      ...base,
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      amountDueAsOfLedgerSequence: -1,
      currentLedgerSequence: -1,
    });
    expect(result.reasonCode).not.toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.INVALID_LEDGER_STATE_IDENTITY);
  });
});

describe("evaluatePaymentAcceptance -- staleness (as-of ledger-state identity)", () => {
  it("rejects a stale amount-due calculation when the ledger has moved since it was computed", () => {
    const result = evaluatePaymentAcceptance({
      ...base,
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      amountDueAsOfLedgerSequence: 47,
      currentLedgerSequence: 48,
    });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.STALE_AMOUNT_DUE });
  });

  it("proceeds to policy evaluation when the ledger-state identity matches (fresh due-state)", () => {
    const result = evaluatePaymentAcceptance({
      ...base,
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      amountDueAsOfLedgerSequence: 48,
      currentLedgerSequence: 48,
    });
    expect(result.reasonCode).not.toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.STALE_AMOUNT_DUE);
  });

  it("checks staleness before any policy-specific comparison -- a stale call is rejected even when the requested amount would otherwise be accepted", () => {
    const result = evaluatePaymentAcceptance({
      ...base,
      policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED,
      requestedAmountCents: 1,
      amountDueAsOfLedgerSequence: 10,
      currentLedgerSequence: 11,
    });
    expect(result.reasonCode).toBe(PAYMENT_ACCEPTANCE_REJECTION_REASON.STALE_AMOUNT_DUE);
  });
});

describe("evaluatePaymentAcceptance -- amount-due boundary (arrears included, fees excluded)", () => {
  it("honors an authoritative amountDueCents that already includes arrears -- the validator does not compute arrears itself", () => {
    // $400.00 current scheduled obligation + $150.00 valid arrears, already combined by the caller into
    // one authoritative figure before this validator ever sees it.
    const amountDueIncludingArrears = 40_000 + 15_000;
    const currentPeriodOnly = evaluatePaymentAcceptance({
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      requestedAmountCents: 40_000,
      amountDueCents: amountDueIncludingArrears,
      extraPrincipalAllowed: false,
      amountDueAsOfLedgerSequence: 12,
      currentLedgerSequence: 12,
    });
    expect(currentPeriodOnly).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_BELOW_DUE });

    const fullArrearsInclusive = evaluatePaymentAcceptance({
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      requestedAmountCents: amountDueIncludingArrears,
      amountDueCents: amountDueIncludingArrears,
      extraPrincipalAllowed: false,
      amountDueAsOfLedgerSequence: 12,
      currentLedgerSequence: 12,
    });
    expect(fullArrearsInclusive.accepted).toBe(true);
  });

  it("a fee-inflated requested amount is rejected -- amountDueCents must already exclude seller-paid processor fees", () => {
    // The seller's net-due figure is $400.00; a processor fee is never added on top of what counts as
    // "the amount due" for acceptance purposes -- the borrower's gross send amount is compared directly
    // against the fee-exclusive due figure the caller supplied.
    const feeExclusiveAmountDue = 40_000;
    const feeInflatedAttempt = feeExclusiveAmountDue + 200; // a hypothetical $2.00 processor fee added on top
    const result = evaluatePaymentAcceptance({
      policy: PAYMENT_ACCEPTANCE_POLICY.EXACT_AMOUNT_ONLY,
      requestedAmountCents: feeInflatedAttempt,
      amountDueCents: feeExclusiveAmountDue,
      extraPrincipalAllowed: false,
      amountDueAsOfLedgerSequence: 9,
      currentLedgerSequence: 9,
    });
    expect(result).toEqual({ accepted: false, reasonCode: PAYMENT_ACCEPTANCE_REJECTION_REASON.AMOUNT_ABOVE_DUE });
  });
});

describe("evaluatePaymentAcceptance -- purity and structural boundaries", () => {
  it("is pure: identical arguments always produce an identical (deep-equal) result", () => {
    const args = { ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED };
    expect(evaluatePaymentAcceptance(args)).toEqual(evaluatePaymentAcceptance(args));
  });

  it("never mutates its input object", () => {
    const args = { ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED };
    const snapshot = { ...args };
    evaluatePaymentAcceptance(args);
    expect(args).toEqual(snapshot);
  });

  it("returns a frozen result object", () => {
    const result = evaluatePaymentAcceptance({ ...base, policy: PAYMENT_ACCEPTANCE_POLICY.PARTIAL_ALLOWED });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not invent or duplicate a second balance/replay engine -- imports nothing from the calculation engine", () => {
    const source = readFileSync(resolve(process.cwd(), "src/domains/private-financing/paymentAcceptancePolicy.js"), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import "));
    expect(importLines).toEqual([]);
  });
});
