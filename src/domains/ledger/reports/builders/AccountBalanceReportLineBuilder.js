import { AccountBalanceCollection } from "../AccountBalanceCollection.js";
import { ReportLine } from "../ReportLine.js";

/**
 * AccountBalanceReportLineBuilder
 *
 * Converts calculated account balances into presentation-ready report lines.
 * This builder does not calculate accounting.
 */

export class AccountBalanceReportLineBuilder {
  build(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "AccountBalanceReportLineBuilder requires an AccountBalanceCollection"
      );
    }

    return accountBalances.all().map(
      (accountBalance) =>
        new ReportLine({
          label: accountBalance.accountId,
          amount: accountBalance.balance,
        })
    );
  }
}
