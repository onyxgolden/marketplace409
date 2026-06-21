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
    expect(originalChart.getParent("1010")).toBe(null);
    expect(updatedChart.parentMap.get("1010")).toBe("1000");
    expect(updatedChart.getParent("1010")).toBe("1000");
  });

  test("gets children derived from parentMap only", () => {
    const parent = new Account({
      id: "1000",
      name: "Assets",
      type: AccountType.ASSET,
    });

    const cash = new Account({
      id: "1010",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const bank = new Account({
      id: "1020",
      name: "Bank",
      type: AccountType.ASSET,
    });

    const chart = new ChartOfAccounts([parent, cash, bank])
      .setParent("1010", "1000")
      .setParent("1020", "1000");

    const children = chart.getChildren("1000");

    expect(children.map((account) => account.id)).toEqual(["1010", "1020"]);
  });
});
