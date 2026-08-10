import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyConditionWorkflowChooser, {
  PROPERTY_CONDITION_WORKFLOW_CHOICES,
  PropertyConditionWorkflowHeader,
  getPropertyConditionWorkflowChoice,
} from "../PropertyConditionWorkflowChooser.jsx";

describe(
  "PropertyConditionWorkflowChooser",
  () => {
    it(
      "offers two compact working choices",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyConditionWorkflowChooser />,
          );

        expect(
          PROPERTY_CONDITION_WORKFLOW_CHOICES,
        ).toHaveLength(2);

        expect(markup).toContain(
          "What do you want to do?",
        );

        for (
          const choice of
          PROPERTY_CONDITION_WORKFLOW_CHOICES
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
            <PropertyConditionWorkflowChooser />,
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
            <PropertyConditionWorkflowHeader
              workflowId="record"
            />,
          );

        expect(markup).toContain(
          getPropertyConditionWorkflowChoice(
            "record",
          ).explanation,
        );

        expect(markup).not.toContain(
          getPropertyConditionWorkflowChoice(
            "history",
          ).explanation,
        );
      },
    );

    it(
      "hides optional guidance when off",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyConditionWorkflowHeader
              workflowId="history"
              showGuidance={false}
            />,
          );

        expect(markup).toContain(
          "Review condition history",
        );

        expect(markup).not.toContain(
          getPropertyConditionWorkflowChoice(
            "history",
          ).explanation,
        );
      },
    );

    it(
      "returns no unsupported header",
      () => {
        expect(
          renderToStaticMarkup(
            <PropertyConditionWorkflowHeader
              workflowId="unsupported"
            />,
          ),
        ).toBe("");
      },
    );
  },
);
