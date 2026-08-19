import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

function listQuery(rows) {
  const order = vi.fn(async () => ({ data: rows, error: null }));
  const query = { select: vi.fn().mockReturnThis(), order };
  return { client: { from: vi.fn(() => query) }, query };
}
function insertQuery(row) {
  const single = vi.fn(async () => ({ data: row, error: null }));
  const query = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single };
  return { client: { from: vi.fn(() => query) }, query };
}
function postRequest(body) {
  return new Request("https://test/api/forge/scheduling", {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/forge/scheduling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks rows the caller owns, vs. the shared public example, correctly", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "schedule_project_example", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([
      { id: "p1", name: "Mine", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "a", updatedAt: "b", isOwner: true, isPublic: false },
      { id: "schedule_project_example", name: "Example project", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "a", updatedAt: "b", isOwner: false, isPublic: true },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    const unauthorized = new Response(null, { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response: unauthorized });
    expect((await GET()).status).toBe(401);
  });
});

describe("POST /api/forge/scheduling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new project owned by the caller and returns its id, defaulting to the capital template with no body", async () => {
    const db = insertQuery({ id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest(undefined));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "schedule_project_new" });
    expect(db.query.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "user_1", project_name: "New Project" }));
    const savedBoard = db.query.insert.mock.calls[0][0].board;
    expect(savedBoard.templateId).toBe("capital");
  });

  it("seeds the requested template's lanes and starter chips", async () => {
    const db = insertQuery({ id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ templateId: "home_remodel" }));
    expect(response.status).toBe(200);
    const savedBoard = db.query.insert.mock.calls[0][0].board;
    expect(savedBoard.templateId).toBe("home_remodel");
    expect(savedBoard.lanes.map((l) => l.name)).toContain("Demolition");
  });
});
