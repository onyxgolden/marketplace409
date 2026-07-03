import type {
  TransactionRepository,
} from "./transaction.repository";

import type {
  Transaction,
} from "./transaction.types";

export class InMemoryTransactionRepository
  implements TransactionRepository {
  private readonly transactionsById = new Map<string, Transaction>();

  async save(
    transaction: Transaction,
  ): Promise<Transaction> {
    this.transactionsById.set(transaction.id, transaction);
    return transaction;
  }

  async saveMany(
    transactions: readonly Transaction[],
  ): Promise<readonly Transaction[]> {
    for (const transaction of transactions) {
      await this.save(transaction);
    }

    return transactions;
  }

  async findByFinancialAccount(
    financialAccountId: string,
  ): Promise<readonly Transaction[]> {
    return Array.from(this.transactionsById.values()).filter(
      (transaction) => transaction.financialAccountId === financialAccountId,
    );
  }

  async findByConnection(
    connectionId: string,
  ): Promise<readonly Transaction[]> {
    return Array.from(this.transactionsById.values()).filter(
      (transaction) => transaction.connectionId === connectionId,
    );
  }

  async findByProviderTransactionId(
    provider: string,
    providerTransactionId: string,
  ): Promise<Transaction | null> {
    return Array.from(this.transactionsById.values()).find(
      (transaction) =>
        transaction.provider === provider &&
        transaction.providerTransactionId === providerTransactionId,
    ) ?? null;
  }
}
