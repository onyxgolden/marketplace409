import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyHVACRepository,
} from "@/domains/property-hvac/in-memory-property-hvac.repository";

import {
  PropertyHVACApplication,
} from "../PropertyHVACApplication";

function createApplication() {
  let nextId = 0;

  const repository =
    new InMemoryPropertyHVACRepository();

  const application =
    new PropertyHVACApplication(
      repository,
      {
        clock: () =>
          "2026-08-08T12:00:00.000Z",
        idFactory: () => {
          nextId += 1;
          return String(nextId);
        },
      },
    );

  return {
    application,
    repository,
  };
}

describe(
  "PropertyHVACApplication",
  () => {
    it(
      "normalizes and saves a system",
      async () => {
        const {
          application,
        } = createApplication();

        const system =
          await application.saveSystem(
            {
              propertyId:
                "1214-wagner",
              name:
                "  Main HVAC  ",
              systemType:
                "split_system",
              energySource:
                "electric",
              refrigerantType:
                "  R-22  ",
              tonnage: "3.5",
              estimatedAgeYears:
                "18",
              condition:
                "marginal",
            },
            " owner_1 ",
          );

        expect(system).toMatchObject({
          id:
            "property_hvac_system_1",
          name: "Main HVAC",
          refrigerantType:
            "R-22",
          tonnage: 3.5,
          estimatedAgeYears:
            18,
          createdAt:
            "2026-08-08T12:00:00.000Z",
        });
      },
    );

    it(
      "keeps component age separate and normalizes replacement cost",
      async () => {
        const {
          application,
        } = createApplication();

        const system =
          await application.saveSystem(
            {
              propertyId:
                "1214-wagner",
            },
            "owner_1",
          );

        const component =
          await application.saveComponent(
            {
              systemId:
                system.id,
              componentType:
                "capacitor",
              name:
                "Run capacitor",
              estimatedAgeYears:
                "1",
              estimatedReplacementCost:
                "$350.00",
            },
            "owner_1",
          );

        expect(component).toMatchObject({
          estimatedAgeYears:
            1,
          estimatedReplacementCostCents:
            35000,
          status:
            "installed",
        });
      },
    );

    it(
      "records append-only service history",
      async () => {
        const {
          application,
        } = createApplication();

        const system =
          await application.saveSystem(
            {
              propertyId:
                "1214-wagner",
            },
            "owner_1",
          );

        const component =
          await application.saveComponent(
            {
              systemId:
                system.id,
              componentType:
                "capacitor",
              name:
                "Run capacitor",
            },
            "owner_1",
          );

        const event =
          await application
            .recordComponentEvent(
              {
                systemId:
                  system.id,
                componentId:
                  component.id,
                eventType:
                  "repaired",
                eventDate:
                  "2026-08-01",
                failureSymptoms:
                  "Would not start",
                workPerformed:
                  "Replaced capacitor",
                cost:
                  "350.00",
                photoReferences: [
                  "photo-1",
                ],
              },
              "owner_1",
            );

        expect(event).toMatchObject({
          eventType:
            "repaired",
          costCents:
            35000,
          occurredAt:
            "2026-08-01T00:00:00.000Z",
        });
      },
    );

    it(
      "returns complete owner-scoped system history",
      async () => {
        const {
          application,
        } = createApplication();

        const system =
          await application.saveSystem(
            {
              propertyId:
                "1214-wagner",
            },
            "owner_1",
          );

        await application.saveComponent(
          {
            systemId:
              system.id,
            componentType:
              "blower_motor",
            name:
              "Blower motor",
          },
          "owner_1",
        );

        await application.recordComponentEvent(
          {
            systemId:
              system.id,
            eventType:
              "inspected",
          },
          "owner_1",
        );

        const history =
          await application
            .getSystemHistory(
              system.id,
              "owner_1",
            );

        expect(
          history?.system,
        ).toEqual(system);

        expect(
          history?.components,
        ).toHaveLength(1);

        expect(
          history?.events,
        ).toHaveLength(1);

        expect(
          Object.isFrozen(history),
        ).toBe(true);

        expect(
          Object.isFrozen(
            history?.components,
          ),
        ).toBe(true);
      },
    );

    it(
      "does not expose another owner's systems",
      async () => {
        const {
          application,
        } = createApplication();

        const system =
          await application.saveSystem(
            {
              propertyId:
                "1214-wagner",
            },
            "owner_1",
          );

        await expect(
          application.getSystemHistory(
            system.id,
            "owner_2",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "requires authenticated owner scope",
      async () => {
        const {
          application,
        } = createApplication();

        await expect(
          application.saveSystem(
            {
              propertyId:
                "1214-wagner",
            },
            "",
          ),
        ).rejects.toThrow(
          "HVAC owner id is required.",
        );
      },
    );
  },
);
