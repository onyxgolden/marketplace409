import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  HVAC_COMPONENT_EVENT_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

import PropertyHVACEventPanel, {
  buildHVACEventPayload,
} from "../PropertyHVACEventPanel.jsx";

describe(
  "PropertyHVACEventPanel",
  () => {
    it(
      "renders system-level and component-linked service history",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACEventPanel
              systemId="system_1"
              components={[
                {
                  id: "component_1",
                  name: "Main Compressor",
                },
              ]}
              events={[
                {
                  id: "event_1",
                  systemId: "system_1",
                  componentId:
                    "component_1",
                  eventType: "repaired",
                  occurredAt:
                    "2026-08-08T00:00:00.000Z",
                  failureSymptoms:
                    "No cooling",
                  workPerformed:
                    "Replaced capacitor",
                  costCents: 42500,
                },
                {
                  id: "event_2",
                  systemId: "system_1",
                  componentId: null,
                  eventType: "inspected",
                  occurredAt:
                    "2026-08-07T00:00:00.000Z",
                  failureSymptoms: null,
                  workPerformed:
                    "Annual inspection",
                  costCents: null,
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "data-property-hvac-event-panel",
        );

        expect(markup).toContain(
          "Service, failure, and replacement events",
        );

        expect(markup).toContain(
          "Main Compressor",
        );

        expect(markup).toContain(
          "System-level event",
        );

        expect(markup).toContain(
          "No cooling",
        );

        expect(markup).toContain(
          "Replaced capacitor",
        );

        expect(markup).toContain(
          "$425.00",
        );

        expect(markup).toContain(
          "Record HVAC event",
        );

        expect(markup).toContain(
          "Add invoice or service photo",
        );
      },
    );

    it(
      "supports all append-only HVAC event types",
      () => {
        expect(
          HVAC_COMPONENT_EVENT_TYPES,
        ).toEqual([
          "installed",
          "inspected",
          "serviced",
          "repaired",
          "failed",
          "replaced",
          "removed",
        ]);
      },
    );

    it(
      "builds a normalized component-linked event payload",
      () => {
        expect(
          buildHVACEventPayload({
            systemId: "system_1",
            values: {
              componentId:
                " component_1 ",
              eventType: "repaired",
              occurredAt:
                "2026-08-08",
              failureSymptoms:
                " No cooling ",
              workPerformed:
                " Replaced capacitor ",
              costDollars:
                "425.50",
              vendorName:
                " Gulf Coast HVAC ",
              invoiceReference:
                " INV-500 ",
              notes:
                " Unit tested normally. ",
            },
          }),
        ).toEqual({
          systemId: "system_1",
          componentId:
            "component_1",
          eventType: "repaired",
          occurredAt:
            "2026-08-08T00:00:00.000Z",
          failureSymptoms:
            "No cooling",
          workPerformed:
            "Replaced capacitor",
          costCents: 42550,
          vendorName:
            "Gulf Coast HVAC",
          invoiceReference:
            "INV-500",
          photoReferences: [],
          notes:
            "Unit tested normally.",
        });
      },
    );

    it(
      "builds a system-level event without a component",
      () => {
        expect(
          buildHVACEventPayload({
            systemId: "system_1",
            values: {
              componentId: "",
              eventType: "inspected",
              occurredAt:
                "2026-08-07",
              failureSymptoms: "",
              workPerformed:
                " Annual inspection ",
              costDollars: "",
              vendorName: "",
              invoiceReference: "",
              notes: "",
            },
          }),
        ).toEqual({
          systemId: "system_1",
          componentId: null,
          eventType: "inspected",
          occurredAt:
            "2026-08-07T00:00:00.000Z",
          failureSymptoms: null,
          workPerformed:
            "Annual inspection",
          costCents: null,
          vendorName: null,
          invoiceReference: null,
          photoReferences: [],
          notes: null,
        });
      },
    );
  },
);
