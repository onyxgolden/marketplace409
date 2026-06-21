import { Money } from "@/platform/value-objects";

export class TrialBalanceCalculator {
  constructor(balanceCalculator) {
    if (!balanceCalculator) {
      throw new Error("TrialBalanceCalculator requires a BalanceCalculator");
    }

    this.balanceCalculator = balanceCalculator;
    Object.freeze(this);
  }

  calculate(accountIds = []) {
    const trialBalance = accountIds.map((accountId) =>
      Object.freeze({
        accountId,
        balance: this.balanceCalculator.getBalanceByAccount(accountId),
      }),
    );

    return Object.freeze(trialBalance);
  }

  calculateTotals(accountIds = []) {
    const trialBalance = this.calculate(accountIds);

    const totals = trialBalance.reduce(
      (runningTotals, line) => {
        if (line.balance.amount >= 0) {
          return {
            debits: new Money(runningTotals.debits.amount + line.balance.amount),
            credits: runningTotals.credits,
          };
        }

        return {
          debits: runningTotals.debits,
          credits: new Money(
            runningTotals.credits.amount + Math.abs(line.balance.amount),
          ),
        };
      },
      {
        debits: new Money(0),
        credits: new Money(0),
      },
    );

    return Object.freeze(totals);
  }

  isBalanced(accountIds = []) {
    const totals = this.calculateTotals(accountIds);

    return totals.debits.amount === totals.credits.amount;
  }
}
