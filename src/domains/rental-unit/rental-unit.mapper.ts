import { createRentalUnit } from "./rental-unit.types";
import type { RentalUnit, RentalUnitStatus } from "./rental-unit.types";

export type RentalUnitRow = Readonly<{
  id: string;
  owner_id: string;
  property_id: string;
  label: string;
  status: RentalUnitStatus;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  available_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}>;

function ownerId(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Rental unit owner id is required.");
  }
  return value.trim();
}

export function mapRentalUnitRowToRentalUnit(row: RentalUnitRow): RentalUnit {
  return createRentalUnit({
    id: row.id,
    propertyId: row.property_id,
    label: row.label,
    status: row.status,
    bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
    bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
    squareFeet: row.square_feet === null ? null : Number(row.square_feet),
    availableAt: row.available_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes,
  });
}

export function mapRentalUnitToRow(unit: RentalUnit, requiredOwnerId: string): RentalUnitRow {
  return Object.freeze({
    id: unit.id,
    owner_id: ownerId(requiredOwnerId),
    property_id: unit.propertyId,
    label: unit.label,
    status: unit.status,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    square_feet: unit.squareFeet,
    available_at: unit.availableAt,
    created_at: unit.createdAt,
    updated_at: unit.updatedAt,
    notes: unit.notes,
  });
}
