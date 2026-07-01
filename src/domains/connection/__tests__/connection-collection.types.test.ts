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
      ownerId: "owner-1",
      provider: "manual",
      type: "bank",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    statusDetails: {
      status: "active",
      label: "Active",
      severity: "healthy",
      description: "Connection is active.",
    },
    capabilities: {
      canSyncBalances: true,
      canSyncTransactions: true,
      canSyncIdentity: false,
      canSyncDocuments: false,
    },
    institution: {
      id: `institution-${id}`,
      name: `Institution ${id}`,
      type: "bank",
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
      makeConnectionSummary("connection-3", "needs_attention", "2026-01-03T00:00:00.000Z"),
      makeConnectionSummary("connection-4", "critical", "2026-01-04T00:00:00.000Z"),
      makeConnectionSummary("connection-5", "not_ready", "2026-01-05T00:00:00.000Z"),
    ]);

    expect(collection.totalConnections).toBe(5);
    expect(collection.healthyConnections).toBe(1);
    expect(collection.syncingConnections).toBe(1);
    expect(collection.needsAttentionConnections).toBe(1);
    expect(collection.criticalConnections).toBe(1);
    expect(collection.notReadyConnections).toBe(1);
    expect(collection.lastUpdatedAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("handles an empty collection", () => {
    const collection = createConnectionCollection([]);

    expect(collection).toEqual<ConnectionCollection>({
      connections: [],
      totalConnections: 0,
      healthyConnections: 0,
      syncingConnections: 0,
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
