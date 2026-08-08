import {
  describe,
  expect,
  it,
} from "vitest";

import {
  HVAC_COMPONENT_TYPES,
  HVAC_EVENT_ACTION_TYPES,
  createHVACComponentEvent,
  createHVACEventComponentAction,
} from "../property-hvac.types";

describe(
  "HVAC event component actions",
  () => {
    it(
      "adds invoice-derived component identities",
      () => {
        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain("filter_drier");

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain(
          "refrigerant_line_set",
        );

        expect(
          HVAC_COMPONENT_TYPES,
        ).toContain(
          "low_voltage_wiring",
        );
      },
    );

    it(
      "defines controlled immutable service actions",
      () => {
        expect(
          HVAC_EVENT_ACTION_TYPES,
        ).toContain("replaced");

        expect(
          HVAC_EVENT_ACTION_TYPES,
        ).toContain("repaired");

        expect(
          HVAC_EVENT_ACTION_TYPES,
        ).toContain("cleaned");

        expect(
          HVAC_EVENT_ACTION_TYPES,
        ).toContain("recharged");

        const action =
          createHVACEventComponentAction({
            actionType: "recharged",
            componentId: null,
            componentType: null,
            description:
              "Charged system with R-410A.",
            quantity: 13,
            unit: "pounds",
            allocatedCostCents: null,
          });

        expect(action).toEqual({
          actionType: "recharged",
          componentId: null,
          componentType: null,
          description:
            "Charged system with R-410A.",
          quantity: 13,
          unit: "pounds",
          allocatedCostCents: null,
        });

        expect(
          Object.isFrozen(action),
        ).toBe(true);
      },
    );

    it(
      "preserves multiple immutable actions under one invoice event",
      () => {
        const event =
          createHVACComponentEvent({
            id: "event_603",
            systemId: "system_1",
            componentId: null,
            eventType: "repaired",
            occurredAt:
              "2026-08-01T00:00:00.000Z",
            failureSymptoms:
              "System flat on refrigerant.",
            workPerformed:
              "Leak repair and component replacement.",
            costCents: 95000,
            vendorName:
              "Arctic Air Conditioning & Heating",
            invoiceReference: "603",
            photoReferences: [],
            componentActions: [
              {
                actionType: "replaced",
                componentId: null,
                componentType:
                  "filter_drier",
                description:
                  "Replaced filter drier.",
                quantity: 1,
                unit: "each",
                allocatedCostCents: null,
              },
              {
                actionType: "replaced",
                componentId: null,
                componentType:
                  "contactor",
                description:
                  "Replaced welded contactor.",
                quantity: 1,
                unit: "each",
                allocatedCostCents: null,
              },
              {
                actionType: "recharged",
                componentId: null,
                componentType: null,
                description:
                  "Charged with R-410A.",
                quantity: 13,
                unit: "pounds",
                allocatedCostCents: null,
              },
            ],
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          });

        expect(event.costCents).toBe(
          95000,
        );

        expect(
          event.componentActions,
        ).toHaveLength(3);

        expect(
          Object.isFrozen(
            event.componentActions,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            event.componentActions[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects invalid action values",
      () => {
        expect(() =>
          createHVACEventComponentAction({
            actionType:
              "unsupported" as never,
            componentId: null,
            componentType: null,
            description:
              "Invalid action.",
            quantity: null,
            unit: null,
            allocatedCostCents: null,
          }),
        ).toThrow(
          "HVAC event component action requires a supported action type.",
        );

        expect(() =>
          createHVACEventComponentAction({
            actionType: "repaired",
            componentId: null,
            componentType:
              "unsupported" as never,
            description:
              "Invalid component.",
            quantity: null,
            unit: null,
            allocatedCostCents: null,
          }),
        ).toThrow(
          "HVAC event component action requires a supported component type.",
        );
      },
    );
  },
);
