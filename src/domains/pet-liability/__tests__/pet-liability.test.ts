import { describe, expect, it } from "vitest"; import { createRentalAnimalProfile } from "../pet-liability.types";
const base = { id: "animal_1", tenantId: "tenant_1", leaseId: "lease_1", name: "Dog", species: "dog" as const,
  breedDescription: "Tenant supplied", classification: "pet" as const, insurerRiskFlag: true, humanReviewRequired: true };
describe("pet liability", () => {
  it("records insurer risk separately from animal classification", () => { expect(createRentalAnimalProfile(base)).toMatchObject({ insurerRiskFlag: true, classification: "pet" }); });
  it("never automates an assistance-animal review", () => {
    expect(() => createRentalAnimalProfile({ ...base, classification: "assistance_review_requested", humanReviewRequired: false })).toThrow("human review");
  });
});
