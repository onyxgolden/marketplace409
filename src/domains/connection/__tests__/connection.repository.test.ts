import { describe, expect, it } from "vitest";
import { InMemoryConnectionRepository } from "../in-memory-connection.repository";
import type { Connection } from "../connection.types";

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "connection_1",
  userId: "user_1",
  name: "Sandbox Bank",
  type: "bank",
  status: "connected",
  provider: "test_provider",
  credentialReferenceId: "credential_1",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("InMemoryConnectionRepository", () => {
  it("saves and retrieves a connection by id", () => {
    const repository = new InMemoryConnectionRepository();
    const savedConnection = connection();

    repository.save(savedConnection);

    expect(repository.getById(savedConnection.id)).toEqual(savedConnection);
  });

  it("returns null when a connection does not exist", () => {
    const repository = new InMemoryConnectionRepository();

    expect(repository.getById("missing")).toBeNull();
  });

  it("returns all connections in insertion order", () => {
    const repository = new InMemoryConnectionRepository();
    const first = connection({ id: "connection_1", name: "First Bank" });
    const second = connection({ id: "connection_2", name: "Second Bank" });

    repository.save(first);
    repository.save(second);

    expect(repository.getAll()).toEqual([first, second]);
  });

  it("returns a copy of all connections", () => {
    const repository = new InMemoryConnectionRepository();
    const savedConnection = connection();

    repository.save(savedConnection);

    const allConnections = repository.getAll();
    allConnections.push(
      connection({
        id: "connection_2",
        name: "Injected Bank",
      }),
    );

    expect(repository.getAll()).toEqual([savedConnection]);
  });

  it("replaces a connection with the same id", () => {
    const repository = new InMemoryConnectionRepository();
    const original = connection({ name: "Original Bank" });
    const replacement = connection({ name: "Replacement Bank" });

    repository.save(original);
    repository.save(replacement);

    expect(repository.getById(original.id)).toEqual(replacement);
    expect(repository.getAll()).toEqual([replacement]);
  });
});
