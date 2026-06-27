import { AccountType } from "../../ledger/accounts";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";

export class ProfitMarginMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
  }): number {
    let revenue = 0;
    let expenses = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (account.type === AccountType.REVENUE) {
        revenue += balance.balance;
      }

      if (account.type === AccountType.EXPENSE) {
        expenses += balance.balance;
      }
    }

    const netIncome = revenue - expenses;

    return revenue > 0 ? netIncome / revenue : 0;
  }
}
