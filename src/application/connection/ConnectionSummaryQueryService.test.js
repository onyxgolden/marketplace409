import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionSummaryQueryService,
} from "./ConnectionSummaryQueryService.js";

function createConnection(overrides = {}) {
  return Object.freeze({
    id: "connection-1",
    userId: "owner-1",
    name: "Primary Bank",
    type: "bank",
    status: "connected",
    provider: "plaid",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T01:00:00.000Z",
    ...overrides,
  });
}

function createInstitution(overrides = {}) {
  return Object.freeze({
    id: "institution-1",
    connectionId: "connection-1",
    name: "Primary Bank",
    type: "bank",
    provider: "plaid",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T01:00:00.000Z",
    ...overrides,
  });
}

function createProvider() {
  return Object.freeze({
    provider: "plaid",

    capabilities: vi.fn(() => ({
      connectionId: "plaid",
      capabilities: [
        "import_accounts",
        "import_transactions",
        "manual_sync",
      ],
      supportsAutomaticSync: true,
      supportsManualSync: true,
      supportsWebhooks: true,
      supportsRealtimeUpdates: false,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T01:00:00.000Z",
    })),

    reportHealth: vi.fn(async (connection) => ({
      connectionId: connection.id,
      state: "healthy",
      severity: "healthy",
      label: "Connection ready",
      allowsImport: true,
      requiresUserAction: false,
      issueCount: 0,
      warningCount: 0,
      checkedAt: "2026-07-23T02:00:00.000Z",
    })),
  });
}

function createDependencies(overrides = {}) {
  const provider = createProvider();

  return {
    provider,
    connectionQueryService: {
      findConnections: vi.fn().mockResolvedValue([
        createConnection(),
      ]),
    },
    institutionReferenceRepository: {
      getAll: vi.fn().mockResolvedValue([
        createInstitution(),
      ]),
    },
    providerRegistry: {
      providers: [provider],
      totalProviders: 1,
      providerNames: ["plaid"],
    },
    ...overrides,
  };
}

describe("ConnectionSummaryQueryService", () => {
  it("requires a connection query service", () => {
    expect(
      () =>
        new ConnectionSummaryQueryService(),
    ).toThrow(
      "ConnectionSummaryQueryService requires a connection query service.",
    );
  });

  it("requires an institution reference repository", () => {
    expect(
      () =>
        new ConnectionSummaryQueryService({
          connectionQueryService: {
            findConnections: vi.fn(),
          },
        }),
    ).toThrow(
      "ConnectionSummaryQueryService requires an institution reference repository.",
    );
  });

  it("requires a connection provider registry", () => {
    expect(
      () =>
        new ConnectionSummaryQueryService({
          connectionQueryService: {
            findConnections: vi.fn(),
          },
          institutionReferenceRepository: {
            getAll: vi.fn(),
          },
        }),
    ).toThrow(
      "ConnectionSummaryQueryService requires a connection provider registry.",
    );
  });

  it("builds an owner-scoped connection collection", async () => {
    const dependencies =
      createDependencies();

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    const result =
      await service.getConnectionCollection(
        "owner-1",
      );

    expect(
      dependencies.connectionQueryService
        .findConnections,
    ).toHaveBeenCalledWith("owner-1");

    expect(
      dependencies.institutionReferenceRepository
        .getAll,
    ).toHaveBeenCalledWith({
      ownerId: "owner-1",
    });

    expect(result.totalConnections).toBe(1);
    expect(result.healthyConnections).toBe(1);
    expect(result.lastUpdatedAt).toBe(
      "2026-07-23T01:00:00.000Z",
    );

    expect(result.connections[0]).toMatchObject({
      connection: {
        id: "connection-1",
      },
      statusDetails: {
        status: "connected",
        label: "Connected",
      },
      capabilities: {
        connectionId: "connection-1",
      },
      institution: {
        connectionId: "connection-1",
      },
      health: {
        connectionId: "connection-1",
        state: "healthy",
      },
    });

    expect(
      dependencies.provider.capabilities,
    ).toHaveBeenCalledTimes(1);

    expect(
      dependencies.provider.reportHealth,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "connection-1",
      }),
    );
  });

  it("normalizes provider capabilities to the connection id", async () => {
    const dependencies =
      createDependencies();

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    const result =
      await service.getConnectionCollection(
        "owner-1",
      );

    expect(
      result.connections[0].capabilities
        .connectionId,
    ).toBe("connection-1");
  });

  it("returns an empty immutable collection", async () => {
    const dependencies =
      createDependencies({
        connectionQueryService: {
          findConnections:
            vi.fn().mockResolvedValue([]),
        },
        institutionReferenceRepository: {
          getAll:
            vi.fn().mockResolvedValue([]),
        },
      });

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    const result =
      await service.getConnectionCollection(
        "owner-1",
      );

    expect(result).toEqual({
      connections: [],
      totalConnections: 0,
      healthyConnections: 0,
      syncingConnections: 0,
      staleConnections: 0,
      needsAttentionConnections: 0,
      criticalConnections: 0,
      notReadyConnections: 0,
      lastUpdatedAt: null,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(
      Object.isFrozen(result.connections),
    ).toBe(true);
  });

  it("rejects an unregistered connection provider", async () => {
    const dependencies =
      createDependencies({
        providerRegistry: {
          providers: [],
          totalProviders: 0,
          providerNames: [],
        },
      });

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    await expect(
      service.getConnectionCollection(
        "owner-1",
      ),
    ).rejects.toThrow(
      "Connection provider is not registered: plaid",
    );
  });

  it("rejects a connection without an institution reference", async () => {
    const dependencies =
      createDependencies({
        institutionReferenceRepository: {
          getAll:
            vi.fn().mockResolvedValue([]),
        },
      });

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    await expect(
      service.getConnectionCollection(
        "owner-1",
      ),
    ).rejects.toThrow(
      "Institution reference is required for connection: connection-1",
    );
  });

  it("freezes the service instance", () => {
    const dependencies =
      createDependencies();

    const service =
      new ConnectionSummaryQueryService(
        dependencies,
      );

    expect(Object.isFrozen(service)).toBe(true);
  });
});
