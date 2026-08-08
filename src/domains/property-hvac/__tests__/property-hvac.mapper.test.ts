import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapHVACComponentEventRowToDomain,
  mapHVACComponentEventToRow,
  mapHVACComponentRowToDomain,
  mapHVACComponentToRow,
  mapHVACSystemRowToDomain,
  mapHVACSystemToRow,
} from "../property-hvac.mapper";

import {
  createHVACComponent,
  createHVACComponentEvent,
  createHVACSystem,
} from "../property-hvac.types";

describe(
  "property HVAC mapper",
  () => {
    it(
      "round-trips owner-scoped system rows",
      () => {
        const system =
          createHVACSystem({
            id: "system_1",
            propertyId:
              "1214-wagner",
            name: "Main HVAC",
            systemType:
              "split_system",
            energySource:
              "electric",
            refrigerantType:
              "R-410A",
            tonnage: 3.5,
            efficiencyRating:
              "14 SEER",
            manufacturer:
              "Carrier",
            modelNumber:
              "MODEL-1",
            serialNumber:
              "SERIAL-1",
            installedAt:
              "2015-01-01T00:00:00.000Z",
            estimatedAgeYears:
              11,
            location:
              "Attic",
            thermostatType:
              "digital",
            warrantyExpiration:
              null,
            status: "active",
            condition:
              "serviceable",
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          });

        const row =
          mapHVACSystemToRow(
            system,
            " owner_1 ",
          );

        expect(
          row.owner_id,
        ).toBe("owner_1");

        expect(
          mapHVACSystemRowToDomain({
            ...row,
            tonnage: "3.5",
            estimated_age_years:
              "11",
          }),
        ).toEqual(system);
      },
    );

    it(
      "round-trips component rows with numeric database values",
      () => {
        const component =
          createHVACComponent({
            id: "component_1",
            systemId:
              "system_1",
            componentType:
              "blower_motor",
            name:
              "Blower motor",
            manufacturer:
              "Carrier",
            modelNumber: null,
            partNumber:
              "PART-1",
            serialNumber: null,
            installedAt:
              "2024-01-01T00:00:00.000Z",
            removedAt: null,
            estimatedAgeYears:
              2,
            condition: "good",
            status: "installed",
            estimatedReplacementCostCents:
              95000,
            vendorName:
              "ABC HVAC",
            invoiceReference:
              "invoice-1",
            warrantyExpiration:
              null,
            notes: null,
            createdAt:
              "2026-08-08T00:00:00.000Z",
          });

        const row =
          mapHVACComponentToRow(
            component,
            "owner_1",
          );

        expect(
          mapHVACComponentRowToDomain({
            ...row,
            estimated_age_years:
              "2",
            estimated_replacement_cost_cents:
              "95000",
          }),
        ).toEqual(component);
      },
    );

    it(
      "round-trips immutable event rows",
      () => {
        const event =
          createHVACComponentEvent({
            id: "event_1",
            systemId:
              "system_1",
            componentId:
              "component_1",
            eventType:
              "repaired",
            occurredAt:
              "2026-08-01T00:00:00.000Z",
            failureSymptoms:
              "Motor noise",
            workPerformed:
              "Replaced bearings",
            costCents: 45000,
            vendorName:
              "ABC HVAC",
            invoiceReference:
              "invoice-2",
            photoReferences: [
              "photo-1",
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

        const restored =
          mapHVACComponentEventRowToDomain({
            ...row,
            cost_cents:
              "45000",
          });

        expect(restored).toEqual(
          event,
        );

        expect(
          Object.isFrozen(
            restored.photoReferences,
          ),
        ).toBe(true);
      },
    );

    it(
      "requires owner scope for every persistence mapping",
      () => {
        const base = {
          id: "system_1",
          propertyId:
            "property_1",
          name: "Main HVAC",
          systemType:
            "split_system",
          energySource:
            "electric",
          refrigerantType:
            null,
          tonnage: null,
          efficiencyRating:
            null,
          manufacturer: null,
          modelNumber: null,
          serialNumber: null,
          installedAt: null,
          estimatedAgeYears:
            null,
          location: null,
          thermostatType:
            null,
          warrantyExpiration:
            null,
          status: "active",
          condition: "unknown",
          notes: null,
          createdAt:
            "2026-08-08T00:00:00.000Z",
        } as const;

        expect(() =>
          mapHVACSystemToRow(
            createHVACSystem(base),
            "",
          ),
        ).toThrow(
          "HVAC owner id is required.",
        );
      },
    );
  },
);
