import type {
  PropertyConditionAssessmentPersistenceContext,
  PropertyConditionAssessmentRepository,
} from "./property-condition-assessment.repository";

import type {
  PropertyConditionAssessment,
} from "./property-condition-assessment.types";

type StoredAssessment = Readonly<{
  ownerId: string;
  assessment: PropertyConditionAssessment;
}>;

function requireIdentifier(
  value: string,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function storageKey(
  ownerId: string,
  assessmentId: string,
): string {
  return `${ownerId}:${assessmentId}`;
}

function sortAssessments(
  assessments:
    readonly PropertyConditionAssessment[],
): readonly PropertyConditionAssessment[] {
  return Object.freeze(
    [...assessments].sort(
      (left, right) =>
        right.effectiveAt.localeCompare(
          left.effectiveAt,
        ) ||
        right.createdAt.localeCompare(
          left.createdAt,
        ) ||
        left.id.localeCompare(right.id),
    ),
  );
}

export class InMemoryPropertyConditionAssessmentRepository
  implements PropertyConditionAssessmentRepository {
  private readonly assessmentsByOwnerAndId =
    new Map<string, StoredAssessment>();

  async save(
    assessment: PropertyConditionAssessment,
    context:
      PropertyConditionAssessmentPersistenceContext,
  ): Promise<PropertyConditionAssessment> {
    const ownerId =
      requireIdentifier(
        context?.ownerId,
        "Property condition assessment owner id is required.",
      );

    this.assessmentsByOwnerAndId.set(
      storageKey(
        ownerId,
        assessment.id,
      ),
      Object.freeze({
        ownerId,
        assessment,
      }),
    );

    return assessment;
  }

  async findById(
    id: string,
    ownerId: string,
  ): Promise<PropertyConditionAssessment | null> {
    const requiredId =
      requireIdentifier(
        id,
        "Property condition assessment id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    return (
      this.assessmentsByOwnerAndId.get(
        storageKey(
          requiredOwnerId,
          requiredId,
        ),
      )?.assessment ?? null
    );
  }

  async findByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<
    readonly PropertyConditionAssessment[]
  > {
    const requiredPropertyId =
      requireIdentifier(
        propertyId,
        "Property condition assessment property id is required.",
      );
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );

    return sortAssessments(
      Array.from(
        this.assessmentsByOwnerAndId.values(),
      )
        .filter(
          (stored) =>
            stored.ownerId ===
              requiredOwnerId &&
            stored.assessment.propertyId ===
              requiredPropertyId,
        )
        .map(
          (stored) =>
            stored.assessment,
        ),
    );
  }

  async findLatestByProperty(
    propertyId: string,
    ownerId: string,
  ): Promise<PropertyConditionAssessment | null> {
    const assessments =
      await this.findByProperty(
        propertyId,
        ownerId,
      );

    return assessments[0] ?? null;
  }

  async findLatestByOwnerId(
    ownerId: string,
  ): Promise<
    readonly PropertyConditionAssessment[]
  > {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property condition assessment owner id is required.",
      );
    const latestByProperty =
      new Map<
        string,
        PropertyConditionAssessment
      >();

    const assessments =
      sortAssessments(
        Array.from(
          this.assessmentsByOwnerAndId.values(),
        )
          .filter(
            (stored) =>
              stored.ownerId ===
              requiredOwnerId,
          )
          .map(
            (stored) =>
              stored.assessment,
          ),
      );

    for (const assessment of assessments) {
      if (
        !latestByProperty.has(
          assessment.propertyId,
        )
      ) {
        latestByProperty.set(
          assessment.propertyId,
          assessment,
        );
      }
    }

    return Object.freeze(
      Array.from(
        latestByProperty.values(),
      ).sort(
        (left, right) =>
          left.propertyId.localeCompare(
            right.propertyId,
          ),
      ),
    );
  }
}
