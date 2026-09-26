import { describe, expect, it } from "vitest";
import { US_STATES, isUsStateCode, normalizeUsStateCode } from "./usStates";
import {
  addressOfUnit,
  formatAddress,
  hasStructuredAddress,
  validateAddressFields,
} from "./validateAddress";

describe("usStates", () => {
  it("lists the 50 states plus DC", () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.find((state) => state.code === "TX")?.name).toBe("Texas");
    expect(US_STATES.find((state) => state.code === "DC")?.name).toBe("District of Columbia");
  });

  it("recognizes state codes case-insensitively", () => {
    expect(isUsStateCode("TX")).toBe(true);
    expect(isUsStateCode("tx")).toBe(true);
    expect(isUsStateCode("XX")).toBe(false);
    expect(isUsStateCode("")).toBe(false);
  });

  it("normalizes codes and full names", () => {
    expect(normalizeUsStateCode("tx")).toBe("TX");
    expect(normalizeUsStateCode("Texas")).toBe("TX");
    expect(normalizeUsStateCode("District of Columbia")).toBe("DC");
    expect(normalizeUsStateCode("XX")).toBeNull();
  });
});

describe("validateAddressFields", () => {
  const valid = { street: "123 Main St", unit: "Apt 4", city: "Springfield", state: "IL", zip: "62701" };

  it("accepts a complete valid address", () => {
    const result = validateAddressFields(valid);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("accepts ZIP+4", () => {
    expect(validateAddressFields({ ...valid, zip: "62701-1234" }).ok).toBe(true);
  });

  it("accepts a lowercase state code", () => {
    expect(validateAddressFields({ ...valid, state: "il" }).ok).toBe(true);
  });

  it("treats unit as optional", () => {
    expect(validateAddressFields({ ...valid, unit: "" }).ok).toBe(true);
  });

  it("rejects a bad ZIP", () => {
    for (const zip of ["1234", "123456", "ABCDE", "12345-123", "12345 6789"]) {
      const result = validateAddressFields({ ...valid, zip });
      expect(result.ok).toBe(false);
      expect(result.errors.zip).toMatch(/ZIP/i);
    }
  });

  it("rejects missing street, city, and state", () => {
    const result = validateAddressFields({ street: "", city: "", state: "", zip: "62701" });
    expect(result.ok).toBe(false);
    expect(result.errors.street).toMatch(/Street/i);
    expect(result.errors.city).toMatch(/City/i);
    expect(result.errors.state).toMatch(/State/i);
  });

  it("rejects an unknown state", () => {
    const result = validateAddressFields({ ...valid, state: "XX" });
    expect(result.ok).toBe(false);
    expect(result.errors.state).toBeDefined();
  });

  it("skips a fully blank group when allowEmptyGroup is set", () => {
    const result = validateAddressFields({ street: "", unit: "", city: "", state: "", zip: "" }, { allowEmptyGroup: true });
    expect(result.ok).toBe(true);
  });

  it("requires the full group once any field is filled (edit mode)", () => {
    const result = validateAddressFields({ street: "123 Main St", unit: "", city: "", state: "", zip: "" }, { allowEmptyGroup: true });
    expect(result.ok).toBe(false);
    expect(result.errors.city).toBeDefined();
    expect(result.errors.zip).toBeDefined();
  });

  it("normalizes values on success", () => {
    const result = validateAddressFields({ ...valid, street: "  123 Main St  ", state: "il" });
    expect(result.values.street).toBe("123 Main St");
    expect(result.values.state).toBe("IL");
  });
});

describe("formatAddress", () => {
  it("formats a full address", () => {
    expect(formatAddress({ street: "123 Main St", unit: "Apt 4", city: "Springfield", state: "IL", zip: "62701" }))
      .toBe("123 Main St, Apt 4, Springfield, IL 62701");
  });

  it("skips blank parts", () => {
    expect(formatAddress({ street: "123 Main St", unit: "", city: "Springfield", state: "il", zip: "62701" }))
      .toBe("123 Main St, Springfield, IL 62701");
    expect(formatAddress({})).toBe("");
  });
});

describe("addressOfUnit", () => {
  it("reads camelCase and snake_case unit records", () => {
    expect(addressOfUnit({ addressStreet: "123 Main St", addressCity: "Springfield", addressState: "IL", addressZip: "62701" }))
      .toMatchObject({ street: "123 Main St", city: "Springfield", state: "IL", zip: "62701" });
    expect(addressOfUnit({ address_street: "123 Main St", address_zip: "62701" }))
      .toMatchObject({ street: "123 Main St", zip: "62701", city: "" });
  });
});

describe("hasStructuredAddress", () => {
  it("detects any address content", () => {
    expect(hasStructuredAddress({ street: "123 Main St" })).toBe(true);
    expect(hasStructuredAddress({})).toBe(false);
    expect(hasStructuredAddress({ street: "  " })).toBe(false);
  });
});
