import { describe, expect, test } from "vitest";
import { AccountBalance } from "../AccountBalance";
import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { IncomeStatement } from "../IncomeStatement";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

describe("IncomeStatement", () => {
  test("creates an income statement from account balances", () => {
    const revenueBalance = new AccountBalance({
      accountId: "revenue",
      balance: 100,
    });

    const balances = new AccountBalanceCollection([revenueBalance]);
    const incomeStatement = new IncomeStatement(balances);

    expect(incomeStatement.name).toBe("Income Statement");
    expect(incomeStatement.accounts()).toEqual([revenueBalance]);
    expect(incomeStatement.netIncome()).toEqual(100);
  });

  test("exposes backward-compatible report lines", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "revenue",
        balance: 100,
      }),
    ]);

    const incomeStatement = new IncomeStatement(balances);
    const lines = incomeStatement.lines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeInstanceOf(ReportLine);
    expect(lines[0].label).toBe("revenue");
    expect(lines[0].amount).toEqual(100);
  });

  test("composes a reusable report section", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "revenue",
        balance: 100,
      }),
    ]);

    const incomeStatement = new IncomeStatement(balances);
    const sections = incomeStatement.sections();

    expect(sections).toHaveLength(1);
    expect(sections[0]).toBeInstanceOf(ReportSection);
    expect(sections[0].name).toBe("Income Statement");
    expect(sections[0].lines()).toEqual(incomeStatement.lines());
  });
});
