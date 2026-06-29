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

    return accountBalances.all().map((accountBalance) => {
      const accountId = accountBalance.accountId;

      // trace data (builder-level only, not attached to ReportLine)
      this._ensureTrace(accountId, accountBalance);

      return new ReportLine({
        label: accountId,
        amount: accountBalance.balance,
      });
    });
  }

  _ensureTrace(accountId, accountBalance) {
    if (!this.traceMap) {
      this.traceMap = new Map();
    }

    if (!this.traceMap.has(accountId)) {
      this.traceMap.set(accountId, {
        journalEntryIds: accountBalance.metadata?.journalEntryIds ?? [],
        financialEventIds: accountBalance.metadata?.financialEventIds ?? [],
      });
    }
  }
}
