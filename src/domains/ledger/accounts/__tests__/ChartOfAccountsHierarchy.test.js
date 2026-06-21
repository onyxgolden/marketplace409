import { describe, expect, test } from "vitest";
import { Account } from "../Account";
import { AccountType } from "../AccountType";
import { ChartOfAccounts } from "../ChartOfAccounts";

describe("ChartOfAccounts hierarchy", () => {
  test("sets a parent relationship immutably", () => {
    const parent = new Account({
      id: "1000",
      name: "Assets",
      type: AccountType.ASSET,
    });

    const child = new Account({
      id: "1010",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const originalChart = new ChartOfAccounts([parent, child]);
    const updatedChart = originalChart.setParent("1010", "1000");

    expect(originalChart.parentMap.has("1010")).toBe(false);
    expect(updatedChart.parentMap.get("1010")).toBe("1000");
  });
});
