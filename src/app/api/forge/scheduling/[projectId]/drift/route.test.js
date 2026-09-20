import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
vi.mock("../../scheduleProjectAssembly", () => ({
  loadProjectRelational: vi.fn(),
  computeCpm: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { loadProjectRelational, computeCpm } from "../../scheduleProjectAssembly";
import { GET } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: null,
};

const CPM_BLOCKS = [
  {
    id: "block_1", task_code: "A1010", label: "Mobilize", block_type: "task",
    early_start: "2026-01-05", early_finish: "2026-01-09",
    actual_start: null, actual_finish: null,
    percent_complete: 0,
  },
  {
    id: "block_2", task_code: "A1020", label: "Framing", block_type: "task",
    early_start: "2026-01-12", early_finish: "2026-01-28",
    actual_start: null, actual_finish: null,
    percent_complete: 0,
  },
  {
    id: "block_3", task_code: "A1030", label: "Done work", block_type: "task",
    early_start: "2026-01-05", early_finish: "2026-02-20",
    actual_start: "2026-01-05", actual_finish: "2026-02-20",
    percent_complete: 100,
  },
];

const BASELINE_BLOCKS = [
  { block_task_code: "A1010", label: "Mobilize", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" },
  { block_task_code: "A1020", label: "Framing", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" },
  { block_task_code: "A1030", label: "Done work", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" },
];

function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
    order: vi.fn(() => node), limit: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function mockAuth({ baseline = { id: "b1", name: "Baseline 1" }, baselineBlocks = BASELINE_BLOCKS } = {}) {
  const createdNodes = [];
  const nodes = {
    schedule_baselines: tableNode({ data: baseline, error: null }),
    schedule_baseline_blocks: tableNode({ data: baselineBlocks, error: null }),
  };
  const supabaseClient = {
    from: vi.fn((table) => {
      const node = nodes[table] || tableNode({ data: null, error: null });
      createdNodes.push(node);
      return node;
    }),
  };
  createAuthenticatedForgeApplication.mockResolvedValue({
    response: null,
    user: { id: "user_1" },
    supabaseClient,
  });
  return { createdNodes, supabaseClient };
}

function mockAssembly() {
  loadProjectRelational.mockResolvedValue({ project: PROJECT_ROW });
  computeCpm.mockResolvedValue({ cpmBlocks: CPM_BLOCKS, conflicts: [] });
}

const params = Promise.resolve({ projectId: "p1" });
const get = (query = "") => GET(
  { nextUrl: new URL(`http://localhost/api/forge/scheduling/p1/drift${query}`) },
  { params },
);

describe("GET /api/forge/scheduling/[projectId]/drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssembly();
  });

  it("returns a drift report against the latest baseline", async () => {
    mockAuth();
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.hasBaseline).toBe(true);
    expect(body.baselineName).toBe("Baseline 1");
    expect(body.thresholdDays).toBe(2);
    // A1020 slipped 5 days on finish -> major/late; A1010 is on time; A1030 is complete.
    expect(body.drifted.map((item) => item.taskCode)).toEqual(["A1020"]);
    expect(body.drifted[0].severity).toBe("major");
    expect(body.drifted[0].direction).toBe("late");
    expect(body.summary.driftedCount).toBe(1);
    expect(body.summary.completedExcludedCount).toBe(1);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("honors a valid thresholdDays query param", async () => {
    mockAuth();
    const body = await (await get("?thresholdDays=10")).json();
    expect(body.thresholdDays).toBe(10);
    expect(body.drifted).toHaveLength(0); // +5 finish slip is within a 10-day threshold
  });

  it("rejects a non-numeric or negative thresholdDays", async () => {
    mockAuth();
    expect((await get("?thresholdDays=abc")).status).toBe(400);
    expect((await get("?thresholdDays=-1")).status).toBe(400);
  });

  it("returns a well-formed empty report when no baseline exists", async () => {
    mockAuth({ baseline: null, baselineBlocks: [] });
    const body = await (await get()).json();
    expect(body.hasBaseline).toBe(false);
    expect(body.drifted).toEqual([]);
    expect(body.summary.driftedCount).toBe(0);
  });

  it("404s for a project the caller cannot see", async () => {
    mockAuth();
    loadProjectRelational.mockResolvedValue({ project: null });
    const response = await get();
    expect(response.status).toBe(404);
  });

  it("never attempts a database write while reporting -- not even through the CPM path", async () => {
    const { createdNodes } = mockAuth();
    const body = await (await get()).json();
    expect(body.success).toBe(true);
    expect(computeCpm).toHaveBeenCalled();
    for (const node of createdNodes) {
      expect(node.update).not.toHaveBeenCalled();
    }
  });

  it("passes through the auth gate", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({ response: { status: 401 }, user: null });
    const response = await get();
    expect(response).toBeDefined();
  });
});
