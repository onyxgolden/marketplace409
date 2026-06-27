import { AccountType } from "../../ledger/accounts";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";

export class DebtToAssetMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
  }): number {
    let totalAssets = 0;
    let totalLiabilities = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (account.type === AccountType.ASSET) {
        totalAssets += balance.balance;
      }

      if (account.type === AccountType.LIABILITY) {
        totalLiabilities += balance.balance;
      }
    }

    return totalAssets > 0 ? totalLiabilities / totalAssets : 0;
  }
}

