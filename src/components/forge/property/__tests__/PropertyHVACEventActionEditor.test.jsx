import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyHVACEventActionEditor, {
  buildHVACEventAction,
} from "../PropertyHVACEventActionEditor.jsx";

describe(
  "PropertyHVACEventActionEditor",
  () => {
    it(
      "renders controlled invoice action inputs",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACEventActionEditor
              components={[
                {
                  id: "component_1",
                  name: "Main Contactor",
                },
              ]}
              actions={[
                {
                  actionType:
                    "replaced",
                  componentId:
                    "component_1",
                  componentType:
                    "contactor",
                  description:
                    "Replaced welded contactor.",
                  quantity: 1,
                  unit: "each",
                  allocatedCostCents:
                    null,
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "data-property-hvac-event-action-editor",
        );

        expect(markup).toContain(
          "Work included in this event",
        );

        expect(markup).toContain(
          "Filter Drier",
        );

        expect(markup).toContain(
          "Refrigerant Line Set",
        );

        expect(markup).toContain(
          "Low Voltage Wiring",
        );

        expect(markup).toContain(
          "Main Contactor",
        );

        expect(markup).toContain(
          "Replaced welded contactor.",
        );

        expect(markup).toContain(
          "Add component action",
        );
      },
    );

    it(
      "builds a replaced component action",
      () => {
        expect(
          buildHVACEventAction({
            values: {
              actionType:
                "replaced",
              componentId: "",
              componentType:
                "filter_drier",
              description:
                " Replaced filter drier. ",
              quantity: "1",
              unit: " each ",
              allocatedCostDollars:
                "",
            },
          }),
        ).toEqual({
          actionType: "replaced",
          componentId: null,
          componentType:
            "filter_drier",
          description:
            "Replaced filter drier.",
          quantity: 1,
          unit: "each",
          allocatedCostCents: null,
        });
      },
    );

    it(
      "builds a refrigerant recharge action",
      () => {
        expect(
          buildHVACEventAction({
            values: {
              actionType:
                "recharged",
              componentId: "",
              componentType: "",
              description:
                " Charged with R-410A. ",
              quantity: "13",
              unit: " pounds ",
              allocatedCostDollars:
                "300.50",
            },
          }),
        ).toEqual({
          actionType: "recharged",
          componentId: null,
          componentType: null,
          description:
            "Charged with R-410A.",
          quantity: 13,
          unit: "pounds",
          allocatedCostCents: 30050,
        });
      },
    );

    it(
      "supports a system action without quantity or allocated cost",
      () => {
        expect(
          buildHVACEventAction({
            values: {
              actionType: "tested",
              componentId: "",
              componentType: "",
              description:
                " Pressure tested system. ",
              quantity: "",
              unit: "",
              allocatedCostDollars:
                "",
            },
          }),
        ).toEqual({
          actionType: "tested",
          componentId: null,
          componentType: null,
          description:
            "Pressure tested system.",
          quantity: null,
          unit: null,
          allocatedCostCents: null,
        });
      },
    );
  },
);
