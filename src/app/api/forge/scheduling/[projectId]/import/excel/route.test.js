import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { ACTIVITY_COLUMNS } from "@/domains/scheduling/schedulingExcelExport";
import { POST } from "./route";

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
    schedule_lanes: tableNode({ data: [{ id: "p1_lane_1", schedule_project_id: "p1", name: "Engineering", calendar_id: null }], error: null }),
    schedule_blocks: tableNode({ data: blocks, error: null }),
    schedule_dependencies: tableNode({ data: dependencies, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) } };
}

async function workbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Activities");
  worksheet.columns = ACTIVITY_COLUMNS.map((column) => ({ header: column.header, key: column.key }));
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function requestWithBody(buffer) {
  return new Request("https://test", { method: "POST", body: buffer });
}

const params = Promise.resolve({ projectId: "p1" });

describe("POST /api/forge/scheduling/[projectId]/import/excel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses a valid file into patches without writing anything", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const buffer = await workbookBuffer([{ taskCode: "A1010", taskName: "Renamed", lane: "Engineering", durationWeeks: 3, percentComplete: 40 }]);

    const response = await POST(requestWithBody(buffer), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.patches).toEqual([{ taskCode: "A1010", taskName: "Renamed", laneId: "lane_1", durationWeeks: 3, percentComplete: 40 }]);
  });

  it("returns validation errors for an unknown task code, without a 500", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const buffer = await workbookBuffer([{ taskCode: "A9999" }]);

    const response = await POST(requestWithBody(buffer), { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors[0]).toMatch(/does not exist in this project/);
  });

  it("rejects a file with no Task Code column", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Activities");
    worksheet.addRow(["Not A Header"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const response = await POST(requestWithBody(buffer), { params });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/Task Code/);
  });

  it("rejects a non-.xlsx upload cleanly", async () => {
    const db = mockDb();
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await POST(requestWithBody(Buffer.from("not a workbook")), { params });
    expect(response.status).toBe(400);
  });

  it("404s for a project the caller doesn't own", async () => {
    const db = mockDb({ project: { ...PROJECT_ROW, owner_id: "someone_else" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const buffer = await workbookBuffer([{ taskCode: "A1010" }]);
    const response = await POST(requestWithBody(buffer), { params });
    expect(response.status).toBe(404);
  });
});
