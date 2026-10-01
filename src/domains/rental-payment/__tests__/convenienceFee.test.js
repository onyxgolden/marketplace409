import { describe, expect, it } from "vitest";
import {
  autopayFeeCents,
  checkFeeAgreement,
  convenienceFeeCents,
  feeAgreementText,
  feeLineText,
  formatFeePercent,
  isFeeBasisPoints,
  isFeeEnabled,
  resolveFeeBasisPoints,
  validateFeeInput,
} from "../convenienceFee.js";

describe("convenienceFee domain", () => {
  it("computes 2.95% of $1600 as exactly $47.20 (whole cents, no float drift)", () => {
    expect(convenienceFeeCents(160000, 295)).toBe(4720);
  });

  it("computes 3.5% of $1600 as exactly $56.00", () => {
    expect(convenienceFeeCents(160000, 350)).toBe(5600);
  });

  it("rounds half-cents up to a whole cent (no fractional cents)", () => {
    // 2.95% of $10.01 = 29.5295c -> 30c
    expect(convenienceFeeCents(1001, 295)).toBe(30);
    // 2.95% of $1.00 = 2.95c -> 3c
    expect(convenienceFeeCents(100, 295)).toBe(3);
  });

  it("returns 0 for a disabled fee, bad rent, or bad rate", () => {
    expect(convenienceFeeCents(160000, 0)).toBe(0);
    expect(convenienceFeeCents(160000, null)).toBe(0);
    expect(convenienceFeeCents(160000, undefined)).toBe(0);
    expect(convenienceFeeCents(160000, -50)).toBe(0);
    expect(convenienceFeeCents(0, 295)).toBe(0);
    expect(convenienceFeeCents(-100, 295)).toBe(0);
    expect(convenienceFeeCents(100.5, 295)).toBe(0);
  });

  it("caps the rate at 100% (10000 bps)", () => {
    expect(isFeeBasisPoints(10000)).toBe(true);
    expect(isFeeBasisPoints(10001)).toBe(false);
    expect(isFeeBasisPoints(-1)).toBe(false);
    expect(isFeeBasisPoints(2.5)).toBe(false);
  });

  it("fails safe to OFF on missing or corrupt stored rates", () => {
    expect(resolveFeeBasisPoints(null)).toBe(0);
    expect(resolveFeeBasisPoints(undefined)).toBe(0);
    expect(resolveFeeBasisPoints("oops")).toBe(0);
    expect(resolveFeeBasisPoints(99999)).toBe(0);
    expect(resolveFeeBasisPoints("295")).toBe(295);
    expect(isFeeEnabled(0)).toBe(false);
    expect(isFeeEnabled(null)).toBe(false);
    expect(isFeeEnabled(295)).toBe(true);
  });

  it("formats percents without float artifacts", () => {
    expect(formatFeePercent(295)).toBe("2.95%");
    expect(formatFeePercent(350)).toBe("3.5%");
    expect(formatFeePercent(300)).toBe("3%");
    expect(formatFeePercent(0)).toBe("0%");
    expect(formatFeePercent(5)).toBe("0.05%");
  });

  it("validates owner settings input with plain-English errors", () => {
    expect(validateFeeInput("2.95")).toEqual({ ok: true, bps: 295 });
    expect(validateFeeInput(3.5)).toEqual({ ok: true, bps: 350 });
    expect(validateFeeInput("")).toEqual({ ok: true, bps: 0 });
    expect(validateFeeInput(null)).toEqual({ ok: true, bps: 0 });
    expect(validateFeeInput("0")).toEqual({ ok: true, bps: 0 });
    expect(validateFeeInput("-1").ok).toBe(false);
    expect(validateFeeInput("101").ok).toBe(false);
    expect(validateFeeInput("2.955").ok).toBe(false);
    expect(validateFeeInput("abc").ok).toBe(false);
    expect(validateFeeInput("2.955").message).toMatch(/two decimal places/);
    expect(validateFeeInput("-1").message).toMatch(/between 0 and 100/);
  });

  it("writes Brandy-readable fee lines and agreement copy", () => {
    expect(feeLineText(160000, 295)).toBe("Card convenience fee (2.95%): $47.20");
    const agreement = feeAgreementText(160000, 295);
    expect(agreement).toContain("$47.20");
    expect(agreement).toContain("2.95%");
    expect(agreement).toContain("ACH");
    expect(agreement).toContain("not rent");
  });

  describe("checkFeeAgreement (server gate)", () => {
    const rent = { rentCents: 160000, feeBps: 295, cardPaymentsEnabled: true };

    it("requires explicit agreement when a card fee is enabled (422)", () => {
      const result = checkFeeAgreement({ ...rent, methodType: "card", feeAgreed: false, expectedFeeCents: 4720 });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(422);
      expect(result.message).toMatch(/check the box/);
      expect(result.message).toContain("$47.20");
    });

    it("rejects a mismatched expected fee (422) so the client can never set the amount", () => {
      const result = checkFeeAgreement({ ...rent, methodType: "card", feeAgreed: true, expectedFeeCents: 100 });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(422);
      expect(result.message).toMatch(/changed while you were reviewing/);
    });

    it("accepts a card payment with agreement and the server-computed fee", () => {
      const result = checkFeeAgreement({ ...rent, methodType: "card", feeAgreed: true, expectedFeeCents: 4720 });
      expect(result).toEqual({ ok: true, feeCents: 4720 });
    });

    it("accepts a card payment with agreement when the client echoes nothing", () => {
      const result = checkFeeAgreement({ ...rent, methodType: "card", feeAgreed: true });
      expect(result).toEqual({ ok: true, feeCents: 4720 });
    });

    it("never charges a fee on ACH and needs no agreement", () => {
      expect(checkFeeAgreement({ ...rent, methodType: "us_bank_account" })).toEqual({ ok: true, feeCents: 0 });
      expect(checkFeeAgreement({ ...rent, methodType: "us_bank_account", feeAgreed: false })).toEqual({ ok: true, feeCents: 0 });
    });

    it("charges no fee and needs no agreement when the workspace fee is off", () => {
      expect(checkFeeAgreement({ ...rent, feeBps: 0, methodType: "card", feeAgreed: false })).toEqual({ ok: true, feeCents: 0 });
      expect(checkFeeAgreement({ ...rent, feeBps: null, methodType: "card" })).toEqual({ ok: true, feeCents: 0 });
    });

    it("fails closed when the method is missing but a fee is enabled (400)", () => {
      const result = checkFeeAgreement({ ...rent, methodType: undefined });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    });

    it("defaults to no fee when the method is missing and the fee is off (legacy callers)", () => {
      expect(checkFeeAgreement({ ...rent, feeBps: 0, methodType: undefined })).toEqual({ ok: true, feeCents: 0 });
    });

    it("rejects card when the landlord account does not offer it", () => {
      const result = checkFeeAgreement({ ...rent, methodType: "card", cardPaymentsEnabled: false });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not enabled/);
    });
  });

  describe("autopayFeeCents", () => {
    it("never charges a fee on ACH autopay", () => {
      expect(autopayFeeCents({ paymentMethodType: "us_bank_account", consentBps: 295, workspaceBps: 295, rentCents: 160000 })).toBe(0);
    });

    it("charges no fee on card autopay without consent", () => {
      expect(autopayFeeCents({ paymentMethodType: "card", consentBps: null, workspaceBps: 295, rentCents: 160000 })).toBe(0);
      expect(autopayFeeCents({ paymentMethodType: "card", consentBps: 0, workspaceBps: 295, rentCents: 160000 })).toBe(0);
    });

    it("charges the consented rate on card autopay when the owner later raises the rate", () => {
      expect(autopayFeeCents({ paymentMethodType: "card", consentBps: 295, workspaceBps: 350, rentCents: 160000 })).toBe(4720);
    });

    it("caps at the current workspace rate when the owner lowers it", () => {
      expect(autopayFeeCents({ paymentMethodType: "card", consentBps: 295, workspaceBps: 200, rentCents: 160000 })).toBe(3200);
    });

    it("charges no fee when the owner turned the fee off after consent", () => {
      expect(autopayFeeCents({ paymentMethodType: "card", consentBps: 295, workspaceBps: 0, rentCents: 160000 })).toBe(0);
    });
  });
});
