import type {
  FinancialAccount,
  FinancialAccountImportResult,
} from "../financial-account";

import type {
  TransactionMapper,
} from "./transaction-mapper.types";

import type {
  TransactionRepository,
} from "./transaction.repository";

import {
  toTransactionImportResult,
} from "./transaction-import.types";

export class TransactionImportService<TProviderTransaction = unknown> {
  private readonly repository: TransactionRepository;
  private readonly mapper: TransactionMapper<TProviderTransaction>;

  constructor(
    repository: TransactionRepository,
    mapper: TransactionMapper<TProviderTransaction>,
  ) {
    this.repository = repository;
    this.mapper = mapper;
  }

  async importTransactionsForAccount(
    input: FinancialAccountImportResult,
    financialAccount: FinancialAccount,
    providerTransactions: readonly TProviderTransaction[],
    transactionsImportedAt?: string,
  ) {
    const transactions = this.mapper.mapMany(
      providerTransactions,
      input.connectionId,
      input.provider,
      financialAccount.id,
      financialAccount.providerAccountId,
    );

    const persistedTransactions =
      await this.repository.saveMany(transactions);

    return Object.freeze(
      toTransactionImportResult(
        input,
        persistedTransactions,
        transactionsImportedAt,
      ),
    );
  }
}
