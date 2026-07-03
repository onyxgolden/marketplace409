import type {
  Transaction,
} from "./transaction.types";

export interface TransactionRepository {
  save(
    transaction: Transaction,
  ): Promise<Transaction>;

  saveMany(
    transactions: readonly Transaction[],
  ): Promise<readonly Transaction[]>;

  findByFinancialAccount(
    financialAccountId: string,
  ): Promise<readonly Transaction[]>;

  findByConnection(
    connectionId: string,
  ): Promise<readonly Transaction[]>;

  findByProviderTransactionId(
    provider: string,
    providerTransactionId: string,
  ): Promise<Transaction | null>;
}
