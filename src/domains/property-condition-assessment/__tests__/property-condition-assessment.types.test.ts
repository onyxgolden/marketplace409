import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPropertyConditionAssessment,
} from "../property-condition-assessment.types";

import type {
  PropertyConditionAssessment,
} from "../property-condition-assessment.types";

function buildAssessment(
  overrides:
    Partial<PropertyConditionAssessment> = {},
): PropertyConditionAssessment {
  return {
    id: "assessment_1",
    propertyId: "1214-wagner",
    assessmentType: "owner_assessment",
    effectiveAt:
      "2026-08-08T00:00:00.000Z",
    createdAt:
      "2026-08-08T00:00:00.000Z",
    assessorName: "  Property owner  ",
    assessorCredential: null,
    sourceReference: null,
    summary: "  Annual condition review.  ",
    items: [
      {
        id: "assessment_item_1",
        section: "hvac_systems",
        systemKey: "  central_hvac_1  ",
        itemKey: "  outdoor_unit  ",
        label: "  Outdoor condensing unit  ",
        observationStatus: "attention_needed",
        condition: "marginal",
        replacementPriority: "planned",
        estimatedReplacementCostCents:
          850000,
        plannedReplacementYear: 2028,
        valuationImpact: "negative",
        attributes: {
          systemType:
            "split_system",
          approximateAgeYears: 18,
        },
        notes:
          "  Older unit; operating today.  ",
      },
    ],
    ...overrides,
  };
}

describe(
  "PropertyConditionAssessment",
  () => {
    it(
      "creates an immutable normalized owner assessment",
      () => {
        const assessment =
          createPropertyConditionAssessment(
            buildAssessment(),
          );

        expect(
          assessment.assessorName,
        ).toBe("Property owner");

        expect(assessment.summary).toBe(
          "Annual condition review.",
        );

        expect(
          assessment.items[0].systemKey,
        ).toBe("central_hvac_1");

        expect(
          assessment.items[0].attributes,
        ).toEqual({
          systemType:
            "split_system",
          approximateAgeYears: 18,
        });

        expect(
          Object.isFrozen(
            assessment.items[0]
              .attributes,
          ),
        ).toBe(true);

        expect(
          assessment.items[0].notes,
        ).toBe(
          "Older unit; operating today.",
        );

        expect(
          Object.isFrozen(assessment),
        ).toBe(true);

        expect(
          Object.isFrozen(
            assessment.items,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            assessment.items[0],
          ),
        ).toBe(true);
      },
    );

    it.each([
      "owner_assessment",
      "licensed_inspection",
      "contractor_evaluation",
      "maintenance_review",
    ] as const)(
      "supports %s records",
      (assessmentType) => {
        const assessment =
          createPropertyConditionAssessment(
            buildAssessment({
              assessmentType,
            }),
          );

        expect(
          assessment.assessmentType,
        ).toBe(assessmentType);
      },
    );

    it.each([
      "structural_systems",
      "electrical_systems",
      "hvac_systems",
      "plumbing_systems",
      "appliances",
      "optional_systems",
    ] as const)(
      "supports the %s section",
      (section) => {
        const assessment =
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...buildAssessment()
                    .items[0],
                  section,
                },
              ],
            }),
          );

        expect(
          assessment.items[0].section,
        ).toBe(section);
      },
    );

    it(
      "rejects invalid structured attributes",
      () => {
        const item =
          buildAssessment().items[0];

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...item,
                  attributes:
                    [] as never,
                },
              ],
            }),
          ),
        ).toThrow(
          "Property condition assessment item attributes must be an object.",
        );

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...item,
                  attributes: {
                    invalid:
                      Number.POSITIVE_INFINITY,
                  },
                },
              ],
            }),
          ),
        ).toThrow(
          "Property condition assessment item numeric attributes must be finite.",
        );
      },
    );

    it(
      "rejects duplicate item identities",
      () => {
        const item =
          buildAssessment().items[0];

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                item,
                {
                  ...item,
                },
              ],
            }),
          ),
        ).toThrow(
          "Property condition assessment item ids must be unique.",
        );
      },
    );

    it(
      "rejects invalid operational estimates",
      () => {
        const item =
          buildAssessment().items[0];

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...item,
                  estimatedReplacementCostCents:
                    -1,
                },
              ],
            }),
          ),
        ).toThrow(
          "Property condition assessment replacement cost must be a non-negative integer number of cents.",
        );

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...item,
                  plannedReplacementYear:
                    1800,
                },
              ],
            }),
          ),
        ).toThrow(
          "Property condition assessment planned replacement year must be between 1900 and 2200.",
        );
      },
    );

    it(
      "rejects unsupported controlled values",
      () => {
        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              assessmentType:
                "unknown",
            } as never) as never,
          ),
        ).toThrow(
          "Property condition assessment requires a supported assessment type.",
        );

        expect(() =>
          createPropertyConditionAssessment(
            buildAssessment({
              items: [
                {
                  ...buildAssessment()
                    .items[0],
                  section:
                    "unknown",
                },
              ],
            } as never) as never,
          ),
        ).toThrow(
          "Property condition assessment item requires a supported section.",
        );
      },
    );
  },
);
