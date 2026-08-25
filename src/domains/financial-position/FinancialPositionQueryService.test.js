import { describe, expect, test, vi } from "vitest";

import {
  FinancialPositionQueryService,
} from "./FinancialPositionQueryService";

function createDependencies() {
  return {
    financialAccountRepository: {
      findByOwnerId: vi.fn().mockResolvedValue([
        {
          id: "account-cash",
          name: "Operating Cash",
          type: "depository",
          subtype: "checking",
        },
        {
          id: "account-investment",
          name: "Brokerage",
          type: "investment",
          subtype: "brokerage",
        },
        {
          id: "account-credit",
          name: "Business Credit Card",
          type: "credit",
          subtype: "credit_card",
        },
        {
          id: "account-loan",
          name: "Rental Mortgage",
          type: "loan",
          subtype: "mortgage",
        },
        {
          id: "account-other",
          name: "Tractor",
          type: "other",
          subtype: "equipment",
        },
        {
          id: "account-unbalanced",
          name: "Missing Balance",
          type: "depository",
          subtype: "checking",
        },
      ]),
    },
    accountBalanceRepository: {
      findLatestByOwnerId: vi.fn().mockResolvedValue([
        {
          id: "balance-cash",
          financialAccountId: "account-cash",
          currentBalanceCents: 12500000,
          availableBalanceCents: 12000000,
          asOf: "2026-07-24T00:00:00.000Z",
        },
        {
          id: "balance-investment",
          financialAccountId: "account-investment",
          currentBalanceCents: 30000000,
          availableBalanceCents: null,
          asOf: "2026-07-24T00:00:00.000Z",
        },
        {
          id: "balance-credit",
          financialAccountId: "account-credit",
          currentBalanceCents: 500000,
          availableBalanceCents: null,
          asOf: "2026-07-24T00:00:00.000Z",
        },
        {
          id: "balance-loan",
          financialAccountId: "account-loan",
          currentBalanceCents: 19500000,
          availableBalanceCents: null,
          asOf: "2026-07-24T00:00:00.000Z",
        },
        {
          id: "balance-other",
          financialAccountId: "account-other",
          currentBalanceCents: 999900,
          availableBalanceCents: null,
          asOf: "2026-07-24T00:00:00.000Z",
        },
      ]),
    },
  };
}

describe("FinancialPositionQueryService", () => {
  test("builds an immutable owner-scoped position from canonical repositories", async () => {
    const dependencies = createDependencies();
    const service =
      new FinancialPositionQueryService(dependencies);

    const position =
      await service.buildPosition("owner-1");

    expect(
      dependencies.financialAccountRepository
        .findByOwnerId,
    ).toHaveBeenCalledWith("owner-1");

    expect(
      dependencies.accountBalanceRepository
        .findLatestByOwnerId,
    ).toHaveBeenCalledWith("owner-1");

    expect(position.assets).toEqual([
      {
        id: "account-cash",
        name: "Operating Cash",
        category: "checking",
        account_type: "depository",
        current_value: 125000,
      },
      {
        id: "account-investment",
        name: "Brokerage",
        category: "brokerage",
        account_type: "investment",
        current_value: 300000,
      },
      {
        id: "account-other",
        name: "Tractor",
        category: "equipment",
        account_type: "other",
        current_value: 9999,
      },
    ]);

    expect(position.liabilities).toEqual([
      {
        id: "account-credit",
        name: "Business Credit Card",
        category: "credit_card",
        current_balance: 5000,
      },
      {
        id: "account-loan",
        name: "Rental Mortgage",
        category: "mortgage",
        current_balance: 195000,
      },
    ]);

    expect(position.netWorth).toEqual({
      totalAssets: 434999,
      totalLiabilities: 200000,
      netWorth: 234999,
      debtToAssetRatio: 200000 / 434999,
    });

    expect(position.accountBalances).toHaveLength(5);

    expect(Object.isFrozen(position)).toBe(true);
    expect(Object.isFrozen(position.assets)).toBe(true);
    expect(Object.isFrozen(position.assets[0])).toBe(true);
    expect(Object.isFrozen(position.liabilities)).toBe(true);
    expect(Object.isFrozen(position.accountBalances)).toBe(
      true,
    );
    expect(
      Object.isFrozen(position.accountBalances[0]),
    ).toBe(true);
    expect(Object.isFrozen(position.netWorth)).toBe(true);
    expect(Object.isFrozen(position.metadata)).toBe(true);
  });

  test("includes physical assets and skips accounts without balances", async () => {
    const service =
      new FinancialPositionQueryService(
        createDependencies(),
      );

    const position =
      await service.buildPosition("owner-1");

    expect(
      position.assets.some(
        (asset) => asset.id === "account-unbalanced",
      ),
    ).toBe(false);

    expect(position.assets.some((item) => item.id === "account-other")).toBe(true);
  });

  test("reports canonical account balances without fabricating metrics or insights", async () => {
    const service =
      new FinancialPositionQueryService(
        createDependencies(),
      );

    const position =
      await service.buildPosition("owner-1");

    expect(position.metrics).toBeNull();
    expect(position.insights).toEqual([]);

    expect(position.metadata).toEqual({
      accountBalancesStatus: "repository-backed",
      metricsStatus:
        "unavailable-without-canonical-ledger-position",
      insightsStatus:
        "unavailable-without-financial-metrics",
    });
  });

  test("returns a valid empty position when repositories contain no records", async () => {
    const service =
      new FinancialPositionQueryService({
        financialAccountRepository: {
          findByOwnerId: vi.fn().mockResolvedValue([]),
        },
        accountBalanceRepository: {
          findLatestByOwnerId:
            vi.fn().mockResolvedValue([]),
        },
      });

    const position =
      await service.buildPosition("owner-1");

    expect(position.assets).toEqual([]);
    expect(position.liabilities).toEqual([]);
    expect(position.accountBalances).toEqual([]);

    expect(position.netWorth).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      debtToAssetRatio: 0,
    });
  });

  test("requires an authenticated owner id", async () => {
    const dependencies = createDependencies();
    const service =
      new FinancialPositionQueryService(dependencies);

    await expect(
      service.buildPosition(),
    ).rejects.toThrow(
      "FinancialPositionQueryService requires an owner id.",
    );

    expect(
      dependencies.financialAccountRepository
        .findByOwnerId,
    ).not.toHaveBeenCalled();

    expect(
      dependencies.accountBalanceRepository
        .findLatestByOwnerId,
    ).not.toHaveBeenCalled();
  });

  test("requires all canonical repository dependencies", () => {
    expect(
      () =>
        new FinancialPositionQueryService({
          accountBalanceRepository: {
            findLatestByOwnerId: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialPositionQueryService requires a financial account repository.",
    );

    expect(
      () =>
        new FinancialPositionQueryService({
          financialAccountRepository: {
            findByOwnerId: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialPositionQueryService requires an account balance repository.",
    );
  });
});
