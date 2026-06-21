import { describe, expect, test } from "vitest";
import { Account } from "../Account";
import { AccountType } from "../AccountType";
import { ChartOfAccounts } from "../ChartOfAccounts";

function account(id, name = id) {
  return new Account({
    id,
    name,
    type: AccountType.ASSET,
  });
}

describe("ChartOfAccounts hierarchy", () => {
  test("sets a parent relationship immutably", () => {
    const originalChart = new ChartOfAccounts([
      account("1000", "Assets"),
      account("1010", "Cash"),
    ]);

    const updatedChart = originalChart.setParent("1010", "1000");

    expect(originalChart.parentMap.has("1010")).toBe(false);
    expect(originalChart.getParent("1010")).toBe(null);
    expect(updatedChart.parentMap.get("1010")).toBe("1000");
    expect(updatedChart.getParent("1010")).toBe("1000");
  });

  test("gets children derived from parentMap only", () => {
    const chart = new ChartOfAccounts([
      account("1000", "Assets"),
      account("1010", "Cash"),
      account("1020", "Bank"),
    ])
      .setParent("1010", "1000")
      .setParent("1020", "1000");

    const children = chart.getChildren("1000");

    expect(children.map((account) => account.id)).toEqual(["1010", "1020"]);
  });

  test("gets descendants recursively from parentMap only", () => {
    const chart = new ChartOfAccounts([
      account("1000", "Assets"),
      account("1100", "Current Assets"),
      account("1110", "Cash"),
      account("1120", "Bank"),
      account("1200", "Fixed Assets"),
      account("1210", "Equipment"),
    ])
      .setParent("1100", "1000")
      .setParent("1110", "1100")
      .setParent("1120", "1100")
      .setParent("1200", "1000")
      .setParent("1210", "1200");

    const descendants = chart.getDescendants("1000");

    expect(descendants.map((account) => account.id)).toEqual([
      "1100",
      "1110",
      "1120",
      "1200",
      "1210",
    ]);
  });
});
