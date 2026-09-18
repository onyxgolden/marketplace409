import { describe, expect, test } from "vitest";
import { needsDirectionCorrection, applyDirectionCorrection } from "../correctRawBankFeedDirection";

describe("needsDirectionCorrection / applyDirectionCorrection", () => {
  test("flips a negative-amount unmapped fallback row (a mis-signed deposit) to income/positive", () => {
    const input = { transactionKind: "expense", normalizedCategory: "other", amount: -1550 };
    expect(needsDirectionCorrection(input)).toBe(true);
    expect(applyDirectionCorrection(input)).toEqual({ transactionKind: "income", normalizedCategory: "other", amount: 1550 });
  });

  test("leaves a positive-amount unmapped fallback row (a correctly-signed withdrawal) unchanged", () => {
    const input = { transactionKind: "expense", normalizedCategory: "other", amount: 4614 };
    expect(needsDirectionCorrection(input)).toBe(false);
    expect(applyDirectionCorrection(input)).toEqual(input);
  });

  test("never touches a real CategoryNormalizer match, even if negative", () => {
    const input = { transactionKind: "income", normalizedCategory: "rental_income", amount: -1550 };
    expect(needsDirectionCorrection(input)).toBe(false);
    expect(applyDirectionCorrection(input)).toEqual(input);
  });

  test("never touches an already-income row", () => {
    const input = { transactionKind: "income", normalizedCategory: "other", amount: -200 };
    expect(needsDirectionCorrection(input)).toBe(false);
  });
});
