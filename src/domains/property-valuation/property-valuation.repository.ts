import type {
  PropertyValuation,
} from "./property-valuation.types";

export type PropertyValuationPersistenceContext =
  Readonly<{
    ownerId: string;
  }>;

export interface PropertyValuationRepository {
  save(
    valuation: PropertyValuation,
    context: PropertyValuationPersistenceContext,
  ): Promise<PropertyValuation>;

  saveMany(
    valuations: readonly PropertyValuation[],
    context: PropertyValuationPersistenceContext,
  ): Promise<readonly PropertyValuation[]>;

  findById(
    id: string,
    ownerId: string,
  ): Promise<PropertyValuation | null>;

  deleteById(
    id: string,
    ownerId: string,
  ): Promise<PropertyValuation | null>;

  findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<readonly PropertyValuation[]>;

  findLatestByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<PropertyValuation | null>;

  findLatestByOwnerId(
    ownerId: string,
  ): Promise<readonly PropertyValuation[]>;
}
