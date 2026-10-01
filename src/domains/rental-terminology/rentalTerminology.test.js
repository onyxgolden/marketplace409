import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMS,
  MAX_TERM_LENGTH,
  resolveTermMap,
  termLabel,
  TERMINOLOGY_KEYS,
  validateTermMap,
} from "./rentalTerminology.js";

describe("rentalTerminology term resolution", () => {
  it("returns the defaults when the map is unset", () => {
    expect(termLabel(null, "tenant")).toBe("tenant");
    expect(termLabel(undefined, "tenant", { plural: true })).toBe("tenants");
    expect(termLabel({}, "property", { capitalize: true })).toBe("Property");
    expect(termLabel(null, "vendor", { plural: true, capitalize: true })).toBe("Vendors");
  });

  it("resolves singular, plural, and capitalized variants of custom terms", () => {
    const terms = resolveTermMap({
      tenant: { singular: "resident", plural: "residents" },
      property: { singular: "unit", plural: "units" },
      lease: { singular: "rental agreement", plural: "rental agreements" },
      owner: { singular: "landlord", plural: "landlords" },
      vendor: { singular: "contractor", plural: "contractors" },
    });
    expect(termLabel(terms, "tenant")).toBe("resident");
    expect(termLabel(terms, "tenant", { plural: true })).toBe("residents");
    expect(termLabel(terms, "tenant", { capitalize: true })).toBe("Resident");
    expect(termLabel(terms, "tenant", { plural: true, capitalize: true })).toBe("Residents");
    expect(termLabel(terms, "property", { plural: true })).toBe("units");
    expect(termLabel(terms, "lease", { plural: true, capitalize: true })).toBe("Rental agreements");
    expect(termLabel(terms, "owner", { capitalize: true })).toBe("Landlord");
    expect(termLabel(terms, "vendor", { plural: true })).toBe("contractors");
  });

  it("fills missing or blank keys with the defaults", () => {
    const terms = resolveTermMap({ tenant: { singular: "resident", plural: "residents" }, property: { singular: "", plural: "  " } });
    expect(termLabel(terms, "tenant", { plural: true })).toBe("residents");
    expect(termLabel(terms, "property", { plural: true })).toBe("properties");
    expect(termLabel(terms, "lease")).toBe("lease");
  });

  it("never throws on malformed input — degrades to defaults", () => {
    expect(termLabel("garbage", "tenant", { plural: true })).toBe("tenants");
    expect(termLabel(null, "not-a-key")).toBe("tenant");
    expect(termLabel(null, "not-a-key", { capitalize: true })).toBe("Tenant");
  });

  it("exposes exactly the five renamable keys with sensible defaults", () => {
    expect(TERMINOLOGY_KEYS).toEqual(["tenant", "property", "lease", "owner", "vendor"]);
    expect(DEFAULT_TERMS.tenant).toEqual({ singular: "tenant", plural: "tenants" });
    expect(DEFAULT_TERMS.property).toEqual({ singular: "property", plural: "properties" });
  });
});

describe("rentalTerminology validation", () => {
  const valid = {
    tenant: { singular: "resident", plural: "residents" },
    property: { singular: "unit", plural: "units" },
    lease: { singular: "rental agreement", plural: "rental agreements" },
    owner: { singular: "landlord", plural: "landlords" },
    vendor: { singular: "contractor", plural: "contractors" },
  };

  it("accepts a complete valid map and trims whitespace", () => {
    const result = validateTermMap({ ...valid, tenant: { singular: "  resident ", plural: "residents" } });
    expect(result.ok).toBe(true);
    expect(result.clean.tenant.singular).toBe("resident");
  });

  it("accepts the default map itself", () => {
    expect(validateTermMap(JSON.parse(JSON.stringify(DEFAULT_TERMS))).ok).toBe(true);
  });

  it("rejects empty singular or plural terms", () => {
    expect(validateTermMap({ ...valid, tenant: { singular: "", plural: "residents" } }).ok).toBe(false);
    expect(validateTermMap({ ...valid, tenant: { singular: "resident", plural: "   " } }).ok).toBe(false);
    const missing = validateTermMap({ ...valid, tenant: { singular: "resident", plural: "residents" } });
    delete missing.clean;
    expect(validateTermMap({ ...valid, vendor: null }).ok).toBe(false);
  });

  it("rejects terms longer than the limit", () => {
    const tooLong = "x".repeat(MAX_TERM_LENGTH + 1);
    const result = validateTermMap({ ...valid, lease: { singular: tooLong, plural: "leases" } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/40 characters or fewer/);
  });

  it("rejects terms with markup or emoji", () => {
    expect(validateTermMap({ ...valid, tenant: { singular: "<b>resident</b>", plural: "residents" } }).ok).toBe(false);
    expect(validateTermMap({ ...valid, tenant: { singular: "resident🏠", plural: "residents" } }).ok).toBe(false);
  });

  it("rejects duplicates across keys, case-insensitively", () => {
    const dup = { ...valid, owner: { singular: "Resident", plural: "landlords" } };
    const result = validateTermMap(dup);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already used/);
    const crossForm = { ...valid, vendor: { singular: "units", plural: "contractors" } };
    expect(validateTermMap(crossForm).ok).toBe(false);
  });

  it("permits invariant terms — the same word as singular and plural within one key", () => {
    const invariant = { ...valid, vendor: { singular: "staff", plural: "staff" } };
    const result = validateTermMap(invariant);
    expect(result.ok).toBe(true);
    expect(result.clean.vendor).toEqual({ singular: "staff", plural: "staff" });
    // ...while the same word used as a DIFFERENT key's term is still rejected.
    const crossKey = {
      ...valid,
      tenant: { singular: "staff", plural: "residents" },
      vendor: { singular: "staff", plural: "contractors" },
    };
    expect(validateTermMap(crossKey).ok).toBe(false);
  });

  it("rejects a missing key and non-object input", () => {
    const { tenant: _dropped, ...rest } = valid;
    expect(validateTermMap(rest).ok).toBe(false);
    expect(validateTermMap(null).ok).toBe(false);
    expect(validateTermMap("terms").ok).toBe(false);
  });
});
