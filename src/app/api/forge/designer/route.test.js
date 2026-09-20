import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

function listQuery(rows) {
  const order = vi.fn(async () => ({ data: rows, error: null }));
  const eq = vi.fn().mockReturnThis();
  const query = { select: vi.fn().mockReturnThis(), eq, order };
  return { client: { from: vi.fn(() => query) }, query };
}

function authed(client) {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: client };
}

describe("GET /api/forge/designer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the caller's designs newest-first", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      projects: [{ id: "d1", name: "Kitchen", createdAt: "a", updatedAt: "b" }],
    });
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
  });

  it("returns 500 when the database fails", async () => {
    const order = vi.fn(async () => ({ data: null, error: new Error("db down") }));
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to load room designs." });
  });
});

describe("POST /api/forge/designer", () => {
  beforeEach(() => vi.clearAllMocks());

  function insertClient() {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const query = { insert };
    return { client: { from: vi.fn(() => query) }, insert };
  }

  it("creates a blank design owned by the caller", async () => {
    const db = insertClient();
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Master bath" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe("string");
    const record = db.insert.mock.calls[0][0];
    expect(record.owner_id).toBe("user_1");
    expect(record.project_name).toBe("Master bath");
    expect(record.design.version).toBe(1);
    expect(record.design.walls).toEqual([]);
  });

  it("falls back to 'Untitled design' with no name", async () => {
    const db = insertClient();
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    await POST(request);
    expect(db.insert.mock.calls[0][0].project_name).toBe("Untitled design");
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    const request = new Request("https://test/api/forge/designer", { method: "POST" });
    expect((await POST(request)).status).toBe(401);
  });
});
