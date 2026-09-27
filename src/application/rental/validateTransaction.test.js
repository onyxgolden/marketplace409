import { describe, expect, it } from "vitest";
import { validateTransaction } from "./validateTransaction";

const base = () => ({
  eventDate: "2026-09-20",
  description: "Gulf Coast Plumbing — water heater",
  amount: 450,
  transactionKind: "expense",
  normalizedCategory: "property_repairs",
});

describe("validateTransaction", () => {
  it("accepts a full valid transaction", () => {
    const result = validateTransaction({
      ...base(),
      payee: "Gulf Coast Plumbing",
      checkNumber: "1024",
      bankAccountId: "acct_1",
      propertyId: "prop_1",
      tenantId: "tenant_1",
      memo: "Emergency call",
      cleared: true,
      chargeTenant: true,
    });
    expect(result.valid).toBe(true);
    expect(result.value.cleared).toBe(true);
    expect(result.value.chargeTenant).toBe(true);
    expect(result.value.payee).toBe("Gulf Coast Plumbing");
  });

  it("accepts the full ledger option set (display name, ref, address, vendor, method, recurring, depreciate)", () => {
    const result = validateTransaction({
      ...base(),
      displayAs: "Water heater — 308 Paula",
      refNumber: "INV-1042",
      payeeMailingAddress: "PO Box 42, Beaumont, TX",
      assignedTo: "Gulf Coast Plumbing",
      paymentMethod: "check",
      isRecurring: true,
      recurrenceRule: "monthly",
      depreciate: true,
    });
    expect(result.valid).toBe(true);
    expect(result.value.displayAs).toBe("Water heater — 308 Paula");
    expect(result.value.refNumber).toBe("INV-1042");
    expect(result.value.assignedTo).toBe("Gulf Coast Plumbing");
    expect(result.value.paymentMethod).toBe("check");
    expect(result.value.isRecurring).toBe(true);
    expect(result.value.recurrenceRule).toBe("monthly");
    expect(result.value.depreciate).toBe(true);
  });

  it("rejects an unknown payment method", () => {
    const result = validateTransaction({ ...base(), paymentMethod: "barter" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Payment method/);
  });

  it("requires a repeat schedule when recurring is set", () => {
    const missing = validateTransaction({ ...base(), isRecurring: true, recurrenceRule: "" });
    expect(missing.valid).toBe(false);
    const bad = validateTransaction({ ...base(), isRecurring: true, recurrenceRule: "fortnightly" });
    expect(bad.valid).toBe(false);
  });

  it("clears the repeat schedule when recurring is off", () => {
    const result = validateTransaction({ ...base(), isRecurring: false, recurrenceRule: "monthly" });
    expect(result.valid).toBe(true);
    expect(result.value.recurrenceRule).toBeNull();
  });

  it("defaults optional flags to false and optionals to null", () => {
    const result = validateTransaction(base());
    expect(result.valid).toBe(true);
    expect(result.value.cleared).toBe(false);
    expect(result.value.chargeTenant).toBe(false);
    expect(result.value.payee).toBeNull();
    expect(result.value.bankAccountId).toBeNull();
  });

  it("rejects missing date, description, amount, kind, and category", () => {
    const result = validateTransaction({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects a non-positive amount", () => {
    expect(validateTransaction({ ...base(), amount: 0 }).valid).toBe(false);
    expect(validateTransaction({ ...base(), amount: -5 }).valid).toBe(false);
    expect(validateTransaction({ ...base(), amount: "abc" }).valid).toBe(false);
  });

  it("rejects an unknown category and kind", () => {
    expect(validateTransaction({ ...base(), normalizedCategory: "yachts" }).valid).toBe(false);
    expect(validateTransaction({ ...base(), transactionKind: "transfer" }).valid).toBe(false);
  });

  it("requires a tenant when chargeTenant is true", () => {
    const result = validateTransaction({ ...base(), chargeTenant: true });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tenant/i);
  });

  it("rejects a malformed date", () => {
    expect(validateTransaction({ ...base(), eventDate: "09/20/2026" }).valid).toBe(false);
  });
});
