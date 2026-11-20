import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialPositionQueryService } from "@/domains/financial-position/FinancialPositionQueryService";
import snapshotFixture from "./__fixtures__/snapshot-2026-11-20.json";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET, POST } from "./route";

const account = (overrides = {}) => ({
  id: "acct-1", name: "Business Savings", type: "depository", active: true, ...overrides,
});
const balance = (overrides = {}) => ({
  financialAccountId: "acct-1", currentBalanceCents: 500000, asOf: "2026-08-01", provider: "manual", ...overrides,
});

function buildSuite({ accounts = [account()], balances = [], latestByAccount = null, saveResult = null, saveError = null, groups = [], connections = [], now = () => new Date("2026-11-20T15:56:00.000Z"), positionService = null } = {}) {
  const financialAccountRepository = { findByOwnerId: vi.fn().mockResolvedValue(accounts) };
  const accountBalanceRepository = {
    findLatestByOwnerId: vi.fn().mockResolvedValue(balances),
    findLatestByFinancialAccount: vi.fn().mockResolvedValue(latestByAccount),
    save: saveError
      ? vi.fn().mockRejectedValue(saveError)
      : vi.fn().mockResolvedValue(saveResult || balance()),
  };
  // The route's inclusion verdicts come from the REAL position service, not a
  // mock of it: the same oracle the KPI uses, wired over the same stub repos.
  // Null group/connection repos would make authority a no-op; here the repos
  // are present and return the caller's groups/connections (empty by default),
  // so existing tests keep their ungrouped behavior byte-for-byte.
  const financialAccountGroupRepository = { findActiveGroupsForOwner: vi.fn().mockResolvedValue(groups) };
  const connectionRepository = { getAll: vi.fn().mockResolvedValue(connections) };
  return {
    financialAccountRepository,
    accountBalanceRepository,
    financialAccountGroupRepository,
    connectionRepository,
    financialPositionQueryService: positionService || new FinancialPositionQueryService({
      financialAccountRepository,
      accountBalanceRepository,
      financialAccountGroupRepository,
      connectionRepository,
      now,
    }),
  };
}

function request(body) {
  return new Request("http://localhost/api/financial/account-balances", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("GET /api/financial/account-balances", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists recognized accounts with their latest balance and editability", async () => {
    const suite = buildSuite({
      accounts: [account(), account({ id: "acct-2", name: "Chase Credit Card", type: "credit" }), account({ id: "acct-3", name: "XRP", type: "investment" }), account({ id: "acct-4", name: "Tractor", type: "other" })],
      balances: [balance(), balance({ financialAccountId: "acct-2", provider: "plaid", currentBalanceCents: -20000 })],
    });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts.map((a) => a.id)).toEqual(["acct-1", "acct-2", "acct-3", "acct-4"]);
    expect(body.accounts[0]).toMatchObject({ kind: "asset", latestBalance: { currentBalanceCents: 500000, provider: "manual", editable: true } });
    expect(body.accounts[1]).toMatchObject({ kind: "liability", latestBalance: { provider: "plaid", editable: false } });
    expect(body.accounts[2]).toMatchObject({ kind: "asset", latestBalance: null });
  });

  it("excludes inactive accounts", async () => {
    const suite = buildSuite({ accounts: [account({ active: false })] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await GET();
    const body = await response.json();
    expect(body.accounts).toEqual([]);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await GET()).status).toBe(401);
  });

  it("reconciles the 2026-11-20 snapshot to the cent with the KPI position", async () => {
    const suite = buildSuite({
      accounts: snapshotFixture.accounts,
      balances: snapshotFixture.balances,
      groups: snapshotFixture.groups,
      connections: snapshotFixture.connections,
      now: () => new Date(snapshotFixture.frozenNow),
    });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    // 81 snapshot rows minus the 6 inactive accounts.
    expect(body.accounts).toHaveLength(75);

    const included = body.accounts.filter((a) => a.includedInPosition);
    const sumCents = (rows, signed) => rows.reduce(
      (sum, a) => sum + (signed ? a.latestBalance.currentBalanceCents : Math.abs(a.latestBalance.currentBalanceCents)),
      0,
    );
    const assetsCents = sumCents(included.filter((a) => a.kind === "asset"), true);
    const liabilitiesCents = sumCents(included.filter((a) => a.kind === "liability"), false);
    expect(assetsCents).toBe(snapshotFixture.expected.assetsCents);
    expect(liabilitiesCents).toBe(snapshotFixture.expected.liabilitiesCents);
    expect(assetsCents - liabilitiesCents).toBe(snapshotFixture.expected.netWorthCents);

    // Banking after dedup: the five grouped Stripe members are out, the five
    // CSV winners count once.
    expect(sumCents(included.filter((a) => a.type === "depository"), true)).toBe(snapshotFixture.expected.bankingCents);

    // Standalone type-"other" rows (registry mirrors excluded by exact id)
    // count signed: the two negative rows stay negative.
    const assetMirrorIds = new Set(snapshotFixture.assets.map((a) => a.id));
    const standaloneOther = included.filter((a) => a.type === "other" && !assetMirrorIds.has(a.id));
    expect(standaloneOther).toHaveLength(4);
    expect(sumCents(standaloneOther, true)).toBe(snapshotFixture.expected.standaloneOtherCents);

    // Every group contributes its static winner once; the five live losers are
    // disclosed as superseded, never silently dropped.
    expect(body.position.supersededBalances).toHaveLength(5);
    expect(body.position.supersededBalances.map((entry) => entry.name).sort()).toEqual([
      "Harbor Savings",
      "Ironwood Business Savings",
      "Juniper Checking",
      "Mesquite Business Checking",
      "Sable Business Checking",
    ]);
    const csvWinnerNames = ["Aldergrove Checking", "Copperfield Personal Checking", "Prairie Personal Savings", "Bluebonnet Business Checking", "Ironwood Business Savings"];
    for (const name of csvWinnerNames) {
      expect(included.some((a) => a.name === name)).toBe(true);
    }
    // The CSV winners are static snapshots: degraded, "last known / manual".
    for (const winner of included.filter((a) => csvWinnerNames.includes(a.name))) {
      expect(winner.degraded).toBe(true);
      expect(winner.sourceLabel).toBe("last known / manual");
    }

    // 8 accounts have no balance row at all: Summit Rewards Card + 7 orphan accounts.
    expect(body.position.missingBalances).toHaveLength(8);
    expect(body.position.missingBalances.map((entry) => entry.name)).toContain("Summit Rewards Card");

    // All reads are scoped to the authenticated owner; GET writes nothing.
    expect(suite.financialAccountRepository.findByOwnerId).toHaveBeenCalledWith("owner_1");
    expect(suite.accountBalanceRepository.findLatestByOwnerId).toHaveBeenCalledWith("owner_1");
    expect(suite.accountBalanceRepository.save).not.toHaveBeenCalled();
  });

  it("returns 500 instead of silently counting every row when the position fails", async () => {
    const suite = buildSuite({
      positionService: { buildPosition: vi.fn().mockRejectedValue(new Error("position unavailable")) },
    });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "position unavailable" });
  });

  it("returns 500 when the position service is absent", async () => {
    const suite = buildSuite();
    delete suite.financialPositionQueryService;
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("POST /api/financial/account-balances", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a manual balance for a recognized account with no existing balance", async () => {
    const suite = buildSuite();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 500000, asOf: "2026-08-01" }));
    expect(response.status).toBe(200);
    expect(suite.accountBalanceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ financialAccountId: "acct-1", provider: "manual", connectionId: "manual", currentBalanceCents: 500000, asOf: "2026-08-01" }),
      { ownerId: "owner_1" },
    );
  });

  it("rejects a balance for an account that's already synced from a real provider", async () => {
    const suite = buildSuite({ latestByAccount: balance({ provider: "plaid" }) });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 500000 }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "This account is synced automatically from plaid and can't be edited manually." });
    expect(suite.accountBalanceRepository.save).not.toHaveBeenCalled();
  });

  it("allows overwriting an existing manual balance", async () => {
    const suite = buildSuite({ latestByAccount: balance({ provider: "manual" }) });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 600000 }));
    expect(response.status).toBe(200);
    expect(suite.accountBalanceRepository.save).toHaveBeenCalled();
  });

  it("rejects an account that doesn't belong to this owner", async () => {
    const suite = buildSuite({ accounts: [] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 500000 }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown account type not tracked in net worth", async () => {
    const suite = buildSuite({ accounts: [account({ type: "unsupported" })] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 500000 }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "This account type is not tracked in net worth." });
  });

  it("rejects a non-integer balance", async () => {
    const suite = buildSuite();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ financialAccountId: "acct-1", currentBalanceCents: 12.5 }));
    expect(response.status).toBe(400);
  });

  it("rejects a missing financial account id", async () => {
    const suite = buildSuite();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, getFinancialApplicationSuite: async () => suite });

    const response = await POST(request({ currentBalanceCents: 500000 }));
    expect(response.status).toBe(400);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await POST(request({}))).status).toBe(401);
  });
});
