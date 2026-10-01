import { describe, expect, it } from "vitest";
import {
  checkPaymentAmountAgainstPolicy,
  DEFAULT_PAYMENT_POLICY,
  isPaymentPolicy,
  minimumPaymentCents,
  PAYMENT_POLICIES,
  paymentPolicyDescription,
  paymentPolicyIsOverride,
  paymentPolicyLabel,
  paymentPolicyTenantExplanation,
  resolveEffectivePaymentPolicy,
} from "../paymentPolicy.js";

describe("payment policy domain", () => {
  describe("policy identity", () => {
    it("defines exactly the three Rentec policy modes with a permissive default", () => {
      expect(PAYMENT_POLICIES).toEqual(["allow_any_amount", "require_rent", "require_balance"]);
      expect(DEFAULT_PAYMENT_POLICY).toBe("allow_any_amount");
    });
    it("recognizes only the three modes", () => {
      expect(isPaymentPolicy("allow_any_amount")).toBe(true);
      expect(isPaymentPolicy("require_rent")).toBe(true);
      expect(isPaymentPolicy("require_balance")).toBe(true);
      expect(isPaymentPolicy(null)).toBe(false);
      expect(isPaymentPolicy("require_half_rent")).toBe(false);
      expect(isPaymentPolicy("")).toBe(false);
    });
    it("labels and describes each mode in plain English", () => {
      for (const policy of PAYMENT_POLICIES) {
        expect(paymentPolicyLabel(policy)).toBeTruthy();
        expect(paymentPolicyDescription(policy)).toBeTruthy();
        expect(paymentPolicyLabel(policy)).not.toBe(policy);
      }
      expect(paymentPolicyLabel("allow_any_amount")).toBe("Allow any amount");
      expect(paymentPolicyLabel("require_rent")).toBe("Require one month's rent");
      expect(paymentPolicyLabel("require_balance")).toBe("Require full balance");
    });
    it("explains the rule to the tenant with the concrete minimum", () => {
      expect(paymentPolicyTenantExplanation("require_rent", 160000)).toBe(
        "Your payment must be at least one month's rent ($1,600.00).");
      expect(paymentPolicyTenantExplanation("require_balance", 240050)).toBe(
        "Your payment must cover the full balance of $2,400.50.");
    });
  });

  describe("effective policy resolution", () => {
    it("lets the tenant override beat the workspace default", () => {
      expect(resolveEffectivePaymentPolicy("require_balance", "allow_any_amount")).toBe("require_balance");
      expect(resolveEffectivePaymentPolicy("allow_any_amount", "require_balance")).toBe("allow_any_amount");
    });
    it("inherits the workspace default when the tenant override is null", () => {
      expect(resolveEffectivePaymentPolicy(null, "require_rent")).toBe("require_rent");
      expect(resolveEffectivePaymentPolicy(undefined, "require_balance")).toBe("require_balance");
    });
    it("falls back to the permissive default when nothing is configured", () => {
      expect(resolveEffectivePaymentPolicy(null, null)).toBe("allow_any_amount");
      expect(resolveEffectivePaymentPolicy(null, "bogus")).toBe("allow_any_amount");
      expect(resolveEffectivePaymentPolicy("bogus", "also-bogus")).toBe("allow_any_amount");
    });
    it("reports whether a tenant-level override is active", () => {
      expect(paymentPolicyIsOverride("require_rent")).toBe(true);
      expect(paymentPolicyIsOverride(null)).toBe(false);
      expect(paymentPolicyIsOverride("bogus")).toBe(false);
    });
  });

  describe("minimum payment", () => {
    it("has no minimum for allow_any_amount", () => {
      expect(minimumPaymentCents("allow_any_amount", 160000, 240000)).toBe(1);
    });
    it("requires one month's rent for require_rent", () => {
      expect(minimumPaymentCents("require_rent", 160000, 240000)).toBe(160000);
    });
    it("requires the full balance for require_balance", () => {
      expect(minimumPaymentCents("require_balance", 160000, 240000)).toBe(240000);
    });
    it("fails open to any positive amount when the reference is missing", () => {
      expect(minimumPaymentCents("require_rent", null, 240000)).toBe(1);
      expect(minimumPaymentCents("require_balance", 160000, 0)).toBe(1);
      expect(minimumPaymentCents("require_balance", 160000, -50)).toBe(1);
    });
  });

  describe("amount gate", () => {
    it("allow_any_amount accepts any positive amount", () => {
      expect(checkPaymentAmountAgainstPolicy({ policy: "allow_any_amount", amountCents: 1, rentCents: 160000, balanceCents: 320000 })).toEqual({ ok: true });
      expect(checkPaymentAmountAgainstPolicy({ policy: "allow_any_amount", amountCents: 999999, rentCents: 160000, balanceCents: 320000 })).toEqual({ ok: true });
    });
    it("require_rent rejects a partial below one month's rent with a plain-English message", () => {
      const result = checkPaymentAmountAgainstPolicy({ policy: "require_rent", amountCents: 159999, rentCents: 160000, balanceCents: 320000 });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Your payment must be at least one month's rent ($1,600.00).");
    });
    it("require_rent accepts exactly one month's rent (boundary)", () => {
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_rent", amountCents: 160000, rentCents: 160000, balanceCents: 320000 })).toEqual({ ok: true });
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_rent", amountCents: 160001, rentCents: 160000, balanceCents: 320000 })).toEqual({ ok: true });
    });
    it("require_balance rejects a partial below the full balance with a plain-English message", () => {
      const result = checkPaymentAmountAgainstPolicy({ policy: "require_balance", amountCents: 239999, rentCents: 160000, balanceCents: 240000 });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Your payment must cover the full balance of $2,400.00.");
    });
    it("require_balance accepts exactly the full balance (boundary)", () => {
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_balance", amountCents: 240000, rentCents: 160000, balanceCents: 240000 })).toEqual({ ok: true });
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_balance", amountCents: 240001, rentCents: 160000, balanceCents: 240000 })).toEqual({ ok: true });
    });
    it("require_balance is measured against the full outstanding balance, not one charge", () => {
      // Tenant pays one $1,600 charge in full but owes $3,200 total.
      const result = checkPaymentAmountAgainstPolicy({ policy: "require_balance", amountCents: 160000, rentCents: 160000, balanceCents: 320000 });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Your payment must cover the full balance of $3,200.00.");
    });
    it("rejects non-positive amounts before any policy math", () => {
      for (const policy of PAYMENT_POLICIES) {
        const zero = checkPaymentAmountAgainstPolicy({ policy, amountCents: 0, rentCents: 160000, balanceCents: 320000 });
        expect(zero.ok).toBe(false);
        expect(zero.message).toBe("A positive payment amount is required.");
      }
    });
    it("fails open to any positive amount when the reference is unknown", () => {
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_rent", amountCents: 5000, rentCents: null, balanceCents: 320000 })).toEqual({ ok: true });
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_balance", amountCents: 5000, rentCents: 160000, balanceCents: null })).toEqual({ ok: true });
    });
    it("treats an unrecognized policy as the permissive default", () => {
      expect(checkPaymentAmountAgainstPolicy({ policy: "require_everything", amountCents: 5000, rentCents: 160000, balanceCents: 320000 })).toEqual({ ok: true });
    });
  });
});
