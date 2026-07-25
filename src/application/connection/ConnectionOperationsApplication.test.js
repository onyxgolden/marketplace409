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

function createApplication(
  dashboard,
  {
    connectionReviewExecutionCoordinator =
      {
        executeReview:
          vi.fn(),
      },
    connectionImportExecutionCoordinator =
      {
        executeImport:
          vi.fn(),
      },
    connectionRepairExecutionCoordinator =
      {
        executeRepair:
          vi.fn(),
      },
    connectionExecutionIntelligenceBuilder =
      null,
    connectionExecutionHistoryRecorder =
      null,
    connectionExecutionHistoryQueryService =
      null,
    connectionExecutionHistoryIntelligenceBuilder =
      null,
  } = {},
) {
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
        connectionReviewExecutionCoordinator,
        connectionImportExecutionCoordinator,
        connectionRepairExecutionCoordinator,
        connectionExecutionIntelligenceBuilder,
        connectionExecutionHistoryRecorder,
        connectionExecutionHistoryQueryService,
        connectionExecutionHistoryIntelligenceBuilder,
      }),
    connectionReadModelApplication,
    connectionReviewExecutionCoordinator,
    connectionImportExecutionCoordinator,
    connectionRepairExecutionCoordinator,
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

        expect(result).toMatchObject({
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
      "builds a prioritized deterministic operations workflow",
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

        expect(result.workflow).toEqual({
          queue: [
            {
              id:
                "repair-connection:critical-connection",
              type: "repair-connection",
              priority: "critical",
              priorityRank: 0,
              connectionId:
                "critical-connection",
              stage: "attention",
              readiness: "ready",
              message:
                "Repair this connection before attempting another import.",
            },
            {
              id:
                "review-connection:stale-connection",
              type: "review-connection",
              priority: "medium",
              priorityRank: 2,
              connectionId:
                "stale-connection",
              stage: "review",
              readiness: "ready",
              message:
                "Review this connection because it is not currently ready for import.",
            },
            {
              id:
                "import-transactions:healthy-connection",
              type: "import-transactions",
              priority: "normal",
              priorityRank: 3,
              connectionId:
                "healthy-connection",
              stage: "import",
              readiness: "ready",
              message:
                "This connection is ready to import financial data.",
            },
          ],
          stages: [
            {
              id: "setup",
              label: "Setup",
              status: "empty",
              operationCount: 0,
            },
            {
              id: "attention",
              label: "Attention",
              status: "ready",
              operationCount: 1,
            },
            {
              id: "review",
              label: "Review",
              status: "ready",
              operationCount: 1,
            },
            {
              id: "import",
              label: "Import",
              status: "ready",
              operationCount: 1,
            },
          ],
          cards: [
            {
              id:
                "repair-connection:critical-connection",
              title: "Repair connection",
              detail:
                "Repair this connection before attempting another import.",
              action: "repair-connection",
              priority: "critical",
              stage: "attention",
              connectionId:
                "critical-connection",
              readiness: "ready",
            },
            {
              id:
                "review-connection:stale-connection",
              title: "Review connection",
              detail:
                "Review this connection because it is not currently ready for import.",
              action: "review-connection",
              priority: "medium",
              stage: "review",
              connectionId:
                "stale-connection",
              readiness: "ready",
            },
            {
              id:
                "import-transactions:healthy-connection",
              title: "Import transactions",
              detail:
                "This connection is ready to import financial data.",
              action: "import-transactions",
              priority: "normal",
              stage: "import",
              connectionId:
                "healthy-connection",
              readiness: "ready",
            },
          ],
          executionReadiness: {
            status: "ready",
            totalOperations: 3,
            readyOperations: 3,
            blockedOperations: 0,
            nextOperationId:
              "repair-connection:critical-connection",
          },
          metadata: {
            generatedAt:
              "2026-07-24T01:00:00.000Z",
            readOnly: true,
            deterministic: true,
            highestPriority: "critical",
          },
        });

        expect(
          Object.isFrozen(result.workflow),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.workflow.queue,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.workflow.cards,
          ),
        ).toBe(true);
      },
    );

    it(
      "executes connection reviews through the canonical coordinator",
      async () => {
        const dashboard = createDashboard();

        const reviewResult =
          Object.freeze({
            type:
              "connection-review-execution",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            provider: "plaid",
            status: "connected",
            severity: "healthy",
            allowsImport: true,
            requiresUserAction: false,
            recommendedOperation:
              "import-transactions",
          });

        const connectionReviewExecutionCoordinator =
          {
            executeReview:
              vi.fn().mockResolvedValue(
                reviewResult,
              ),
          };

        const {
          application,
        } = createApplication(
          dashboard,
          {
            connectionReviewExecutionCoordinator,
          },
        );

        const result =
          await application.executeOperation({
            operation:
              "review-connection",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            options: {
              source: "workflow-card",
            },
          });

        expect(result).toBe(reviewResult);

        expect(
          connectionReviewExecutionCoordinator
            .executeReview,
        ).toHaveBeenCalledOnce();

        expect(
          connectionReviewExecutionCoordinator
            .executeReview,
        ).toHaveBeenCalledWith({
          connectionId:
            "connection-1",
          ownerId: "owner-1",
        });
      },
    );

    it(
      "executes connection repairs through the canonical coordinator",
      async () => {
        const dashboard = createDashboard();

        const repairResult =
          Object.freeze({
            type:
              "connection-repair-execution",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            provider: "plaid",
            previousStatus:
              "needs_attention",
            status: "connected",
            credentialValid: true,
            synchronized: true,
            repaired: true,
            allowsImport: true,
            requiresUserAction: false,
            recommendedOperation:
              "import-transactions",
            occurredAt:
              "2026-07-24T01:00:00.000Z",
          });

        const connectionRepairExecutionCoordinator =
          {
            executeRepair:
              vi.fn().mockResolvedValue(
                repairResult,
              ),
          };

        const {
          application,
        } = createApplication(
          dashboard,
          {
            connectionRepairExecutionCoordinator,
          },
        );

        const result =
          await application.executeOperation({
            operation:
              "repair-connection",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            options: {
              source: "workflow-card",
            },
          });

        expect(result).toBe(repairResult);

        expect(
          connectionRepairExecutionCoordinator
            .executeRepair,
        ).toHaveBeenCalledOnce();

        expect(
          connectionRepairExecutionCoordinator
            .executeRepair,
        ).toHaveBeenCalledWith({
          connectionId:
            "connection-1",
          ownerId: "owner-1",
        });
      },
    );

    it(
      "executes transaction imports through the canonical coordinator",
      async () => {
        const dashboard = createDashboard();

        const importResult =
          Object.freeze({
            provider: "plaid",
            connectionId:
              "connection-1",
            success: true,
            financialAccountsImported: 2,
            accountBalancesImported: 2,
            transactionsImported: 10,
            failedRecordCount: 0,
            occurredAt:
              "2026-07-24T01:00:00.000Z",
          });

        const connectionImportExecutionCoordinator =
          {
            executeImport:
              vi.fn().mockResolvedValue(
                importResult,
              ),
          };

        const {
          application,
        } = createApplication(
          dashboard,
          {
            connectionImportExecutionCoordinator,
          },
        );

        const result =
          await application.executeOperation({
            operation:
              "import-transactions",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            options: {
              source: "workflow-card",
            },
          });

        expect(result).toBe(importResult);

        expect(
          connectionImportExecutionCoordinator
            .executeImport,
        ).toHaveBeenCalledOnce();

        expect(
          connectionImportExecutionCoordinator
            .executeImport,
        ).toHaveBeenCalledWith({
          connectionId:
            "connection-1",
          ownerId: "owner-1",
        });
      },
    );

    it(
      "rejects unsupported connection operations",
      async () => {
        const dashboard = createDashboard();

        const {
          application,
        } = createApplication(dashboard);

        await expect(
          application.executeOperation({
            operation:
              "delete-connection",
            connectionId:
              "connection-1",
          }),
        ).rejects.toThrow(
          "Unsupported connection operation: delete-connection",
        );
      },
    );

    it(
      "requires operation execution identifiers",
      async () => {
        const dashboard = createDashboard();

        const {
          application,
        } = createApplication(dashboard);

        await expect(
          application.executeOperation({
            connectionId:
              "connection-1",
          }),
        ).rejects.toThrow(
          "Connection operation is required.",
        );

        await expect(
          application.executeOperation({
            operation:
              "import-transactions",
          }),
        ).rejects.toThrow(
          "Connection id is required.",
        );
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
    it(
      "builds execution intelligence through the injected builder",
      () => {
        const builder =
          {
            build:
              vi.fn()
                .mockReturnValue({
                  status: "successful",
                }),
          };

        const {
          application,
        } = createApplication(
          createDashboard(),
          {
            connectionExecutionIntelligenceBuilder:
              builder,
          },
        );

        const executionResult = {
          success: true,
          connectionId:
            "connection-1",
        };

        const result =
          application.buildExecutionIntelligence(
            executionResult,
          );

        expect(
          builder.build,
        ).toHaveBeenCalledWith(
          executionResult,
        );

        expect(result)
          .toEqual({
            status: "successful",
          });
      },
    );

    it(
      "returns null when execution intelligence builder is unavailable",
      () => {
        const {
          application,
        } = createApplication(
          createDashboard(),
        );

        expect(
          application.buildExecutionIntelligence({
            success: true,
          }),
        ).toBeNull();
      },
    );

    it(
      "records execution history after importing transactions",
      async () => {
        const dashboard = createDashboard();

        const executionResult =
          Object.freeze({
            type:
              "connection-import-execution",
            status: "completed",
          });

        const connectionExecutionHistoryRecorder =
          {
            recordExecution:
              vi.fn()
                .mockResolvedValue(
                  undefined,
                ),
          };

        const connectionImportExecutionCoordinator =
          {
            executeImport:
              vi.fn()
                .mockResolvedValue(
                  executionResult,
                ),
          };

        const {
          application,
        } = createApplication(
          dashboard,
          {
            connectionImportExecutionCoordinator,
            connectionExecutionHistoryRecorder,
          },
        );

        const result =
          await application.executeOperation({
            operation:
              "import-transactions",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          });

        expect(result).toBe(
          executionResult,
        );

        expect(
          connectionExecutionHistoryRecorder
            .recordExecution,
        ).toHaveBeenCalledOnce();

        expect(
          connectionExecutionHistoryRecorder
            .recordExecution,
        ).toHaveBeenCalledWith({
          operation:
            "import-transactions",
          ownerId: "owner-1",
          executionResult,
        });
      },
    );


  },
);


describe(
  "execution history intelligence",
  () => {
    it(
      "requires historical intelligence dependencies",
      async () => {
        const {
          application,
        } = createApplication(
          createDashboard(),
        );

        await expect(
          application.getExecutionHistoryIntelligence({
            ownerId: "owner-1",
            connectionId: "connection-1",
          }),
        ).rejects.toThrow(
          "Connection execution history intelligence is not configured.",
        );
      },
    );

    it(
      "builds historical execution intelligence",
      async () => {
        const history = [
          {
            id: "execution-1",
            status: "success",
          },
        ];

        const queryService = {
          findByConnectionId:
            vi.fn()
              .mockResolvedValue(history),
        };

        const builder = {
          build:
            vi.fn()
              .mockReturnValue(
                Object.freeze({
                  totalExecutions: 1,
                }),
              ),
        };

        const {
          application,
        } = createApplication(
          createDashboard(),
          {
            connectionExecutionHistoryQueryService:
              queryService,
            connectionExecutionHistoryIntelligenceBuilder:
              builder,
          },
        );

        const result =
          await application
            .getExecutionHistoryIntelligence({
              ownerId: "owner-1",
              connectionId: "connection-1",
            });

        expect(
          queryService.findByConnectionId,
        ).toHaveBeenCalledWith(
          "owner-1",
          "connection-1",
        );

        expect(
          builder.build,
        ).toHaveBeenCalledWith(
          history,
        );

        expect(result)
          .toEqual({
            totalExecutions: 1,
          });
      },
    );
  },
);
