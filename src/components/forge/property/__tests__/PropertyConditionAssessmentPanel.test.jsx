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
      "builds an owner observation with structured attributes",
      () => {
        expect(
          buildConditionObservation({
            section:
              "structural_systems",
            itemKey: "roof_covering",
            status: "deficient",
            attributes: {
              roofType:
                "composition_shingle",
              approximateAgeYears: 14,
            },
            notes:
              "Granule loss observed.",
            estimatedReplacementCostCents:
              1250000,
            plannedReplacementYear:
              2027,
          }),
        ).toEqual({
          section:
            "structural_systems",
          itemKey: "roof_covering",
          systemKey: "roof_covering",
          status: "deficient",
          attributes: {
            roofType:
              "composition_shingle",
            approximateAgeYears: 14,
          },
          notes:
            "Granule loss observed.",
          estimatedReplacementCostCents:
            1250000,
          plannedReplacementYear:
            2027,
        });
      },
    );

    it(
      "normalizes optional observation values",
      () => {
        expect(
          buildConditionObservation({
            section: "hvac_systems",
            itemKey:
              "cooling_equipment",
            status: "operational",
            notes: "  ",
          }),
        ).toEqual({
          section: "hvac_systems",
          itemKey:
            "cooling_equipment",
          systemKey:
            "cooling_equipment",
          status: "operational",
          attributes: {},
          notes: null,
        });
      },
    );
  },
);
