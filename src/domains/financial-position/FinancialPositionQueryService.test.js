import { describe, expect, test, vi } from "vitest";

import {
  FinancialPositionQueryService,
} from "./FinancialPositionQueryService";

function createDependencies() {
  return {
    assetRepository: {
      getAll: vi.fn().mockResolvedValue([
        {
          id: "asset-1",
          name: "Operating Cash",
          category: "cash",
          current_value: 125000,
        },
        {
          id: "asset-2",
          name: "Rental Property",
          category: "real_estate",
          current_value: 300000,
        },
      ]),
    },
    liabilityRepository: {
      getAll: vi.fn().mockResolvedValue([
        {
          id: "liability-1",
          name: "Rental Mortgage",
          category: "mortgage",
          current_balance: 200000,
        },
      ]),
    },
  };
}

describe("FinancialPositionQueryService", () => {
  test("builds an immutable financial position from repository data", async () => {
    const dependencies = createDependencies();
    const service = new FinancialPositionQueryService(dependencies);

    const position = await service.buildPosition();

    expect(dependencies.assetRepository.getAll).toHaveBeenCalledOnce();
    expect(dependencies.liabilityRepository.getAll).toHaveBeenCalledOnce();

    expect(position.netWorth).toEqual({
      totalAssets: 425000,
      totalLiabilities: 200000,
      netWorth: 225000,
      debtToAssetRatio: 200000 / 425000,
    });

    expect(position.assets).toHaveLength(2);
    expect(position.liabilities).toHaveLength(1);

    expect(Object.isFrozen(position)).toBe(true);
    expect(Object.isFrozen(position.assets)).toBe(true);
    expect(Object.isFrozen(position.assets[0])).toBe(true);
    expect(Object.isFrozen(position.liabilities)).toBe(true);
    expect(Object.isFrozen(position.netWorth)).toBe(true);
    expect(Object.isFrozen(position.metadata)).toBe(true);
  });

  test("does not fabricate account balances, metrics, or insights", async () => {
    const service = new FinancialPositionQueryService(
      createDependencies(),
    );

    const position = await service.buildPosition();

    expect(position.accountBalances).toEqual([]);
    expect(position.metrics).toBeNull();
    expect(position.insights).toEqual([]);

    expect(position.metadata).toEqual({
      accountBalancesStatus:
        "unavailable-without-owner-wide-balance-query",
      metricsStatus:
        "unavailable-without-canonical-ledger-position",
      insightsStatus:
        "unavailable-without-financial-metrics",
    });
  });

  test("returns a valid empty position when repositories contain no records", async () => {
    const service = new FinancialPositionQueryService({
      assetRepository: {
        getAll: vi.fn().mockResolvedValue([]),
      },
      liabilityRepository: {
        getAll: vi.fn().mockResolvedValue([]),
      },
    });

    const position = await service.buildPosition();

    expect(position.netWorth).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      debtToAssetRatio: 0,
    });
  });

  test("requires all repository dependencies", () => {
    expect(
      () =>
        new FinancialPositionQueryService({
          liabilityRepository: { getAll: vi.fn() },
        }),
    ).toThrow(
      "FinancialPositionQueryService requires an asset repository.",
    );

    expect(
      () =>
        new FinancialPositionQueryService({
          assetRepository: { getAll: vi.fn() },
        }),
    ).toThrow(
      "FinancialPositionQueryService requires a liability repository.",
    );
  });
});
