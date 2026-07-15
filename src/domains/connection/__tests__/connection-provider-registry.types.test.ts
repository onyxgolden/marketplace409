import { describe, expect, it } from "vitest";

import {
  connectionProviderHealthReport,
  createConnectionProviderRegistry,
  findConnectionProvider,
  hasConnectionProvider,
  providersSupportingCapability,
  type ConnectionProvider,
} from "../index";

function makeProvider(
  overrides: Partial<ConnectionProvider> = {},
): ConnectionProvider {
  const providerName = overrides.provider ?? "generic_provider";

  return {
    provider: providerName,
    displayName: overrides.displayName ?? "Generic Provider",

    capabilities: overrides.capabilities ?? (() => ({
      connectionId: `${providerName}_capabilities`,
      capabilities: ["import_transactions", "manual_sync"],
      supportsAutomaticSync: false,
      supportsManualSync: true,
      supportsWebhooks: false,
      supportsRealtimeUpdates: false,
      createdAt: "2026-07-01T05:00:00.000Z",
      updatedAt: "2026-07-01T05:00:00.000Z",
    })),

    validateCredentials: overrides.validateCredentials ?? (async () => ({
      provider: providerName,
      operation: "validate_credentials",
      success: true,
      occurredAt: "2026-07-01T05:01:00.000Z",
    })),

    connect: overrides.connect ?? (async () => ({
      id: "connection_001",
      userId: "user_001",
      name: "Generic Connection",
      type: "future_integration",
      status: "connected",
      provider: providerName,
      credentialReferenceId: "credential_001",
      createdAt: "2026-07-01T05:02:00.000Z",
      updatedAt: "2026-07-01T05:02:00.000Z",
    })),

    disconnect: overrides.disconnect ?? (async () => ({
      provider: providerName,
      operation: "disconnect",
      success: true,
      occurredAt: "2026-07-01T05:03:00.000Z",
    })),

    refreshStatus: overrides.refreshStatus ?? (async () => "connected"),

    synchronize: overrides.synchronize ?? (async () => ({
      provider: providerName,
      operation: "synchronize",
      success: true,
      occurredAt: "2026-07-01T05:04:00.000Z",
    })),

    importData: overrides.importData ?? (async () => ({
      provider: providerName,
      connectionId: "connection_001",
      importedRecordCount: 10,
      skippedRecordCount: 0,
      failedRecordCount: 0,
      occurredAt: "2026-07-01T05:05:00.000Z",
    })),

    reportHealth:
      overrides.reportHealth ??
      (async (_connection) => ({
        connectionId: "connection_001",
        state: "healthy",
        severity: "healthy",
        label: "Healthy",
        allowsImport: true,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt:
          "2026-07-01T05:06:00.000Z",
      })),

    providerHealth: overrides.providerHealth ?? (async () => ({
      provider: providerName,
      status: "available",
      label: "Available",
      checkedAt: "2026-07-01T05:07:00.000Z",
    })),
  };
}

describe("ConnectionProviderRegistry", () => {
  it("creates a provider registry summary", () => {
    const plaid = makeProvider({ provider: "plaid", displayName: "Plaid" });
    const stripe = makeProvider({ provider: "stripe", displayName: "Stripe" });

    const registry = createConnectionProviderRegistry([plaid, stripe]);

    expect(registry.providers).toEqual([plaid, stripe]);
    expect(registry.totalProviders).toBe(2);
    expect(registry.providerNames).toEqual(["plaid", "stripe"]);
  });

  it("prevents duplicate provider registration", () => {
    const first = makeProvider({ provider: "plaid" });
    const duplicate = makeProvider({ provider: "plaid" });

    expect(() => createConnectionProviderRegistry([first, duplicate]))
      .toThrow("ConnectionProviderRegistry cannot contain duplicate providers.");
  });

  it("finds providers by FORGE provider name", () => {
    const plaid = makeProvider({ provider: "plaid" });
    const stripe = makeProvider({ provider: "stripe" });
    const registry = createConnectionProviderRegistry([plaid, stripe]);

    expect(findConnectionProvider(registry, "stripe")).toBe(stripe);
    expect(findConnectionProvider(registry, "missing")).toBeNull();
  });

  it("reports whether a provider exists", () => {
    const registry = createConnectionProviderRegistry([
      makeProvider({ provider: "csv" }),
    ]);

    expect(hasConnectionProvider(registry, "csv")).toBe(true);
    expect(hasConnectionProvider(registry, "plaid")).toBe(false);
  });

  it("finds providers supporting a FORGE-owned capability", () => {
    const transactionProvider = makeProvider({
      provider: "transactions",
      capabilities: () => ({
        connectionId: "transactions_capabilities",
        capabilities: ["import_transactions", "manual_sync"],
        supportsAutomaticSync: false,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt: "2026-07-01T05:10:00.000Z",
        updatedAt: "2026-07-01T05:10:00.000Z",
      }),
    });

    const balanceProvider = makeProvider({
      provider: "balances",
      capabilities: () => ({
        connectionId: "balances_capabilities",
        capabilities: ["import_balances"],
        supportsAutomaticSync: false,
        supportsManualSync: false,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt: "2026-07-01T05:11:00.000Z",
        updatedAt: "2026-07-01T05:11:00.000Z",
      }),
    });

    const registry = createConnectionProviderRegistry([
      transactionProvider,
      balanceProvider,
    ]);

    expect(
      providersSupportingCapability(registry, "import_transactions"),
    ).toEqual([transactionProvider]);

    expect(
      providersSupportingCapability(registry, "import_balances"),
    ).toEqual([balanceProvider]);
  });

  it("reports provider health across the registry", async () => {
    const plaid = makeProvider({
      provider: "plaid",
      providerHealth: async () => ({
        provider: "plaid",
        status: "available",
        label: "Available",
        checkedAt: "2026-07-01T05:12:00.000Z",
      }),
    });

    const stripe = makeProvider({
      provider: "stripe",
      providerHealth: async () => ({
        provider: "stripe",
        status: "degraded",
        label: "Delayed",
        checkedAt: "2026-07-01T05:13:00.000Z",
      }),
    });

    const registry = createConnectionProviderRegistry([plaid, stripe]);

    await expect(connectionProviderHealthReport(registry)).resolves.toEqual([
      {
        provider: "plaid",
        status: "available",
        label: "Available",
        checkedAt: "2026-07-01T05:12:00.000Z",
      },
      {
        provider: "stripe",
        status: "degraded",
        label: "Delayed",
        checkedAt: "2026-07-01T05:13:00.000Z",
      },
    ]);
  });
});
