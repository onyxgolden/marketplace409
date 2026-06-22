
import { describe, expect, test } from "vitest";
import { AccountBalance } from "../AccountBalance";
import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { BalanceSheet } from "../BalanceSheet";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

describe("BalanceSheet", () => {
  test("creates a balance sheet from account balances", () => {
    const cashBalance = new AccountBalance({
      accountId: "cash",
      balance: 100,
    });

    const balances = new AccountBalanceCollection([cashBalance]);
    const balanceSheet = new BalanceSheet(balances);

    expect(balanceSheet.name).toBe("Balance Sheet");
    expect(balanceSheet.accounts()).toEqual([cashBalance]);
    expect(balanceSheet.totalBalance()).toEqual(100);
  });

  test("exposes backward-compatible report lines", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "cash",
        balance: 100,
      }),
    ]);

    const balanceSheet = new BalanceSheet(balances);
    const lines = balanceSheet.lines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeInstanceOf(ReportLine);
    expect(lines[0].label).toBe("cash");
    expect(lines[0].amount).toEqual (100);
  });

  test("composes a reusable report section", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({
        accountId: "cash",
        balance: 100,
      }),
    ]);

    const balanceSheet = new BalanceSheet(balances);
    const sections = balanceSheet.sections();

    expect(sections).toHaveLength(1);
    expect(sections[0]).toBeInstanceOf(ReportSection);
    expect(sections[0].name).toBe("Balance Sheet");
    expect(sections[0].lines()).toEqual(balanceSheet.lines());
  });
});

