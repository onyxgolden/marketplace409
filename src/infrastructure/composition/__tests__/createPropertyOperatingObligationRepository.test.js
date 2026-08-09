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
  createLazyPropertyOperatingObligationRepository,
  createPropertyOperatingObligationRepository,
} from "../createPropertyOperatingObligationRepository.js";

import {
  InMemoryPropertyOperatingObligationRepository,
} from "../../../domains/property-operating-obligation/in-memory-property-operating-obligation.repository";

import {
  SupabasePropertyOperatingObligationRepository,
} from "../../../domains/property-operating-obligation/SupabasePropertyOperatingObligationRepository.js";

describe(
  "createPropertyOperatingObligationRepository",
  () => {
    const originalStorage =
      process.env
        .PROPERTY_OPERATING_OBLIGATION_REPOSITORY;

    afterEach(() => {
      if (
        originalStorage === undefined
      ) {
        delete process.env
          .PROPERTY_OPERATING_OBLIGATION_REPOSITORY;
      } else {
        process.env
          .PROPERTY_OPERATING_OBLIGATION_REPOSITORY =
            originalStorage;
      }
    });

    it(
      "creates the in-memory repository by default",
      async () => {
        delete process.env
          .PROPERTY_OPERATING_OBLIGATION_REPOSITORY;

        const repository =
          await createPropertyOperatingObligationRepository();

        expect(
          repository,
        ).toBeInstanceOf(
          InMemoryPropertyOperatingObligationRepository,
        );
      },
    );

    it(
      "creates the Supabase repository when selected",
      async () => {
        const repository =
          await createPropertyOperatingObligationRepository({
            storage: "supabase",
            supabaseClient: {},
          });

        expect(
          repository,
        ).toBeInstanceOf(
          SupabasePropertyOperatingObligationRepository,
        );
      },
    );

    it(
      "honors configured storage",
      async () => {
        process.env
          .PROPERTY_OPERATING_OBLIGATION_REPOSITORY =
            "memory";

        const repository =
          await createPropertyOperatingObligationRepository();

        expect(
          repository,
        ).toBeInstanceOf(
          InMemoryPropertyOperatingObligationRepository,
        );
      },
    );

    it(
      "rejects unsupported storage selections",
      async () => {
        await expect(
          createPropertyOperatingObligationRepository({
            storage: "unsupported",
          }),
        ).rejects.toThrow(
          "Unsupported property operating obligation repository storage: unsupported",
        );
      },
    );

    it(
      "exposes an immutable lazy repository boundary",
      () => {
        const repository =
          createLazyPropertyOperatingObligationRepository();

        expect(
          typeof repository.save,
        ).toBe("function");
        expect(
          typeof repository.list,
        ).toBe("function");
        expect(
          typeof repository.findByProperty,
        ).toBe("function");
        expect(
          typeof repository.deleteById,
        ).toBe("function");
        expect(
          Object.isFrozen(repository),
        ).toBe(true);
      },
    );
  },
);
