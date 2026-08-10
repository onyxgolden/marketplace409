import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyValuationWorkflowChooser, {
  PropertyValuationWorkflowHeader,
  getPropertyValuationWorkflowChoice,
} from "../PropertyValuationWorkflowChooser.jsx";

describe(
  "PropertyValuationWorkflowChooser",
  () => {
    it(
      "offers three compact valuation workflows",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationWorkflowChooser />,
          );

        expect(markup).toContain(
          "What do you want to do?",
        );

        expect(markup).toContain(
          "Record or update a property value",
        );

        expect(markup).toContain(
          "Import valuation CSV",
        );

        expect(markup).toContain(
          "Review recorded values",
        );

        expect(markup).not.toContain(
          "Record a verified owner estimate",
        );
      },
    );

    it(
      "defaults guidance to on",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationWorkflowChooser />,
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
      "shows only the selected workflow explanation",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationWorkflowHeader
              workflowId="import"
              showGuidance
            />,
          );

        expect(markup).toContain(
          "Preview a valuation spreadsheet",
        );

        expect(markup).not.toContain(
          "Record a verified owner estimate",
        );

        expect(markup).not.toContain(
          "Review the latest owner-scoped value",
        );
      },
    );

    it(
      "hides the selected explanation when guidance is off",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationWorkflowHeader
              workflowId="history"
              showGuidance={false}
            />,
          );

        expect(markup).toContain(
          "Review recorded values",
        );

        expect(markup).not.toContain(
          "Review the latest owner-scoped value",
        );
      },
    );

    it(
      "returns no workflow for an unsupported identifier",
      () => {
        expect(
          getPropertyValuationWorkflowChoice(
            "unsupported",
          ),
        ).toBeNull();

        expect(
          renderToStaticMarkup(
            <PropertyValuationWorkflowHeader
              workflowId="unsupported"
              showGuidance
            />,
          ),
        ).toBe("");
      },
    );
  },
);
