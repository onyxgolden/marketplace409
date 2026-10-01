import { describe, expect, it } from "vitest";
import { canReissuePayment, validateReissueInput } from "./vendorPayments";

// R18 (rentec-parity): re-issue voided vendor payments.

function voidedPayment(overrides = {}) {
  return {
    id: "rental_vendor_payment_1",
    vendor_id: "rental_vendor_1",
    payment_date: "2026-09-30",
    payment_method: "check",
    amount_cents: 25000,
    check_number: "1042",
    memo: "plumbing",
    status: "voided",
    void_reason: "lost in the mail",
    voided_at: "2026-10-01",
    ...overrides,
  };
}

describe("canReissuePayment", () => {
  it("allows re-issuing a voided payment", () => {
    expect(canReissuePayment(voidedPayment())).toBe(true);
  });

  it("refuses active and reversed payments", () => {
    expect(canReissuePayment(voidedPayment({ status: "active" }))).toBe(false);
    expect(canReissuePayment(voidedPayment({ status: "reversed" }))).toBe(false);
  });
});

describe("validateReissueInput", () => {
  it("accepts a fresh check number with a reason", () => {
    const result = validateReissueInput(
      { checkNumber: "1043", paymentDate: "2026-10-02", memo: "reprint", reason: "lost in mail" },
      voidedPayment()
    );
    expect(result.valid).toBe(true);
    expect(result.value).toMatchObject({
      reason: "lost in mail",
      checkNumber: "1043",
      paymentDate: "2026-10-02",
      memo: "reprint",
    });
  });

  it("requires a new check number for checks", () => {
    const result = validateReissueInput({ checkNumber: "  ", reason: "x" }, voidedPayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/new check number/i);
  });

  it("blocks reusing the voided check's number", () => {
    const result = validateReissueInput({ checkNumber: "1042", reason: "x" }, voidedPayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cannot reuse/i);
  });

  it("does not require a check number for ACH", () => {
    const ach = voidedPayment({ payment_method: "ach", check_number: null });
    const result = validateReissueInput({ reason: "ACH failed" }, ach);
    expect(result.valid).toBe(true);
    expect(result.value.checkNumber).toBeUndefined();
  });

  it("rejects invalid payment dates", () => {
    expect(validateReissueInput({ checkNumber: "1043", paymentDate: "Oct 2", reason: "x" }, voidedPayment()).valid).toBe(false);
  });

  it("requires a reason", () => {
    const result = validateReissueInput({ checkNumber: "1043" }, voidedPayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/reason/i);
  });

  it("refuses non-voided payments", () => {
    const result = validateReissueInput({ checkNumber: "1043", reason: "x" }, voidedPayment({ status: "active" }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/voided/i);
  });
});
