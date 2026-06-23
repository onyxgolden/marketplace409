import { describe, expect, test } from "vitest";
import { NetWorthService } from "../networth.service";

describe("NetWorthService", () => {
  test("calculates total assets, liabilities, net worth, and debt-to-asset ratio", () => {
    const summary = NetWorthService.calculate(
      [
        {
          id: "cash",
          name: "Cash",
          category: "cash",
          value: 100000,
        },
        {
          id: "property",
          name: "Rental Property",
          category: "real_estate",
          value: 300000,
        },
      ],
      [
        {
          id: "mortgage",
          name: "Mortgage",
          category: "real_estate",
          balance: 200000,
        },
      ]
    );

    expect(summary).toEqual({
      totalAssets: 400000,
      totalLiabilities: 200000,
      netWorth: 200000,
      debtToAssetRatio: 0.5,
    });
  });

  test("returns zero debt-to-asset ratio when there are no assets", () => {
    const summary = NetWorthService.calculate(
      [],
      [
        {
          id: "loan",
          name: "Loan",
          category: "debt",
          balance: 50000,
        },
      ]
    );

    expect(summary.debtToAssetRatio).toBe(0);
  });
});
