import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine Project", template_id: "capital",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: "cal_1",
};
function blockRow(id, taskCode, overrides = {}) {
  return {
    owner_id: "user_1", id, task_code: taskCode, schedule_project_id: "p1",
    lane_id: "lane_1", wbs_node_id: null, label: taskCode, category: "eng", block_type: "task",
    start_date: "2026-01-05", duration_days: 7, percent_complete: 0, actual_start: null, actual_finish: null,
    font_size: null, text_color: null, bold: true, constraint_type: null, constraint_date: null, calendar_id: null,
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

function mockDb({ project = PROJECT_ROW, blocks = [blockRow("block_1", "A1010")], dependencies = [] } = {}) {
  const nodes = {
    schedule_projects: tableNode({ data: project, error: null }),
    schedule_calendars: tableNode({ data: [], error: null }),
    schedule_wbs_nodes: tableNode({ data: [], error: null }),
    schedule_blackout_windows: tableNode({ data: [], error: null }),
    schedule_lanes: tableNode({ data: [{ id: "lane_1", schedule_project_id: "p1", name: "Engineering", calendar_id: null }], error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: dependencies, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) } };
}

const params = Promise.resolve({ projectId: "p1" });

describe("GET /api/forge/scheduling/[projectId]/export/excel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a downloadable .xlsx with an Activities sheet containing the project's tasks", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Mine Project.xlsx"');

    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet("Activities");
    expect(worksheet).toBeTruthy();
    expect(worksheet.getRow(1).getCell(1).value).toBe("Task Code");
    expect(worksheet.getRow(2).getCell(1).value).toBe("A1010");
    expect(worksheet.getRow(2).getCell(3).value).toBe("Engineering");
  });

  it("404s for a project the caller doesn't own", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "someone_else" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });
});
