import {
  createTransaction,
} from "../transaction";

import type {
  Transaction,
  TransactionMapper,
} from "../transaction";

import type {
  PlaidTransaction,
} from "./plaid-transaction.types";

export class PlaidTransactionMapper
  implements TransactionMapper<PlaidTransaction> {
  map(
    transaction: PlaidTransaction,
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): Transaction {
    const now = new Date().toISOString();

    return createTransaction({
      id: `transaction_${provider}_${transaction.transactionId}`,
      financialAccountId,
      connectionId,
      provider,
      providerTransactionId: transaction.transactionId,
      providerAccountId,
      amountCents: Math.round(transaction.amount * 100),
      currencyCode: "USD",
      date: transaction.date,
      description: transaction.name,
      merchantName: transaction.merchantName ?? null,
      category: transaction.category ?? [],
      pending: transaction.pending ?? false,
      raw: transaction.raw ?? null,
      createdAt: now,
    });
  }

  mapMany(
    transactions: readonly PlaidTransaction[],
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): readonly Transaction[] {
    return transactions.map((transaction) =>
      this.map(
        transaction,
        connectionId,
        provider,
        financialAccountId,
        providerAccountId,
      ),
    );
  }
}
