import { describe, expect, test } from "vitest";
import { isDebtPayoffCategory } from "../isDebtPayoffCategory";

describe("isDebtPayoffCategory", () => {
  test("matches real mortgage/car-payment categories", () => {
    expect(isDebtPayoffCategory({ normalizedCategory: "home_mortgage", displayLabel: "Mortgage" })).toBe(true);
    expect(isDebtPayoffCategory({ normalizedCategory: "auto_transport_car_payment", displayLabel: "Car Payment" })).toBe(true);
  });

  test("matches generic debt keywords for categories not yet seen in this account's history", () => {
    expect(isDebtPayoffCategory({ normalizedCategory: "student_loan_payment", displayLabel: "Student Loan" })).toBe(true);
    expect(isDebtPayoffCategory({ normalizedCategory: "credit_card_payment", displayLabel: "Credit Card" })).toBe(true);
    expect(isDebtPayoffCategory({ normalizedCategory: "heloc_payment", displayLabel: "HELOC" })).toBe(true);
    expect(isDebtPayoffCategory({ normalizedCategory: "personal_loan", displayLabel: "Personal Loan" })).toBe(true);
    expect(isDebtPayoffCategory({ normalizedCategory: "medical_debt", displayLabel: "Medical Debt" })).toBe(true);
  });

  test("does not match ordinary spending categories", () => {
    expect(isDebtPayoffCategory({ normalizedCategory: "groceries", displayLabel: "Groceries" })).toBe(false);
    expect(isDebtPayoffCategory({ normalizedCategory: "auto_transport_gas_fuel", displayLabel: "Gas" })).toBe(false);
  });

  test("handles missing fields without throwing", () => {
    expect(isDebtPayoffCategory({})).toBe(false);
    expect(isDebtPayoffCategory({ normalizedCategory: null, displayLabel: undefined })).toBe(false);
  });
});
