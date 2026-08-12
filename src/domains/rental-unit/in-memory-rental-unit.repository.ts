import type { RentalUnitPersistenceContext, RentalUnitRepository } from "./rental-unit.repository";
import type { RentalUnit } from "./rental-unit.types";

type StoredUnit = Readonly<{ ownerId: string; unit: RentalUnit }>;

function identifier(value: string, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}

export class InMemoryRentalUnitRepository implements RentalUnitRepository {
  private readonly units = new Map<string, StoredUnit>();

  async save(unit: RentalUnit, context: RentalUnitPersistenceContext): Promise<RentalUnit> {
    const ownerId = identifier(context?.ownerId, "Rental unit owner id is required.");
    this.units.set(`${ownerId}:${unit.id}`, Object.freeze({ ownerId, unit }));
    return unit;
  }

  async findById(id: string, ownerId: string): Promise<RentalUnit | null> {
    const requiredOwnerId = identifier(ownerId, "Rental unit owner id is required.");
    const requiredId = identifier(id, "Rental unit id is required.");
    return this.units.get(`${requiredOwnerId}:${requiredId}`)?.unit ?? null;
  }

  async findByProperty(propertyId: string, ownerId: string): Promise<readonly RentalUnit[]> {
    const requiredOwnerId = identifier(ownerId, "Rental unit owner id is required.");
    const requiredPropertyId = identifier(propertyId, "Rental unit property id is required.");
    return Object.freeze(Array.from(this.units.values())
      .filter((stored) => stored.ownerId === requiredOwnerId && stored.unit.propertyId === requiredPropertyId)
      .map((stored) => stored.unit)
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)));
  }
}
