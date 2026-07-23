import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionQueryService,
} from "./ConnectionQueryService.js";

describe("ConnectionQueryService", () => {
  it("requires a connection repository", () => {
    expect(
      () => new ConnectionQueryService(),
    ).toThrow(
      "ConnectionQueryService requires a connection repository.",
    );
  });

  it("requires a repository with getAll", () => {
    expect(
      () =>
        new ConnectionQueryService({
          connectionRepository: {},
        }),
    ).toThrow(
      "ConnectionQueryService requires a connection repository.",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
    123,
    {},
  ])("requires a valid owner id: %p", async (ownerId) => {
    const connectionRepository = {
      getAll: vi.fn(),
    };

    const service = new ConnectionQueryService({
      connectionRepository,
    });

    await expect(
      service.findConnections(ownerId),
    ).rejects.toThrow("Owner id is required");

    expect(
      connectionRepository.getAll,
    ).not.toHaveBeenCalled();
  });

  it("retrieves connections using owner-scoped context", async () => {
    const connections = Object.freeze([
      Object.freeze({
        id: "connection-1",
        userId: "owner-1",
        name: "Primary Bank",
        type: "bank",
        status: "connected",
        provider: "plaid",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      }),
    ]);

    const connectionRepository = {
      getAll: vi.fn().mockResolvedValue(
        connections,
      ),
    };

    const service = new ConnectionQueryService({
      connectionRepository,
    });

    const result = await service.findConnections(
      "owner-1",
    );

    expect(
      connectionRepository.getAll,
    ).toHaveBeenCalledTimes(1);

    expect(
      connectionRepository.getAll,
    ).toHaveBeenCalledWith({
      ownerId: "owner-1",
    });

    expect(result).toBe(connections);
  });

  it("freezes the service instance", () => {
    const service = new ConnectionQueryService({
      connectionRepository: {
        getAll: vi.fn(),
      },
    });

    expect(Object.isFrozen(service)).toBe(true);
  });
});
