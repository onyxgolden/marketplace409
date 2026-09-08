import type {
  AccountImportResult,
} from "../connection";

import type {
  FinancialAccountMapper,
} from "./financial-account-mapper.types";

import type {
  FinancialAccountRepository,
} from "./financial-account.repository";

import {
  toFinancialAccountImportResult,
} from "./financial-account-import.types";

export class FinancialAccountImportService<TProviderAccount = unknown> {
  private readonly repository: FinancialAccountRepository;
  private readonly mapper: FinancialAccountMapper<TProviderAccount>;

  constructor(
    repository: FinancialAccountRepository,
    mapper: FinancialAccountMapper<TProviderAccount>,
  ) {
    this.repository = repository;
    this.mapper = mapper;
  }

  async importAccounts(
    input: AccountImportResult,
    providerAccounts: readonly TProviderAccount[],
    financialAccountsImportedAt?: string,
  ) {
    const financialAccounts = this.mapper.mapMany(
      providerAccounts,
      input.connectionId,
      input.provider,
      input.institutionReference.id,
    );

    return this.persistFinancialAccounts(input, financialAccounts, financialAccountsImportedAt);
  }

  // See src/domains/connection/connection-import-payload.types.ts for the authoritative contract
  // this exists to honor: provider.importDataPayload() (both Plaid's and Stripe Financial
  // Connections') already returns canonical FinancialAccount objects, mapped exactly once, inside
  // the adapter. Calling importAccounts (above) on that payload would map it a SECOND time
  // through this.mapper -- which expects raw, provider-specific field names -- silently
  // corrupting every field the two shapes don't share (providerAccountId vs. accountId, etc.).
  // This is the method every canonical-payload caller (ConnectionImportExecutionCoordinator, the
  // Stripe Financial Connections webhook route) must use instead. importAccounts itself is left
  // unchanged, not removed, for any caller that genuinely still has raw provider data to map.
  async importCanonicalAccounts(
    input: AccountImportResult,
    financialAccounts: readonly any[],
    financialAccountsImportedAt?: string,
  ) {
    return this.persistFinancialAccounts(input, financialAccounts, financialAccountsImportedAt);
  }

  private async persistFinancialAccounts(
    input: AccountImportResult,
    financialAccounts: readonly any[],
    financialAccountsImportedAt?: string,
  ) {
    const persistedFinancialAccounts =
      await this.repository.saveMany(
        financialAccounts,
        {
          ownerId: input.connection.userId,
        },
      );

    return Object.freeze(
      toFinancialAccountImportResult(
        input,
        persistedFinancialAccounts,
        financialAccountsImportedAt,
      ),
    );
  }
}
