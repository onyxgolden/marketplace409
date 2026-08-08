import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryPropertyValuationRepository,
} from "@/domains/property-valuation/in-memory-property-valuation.repository";

import {
  PropertyValuationApplication,
} from "../PropertyValuationApplication";

function createApplication() {
  const repository =
    new InMemoryPropertyValuationRepository();

  const application =
    new PropertyValuationApplication(
      repository,
      {
        clock: () =>
          "2026-08-08T00:00:00.000Z",
        idFactory: () =>
          "deletion-test",
      },
    );

  return {
    application,
    repository,
  };
}

describe(
  "PropertyValuationApplication deletion",
  () => {
    it(
      "removes an owner-scoped valuation",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const valuation =
          await application.recordManual(
            {
              propertyId:
                "vincent",
              amount:
                75000,
            },
            "owner-1",
          );

        await expect(
          application.remove(
            valuation.id,
            "owner-1",
          ),
        ).resolves.toEqual(
          valuation,
        );

        await expect(
          repository.findById(
            valuation.id,
            "owner-1",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "does not remove another owner's valuation",
      async () => {
        const {
          application,
          repository,
        } = createApplication();

        const valuation =
          await application.recordManual(
            {
              propertyId:
                "vincent",
              amount:
                75000,
            },
            "owner-1",
          );

        await expect(
          application.remove(
            valuation.id,
            "owner-2",
          ),
        ).resolves.toBeNull();

        await expect(
          repository.findById(
            valuation.id,
            "owner-1",
          ),
        ).resolves.toEqual(
          valuation,
        );
      },
    );

    it(
      "requires valuation and owner identities",
      async () => {
        const {
          application,
        } = createApplication();

        await expect(
          application.remove(
            "",
            "owner-1",
          ),
        ).rejects.toThrow(
          "Property valuation ID is required.",
        );

        await expect(
          application.remove(
            "valuation-1",
            "",
          ),
        ).rejects.toThrow(
          "Property valuation owner ID is required.",
        );
      },
    );
  },
);
