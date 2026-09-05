import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET } from "./route";

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), not: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockDb({ baselineBlocks = [], currentBlocks = [], baselineRow = { id: "baseline_1" } } = {}) {
  const nodes = {
    schedule_baseline_blocks: tableNode({ data: baselineBlocks, error: null }),
    schedule_baselines: tableNode({ data: baselineRow, error: null }),
    schedule_blocks: tableNode({ data: currentBlocks, error: null }),
  };
  return { client: { from: vi.fn((table) => nodes[table] || tableNode({ data: null, error: null })) }, nodes };
}

const params = Promise.resolve({ projectId: "p1", baselineId: "baseline_1" });

describe("GET /api/forge/scheduling/[projectId]/baselines/[baselineId]/variance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a slip when the current early_finish is later than the baseline", async () => {
    const db = mockDb({
      baselineBlocks: [{ owner_id: "user_1", id: "baseline_1_A1010", baseline_id: "baseline_1", block_task_code: "A1010", label: "Task", block_type: "task", baseline_start: "2026-01-01", baseline_finish: "2026-01-07", baseline_duration_days: 7, percent_complete: 0, total_float_days: 0, is_critical: true }],
      currentBlocks: [{ owner_id: "user_1", id: "p1_b1", task_code: "A1010", schedule_project_id: "p1", lane_id: "p1_lane_1", label: "Task", early_start: "2026-01-01", early_finish: "2026-01-10", actual_start: null, actual_finish: null }],
    });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.compared).toEqual([expect.objectContaining({ taskCode: "A1010", finishVarianceDays: 3 })]);
    expect(body.rollup.projectFinishVarianceDays).toBe(3);
  });

  it("prefers actual_finish over the CPM-projected early_finish when both are present", async () => {
    const db = mockDb({
      baselineBlocks: [{ owner_id: "user_1", id: "baseline_1_A1010", baseline_id: "baseline_1", block_task_code: "A1010", label: "Task", block_type: "task", baseline_start: "2026-01-01", baseline_finish: "2026-01-07", baseline_duration_days: 7, percent_complete: 0, total_float_days: 0, is_critical: true }],
      currentBlocks: [{ owner_id: "user_1", id: "p1_b1", task_code: "A1010", schedule_project_id: "p1", lane_id: "p1_lane_1", label: "Task", early_start: "2026-01-01", early_finish: "2026-01-07", actual_start: "2026-01-01", actual_finish: "2026-01-12" }],
    });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();
    expect(body.compared[0]).toMatchObject({ finishVarianceDays: 5, usedActualFinish: true });
  });

  it("reports blocks added since the baseline separately, not as a comparison", async () => {
    const db = mockDb({
      baselineBlocks: [{ owner_id: "user_1", id: "baseline_1_A1010", baseline_id: "baseline_1", block_task_code: "A1010", label: "Task", block_type: "task", baseline_start: "2026-01-01", baseline_finish: "2026-01-07", baseline_duration_days: 7, percent_complete: 0, total_float_days: 0, is_critical: true }],
      currentBlocks: [
        { owner_id: "user_1", id: "p1_b1", task_code: "A1010", schedule_project_id: "p1", lane_id: "p1_lane_1", label: "Task", early_start: "2026-01-01", early_finish: "2026-01-07", actual_start: null, actual_finish: null },
        { owner_id: "user_1", id: "p1_b2", task_code: "A1020", schedule_project_id: "p1", lane_id: "p1_lane_1", label: "New scope", early_start: "2026-01-08", early_finish: "2026-01-14", actual_start: null, actual_finish: null },
      ],
    });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    const body = await response.json();
    expect(body.addedSinceBaseline).toEqual([{ taskCode: "A1020", label: "New scope" }]);
    expect(body.compared).toHaveLength(1);
  });

  it("404s when the baseline has no blocks and no matching baseline row exists", async () => {
    const db = mockDb({ baselineBlocks: [], baselineRow: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });

  it("does not 404 a genuinely empty baseline (captured from a board with no blocks yet)", async () => {
    const db = mockDb({ baselineBlocks: [], baselineRow: { id: "baseline_1" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await GET(new Request("https://test"), { params });
    expect(response.status).toBe(200);
  });
});
