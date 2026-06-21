import { describe, expect, test } from "vitest";
import { TrialBalance } from "../TrialBalance";
import { AccountBalance } from "../AccountBalance";
import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { ReportLine } from "../ReportLine";

describe("TrialBalance", () => {
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
