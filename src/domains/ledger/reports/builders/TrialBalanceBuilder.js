import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";
import { TrialBalance } from "../TrialBalance";

/**
 * TrialBalanceBuilder
 *
 * Builds an immutable TrialBalance report from calculated account balances.
 * Builders construct report presentation objects.
 * Reports represent the result and do not perform accounting calculations.
 */

export class TrialBalanceBuilder {
  build(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "TrialBalanceBuilder requires an AccountBalanceCollection"
      );
    }

    const lines = accountBalances.all().map(
      (accountBalance) =>
        new ReportLine({
          label: accountBalance.accountId,
          amount: accountBalance.balance,
        })
    );

    const sections = [
      new ReportSection({
        name: "Accounts",
        lines,
      }),
    ];

    return new TrialBalance(accountBalances, { lines, sections });
  }
}
