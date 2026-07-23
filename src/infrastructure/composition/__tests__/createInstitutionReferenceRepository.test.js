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
  InstitutionReferenceRepositoryStorage,
  createInstitutionReferenceRepository,
  createLazyInstitutionReferenceRepository,
} from "../createInstitutionReferenceRepository.js";

import {
  InMemoryInstitutionReferenceRepository,
} from "../../../domains/connection/in-memory-institution-reference.repository";

import {
  SupabaseInstitutionReferenceRepository,
} from "../../../domains/connection/SupabaseInstitutionReferenceRepository.js";

describe("createInstitutionReferenceRepository", () => {
  const originalStorage =
    process.env.INSTITUTION_REFERENCE_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.INSTITUTION_REFERENCE_REPOSITORY;
    } else {
      process.env.INSTITUTION_REFERENCE_REPOSITORY =
        originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.INSTITUTION_REFERENCE_REPOSITORY;

    const repository =
      await createInstitutionReferenceRepository();

    expect(repository).toBeInstanceOf(
      InMemoryInstitutionReferenceRepository,
    );
  });

  it("creates an in-memory repository when selected", async () => {
    const repository =
      await createInstitutionReferenceRepository({
        storage:
          InstitutionReferenceRepositoryStorage.MEMORY,
      });

    expect(repository).toBeInstanceOf(
      InMemoryInstitutionReferenceRepository,
    );
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.INSTITUTION_REFERENCE_REPOSITORY =
      InstitutionReferenceRepositoryStorage.MEMORY;

    const repository =
      await createInstitutionReferenceRepository();

    expect(repository).toBeInstanceOf(
      InMemoryInstitutionReferenceRepository,
    );
  });

  it("creates a Supabase repository when selected", async () => {
    const supabaseClient = {};

    const repository =
      await createInstitutionReferenceRepository({
        storage:
          InstitutionReferenceRepositoryStorage.SUPABASE,
        supabaseClient,
      });

    expect(repository).toBeInstanceOf(
      SupabaseInstitutionReferenceRepository,
    );
  });

  it("injects the supplied Supabase client", async () => {
    const supabaseClient = {};

    const repository =
      await createInstitutionReferenceRepository({
        storage:
          InstitutionReferenceRepositoryStorage.SUPABASE,
        supabaseClient,
      });

    expect(repository).toBeInstanceOf(
      SupabaseInstitutionReferenceRepository,
    );

    expect(repository.supabaseClient).toBe(
      supabaseClient,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createInstitutionReferenceRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported institution reference repository storage: unsupported",
    );
  });

  it("exposes a lazy synchronous repository boundary", () => {
    const repository =
      createLazyInstitutionReferenceRepository();

    expect(typeof repository.save).toBe("function");
    expect(typeof repository.getById).toBe("function");
    expect(typeof repository.getAll).toBe("function");
    expect(Object.isFrozen(repository)).toBe(true);
  });
});
