export class ConnectionOperationsApplication {
  constructor({
    connectionReadModelApplication,
  }) {
    if (!connectionReadModelApplication) {
      throw new Error(
        "ConnectionOperationsApplication requires a connection read model application.",
      );
    }

    this.connectionReadModelApplication =
      connectionReadModelApplication;
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

    return Object.freeze({
      type: "connection-operations",
      status: "ready",
      dashboard,
      summary,
      health,
      recommendations,
      intelligence,
    });
  }
}

Object.freeze(ConnectionOperationsApplication);
