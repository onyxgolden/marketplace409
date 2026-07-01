import type {
  ConnectionCollection,
} from "./connection-collection.types";

import type {
  ConnectionSummary,
} from "./connection-summary.types";

import type {
  ConnectionHealthState,
} from "./connection-health.types";

import {
  hasConnectionCapability,
} from "./connection-capabilities.types";

export class ConnectionService {
  constructor(
    private readonly collection: ConnectionCollection,
  ) {}

  summary(): ConnectionCollection {
    return this.collection;
  }

  all(): readonly ConnectionSummary[] {
    return this.collection.connections;
  }

  latestUpdate(): string | null {
    return this.collection.lastUpdatedAt;
  }

  overallHealth(): ConnectionHealthState {
    if (this.collection.totalConnections === 0) {
      return "not_ready";
    }

    if (this.collection.criticalConnections > 0) {
      return "critical";
    }

    if (this.collection.needsAttentionConnections > 0) {
      return "needs_attention";
    }

    if (this.collection.staleConnections > 0) {
      return "stale";
    }

    if (this.collection.syncingConnections > 0) {
      return "syncing";
    }

    if (this.collection.healthyConnections === this.collection.totalConnections) {
      return "healthy";
    }

    return "not_ready";
  }

  healthyConnections(): readonly ConnectionSummary[] {
    return this.byHealthState("healthy");
  }

  syncingConnections(): readonly ConnectionSummary[] {
    return this.byHealthState("syncing");
  }

  staleConnections(): readonly ConnectionSummary[] {
    return this.byHealthState("stale");
  }

  needsAttention(): readonly ConnectionSummary[] {
    return this.byHealthState("needs_attention");
  }

  criticalConnections(): readonly ConnectionSummary[] {
    return this.byHealthState("critical");
  }

  notReadyConnections(): readonly ConnectionSummary[] {
    return this.byHealthState("not_ready");
  }

  readyForImport(): boolean {
    return this.importEligibleConnections().length > 0;
  }

  importEligibleConnections(): readonly ConnectionSummary[] {
    return this.collection.connections.filter((connectionSummary) => (
      connectionSummary.health.allowsImport
      && hasConnectionCapability(
        connectionSummary.capabilities,
        "import_transactions",
      )
    ));
  }

  private byHealthState(
    state: ConnectionHealthState,
  ): readonly ConnectionSummary[] {
    return this.collection.connections.filter(
      (connectionSummary) => connectionSummary.health.state === state,
    );
  }
}
