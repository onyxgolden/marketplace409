import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { SnapshotReportFactory } from "../SnapshotReportFactory.js";

class TestSnapshot {
  constructor(entries) {
    this._entries = entries;
  }

  entries() {
    return this._entries;
  }
}

describe("SnapshotReportFactory", () => {
  test("builds balance sheet, income statement, and trial balance from a snapshot", () => {
    const snapshot = new TestSnapshot([
      ["1000", new Money(500)],
      ["4000", new Money(300)],
      ["5000", new Money(100)],
    ]);

    const factory = new SnapshotReportFactory();

    const balanceSheet = factory.buildBalanceSheet(snapshot);
    const incomeStatement = factory.buildIncomeStatement(snapshot);
    const trialBalance = factory.buildTrialBalance(snapshot);

    expect(balanceSheet).toBeDefined();
    expect(incomeStatement).toBeDefined();
    expect(trialBalance).toBeDefined();

    expect(balanceSheet.sections()).toHaveLength(1);
    expect(incomeStatement.sections()).toHaveLength(1);
    expect(trialBalance.sections()).toHaveLength(1);
  });
});
