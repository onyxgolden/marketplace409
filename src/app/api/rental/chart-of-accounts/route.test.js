import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(),
}));
vi.mock("@/application/rental/chartOfAccounts", () => ({
  getChartAccounts: vi.fn(),
  getAccountUsageCount: vi.fn(),
  SEED_CODES: new Set(["rental_income", "cam_income"]),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { getChartAccounts, getAccountUsageCount } from "@/application/rental/chartOfAccounts";
import { GET, PATCH, POST } from "./route";

// A supabase chain where every builder returns itself; awaiting the chain
// resolves to `list`, and .single() resolves to `single`. Covers every query
// shape the route uses: select/eq/limit, select/eq/eq/single,
// insert/select/single, update/eq/eq/select/single, select/eq/eq/order/limit.
function chainFor({ list = { data: [], error: null }, single = { data: null, error: null } } = {}) {
  const chain = {};
  for (const method of ["select", "eq", "order", "limit", "insert", "update"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => single);
  chain.then = (resolve) => resolve(list);
  return chain;
}

function authed(client, role = "owner", { rpcResult = { data: { id: "a1", code: "property_repairs", is_active: false }, error: null } } = {}) {
  const rpcCalls = [];
  const rpc = vi.fn(async (name, args) => {
    rpcCalls.push({ name, args });
    return rpcResult;
  });
  const supabaseClient = { ...client, rpc, rpcCalls };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user-1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
  return supabaseClient;
}

const accountA = { id: "a1", code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true, is_system: true };
const accountB = { id: "a2", code: "rental_income", label: "Rental income", account_type: "income", is_active: true, is_system: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/chart-of-accounts", () => {
  it("lists accounts with usage counts", async () => {
    getChartAccounts.mockResolvedValue([accountA, accountB]);
    getAccountUsageCount.mockImplementation(async (_client, _owner, code) => (code === "property_repairs" ? 3 : 0));
    authed({ from: vi.fn(() => chainFor()) });

    const response = await GET(new Request("https://test/api/rental/chart-of-accounts"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0]).toMatchObject({ code: "property_repairs", usage_count: 3 });
    expect(body.accounts[1]).toMatchObject({ code: "rental_income", usage_count: 0 });
    expect(body.transactions).toBeNull();
  });

  it("returns recent postings for ?transactionsFor=, excluding soft-deleted rows", async () => {
    getChartAccounts.mockResolvedValue([accountA]);
    getAccountUsageCount.mockResolvedValue(1);
    const rows = [{ id: "e1", event_date: "2026-09-20", description: "Plumber", amount: 250, transaction_kind: "expense", property_id: "p1" }];
    const chain = chainFor({ list: { data: rows, error: null } });
    authed({ from: vi.fn(() => chain) });

    const response = await GET(new Request("https://test/api/rental/chart-of-accounts?transactionsFor=property_repairs"));
    expect(response.status).toBe(200);
    expect((await response.json()).transactions).toEqual(rows);
    // The drawer is a live view of the account, not the audit trail:
    // soft-deleted transactions must not appear (PR #420 finding 2).
    expect(chain.eq.mock.calls).toContainEqual(["is_deleted", false]);
  });

  it("404s for an unknown account code", async () => {
    getChartAccounts.mockResolvedValue([accountA]);
    authed({ from: vi.fn(() => chainFor()) });

    const response = await GET(new Request("https://test/api/rental/chart-of-accounts?transactionsFor=nope"));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/rental/chart-of-accounts", () => {
  function postRequest(body) {
    return new Request("https://test/api/rental/chart-of-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates a custom account", async () => {
    const created = { id: "c1", code: "landscaping", label: "Landscaping", account_type: "expense", is_active: true, is_system: false };
    authed({ from: vi.fn(() => chainFor({ single: { data: created, error: null } })) });

    const response = await POST(postRequest({ code: "landscaping", label: "Landscaping", account_type: "expense" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.account).toMatchObject({ code: "landscaping", label: "Landscaping", usage_count: 0 });
  });

  it("409s on a duplicate code", async () => {
    authed({ from: vi.fn(() => chainFor({ list: { data: [{ id: "x" }], error: null } })) });

    const response = await POST(postRequest({ code: "landscaping", label: "Landscaping", account_type: "expense" }));
    expect(response.status).toBe(409);
  });

  it("400s on a bad code", async () => {
    authed({ from: vi.fn(() => chainFor()) });

    const response = await POST(postRequest({ code: "Bad Code!", label: "Bad", account_type: "expense" }));
    expect(response.status).toBe(400);
  });

  it("403s for read-only members", async () => {
    authed({ from: vi.fn(() => chainFor()) }, "read_only");

    const response = await POST(postRequest({ code: "landscaping", label: "Landscaping", account_type: "expense" }));
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/rental/chart-of-accounts", () => {
  function patchRequest(body) {
    return new Request("https://test/api/rental/chart-of-accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("renames an account", async () => {
    const renamed = { ...accountA, label: "Repairs & maintenance" };
    authed({ from: vi.fn(() => chainFor({ single: { data: renamed, error: null } })) });
    getAccountUsageCount.mockResolvedValue(3);

    const response = await PATCH(patchRequest({ id: "a1", label: "Repairs & maintenance" }));
    expect(response.status).toBe(200);
    expect((await response.json()).account.label).toBe("Repairs & maintenance");
  });

  it("deactivates an unused account through the atomic RPC", async () => {
    const deactivated = { ...accountA, is_active: false };
    const supabaseClient = authed({ from: vi.fn(() => chainFor({ single: { data: deactivated, error: null } })) });
    getAccountUsageCount.mockResolvedValue(0);

    const response = await PATCH(patchRequest({ id: "a1", is_active: false }));
    expect(response.status).toBe(200);
    expect((await response.json()).account.is_active).toBe(false);
    // The row lock, the usage check, and the write happen atomically inside
    // the RPC, coordinated with concurrent postings via the chart row lock.
    expect(supabaseClient.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseClient.rpc.mock.calls[0][0]).toBe("deactivate_chart_account");
    expect(supabaseClient.rpc.mock.calls[0][1]).toEqual({ p_owner_id: "owner_1", p_account_id: "a1" });
  });

  it("blocks deactivating an account with postings", async () => {
    const client = { from: vi.fn(() => chainFor({ single: { data: accountA, error: null } })) };
    authed(client, "owner", {
      rpcResult: {
        data: null,
        error: { code: "P0002", message: "This account has 3 transactions posted to it. Reassign them to another account before deactivating." },
      },
    });
    getAccountUsageCount.mockResolvedValue(3);

    const response = await PATCH(patchRequest({ id: "a1", is_active: false }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("3 transactions");
    expect(body.error).toContain("Reassign");
  });

  it("404s for another owner's account", async () => {
    authed({ from: vi.fn(() => chainFor({ single: { data: null, error: { message: "no rows" } } })) });

    const response = await PATCH(patchRequest({ id: "nope", label: "X" }));
    expect(response.status).toBe(404);
  });
});
