import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildFinancialTilePresentation,
} from "../buildFinancialTilePresentation.js";

describe("buildFinancialTilePresentation", () => {
  it("maps canonical financial read models into tile presentation values", () => {
    const presentation =
      buildFinancialTilePresentation({
        kpiModel: {
          type: "kpi-model",
          kpis: {
            equity: 22500000,
            assets: 42500000,
            liabilities: 20000000,
            cash: 12500000,
            receivables: 2500000,
            profit: 1850000,
            revenue: 7500000,
            expenses: 5650000,
            margin: 0.2467,
          },
        },
        executiveSummary: {
          type: "executive-summary",
          health: {
            label: "Healthy",
            detail:
              "Profit, margin, and cash flow are positive.",
          },
        },
      });

    expect(presentation.health).toEqual({
      label: "Healthy",
      detail:
        "Profit, margin, and cash flow are positive.",
    });

    expect(presentation.kpis).toEqual([
      {
        id: "equity",
        label: "Net Worth / Equity",
        value: "$225,000",
        detail:
          "Assets $425,000 · Liabilities $200,000",
      },
      {
        id: "cash",
        label: "Cash",
        value: "$125,000",
        detail: "Receivables $25,000",
      },
      {
        id: "profit",
        label: "Monthly Profit",
        value: "$18,500",
        detail:
          "Revenue $75,000 · Expenses $56,500",
      },
      {
        id: "margin",
        label: "Profit Margin",
        value: "24.7%",
        detail:
          "Revenue retained after expenses",
      },
    ]);
  });

  it("provides stable loading values for absent read models", () => {
    const presentation =
      buildFinancialTilePresentation();

    expect(presentation.health).toEqual({
      label: "Loading",
      detail:
        "Financial health is being prepared.",
    });

    expect(
      presentation.kpis.map(({ value }) => value),
    ).toEqual([
      "$0",
      "$0",
      "$0",
      "0.0%",
    ]);
  });

  it("returns an immutable presentation model", () => {
    const presentation =
      buildFinancialTilePresentation();

    expect(
      Object.isFrozen(presentation),
    ).toBe(true);

    expect(
      Object.isFrozen(presentation.health),
    ).toBe(true);

    expect(
      Object.isFrozen(presentation.kpis),
    ).toBe(true);

    expect(
      presentation.kpis.every(Object.isFrozen),
    ).toBe(true);
  });
});
