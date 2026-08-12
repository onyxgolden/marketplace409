export const RENTAL_LEASE_STATUSES = [
  "draft",
  "active",
  "ended",
  "terminated",
  "cancelled",
] as const;

export type RentalLeaseStatus =
  typeof RENTAL_LEASE_STATUSES[number];

export type RentalLease = Readonly<{
  id: string;
  propertyId: string;
  unitId: string;
  tenantIds: readonly string[];
  status: RentalLeaseStatus;
  startDate: string;
  endDate: string | null;
  monthlyRentCents: number;
  currencyCode: string;
  rentDueDay: number;
  documentEvidenceId: string | null;
  activatedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
}>;

function requireString(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Rental lease requires ${fieldName}.`);
  }

  return value.trim();
}

function dateOnly(value: string, fieldName: string): string {
  const normalized = requireString(value, fieldName);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))
  ) {
    throw new Error(`Rental lease ${fieldName} must be a valid date.`);
  }

  return normalized;
}

function optionalTimestamp(value: string | null, fieldName: string): string | null {
  if (value === null) return null;

  const normalized = requireString(value, fieldName);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Rental lease ${fieldName} must be a valid timestamp.`);
  }

  return normalized;
}

export function createRentalLease(
  lease: RentalLease,
): RentalLease {
  if (!RENTAL_LEASE_STATUSES.includes(lease.status)) {
    throw new Error("Rental lease requires a supported status.");
  }

  if (!Number.isSafeInteger(lease.monthlyRentCents) || lease.monthlyRentCents <= 0) {
    throw new Error("Rental lease monthly rent must be a positive integer number of cents.");
  }

  if (!Number.isSafeInteger(lease.rentDueDay) || lease.rentDueDay < 1 || lease.rentDueDay > 28) {
    throw new Error("Rental lease rent due day must be between 1 and 28.");
  }

  const currencyCode = requireString(lease.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error("Rental lease currency code must contain three letters.");
  }

  const tenantIds = [...new Set(lease.tenantIds.map((id) => requireString(id, "a tenant id")))];
  if (tenantIds.length === 0) {
    throw new Error("Rental lease requires at least one tenant id.");
  }

  const startDate = dateOnly(lease.startDate, "startDate");
  const endDate = lease.endDate === null ? null : dateOnly(lease.endDate, "endDate");
  if (endDate !== null && endDate < startDate) {
    throw new Error("Rental lease end date cannot precede its start date.");
  }

  return Object.freeze({
    ...lease,
    id: requireString(lease.id, "an id"),
    propertyId: requireString(lease.propertyId, "a property id"),
    unitId: requireString(lease.unitId, "a unit id"),
    tenantIds: Object.freeze(tenantIds),
    startDate,
    endDate,
    monthlyRentCents: lease.monthlyRentCents,
    currencyCode,
    documentEvidenceId: lease.documentEvidenceId?.trim() || null,
    activatedAt: optionalTimestamp(lease.activatedAt, "activatedAt"),
    endedAt: optionalTimestamp(lease.endedAt, "endedAt"),
    createdAt: optionalTimestamp(lease.createdAt, "createdAt") as string,
    updatedAt: optionalTimestamp(lease.updatedAt, "updatedAt") as string,
    notes: lease.notes?.trim() || null,
  });
}
