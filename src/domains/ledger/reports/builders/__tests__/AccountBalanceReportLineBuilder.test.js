import { describe, expect, test } from "vitest";
import { AccountBalance } from "../../AccountBalance";
import { AccountBalanceCollection } from "../../AccountBalanceCollection";
import { ReportLine } from "../../ReportLine";
import { AccountBalanceReportLineBuilder } from "../AccountBalanceReportLineBuilder";

describe("AccountBalanceReportLineBuilder", () => {
  test("builds report lines from account balances", () => {
    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100 }),
      new AccountBalance({ accountId: "revenue", balance: -100 }),
    ]);

    const lines = new AccountBalanceReportLineBuilder().build(accountBalances);

    expect(lines).toEqual([
      new ReportLine({ label: "cash", amount: 100 }),
      new ReportLine({ label: "revenue", amount: -100 }),
    ]);
  });

  test("requires an AccountBalanceCollection", () => {
    expect(() => new AccountBalanceReportLineBuilder().build([])).toThrow(
      "AccountBalanceReportLineBuilder requires an AccountBalanceCollection"
    );
  });
});
