import {
  describe,
  expect,
  it,
} from "vitest";

import {
  HVAC_COMPONENT_TYPES,
  createHVACComponent,
  createHVACComponentEvent,
  createHVACSystem,
} from "../property-hvac.types";

function buildSystem(
  overrides = {},
) {
  return {
    id: "hvac_system_1",
    propertyId: "1214-wagner",
    name: "Main HVAC",
    systemType: "split_system" as const,
    energySource: "electric" as const,
    refrigerantType: "R-22",
    tonnage: 3.5,
    efficiencyRating: "10 SEER",
    manufacturer: "Carrier",
    modelNumber: "MODEL-1",
    serialNumber: "SERIAL-1",
    installedAt:
      "2008-06-01T00:00:00.000Z",
    estimatedAgeYears: 18,
    location: "Attic and east exterior",
    thermostatType: "digital",
    warrantyExpiration: null,
    status: "active" as const,
    condition: "marginal" as const,
    notes: "  Older system.  ",
    createdAt:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function buildComponent(
  overrides = {},
) {
  return {
    id: "hvac_component_1",
    systemId: "hvac_system_1",
    componentType: "capacitor" as const,
    name: "Run capacitor",
    manufacturer: "Titan",
    modelNumber: null,
    partNumber: "TRCFD455",
    serialNumber: null,
    installedAt:
      "2025-07-01T00:00:00.000Z",
    removedAt: null,
    estimatedAgeYears: 1,
    condition: "good" as const,
    status: "installed" as const,
    estimatedReplacementCostCents:
      35000,
    vendorName: "ABC HVAC",
    invoiceReference:
      "invoice-100",
    warrantyExpiration:
      "2027-07-01T00:00:00.000Z",
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe(
  "property HVAC lifecycle",
  () => {
    it(
      "creates immutable HVAC system identity",
      () => {
        const system =
          createHVACSystem(
            buildSystem(),
          );

        expect(
          system.refrigerantType,
        ).toBe("R-22");

        expect(system.notes).toBe(
          "Older system.",
        );

        expect(
          Object.isFrozen(system),
        ).toBe(true);
      },
    );

    it(
      "defines frequently replaced HVAC components",
      () => {
        expect(
          HVAC_COMPONENT_TYPES,
        ).toEqual(
          expect.arrayContaining([
            "compressor",
            "condenser_coil",
            "condenser_fan_motor",
            "capacitor",
            "contactor",
            "control_board",
            "evaporator_coil",
            "blower_motor",
            "ecm_module",
            "txv_or_metering_device",
            "condensate_pump",
            "gas_valve",
            "igniter",
            "inducer_motor",
            "heat_exchanger",
          ]),
        );

        expect(
          HVAC_COMPONENT_TYPES,
        ).toHaveLength(26);
      },
    );

    it(
      "tracks component identity independently from system age",
      () => {
        const component =
          createHVACComponent(
            buildComponent(),
          );

        expect(
          component.estimatedAgeYears,
        ).toBe(1);

        expect(
          component.partNumber,
        ).toBe("TRCFD455");

        expect(
          component.estimatedReplacementCostCents,
        ).toBe(35000);

        expect(
          Object.isFrozen(component),
        ).toBe(true);
      },
    );

    it(
      "rejects removal before installation",
      () => {
        expect(() =>
          createHVACComponent(
            buildComponent({
              removedAt:
                "2024-01-01T00:00:00.000Z",
            }),
          ),
        ).toThrow(
          "HVAC component removal date cannot precede installation.",
        );
      },
    );

    it(
      "creates immutable append-only component events",
      () => {
        const event =
          createHVACComponentEvent({
            id: "hvac_event_1",
            systemId:
              "hvac_system_1",
            componentId:
              "hvac_component_1",
            eventType: "repaired",
            occurredAt:
              "2026-08-01T00:00:00.000Z",
            failureSymptoms:
              "Outdoor fan would not start.",
            workPerformed:
              "Replaced run capacitor.",
            costCents: 35000,
            vendorName: "ABC HVAC",
            invoiceReference:
              "invoice-100",
            photoReferences: [
              "photo-before",
              "photo-after",
            ],
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          });

        expect(
          event.photoReferences,
        ).toEqual([
          "photo-before",
          "photo-after",
        ]);

        expect(
          Object.isFrozen(event),
        ).toBe(true);

        expect(
          Object.isFrozen(
            event.photoReferences,
          ),
        ).toBe(true);
      },
    );

    it(
      "supports system-level events without a component",
      () => {
        const event =
          createHVACComponentEvent({
            id: "hvac_event_1",
            systemId:
              "hvac_system_1",
            componentId: null,
            eventType: "inspected",
            occurredAt:
              "2026-08-01T00:00:00.000Z",
            failureSymptoms: null,
            workPerformed:
              "Annual system inspection.",
            costCents: null,
            vendorName: null,
            invoiceReference: null,
            photoReferences: [],
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          });

        expect(
          event.componentId,
        ).toBeNull();
      },
    );

    it(
      "rejects unsupported values and invalid costs",
      () => {
        expect(() =>
          createHVACSystem(
            buildSystem({
              systemType:
                "unsupported",
            }) as never,
          ),
        ).toThrow(
          "HVAC system requires a supported system type.",
        );

        expect(() =>
          createHVACComponent(
            buildComponent({
              componentType:
                "unsupported",
            }) as never,
          ),
        ).toThrow(
          "HVAC component requires a supported component type.",
        );

        expect(() =>
          createHVACComponentEvent({
            id: "event_1",
            systemId: "system_1",
            componentId: null,
            eventType: "serviced",
            occurredAt:
              "2026-08-01T00:00:00.000Z",
            failureSymptoms: null,
            workPerformed: null,
            costCents: -1,
            vendorName: null,
            invoiceReference: null,
            photoReferences: [],
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          }),
        ).toThrow(
          "HVAC component event cost must be a non-negative integer number of cents.",
        );
      },
    );
  },
);
