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

    const persistedFinancialAccounts =
      await this.repository.saveMany(financialAccounts);

    return Object.freeze(
      toFinancialAccountImportResult(
        input,
        persistedFinancialAccounts,
        financialAccountsImportedAt,
      ),
    );
  }
}
