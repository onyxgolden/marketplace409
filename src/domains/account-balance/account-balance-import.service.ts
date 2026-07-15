import type {
  FinancialAccountImportResult,
} from "../financial-account";

import type {
  AccountBalanceRepository,
} from "./account-balance.repository";

import type {
  AccountBalance,
} from "./account-balance.types";

import {
  toAccountBalanceImportResult,
} from "./account-balance-import.types";

export type AccountBalanceProviderRecord =
  Readonly<{
    accountId: string;
  }>;

export type AccountBalanceProviderMapper<
  TProviderBalance extends
    AccountBalanceProviderRecord =
      AccountBalanceProviderRecord,
> = Readonly<{
  map(
    balance: TProviderBalance,
    financialAccountId: string,
    connectionId: string,
    provider: string,
    asOf?: string,
  ): AccountBalance;
}>;

export class AccountBalanceImportService<
  TProviderBalance extends
    AccountBalanceProviderRecord =
      AccountBalanceProviderRecord,
> {
  private readonly repository:
    AccountBalanceRepository;

  private readonly mapper:
    AccountBalanceProviderMapper<TProviderBalance>;

  constructor(
    repository: AccountBalanceRepository,
    mapper:
      AccountBalanceProviderMapper<TProviderBalance>,
  ) {
    this.repository = repository;
    this.mapper = mapper;
  }

  async importBalances(
    input: FinancialAccountImportResult,
    providerBalances:
      readonly TProviderBalance[],
    accountBalancesImportedAt?: string,
  ) {
    const importedAt =
      accountBalancesImportedAt ??
      new Date().toISOString();

    const financialAccountsByProviderId =
      new Map(
        input.financialAccounts.map(
          (financialAccount) => [
            financialAccount.providerAccountId,
            financialAccount,
          ],
        ),
      );

    const mappedBalances: AccountBalance[] =
      [];

    let skippedAccountBalanceCount = 0;

    for (const providerBalance of
      providerBalances) {
      const financialAccount =
        financialAccountsByProviderId.get(
          providerBalance.accountId,
        );

      if (!financialAccount) {
        skippedAccountBalanceCount += 1;
        continue;
      }

      mappedBalances.push(
        this.mapper.map(
          providerBalance,
          financialAccount.id,
          input.connectionId,
          input.provider,
          importedAt,
        ),
      );
    }

    const persistedAccountBalances =
      await this.repository.saveMany(
        mappedBalances,
        {
          ownerId: input.connection.userId,
        },
      );

    return toAccountBalanceImportResult(
      input,
      persistedAccountBalances,
      skippedAccountBalanceCount,
      importedAt,
    );
  }
}
