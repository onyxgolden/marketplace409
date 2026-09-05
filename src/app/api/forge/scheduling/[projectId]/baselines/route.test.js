import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine", template_id: "capital",
  start_date: "2026-01-01", end_date: "2026-12-31", default_calendar_id: null,
  next_id: 2, next_task_number: 1020, client_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const BLOCK_ROW = {
  owner_id: "user_1", id: "p1_b1", task_code: "A1010", schedule_project_id: "p1",
  lane_id: "p1_lane_1", wbs_node_id: null, label: "Task", category: "eng", block_type: "task",
  start_date: "2026-01-01", duration_days: 7, percent_complete: 0, font_size: null, text_color: null, bold: true,
};

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), insert: vi.fn(() => node), update: vi.fn(() => node),
    eq: vi.fn(() => node), in: vi.fn(() => node), order: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({
  project = PROJECT_ROW, blocks = [BLOCK_ROW], dependencies = [], calendars = [], lanes = [], wbsNodes = [], blackoutWindows = [],
  baselinesList = [], baselineInsertError = null, baselineBlocksInsertError = null,
} = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: tableNode({ data: calendars, error: null }),
    schedule_wbs_nodes: tableNode({ data: wbsNodes, error: null }),
    schedule_blackout_windows: tableNode({ data: blackoutWindows, error: null }),
    schedule_lanes: tableNode({ data: lanes, error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: dependencies, error: null }),
    schedule_baselines: tableNode({ data: baselinesList, error: baselineInsertError }),
    schedule_baseline_blocks: tableNode({ data: null, error: baselineBlocksInsertError }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

function postRequest(body) {
  return new Request("https://test/api/forge/scheduling/p1/baselines", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/baselines", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a project's captured baselines, newest first", async () => {
    const rows = [{ id: "baseline_2", name: "Second", created_at: "2026-02-01T00:00:00.000Z" }, { id: "baseline_1", name: "First", created_at: "2026-01-01T00:00:00.000Z" }];
    const db = mockDb({ baselinesList: rows });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.baselines).toEqual([
      { id: "baseline_2", name: "Second", createdAt: "2026-02-01T00:00:00.000Z" },
      { id: "baseline_1", name: "First", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("POST /api/forge/scheduling/[projectId]/baselines", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures a baseline from the project's current CPM-computed state", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Kickoff plan" }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.baselineId).toBe("string");
    expect(db.nodes.schedule_baselines.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "user_1", schedule_project_id: "p1", name: "Kickoff plan" }));
    expect(db.nodes.schedule_baseline_blocks.insert).toHaveBeenCalledWith([expect.objectContaining({ block_task_code: "A1010" })]);
  });

  it("rejects a blank name", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "   " }), { params });
    expect(response.status).toBe(400);
  });

  it("404s a non-owner attempting to capture a baseline on the shared example project", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "example" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Sneaky" }), { params });
    expect(response.status).toBe(404);
    expect(db.nodes.schedule_baselines.insert).not.toHaveBeenCalled();
  });

  it("returns 409 with a clear message on a duplicate baseline name", async () => {
    const db = mockDb({ baselineInsertError: { code: "23505", message: "duplicate key" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Kickoff plan" }), { params });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("already exists");
  });

  it("404s when the project doesn't exist", async () => {
    const db = mockDb({ project: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(postRequest({ name: "Kickoff plan" }), { params });
    expect(response.status).toBe(404);
  });
});
