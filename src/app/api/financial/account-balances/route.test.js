import { beforeEach, describe, expect, it, vi } from "vitest";

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

function buildSuite({ accounts = [account()], balances = [], latestByAccount = null, saveResult = null, saveError = null } = {}) {
  const financialAccountRepository = { findByOwnerId: vi.fn().mockResolvedValue(accounts) };
  const accountBalanceRepository = {
    findLatestByOwnerId: vi.fn().mockResolvedValue(balances),
    findLatestByFinancialAccount: vi.fn().mockResolvedValue(latestByAccount),
    save: saveError
      ? vi.fn().mockRejectedValue(saveError)
      : vi.fn().mockResolvedValue(saveResult || balance()),
  };
  return { financialAccountRepository, accountBalanceRepository };
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
