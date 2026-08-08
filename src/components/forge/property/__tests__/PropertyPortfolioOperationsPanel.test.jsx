import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "../PropertyValuationPanel",
  () => ({
    default: () => (
      <div data-property-valuation-panel>
        Existing valuation workflow
      </div>
    ),
  }),
);

vi.mock(
  "../PropertyConditionAssessmentPanel",
  () => ({
    default: () => (
      <div data-property-condition-assessment-panel>
        Standardized property condition history
        Add from photo or document
      </div>
    ),
  }),
);

vi.mock(
  "../PropertyHVACPanel",
  () => ({
    default: () => (
      <div data-property-hvac-panel>
        HVAC systems, components, and service history
        Read equipment label or invoice
        reviewable proposals
      </div>
    ),
  }),
);

import PropertyPortfolioOperationsPanel, {
  PROPERTY_PORTFOLIO_OPERATION_VIEWS,
} from "../PropertyPortfolioOperationsPanel.jsx";

describe(
  "PropertyPortfolioOperationsPanel",
  () => {
    it(
      "preserves valuation workflow as the default operation",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyPortfolioOperationsPanel />,
          );

        expect(markup).toContain(
          "data-property-portfolio-operations",
        );

        expect(markup).toContain(
          "Value, condition, and major systems",
        );

        expect(markup).toContain(
          "data-property-valuation-panel",
        );

        expect(markup).toContain(
          "Existing valuation workflow",
        );

        expect(
          PROPERTY_PORTFOLIO_OPERATION_VIEWS.map(
            ({ id }) => id,
          ),
        ).toEqual([
          "valuations",
          "condition",
          "hvac",
        ]);
      },
    );

    it(
      "renders the interactive condition assessment surface",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyPortfolioOperationsPanel
              initialView="condition"
            />,
          );

        expect(markup).toContain(
          "data-property-condition-assessment-panel",
        );

        expect(markup).toContain(
          "Standardized property condition history",
        );

        expect(markup).toContain(
          "Add from photo or document",
        );

        expect(markup).not.toContain(
          "data-property-valuation-panel",
        );
      },
    );

    it(
      "renders the interactive HVAC lifecycle surface",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyPortfolioOperationsPanel
              initialView="hvac"
            />,
          );

        expect(markup).toContain(
          'data-property-hvac-panel',
        );

        expect(markup).toContain(
          "HVAC systems, components, and service history",
        );

        expect(markup).toContain(
          "reviewable proposals",
        );
      },
    );
  },
);
