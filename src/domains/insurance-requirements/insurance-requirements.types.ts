// R24 insurance requirements — per-property defaults + per-lease overrides.
//
// The per-lease table (renters_insurance_requirements) already existed. R24
// adds the per-property default row (rental_property_insurance_requirements):
// the owner sets the requirement once per property, and the effective rule for
// a lease is the lease-level row when present, otherwise the property default.

export type PropertyInsuranceRequirement = Readonly<{
  propertyId: string;
  requiresRentersInsurance: boolean;
  minimumLiabilityCents: number;
  requiresPetRecords: boolean;
}>;

export type LeaseInsuranceRequirement = Readonly<{
  leaseId: string;
  required: boolean;
  minimumLiabilityCents: number;
}>;

export type EffectiveLeaseRequirement = Readonly<{
  insuranceRequired: boolean;
  minimumLiabilityCents: number;
  petRecordsRequired: boolean;
  source: "lease" | "property" | "none";
}>;

export function resolveEffectiveLeaseRequirement({
  propertyRequirement,
  leaseRequirement,
}: {
  propertyRequirement?: PropertyInsuranceRequirement | null;
  leaseRequirement?: LeaseInsuranceRequirement | null;
}): EffectiveLeaseRequirement {
  if (leaseRequirement) {
    return Object.freeze({
      insuranceRequired: leaseRequirement.required,
      minimumLiabilityCents: leaseRequirement.minimumLiabilityCents,
      petRecordsRequired: propertyRequirement?.requiresPetRecords ?? false,
      source: "lease",
    });
  }
  if (propertyRequirement) {
    return Object.freeze({
      insuranceRequired: propertyRequirement.requiresRentersInsurance,
      minimumLiabilityCents: propertyRequirement.minimumLiabilityCents,
      petRecordsRequired: propertyRequirement.requiresPetRecords,
      source: "property",
    });
  }
  return Object.freeze({ insuranceRequired: false, minimumLiabilityCents: 0, petRecordsRequired: false, source: "none" });
}

export function createPropertyInsuranceRequirement(value: {
  propertyId: string;
  requiresRentersInsurance?: boolean;
  minimumLiabilityCents?: number;
  requiresPetRecords?: boolean;
}): PropertyInsuranceRequirement {
  if (!value.propertyId?.trim()) throw new Error("Property insurance requirement requires a property id.");
  const minimumLiabilityCents = value.minimumLiabilityCents ?? 0;
  if (!Number.isSafeInteger(minimumLiabilityCents) || minimumLiabilityCents < 0)
    throw new Error("Minimum liability must be a non-negative integer of cents.");
  return Object.freeze({
    propertyId: value.propertyId.trim(),
    requiresRentersInsurance: value.requiresRentersInsurance ?? false,
    minimumLiabilityCents,
    requiresPetRecords: value.requiresPetRecords ?? false,
  });
}
