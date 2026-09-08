import type {
  FinancialAccount,
  FinancialAccountImportResult,
} from "../financial-account";

import type {
  TransactionMapper,
} from "./transaction-mapper.types";

import type {
  Transaction,
} from "./transaction.types";

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

    return this.persistTransactions(input, transactions, transactionsImportedAt);
  }

  // See src/domains/connection/connection-import-payload.types.ts for the authoritative contract:
  // provider.importDataPayload() already returns canonical Transaction objects -- this must never
  // be re-mapped through this.mapper, which expects a raw provider-specific transaction shape.
  // Callers (ConnectionImportExecutionCoordinator, the Stripe Financial Connections webhook
  // route) are still responsible for pre-filtering to the one financialAccount's own transactions
  // before calling this, exactly as importTransactionsForAccount's own callers already do.
  async importCanonicalTransactionsForAccount(
    input: FinancialAccountImportResult,
    financialAccount: FinancialAccount,
    transactions: readonly Transaction[],
    transactionsImportedAt?: string,
  ) {
    void financialAccount; // kept for signature symmetry with importTransactionsForAccount; canonical transactions already carry their own financialAccountId
    return this.persistTransactions(input, transactions, transactionsImportedAt);
  }

  private async persistTransactions(
    input: FinancialAccountImportResult,
    transactions: readonly Transaction[],
    transactionsImportedAt?: string,
  ) {
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
