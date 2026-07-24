import {
  hasConnectionCapability,
} from "./connection-capabilities.types";

import type {
  ConnectionProviderRegistry,
} from "./connection-provider-registry.types";

import {
  findConnectionProvider,
} from "./connection-provider-registry.types";

import type {
  AccountImportInput,
  AccountImportResult,
} from "./account-import.types";

import {
  toAccountImportResult,
} from "./account-import.types";

export class AccountImportService {
  private readonly registry: ConnectionProviderRegistry;

  constructor(registry: ConnectionProviderRegistry) {
    this.registry = registry;
  }

  async importAccounts(
    input: AccountImportInput,
  ): Promise<AccountImportResult> {
    const provider = findConnectionProvider(
      this.registry,
      input.connection.provider,
    );

    if (provider === null) {
      throw new Error("No connection provider registered for account import.");
    }

    const capabilities = provider.capabilities();

    if (!hasConnectionCapability(capabilities, "import_accounts")) {
      throw new Error("Connection provider does not support account import.");
    }

    const providerResult =
      await provider.importData(
        input.connection,
      );

    const providerPayload =
      await provider.importDataPayload(
        input.connection,
      );

    return toAccountImportResult(
      input,
      providerResult,
      providerPayload,
    );
  }
}
