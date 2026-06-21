import { Money } from "../../../platform/value-objects/Money";

export class AccountRollupService {
  constructor({ chartOfAccounts, balanceCalculator }) {
    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    if (!balanceCalculator) {
      throw new Error("BalanceCalculator is required");
    }

    this.chartOfAccounts = chartOfAccounts;
    this.balanceCalculator = balanceCalculator;

    Object.freeze(this);
  }

  getBalanceByAccount(accountId) {
    const accountIds = [
      accountId,
      ...this.chartOfAccounts
        .getDescendants(accountId)
        .map((account) => account.id),
    ];

    return accountIds.reduce((total, currentAccountId) => {
      return total.add(
        this.balanceCalculator.getBalanceByAccount(currentAccountId),
      );
    }, new Money(0));
  }
}
