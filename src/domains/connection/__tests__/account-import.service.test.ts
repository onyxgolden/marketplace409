import { describe, expect, it } from "vitest";

import { AccountImportService } from "../account-import.service";

import {
  createConnectionProviderRegistry,
  type AccountImportInput,
  type ConnectionProvider,
} from "../index";

function makeInput(provider = "plaid"): AccountImportInput {
  return {
    ownerId: "user-1",
    connection: {
      id: "connection-1",
      userId: "user-1",
      name: "Sandbox Bank Connection",
      type: "bank",
      provider,
      status: "connected",
      credentialReferenceId: "credential-1",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    credentialReference: {
      id: "credential-1",
      provider,
      externalCredentialId: "item-1",
      vaultReference:
        "vault://provider/items/item-1/access-token",
      status: "active",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    institutionReference: {
      id: "institution-1",
      connectionId: "connection-1",
      provider,
      externalInstitutionId: "ins_1",
      name: "Sandbox Bank",
      type: "bank",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    provisionedAt: "2026-07-02T01:00:00.000Z",
    persistedAt: "2026-07-02T02:00:00.000Z",
    readyForImport: true,
  };
}

function makeProvider(
  overrides: Partial<ConnectionProvider> = {},
): ConnectionProvider {
  const providerName =
    overrides.provider ?? "plaid";

  return {
    provider: providerName,
    displayName:
      overrides.displayName ?? "Plaid",

    capabilities:
      overrides.capabilities ??
      (() => ({
        connectionId:
          `${providerName}_capabilities`,
        capabilities: [
          "import_accounts",
          "manual_sync",
        ],
        supportsAutomaticSync: false,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt:
          "2026-07-02T00:00:00.000Z",
        updatedAt:
          "2026-07-02T00:00:00.000Z",
      })),

    validateCredentials:
      overrides.validateCredentials ??
      (async () => ({
        provider: providerName,
        operation: "validate_credentials",
        success: true,
        occurredAt:
          "2026-07-02T00:00:00.000Z",
      })),

    connect:
      overrides.connect ??
      (async () =>
        makeInput(providerName).connection),

    disconnect:
      overrides.disconnect ??
      (async () => ({
        provider: providerName,
        operation: "disconnect",
        success: true,
        occurredAt:
          "2026-07-02T00:00:00.000Z",
      })),

    refreshStatus:
      overrides.refreshStatus ??
      (async () => "connected"),

    synchronize:
      overrides.synchronize ??
      (async () => ({
        provider: providerName,
        operation: "synchronize",
        success: true,
        occurredAt:
          "2026-07-02T00:00:00.000Z",
      })),

    importData:
      overrides.importData ??
      (async (connection) => ({
        provider: providerName,
        connectionId: connection.id,
        importedRecordCount: 2,
        skippedRecordCount: 0,
        failedRecordCount: 0,
        occurredAt:
          "2026-07-02T03:00:00.000Z",
      })),

    importDataPayload:
      overrides.importDataPayload ??
      (async (connection) => ({
        provider: providerName,
        connectionId: connection.id,
        accounts: [],
        balances: [],
        transactions: [],
        occurredAt:
          "2026-07-02T03:00:00.000Z",
      })),

    reportHealth:
      overrides.reportHealth ??
      (async () => ({
        connectionId: "connection-1",
        state: "healthy",
        severity: "healthy",
        label: "Healthy",
        allowsImport: true,
        requiresUserAction: false,
        issueCount: 0,
        warningCount: 0,
        checkedAt:
          "2026-07-02T00:00:00.000Z",
      })),

    providerHealth:
      overrides.providerHealth ??
      (async () => ({
        provider: providerName,
        status: "available",
        label: "Available",
        checkedAt:
          "2026-07-02T00:00:00.000Z",
      })),
  };
}

describe("AccountImportService", () => {
  it("imports accounts through the registered provider", async () => {
    const provider = makeProvider();
    const registry =
      createConnectionProviderRegistry([
        provider,
      ]);

    const service =
      new AccountImportService(registry);

    const result =
      await service.importAccounts(
        makeInput(),
      );

    expect(result.provider).toBe("plaid");
    expect(result.connectionId).toBe(
      "connection-1",
    );
    expect(result.success).toBe(true);
    expect(result.payload).toEqual({
      provider: "plaid",
      connectionId: "connection-1",
      accounts: [],
      balances: [],
      transactions: [],
      occurredAt:
        "2026-07-02T03:00:00.000Z",
    });
    expect(
      result.importedAccountCount,
    ).toBe(2);
    expect(
      result.skippedAccountCount,
    ).toBe(0);
    expect(
      result.failedAccountCount,
    ).toBe(0);
    expect(
      result.readyForTransactionImport,
    ).toBe(true);
  });

  it("rejects missing providers", async () => {
    const registry =
      createConnectionProviderRegistry([]);

    const service =
      new AccountImportService(registry);

    await expect(
      service.importAccounts(makeInput()),
    ).rejects.toThrow(
      "No connection provider registered for account import.",
    );
  });

  it("rejects providers without account import capability", async () => {
    const provider = makeProvider({
      capabilities: () => ({
        connectionId:
          "plaid_capabilities",
        capabilities: [
          "import_transactions",
        ],
        supportsAutomaticSync: false,
        supportsManualSync: true,
        supportsWebhooks: false,
        supportsRealtimeUpdates: false,
        createdAt:
          "2026-07-02T00:00:00.000Z",
        updatedAt:
          "2026-07-02T00:00:00.000Z",
      }),
    });

    const registry =
      createConnectionProviderRegistry([
        provider,
      ]);

    const service =
      new AccountImportService(registry);

    await expect(
      service.importAccounts(makeInput()),
    ).rejects.toThrow(
      "Connection provider does not support account import.",
    );
  });
});
