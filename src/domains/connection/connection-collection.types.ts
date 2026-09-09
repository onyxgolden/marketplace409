import type {
  ConnectionSummary,
} from "./connection-summary.types";

export type ConnectionCollection = Readonly<{
  connections: readonly ConnectionSummary[];
  // Active, authenticated connections only -- excludes retired/historical ones (health.state ===
  // "retired"), so this is the number a "Connections" headline should show. The full history,
  // retired entries included, is still every element of `connections` above; `retiredConnections`
  // below is that count on its own for a separate "history" display.
  totalConnections: number;
  healthyConnections: number;
  syncingConnections: number;
  staleConnections: number;
  needsAttentionConnections: number;
  criticalConnections: number;
  notReadyConnections: number;
  retiredConnections: number;
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

  const retiredConnections = connections.filter(
    (connectionSummary) => connectionSummary.health.state === "retired",
  ).length;

  return {
    connections: [...connections],
    totalConnections: connections.length - retiredConnections,
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
    retiredConnections,
    lastUpdatedAt,
  };
}
