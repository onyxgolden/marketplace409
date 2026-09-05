import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

function singleNode(resolution) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), maybeSingle: vi.fn(async () => resolution) };
  return node;
}
function listNode(resolution) {
  const node = { select: vi.fn(() => node), insert: vi.fn(() => node), eq: vi.fn(() => node), then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject) };
  return node;
}
function mockDb({ block = { id: "block_1" }, expenses = [] } = {}) {
  const nodes = { schedule_blocks: singleNode({ data: block, error: null }), schedule_expenses: listNode({ data: expenses, error: null }) };
  return { client: { from: vi.fn((table) => nodes[table] || listNode({ data: null, error: null })) }, nodes };
}
function postRequest(body) {
  return new Request("https://test/api/forge/scheduling/p1/blocks/A1010/expenses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1", taskCode: "A1010" });

describe("GET /api/forge/scheduling/[projectId]/blocks/[taskCode]/expenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists expenses for the resolved block", async () => {
    const rows = [{ id: "expense_1", block_id: "block_1", name: "Permit", budgeted_cost: 500 }];
    const db = mockDb({ expenses: rows });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expenses).toEqual(rows);
  });
});

describe("POST /api/forge/scheduling/[projectId]/blocks/[taskCode]/expenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds an expense, defaulting accrualType to uniform", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Permit", budgetedCost: 500 }), { params });
    expect(response.status).toBe(200);
    expect(db.nodes.schedule_expenses.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: "user_1", block_id: "block_1", name: "Permit", budgeted_cost: 500, actual_cost: 0, accrual_type: "uniform",
    }));
  });

  it("rejects a blank name", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "  ", budgetedCost: 500 }), { params });
    expect(response.status).toBe(400);
  });

  it("rejects a negative budgetedCost", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Permit", budgetedCost: -5 }), { params });
    expect(response.status).toBe(400);
  });

  it("404s when the block doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ block: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Permit", budgetedCost: 500 }), { params });
    expect(response.status).toBe(404);
  });
});
