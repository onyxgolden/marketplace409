import type { Transaction } from "./transaction.types";

export class TransactionService {
  static getTotalIncome(transactions: Transaction[]): number {
    return transactions
      .filter((transaction) => transaction.type === "income")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }

  static getTotalExpenses(transactions: Transaction[]): number {
    return transactions
      .filter((transaction) => transaction.type === "expense")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  }

  static getNetCashFlow(transactions: Transaction[]): number {
    return (
      TransactionService.getTotalIncome(transactions) -
      TransactionService.getTotalExpenses(transactions)
    );
  }
}