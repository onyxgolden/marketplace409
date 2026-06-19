import { describe, expect, test } from "vitest";
import { Money } from "@/platform/value-objects";
import { TrialBalanceCalculator } from "../TrialBalanceCalculator";

describe("TrialBalanceCalculator", () => {
  test("requires a BalanceCalculator", () => {
    expect(() => new TrialBalanceCalculator()).toThrow(
      "TrialBalanceCalculator requires a BalanceCalculator"
    );
  });

  test("is immutable", () => {
    const calculator = new TrialBalanceCalculator({
      calculate: () => new Money(0),
    });

    expect(Object.isFrozen(calculator)).toBe(true);
  });
});

test("calculates a trial balance for multiple accounts", () => {
  const balanceCalculator = {
    calculate: (accountId) => {
      const balances = {
        cash: new Money(100),
        revenue: new Money(-100),
      };

      return balances[accountId];
    },
  };

  const calculator = new TrialBalanceCalculator(balanceCalculator);

  const trialBalance = calculator.calculate(["cash", "revenue"]);

  expect(trialBalance).toEqual([
    { accountId: "cash", balance: new Money(100) },
    { accountId: "revenue", balance: new Money(-100) },
  ]);
});

test("returns an immutable trial balance", () => {
  const calculator = new TrialBalanceCalculator({
    calculate: () => new Money(0),
  });

  const trialBalance = calculator.calculate(["cash"]);

  expect(Object.isFrozen(trialBalance)).toBe(true);
  expect(Object.isFrozen(trialBalance[0])).toBe(true);
});

test("calculates total debits and credits", () => {
  const calculator = new TrialBalanceCalculator({
    calculate: (accountId) => {
      const balances = {
        cash: new Money(100),
        revenue: new Money(-100),
      };

      return balances[accountId];
    },
  });

  const totals = calculator.calculateTotals(["cash", "revenue"]);

  expect(totals).toEqual({
    debits: new Money(100),
    credits: new Money(100),
  });
});

test("confirms when trial balance is balanced", () => {
  const calculator = new TrialBalanceCalculator({
    calculate: (accountId) => {
      const balances = {
        cash: new Money(100),
        revenue: new Money(-100),
      };

      return balances[accountId];
    },
  });

  expect(calculator.isBalanced(["cash", "revenue"])).toBe(true);
});

test("confirms when trial balance is not balanced", () => {
  const calculator = new TrialBalanceCalculator({
    calculate: (accountId) => {
      const balances = {
        cash: new Money(100),
        revenue: new Money(-90),
      };

      return balances[accountId];
    },
  });

  expect(calculator.isBalanced(["cash", "revenue"])).toBe(false);
});
