import { describe, expect, it } from "vitest";
import { validateManualFinancialEvent } from "./validateManualFinancialEvent.js";

const valid = {
  eventDate: "2026-08-16",
  description: "Cash payment to Gulf Coast Plumbing",
  amount: "150.00",
  transactionKind: "expense",
  normalizedCategory: "property_repairs",
  paymentMethod: "cash",
};

describe("validate manual financial event", () => {
  it("accepts a well-formed entry", () => {
    expect(validateManualFinancialEvent(valid)).toMatchObject({ valid: true, errors: [] });
  });
  it("rejects a missing or malformed date", () => {
    expect(validateManualFinancialEvent({ ...valid, eventDate: "08/16/2026" }).valid).toBe(false);
    expect(validateManualFinancialEvent({ ...valid, eventDate: "" }).valid).toBe(false);
  });
  it("rejects a blank description", () => {
    expect(validateManualFinancialEvent({ ...valid, description: "   " }).errors).toContain("A description is required.");
  });
  it("rejects a non-positive or non-numeric amount", () => {
    expect(validateManualFinancialEvent({ ...valid, amount: 0 }).valid).toBe(false);
    expect(validateManualFinancialEvent({ ...valid, amount: -50 }).valid).toBe(false);
    expect(validateManualFinancialEvent({ ...valid, amount: "not a number" }).valid).toBe(false);
  });
  it("rejects an unsupported transaction kind", () => {
    expect(validateManualFinancialEvent({ ...valid, transactionKind: "asset_purchase" }).errors).toContain("Type must be income or expense.");
  });
  it("rejects an unknown category", () => {
    expect(validateManualFinancialEvent({ ...valid, normalizedCategory: "made_up_category" }).valid).toBe(false);
  });
  it("rejects an unsupported payment method", () => {
    expect(validateManualFinancialEvent({ ...valid, paymentMethod: "venmo" }).valid).toBe(false);
  });
});
