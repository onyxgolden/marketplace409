import type { RentalUnit } from "./rental-unit.types";

export type RentalUnitPersistenceContext = Readonly<{ ownerId: string }>;

export interface RentalUnitRepository {
  save(unit: RentalUnit, context: RentalUnitPersistenceContext): Promise<RentalUnit>;
  findById(id: string, ownerId: string): Promise<RentalUnit | null>;
  findByProperty(propertyId: string, ownerId: string): Promise<readonly RentalUnit[]>;
}
