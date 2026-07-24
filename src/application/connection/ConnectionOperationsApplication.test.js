import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionOperationsApplication,
} from "./ConnectionOperationsApplication.js";

function createDashboard({
  summary = {},
  connections = [],
  lastUpdatedAt =
    "2026-07-24T01:00:00.000Z",
} = {}) {
  return Object.freeze({
    type: "connection-dashboard",
    dashboard: Object.freeze({
      summary: Object.freeze({
        totalConnections: 0,
        healthyConnections: 0,
        syncingConnections: 0,
        staleConnections: 0,
        needsAttentionConnections: 0,
        criticalConnections: 0,
        notReadyConnections: 0,
        ...summary,
      }),
      connections: Object.freeze(
        connections,
      ),
      metadata: Object.freeze({
        provider: "connection-platform",
        snapshotStatus:
          "repository-backed",
        lastUpdatedAt,
      }),
    }),
  });
}

function createConnectionSummary({
  id,
  severity = "healthy",
  allowsImport = true,
  requiresUserAction = false,
  issueCount = 0,
  warningCount = 0,
}) {
  return Object.freeze({
    connection: Object.freeze({
      id,
    }),
    health: Object.freeze({
      severity,
      allowsImport,
      requiresUserAction,
      issueCount,
      warningCount,
    }),
  });
}

function createApplication(dashboard) {
  const connectionReadModelApplication = {
    buildConnectionDashboard:
      vi.fn().mockResolvedValue(
        dashboard,
      ),
  };

  return {
    application:
      new ConnectionOperationsApplication({
        connectionReadModelApplication,
      }),
    connectionReadModelApplication,
  };
}

describe(
  "ConnectionOperationsApplication",
  () => {
    it(
      "builds healthy connection operational intelligence",
      async () => {
        const dashboard = createDashboard({
          summary: {
            totalConnections: 2,
            healthyConnections: 2,
          },
          connections: [
            createConnectionSummary({
              id: "connection-1",
            }),
            createConnectionSummary({
              id: "connection-2",
            }),
          ],
        });

        const {
          application,
          connectionReadModelApplication,
        } = createApplication(dashboard);

        const result =
          await application
            .buildConnectionOperations();

        expect(result).toEqual({
          type: "connection-operations",
          status: "ready",
          dashboard,
          summary: {
            totalConnections: 2,
            healthyConnections: 2,
            syncingConnections: 0,
            degradedConnections: 0,
            readyForImportConnections: 2,
            requiringAttentionConnections: 0,
          },
          health: {
            overall: "healthy",
            score: 100,
            issueCount: 0,
            warningCount: 0,
          },
          recommendations: [
            {
              type:
                "import-transactions",
              priority: "normal",
              connectionId:
                "connection-1",
              message:
                "This connection is ready to import financial data.",
            },
            {
              type:
                "import-transactions",
              priority: "normal",
              connectionId:
                "connection-2",
              message:
                "This connection is ready to import financial data.",
            },
          ],
          intelligence: {
            readyConnectionIds: [
              "connection-1",
              "connection-2",
            ],
            attentionConnectionIds: [],
            degradedConnectionIds: [],
            lastUpdatedAt:
              "2026-07-24T01:00:00.000Z",
          },
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.recommendations,
          ),
        ).toBe(true);

        expect(
          connectionReadModelApplication
            .buildConnectionDashboard,
        ).toHaveBeenCalledOnce();
      },
    );

    it(
      "prioritizes critical and degraded connections",
      async () => {
        const dashboard = createDashboard({
          summary: {
            totalConnections: 3,
            healthyConnections: 1,
            staleConnections: 1,
            criticalConnections: 1,
          },
          connections: [
            createConnectionSummary({
              id: "healthy-connection",
            }),
            createConnectionSummary({
              id: "stale-connection",
              severity: "warning",
              allowsImport: false,
              warningCount: 1,
            }),
            createConnectionSummary({
              id: "critical-connection",
              severity: "critical",
              allowsImport: false,
              requiresUserAction: true,
              issueCount: 1,
            }),
          ],
        });

        const {
          application,
        } = createApplication(dashboard);

        const result =
          await application
            .buildConnectionOperations();

        expect(result.summary).toEqual({
          totalConnections: 3,
          healthyConnections: 1,
          syncingConnections: 0,
          degradedConnections: 2,
          readyForImportConnections: 1,
          requiringAttentionConnections: 1,
        });

        expect(result.health).toEqual({
          overall: "critical",
          score: 53,
          issueCount: 1,
          warningCount: 1,
        });

        expect(
          result.recommendations,
        ).toEqual([
          {
            type:
              "import-transactions",
            priority: "normal",
            connectionId:
              "healthy-connection",
            message:
              "This connection is ready to import financial data.",
          },
          {
            type:
              "review-connection",
            priority: "medium",
            connectionId:
              "stale-connection",
            message:
              "Review this connection because it is not currently ready for import.",
          },
          {
            type:
              "repair-connection",
            priority: "critical",
            connectionId:
              "critical-connection",
            message:
              "Repair this connection before attempting another import.",
          },
        ]);

        expect(
          result.intelligence,
        ).toEqual({
          readyConnectionIds: [
            "healthy-connection",
          ],
          attentionConnectionIds: [
            "critical-connection",
          ],
          degradedConnectionIds: [
            "stale-connection",
            "critical-connection",
          ],
          lastUpdatedAt:
            "2026-07-24T01:00:00.000Z",
        });
      },
    );

    it(
      "recommends connecting an institution when none exist",
      async () => {
        const dashboard =
          createDashboard();

        const {
          application,
        } = createApplication(dashboard);

        const result =
          await application
            .buildConnectionOperations();

        expect(result.summary).toEqual({
          totalConnections: 0,
          healthyConnections: 0,
          syncingConnections: 0,
          degradedConnections: 0,
          readyForImportConnections: 0,
          requiringAttentionConnections: 0,
        });

        expect(result.health).toEqual({
          overall: "not_ready",
          score: 0,
          issueCount: 0,
          warningCount: 0,
        });

        expect(
          result.recommendations,
        ).toEqual([
          {
            type:
              "connect-institution",
            priority: "high",
            connectionId: null,
            message:
              "Connect a financial institution to begin importing financial data.",
          },
        ]);
      },
    );

    it(
      "requires a connection read model application",
      () => {
        expect(
          () =>
            new ConnectionOperationsApplication(
              {},
            ),
        ).toThrow(
          "ConnectionOperationsApplication requires a connection read model application.",
        );
      },
    );
  },
);
