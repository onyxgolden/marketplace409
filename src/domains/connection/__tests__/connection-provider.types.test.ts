import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CONNECTION_PROVIDER_OPERATIONS,
  CONNECTION_PROVIDER_STATUSES,
  type ConnectionProvider,
  type ConnectionProviderHealth,
  type ConnectionProviderImportResult,
  type ConnectionProviderResult,
} from "../index";

describe("ConnectionProvider", () => {
  it("defines provider-agnostic provider statuses", () => {
    expect(CONNECTION_PROVIDER_STATUSES).toEqual([
      "available",
      "degraded",
      "unavailable",
      "maintenance",
    ]);
  });

  it("defines provider-agnostic operations FORGE expects from integrations", () => {
    expect(CONNECTION_PROVIDER_OPERATIONS).toEqual([
      "validate_credentials",
      "connect",
      "disconnect",
      "refresh_status",
      "synchronize",
      "import_data",
      "report_health",
    ]);
  });

  it("represents operation results without vendor-specific payloads", () => {
    const result: ConnectionProviderResult = {
      provider: "bank_provider",
      operation: "synchronize",
      success: true,
      message: "Synchronization completed.",
      occurredAt: "2026-07-01T04:45:00.000Z",
    };

    expect(result.provider).toBe("bank_provider");
    expect(result.operation).toBe("synchronize");
    expect(result.success).toBe(true);
    expect(Object.keys(result)).not.toContain("plaid");
    expect(Object.keys(result)).not.toContain("stripe");
    expect(Object.keys(result)).not.toContain("quickbooks");
    expect(Object.keys(result)).not.toContain("rentec");
  });

  it("represents import results as FORGE-owned counts", () => {
    const result: ConnectionProviderImportResult = {
      provider: "payment_provider",
      connectionId: "connection_001",
      importedRecordCount: 25,
      skippedRecordCount: 2,
      failedRecordCount: 1,
      occurredAt: "2026-07-01T04:50:00.000Z",
    };

    expect(result.importedRecordCount).toBe(25);
    expect(result.skippedRecordCount).toBe(2);
    expect(result.failedRecordCount).toBe(1);
  });

  it("represents provider health without leaking vendor-specific health models", () => {
    const health: ConnectionProviderHealth = {
      provider: "accounting_provider",
      status: "degraded",
      label: "Delayed responses",
      checkedAt: "2026-07-01T04:55:00.000Z",
    };

    expect(health.status).toBe("degraded");
    expect(Object.keys(health)).toEqual([
      "provider",
      "status",
      "label",
      "checkedAt",
    ]);
  });

  it("defines what FORGE expects from any connection provider", async () => {
    const provider: ConnectionProvider = {
      provider: "generic_provider",
      displayName: "Generic Provider",

      capabilities: () => ({
        connectionId: "provider_capabilities",
        capabilities: ["import_transactions", "manual_sync"],
        supportsAutomaticSync: false,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt: "2026-07-01T04:40:00.000Z",
        updatedAt: "2026-07-01T04:40:00.000Z",
      }),

      validateCredentials: async () => ({
        provider: "generic_provider",
        operation: "validate_credentials",
        success: true,
        occurredAt: "2026-07-01T04:41:00.000Z",
      }),

      connect: async () => ({
        id: "connection_001",
        userId: "user_001",
        name: "Generic Connection",
        type: "future_integration",
        status: "connected",
        provider: "generic_provider",
        credentialReferenceId: "credential_001",
        createdAt: "2026-07-01T04:42:00.000Z",
        updatedAt: "2026-07-01T04:42:00.000Z",
      }),

      disconnect: async () => ({
        provider: "generic_provider",
        operation: "disconnect",
        success: true,
        occurredAt: "2026-07-01T04:43:00.000Z",
      }),

      refreshStatus: async () => "connected",

      synchronize: async () => ({
        provider: "generic_provider",
        operation: "synchronize",
        success: true,
        occurredAt: "2026-07-01T04:44:00.000Z",
      }),

      importData: async () => ({
        provider: "generic_provider",
        connectionId: "connection_001",
        importedRecordCount: 10,
        skippedRecordCount: 0,
        failedRecordCount: 0,
        occurredAt: "2026-07-01T04:45:00.000Z",
      }),

      reportHealth: async () => ({
        connectionId: "connection_001",
        state: "healthy",
        severity: "healthy",
        label: "Healthy",
        allowsImport: true,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt: "2026-07-01T04:46:00.000Z",
      }),

      providerHealth: async () => ({
        provider: "generic_provider",
        status: "available",
        label: "Available",
        checkedAt: "2026-07-01T04:47:00.000Z",
      }),
    };

    expect(provider.provider).toBe("generic_provider");
    expect(provider.capabilities().capabilities).toContain("manual_sync");
    await expect(provider.refreshStatus({} as never)).resolves.toBe("connected");
    await expect(provider.providerHealth()).resolves.toMatchObject({
      status: "available",
    });
  });
});
