import { describe, expect, it } from "vitest";
import { createPropertyInsuranceRequirement, resolveEffectiveLeaseRequirement } from "../insurance-requirements.types";

describe("property insurance requirement validation", () => {
  it("accepts a full requirement row", () => {
    const row = createPropertyInsuranceRequirement({
      propertyId: "prop_1", requiresRentersInsurance: true, minimumLiabilityCents: 10000000, requiresPetRecords: true,
    });
    expect(row.requiresRentersInsurance).toBe(true);
    expect(row.requiresPetRecords).toBe(true);
    expect(Object.isFrozen(row)).toBe(true);
  });

  it("rejects a missing property id and negative liability minimums", () => {
    expect(() => createPropertyInsuranceRequirement({ propertyId: " " })).toThrow("property id");
    expect(() => createPropertyInsuranceRequirement({ propertyId: "prop_1", minimumLiabilityCents: -1 })).toThrow("non-negative");
  });
});

describe("effective lease requirement resolution", () => {
  const property = { propertyId: "prop_1", requiresRentersInsurance: true, minimumLiabilityCents: 5000000, requiresPetRecords: true };

  it("uses the lease-level row as the override when present", () => {
    const effective = resolveEffectiveLeaseRequirement({
      propertyRequirement: property,
      leaseRequirement: { leaseId: "lease_1", required: false, minimumLiabilityCents: 0 },
    });
    expect(effective.insuranceRequired).toBe(false);
    expect(effective.source).toBe("lease");
    // Pet-record requirement has no lease-level override — the property default still applies.
    expect(effective.petRecordsRequired).toBe(true);
  });

  it("falls back to the property default when no lease row exists", () => {
    const effective = resolveEffectiveLeaseRequirement({ propertyRequirement: property, leaseRequirement: null });
    expect(effective.insuranceRequired).toBe(true);
    expect(effective.minimumLiabilityCents).toBe(5000000);
    expect(effective.petRecordsRequired).toBe(true);
    expect(effective.source).toBe("property");
  });

  it("requires nothing when neither level exists", () => {
    const effective = resolveEffectiveLeaseRequirement({ propertyRequirement: null, leaseRequirement: null });
    expect(effective).toMatchObject({ insuranceRequired: false, petRecordsRequired: false, source: "none" });
  });
});
