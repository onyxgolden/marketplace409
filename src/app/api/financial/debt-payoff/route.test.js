import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET } from "./route";

const account = (overrides = {}) => ({
  id: "acct-1",
  name: "Chase Sapphire",
  type: "credit",
  active: true,
  ...overrides,
});
const balanceRow = (overrides = {}) => ({
  financialAccountId: "acct-1",
  currentBalanceCents: -250000,
  ...overrides,
});

// Minimal supabase query-builder stub: each chained call returns the builder,
// terminal calls resolve the canned result.
function queryBuilder(result = { data: [], error: null }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function buildAuth({ accounts = [account()], balances = [balanceRow()], terms = [], preference = null } = {}) {
  const termsBuilder = queryBuilder({ data: terms, error: null });
  const prefBuilder = queryBuilder(
    preference === null ? { data: null, error: null } : { data: { enabled: preference }, error: null },
  );
  const supabaseClient = {
    from: vi.fn((table) => (table === "debt_terms" ? termsBuilder : prefBuilder)),
  };
  const suite = {
    financialAccountRepository: { findByOwnerId: vi.fn().mockResolvedValue(accounts) },
    accountBalanceRepository: { findLatestByOwnerId: vi.fn().mockResolvedValue(balances) },
  };
  mocks.authenticate.mockResolvedValue({
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
    getFinancialApplicationSuite: async () => suite,
  });
  return { supabaseClient, suite };
}

function get(url = "http://localhost/api/financial/debt-payoff?monthlySurplus=500") {
  return new Request(url);
}

describe("GET /api/financial/debt-payoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the three-strategy comparison with terms applied", async () => {
    buildAuth({
      terms: [{ financial_account_id: "acct-1", apr: 24.99, minimum_payment: 75, tax_deductible: false }],
    });
    const response = await GET(get());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.eligible).toHaveLength(1);
    expect(body.data.eligible[0]).toMatchObject({ id: "acct-1", balance: 2500, apr: 24.99 });
    expect(body.data.needsTerms).toEqual([]);
    expect(Object.keys(body.data.strategies)).toEqual(["avalanche", "snowball", "minimums"]);
    expect(body.data.interestSavedVsMinimums.avalanche).toBeGreaterThan(0);
    expect(body.data.suggestionsEnabled).toBe(true);
  });

  it("lists debts without terms as needsTerms and excludes them from the simulation", async () => {
    buildAuth({ terms: [] });
    const response = await GET(get());
    const body = await response.json();
    expect(body.data.eligible).toEqual([]);
    expect(body.data.needsTerms).toHaveLength(1);
    expect(body.data.needsTerms[0]).toMatchObject({ id: "acct-1", missingApr: true, missingMinimum: true });
    expect(body.data.topMove).toBeNull();
  });

  it("surfaces the top move when the preference is on or absent (default ON)", async () => {
    for (const preference of [true, null]) {
      buildAuth({
        terms: [{ financial_account_id: "acct-1", apr: 24.99, minimum_payment: 75, tax_deductible: false }],
        preference,
      });
      const body = await (await GET(get())).json();
      expect(body.data.suggestionsEnabled).toBe(true);
      expect(body.data.topMove).toMatchObject({ debtId: "acct-1", extraPerMonth: 500 });
    }
  });

  it("suppresses the top move entirely when the owner opts out", async () => {
    buildAuth({
      terms: [{ financial_account_id: "acct-1", apr: 24.99, minimum_payment: 75, tax_deductible: false }],
      preference: false,
    });
    const body = await (await GET(get())).json();
    expect(body.data.suggestionsEnabled).toBe(false);
    expect(body.data.topMove).toBeNull();
    // The comparison itself is still computed -- only the proactive hook is silenced.
    expect(body.data.strategies.avalanche.totalInterest).toBeGreaterThanOrEqual(0);
  });

  it("only counts credit and loan accounts with a positive owed balance", async () => {
    buildAuth({
      accounts: [
        account({ id: "a1", type: "credit" }),
        account({ id: "a2", type: "loan", name: "Mortgage" }),
        account({ id: "a3", type: "depository", name: "Checking" }),
        account({ id: "a4", type: "credit", active: false, name: "Closed card" }),
      ],
      balances: [
        balanceRow({ financialAccountId: "a1" }),
        balanceRow({ financialAccountId: "a2", currentBalanceCents: -17515818 }),
        balanceRow({ financialAccountId: "a3", currentBalanceCents: 500000 }),
      ],
      terms: [],
    });
    const body = await (await GET(get())).json();
    expect(body.data.needsTerms.map((d) => d.id).sort()).toEqual(["a1", "a2"]);
    expect(body.data.needsTerms.find((d) => d.id === "a2").balance).toBe(175158.18);
  });

  it("rejects invalid query params", async () => {
    buildAuth();
    expect((await GET(get("http://localhost/api/financial/debt-payoff?monthlySurplus=-5"))).status).toBe(400);
    expect((await GET(get("http://localhost/api/financial/debt-payoff?taxRate=2"))).status).toBe(400);
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await GET(get())).status).toBe(401);
  });
});
