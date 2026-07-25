export class ConnectionOperationsApplication {
  constructor({
    connectionReadModelApplication,
    connectionReviewExecutionCoordinator = null,
    connectionRepairExecutionCoordinator = null,
    connectionImportExecutionCoordinator = null,
    connectionExecutionIntelligenceBuilder = null,
  }) {
    if (!connectionReadModelApplication) {
      throw new Error(
        "ConnectionOperationsApplication requires a connection read model application.",
      );
    }

    this.connectionReadModelApplication =
      connectionReadModelApplication;

    this.connectionReviewExecutionCoordinator =
      connectionReviewExecutionCoordinator;

    this.connectionRepairExecutionCoordinator =
      connectionRepairExecutionCoordinator;

    this.connectionImportExecutionCoordinator =
      connectionImportExecutionCoordinator;

    this.connectionExecutionIntelligenceBuilder =
      connectionExecutionIntelligenceBuilder;
  }

  getDashboardProjection(dashboard) {
    return dashboard?.dashboard || {};
  }

  buildOperationalSummary(dashboard) {
    const projection =
      this.getDashboardProjection(dashboard);

    const sourceSummary =
      projection.summary || {};

    const connections =
      projection.connections || [];

    const readyForImportConnections =
      connections.filter(
        (connectionSummary) =>
          connectionSummary.health
            ?.allowsImport === true,
      ).length;

    const requiringAttentionConnections =
      connections.filter(
        (connectionSummary) =>
          connectionSummary.health
            ?.requiresUserAction === true,
      ).length;

    const degradedConnections =
      (sourceSummary.staleConnections || 0) +
      (sourceSummary.needsAttentionConnections || 0) +
      (sourceSummary.criticalConnections || 0) +
      (sourceSummary.notReadyConnections || 0);

    return Object.freeze({
      totalConnections:
        sourceSummary.totalConnections || 0,
      healthyConnections:
        sourceSummary.healthyConnections || 0,
      syncingConnections:
        sourceSummary.syncingConnections || 0,
      degradedConnections,
      readyForImportConnections,
      requiringAttentionConnections,
    });
  }

  buildHealthSummary(dashboard) {
    const projection =
      this.getDashboardProjection(dashboard);

    const sourceSummary =
      projection.summary || {};

    const totalConnections =
      sourceSummary.totalConnections || 0;

    const weightedHealth =
      ((sourceSummary.healthyConnections || 0) * 100) +
      ((sourceSummary.syncingConnections || 0) * 85) +
      ((sourceSummary.staleConnections || 0) * 60) +
      ((sourceSummary.needsAttentionConnections || 0) * 40) +
      ((sourceSummary.notReadyConnections || 0) * 25);

    const score =
      totalConnections === 0
        ? 0
        : Math.round(
            weightedHealth /
              totalConnections,
          );

    let overall = "healthy";

    if (totalConnections === 0) {
      overall = "not_ready";
    } else if (
      (sourceSummary.criticalConnections || 0) > 0
    ) {
      overall = "critical";
    } else if (
      (
        sourceSummary
          .needsAttentionConnections || 0
      ) > 0
    ) {
      overall = "needs_attention";
    } else if (
      (sourceSummary.staleConnections || 0) > 0
    ) {
      overall = "stale";
    } else if (
      (sourceSummary.notReadyConnections || 0) > 0
    ) {
      overall = "not_ready";
    } else if (
      (sourceSummary.syncingConnections || 0) > 0
    ) {
      overall = "syncing";
    }

    return Object.freeze({
      overall,
      score,
      issueCount:
        (sourceSummary.criticalConnections || 0) +
        (
          sourceSummary
            .needsAttentionConnections || 0
        ),
      warningCount:
        (sourceSummary.staleConnections || 0) +
        (sourceSummary.notReadyConnections || 0),
    });
  }

  buildRecommendations(dashboard) {
    const projection =
      this.getDashboardProjection(dashboard);

    const connections =
      projection.connections || [];

    if (connections.length === 0) {
      return Object.freeze([
        Object.freeze({
          type: "connect-institution",
          priority: "high",
          connectionId: null,
          message:
            "Connect a financial institution to begin importing financial data.",
        }),
      ]);
    }

    const recommendations =
      connections.flatMap(
        (connectionSummary) => {
          const connectionId =
            connectionSummary.connection?.id ||
            null;

          const health =
            connectionSummary.health || {};

          if (
            health.requiresUserAction === true
          ) {
            return [
              Object.freeze({
                type: "repair-connection",
                priority:
                  health.severity === "critical"
                    ? "critical"
                    : "high",
                connectionId,
                message:
                  "Repair this connection before attempting another import.",
              }),
            ];
          }

          if (health.allowsImport === true) {
            return [
              Object.freeze({
                type: "import-transactions",
                priority: "normal",
                connectionId,
                message:
                  "This connection is ready to import financial data.",
              }),
            ];
          }

          return [
            Object.freeze({
              type: "review-connection",
              priority: "medium",
              connectionId,
              message:
                "Review this connection because it is not currently ready for import.",
            }),
          ];
        },
      );

    return Object.freeze(recommendations);
  }

  buildStatusIntelligence(dashboard) {
    const projection =
      this.getDashboardProjection(dashboard);

    const connections =
      projection.connections || [];

    const connectionIdsFor =
      (predicate) =>
        Object.freeze(
          connections
            .filter(predicate)
            .map(
              (connectionSummary) =>
                connectionSummary.connection
                  ?.id,
            )
            .filter(Boolean),
        );

    return Object.freeze({
      readyConnectionIds:
        connectionIdsFor(
          (connectionSummary) =>
            connectionSummary.health
              ?.allowsImport === true,
        ),
      attentionConnectionIds:
        connectionIdsFor(
          (connectionSummary) =>
            connectionSummary.health
              ?.requiresUserAction === true,
        ),
      degradedConnectionIds:
        connectionIdsFor(
          (connectionSummary) =>
            connectionSummary.health
              ?.severity !== "healthy",
        ),
      lastUpdatedAt:
        projection.metadata?.lastUpdatedAt ||
        null,
    });
  }

  buildOperationQueue(recommendations) {
    const priorityRanks = Object.freeze({
      critical: 0,
      high: 1,
      medium: 2,
      normal: 3,
    });

    const stages = Object.freeze({
      "connect-institution": "setup",
      "repair-connection": "attention",
      "review-connection": "review",
      "import-transactions": "import",
    });

    const queue = recommendations
      .map((recommendation) => {
        const connectionKey =
          recommendation.connectionId ||
          "platform";

        return Object.freeze({
          id:
            `${recommendation.type}:${connectionKey}`,
          type: recommendation.type,
          priority: recommendation.priority,
          priorityRank:
            priorityRanks[
              recommendation.priority
            ] ?? 4,
          connectionId:
            recommendation.connectionId,
          stage:
            stages[recommendation.type] ||
            "review",
          readiness: "ready",
          message: recommendation.message,
        });
      })
      .sort(
        (left, right) =>
          left.priorityRank -
            right.priorityRank ||
          left.id.localeCompare(right.id),
      );

    return Object.freeze(queue);
  }

  buildWorkflowStages(queue) {
    const stageDefinitions = [
      {
        id: "setup",
        label: "Setup",
      },
      {
        id: "attention",
        label: "Attention",
      },
      {
        id: "review",
        label: "Review",
      },
      {
        id: "import",
        label: "Import",
      },
    ];

    return Object.freeze(
      stageDefinitions.map(
        (stageDefinition) => {
          const operationCount =
            queue.filter(
              (operation) =>
                operation.stage ===
                stageDefinition.id,
            ).length;

          return Object.freeze({
            ...stageDefinition,
            status:
              operationCount > 0
                ? "ready"
                : "empty",
            operationCount,
          });
        },
      ),
    );
  }

  buildOperationCards(queue) {
    const titles = Object.freeze({
      "connect-institution":
        "Connect institution",
      "repair-connection":
        "Repair connection",
      "review-connection":
        "Review connection",
      "import-transactions":
        "Import transactions",
    });

    return Object.freeze(
      queue.map((operation) =>
        Object.freeze({
          id: operation.id,
          title:
            titles[operation.type] ||
            "Review operation",
          detail: operation.message,
          action: operation.type,
          priority: operation.priority,
          stage: operation.stage,
          connectionId:
            operation.connectionId,
          readiness: operation.readiness,
        }),
      ),
    );
  }

  buildExecutionReadiness(queue) {
    const readyOperations =
      queue.filter(
        (operation) =>
          operation.readiness === "ready",
      ).length;

    const blockedOperations =
      queue.length - readyOperations;

    return Object.freeze({
      status:
        readyOperations > 0
          ? "ready"
          : blockedOperations > 0
            ? "blocked"
            : "empty",
      totalOperations: queue.length,
      readyOperations,
      blockedOperations,
      nextOperationId:
        queue.find(
          (operation) =>
            operation.readiness === "ready",
        )?.id || null,
    });
  }

  buildWorkflowMetadata({
    dashboard,
    queue,
  }) {
    const projection =
      this.getDashboardProjection(dashboard);

    return Object.freeze({
      generatedAt:
        projection.metadata?.lastUpdatedAt ||
        null,
      readOnly: true,
      deterministic: true,
      highestPriority:
        queue[0]?.priority || null,
    });
  }

  buildWorkflow({
    dashboard,
    recommendations,
  }) {
    const queue =
      this.buildOperationQueue(
        recommendations,
      );

    const stages =
      this.buildWorkflowStages(queue);

    const cards =
      this.buildOperationCards(queue);

    const executionReadiness =
      this.buildExecutionReadiness(queue);

    const metadata =
      this.buildWorkflowMetadata({
        dashboard,
        queue,
      });

    return Object.freeze({
      queue,
      stages,
      cards,
      executionReadiness,
      metadata,
    });
  }

  buildExecutionIntelligence(executionResult) {
    if (
      !this.connectionExecutionIntelligenceBuilder
    ) {
      return null;
    }

    return this.connectionExecutionIntelligenceBuilder
      .build(executionResult);
  }

  withExecutionIntelligence(executionResult) {
    if (
      !this.connectionExecutionIntelligenceBuilder
    ) {
      return executionResult;
    }

    return Object.freeze({
      ...executionResult,
      intelligence:
        this.buildExecutionIntelligence(
          executionResult,
        ),
    });
  }

  async executeOperation({
    operation,
    connectionId,
    ownerId = null,
    options = {},
  } = {}) {
    if (
      typeof operation !== "string" ||
      operation.length === 0
    ) {
      throw new Error(
        "Connection operation is required.",
      );
    }

    if (
      typeof connectionId !== "string" ||
      connectionId.length === 0
    ) {
      throw new Error(
        "Connection id is required.",
      );
    }

    switch (operation) {
      case "repair-connection":
        if (
          !this.connectionRepairExecutionCoordinator
        ) {
          throw new Error(
            "Connection repair execution coordinator is required.",
          );
        }

        return this.withExecutionIntelligence(
          await this
            .connectionRepairExecutionCoordinator
            .executeRepair({
              connectionId,
              ownerId,
            }),
        );

      case "review-connection":
        if (
          !this.connectionReviewExecutionCoordinator
        ) {
          throw new Error(
            "Connection review execution coordinator is required.",
          );
        }

        return this.withExecutionIntelligence(
          await this
            .connectionReviewExecutionCoordinator
            .executeReview({
              connectionId,
              ownerId,
            }),
        );

      case "import-transactions":
        if (
          !this.connectionImportExecutionCoordinator
        ) {
          throw new Error(
            "Connection import execution coordinator is required.",
          );
        }

        return this.withExecutionIntelligence(
          await this
            .connectionImportExecutionCoordinator
            .executeImport({
              connectionId,
              ownerId,
            }),
        );

      default:
        throw new Error(
          `Unsupported connection operation: ${operation}`,
        );
    }
  }

  async buildConnectionOperations() {
    const dashboard =
      await this.connectionReadModelApplication
        .buildConnectionDashboard();

    const summary =
      this.buildOperationalSummary(dashboard);

    const health =
      this.buildHealthSummary(dashboard);

    const recommendations =
      this.buildRecommendations(dashboard);

    const intelligence =
      this.buildStatusIntelligence(dashboard);

    const workflow =
      this.buildWorkflow({
        dashboard,
        recommendations,
      });

    return Object.freeze({
      type: "connection-operations",
      status: "ready",
      dashboard,
      summary,
      health,
      recommendations,
      intelligence,
      workflow,
    });
  }
}

Object.freeze(ConnectionOperationsApplication);
