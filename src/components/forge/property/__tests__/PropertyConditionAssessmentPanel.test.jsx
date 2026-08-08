import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyConditionAssessmentPanel, {
  buildConditionObservation,
  formatPropertyConditionDate,
} from "../PropertyConditionAssessmentPanel.jsx";

describe(
  "PropertyConditionAssessmentPanel",
  () => {
    it(
      "renders the standardized manual assessment interface",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyConditionAssessmentPanel />,
          );

        expect(markup).toContain(
          "data-property-condition-assessment-panel",
        );

        expect(markup).toContain(
          "Standardized property condition history",
        );

        expect(markup).toContain(
          "Checklist section",
        );

        expect(markup).toContain(
          "Checklist item",
        );

        expect(markup).toContain(
          "Add observation",
        );

        expect(markup).toContain(
          "Save assessment",
        );

        expect(markup).toContain(
          "Add from photo or document",
        );

        expect(markup).toContain(
          "reviewable field proposals",
        );
      },
    );

    it(
      "builds a complete catalog-backed observation payload",
      () => {
        expect(
          buildConditionObservation({
            section:
              "structural_systems",
            itemKey:
              "roof_structures_and_attics",
            status: "observed",
            attributes: {
              roofStructureType:
                "conventional",
              averageInsulationDepth:
                8,
            },
            notes:
              "Viewed from attic access.",
            estimatedReplacementCostCents:
              125000,
            plannedReplacementYear:
              2027,
          }),
        ).toEqual({
          section:
            "structural_systems",
          systemKey:
            "roof_structures_and_attics",
          itemKey:
            "roof_structures_and_attics",
          label:
            "Roof Structures and Attics",
          observationStatus:
            "observed",
          condition: "unknown",
          replacementPriority:
            "unknown",
          estimatedReplacementCostCents:
            125000,
          plannedReplacementYear:
            2027,
          valuationImpact: "unknown",
          attributes: {
            roofStructureType:
              "conventional",
            averageInsulationDepth:
              8,
          },
          notes:
            "Viewed from attic access.",
        });
      },
    );

    it(
      "normalizes optional observation values to persistence-safe defaults",
      () => {
        expect(
          buildConditionObservation({
            section: "hvac_systems",
            itemKey:
              "cooling_equipment",
            status: "observed",
            notes: "  ",
          }),
        ).toEqual({
          section: "hvac_systems",
          systemKey:
            "cooling_equipment",
          itemKey:
            "cooling_equipment",
          label:
            "Cooling Equipment",
          observationStatus:
            "observed",
          condition: "unknown",
          replacementPriority:
            "unknown",
          estimatedReplacementCostCents:
            null,
          plannedReplacementYear:
            null,
          valuationImpact: "unknown",
          attributes: {},
          notes: null,
        });
      },
    );

    it(
      "preserves the effective calendar date across local time zones",
      () => {
        expect(
          formatPropertyConditionDate(
            "2026-08-08T00:00:00.000Z",
          ),
        ).toBe("8/8/2026");
      },
    );

    it(
      "rejects an unknown checklist identity before persistence",
      () => {
        expect(() =>
          buildConditionObservation({
            section:
              "structural_systems",
            itemKey:
              "not_in_catalog",
            status: "observed",
          }),
        ).toThrow(
          "Choose a supported checklist item.",
        );
      },
    );
  },
);
