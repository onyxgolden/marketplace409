import { describe, expect, it } from "vitest";
import { scopeRentecEvidenceToProperty } from "./rentec-single-property-scope.js";

const evidence = {
  rentecProperties: [
    { property_id: 10, address: "1218 Wagner St" },
    { property_id: 11, address: "900 Elm St" },
  ],
  rentecTenants: [
    { renter_id: 20, f_name: "Rachel", l_name: "Renter", email: "rachel@example.com" },
    { renter_id: 21, f_name: "Other", l_name: "Renter", email: "other@example.com" },
  ],
  rentecLeases: [
    { lease_id: 30, property_id: 10, renter_id: 20, recurring_rent: 1200 },
    { lease_id: 31, property_id: 11, renter_id: 21, recurring_rent: 900 },
  ],
};

describe("scopeRentecEvidenceToProperty", () => {
  it("narrows properties, leases, and tenants to only the chosen property", () => {
    const scoped = scopeRentecEvidenceToProperty({ ...evidence, propertyId: "10" });
    expect(scoped.rentecProperties).toEqual([evidence.rentecProperties[0]]);
    expect(scoped.rentecLeases).toEqual([evidence.rentecLeases[0]]);
    expect(scoped.rentecTenants).toEqual([evidence.rentecTenants[0]]);
  });

  it("excludes a tenant who has no lease at the chosen property, even if they exist in Rentec", () => {
    const scoped = scopeRentecEvidenceToProperty({ ...evidence, propertyId: "10" });
    expect(scoped.rentecTenants.map((row) => row.renter_id)).not.toContain(21);
  });

  it("returns nothing for a property id that matches no records", () => {
    const scoped = scopeRentecEvidenceToProperty({ ...evidence, propertyId: "does-not-exist" });
    expect(scoped).toEqual({ rentecProperties: [], rentecTenants: [], rentecLeases: [] });
  });

  it("requires a property id", () => {
    expect(() => scopeRentecEvidenceToProperty({ ...evidence, propertyId: "" })).toThrow(
      "A Rentec property id is required",
    );
  });
});
