import type {
  Transaction,
} from "./transaction.types";

export class TransactionService {
  static getTotalAmountCents(
    transactions: readonly Transaction[],
  ): number {
    return transactions.reduce(
      (sum, transaction) => sum + transaction.amountCents,
      0,
    );
  }

  static getSettledAmountCents(
    transactions: readonly Transaction[],
  ): number {
    return TransactionService.getTotalAmountCents(
      transactions.filter((transaction) => !transaction.pending),
    );
  }

  static getPendingAmountCents(
    transactions: readonly Transaction[],
  ): number {
    return TransactionService.getTotalAmountCents(
      transactions.filter((transaction) => transaction.pending),
    );
  }
}
