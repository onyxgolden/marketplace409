import type {
  AccountBalanceRepository,
} from "./account-balance.repository";

import type {
  AccountBalance,
} from "./account-balance.types";

export class InMemoryAccountBalanceRepository
  implements AccountBalanceRepository {
  private readonly balancesById = new Map<string, AccountBalance>();

  async save(
    balance: AccountBalance,
  ): Promise<AccountBalance> {
    this.balancesById.set(balance.id, balance);
    return balance;
  }

  async saveMany(
    balances: readonly AccountBalance[],
  ): Promise<readonly AccountBalance[]> {
    for (const balance of balances) {
      await this.save(balance);
    }

    return balances;
  }

  async findLatestByOwnerId(
    _ownerId: string,
  ): Promise<readonly AccountBalance[]> {
    const latestByAccount =
      new Map<string, AccountBalance>();

    const balances = Array.from(
      this.balancesById.values(),
    ).sort((left, right) => {
      const accountOrder =
        left.financialAccountId.localeCompare(
          right.financialAccountId,
        );

      if (accountOrder !== 0) {
        return accountOrder;
      }

      return right.asOf.localeCompare(left.asOf);
    });

    for (const balance of balances) {
      if (
        !latestByAccount.has(
          balance.financialAccountId,
        )
      ) {
        latestByAccount.set(
          balance.financialAccountId,
          balance,
        );
      }
    }

    return Object.freeze(
      Array.from(latestByAccount.values()),
    );
  }

  async findByFinancialAccount(
    financialAccountId: string,
  ): Promise<readonly AccountBalance[]> {
    return Array.from(this.balancesById.values()).filter(
      (balance) => balance.financialAccountId === financialAccountId,
    );
  }

  async findLatestByFinancialAccount(
    financialAccountId: string,
  ): Promise<AccountBalance | null> {
    const balances = await this.findByFinancialAccount(financialAccountId);

    return balances
      .slice()
      .sort((left, right) => right.asOf.localeCompare(left.asOf))[0] ?? null;
  }

  async findByConnection(
    connectionId: string,
  ): Promise<readonly AccountBalance[]> {
    return Array.from(this.balancesById.values()).filter(
      (balance) => balance.connectionId === connectionId,
    );
  }
}
