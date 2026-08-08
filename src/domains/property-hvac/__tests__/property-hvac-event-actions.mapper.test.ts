import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createHVACComponentEvent,
} from "../property-hvac.types";

import {
  mapHVACComponentEventRowToDomain,
  mapHVACComponentEventToRow,
} from "../property-hvac.mapper";

describe(
  "HVAC event component action mapping",
  () => {
    it(
      "round-trips multiple actions through the Supabase JSON row",
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
            photoReferences: [
              "invoice-603.pdf",
            ],
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

        const row =
          mapHVACComponentEventToRow(
            event,
            "owner_1",
          );

        expect(
          row.component_actions,
        ).toEqual(
          event.componentActions,
        );

        const restored =
          mapHVACComponentEventRowToDomain(
            row,
          );

        expect(
          restored.componentActions,
        ).toEqual(
          event.componentActions,
        );

        expect(
          Object.isFrozen(
            restored.componentActions,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            restored.componentActions[0],
          ),
        ).toBe(true);
      },
    );
  },
);
