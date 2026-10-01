import { describe, expect, it } from "vitest";
import {
  PET_DEPOSIT_STATUSES,
  classifyVaccinationStatus,
  createPetDepositRecord,
  createPetRecordDetails,
} from "../pet-records.types";

const baseProfile = {
  id: "animal_1", tenantId: "tenant_1", leaseId: "lease_1", name: "Biscuit",
  species: "dog" as const, breedDescription: "Labrador mix", classification: "pet" as const,
  insurerRiskFlag: false, humanReviewRequired: false,
};

describe("pet record details (built on the pet-liability domain)", () => {
  it("uses the canonical pet-liability constructor for the animal identity — no duplicated identity rules", () => {
    const details = createPetRecordDetails({ profile: baseProfile, weightLbs: 62 });
    expect(details.profile.name).toBe("Biscuit");
    expect(details.weightLbs).toBe(62);
  });

  it("inherits the pet-liability assistance-animal human-review rule instead of re-implementing it", () => {
    expect(() =>
      createPetRecordDetails({
        profile: { ...baseProfile, classification: "assistance_review_requested", humanReviewRequired: false },
      }),
    ).toThrow("Assistance-animal requests require human review.");
  });

  it("rejects weights outside the dog range", () => {
    expect(() => createPetRecordDetails({ profile: baseProfile, weightLbs: 0.2 })).toThrow("0.5 and 500");
    expect(() => createPetRecordDetails({ profile: baseProfile, weightLbs: 800 })).toThrow("0.5 and 500");
    expect(() => createPetRecordDetails({ profile: baseProfile, weightLbs: Number.NaN })).toThrow("0.5 and 500");
  });

  it("rejects malformed vaccination expiry dates", () => {
    expect(() => createPetRecordDetails({ profile: baseProfile, vaccinationExpiresOn: "10/01/2027" })).toThrow("YYYY-MM-DD");
  });

  it("classifies vaccination status: expired, expiring soon, current, no record", () => {
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: false, vaccinationExpiresOn: null }, "2026-10-01")).toBe("no_record");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: null }, "2026-10-01")).toBe("no_record");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: "2026-09-30" }, "2026-10-01")).toBe("expired");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: "2026-10-15" }, "2026-10-01")).toBe("expiring_soon");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: "2026-10-31" }, "2026-10-01")).toBe("expiring_soon");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: "2026-11-01" }, "2026-10-01")).toBe("current");
    expect(classifyVaccinationStatus({ vaccinationRecordOnFile: true, vaccinationExpiresOn: "2027-06-01" }, "2026-10-01")).toBe("current");
  });

  it("carries the classification into the created record", () => {
    const details = createPetRecordDetails(
      { profile: baseProfile, vaccinationRecordOnFile: true, vaccinationExpiresOn: "2026-10-15" },
      "2026-10-01",
    );
    expect(details.vaccinationStatus).toBe("expiring_soon");
    expect(Object.isFrozen(details)).toBe(true);
  });
});

describe("pet deposit record validation", () => {
  const base = { id: "dep_1", animalId: "animal_1", tenantId: "tenant_1", leaseId: "lease_1", amountCents: 25000, status: "held" as const };
  it("accepts a held deposit record", () => {
    expect(createPetDepositRecord(base).amountCents).toBe(25000);
  });
  it("accepts every lifecycle status", () => {
    for (const status of PET_DEPOSIT_STATUSES) expect(createPetDepositRecord({ ...base, status }).status).toBe(status);
  });
  it("requires a positive integer amount and identity fields", () => {
    expect(() => createPetDepositRecord({ ...base, amountCents: 0 })).toThrow("positive integer");
    expect(() => createPetDepositRecord({ ...base, amountCents: 10.5 })).toThrow("positive integer");
    expect(() => createPetDepositRecord({ ...base, animalId: " " })).toThrow("identity and lease fields");
    expect(() => createPetDepositRecord({ ...base, status: "lost" as never })).toThrow("supported status");
  });
});
