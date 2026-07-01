import {
  createConnectionCollection,
  type ConnectionCollection,
  type ConnectionSummary,
} from "@/domains/connection";

function makeConnectionSummary(
  id: string,
  healthState: ConnectionSummary["health"]["state"],
  updatedAt: string,
): ConnectionSummary {
  return {
    connection: {
      id,
      userId: "user-1",
      name: `Connection ${id}`,
      provider: "manual",
      type: "bank",
      status: "connected",
      credentialReferenceId: `credential-${id}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    statusDetails: {
      status: "connected",
      label: "Connected",
      severity: "healthy",
      description: "Connection is active.",
    },
    capabilities: {
      connectionId: id,
      capabilities: [
        "import_transactions",
        "import_balances",
        "manual_sync",
      ],
      supportsAutomaticSync: false,
      supportsManualSync: true,
      supportsWebhooks: false,
      supportsRealtimeUpdates: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    institution: {
      id: `institution-${id}`,
      connectionId: id,
      name: `Institution ${id}`,
      type: "bank",
      provider: "manual",
      externalInstitutionId: `external-${id}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    health: {
      connectionId: id,
      state: healthState,
      severity: healthState === "healthy" ? "healthy" : "warning",
      label: healthState,
      allowsImport: healthState === "healthy" || healthState === "syncing",
      requiresUserAction: healthState === "needs_attention",
      issueCount: healthState === "critical" ? 1 : 0,
      warningCount: healthState === "needs_attention" ? 1 : 0,
      checkedAt: updatedAt,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

describe("ConnectionCollection", () => {
  it("summarizes multiple connection summaries", () => {
    const collection = createConnectionCollection([
      makeConnectionSummary("connection-1", "healthy", "2026-01-01T00:00:00.000Z"),
      makeConnectionSummary("connection-2", "syncing", "2026-01-02T00:00:00.000Z"),
      makeConnectionSummary("connection-3", "stale", "2026-01-03T00:00:00.000Z"),
      makeConnectionSummary("connection-4", "needs_attention", "2026-01-04T00:00:00.000Z"),
      makeConnectionSummary("connection-5", "critical", "2026-01-05T00:00:00.000Z"),
      makeConnectionSummary("connection-6", "not_ready", "2026-01-06T00:00:00.000Z"),
    ]);

    expect(collection.totalConnections).toBe(6);
    expect(collection.healthyConnections).toBe(1);
    expect(collection.syncingConnections).toBe(1);
    expect(collection.staleConnections).toBe(1);
    expect(collection.needsAttentionConnections).toBe(1);
    expect(collection.criticalConnections).toBe(1);
    expect(collection.notReadyConnections).toBe(1);
    expect(collection.lastUpdatedAt).toBe("2026-01-06T00:00:00.000Z");
  });

  it("handles an empty collection", () => {
    const collection = createConnectionCollection([]);

    expect(collection).toEqual<ConnectionCollection>({
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
  });

  it("copies the connection summaries array", () => {
    const summaries = [
      makeConnectionSummary("connection-1", "healthy", "2026-01-01T00:00:00.000Z"),
    ];

    const collection = createConnectionCollection(summaries);

    summaries.push(
      makeConnectionSummary("connection-2", "syncing", "2026-01-02T00:00:00.000Z"),
    );

    expect(collection.connections).toHaveLength(1);
    expect(collection.totalConnections).toBe(1);
  });
});
