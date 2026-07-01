import type {
  ConnectionSummary,
} from "./connection-summary.types";

export type ConnectionCollection = Readonly<{
  connections: readonly ConnectionSummary[];
  totalConnections: number;
  healthyConnections: number;
  syncingConnections: number;
  staleConnections: number;
  needsAttentionConnections: number;
  criticalConnections: number;
  notReadyConnections: number;
  lastUpdatedAt: string | null;
}>;

export function createConnectionCollection(
  connections: readonly ConnectionSummary[],
): ConnectionCollection {
  const lastUpdatedAt = connections.reduce<string | null>(
    (latestUpdatedAt, connectionSummary) => {
      if (latestUpdatedAt === null) {
        return connectionSummary.updatedAt;
      }

      return connectionSummary.updatedAt > latestUpdatedAt
        ? connectionSummary.updatedAt
        : latestUpdatedAt;
    },
    null,
  );

  return {
    connections: [...connections],
    totalConnections: connections.length,
    healthyConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "healthy",
    ).length,
    syncingConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "syncing",
    ).length,
    staleConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "stale",
    ).length,
    needsAttentionConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "needs_attention",
    ).length,
    criticalConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "critical",
    ).length,
    notReadyConnections: connections.filter(
      (connectionSummary) => connectionSummary.health.state === "not_ready",
    ).length,
    lastUpdatedAt,
  };
}
