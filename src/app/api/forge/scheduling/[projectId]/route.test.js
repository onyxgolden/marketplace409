import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, PUT, DELETE } from "./route";

const BOARD = { id: "p1", projectName: "Mine", startDate: "2026-01-01", endDate: "2026-12-31", lanes: [], blocks: [], dependencies: [] };

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine", template_id: "capital",
  start_date: "2026-01-01", end_date: "2026-12-31", default_calendar_id: null,
  next_id: 2, next_task_number: 1020, client_metadata: { weekWidth: 90, categoryNames: {}, starterChips: [], customChips: [] },
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const BLOCK_ROW = {
  owner_id: "user_1", id: "p1_b1", task_code: "A1010", schedule_project_id: "p1",
  lane_id: "p1_lane_1", wbs_node_id: null, label: "Task", category: "eng", block_type: "task",
  start_date: "2026-01-01", duration_days: 7, percent_complete: 0, font_size: null, text_color: null, bold: true,
};

// A single node per table: chainable (select/update/delete/eq/in all return itself) and thenable,
// resolving to whatever this table was configured to resolve regardless of which chain was called
// -- the routes under test never inspect `data` on an update/delete result, only `error`, so one
// fixed resolution per table is enough to exercise every call site against it.
function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), delete: vi.fn(() => node),
    eq: vi.fn(() => node), in: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({
  project = PROJECT_ROW, calendars = [], wbsNodes = [], blackoutWindows = [], lanes = [], blocks = [BLOCK_ROW],
  dependencies = [], rpcError = null, deleteRow = { id: "p1" },
} = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: tableNode({ data: calendars, error: null }),
    schedule_wbs_nodes: tableNode({ data: wbsNodes, error: null }),
    schedule_blackout_windows: tableNode({ data: blackoutWindows, error: null }),
    schedule_lanes: tableNode({ data: lanes, error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: dependencies, error: null }),
    forge_scheduling_projects: tableNode({ data: deleteRow, error: null }),
  };
  const rpc = vi.fn(async () => ({ error: rpcError }));
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })), rpc }, nodes, rpc };
}

function request(body) {
  return new Request("https://test/api/forge/scheduling/p1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconstructs the board from the relational tables (not forge_scheduling_projects.board) and reports ownership", async () => {
    const db = mockDb({ lanes: [{ id: "p1_lane_1", schedule_project_id: "p1", name: "Engineering", color: null, calendar_id: null, sort_order: 0 }] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isOwner).toBe(true);
    expect(body.board.projectName).toBe("Mine");
    expect(body.board.blocks).toEqual([{ id: "b1", taskCode: "A1010", label: "Task", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_1", fontSize: null, textColor: null, bold: true }]);
    expect(db.client.from).toHaveBeenCalledWith("schedule_projects");
    expect(db.client.from).not.toHaveBeenCalledWith("forge_scheduling_projects");
  });

  it("attaches real CPM output keyed by task_code, not the old board-level stand-in", async () => {
    const db = mockDb({ lanes: [{ id: "p1_lane_1", schedule_project_id: "p1", name: "Engineering", color: null, calendar_id: null, sort_order: 0 }] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();
    expect(body.board.cpm.byTaskCode.A1010).toMatchObject({ earlyStart: "2026-01-01", isCritical: expect.any(Boolean) });
    expect(Array.isArray(body.board.cpm.conflicts)).toBe(true);
  });

  it("traces a circular dependency and returns a de-namespaced suggested-fix dependency id, matching board.dependencies' own id shape", async () => {
    const blockA = { ...BLOCK_ROW, id: "p1_b1", task_code: "A1010" };
    const blockB = { ...BLOCK_ROW, id: "p1_b2", task_code: "A1020" };
    const dependencies = [
      { id: "p1_dep1", predecessor_id: "p1_b1", successor_id: "p1_b2", relationship_type: "FS", lag_days: 0 },
      { id: "p1_dep2", predecessor_id: "p1_b2", successor_id: "p1_b1", relationship_type: "SS", lag_days: 0 },
    ];
    const db = mockDb({ lanes: [{ id: "p1_lane_1", schedule_project_id: "p1", name: "Engineering", color: null, calendar_id: null, sort_order: 0 }], blocks: [blockA, blockB], dependencies });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();

    expect(body.board.cpm.cycleDiagnoses).toHaveLength(1);
    const cycle = body.board.cpm.cycleDiagnoses[0];
    expect(cycle.taskCodes).toEqual(["A1010", "A1020", "A1010"]);
    // Suggests the SS link (non-FS is more suspect than FS -- see schedulingCycleDiagnosis.js), and
    // its id is de-namespaced ("dep2", not "p1_dep2") to match every other id in `board`.
    expect(cycle.suggestion.dependency.id).toBe("dep2");
    expect(body.board.dependencies.some((dependency) => dependency.id === "dep2")).toBe(true);
  });

  it("persists the computed early/late/float/critical dates back onto schedule_blocks", async () => {
    const db = mockDb({ lanes: [{ id: "p1_lane_1", schedule_project_id: "p1", name: "Engineering", color: null, calendar_id: null, sort_order: 0 }] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    await GET(new Request("https://test"), { params });
    expect(db.nodes.schedule_blocks.update).toHaveBeenCalledWith(expect.objectContaining({ early_start: expect.any(String), is_critical: expect.any(Boolean) }));
  });

  it("flags a project as read-only when the caller isn't the owner (the shared example)", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "example" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const body = await (await GET(new Request("https://test"), { params })).json();
    expect(body.isOwner).toBe(false);
  });

  it("404s when the project row doesn't exist or isn't visible to the caller", async () => {
    const db = mockDb({ project: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await GET(new Request("https://test"), { params })).status).toBe(404);
  });

  it("skips the CPM run entirely for a board with no Gantt blocks, rather than erroring", async () => {
    const db = mockDb({ blocks: [] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.board.cpm).toEqual({ byTaskCode: {}, criticalTaskCodes: [], conflicts: [], cycleDiagnoses: [] });
  });
});

describe("PUT /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a project the caller owns and syncs its relational mirror", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PUT(request(BOARD), { params });
    expect(response.status).toBe(200);
    expect(db.nodes.forge_scheduling_projects.update).toHaveBeenCalledWith(expect.objectContaining({ project_name: "Mine" }));
    expect(db.rpc).toHaveBeenCalledWith("sync_schedule_project_from_board", { p_owner_id: "user_1", p_project_id: "p1" });
  });

  it("still succeeds even when the relational sync fails -- it's a best-effort mirror, not the save itself", async () => {
    const db = mockDb({ rpcError: { message: "sync failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PUT(request(BOARD), { params });
    expect(response.status).toBe(200);
  });

  it("404s instead of silently succeeding when the caller doesn't own the row (e.g. the shared example)", async () => {
    const db = mockDb({ deleteRow: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PUT(request(BOARD), { params });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/forge/scheduling/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes both the jsonb project row and its relational mirror (schedule_projects has no FK back to forge_scheduling_projects, so nothing cascades automatically)", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await DELETE(new Request("https://test"), { params })).status).toBe(200);
    expect(db.nodes.forge_scheduling_projects.delete).toHaveBeenCalled();
    expect(db.nodes.schedule_projects.delete).toHaveBeenCalled();
  });

  it("404s when the caller doesn't own the row", async () => {
    const db = mockDb({ deleteRow: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    expect((await DELETE(new Request("https://test"), { params })).status).toBe(404);
  });
});
