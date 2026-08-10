import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyHVACWorkflowChooser, {
  HVAC_WORKFLOW_CHOICES,
  PropertyHVACWorkflowHeader,
  getHVACWorkflowChoice,
} from "../PropertyHVACWorkflowChooser.jsx";

describe(
  "PropertyHVACWorkflowChooser",
  () => {
    it(
      "offers five compact workflow choices without permanent explanations",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACWorkflowChooser />,
          );

        expect(markup).toContain(
          "What do you want to do?",
        );

        expect(markup).toContain(
          "Inspection or service",
        );

        expect(markup).toContain(
          "Component repair or replacement",
        );

        expect(markup).toContain(
          "Complete system failure",
        );

        expect(markup).toContain(
          "Complete system replacement",
        );

        for (
          const choice of
            HVAC_WORKFLOW_CHOICES
        ) {
          expect(markup)
            .not.toContain(
              choice.explanation,
            );
        }
      },
    );

    it(
      "defaults guided explanations to on",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACWorkflowChooser />,
          );

        expect(markup).toContain(
          'aria-pressed="true"',
        );

        expect(markup).toContain(
          "Guidance on",
        );
      },
    );

    it(
      "shows only the selected workflow explanation",
      () => {
        const selected =
          getHVACWorkflowChoice(
            "replacement",
          );

        const markup =
          renderToStaticMarkup(
            <PropertyHVACWorkflowHeader
              workflowId="replacement"
            />,
          );

        expect(markup).toContain(
          selected.explanation,
        );

        expect(markup).not.toContain(
          getHVACWorkflowChoice(
            "service",
          ).explanation,
        );

        expect(markup).toContain(
          "Back",
        );
      },
    );

    it(
      "hides the selected explanation when guidance is off",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACWorkflowHeader
              workflowId="failure"
              showGuidance={false}
            />,
          );

        expect(markup).toContain(
          "Complete system failure",
        );

        expect(markup).not.toContain(
          getHVACWorkflowChoice(
            "failure",
          ).explanation,
        );
      },
    );

    it(
      "returns no header for an unsupported workflow",
      () => {
        expect(
          renderToStaticMarkup(
            <PropertyHVACWorkflowHeader
              workflowId="unknown"
            />,
          ),
        ).toBe("");
      },
    );
  },
);
