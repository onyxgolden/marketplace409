import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyValuationPanel from "../PropertyValuationPanel.jsx";

describe(
  "PropertyValuationPanel",
  () => {
    it(
      "renders manual and spreadsheet valuation controls",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationPanel />,
          );

        expect(markup).toContain(
          "data-property-valuation-panel",
        );

        expect(markup).toContain(
          "Current Property Values",
        );

        expect(markup).toContain(
          "Record a property value",
        );

        expect(markup).toContain(
          "Preview and import CSV",
        );

        expect(markup).toContain(
          "property_id and current_value",
        );

        expect(markup).toContain(
          "Record valuation",
        );
      },
    );

    it(
      "renders provenance and latest-value messaging",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyValuationPanel />,
          );

        expect(markup).toContain(
          "owner-controlled valuation history",
        );

        expect(markup).toContain(
          "Latest Recorded Values",
        );

        expect(markup).toContain(
          "Owner-scoped property valuations",
        );

        expect(markup).toContain(
          "Loading property valuations",
        );
      },
    );
  },
);
