import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapPropertyConditionAssessmentRecordToDomain,
  mapPropertyConditionAssessmentToRecord,
} from "../property-condition-assessment.mapper";

import {
  createPropertyConditionAssessment,
} from "../property-condition-assessment.types";

function buildAssessment() {
  return createPropertyConditionAssessment({
    id: "assessment_1",
    propertyId: "1214-wagner",
    assessmentType: "owner_assessment",
    effectiveAt:
      "2026-08-08T00:00:00.000Z",
    createdAt:
      "2026-08-08T01:00:00.000Z",
    assessorName: "Property owner",
    assessorCredential: null,
    sourceReference: null,
    summary: "Annual review.",
    items: [
      {
        id: "item_1",
        section: "hvac_systems",
        systemKey: "central_hvac_1",
        itemKey: "outdoor_unit",
        label:
          "Outdoor condensing unit",
        observationStatus:
          "attention_needed",
        condition: "marginal",
        replacementPriority: "planned",
        estimatedReplacementCostCents:
          850000,
        plannedReplacementYear: 2028,
        valuationImpact: "negative",
        notes: "Older unit.",
      },
    ],
  });
}

describe(
  "property condition assessment mapper",
  () => {
    it(
      "maps an aggregate to owner-scoped rows and back",
      () => {
        const assessment =
          buildAssessment();

        const record =
          mapPropertyConditionAssessmentToRecord(
            assessment,
            "owner_1",
          );

        expect(
          record.assessment.owner_id,
        ).toBe("owner_1");

        expect(
          record.items[0],
        ).toMatchObject({
          assessment_id:
            "assessment_1",
          owner_id: "owner_1",
          system_key:
            "central_hvac_1",
          estimated_replacement_cost_cents:
            850000,
        });

        const restored =
          mapPropertyConditionAssessmentRecordToDomain(
            record,
          );

        expect(restored).toEqual(
          assessment,
        );

        expect(
          Object.isFrozen(restored),
        ).toBe(true);

        expect(
          Object.isFrozen(
            restored.items[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "requires owner scope when mapping to persistence",
      () => {
        expect(() =>
          mapPropertyConditionAssessmentToRecord(
            buildAssessment(),
            "",
          ),
        ).toThrow(
          "Property condition assessment owner id is required.",
        );
      },
    );

    it(
      "rejects items from another assessment or owner",
      () => {
        const record =
          mapPropertyConditionAssessmentToRecord(
            buildAssessment(),
            "owner_1",
          );

        expect(() =>
          mapPropertyConditionAssessmentRecordToDomain({
            ...record,
            items: [
              {
                ...record.items[0],
                assessment_id:
                  "assessment_2",
              },
            ],
          }),
        ).toThrow(
          "Property condition assessment item references a different assessment.",
        );

        expect(() =>
          mapPropertyConditionAssessmentRecordToDomain({
            ...record,
            items: [
              {
                ...record.items[0],
                owner_id: "owner_2",
              },
            ],
          }),
        ).toThrow(
          "Property condition assessment item references a different owner.",
        );
      },
    );
  },
);
