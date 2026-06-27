import { AccountType } from "../../ledger/accounts";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";
import {
  ClassificationSemanticGroup,
  type ClassificationTaxonomy,
} from "../../ledger/services";

export class QuickRatioMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
    classificationTaxonomy,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
    classificationTaxonomy: ClassificationTaxonomy;
  }): number {
    let quickAssets = 0;
    let quickLiabilities = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (!account.classification) {
        continue;
      }

      if (
        !classificationTaxonomy.hasMembership(
          account.classification,
          ClassificationSemanticGroup.QUICK_RATIO
        )
      ) {
        continue;
      }

      if (account.type === AccountType.ASSET) {
        quickAssets += balance.balance;
      }

      if (account.type === AccountType.LIABILITY) {
        quickLiabilities += balance.balance;
      }
    }

    return quickLiabilities > 0 ? quickAssets / quickLiabilities : 0;
  }
}
