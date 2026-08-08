import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import {
  createLazyPropertyHVACRepository,
  createPropertyHVACRepository,
  PropertyHVACRepositoryStorage,
} from "../createPropertyHVACRepository.js";

import {
  InMemoryPropertyHVACRepository,
} from "../../../domains/property-hvac/in-memory-property-hvac.repository";

import {
  SupabasePropertyHVACRepository,
} from "../../../domains/property-hvac/SupabasePropertyHVACRepository.js";

describe(
  "createPropertyHVACRepository",
  () => {
    const originalStorage =
      process.env
        .PROPERTY_HVAC_REPOSITORY;

    afterEach(() => {
      if (
        originalStorage ===
        undefined
      ) {
        delete process.env
          .PROPERTY_HVAC_REPOSITORY;
      } else {
        process.env
          .PROPERTY_HVAC_REPOSITORY =
          originalStorage;
      }
    });

    it(
      "creates the in-memory repository by default",
      async () => {
        delete process.env
          .PROPERTY_HVAC_REPOSITORY;

        const repository =
          await createPropertyHVACRepository();

        expect(repository).toBeInstanceOf(
          InMemoryPropertyHVACRepository,
        );
      },
    );

    it(
      "uses environment storage selection",
      async () => {
        process.env
          .PROPERTY_HVAC_REPOSITORY =
          PropertyHVACRepositoryStorage
            .MEMORY;

        const repository =
          await createPropertyHVACRepository();

        expect(repository).toBeInstanceOf(
          InMemoryPropertyHVACRepository,
        );
      },
    );

    it(
      "creates Supabase storage with the supplied client",
      async () => {
        const supabaseClient = {
          from:
            vi.fn(),
        };

        const repository =
          await createPropertyHVACRepository({
            storage:
              PropertyHVACRepositoryStorage
                .SUPABASE,
            supabaseClient,
          });

        expect(repository).toBeInstanceOf(
          SupabasePropertyHVACRepository,
        );

        expect(
          repository.supabase,
        ).toBe(
          supabaseClient,
        );
      },
    );

    it(
      "rejects unsupported storage",
      async () => {
        await expect(
          createPropertyHVACRepository({
            storage:
              "unsupported",
          }),
        ).rejects.toThrow(
          "Unsupported property HVAC repository storage: unsupported",
        );
      },
    );

    it(
      "exposes the complete immutable lazy boundary",
      () => {
        const repository =
          createLazyPropertyHVACRepository();

        for (
          const method of [
            "saveSystem",
            "findSystemById",
            "findSystemsByProperty",
            "saveComponent",
            "findComponentById",
            "findComponentsBySystem",
            "appendComponentEvent",
            "findEventsBySystem",
            "findEventsByComponent",
          ]
        ) {
          expect(
            typeof repository[method],
          ).toBe("function");
        }

        expect(
          Object.isFrozen(repository),
        ).toBe(true);
      },
    );
  },
);
