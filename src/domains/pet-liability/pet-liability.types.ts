export const ANIMAL_CLASSIFICATIONS = ["pet", "assistance_review_requested", "assistance_animal_approved", "assistance_request_denied"] as const;
export const PET_LIABILITY_STATUSES = ["not_required", "required", "pending_verification", "verified", "expired", "cancelled", "rejected"] as const;
export type AnimalClassification = typeof ANIMAL_CLASSIFICATIONS[number];
export type PetLiabilityStatus = typeof PET_LIABILITY_STATUSES[number];
export type RentalAnimalProfile = Readonly<{ id: string; tenantId: string; leaseId: string; name: string; species: "dog";
  breedDescription: string; classification: AnimalClassification; insurerRiskFlag: boolean; humanReviewRequired: boolean }>;
export function createRentalAnimalProfile(value: RentalAnimalProfile): RentalAnimalProfile {
  if (!ANIMAL_CLASSIFICATIONS.includes(value.classification)) throw new Error("Rental animal profile requires a supported classification.");
  if (!value.id?.trim() || !value.tenantId?.trim() || !value.leaseId?.trim() || !value.name?.trim()) throw new Error("Rental animal profile requires identity and lease fields.");
  if (value.classification === "assistance_review_requested" && !value.humanReviewRequired)
    throw new Error("Assistance-animal requests require human review.");
  return Object.freeze({ ...value, species: "dog" });
}
