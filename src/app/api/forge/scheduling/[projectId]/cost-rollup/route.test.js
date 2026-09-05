import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine", template_id: "capital",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: null,
};
const BLOCK_ROW = {
  owner_id: "user_1", id: "block_1", task_code: "A1010", schedule_project_id: "p1",
  lane_id: "lane_1", wbs_node_id: null, label: "Task", category: "eng", block_type: "task",
  start_date: "2026-01-05", duration_days: 5, percent_complete: 0, font_size: null, text_color: null, bold: true,
};
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
  project = PROJECT_ROW, blocks = [BLOCK_ROW], resources = [RESOURCE_ROW], costAccounts = [],
  assignments = [], expenses = [],
} = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: tableNode({ data: [], error: null }),
    schedule_wbs_nodes: tableNode({ data: [], error: null }),
    schedule_blackout_windows: tableNode({ data: [], error: null }),
    schedule_lanes: tableNode({ data: [], error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: [], error: null }),
    schedule_resources: tableNode({ data: resources, error: null }),
    schedule_cost_accounts: tableNode({ data: costAccounts, error: null }),
    schedule_resource_assignments: tableNode({ data: assignments, error: null }),
    schedule_expenses: tableNode({ data: expenses, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/cost-rollup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rolls up budgeted/actual cost across resource assignments and expenses", async () => {
    const assignments = [{ owner_id: "user_1", id: "assignment_1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 40, actual_units: 10, rate_override: null }];
    const expenses = [{ owner_id: "user_1", id: "expense_1", block_id: "block_1", budgeted_cost: 500, actual_cost: 100 }];
    const db = mockDb({ assignments, expenses });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });

    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project).toEqual({ budgeted_cost: 2500, actual_cost: 600, remaining_cost: 1900 });
    expect(body.byBlock).toEqual([{ block_id: "block_1", task_code: "A1010", budgeted_cost: 2500, actual_cost: 600, remaining_cost: 1900 }]);
  });

  it("flags an over-allocated resource", async () => {
    const overloadedBlock = { ...BLOCK_ROW, id: "block_2", task_code: "A1020" };
    const assignments = [
      { owner_id: "user_1", id: "assignment_1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 40, actual_units: 0, rate_override: null },
      { owner_id: "user_1", id: "assignment_2", block_id: "block_2", resource_id: "resource_1", budgeted_units: 40, actual_units: 0, rate_override: null },
    ];
    const db = mockDb({ blocks: [BLOCK_ROW, overloadedBlock], assignments });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });

    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();
    expect(body.overallocations.length).toBeGreaterThan(0);
    expect(body.overallocations[0]).toMatchObject({ resource_id: "resource_1" });
  });

  it("returns zeroed cost data for a project with no resources assigned", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();
    expect(body.project).toEqual({ budgeted_cost: 0, actual_cost: 0, remaining_cost: 0 });
    expect(body.overallocations).toEqual([]);
  });

  it("404s a non-owner requesting cost data on the shared example project", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "example" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });

  it("404s when the project doesn't exist", async () => {
    const db = mockDb({ project: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });
});
