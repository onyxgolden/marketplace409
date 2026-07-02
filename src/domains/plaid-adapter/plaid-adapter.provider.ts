import type {
  Connection,
  ConnectionHealth,
  ConnectionProviderHealth,
  ConnectionProviderImportResult,
  ConnectionProviderResult,
  ConnectionStatus,
  CredentialReference,
} from "../connection";

import type {
  PlaidAdapter,
} from "./plaid-adapter.types";

import {
  createPlaidClient,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "./plaid.client";

export function createPlaidAdapter(): PlaidAdapter {
  return {
    provider: "plaid",
    displayName: "Plaid",

    async createLinkToken(request) {
      return createPlaidLinkToken(createPlaidClient(), request);
    },

    async exchangePublicToken(request) {
      return exchangePlaidPublicToken(createPlaidClient(), request);
    },

    capabilities() {
      const now = new Date().toISOString();

      return {
        connectionId: "plaid",
        capabilities: [
          "import_transactions",
          "import_balances",
          "manual_sync",
          "scheduled_sync",
          "webhook_updates",
        ],
        supportsAutomaticSync: true,
        supportsManualSync: true,
        supportsWebhooks: true,
        supportsRealtimeUpdates: false,
        createdAt: now,
        updatedAt: now,
      };
    },

    async validateCredentials(
      credentialReference: CredentialReference,
    ): Promise<ConnectionProviderResult> {
      return providerResult(
        "validate_credentials",
        credentialReference.provider === "plaid",
      );
    },

    async connect(
      credentialReference: CredentialReference,
    ): Promise<Connection> {
      const now = new Date().toISOString();

      return {
        id: credentialReference.externalCredentialId,
        userId: "pending_user",
        name: "Plaid Connection",
        type: "bank",
        status: "connected",
        provider: "plaid",
        credentialReferenceId: credentialReference.id,
        createdAt: now,
        updatedAt: now,
      };
    },

    async disconnect(
      connection: Connection,
    ): Promise<ConnectionProviderResult> {
      return providerResult("disconnect", connection.provider === "plaid");
    },

    async refreshStatus(
      connection: Connection,
    ): Promise<ConnectionStatus> {
      return connection.provider === "plaid" ? "connected" : "error";
    },

    async synchronize(
      connection: Connection,
    ): Promise<ConnectionProviderResult> {
      return providerResult("synchronize", connection.provider === "plaid");
    },

    async importData(
      connection: Connection,
    ): Promise<ConnectionProviderImportResult> {
      return {
        provider: "plaid",
        connectionId: connection.id,
        importedRecordCount: 0,
        skippedRecordCount: 0,
        failedRecordCount: connection.provider === "plaid" ? 0 : 1,
        occurredAt: new Date().toISOString(),
      };
    },

    async reportHealth(
      connection: Connection,
    ): Promise<ConnectionHealth> {
      const now = new Date().toISOString();
      const isPlaidConnection = connection.provider === "plaid";

      return {
        connectionId: connection.id,
        state: isPlaidConnection ? "healthy" : "critical",
        severity: isPlaidConnection ? "healthy" : "critical",
        label: isPlaidConnection ? "Plaid connection ready" : "Invalid provider",
        allowsImport: isPlaidConnection,
        requiresUserAction: !isPlaidConnection,
        issueCount: isPlaidConnection ? 0 : 1,
        warningCount: 0,
        checkedAt: now,
      };
    },

    async providerHealth(): Promise<ConnectionProviderHealth> {
      return {
        provider: "plaid",
        status: "available",
        label: "Plaid adapter available",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function providerResult(
  operation: ConnectionProviderResult["operation"],
  success: boolean,
): ConnectionProviderResult {
  return {
    provider: "plaid",
    operation,
    success,
    message: success
      ? "Plaid adapter operation accepted."
      : "Invalid provider for Plaid adapter.",
    occurredAt: new Date().toISOString(),
  };
}
