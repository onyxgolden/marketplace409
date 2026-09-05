import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

function singleNode(resolution) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), maybeSingle: vi.fn(async () => resolution) };
  return node;
}
function listNode(resolution) {
  const node = {
    select: vi.fn(() => node), insert: vi.fn(() => node), eq: vi.fn(() => node),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({ block = { id: "block_1" }, assignments = [], insertError = null } = {}) {
  const nodes = {
    schedule_blocks: singleNode({ data: block, error: null }),
    schedule_resource_assignments: listNode({ data: assignments, error: insertError }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || listNode({ data: null, error: null })) }, nodes };
}

function postRequest(body) {
  return new Request("https://test/api/forge/scheduling/p1/blocks/A1010/assignments", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1", taskCode: "A1010" });

describe("GET /api/forge/scheduling/[projectId]/blocks/[taskCode]/assignments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists assignments for the resolved block", async () => {
    const rows = [{ id: "assignment_1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 40 }];
    const db = mockDb({ assignments: rows });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignments).toEqual(rows);
  });

  it("404s when the block doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ block: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/forge/scheduling/[projectId]/blocks/[taskCode]/assignments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("assigns a resource to the block", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ resourceId: "resource_1", budgetedUnits: 40 }), { params });
    expect(response.status).toBe(200);
    expect(db.nodes.schedule_resource_assignments.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: "user_1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 40, actual_units: 0,
    }));
  });

  it("rejects a missing resourceId", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ budgetedUnits: 40 }), { params });
    expect(response.status).toBe(400);
  });

  it("rejects a negative budgetedUnits", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ resourceId: "resource_1", budgetedUnits: -5 }), { params });
    expect(response.status).toBe(400);
  });

  it("404s when the block doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ block: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ resourceId: "resource_1", budgetedUnits: 40 }), { params });
    expect(response.status).toBe(404);
  });

  it("returns 409 when this resource is already assigned to this activity", async () => {
    const db = mockDb({ insertError: { code: "23505", message: "duplicate key" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ resourceId: "resource_1", budgetedUnits: 40 }), { params });
    expect(response.status).toBe(409);
  });
});
