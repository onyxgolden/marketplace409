import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { PATCH, DELETE } from "./route";

function tableNode(resolution) {
  const node = { update: vi.fn(() => node), delete: vi.fn(() => node), select: vi.fn(() => node), eq: vi.fn(() => node), maybeSingle: vi.fn(async () => resolution) };
  return node;
}
function mockDb(resolution) {
  const node = tableNode(resolution);
  return { client: { from: vi.fn(() => node) }, node };
}
function patchRequest(body) {
  return new Request("https://test/api/forge/scheduling/p1/blocks/A1010/expenses/expense_1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1", taskCode: "A1010", expenseId: "expense_1" });

describe("PATCH /api/forge/scheduling/[projectId]/blocks/[taskCode]/expenses/[expenseId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates budgetedCost/actualCost/accrualType", async () => {
    const db = mockDb({ data: { id: "expense_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ budgetedCost: 600, actualCost: 200, accrualType: "start" }), { params });
    expect(response.status).toBe(200);
    expect(db.node.update).toHaveBeenCalledWith(expect.objectContaining({ budgeted_cost: 600, actual_cost: 200, accrual_type: "start" }));
  });

  it("rejects an invalid accrualType", async () => {
    const db = mockDb({ data: { id: "expense_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ accrualType: "middle" }), { params });
    expect(response.status).toBe(400);
  });

  it("404s an expense that doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ data: null, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ budgetedCost: 600 }), { params });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/forge/scheduling/[projectId]/blocks/[taskCode]/expenses/[expenseId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the expense", async () => {
    const db = mockDb({ data: { id: "expense_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(200);
  });
});
