import { AccountType } from "../../ledger/accounts";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";
import {
  ClassificationSemanticGroup,
  type ClassificationTaxonomy,
} from "../../ledger/services";

export class GrossProfitMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
    classificationTaxonomy,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
    classificationTaxonomy: ClassificationTaxonomy;
  }): number {
    let grossRevenue = 0;
    let costOfGoodsSold = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (!account.classification) {
        continue;
      }

      if (
        !classificationTaxonomy.hasMembership(
          account.classification,
          ClassificationSemanticGroup.GROSS_PROFIT
        )
      ) {
        continue;
      }

      if (account.type === AccountType.REVENUE) {
        grossRevenue += balance.balance;
      }

      if (account.type === AccountType.EXPENSE) {
        costOfGoodsSold += balance.balance;
      }
    }

    return grossRevenue - costOfGoodsSold;
  }
}
