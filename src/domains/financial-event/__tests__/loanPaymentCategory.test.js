import { describe, expect, test } from "vitest";
import { loanPaymentCategory } from "../loanPaymentCategory.js";

// Regression test for the 2026-09-18 correction: the "Home Equity" account is
// Jason's actual home mortgage (a closed-end home equity loan), so its payments
// must categorize as mortgage_payment, not heloc_payment.
describe("loanPaymentCategory", () => {
  test('maps "Home Equity" to mortgage_payment', () => {
    expect(loanPaymentCategory("Home Equity")).toBe("mortgage_payment");
  });

  test("maps mortgage-named accounts to mortgage_payment", () => {
    expect(loanPaymentCategory("Primary Mortgage")).toBe("mortgage_payment");
  });

  test('keeps heloc_payment for accounts actually named as a HELOC', () => {
    expect(loanPaymentCategory("My HELOC")).toBe("heloc_payment");
  });

  test("falls back to loan_payment for anything else", () => {
    expect(loanPaymentCategory("Auto Loan")).toBe("loan_payment");
    expect(loanPaymentCategory(null)).toBe("loan_payment");
    expect(loanPaymentCategory("")).toBe("loan_payment");
  });
});
