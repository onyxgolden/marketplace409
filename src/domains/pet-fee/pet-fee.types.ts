export const PET_APPROVAL_STATUSES = ["requested", "approved", "denied", "withdrawn"] as const;
export const PET_FEE_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type PetApprovalStatus = typeof PET_APPROVAL_STATUSES[number];
export type PetFeeStatus = typeof PET_FEE_STATUSES[number];
export type MonthlyPetFee = Readonly<{ id: string; animalId: string; leaseId: string; amountCents: number;
  currencyCode: string; status: PetFeeStatus; effectiveStartDate: string; effectiveEndDate: string | null;
  approvalEvidenceId: string; approvedAt: string }>;
export function createMonthlyPetFee(value: MonthlyPetFee): MonthlyPetFee {
  if (!PET_FEE_STATUSES.includes(value.status)) throw new Error("Monthly pet fee requires a supported status.");
  if (!Number.isSafeInteger(value.amountCents) || value.amountCents <= 0) throw new Error("Monthly pet fee must be positive integer cents.");
  for (const [field, input] of Object.entries({ id: value.id, animalId: value.animalId, leaseId: value.leaseId,
    approvalEvidenceId: value.approvalEvidenceId, approvedAt: value.approvedAt })) if (typeof input !== "string" || !input.trim())
    throw new Error(`Monthly pet fee requires ${field}.`);
  return Object.freeze({ ...value, currencyCode: value.currencyCode.toUpperCase() });
}
