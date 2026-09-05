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

function mockDb({ resources = [], insertError = null } = {}) {
  const nodes = { schedule_resources: tableNode({ data: resources, error: insertError }) };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

function postRequest(body) {
  return new Request("https://test/api/forge/scheduling/resources", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("GET /api/forge/scheduling/resources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the owner's resources, RLS-scoped, no explicit project filter", async () => {
    const rows = [{ id: "resource_1", name: "Framing Crew", resource_type: "labor" }];
    const db = mockDb({ resources: rows });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources).toEqual(rows);
  });
});

describe("POST /api/forge/scheduling/resources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a resource with sane defaults for optional fields", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Framing Crew", resourceType: "labor" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.resourceId).toBe("string");
    expect(db.nodes.schedule_resources.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: "user_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 0, unit_of_measure: null,
    }));
  });

  it("rejects a blank name", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "  ", resourceType: "labor" }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid resourceType", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Bad Resource", resourceType: "role" }));
    expect(response.status).toBe(400);
  });

  it("returns 409 with a clear message on a duplicate resource name", async () => {
    const db = mockDb({ insertError: { code: "23505", message: "duplicate key" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Framing Crew", resourceType: "labor" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already exists");
  });
});
