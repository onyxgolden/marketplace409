import type {
  FinancialAccountRepository,
} from "./financial-account.repository";

import type {
  FinancialAccount,
} from "./financial-account.types";

export class InMemoryFinancialAccountRepository
  implements FinancialAccountRepository {
  private readonly accountsById = new Map<string, FinancialAccount>();

  async save(
    account: FinancialAccount,
  ): Promise<FinancialAccount> {
    this.accountsById.set(account.id, account);
    return account;
  }

  async saveMany(
    accounts: readonly FinancialAccount[],
  ): Promise<readonly FinancialAccount[]> {
    for (const account of accounts) {
      await this.save(account);
    }

    return accounts;
  }

  async findById(
    id: string,
  ): Promise<FinancialAccount | null> {
    return this.accountsById.get(id) ?? null;
  }

  async findByConnection(
    connectionId: string,
  ): Promise<readonly FinancialAccount[]> {
    return Array.from(this.accountsById.values()).filter(
      (account) => account.connectionId === connectionId,
    );
  }

  async findByProviderAccountId(
    provider: string,
    providerAccountId: string,
  ): Promise<FinancialAccount | null> {
    return Array.from(this.accountsById.values()).find(
      (account) =>
        account.provider === provider &&
        account.providerAccountId === providerAccountId,
    ) ?? null;
  }
}
