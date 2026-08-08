import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyHVACRepository,
} from "../in-memory-property-hvac.repository";

import {
  createHVACComponent,
  createHVACComponentEvent,
  createHVACSystem,
} from "../property-hvac.types";

function system(
  overrides = {},
) {
  return createHVACSystem({
    id: "system_1",
    propertyId: "property_1",
    name: "Main HVAC",
    systemType:
      "split_system",
    energySource:
      "electric",
    refrigerantType:
      "R-410A",
    tonnage: 3,
    efficiencyRating:
      "14 SEER",
    manufacturer: null,
    modelNumber: null,
    serialNumber: null,
    installedAt: null,
    estimatedAgeYears: null,
    location: null,
    thermostatType: null,
    warrantyExpiration: null,
    status: "active",
    condition: "serviceable",
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  });
}

function component(
  overrides = {},
) {
  return createHVACComponent({
    id: "component_1",
    systemId: "system_1",
    componentType:
      "capacitor",
    name: "Run capacitor",
    manufacturer: null,
    modelNumber: null,
    partNumber: null,
    serialNumber: null,
    installedAt: null,
    removedAt: null,
    estimatedAgeYears: null,
    condition: "good",
    status: "installed",
    estimatedReplacementCostCents:
      null,
    vendorName: null,
    invoiceReference: null,
    warrantyExpiration: null,
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  });
}

function event(
  overrides = {},
) {
  return createHVACComponentEvent({
    id: "event_1",
    systemId: "system_1",
    componentId:
      "component_1",
    eventType: "serviced",
    occurredAt:
      "2026-08-08T00:00:00.000Z",
    failureSymptoms: null,
    workPerformed:
      "Annual service",
    costCents: null,
    vendorName: null,
    invoiceReference: null,
    photoReferences: [],
    notes: null,
    createdAt:
      "2026-08-08T00:00:00.000Z",
    ...overrides,
  });
}

describe(
  "InMemoryPropertyHVACRepository",
  () => {
    it(
      "stores systems within owner and property scope",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        await repository.saveSystem(
          system(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.findSystemsByProperty(
            "property_1",
            "owner_1",
          ),
        ).resolves.toEqual([
          system(),
        ]);

        await expect(
          repository.findSystemsByProperty(
            "property_1",
            "owner_2",
          ),
        ).resolves.toEqual([]);
      },
    );

    it(
      "requires an owner-scoped system before saving a component",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        await expect(
          repository.saveComponent(
            component(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).rejects.toThrow(
          "HVAC component requires an owner-scoped system.",
        );

        await repository.saveSystem(
          system(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.saveComponent(
            component(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).resolves.toEqual(
          component(),
        );
      },
    );

    it(
      "prevents identical ids from crossing owner scope",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        const ownerOne =
          system({
            propertyId:
              "property_1",
          });

        const ownerTwo =
          system({
            propertyId:
              "property_2",
          });

        await repository.saveSystem(
          ownerOne,
          {
            ownerId: "owner_1",
          },
        );

        await repository.saveSystem(
          ownerTwo,
          {
            ownerId: "owner_2",
          },
        );

        await expect(
          repository.findSystemById(
            "system_1",
            "owner_1",
          ),
        ).resolves.toEqual(
          ownerOne,
        );

        await expect(
          repository.findSystemById(
            "system_1",
            "owner_2",
          ),
        ).resolves.toEqual(
          ownerTwo,
        );
      },
    );

    it(
      "appends component events in descending occurrence order",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        await repository.saveSystem(
          system(),
          {
            ownerId: "owner_1",
          },
        );

        await repository.saveComponent(
          component(),
          {
            ownerId: "owner_1",
          },
        );

        await repository.appendComponentEvent(
          event({
            id: "event_old",
            occurredAt:
              "2026-01-01T00:00:00.000Z",
          }),
          {
            ownerId: "owner_1",
          },
        );

        await repository.appendComponentEvent(
          event({
            id: "event_new",
            occurredAt:
              "2026-08-08T00:00:00.000Z",
          }),
          {
            ownerId: "owner_1",
          },
        );

        const events =
          await repository.findEventsByComponent(
            "component_1",
            "owner_1",
          );

        expect(
          events.map(({ id }) => id),
        ).toEqual([
          "event_new",
          "event_old",
        ]);

        expect(
          Object.isFrozen(events),
        ).toBe(true);
      },
    );

    it(
      "rejects events referencing another system's component",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        await repository.saveSystem(
          system(),
          {
            ownerId: "owner_1",
          },
        );

        await repository.saveSystem(
          system({
            id: "system_2",
          }),
          {
            ownerId: "owner_1",
          },
        );

        await repository.saveComponent(
          component(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.appendComponentEvent(
            event({
              systemId:
                "system_2",
            }),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).rejects.toThrow(
          "HVAC component event requires a component from the same owner-scoped system.",
        );
      },
    );

    it(
      "keeps event identities append-only",
      async () => {
        const repository =
          new InMemoryPropertyHVACRepository();

        await repository.saveSystem(
          system(),
          {
            ownerId: "owner_1",
          },
        );

        await repository.saveComponent(
          component(),
          {
            ownerId: "owner_1",
          },
        );

        await repository.appendComponentEvent(
          event(),
          {
            ownerId: "owner_1",
          },
        );

        await expect(
          repository.appendComponentEvent(
            event(),
            {
              ownerId:
                "owner_1",
            },
          ),
        ).rejects.toThrow(
          "HVAC component event id already exists.",
        );
      },
    );
  },
);
