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
  addressStreet: string | null;
  addressUnit: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
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

function optionalAddressText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function optionalAddressState(
  value: string | null | undefined,
): string | null {
  const trimmed = optionalAddressText(value);
  return trimmed === null ? null : trimmed.toUpperCase();
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

/** Input accepted by createRentalUnit — address fields are optional for
 *  records created before structured addresses existed. */
export type RentalUnitInput = Omit<
  RentalUnit,
  "addressStreet" | "addressUnit" | "addressCity" | "addressState" | "addressZip"
> & {
  addressStreet?: string | null;
  addressUnit?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
};

export function createRentalUnit(
  unit: RentalUnitInput,
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
    addressStreet: optionalAddressText(unit.addressStreet),
    addressUnit: optionalAddressText(unit.addressUnit),
    addressCity: optionalAddressText(unit.addressCity),
    addressState: optionalAddressState(unit.addressState),
    addressZip: optionalAddressText(unit.addressZip),
  });
}
