// R24 pet-record details — EXTENDS the pet-liability domain, never duplicates it.
//
// The canonical rental animal identity (id, tenant, lease, name, breed,
// classification, assistance-animal human-review rules) lives in
// src/domains/pet-liability and is constructed here via createRentalAnimalProfile.
// This module only validates the R24 detail fields: weight, vaccination record
// on file, and vaccination expiry. Pet screening here is the animal record
// (breed/weight/vaccinations); R22's screening is people-screening.

import { createRentalAnimalProfile } from "../pet-liability/pet-liability.types";
import type { RentalAnimalProfile } from "../pet-liability/pet-liability.types";

export const VACCINATION_STATUSES = ["no_record", "current", "expiring_soon", "expired"] as const;
export type VaccinationStatus = typeof VACCINATION_STATUSES[number];

export type PetRecordDetails = Readonly<{
  profile: RentalAnimalProfile;
  weightLbs: number | null;
  vaccinationRecordOnFile: boolean;
  vaccinationExpiresOn: string | null;
  vaccinationStatus: VaccinationStatus;
}>;

export const PET_VACCINATION_EXPIRY_REMINDER_DAYS = 30;

export function classifyVaccinationStatus(
  record: { vaccinationRecordOnFile: boolean; vaccinationExpiresOn: string | null },
  asOf: string = new Date().toISOString().slice(0, 10),
): VaccinationStatus {
  if (!record.vaccinationRecordOnFile || !record.vaccinationExpiresOn) return "no_record";
  if (record.vaccinationExpiresOn < asOf) return "expired";
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const reminderCutoff = new Date(asOfDate.getTime() + PET_VACCINATION_EXPIRY_REMINDER_DAYS * 86_400_000);
  if (record.vaccinationExpiresOn <= reminderCutoff.toISOString().slice(0, 10)) return "expiring_soon";
  return "current";
}

export function createPetRecordDetails(
  value: {
    profile: RentalAnimalProfile;
    weightLbs?: number | null;
    vaccinationRecordOnFile?: boolean;
    vaccinationExpiresOn?: string | null;
  },
  asOf?: string,
): PetRecordDetails {
  const profile = createRentalAnimalProfile(value.profile);
  const weightLbs = value.weightLbs ?? null;
  if (weightLbs !== null && (!Number.isFinite(weightLbs) || weightLbs < 0.5 || weightLbs > 500))
    throw new Error("Pet weight must be between 0.5 and 500 lbs when provided.");
  const vaccinationRecordOnFile = value.vaccinationRecordOnFile ?? false;
  const vaccinationExpiresOn = value.vaccinationExpiresOn ?? null;
  if (vaccinationExpiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(vaccinationExpiresOn))
    throw new Error("Vaccination expiry must be a YYYY-MM-DD date when provided.");
  return Object.freeze({
    profile,
    weightLbs,
    vaccinationRecordOnFile,
    vaccinationExpiresOn,
    vaccinationStatus: classifyVaccinationStatus({ vaccinationRecordOnFile, vaccinationExpiresOn }, asOf),
  });
}

export const PET_DEPOSIT_STATUSES = ["held", "applied_to_balance", "refunded", "forfeited"] as const;
export type PetDepositStatus = typeof PET_DEPOSIT_STATUSES[number];

export type PetDepositRecord = Readonly<{
  id: string; animalId: string; tenantId: string; leaseId: string;
  amountCents: number; status: PetDepositStatus;
}>;

export function createPetDepositRecord(value: PetDepositRecord): PetDepositRecord {
  if (!PET_DEPOSIT_STATUSES.includes(value.status)) throw new Error("Pet deposit requires a supported status.");
  if (!Number.isSafeInteger(value.amountCents) || value.amountCents <= 0)
    throw new Error("Pet deposit amount must be a positive integer of cents.");
  if (!value.id?.trim() || !value.animalId?.trim() || !value.tenantId?.trim() || !value.leaseId?.trim())
    throw new Error("Pet deposit requires identity and lease fields.");
  return Object.freeze({ ...value });
}
