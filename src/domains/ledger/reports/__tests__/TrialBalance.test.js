import { describe, expect, test } from "vitest";
import { TrialBalance } from "../TrialBalance";
import { FinancialReport } from "../FinancialReport";
import { AccountBalance } from "../AccountBalance";
import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { ReportLine } from "../ReportLine";

describe("TrialBalance", () => {
  test("is a financial report", () => {
    const trialBalance = new TrialBalance(
      new AccountBalanceCollection([])
    );

    expect(trialBalance).toBeInstanceOf(FinancialReport);
    expect(trialBalance.name).toBe("Trial Balance");
  });

  test("returns report lines without changing account balance public API", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100 }),
      new AccountBalance({ accountId: "revenue", balance: -100 }),
    ]);

    const trialBalance = new TrialBalance(accountBalances);

    expect(trialBalance.accounts()).toEqual(accountBalances.all());
    expect(trialBalance.lines()).toEqual([
      new ReportLine({ label: "cash", amount: 100 }),
      new ReportLine({ label: "revenue", amount: -100 }),
    ]);
  });
});
