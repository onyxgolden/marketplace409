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
            equity: 225000,
            assets: 425000,
            liabilities: 200000,
            cash: 125000,
            receivables: 2500,
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
        detail: "Receivables $2,500",
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

  it("does not divide dollar-denominated position KPIs by 100", () => {
    // Regression: the position adapter hands back dollars; the tile divided them as if they
    // were cents, rendering a $4.17M net worth as $41,716.
    const presentation =
      buildFinancialTilePresentation({
        kpiModel: {
          type: "kpi-model",
          kpis: { equity: 4171641.18, assets: 4244014.07, liabilities: 72372.89 },
        },
      });

    expect(presentation.kpis[0].value).toBe(
      "$4,171,641",
    );
    expect(presentation.kpis[0].detail).toBe(
      "Assets $4,244,014 · Liabilities $72,373",
    );
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
