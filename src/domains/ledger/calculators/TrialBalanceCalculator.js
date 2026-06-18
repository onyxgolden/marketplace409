import { TrialBalance } from "../reports";

/**
 * TrialBalanceCalculator
 *
 * Creates a TrialBalance report from calculated account balances.
 * It does not read or mutate ledger entries directly.
 */

export class TrialBalanceCalculator {
  constructor(balanceCalculator) {
    if (!balanceCalculator) {
      throw new Error("TrialBalanceCalculator requires a BalanceCalculator");
    }

    this.balanceCalculator = balanceCalculator;

    Object.freeze(this);
  }

  calculate() {
    const accountBalances = this.balanceCalculator.calculateAll();

    return new TrialBalance(accountBalances);
  }
}
