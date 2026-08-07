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
  createLazyPropertyValuationRepository,
  createPropertyValuationRepository,
} from "../createPropertyValuationRepository.js";

import {
  InMemoryPropertyValuationRepository,
} from "../../../domains/property-valuation/in-memory-property-valuation.repository";

import {
  SupabasePropertyValuationRepository,
} from "../../../domains/property-valuation/SupabasePropertyValuationRepository.js";

describe("createPropertyValuationRepository", () => {
  const originalStorage =
    process.env.PROPERTY_VALUATION_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env
        .PROPERTY_VALUATION_REPOSITORY;
    } else {
      process.env.PROPERTY_VALUATION_REPOSITORY =
        originalStorage;
    }
  });

  it("creates the in-memory repository by default", async () => {
    delete process.env
      .PROPERTY_VALUATION_REPOSITORY;

    const repository =
      await createPropertyValuationRepository();

    expect(repository).toBeInstanceOf(
      InMemoryPropertyValuationRepository,
    );
  });

  it("creates the Supabase repository when selected", async () => {
    const repository =
      await createPropertyValuationRepository({
        storage: "supabase",
      });

    expect(repository).toBeInstanceOf(
      SupabasePropertyValuationRepository,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createPropertyValuationRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported property valuation repository storage: unsupported",
    );
  });

  it("exposes an immutable lazy repository boundary", () => {
    const repository =
      createLazyPropertyValuationRepository();

    expect(typeof repository.save).toBe(
      "function",
    );
    expect(
      typeof repository.findLatestByProperty,
    ).toBe("function");
    expect(
      typeof repository.findLatestByOwnerId,
    ).toBe("function");
    expect(Object.isFrozen(repository)).toBe(
      true,
    );
  });
});
