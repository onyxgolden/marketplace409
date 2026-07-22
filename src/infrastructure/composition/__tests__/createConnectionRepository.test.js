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
  ConnectionRepositoryStorage,
  createConnectionRepository,
  createLazyConnectionRepository,
} from "../createConnectionRepository.js";

import {
  InMemoryConnectionRepository,
} from "../../../domains/connection/in-memory-connection.repository";

import {
  SupabaseConnectionRepository,
} from "../../../domains/connection/SupabaseConnectionRepository.js";

describe("createConnectionRepository", () => {
  const originalStorage =
    process.env.CONNECTION_REPOSITORY;

  afterEach(() => {
    if (originalStorage === undefined) {
      delete process.env.CONNECTION_REPOSITORY;
    } else {
      process.env.CONNECTION_REPOSITORY =
        originalStorage;
    }
  });

  it("creates an in-memory repository by default", async () => {
    delete process.env.CONNECTION_REPOSITORY;

    const repository =
      await createConnectionRepository();

    expect(repository).toBeInstanceOf(
      InMemoryConnectionRepository,
    );
  });

  it("creates an in-memory repository when selected", async () => {
    const repository =
      await createConnectionRepository({
        storage:
          ConnectionRepositoryStorage.MEMORY,
      });

    expect(repository).toBeInstanceOf(
      InMemoryConnectionRepository,
    );
  });

  it("creates an in-memory repository from environment selection", async () => {
    process.env.CONNECTION_REPOSITORY =
      ConnectionRepositoryStorage.MEMORY;

    const repository =
      await createConnectionRepository();

    expect(repository).toBeInstanceOf(
      InMemoryConnectionRepository,
    );
  });

  it("creates a Supabase repository when selected", async () => {
    const repository =
      await createConnectionRepository({
        storage:
          ConnectionRepositoryStorage.SUPABASE,
      });

    expect(repository).toBeInstanceOf(
      SupabaseConnectionRepository,
    );
  });

  it("rejects unsupported storage selections", async () => {
    await expect(
      createConnectionRepository({
        storage: "unsupported",
      }),
    ).rejects.toThrow(
      "Unsupported connection repository storage: unsupported",
    );
  });

  it("exposes a lazy synchronous repository boundary", () => {
    const repository =
      createLazyConnectionRepository();

    expect(typeof repository.save).toBe("function");
    expect(typeof repository.getById).toBe("function");
    expect(typeof repository.getAll).toBe("function");
    expect(Object.isFrozen(repository)).toBe(true);
  });
});
