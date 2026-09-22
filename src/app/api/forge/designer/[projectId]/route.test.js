import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createEmptyDesign, addWall } from "@/domains/roomDesigner/designerDocument";
import { addLevel, createHomeProject } from "@/domains/roomDesigner/homeProject";
import { DELETE, GET, PUT } from "./route";

function authed(client) {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: client };
}

function singleQuery(row) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn().mockReturnThis();
  const query = { select: vi.fn().mockReturnThis(), eq, maybeSingle };
  return { client: { from: vi.fn(() => query) }, query };
}

const params = { projectId: "design_1" };

describe("GET /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the caller's design", async () => {
    const design = createEmptyDesign("Kitchen");
    const db = singleQuery({
      id: "design_1", owner_id: "user_1", project_name: "Kitchen",
      design, created_at: "a", updated_at: "b",
    });
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project).toMatchObject({ id: "design_1", name: "Kitchen" });
    expect(body.project.design.version).toBe(1);
  });

  it("404s when the design does not belong to the caller", async () => {
    const db = singleQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  function updateClient(rows) {
    const select = vi.fn(async () => ({ data: rows, error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { update: vi.fn().mockReturnThis(), eq, select };
    return { client: { from: vi.fn(() => query) }, query };
  }

  function putRequest(body) {
    return new Request("https://test/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("saves a valid design document", async () => {
    const design = addWall(createEmptyDesign("Kitchen"), { x: 0, y: 0 }, { x: 144, y: 0 });
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
    const record = db.query.update.mock.calls[0][0];
    expect(record.design.walls).toHaveLength(1);
    expect(record.project_name).toBe("Kitchen");
  });

  // HOME DESIGNER slice 2: the persisted `design` column holds the full
  // HomeProject envelope — levels[], currentLevelId, building metadata.
  it("saves a HomeProject envelope with multiple levels", async () => {
    let project = createHomeProject("Two-story");
    project = addLevel(project, "Second floor");
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ name: "Two-story", design: project }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
    const record = db.query.update.mock.calls[0][0];
    expect(record.design.levels).toHaveLength(2);
    expect(record.design.levels[1].name).toBe("Second floor");
    expect(record.design.currentLevelId).toBe(project.levels[0].id);
    expect(record.project_name).toBe("Two-story");
  });

  it("rejects a structurally invalid envelope with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(
      putRequest({ design: { version: 1, levels: [] } }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(db.query.update).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid document with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design: { version: 999 } }), { params });
    expect(response.status).toBe(400);
    expect(db.query.update).not.toHaveBeenCalled();
  });

  it("rejects a missing document with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({}), { params });
    expect(response.status).toBe(400);
  });

  it("404s when the design does not belong to the caller", async () => {
    const design = createEmptyDesign();
    const db = updateClient([]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design }), { params });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the caller's design", async () => {
    const query = {};
    query.delete = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await DELETE(new Request("https://test/", { method: "DELETE" }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
  });
});

describe("workspace authorization on single-project routes", () => {
  beforeEach(() => vi.clearAllMocks());

  function authedAs(userId, effectiveOwnerId, client) {
    return { user: { id: userId }, effectiveOwnerId, supabaseClient: client };
  }

  it("a co-owner's save scopes to the canonical workspace owner id", async () => {
    const design = createEmptyDesign("Shared plan");
    const select = vi.fn(async () => ({ data: [{ id: "design_1" }], error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { update: vi.fn().mockReturnThis(), eq, select };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", client),
    );
    const request = new Request("https://test/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design }),
    });
    const response = await PUT(request, { params });
    expect(response.status).toBe(200);
    // Update is scoped to the workspace owner, which has_workspace_access()
    // authorizes for the co-owner on the DB side.
    expect(eq).toHaveBeenCalledWith("owner_id", "owner1");
    expect(eq).toHaveBeenCalledWith("id", "design_1");
  });

  it("an unrelated user cannot reach another workspace's design", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { select: vi.fn().mockReturnThis(), eq, maybeSingle };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("stranger7", "stranger7", client),
    );
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(404);
    expect(eq).toHaveBeenCalledWith("owner_id", "stranger7");
  });
});
