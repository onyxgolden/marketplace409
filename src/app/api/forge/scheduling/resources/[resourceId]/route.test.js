import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { PATCH, DELETE } from "./route";

function tableNode(resolution) {
  const node = {
    update: vi.fn(() => node), delete: vi.fn(() => node), select: vi.fn(() => node), eq: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
  };
  return node;
}

function mockDb(resolution) {
  const node = tableNode(resolution);
  return { client: { from: vi.fn(() => node) }, node };
}

function patchRequest(body) {
  return new Request("https://test/api/forge/scheduling/resources/resource_1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ resourceId: "resource_1" });

describe("PATCH /api/forge/scheduling/resources/[resourceId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the requested fields", async () => {
    const db = mockDb({ data: { id: "resource_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ stdRate: 75, isActive: false }), { params });
    expect(response.status).toBe(200);
    expect(db.node.update).toHaveBeenCalledWith(expect.objectContaining({ std_rate: 75, is_active: false }));
  });

  it("404s a resource that doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ data: null, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ stdRate: 75 }), { params });
    expect(response.status).toBe(404);
  });

  it("rejects an empty patch", async () => {
    const db = mockDb({ data: { id: "resource_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({}), { params });
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/forge/scheduling/resources/[resourceId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes an unused resource", async () => {
    const db = mockDb({ data: { id: "resource_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(200);
  });

  it("returns a clear 409 when the resource still has assignments (FK restrict)", async () => {
    const db = mockDb({ data: null, error: { code: "23503", message: "foreign key violation" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("assignments");
  });
});
