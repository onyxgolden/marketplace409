import { describe, expect, test } from "vitest";
import { AccountBalance } from "../../AccountBalance";
import { AccountBalanceCollection } from "../../AccountBalanceCollection";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../../sections/ReportSection";
import { TrialBalance } from "../../TrialBalance";
import { TrialBalanceBuilder } from "../TrialBalanceBuilder";

describe("TrialBalanceBuilder", () => {
  test("builds a trial balance from account balances", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100 }),
      new AccountBalance({ accountId: "revenue", balance: -100 }),
    ]);

    const trialBalance = new TrialBalanceBuilder().build(accountBalances);

    expect(trialBalance).toBeInstanceOf(TrialBalance);
    expect(trialBalance.name).toBe("Trial Balance");
    expect(trialBalance.accounts()).toEqual(accountBalances.all());
    expect(trialBalance.lines()).toEqual([
      new ReportLine({ label: "cash", amount: 100 }),
      new ReportLine({ label: "revenue", amount: -100 }),
    ]);
    expect(trialBalance.sections()).toEqual([
      new ReportSection({
        name: "Accounts",
        lines: [
          new ReportLine({ label: "cash", amount: 100 }),
          new ReportLine({ label: "revenue", amount: -100 }),
        ],
      }),
    ]);
  });

  test("requires an AccountBalanceCollection", () => {
    expect(() => new TrialBalanceBuilder().build([])).toThrow(
      "TrialBalanceBuilder requires an AccountBalanceCollection"
    );
  });
});
