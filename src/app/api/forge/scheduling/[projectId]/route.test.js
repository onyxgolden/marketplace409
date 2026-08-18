import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, PUT, DELETE } from "./route";

const BOARD = { id: "p1", projectName: "Mine", startDate: "2026-01-01", endDate: "2026-12-31", lanes: [], blocks: [], dependencies: [] };

function getQuery(row) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle };
  return { client: { from: vi.fn(() => query) }, query };
}
function mutateQuery(row, { method } = {}) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const query = { update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle };
  return { client: { from: vi.fn(() => query) }, query };
}
function request(body) {
  return new Request("https://test/api/forge/scheduling/p1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the board and whether the caller owns it", async () => {
    const db = getQuery({ owner_id: "user_1", board: BOARD });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isOwner).toBe(true);
    expect(body.board.projectName).toBe("Mine");
  });

  it("flags a project as read-only when the caller isn't the owner (the shared example)", async () => {
    const db = getQuery({ owner_id: "example", board: { ...BOARD, projectName: "Example project" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const body = await (await GET(new Request("https://test"), { params })).json();
    expect(body.isOwner).toBe(false);
  });

  it("404s when the row doesn't exist or isn't visible to the caller", async () => {
    const db = getQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await GET(new Request("https://test"), { params })).status).toBe(404);
  });
});

describe("PUT /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a project the caller owns", async () => {
    const db = mutateQuery({ id: "p1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PUT(request(BOARD), { params });
    expect(response.status).toBe(200);
    expect(db.query.update).toHaveBeenCalledWith(expect.objectContaining({ project_name: "Mine" }));
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
  });

  it("404s instead of silently succeeding when the caller doesn't own the row (e.g. the shared example)", async () => {
    const db = mutateQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PUT(request(BOARD), { params });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a project the caller owns", async () => {
    const db = mutateQuery({ id: "p1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await DELETE(new Request("https://test"), { params })).status).toBe(200);
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
  });

  it("404s when the caller doesn't own the row", async () => {
    const db = mutateQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await DELETE(new Request("https://test"), { params })).status).toBe(404);
  });
});
