import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyHVACPanel, {
  buildHVACSystemPayload,
} from "../PropertyHVACPanel.jsx";

describe(
  "PropertyHVACPanel",
  () => {
    it(
      "renders the HVAC system identity interface",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACPanel />,
          );

        expect(markup).toContain(
          "data-property-hvac-panel",
        );

        expect(markup).toContain(
          "HVAC systems, components, and service history",
        );

        expect(markup).toContain(
          "System type",
        );

        expect(markup).toContain(
          "Refrigerant type",
        );

        expect(markup).toContain(
          "Serial number",
        );

        expect(markup).toContain(
          "Save HVAC system",
        );

        expect(markup).toContain(
          "data-property-hvac-component-panel",
        );

        expect(markup).toContain(
          "Component identity and replacement history",
        );

        expect(markup).toContain(
          "Save an HVAC system before adding its components.",
        );

        expect(markup).toContain(
          "Read equipment label or invoice",
        );

        expect(markup).toContain(
          "reviewable proposals",
        );
      },
    );

    it(
      "builds a structured HVAC system payload",
      () => {
        expect(
          buildHVACSystemPayload({
            propertyId:
              "property_1214_wagner",
            values: {
              name: " Main HVAC ",
              systemType:
                "split_system",
              energySource:
                "electric",
              refrigerantType:
                " R-410A ",
              tonnage: "3.5",
              efficiencyRating:
                " 16 SEER ",
              manufacturer:
                " Carrier ",
              modelNumber:
                " 24ABC ",
              serialNumber:
                " 12345 ",
              installedAt:
                "2020-06-15",
              estimatedAgeYears:
                "6",
              location:
                " Attic ",
              thermostatType:
                " Smart ",
              warrantyExpiration:
                "2030-06-15",
              status: "active",
              condition: "good",
              notes:
                " Operating normally. ",
            },
          }),
        ).toEqual({
          propertyId:
            "property_1214_wagner",
          name: "Main HVAC",
          systemType:
            "split_system",
          energySource:
            "electric",
          refrigerantType:
            "R-410A",
          tonnage: 3.5,
          efficiencyRating:
            "16 SEER",
          manufacturer: "Carrier",
          modelNumber: "24ABC",
          serialNumber: "12345",
          installedAt:
            "2020-06-15T00:00:00.000Z",
          estimatedAgeYears: 6,
          location: "Attic",
          thermostatType: "Smart",
          warrantyExpiration:
            "2030-06-15T00:00:00.000Z",
          status: "active",
          condition: "good",
          notes:
            "Operating normally.",
        });
      },
    );

    it(
      "normalizes optional HVAC fields",
      () => {
        expect(
          buildHVACSystemPayload({
            propertyId: "property_1",
            values: {
              name: " ",
              systemType: "unknown",
              energySource: "unknown",
              refrigerantType: "",
              tonnage: "",
              efficiencyRating: "",
              manufacturer: "",
              modelNumber: "",
              serialNumber: "",
              installedAt: "",
              estimatedAgeYears: "",
              location: "",
              thermostatType: "",
              warrantyExpiration: "",
              status: "active",
              condition: "unknown",
              notes: "",
            },
          }),
        ).toEqual({
          propertyId: "property_1",
          name: "Main HVAC",
          systemType: "unknown",
          energySource: "unknown",
          refrigerantType: null,
          tonnage: null,
          efficiencyRating: null,
          manufacturer: null,
          modelNumber: null,
          serialNumber: null,
          installedAt: null,
          estimatedAgeYears: null,
          location: null,
          thermostatType: null,
          warrantyExpiration: null,
          status: "active",
          condition: "unknown",
          notes: null,
        });
      },
    );
  },
);
