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
  CredentialReferenceRepositoryStorage,
  createCredentialReferenceRepository,
  createLazyCredentialReferenceRepository,
} from "../createCredentialReferenceRepository.js";

import {
  InMemoryCredentialReferenceRepository,
} from "../../../domains/connection/in-memory-credential-reference.repository";

import {
  SupabaseCredentialReferenceRepository,
} from "../../../domains/connection/SupabaseCredentialReferenceRepository.js";

describe("createCredentialReferenceRepository", () => {
  const originalStorage =
    process.env.CREDENTIAL_REFERENCE_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.CREDENTIAL_REFERENCE_REPOSITORY;
    } else {
      process.env.CREDENTIAL_REFERENCE_REPOSITORY =
        originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.CREDENTIAL_REFERENCE_REPOSITORY;

    const repository =
      await createCredentialReferenceRepository();

    expect(repository).toBeInstanceOf(
      InMemoryCredentialReferenceRepository,
    );
  });

  it("creates an in-memory repository when selected", async () => {
    const repository =
      await createCredentialReferenceRepository({
        storage:
          CredentialReferenceRepositoryStorage.MEMORY,
      });

    expect(repository).toBeInstanceOf(
      InMemoryCredentialReferenceRepository,
    );
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.CREDENTIAL_REFERENCE_REPOSITORY =
      CredentialReferenceRepositoryStorage.MEMORY;

    const repository =
      await createCredentialReferenceRepository();

    expect(repository).toBeInstanceOf(
      InMemoryCredentialReferenceRepository,
    );
  });

  it("creates a Supabase repository when selected", async () => {
    const repository =
      await createCredentialReferenceRepository({
        storage:
          CredentialReferenceRepositoryStorage.SUPABASE,
      });

    expect(repository).toBeInstanceOf(
      SupabaseCredentialReferenceRepository,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createCredentialReferenceRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported credential reference repository storage: unsupported",
    );
  });

  it("exposes a lazy synchronous repository boundary", () => {
    const repository =
      createLazyCredentialReferenceRepository();

    expect(typeof repository.save).toBe("function");
    expect(typeof repository.getById).toBe("function");
    expect(typeof repository.getAll).toBe("function");
    expect(Object.isFrozen(repository)).toBe(true);
  });
});
