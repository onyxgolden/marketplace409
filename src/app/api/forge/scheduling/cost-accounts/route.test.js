import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), insert: vi.fn(() => node), order: vi.fn(() => node),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({ costAccounts = [], insertError = null } = {}) {
  const nodes = { schedule_cost_accounts: tableNode({ data: costAccounts, error: insertError }) };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

function postRequest(body) {
  return new Request("https://test/api/forge/scheduling/cost-accounts", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("GET /api/forge/scheduling/cost-accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the owner's cost codes, RLS-scoped, no explicit project filter", async () => {
    const rows = [{ id: "cost_account_1", code: "PO-4521", name: "Steel supplier" }];
    const db = mockDb({ costAccounts: rows });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.costAccounts).toEqual(rows);
  });
});

describe("POST /api/forge/scheduling/cost-accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a cost code", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ code: "PO-4521", name: "Steel supplier" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.costAccountId).toBe("string");
    expect(db.nodes.schedule_cost_accounts.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: "user_1", code: "PO-4521", name: "Steel supplier",
    }));
  });

  it("rejects a blank code", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ code: "  ", name: "Steel supplier" }));
    expect(response.status).toBe(400);
  });

  it("rejects a blank name", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ code: "PO-4521", name: "  " }));
    expect(response.status).toBe(400);
  });

  it("returns 409 with a clear message on a duplicate code", async () => {
    const db = mockDb({ insertError: { code: "23505", message: "duplicate key" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ code: "PO-4521", name: "Steel supplier" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already exists");
  });
});
