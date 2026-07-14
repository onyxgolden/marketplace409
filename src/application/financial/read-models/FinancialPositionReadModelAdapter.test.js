import {
  describe,
  expect,
  test,
} from "vitest";

import {
  FinancialPositionReadModelAdapter,
} from "./FinancialPositionReadModelAdapter.js";

function buildPosition(overrides = {}) {
  return Object.freeze({
    assets: Object.freeze(
      overrides.assets || [
        Object.freeze({
          id: "asset-1",
          name: "Operating Cash",
          category: "cash",
          current_value: 125000,
        }),
        Object.freeze({
          id: "asset-2",
          name: "Rental Property",
          category: "real_estate",
          current_value: 300000,
        }),
      ],
    ),
    liabilities: Object.freeze(
      overrides.liabilities || [
        Object.freeze({
          id: "liability-1",
          name: "Rental Mortgage",
          category: "mortgage",
          current_balance: 200000,
        }),
      ],
    ),
    accountBalances: Object.freeze([]),
    netWorth: Object.freeze(
      overrides.netWorth || {
        totalAssets: 425000,
        totalLiabilities: 200000,
        netWorth: 225000,
        debtToAssetRatio: 200000 / 425000,
      },
    ),
    metrics: null,
    insights: Object.freeze([]),
    metadata: Object.freeze({
      accountBalancesStatus:
        "unavailable-without-owner-wide-balance-query",
      metricsStatus:
        "unavailable-without-canonical-ledger-position",
      insightsStatus:
        "unavailable-without-financial-metrics",
      ...(overrides.metadata || {}),
    }),
  });
}

describe("FinancialPositionReadModelAdapter", () => {
  test("requires a financial position", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    expect(() => adapter.buildPosition(null)).toThrow(
      "FinancialPositionReadModelAdapter requires a financial position.",
    );
  });

  test("requires position collections and net worth", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    expect(() =>
      adapter.buildPosition({
        assets: [],
      }),
    ).toThrow(
      "Financial position requires assets and liabilities.",
    );

    expect(() =>
      adapter.buildPosition({
        assets: [],
        liabilities: [],
      }),
    ).toThrow(
      "Financial position requires a net worth summary.",
    );
  });

  test("projects repository-backed financial position KPIs", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    const model = adapter.buildPosition(
      buildPosition(),
    );

    expect(model.kpis).toEqual({
      cash: 125000,
      receivables: null,
      debt: 200000,
      assets: 425000,
      liabilities: 200000,
      equity: 225000,
    });

    expect(model.metadata).toEqual({
      provider: "financial-position",
      snapshotStatus: "repository-backed",
      phase: "16.3",
      balanceSheetStatus:
        "repository-backed-assets-liabilities",
      accountBalancesStatus:
        "unavailable-without-owner-wide-balance-query",
      receivablesStatus:
        "unavailable-without-receivables-source",
      metricsStatus:
        "unavailable-without-canonical-ledger-position",
      insightsStatus:
        "unavailable-without-financial-metrics",
    });
  });

  test("builds the live balance-sheet line contract", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    const model = adapter.buildPosition(
      buildPosition(),
    );

    expect(model.balanceSheetLines).toEqual([
      {
        accountId: "asset:asset-1",
        accountName: "Operating Cash",
        amount: 125000,
      },
      {
        accountId: "asset:asset-2",
        accountName: "Rental Property",
        amount: 300000,
      },
      {
        accountId: "liability:liability-1",
        accountName: "Rental Mortgage",
        amount: 200000,
      },
    ]);
  });

  test("keeps cash unavailable when no cash asset exists", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    const model = adapter.buildPosition(
      buildPosition({
        assets: [
          Object.freeze({
            id: "asset-2",
            name: "Rental Property",
            category: "real_estate",
            current_value: 300000,
          }),
        ],
        netWorth: {
          totalAssets: 300000,
          totalLiabilities: 200000,
          netWorth: 100000,
          debtToAssetRatio: 2 / 3,
        },
      }),
    );

    expect(model.kpis.cash).toBeNull();
    expect(model.kpis.receivables).toBeNull();
  });

  test("returns an immutable position projection", () => {
    const adapter =
      new FinancialPositionReadModelAdapter();

    const model = adapter.buildPosition(
      buildPosition(),
    );

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.kpis)).toBe(true);
    expect(
      Object.isFrozen(model.balanceSheetLines),
    ).toBe(true);
    expect(
      Object.isFrozen(model.balanceSheetLines[0]),
    ).toBe(true);
    expect(Object.isFrozen(model.metadata)).toBe(
      true,
    );
  });
});
