import { describe, expect, it } from "vitest";
import {
  buildVendorId,
  isDuplicateVendorName,
  serializeVendor,
  validateVendorInput,
  VENDOR_ID_PREFIX,
} from "./vendors";

describe("validateVendorInput", () => {
  it("accepts a full valid vendor", () => {
    const check = validateVendorInput({
      name: "Acme Plumbing",
      contactName: "Sam",
      email: "sam@acme.example",
      phone: "555-0100",
      address: "1 Main St",
      trade: "Plumbing",
      taxClassification: "LLC",
      taxIdLast4: "1234",
      notes: "Good crew",
    });
    expect(check.valid).toBe(true);
    expect(check.value.name).toBe("Acme Plumbing");
    expect(check.value.taxIdLast4).toBe("1234");
  });

  it("requires a name on create", () => {
    expect(validateVendorInput({}).valid).toBe(false);
    expect(validateVendorInput({ name: "   " }).valid).toBe(false);
  });

  it("rejects a bad email and a bad tax-id tail", () => {
    const badEmail = validateVendorInput({ name: "X", email: "not-an-email" });
    expect(badEmail.valid).toBe(false);
    const badTax = validateVendorInput({ name: "X", taxIdLast4: "12AB" });
    expect(badTax.valid).toBe(false);
    expect(badTax.errors.join(" ")).toMatch(/last 4 digits/);
  });

  it("allows partial updates without a name", () => {
    const check = validateVendorInput({ phone: "555-0100" }, { forUpdate: true });
    expect(check.valid).toBe(true);
    const blankName = validateVendorInput({ name: "  " }, { forUpdate: true });
    expect(blankName.valid).toBe(false);
  });

  it("clips overlong fields instead of failing", () => {
    const check = validateVendorInput({ name: "N".repeat(500) });
    expect(check.valid).toBe(true);
    expect(check.value.name).toHaveLength(160);
  });
});

describe("isDuplicateVendorName", () => {
  it("matches case-insensitively", () => {
    expect(isDuplicateVendorName("acme plumbing", ["Acme Plumbing"])).toBe(true);
    expect(isDuplicateVendorName("Other Co", ["Acme Plumbing"])).toBe(false);
    expect(isDuplicateVendorName("", ["Acme Plumbing"])).toBe(false);
  });
});

describe("buildVendorId", () => {
  it("uses the vendor prefix and is unique", () => {
    const a = buildVendorId();
    const b = buildVendorId();
    expect(a.startsWith(VENDOR_ID_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("serializeVendor", () => {
  it("maps snake_case to camelCase", () => {
    const out = serializeVendor({ id: "v1", name: "Acme", contact_name: "Sam", is_active: true });
    expect(out.contactName).toBe("Sam");
    expect(out.isActive).toBe(true);
    expect(out.phone).toBeNull();
  });
  it("returns null for null", () => {
    expect(serializeVendor(null)).toBeNull();
  });
});
