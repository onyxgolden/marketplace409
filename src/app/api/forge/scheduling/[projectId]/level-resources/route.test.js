import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine", template_id: "capital",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: null,
};
function blockRow(id, taskCode) {
  return {
    owner_id: "user_1", id, task_code: taskCode, schedule_project_id: "p1",
    lane_id: "lane_1", wbs_node_id: null, label: taskCode, category: "eng", block_type: "task",
    start_date: "2026-01-05", duration_days: 2, percent_complete: 0, font_size: null, text_color: null, bold: true,
    constraint_type: null, constraint_date: null,
  };
}
const RESOURCE_ROW = { owner_id: "user_1", id: "resource_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50 };

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), order: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({
  project = PROJECT_ROW, blocks = [blockRow("block_1", "A1010"), blockRow("block_2", "A1020")],
  resources = [RESOURCE_ROW], assignments = [], expenses = [],
} = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: tableNode({ data: [], error: null }),
    schedule_wbs_nodes: tableNode({ data: [], error: null }),
    schedule_blackout_windows: tableNode({ data: [], error: null }),
    schedule_lanes: tableNode({ data: [{ id: "lane_1", calendar_id: null }], error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: [], error: null }),
    schedule_resources: tableNode({ data: resources, error: null }),
    schedule_cost_accounts: tableNode({ data: [], error: null }),
    schedule_resource_assignments: tableNode({ data: assignments, error: null }),
    schedule_expenses: tableNode({ data: expenses, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

function request(query = "") {
  return new Request(`https://test/api/forge/scheduling/p1/level-resources${query}`);
}
const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/level-resources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delays the lower-priority block off a full resource, and only reports blocks that actually moved", async () => {
    const assignments = [
      { owner_id: "user_1", id: "a1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 16, actual_units: 0, rate_override: null },
      { owner_id: "user_1", id: "a2", block_id: "block_2", resource_id: "resource_1", budgeted_units: 16, actual_units: 0, rate_override: null },
    ];
    const db = mockDb({ assignments });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.leveledBlocks.length).toBeGreaterThan(0);
    expect(body.leveledBlocks.every((block) => block.delay_days !== 0)).toBe(true);
    expect(body.unresolvedConflicts).toEqual([]); // plenty of float in an 11-month project with no other constraints.
  });

  it("passes allowExtension through from the query string", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request("?allowExtension=true"), { params });
    expect(response.status).toBe(200);
  });

  it("404s a non-owner requesting a leveling preview on the shared example project", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "example" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request(), { params });
    expect(response.status).toBe(404);
  });

  it("404s when the project doesn't exist", async () => {
    const db = mockDb({ project: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request(), { params });
    expect(response.status).toBe(404);
  });
});
