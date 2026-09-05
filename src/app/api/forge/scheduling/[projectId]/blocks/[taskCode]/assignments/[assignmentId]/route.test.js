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
  return new Request("https://test/api/forge/scheduling/p1/blocks/A1010/assignments/assignment_1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1", taskCode: "A1010", assignmentId: "assignment_1" });

describe("PATCH /api/forge/scheduling/[projectId]/blocks/[taskCode]/assignments/[assignmentId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates budgetedUnits/actualUnits/rateOverride", async () => {
    const db = mockDb({ data: { id: "assignment_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ budgetedUnits: 60, actualUnits: 10, rateOverride: 90 }), { params });
    expect(response.status).toBe(200);
    expect(db.node.update).toHaveBeenCalledWith(expect.objectContaining({ budgeted_units: 60, actual_units: 10, rate_override: 90 }));
  });

  it("rejects a negative actualUnits", async () => {
    const db = mockDb({ data: { id: "assignment_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ actualUnits: -1 }), { params });
    expect(response.status).toBe(400);
  });

  it("404s an assignment that doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ data: null, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ budgetedUnits: 60 }), { params });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/forge/scheduling/[projectId]/blocks/[taskCode]/assignments/[assignmentId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the assignment", async () => {
    const db = mockDb({ data: { id: "assignment_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(200);
  });
});
