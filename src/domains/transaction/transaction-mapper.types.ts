import type {
  Transaction,
} from "./transaction.types";

export interface TransactionMapper<TProviderTransaction = unknown> {
  map(
    providerTransaction: TProviderTransaction,
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): Transaction;

  mapMany(
    providerTransactions: readonly TProviderTransaction[],
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): readonly Transaction[];
}
