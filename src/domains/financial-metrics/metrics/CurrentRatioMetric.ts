import { ClassificationSemanticGroup } from "../../ledger/services";
import type { ClassificationTaxonomy } from "../../ledger/services";
import type { ChartOfAccounts } from "../../ledger/accounts";
import type { AccountBalanceCollection } from "../../ledger/reports";

export class CurrentRatioMetric {
  static calculate({
    accountBalances,
    chartOfAccounts,
    classificationTaxonomy,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
    classificationTaxonomy: ClassificationTaxonomy;
  }): number {
    let currentAssets = 0;
    let currentLiabilities = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      if (!account.classification) {
        continue;
      }

      if (
        classificationTaxonomy.hasMembership(
          account.classification,
          ClassificationSemanticGroup.CURRENT_ASSET
        )
      ) {
        currentAssets += balance.balance;
      }

      if (
        classificationTaxonomy.hasMembership(
          account.classification,
          ClassificationSemanticGroup.CURRENT_LIABILITY
        )
      ) {
        currentLiabilities += balance.balance;
      }
    }

    return currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;
  }
}
