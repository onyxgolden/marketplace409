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

  test("excludes a retired (inactive) account from Net Worth even though it still has a balance on record", async () => {
    // Review defect: retiring a Financial Asset sets financial_accounts.active = false, but
    // projectAssets/projectLiabilities never checked that flag -- a retired asset (or any closed
    // account) stayed in active Net Worth forever, with no way to actually remove it short of
    // deleting its history outright.
    const dependencies = createDependencies();
    dependencies.financialAccountRepository.findByOwnerId = vi.fn().mockResolvedValue([
      { id: "account-cash", name: "Operating Cash", type: "depository", subtype: "checking", active: true },
      { id: "account-retired-asset", name: "Sold Trailer", type: "other", subtype: "trailer", active: false },
      { id: "account-retired-liability", name: "Paid-off Loan", type: "loan", subtype: "mortgage", active: false },
    ]);
    dependencies.accountBalanceRepository.findLatestByOwnerId = vi.fn().mockResolvedValue([
      { id: "b1", financialAccountId: "account-cash", currentBalanceCents: 100000, availableBalanceCents: null, asOf: "2026-08-01T00:00:00.000Z" },
      { id: "b2", financialAccountId: "account-retired-asset", currentBalanceCents: 500000, availableBalanceCents: null, asOf: "2026-08-01T00:00:00.000Z" },
      { id: "b3", financialAccountId: "account-retired-liability", currentBalanceCents: 200000, availableBalanceCents: null, asOf: "2026-08-01T00:00:00.000Z" },
    ]);

    const service = new FinancialPositionQueryService(dependencies);
    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["account-cash"]);
    expect(position.liabilities).toEqual([]);
    expect(position.netWorth.totalAssets).toBe(1000);
    expect(position.netWorth.totalLiabilities).toBe(0);
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

// --- Account-group balance-authority resolution --------------------------------------------
// Every scenario here uses two SEPARATE financial_accounts rows (as real provider/manual/CSV
// representations of one account always are) plus an explicit group -- never name/balance/
// institution matching. financialAccountGroupRepository is the ONLY new input; when it's absent
// (every test above), behavior is byte-for-byte unchanged.
describe("FinancialPositionQueryService -- account-group balance authority", () => {
  function accountsAndBalances({ stripeAsOf, manualAsOf, plaidAsOf, extra = [] } = {}) {
    const accounts = [
      { id: "acct-stripe", name: "360 Checking", provider: "stripe_financial_connections", type: "depository", subtype: "checking", active: true },
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
      ...extra,
    ];
    const balances = [];
    if (stripeAsOf) balances.push({ id: "b-stripe", financialAccountId: "acct-stripe", currentBalanceCents: 469062, availableBalanceCents: null, asOf: stripeAsOf });
    if (manualAsOf) balances.push({ id: "b-manual", financialAccountId: "acct-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: manualAsOf });
    if (plaidAsOf) balances.push({ id: "b-plaid", financialAccountId: "acct-plaid", currentBalanceCents: 500000, availableBalanceCents: null, asOf: plaidAsOf });
    return { accounts, balances };
  }

  function groupRepository(activeMemberFinancialAccountIds) {
    return {
      findActiveGroupsForOwner: vi.fn().mockResolvedValue([
        { group: { id: "group-1" }, activeMemberFinancialAccountIds },
      ]),
    };
  }

  const FIXED_NOW = new Date("2026-09-09T12:00:00.000Z");

  test("Stripe balance authoritative, retained CSV/manual history: the manual balance is excluded from Net Worth, not deleted", async () => {
    const { accounts, balances } = accountsAndBalances({
      stripeAsOf: "2026-09-09T02:20:26.000Z", // fresh
      manualAsOf: "2026-08-25T00:00:00.000Z", // 15 days stale
    });
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-manual"]),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-stripe"]);
    expect(position.assets[0].current_value).toBe(4690.62);
    expect(position.netWorth.totalAssets).toBe(4690.62);
    // The manual balance is NOT in Net Worth, but IS still fully visible with provenance --
    // "no account or event deleted."
    expect(position.supersededBalances).toEqual([
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", current_value: 3942.33, as_of: "2026-08-25T00:00:00.000Z" },
    ]);
  });

  test("Plaid balance authoritative, retained manual history -- proves the resolution is provider-neutral, not a Stripe-specific branch", async () => {
    const { accounts: baseAccounts, balances: baseBalances } = accountsAndBalances({ manualAsOf: "2026-08-25T00:00:00.000Z" });
    const accounts = [
      ...baseAccounts.filter((a) => a.id !== "acct-stripe"),
      { id: "acct-plaid", name: "Checking", provider: "plaid", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      ...baseBalances,
      { id: "b-plaid", financialAccountId: "acct-plaid", currentBalanceCents: 500000, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-plaid", "acct-manual"]),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-plaid"]);
    expect(position.supersededBalances.map((b) => b.id)).toEqual(["acct-manual"]);
  });

  test("two similarly named, ungrouped accounts are never auto-merged -- both remain fully counted", async () => {
    const accounts = [
      { id: "acct-a", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
      { id: "acct-b", name: "Capital One Checking", provider: "quicken_simplifi_csv", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      { id: "ba", financialAccountId: "acct-a", currentBalanceCents: 100000, availableBalanceCents: null, asOf: "2026-09-01T00:00:00.000Z" },
      { id: "bb", financialAccountId: "acct-b", currentBalanceCents: 200000, availableBalanceCents: null, asOf: "2026-09-01T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      // No group repository call ever returns these two together -- identical names/balances/
      // institution are never enough on their own.
      financialAccountGroupRepository: { findActiveGroupsForOwner: vi.fn().mockResolvedValue([]) },
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id).sort()).toEqual(["acct-a", "acct-b"]);
    expect(position.netWorth.totalAssets).toBe(3000);
    expect(position.supersededBalances).toEqual([]);
  });

  test("disconnected/degraded provider fallback: when every live member is disqualified, authority falls back to the freshest static member, labeled last known / manual", async () => {
    const { accounts, balances } = accountsAndBalances({
      stripeAsOf: "2026-09-01T00:00:00.000Z", // 8 days stale relative to FIXED_NOW -- disqualified
      manualAsOf: "2026-09-08T00:00:00.000Z", // 1 day old
    });
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-manual"]),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-manual"]);
    expect(position.assets[0].degraded).toBe(true);
    expect(position.assets[0].source_label).toBe("last known / manual");
    expect(position.supersededBalances.map((b) => b.id)).toEqual(["acct-stripe"]);
  });

  test("staleness policy: a live member between the 48-hour warning and the 7-day hard limit still wins, but is flagged degraded -- never presented as unambiguously fresh", async () => {
    const { accounts, balances } = accountsAndBalances({
      stripeAsOf: "2026-09-06T00:00:00.000Z", // 3 days old -- within the 7-day limit, past the 48h warning
      manualAsOf: "2026-08-01T00:00:00.000Z", // much older
    });
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-manual"]),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-stripe"]);
    expect(position.assets[0].degraded).toBe(true);
    expect(position.assets[0].source_label).toBe("stale");
  });

  test("two live members: freshest wins, health/freshness only -- Stripe and Plaid have equal standing, neither name is special-cased", async () => {
    const accounts = [
      { id: "acct-stripe", name: "Checking", provider: "stripe_financial_connections", type: "depository", subtype: "checking", active: true },
      { id: "acct-plaid", name: "Checking", provider: "plaid", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      { id: "b1", financialAccountId: "acct-stripe", currentBalanceCents: 100000, availableBalanceCents: null, asOf: "2026-09-08T00:00:00.000Z" },
      { id: "b2", financialAccountId: "acct-plaid", currentBalanceCents: 200000, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" }, // fresher
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-plaid"]),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-plaid"]);
  });

  function connectionRepositoryWithStatuses(statusByConnectionId) {
    return {
      getAll: vi.fn().mockResolvedValue(
        Object.entries(statusByConnectionId).map(([id, status]) => ({ id, status })),
      ),
    };
  }

  test("a recently updated but disconnected Stripe account loses to the manual fallback, regardless of balance age", async () => {
    const accounts = [
      { id: "acct-stripe", name: "360 Checking", provider: "stripe_financial_connections", connectionId: "conn-stripe", type: "depository", subtype: "checking", active: true },
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      // Stripe's balance looks perfectly fresh -- synced moments before the connection was cut off.
      { id: "b-stripe", financialAccountId: "acct-stripe", currentBalanceCents: 469062, availableBalanceCents: null, asOf: "2026-09-09T11:55:00.000Z" },
      { id: "b-manual", financialAccountId: "acct-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-manual"]),
      connectionRepository: connectionRepositoryWithStatuses({ "conn-stripe": "disconnected" }),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-manual"]);
    expect(position.assets[0].degraded).toBe(true);
    expect(position.assets[0].source_label).toBe("last known / manual");
    expect(position.supersededBalances.map((b) => b.id)).toEqual(["acct-stripe"]);
  });

  test("a needs-attention Plaid account cannot win, even against a fresher balance than the manual fallback", async () => {
    const accounts = [
      { id: "acct-plaid", name: "Checking", provider: "plaid", connectionId: "conn-plaid", type: "depository", subtype: "checking", active: true },
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      { id: "b-plaid", financialAccountId: "acct-plaid", currentBalanceCents: 500000, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" },
      { id: "b-manual", financialAccountId: "acct-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-plaid", "acct-manual"]),
      connectionRepository: connectionRepositoryWithStatuses({ "conn-plaid": "needs_attention" }),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-manual"]);
    expect(position.supersededBalances.map((b) => b.id)).toEqual(["acct-plaid"]);
  });

  test("connected/syncing connections remain fully eligible -- health gating only ever disqualifies, never re-qualifies a stale balance", async () => {
    const accounts = [
      { id: "acct-stripe", name: "360 Checking", provider: "stripe_financial_connections", connectionId: "conn-stripe", type: "depository", subtype: "checking", active: true },
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      { id: "b-stripe", financialAccountId: "acct-stripe", currentBalanceCents: 469062, availableBalanceCents: null, asOf: "2026-09-09T02:20:26.000Z" },
      { id: "b-manual", financialAccountId: "acct-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-stripe", "acct-manual"]),
      connectionRepository: connectionRepositoryWithStatuses({ "conn-stripe": "syncing" }),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-stripe"]);
  });

  test("three members (manual + Stripe + Plaid): connection health disqualifies Plaid even though it would otherwise be freshest -- Stripe wins instead", async () => {
    const accounts = [
      { id: "acct-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
      { id: "acct-stripe", name: "360 Checking", provider: "stripe_financial_connections", connectionId: "conn-stripe", type: "depository", subtype: "checking", active: true },
      { id: "acct-plaid", name: "Checking", provider: "plaid", connectionId: "conn-plaid", type: "depository", subtype: "checking", active: true },
    ];
    const balances = [
      { id: "b-manual", financialAccountId: "acct-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
      { id: "b-stripe", financialAccountId: "acct-stripe", currentBalanceCents: 469062, availableBalanceCents: null, asOf: "2026-09-08T00:00:00.000Z" },
      { id: "b-plaid", financialAccountId: "acct-plaid", currentBalanceCents: 500000, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" }, // freshest of all three
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: groupRepository(["acct-manual", "acct-stripe", "acct-plaid"]),
      connectionRepository: connectionRepositoryWithStatuses({ "conn-stripe": "connected", "conn-plaid": "error" }),
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets.map((a) => a.id)).toEqual(["acct-stripe"]);
    expect(position.supersededBalances.map((b) => b.id).sort()).toEqual(["acct-manual", "acct-plaid"]);
  });

  test("multiple legitimate accounts at one institution never collapse into one group -- a checking+savings group and a separate credit card stay fully independent", async () => {
    const accounts = [
      { id: "acct-checking-stripe", name: "360 Checking", provider: "stripe_financial_connections", type: "depository", subtype: "checking", active: true },
      { id: "acct-checking-manual", name: "Capital One Checking", provider: "manual", type: "depository", subtype: "checking", active: true },
      { id: "acct-savings-stripe", name: "360 Savings", provider: "stripe_financial_connections", type: "depository", subtype: "savings", active: true },
      { id: "acct-savings-manual", name: "Capital One Savings", provider: "manual", type: "depository", subtype: "savings", active: true },
      { id: "acct-credit-card", name: "Capital One Business Spark", provider: "quicken_simplifi_csv", type: "credit", subtype: "credit_card", active: true },
    ];
    const balances = [
      { id: "b1", financialAccountId: "acct-checking-stripe", currentBalanceCents: 469062, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" },
      { id: "b2", financialAccountId: "acct-checking-manual", currentBalanceCents: 394233, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
      { id: "b3", financialAccountId: "acct-savings-stripe", currentBalanceCents: 1000000, availableBalanceCents: null, asOf: "2026-09-09T00:00:00.000Z" },
      { id: "b4", financialAccountId: "acct-savings-manual", currentBalanceCents: 950000, availableBalanceCents: null, asOf: "2026-08-25T00:00:00.000Z" },
      { id: "b5", financialAccountId: "acct-credit-card", currentBalanceCents: 50000, availableBalanceCents: null, asOf: "2026-09-01T00:00:00.000Z" },
    ];
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          { group: { id: "group-checking" }, activeMemberFinancialAccountIds: ["acct-checking-stripe", "acct-checking-manual"] },
          { group: { id: "group-savings" }, activeMemberFinancialAccountIds: ["acct-savings-stripe", "acct-savings-manual"] },
        ]),
      },
      now: () => FIXED_NOW,
    });

    const position = await service.buildPosition("owner-1");

    // Both groups resolve independently: Stripe wins each, the credit card (never grouped) is
    // untouched, and every account is accounted for exactly once across assets/liabilities.
    expect(position.assets.map((a) => a.id).sort()).toEqual(["acct-checking-stripe", "acct-savings-stripe"]);
    expect(position.liabilities.map((l) => l.id)).toEqual(["acct-credit-card"]);
    expect(position.supersededBalances.map((b) => b.id).sort()).toEqual(["acct-checking-manual", "acct-savings-manual"]);
  });

  test("an ungrouped account's projected shape is byte-for-byte unchanged -- no degraded/source_label fields at all", async () => {
    const service = new FinancialPositionQueryService({
      financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue([
        { id: "account-cash", name: "Operating Cash", type: "depository", subtype: "checking", active: true },
      ]) },
      accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue([
        { id: "b1", financialAccountId: "account-cash", currentBalanceCents: 100000, availableBalanceCents: null, asOf: "2026-09-01T00:00:00.000Z" },
      ]) },
      financialAccountGroupRepository: { findActiveGroupsForOwner: vi.fn().mockResolvedValue([]) },
    });

    const position = await service.buildPosition("owner-1");

    expect(position.assets).toEqual([
      { id: "account-cash", name: "Operating Cash", category: "checking", account_type: "depository", current_value: 1000 },
    ]);
    expect("degraded" in position.assets[0]).toBe(false);
    expect("source_label" in position.assets[0]).toBe(false);
  });
});
