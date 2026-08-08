import type {
  PropertyConditionAssessment,
} from "./property-condition-assessment.types";

export type PropertyConditionAssessmentPersistenceContext =
  Readonly<{
    ownerId: string;
  }>;

export interface PropertyConditionAssessmentRepository {
  save(
    assessment: PropertyConditionAssessment,
    context:
      PropertyConditionAssessmentPersistenceContext,
  ): Promise<PropertyConditionAssessment>;

  findById(
    id: string,
    ownerId: string,
  ): Promise<PropertyConditionAssessment | null>;

  findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<
    readonly PropertyConditionAssessment[]
  >;

  findLatestByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<PropertyConditionAssessment | null>;

  findLatestByOwnerId(
    ownerId: string,
  ): Promise<
    readonly PropertyConditionAssessment[]
  >;
}
