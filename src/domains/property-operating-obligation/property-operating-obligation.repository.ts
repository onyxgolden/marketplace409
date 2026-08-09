import type {
  PropertyOperatingObligation,
  PropertyOperatingObligationRecognitionStatus,
  PropertyOperatingObligationScope,
  PropertyOperatingObligationStatus,
  PropertyOperatingObligationType,
} from "./property-operating-obligation.types";

export type PropertyOperatingObligationPersistenceContext =
  Readonly<{
    ownerId: string;
  }>;

export type PropertyOperatingObligationQuery =
  Readonly<{
    propertyId?: string | null;
    scope?: PropertyOperatingObligationScope | null;
    obligationType?:
      PropertyOperatingObligationType | null;
    status?:
      PropertyOperatingObligationStatus | null;
    recognitionStatus?:
      PropertyOperatingObligationRecognitionStatus | null;
    unreconciledOnly?: boolean;
  }>;

export interface PropertyOperatingObligationRepository {
  save(
    obligation: PropertyOperatingObligation,
    context:
      PropertyOperatingObligationPersistenceContext,
  ): Promise<PropertyOperatingObligation>;

  saveMany(
    obligations:
      readonly PropertyOperatingObligation[],
    context:
      PropertyOperatingObligationPersistenceContext,
  ): Promise<
    readonly PropertyOperatingObligation[]
  >;

  findById(
    id: string,
    ownerId: string,
  ): Promise<
    PropertyOperatingObligation | null
  >;

  list(
    query: PropertyOperatingObligationQuery,
    ownerId: string,
  ): Promise<
    readonly PropertyOperatingObligation[]
  >;

  findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<
    readonly PropertyOperatingObligation[]
  >;

  deleteById(
    id: string,
    ownerId: string,
  ): Promise<
    PropertyOperatingObligation | null
  >;
}
