import { AccountType } from "../../ledger/accounts";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";

export class DebtToEquityMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
  }): number {
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (account.type === AccountType.LIABILITY) {
        totalLiabilities += balance.balance;
      }

      if (account.type === AccountType.EQUITY) {
        totalEquity += balance.balance;
      }
    }

    return totalEquity > 0 ? totalLiabilities / totalEquity : 0;
  }
}
