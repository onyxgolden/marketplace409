import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine Project", template_id: "capital",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: "cal_1",
};
const CALENDAR_ROW = { id: "cal_1", name: "5-Day Workweek", working_days: [1, 2, 3, 4, 5], schedule_project_id: "p1" };
function blockRow(id, taskCode, overrides = {}) {
  return {
    owner_id: "user_1", id, task_code: taskCode, schedule_project_id: "p1",
    lane_id: "lane_1", wbs_node_id: null, label: taskCode, category: "eng", block_type: "task",
    start_date: "2026-01-05", duration_days: 2, percent_complete: 0, font_size: null, text_color: null, bold: true,
    constraint_type: null, constraint_date: null, calendar_id: null,
    ...overrides,
  };
}

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), order: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}
function calendarsNode(scopedCalendars, extraCalendars = []) {
  let usedIn = false;
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => { usedIn = false; return node; }),
    in: vi.fn(() => { usedIn = true; return node; }),
    then: (resolve, reject) => Promise.resolve({ data: usedIn ? extraCalendars : scopedCalendars, error: null }).then(resolve, reject),
  };
  return node;
}

function mockDb({
  project = PROJECT_ROW, blocks = [blockRow("block_1", "A1010")], scopedCalendars = [CALENDAR_ROW], extraCalendars = [],
  dependencies = [], resources = [], assignments = [], holidays = [],
} = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: calendarsNode(scopedCalendars, extraCalendars),
    schedule_wbs_nodes: tableNode({ data: [], error: null }),
    schedule_blackout_windows: tableNode({ data: [], error: null }),
    schedule_lanes: tableNode({ data: [{ id: "lane_1", schedule_project_id: "p1", calendar_id: null }], error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: dependencies, error: null }),
    schedule_resources: tableNode({ data: resources, error: null }),
    schedule_cost_accounts: tableNode({ data: [], error: null }),
    schedule_resource_assignments: tableNode({ data: assignments, error: null }),
    schedule_expenses: tableNode({ data: [], error: null }),
    schedule_calendar_holidays: tableNode({ data: holidays, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/export/project-xml", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a downloadable Project XML file with the right headers and content", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Mine Project.xml"');
    const body = await response.text();
    expect(body.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true);
    expect(body).toContain("<WBS>A1010</WBS>");
  });

  it("includes a holiday from the fetched calendar_holidays as a calendar Exception", async () => {
    const holidays = [{ calendar_id: "cal_1", holiday_date: "2026-07-04" }];
    const db = mockDb({ holidays });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.text();
    expect(body).toContain("2026-07-04T00:00:00");
  });

  it("fetches and includes a global calendar referenced by the project but not scoped to it", async () => {
    const globalCalendar = { id: "cal_global", name: "Global 7-Day", working_days: [0, 1, 2, 3, 4, 5, 6], schedule_project_id: null };
    const db = mockDb({ project: { ...PROJECT_ROW, default_calendar_id: "cal_global" }, scopedCalendars: [], extraCalendars: [globalCalendar] });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.text();
    expect(body).toContain("<Name>Global 7-Day</Name>");
  });

  it("404s a non-owner requesting an export of the shared example project", async () => {
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
