import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  HVAC_COMPONENT_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

import PropertyHVACComponentPanel, {
  buildHVACComponentPayload,
} from "../PropertyHVACComponentPanel.jsx";

describe(
  "PropertyHVACComponentPanel",
  () => {
    it(
      "renders independently tracked HVAC components",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACComponentPanel
              systems={[
                {
                  id: "system_1",
                  name: "Main HVAC",
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "data-property-hvac-component-panel",
        );

        expect(markup).toContain(
          "Component identity and replacement history",
        );

        expect(markup).toContain(
          "Compressor",
        );

        expect(markup).toContain(
          "Condenser Coil",
        );

        expect(markup).toContain(
          "Blower Motor",
        );

        expect(markup).toContain(
          "Heat Exchanger",
        );

        expect(markup).toContain(
          "Save HVAC component",
        );

        expect(markup).toContain(
          "data-property-hvac-event-panel",
        );

        expect(markup).toContain(
          "Inspection and service history",
        );

        expect(markup).toContain(
          'value="system_1" selected=""',
        );
      },
    );

    it(
      "renders focused service without the component form",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACComponentPanel
              systems={[
                {
                  id: "system_1",
                  name: "Main HVAC",
                },
              ]}
              mode="service"
              focused
            />,
          );

        expect(markup).toContain(
          'data-property-hvac-mode="service"',
        );

        expect(markup).toContain(
          "Inspection and service history",
        );

        expect(markup).not.toContain(
          "Save HVAC component",
        );

        expect(markup).not.toContain(
          "Recorded components",
        );

        expect(markup).not.toContain(
          "Component identity and replacement history",
        );
      },
    );

    it(
      "defaults focused failure recording to a failed event",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACComponentPanel
              systems={[
                {
                  id: "system_1",
                  name: "Main HVAC",
                },
              ]}
              mode="failure"
              focused
            />,
          );

        expect(markup).toContain(
          'value="failed" selected=""',
        );

        expect(markup).not.toContain(
          "Save HVAC component",
        );
      },
    );

    it(
      "exposes all controlled replaceable component types",
      () => {
        expect(
          HVAC_COMPONENT_TYPES,
        ).toHaveLength(26);

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain("compressor");

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain("capacitor");

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain(
          "evaporator_coil",
        );

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain(
          "condensate_pump",
        );

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain(
          "heat_exchanger",
        );
      },
    );

    it(
      "builds a normalized component payload with independent age and cost",
      () => {
        expect(
          buildHVACComponentPayload({
            systemId: "system_1",
            values: {
              componentType:
                "compressor",
              name:
                " Main Compressor ",
              manufacturer:
                " Copeland ",
              modelNumber:
                " ZR42 ",
              partNumber:
                " P-100 ",
              serialNumber:
                " S-200 ",
              installedAt:
                "2022-03-01",
              removedAt: "",
              estimatedAgeYears:
                "4",
              condition: "good",
              status: "installed",
              estimatedReplacementCostDollars:
                "1850.50",
              vendorName:
                " Gulf Coast HVAC ",
              invoiceReference:
                " INV-42 ",
              warrantyExpiration:
                "2032-03-01",
              notes:
                " Replacement compressor. ",
            },
          }),
        ).toEqual({
          systemId: "system_1",
          componentType:
            "compressor",
          name: "Main Compressor",
          manufacturer: "Copeland",
          modelNumber: "ZR42",
          partNumber: "P-100",
          serialNumber: "S-200",
          installedAt:
            "2022-03-01T00:00:00.000Z",
          removedAt: null,
          estimatedAgeYears: 4,
          condition: "good",
          status: "installed",
          estimatedReplacementCostCents:
            185050,
          vendorName:
            "Gulf Coast HVAC",
          invoiceReference: "INV-42",
          warrantyExpiration:
            "2032-03-01T00:00:00.000Z",
          notes:
            "Replacement compressor.",
        });
      },
    );
  },
);
