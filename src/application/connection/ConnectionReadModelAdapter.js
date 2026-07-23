function freezeObject(value) {
  return Object.freeze({
    ...value,
  });
}

export class ConnectionReadModelAdapter {
  constructor() {
    Object.freeze(this);
  }

  buildDashboard(connectionCollection) {
    if (
      !connectionCollection ||
      typeof connectionCollection !== "object"
    ) {
      throw new Error(
        "ConnectionReadModelAdapter requires a connection collection.",
      );
    }

    return Object.freeze({
      summary: freezeObject({
        totalConnections:
          connectionCollection.totalConnections,
        healthyConnections:
          connectionCollection.healthyConnections,
        syncingConnections:
          connectionCollection.syncingConnections,
        staleConnections:
          connectionCollection.staleConnections,
        needsAttentionConnections:
          connectionCollection.needsAttentionConnections,
        criticalConnections:
          connectionCollection.criticalConnections,
        notReadyConnections:
          connectionCollection.notReadyConnections,
      }),

      connections: Object.freeze([
        ...connectionCollection.connections,
      ]),

      metadata: freezeObject({
        provider: "connection-platform",
        snapshotStatus: "repository-backed",
        phase: "20C",
        lastUpdatedAt:
          connectionCollection.lastUpdatedAt,
      }),
    });
  }

  buildReports(connectionCollection) {
    if (
      !connectionCollection ||
      typeof connectionCollection !== "object"
    ) {
      throw new Error(
        "ConnectionReadModelAdapter requires a connection collection.",
      );
    }

    return Object.freeze({
      connections: Object.freeze([
        ...connectionCollection.connections,
      ]),
    });
  }
}

export const connectionReadModelAdapter =
  new ConnectionReadModelAdapter();

Object.freeze(ConnectionReadModelAdapter);
