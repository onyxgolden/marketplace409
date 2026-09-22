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
    // HOME DESIGNER slice 2: new projects are a one-level HomeProject
    // envelope, not a bare room-designer document.
    expect(Array.isArray(record.design.levels)).toBe(true);
    expect(record.design.levels).toHaveLength(1);
    expect(record.design.levels[0].design.walls).toEqual([]);
    expect(record.design.currentLevelId).toBe(record.design.levels[0].id);
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

describe("workspace authorization (primary owner vs co-owner vs unrelated user)", () => {
  beforeEach(() => vi.clearAllMocks());

  function authedAs(userId, effectiveOwnerId, client) {
    return { user: { id: userId }, effectiveOwnerId, supabaseClient: client };
  }

  it("a co-owner lists designs under the canonical workspace owner id", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", db.client),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    // Queries scope to the effective owner, matching resolve_effective_owner_id()
    // on the DB side; has_workspace_access() permits the co-owner's read.
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "owner1");
  });

  it("a co-owner creates designs under the canonical workspace owner id", async () => {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const client = { from: vi.fn(() => ({ insert })) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", client),
    );
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shared plan" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    // Rows are written under the workspace owner (not the co-owner's own id),
    // exactly what has_workspace_access() authorizes on the with-check side.
    expect(insert.mock.calls[0][0].owner_id).toBe("owner1");
  });

  it("an unrelated user only ever sees their own workspace", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("stranger7", "stranger7", db.client),
    );
    await GET();
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "stranger7");
  });
});
