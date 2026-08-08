import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyConditionAssessmentRepository,
} from "../in-memory-property-condition-assessment.repository";

import {
  createPropertyConditionAssessment,
} from "../property-condition-assessment.types";

function buildAssessment({
  id = "assessment_1",
  propertyId = "property_1",
  effectiveAt =
    "2026-08-08T00:00:00.000Z",
} = {}) {
  return createPropertyConditionAssessment({
    id,
    propertyId,
    assessmentType: "owner_assessment",
    effectiveAt,
    createdAt: effectiveAt,
    assessorName: null,
    assessorCredential: null,
    sourceReference: null,
    summary: null,
    items: [],
  });
}

describe(
  "InMemoryPropertyConditionAssessmentRepository",
  () => {
    it(
      "saves owner-scoped assessment history in effective-date order",
      async () => {
        const repository =
          new InMemoryPropertyConditionAssessmentRepository();

        await repository.save(
          buildAssessment({
            id: "assessment_old",
            effectiveAt:
              "2026-01-01T00:00:00.000Z",
          }),
          {
            ownerId: "owner_1",
          },
        );

        await repository.save(
          buildAssessment({
            id: "assessment_new",
            effectiveAt:
              "2026-08-08T00:00:00.000Z",
          }),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.findByProperty(
            "property_1",
            "owner_1",
          ),
        ).resolves.toEqual([
          buildAssessment({
            id: "assessment_new",
            effectiveAt:
              "2026-08-08T00:00:00.000Z",
          }),
          buildAssessment({
            id: "assessment_old",
            effectiveAt:
              "2026-01-01T00:00:00.000Z",
          }),
        ]);

        await expect(
          repository.findByProperty(
            "property_1",
            "owner_2",
          ),
        ).resolves.toEqual([]);
      },
    );

    it(
      "does not allow identical ids to cross owner scope",
      async () => {
        const repository =
          new InMemoryPropertyConditionAssessmentRepository();

        const ownerOneAssessment =
          buildAssessment({
            id: "shared_id",
            propertyId: "property_1",
          });

        const ownerTwoAssessment =
          buildAssessment({
            id: "shared_id",
            propertyId: "property_2",
          });

        await repository.save(
          ownerOneAssessment,
          {
            ownerId: "owner_1",
          },
        );

        await repository.save(
          ownerTwoAssessment,
          {
            ownerId: "owner_2",
          },
        );

        await expect(
          repository.findById(
            "shared_id",
            "owner_1",
          ),
        ).resolves.toEqual(
          ownerOneAssessment,
        );

        await expect(
          repository.findById(
            "shared_id",
            "owner_2",
          ),
        ).resolves.toEqual(
          ownerTwoAssessment,
        );
      },
    );

    it(
      "finds one latest assessment per property",
      async () => {
        const repository =
          new InMemoryPropertyConditionAssessmentRepository();

        for (
          const assessment of [
            buildAssessment({
              id: "property_1_old",
              propertyId: "property_1",
              effectiveAt:
                "2026-01-01T00:00:00.000Z",
            }),
            buildAssessment({
              id: "property_1_new",
              propertyId: "property_1",
              effectiveAt:
                "2026-08-08T00:00:00.000Z",
            }),
            buildAssessment({
              id: "property_2_new",
              propertyId: "property_2",
              effectiveAt:
                "2026-07-01T00:00:00.000Z",
            }),
          ]
        ) {
          await repository.save(
            assessment,
            {
              ownerId: "owner_1",
            },
          );
        }

        const latest =
          await repository.findLatestByOwnerId(
            "owner_1",
          );

        expect(
          latest.map(({ id }) => id),
        ).toEqual([
          "property_1_new",
          "property_2_new",
        ]);
      },
    );

    it(
      "requires owner scope",
      async () => {
        const repository =
          new InMemoryPropertyConditionAssessmentRepository();

        await expect(
          repository.save(
            buildAssessment(),
            {} as never,
          ),
        ).rejects.toThrow(
          "Property condition assessment owner id is required.",
        );

        await expect(
          repository.findLatestByOwnerId(
            "",
          ),
        ).rejects.toThrow(
          "Property condition assessment owner id is required.",
        );
      },
    );
  },
);
