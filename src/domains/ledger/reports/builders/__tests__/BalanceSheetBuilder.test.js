import { describe, expect, test } from "vitest";
import { AccountBalance } from "../../AccountBalance";
import { AccountBalanceCollection } from "../../AccountBalanceCollection";
import { BalanceSheet } from "../../BalanceSheet";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../../sections/ReportSection";
import { BalanceSheetBuilder } from "../BalanceSheetBuilder";

describe("BalanceSheetBuilder", () => {
  test("builds a balance sheet from account balances", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100 }),
      new AccountBalance({ accountId: "loan", balance: -100 }),
    ]);

    const balanceSheet = new BalanceSheetBuilder().build(accountBalances);

    expect(balanceSheet).toBeInstanceOf(BalanceSheet);
    expect(balanceSheet.name).toBe("Balance Sheet");
    expect(balanceSheet.accounts()).toEqual(accountBalances.all());
    expect(balanceSheet.lines()).toEqual([
      new ReportLine({ label: "cash", amount: 100 }),
      new ReportLine({ label: "loan", amount: -100 }),
    ]);
    expect(balanceSheet.sections()).toEqual([
      new ReportSection({
        name: "Balance Sheet",
        lines: [
          new ReportLine({ label: "cash", amount: 100 }),
          new ReportLine({ label: "loan", amount: -100 }),
        ],
      }),
    ]);
  });

  test("requires an AccountBalanceCollection", () => {
    expect(() => new BalanceSheetBuilder().build([])).toThrow(
      "BalanceSheetBuilder requires an AccountBalanceCollection"
    );
  });
});
