export const RENTAL_UNIT_STATUSES = [
  "preparing",
  "available",
  "occupied",
  "inactive",
] as const;

export type RentalUnitStatus =
  typeof RENTAL_UNIT_STATUSES[number];

export type RentalUnit = Readonly<{
  id: string;
  propertyId: string;
  label: string;
  status: RentalUnitStatus;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  availableAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
}>;

function requireString(
  value: string,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Rental unit requires ${fieldName}.`);
  }

  return value.trim();
}

function optionalNonNegativeNumber(
  value: number | null,
  fieldName: string,
): number | null {
  if (
    value !== null &&
    (!Number.isFinite(value) || value < 0)
  ) {
    throw new Error(
      `Rental unit ${fieldName} must be a non-negative finite number.`,
    );
  }

  return value;
}

function timestamp(
  value: string,
  fieldName: string,
): string {
  const normalized = requireString(value, fieldName);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Rental unit ${fieldName} must be a valid timestamp.`);
  }

  return normalized;
}

export function createRentalUnit(
  unit: RentalUnit,
): RentalUnit {
  if (!RENTAL_UNIT_STATUSES.includes(unit.status)) {
    throw new Error("Rental unit requires a supported status.");
  }

  return Object.freeze({
    ...unit,
    id: requireString(unit.id, "an id"),
    propertyId: requireString(unit.propertyId, "a property id"),
    label: requireString(unit.label, "a label"),
    bedrooms: optionalNonNegativeNumber(unit.bedrooms, "bedrooms"),
    bathrooms: optionalNonNegativeNumber(unit.bathrooms, "bathrooms"),
    squareFeet: optionalNonNegativeNumber(unit.squareFeet, "square feet"),
    availableAt:
      unit.availableAt === null
        ? null
        : timestamp(unit.availableAt, "availableAt"),
    createdAt: timestamp(unit.createdAt, "createdAt"),
    updatedAt: timestamp(unit.updatedAt, "updatedAt"),
    notes: unit.notes?.trim() || null,
  });
}
