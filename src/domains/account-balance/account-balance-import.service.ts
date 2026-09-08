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

  // See src/domains/connection/connection-import-payload.types.ts for the authoritative contract:
  // provider.importDataPayload() already returns canonical AccountBalance objects (each already
  // carrying the correct financialAccountId, resolved by the adapter itself at mapping time) --
  // this must never be re-mapped through this.mapper, which expects a raw provider-specific
  // balance shape. Still skips (and counts) any balance whose financialAccountId doesn't match an
  // account that was actually persisted this run, the same defensive behavior importBalances
  // already has, just without re-deriving financialAccountId from a raw provider accountId.
  async importCanonicalBalances(
    input: FinancialAccountImportResult,
    balances: readonly AccountBalance[],
    accountBalancesImportedAt?: string,
  ) {
    const importedAt = accountBalancesImportedAt ?? new Date().toISOString();
    const knownFinancialAccountIds = new Set(input.financialAccounts.map((financialAccount) => financialAccount.id));

    const acceptedBalances: AccountBalance[] = [];
    let skippedAccountBalanceCount = 0;

    for (const balance of balances) {
      if (!knownFinancialAccountIds.has(balance.financialAccountId)) {
        skippedAccountBalanceCount += 1;
        continue;
      }
      acceptedBalances.push(balance);
    }

    const persistedAccountBalances = await this.repository.saveMany(acceptedBalances, { ownerId: input.connection.userId });

    return toAccountBalanceImportResult(input, persistedAccountBalances, skippedAccountBalanceCount, importedAt);
  }
}
