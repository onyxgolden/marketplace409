import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyHVACSystemReplacementPanel, {
  buildHVACReplacementPayload,
} from "../PropertyHVACSystemReplacementPanel.jsx";

const systems = [{
  id: "system_old",
  name: "Old HVAC",
  status: "active",
}];

describe(
  "PropertyHVACSystemReplacementPanel",
  () => {
    it(
      "renders an explicit permanent replacement approval",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACSystemReplacementPanel
              systems={systems}
            />,
          );

        expect(markup).toContain(
          "Permanent lifecycle transition",
        );

        expect(markup).toContain(
          "Existing history is preserved and is not overwritten.",
        );

        expect(markup).toContain(
          'value="system_old" selected=""',
        );

        expect(markup).toContain(
          "Approve and record complete replacement",
        );

        expect(markup).toContain(
          "disabled",
        );
      },
    );

    it(
      "builds the atomic replacement request",
      () => {
        expect(
          buildHVACReplacementPayload({
            predecessorSystemId:
              "system_old",
            values: {
              name: " New HVAC ",
              systemType: "heat_pump",
              energySource: "electric",
              manufacturer: " Carrier ",
              modelNumber: " 25VNA ",
              serialNumber: " NEW-1 ",
              refrigerantType:
                " R-410A ",
              tonnage: "4.5",
              efficiencyRating:
                " 16 SEER ",
              location:
                " Attic and exterior ",
              thermostatType:
                " Smart ",
              warrantyExpiration:
                "2036-08-10",
              failureDate:
                "2026-08-09",
              failureSymptoms:
                " Compressor failed. ",
              failureNotes: "",
              installationDate:
                "2026-08-10",
              workPerformed:
                " Installed replacement. ",
              cost: "8500",
              vendorName: " ABC HVAC ",
              invoiceReference:
                " INV-1 ",
              evidenceId: " evidence_1 ",
              installationNotes: "",
            },
          }),
        ).toEqual({
          predecessorSystemId:
            "system_old",
          evidenceId: "evidence_1",
          occurredAt:
            "2026-08-10T00:00:00.000Z",
          replacementSystem: {
            name: "New HVAC",
            systemType: "heat_pump",
            energySource: "electric",
            manufacturer: "Carrier",
            modelNumber: "25VNA",
            serialNumber: "NEW-1",
            refrigerantType:
              "R-410A",
            tonnage: 4.5,
            efficiencyRating:
              "16 SEER",
            location:
              "Attic and exterior",
            thermostatType: "Smart",
            warrantyExpiration:
              "2036-08-10T00:00:00.000Z",
            installedAt:
              "2026-08-10T00:00:00.000Z",
            condition: "good",
          },
          failureEvent: {
            occurredAt:
              "2026-08-09T00:00:00.000Z",
            failureSymptoms:
              "Compressor failed.",
            notes: null,
          },
          installationEvent: {
            occurredAt:
              "2026-08-10T00:00:00.000Z",
            workPerformed:
              "Installed replacement.",
            cost: 8500,
            vendorName: "ABC HVAC",
            invoiceReference: "INV-1",
            notes: null,
          },
          initialComponents: [],
        });
      },
    );

    it(
      "rejects retired systems from the replacement selector",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACSystemReplacementPanel
              systems={[
                ...systems,
                {
                  id: "system_retired",
                  name: "Retired HVAC",
                  status: "replaced",
                },
              ]}
            />,
          );

        expect(markup).not.toContain(
          "Retired HVAC",
        );
      },
    );
  },
);
