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
  start_date: "2026-01-05", duration_days: 5, percent_complete: 50, font_size: null, text_color: null, bold: true,
};
const BASELINE_ROW = { id: "baseline_1", created_at: "2026-01-01T00:00:00.000Z" };
const BASELINE_BLOCK_ROW = { baseline_id: "baseline_1", block_task_code: "A1010", baseline_start: "2026-01-05", baseline_finish: "2026-01-09", baseline_duration_days: 5 };
const ASSIGNMENT_ROW = { owner_id: "user_1", id: "assignment_1", block_id: "block_1", resource_id: "resource_1", budgeted_units: 40, actual_units: 20, rate_override: null };
const RESOURCE_ROW = { owner_id: "user_1", id: "resource_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50 };

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    order: vi.fn(() => node), limit: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({
  project = PROJECT_ROW, blocks = [BLOCK_ROW], resources = [RESOURCE_ROW], assignments = [ASSIGNMENT_ROW], expenses = [],
  latestBaseline = BASELINE_ROW, baselineBlocks = [BASELINE_BLOCK_ROW],
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
    schedule_baselines: tableNode({ data: latestBaseline, error: null }),
    schedule_baseline_blocks: tableNode({ data: baselineBlocks, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

function request(query = "") {
  return new Request(`https://test/api/forge/scheduling/p1/evm-dcma${query}`);
}
const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/evm-dcma", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes EVM and DCMA metrics using the most recently captured baseline by default", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request("?asOfDate=2026-01-10"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.baselineId).toBe("baseline_1");
    expect(body.evm.bac).toBeGreaterThan(0);
    expect(body.evm.ev).toBeGreaterThan(0);
    expect(body.dcma).toHaveProperty("logic");
    expect(body.dcma).toHaveProperty("cpli");
    expect(body.dcma).toHaveProperty("criticalPathTest");
  });

  it("uses an explicit baselineId from the query string instead of auto-selecting", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    await GET(request("?baselineId=baseline_explicit"), { params });
    // No auto-select lookup should be needed once an id is supplied explicitly.
    expect(db.nodes.schedule_baselines.select).not.toHaveBeenCalled();
  });

  it("degrades gracefully with zero planned value and a null CPLI when the project has no baseline yet", async () => {
    const db = mockDb({ latestBaseline: null, baselineBlocks: [] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.baselineId).toBeNull();
    expect(body.evm.pv).toBe(0);
    expect(body.dcma.missedTasks.dueCount).toBe(0);
    expect(body.dcma.cpli).toBeNull();
  });

  it("defaults asOfDate to today when not supplied", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(request(), { params });
    const body = await response.json();
    expect(body.asOfDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("404s a non-owner requesting EVM/DCMA on the shared example project", async () => {
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
