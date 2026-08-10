import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyOperatingCostsWorkflowChooser, {
  OPERATING_COST_WORKFLOW_CHOICES,
  PropertyOperatingCostsWorkflowHeader,
  getOperatingCostWorkflowChoice,
} from "../PropertyOperatingCostsWorkflowChooser.jsx";

describe(
  "PropertyOperatingCostsWorkflowChooser",
  () => {
    it(
      "offers five compact workflow choices",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyOperatingCostsWorkflowChooser />,
          );

        expect(
          OPERATING_COST_WORKFLOW_CHOICES,
        ).toHaveLength(5);

        expect(markup).toContain(
          "What do you want to do?",
        );

        for (
          const choice of
          OPERATING_COST_WORKFLOW_CHOICES
        ) {
          expect(markup).toContain(
            choice.label,
          );

          expect(markup).not.toContain(
            choice.explanation,
          );
        }
      },
    );

    it(
      "defaults guidance to on",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyOperatingCostsWorkflowChooser />,
          );

        expect(markup).toContain(
          "Guidance on",
        );

        expect(markup).toContain(
          'aria-pressed="true"',
        );
      },
    );

    it(
      "shows only the selected explanation",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyOperatingCostsWorkflowHeader
              workflowId="property-tax"
            />,
          );

        expect(markup).toContain(
          getOperatingCostWorkflowChoice(
            "property-tax",
          ).explanation,
        );

        expect(markup).not.toContain(
          getOperatingCostWorkflowChoice(
            "insurance-policy",
          ).explanation,
        );
      },
    );

    it(
      "hides optional guidance when off",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyOperatingCostsWorkflowHeader
              workflowId="insurance-policy"
              showGuidance={false}
            />,
          );

        expect(markup).toContain(
          "Add or update insurance policy",
        );

        expect(markup).not.toContain(
          getOperatingCostWorkflowChoice(
            "insurance-policy",
          ).explanation,
        );
      },
    );

    it(
      "returns no header for an unsupported workflow",
      () => {
        expect(
          renderToStaticMarkup(
            <PropertyOperatingCostsWorkflowHeader
              workflowId="unsupported"
            />,
          ),
        ).toBe("");
      },
    );
  },
);
