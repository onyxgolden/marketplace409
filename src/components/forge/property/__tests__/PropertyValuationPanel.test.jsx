import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyValuationPanel, {
  buildValuationProperties,
} from "../PropertyValuationPanel.jsx";

import {
  clearSWRCache,
  fetchWithDedupe,
} from "../../../../hooks/swrCache";

// Seeds the stale-while-revalidate cache the way a return visit would: the
// panel renders instantly from cached data with no loading flash.
async function seedValuationCache() {
  await fetchWithDedupe(
    "property:portfolio-properties",
    () => Promise.resolve([
      { id: "prop_1", name: "123 Main St" },
    ]),
  );
  await fetchWithDedupe(
    "property:valuations",
    () => Promise.resolve([]),
  );
}

describe(
  "PropertyValuationPanel",
  () => {
    it(
      "selects canonical financial workspace properties",
      () => {
        const properties =
          buildValuationProperties({
            data: {
              business: {
                reports: {
                  properties: [
                    {
                      propertyId:
                        "170-john",
                    },
                    {
                      propertyId:
                        "unassigned",
                    },
                    {
                      propertyId:
                        "185-laxon",
                      propertyName:
                        "185 Laxon Street",
                    },
                  ],
                },
              },
            },
          });

        expect(properties).toEqual([
          {
            id:
              "170-john",
            name:
              "170 John",
          },
          {
            id:
              "185-laxon",
            name:
              "185 Laxon Street",
          },
        ]);

        expect(
          Object.isFrozen(
            properties[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "renders a compact valuation landing surface",
      async () => {
        await seedValuationCache();

        const markup =
          renderToStaticMarkup(
            <PropertyValuationPanel />,
          );

        clearSWRCache();

        expect(markup).toContain(
          "data-property-valuation-panel",
        );

        expect(markup).toContain(
          "Current property values",
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
          "Preview and import CSV",
        );

        expect(markup).not.toContain(
          "property_id and current_value",
        );

        expect(markup).not.toContain(
          "Record valuation",
        );
      },
    );

    it(
      "renders provenance and latest-value messaging",
      async () => {
        await seedValuationCache();

        const markup =
          renderToStaticMarkup(
            <PropertyValuationPanel />,
          );

        clearSWRCache();

        expect(markup).toContain(
          "owner-controlled valuation history",
        );

        expect(markup).toContain(
          "Recorded property values",
        );

        expect(markup).not.toContain(
          "Latest Recorded Values",
        );

        expect(markup).not.toContain(
          "Remove valuation",
        );

        // Warm cache: the landing renders with no loading flash.
        expect(markup).not.toContain(
          "Loading property valuations",
        );
      },
    );
  },
);
