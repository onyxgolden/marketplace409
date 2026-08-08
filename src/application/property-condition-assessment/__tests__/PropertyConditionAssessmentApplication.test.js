import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  InMemoryPropertyConditionAssessmentRepository,
} from "@/domains/property-condition-assessment/in-memory-property-condition-assessment.repository";

import {
  PropertyConditionAssessmentApplication,
} from "../PropertyConditionAssessmentApplication";

function createApplication() {
  let nextId = 0;

  const repository =
    new InMemoryPropertyConditionAssessmentRepository();

  const application =
    new PropertyConditionAssessmentApplication(
      repository,
      {
        clock: () =>
          "2026-08-08T12:00:00.000Z",
        idFactory: () => {
          nextId += 1;
          return String(nextId);
        },
      },
    );

  return {
    application,
    repository,
  };
}

function buildInput(
  overrides = {},
) {
  return {
    propertyId:
      "1214-wagner",
    assessmentType:
      "licensed_inspection",
    assessmentDate:
      "2026-08-08",
    assessorName:
      "  Property owner  ",
    assessorCredential:
      "spoofed-license",
    summary:
      "  Annual owner review.  ",
    items: [
      {
        section:
          "hvac_systems",
        systemKey:
          "central_hvac_1",
        itemKey:
          "outdoor_unit",
        label:
          "Outdoor condensing unit",
        observationStatus:
          "attention_needed",
        condition:
          "marginal",
        replacementPriority:
          "planned",
        estimatedReplacementCost:
          "$8,500.00",
        plannedReplacementYear:
          "2028",
        valuationImpact:
          "negative",
        attributes: {
          systemType:
            "split_system",
          approximateAgeYears:
            18,
        },
        notes:
          "  Older unit.  ",
      },
    ],
    ...overrides,
  };
}

describe(
  "PropertyConditionAssessmentApplication",
  () => {
    it(
      "records a normalized owner assessment with generated identities",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const assessment =
          await application.recordOwnerAssessment(
            buildInput(),
            " owner_1 ",
          );

        expect(assessment).toMatchObject({
          id:
            "property_condition_assessment_1",
          propertyId:
            "1214-wagner",
          assessmentType:
            "owner_assessment",
          effectiveAt:
            "2026-08-08T00:00:00.000Z",
          createdAt:
            "2026-08-08T12:00:00.000Z",
          assessorName:
            "Property owner",
          assessorCredential:
            null,
          summary:
            "Annual owner review.",
        });

        expect(
          assessment.items[0],
        ).toMatchObject({
          id:
            "property_condition_item_2",
          estimatedReplacementCostCents:
            850000,
          plannedReplacementYear:
            2028,
          attributes: {
            systemType:
              "split_system",
            approximateAgeYears:
              18,
          },
          notes:
            "Older unit.",
        });

        await expect(
          repository.findById(
            assessment.id,
            "owner_1",
          ),
        ).resolves.toEqual(
          assessment,
        );
      },
    );

    it(
      "does not allow request data to represent an owner record as licensed",
      async () => {
        const {
          application,
        } = createApplication();

        const assessment =
          await application.recordOwnerAssessment(
            buildInput({
              assessmentType:
                "licensed_inspection",
              assessorCredential:
                "license-123",
            }),
            "owner_1",
          );

        expect(
          assessment.assessmentType,
        ).toBe(
          "owner_assessment",
        );

        expect(
          assessment.assessorCredential,
        ).toBeNull();
      },
    );

    it(
      "applies safe defaults to optional operational observations",
      () => {
        const {
          application,
        } = createApplication();

        const assessment =
          application.createOwnerAssessment(
            buildInput({
              items: [
                {
                  section:
                    "plumbing_systems",
                  systemKey:
                    "water_heater_1",
                  itemKey:
                    "water_heater",
                  label:
                    "Water heater",
                },
              ],
            }),
          );

        expect(
          assessment.items[0],
        ).toMatchObject({
          observationStatus:
            "unknown",
          condition:
            "unknown",
          replacementPriority:
            "unknown",
          estimatedReplacementCostCents:
            null,
          plannedReplacementYear:
            null,
          valuationImpact:
            "unknown",
          attributes: {},
          notes: null,
        });
      },
    );

    it(
      "requires owner, property, and item input",
      async () => {
        const {
          application,
        } = createApplication();

        await expect(
          application.recordOwnerAssessment(
            buildInput(),
            "",
          ),
        ).rejects.toThrow(
          "Property condition assessment owner ID is required.",
        );

        expect(() =>
          application.createOwnerAssessment(
            buildInput({
              propertyId: "",
            }),
          ),
        ).toThrow(
          "Property condition assessment property ID is required.",
        );

        expect(() =>
          application.createOwnerAssessment(
            buildInput({
              items: null,
            }),
          ),
        ).toThrow(
          "Property condition assessment items are required.",
        );
      },
    );

    it(
      "delegates owner-scoped queries and freezes returned collections",
      async () => {
        const repository = {
          findById:
            vi.fn().mockResolvedValue(
              null,
            ),
          findByProperty:
            vi.fn().mockResolvedValue(
              [],
            ),
          findLatestByOwnerId:
            vi.fn().mockResolvedValue(
              [],
            ),
        };

        const application =
          new PropertyConditionAssessmentApplication(
            repository,
          );

        await application.getById(
          "assessment_1",
          "owner_1",
        );

        expect(
          repository.findById,
        ).toHaveBeenCalledWith(
          "assessment_1",
          "owner_1",
        );

        const history =
          await application.listByProperty(
            "1214-wagner",
            "owner_1",
          );

        expect(
          repository.findByProperty,
        ).toHaveBeenCalledWith(
          "1214-wagner",
          "owner_1",
        );

        expect(
          Object.isFrozen(history),
        ).toBe(true);

        const latest =
          await application.listLatest(
            "owner_1",
          );

        expect(
          repository.findLatestByOwnerId,
        ).toHaveBeenCalledWith(
          "owner_1",
        );

        expect(
          Object.isFrozen(latest),
        ).toBe(true);
      },
    );
  },
);
