import { describe, expect, it } from "vitest";

import {
  ConnectionService,
  createConnectionCollection,
  type ConnectionCapabilities,
  type ConnectionHealth,
  type ConnectionSummary,
} from "../index";

function makeConnectionSummary(
  overrides: Partial<ConnectionSummary> = {},
): ConnectionSummary {
  const connectionId = overrides.connection?.id ?? "connection-1";
  const updatedAt = overrides.updatedAt ?? "2026-06-30T12:00:00.000Z";

  const capabilities: ConnectionCapabilities = overrides.capabilities ?? {
    connectionId,
    capabilities: ["import_transactions"],
    supportsAutomaticSync: true,
    supportsManualSync: true,
    supportsWebhooks: false,
    supportsRealtimeUpdates: false,
    createdAt: "2026-06-30T10:00:00.000Z",
    updatedAt,
  };

  const health: ConnectionHealth = overrides.health ?? {
    connectionId,
    state: "healthy",
    severity: "info",
    label: "Healthy",
    allowsImport: true,
    requiresUserAction: false,
    issueCount: 0,
    warningCount: 0,
    checkedAt: updatedAt,
  };

  return {
    connection: overrides.connection ?? {
      id: connectionId,
      provider: "plaid",
      type: "bank",
      status: "active",
      name: "Operating Bank",
      createdAt: "2026-06-30T10:00:00.000Z",
      updatedAt,
    },
    statusDetails: overrides.statusDetails ?? {
      status: "active",
      severity: "info",
      label: "Active",
      allowsImport: true,
      requiresUserAction: false,
    },
    capabilities,
    institution: overrides.institution ?? {
      id: "institution-1",
      provider: "plaid",
      providerInstitutionId: "ins_1",
      name: "Forge Bank",
      type: "bank",
      createdAt: "2026-06-30T10:00:00.000Z",
      updatedAt,
    },
    health,
    createdAt: overrides.createdAt ?? "2026-06-30T10:00:00.000Z",
    updatedAt,
  };
}

describe("ConnectionService", () => {
  it("returns summary, all connections, and latest update from the collection", () => {
    const older = makeConnectionSummary({
      connection: {
        id: "connection-older",
        provider: "plaid",
        type: "bank",
        status: "active",
        name: "Older Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T11:00:00.000Z",
      },
      updatedAt: "2026-06-30T11:00:00.000Z",
    });

    const newer = makeConnectionSummary({
      connection: {
        id: "connection-newer",
        provider: "stripe",
        type: "payments",
        status: "active",
        name: "Newer Processor",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T13:00:00.000Z",
      },
      updatedAt: "2026-06-30T13:00:00.000Z",
    });

    const collection = createConnectionCollection([older, newer]);
    const service = new ConnectionService(collection);

    expect(service.summary()).toBe(collection);
    expect(service.all()).toEqual([older, newer]);
    expect(service.latestUpdate()).toBe("2026-06-30T13:00:00.000Z");
  });

  it.each([
    ["not_ready", []],
    ["critical", ["critical", "needs_attention", "stale", "syncing", "healthy"]],
    ["needs_attention", ["needs_attention", "stale", "syncing", "healthy"]],
    ["stale", ["stale", "syncing", "healthy"]],
    ["syncing", ["syncing", "healthy"]],
    ["healthy", ["healthy", "healthy"]],
  ] as const)(
    "reports overall health as %s",
    (expectedHealth, states) => {
      const collection = createConnectionCollection(
        states.map((state, index) => makeConnectionSummary({
          connection: {
            id: `connection-${index}`,
            provider: "plaid",
            type: "bank",
            status: "active",
            name: `Connection ${index}`,
            createdAt: "2026-06-30T10:00:00.000Z",
            updatedAt: "2026-06-30T12:00:00.000Z",
          },
          health: {
            connectionId: `connection-${index}`,
            state,
            severity: state === "critical" ? "error" : "info",
            label: state,
            allowsImport: state === "healthy",
            requiresUserAction: state === "critical" || state === "needs_attention",
            issueCount: state === "critical" ? 1 : 0,
            warningCount: state === "stale" ? 1 : 0,
            checkedAt: "2026-06-30T12:00:00.000Z",
          },
        })),
      );

      const service = new ConnectionService(collection);

      expect(service.overallHealth()).toBe(expectedHealth);
    },
  );

  it("filters connections by health state", () => {
    const healthy = makeConnectionSummary({
      connection: {
        id: "healthy",
        provider: "plaid",
        type: "bank",
        status: "active",
        name: "Healthy Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "healthy",
        state: "healthy",
        severity: "info",
        label: "Healthy",
        allowsImport: true,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const syncing = makeConnectionSummary({
      connection: {
        id: "syncing",
        provider: "stripe",
        type: "payments",
        status: "syncing",
        name: "Syncing Processor",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "syncing",
        state: "syncing",
        severity: "info",
        label: "Syncing",
        allowsImport: false,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const stale = makeConnectionSummary({
      connection: {
        id: "stale",
        provider: "quickbooks",
        type: "accounting",
        status: "active",
        name: "Stale Accounting",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "stale",
        state: "stale",
        severity: "warning",
        label: "Stale",
        allowsImport: false,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 1,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const needsAttention = makeConnectionSummary({
      connection: {
        id: "needs-attention",
        provider: "plaid",
        type: "bank",
        status: "reauthorization_required",
        name: "Needs Attention Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "needs-attention",
        state: "needs_attention",
        severity: "warning",
        label: "Needs Attention",
        allowsImport: false,
        requiresUserAction: true,
        issueCount: 1,
        warningCount: 1,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const critical = makeConnectionSummary({
      connection: {
        id: "critical",
        provider: "plaid",
        type: "bank",
        status: "error",
        name: "Critical Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "critical",
        state: "critical",
        severity: "error",
        label: "Critical",
        allowsImport: false,
        requiresUserAction: true,
        issueCount: 2,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const notReady = makeConnectionSummary({
      connection: {
        id: "not-ready",
        provider: "manual",
        type: "manual",
        status: "pending",
        name: "Not Ready Manual Source",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "not-ready",
        state: "not_ready",
        severity: "info",
        label: "Not Ready",
        allowsImport: false,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const service = new ConnectionService(createConnectionCollection([
      healthy,
      syncing,
      stale,
      needsAttention,
      critical,
      notReady,
    ]));

    expect(service.healthyConnections()).toEqual([healthy]);
    expect(service.syncingConnections()).toEqual([syncing]);
    expect(service.staleConnections()).toEqual([stale]);
    expect(service.needsAttention()).toEqual([needsAttention]);
    expect(service.criticalConnections()).toEqual([critical]);
    expect(service.notReadyConnections()).toEqual([notReady]);
  });

  it("only marks import ready when at least one connection allows import and supports transaction import", () => {
    const eligible = makeConnectionSummary({
      connection: {
        id: "eligible",
        provider: "plaid",
        type: "bank",
        status: "active",
        name: "Eligible Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const blockedByHealth = makeConnectionSummary({
      connection: {
        id: "blocked-health",
        provider: "plaid",
        type: "bank",
        status: "error",
        name: "Blocked Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "blocked-health",
        state: "critical",
        severity: "error",
        label: "Critical",
        allowsImport: false,
        requiresUserAction: true,
        issueCount: 1,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const blockedByCapability = makeConnectionSummary({
      connection: {
        id: "blocked-capability",
        provider: "stripe",
        type: "payments",
        status: "active",
        name: "Blocked Processor",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      capabilities: {
        connectionId: "blocked-capability",
        capabilities: ["import_balances"],
        supportsAutomaticSync: true,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const service = new ConnectionService(createConnectionCollection([
      blockedByHealth,
      blockedByCapability,
      eligible,
    ]));

    expect(service.readyForImport()).toBe(true);
    expect(service.importEligibleConnections()).toEqual([eligible]);
  });

  it("does not mark import ready when no connection is import eligible", () => {
    const blockedByHealth = makeConnectionSummary({
      connection: {
        id: "blocked-health",
        provider: "plaid",
        type: "bank",
        status: "error",
        name: "Blocked Bank",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      health: {
        connectionId: "blocked-health",
        state: "critical",
        severity: "error",
        label: "Critical",
        allowsImport: false,
        requiresUserAction: true,
        issueCount: 1,
        warningCount: 0,
        checkedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const blockedByCapability = makeConnectionSummary({
      connection: {
        id: "blocked-capability",
        provider: "stripe",
        type: "payments",
        status: "active",
        name: "Blocked Processor",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
      capabilities: {
        connectionId: "blocked-capability",
        capabilities: ["import_balances"],
        supportsAutomaticSync: true,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:00:00.000Z",
      },
    });

    const service = new ConnectionService(createConnectionCollection([
      blockedByHealth,
      blockedByCapability,
    ]));

    expect(service.readyForImport()).toBe(false);
    expect(service.importEligibleConnections()).toEqual([]);
  });
});
