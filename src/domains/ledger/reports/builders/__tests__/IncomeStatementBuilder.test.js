import { describe, expect, test } from "vitest";
import { AccountBalance } from "../../AccountBalance";
import { AccountBalanceCollection } from "../../AccountBalanceCollection";
import { IncomeStatement } from "../../IncomeStatement";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../../sections/ReportSection";
import { IncomeStatementBuilder } from "../IncomeStatementBuilder";

describe("IncomeStatementBuilder", () => {
  test("builds an income statement from account balances", () => {
    const revenueBalance = new AccountBalance({
      accountId: "revenue",
      balance: 100,
    });

    const accountBalances = new AccountBalanceCollection([revenueBalance]);

    const incomeStatement = new IncomeStatementBuilder().build(
      accountBalances
    );

    expect(incomeStatement).toBeInstanceOf(IncomeStatement);
    expect(incomeStatement.name).toBe("Income Statement");
    expect(incomeStatement.accounts()).toEqual([revenueBalance]);
    expect(incomeStatement.netIncome()).toEqual(100);
  });

  test("builds reusable report lines", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "revenue",
        balance: 100,
      }),
      new AccountBalance({
        accountId: "expense",
        balance: -40,
      }),
    ]);

    const incomeStatement = new IncomeStatementBuilder().build(
      accountBalances
    );

    expect(incomeStatement.lines()).toEqual([
      new ReportLine({ label: "revenue", amount: 100 }),
      new ReportLine({ label: "expense", amount: -40 }),
    ]);
  });

  test("builds a reusable income statement section", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "revenue",
        balance: 100,
      }),
    ]);

    const incomeStatement = new IncomeStatementBuilder().build(
      accountBalances
    );

    expect(incomeStatement.sections()).toHaveLength(1);
    expect(incomeStatement.sections()[0]).toBeInstanceOf(ReportSection);
    expect(incomeStatement.sections()[0].name).toBe("Income Statement");
    expect(incomeStatement.sections()[0].lines()).toEqual(
      incomeStatement.lines()
    );
  });

  test("requires an AccountBalanceCollection", () => {
    expect(() => new IncomeStatementBuilder().build([])).toThrow(
      "IncomeStatementBuilder requires an AccountBalanceCollection"
    );
  });
});
