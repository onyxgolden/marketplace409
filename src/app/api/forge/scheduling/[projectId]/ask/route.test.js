import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
vi.mock("../../scheduleProjectAssembly", () => ({
  loadProjectRelational: vi.fn(),
  computeCpm: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { loadProjectRelational, computeCpm } from "../../scheduleProjectAssembly";
import { POST } from "./route";

const PROJECT_ROW = {
  owner_id: "user_1", id: "p1", name: "Mine",
  start_date: "2026-01-05", end_date: "2026-12-31", default_calendar_id: null,
};

const CPM_BLOCKS = [
  {
    id: "block_1", task_code: "A1010", label: "Mobilize", block_type: "task",
    early_start: "2026-01-05", early_finish: "2026-01-09",
    late_start: "2026-01-05", late_finish: "2026-01-09",
    total_float_days: 0, is_critical: true, constraint_type: null, constraint_date: null,
    percent_complete: 0,
  },
  {
    id: "block_2", task_code: "A1020", label: "Framing", block_type: "task",
    early_start: "2026-01-12", early_finish: "2026-01-23",
    late_start: "2026-01-20", late_finish: "2026-01-31",
    total_float_days: 8, is_critical: false, constraint_type: null, constraint_date: null,
    percent_complete: 0,
  },
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

function mockAuth({ baseline = null, baselineBlocks = [] } = {}) {
  const createdNodes = [];
  const nodes = {
    schedule_baselines: tableNode({ data: baseline, error: null }),
    schedule_baseline_blocks: tableNode({ data: baselineBlocks, error: null }),
  };
  Object.values(nodes).forEach((node) => createdNodes.push(node));
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
  computeCpm.mockResolvedValue({ cpmBlocks: CPM_BLOCKS, conflicts: [], criticalTaskCodes: ["A1010"] });
}

const params = Promise.resolve({ projectId: "p1" });
const post = (question) => POST({ json: async () => ({ question }) }, { params });

describe("POST /api/forge/scheduling/[projectId]/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssembly();
  });

  it("answers a critical-path question deterministically", async () => {
    mockAuth();
    const response = await post("What is the critical path?");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.questionType).toBe("critical_path");
    expect(body.items.map((item) => item.taskCode)).toEqual(["A1010"]);
    expect(body.summary).toContain("1 critical activity");
    expect(Array.isArray(body.supportedQuestions)).toBe(true);
  });

  it("answers a float question and a targeted float question", async () => {
    mockAuth();
    const ranked = await (await post("Which activities have the least float?")).json();
    expect(ranked.questionType).toBe("float");
    expect(ranked.items[0].taskCode).toBe("A1020");

    const targeted = await (await post("What is the float for Framing?")).json();
    expect(targeted.questionType).toBe("float");
    expect(targeted.items[0].taskCode).toBe("A1020");
    expect(targeted.summary).toContain("8 days of total float");
  });

  it("returns the supported-question list for unrecognized input without guessing", async () => {
    mockAuth();
    const body = await (await post("order more lumber")).json();
    expect(body.questionType).toBe("unknown");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.summary).toContain("what I can answer");
  });

  it("reports no baseline when none was captured", async () => {
    mockAuth({ baseline: null });
    const body = await (await post("What changed since the baseline?")).json();
    expect(body.questionType).toBe("baseline_variance");
    expect(body.summary).toContain("No baseline has been captured");
  });

  it("compares against the latest baseline when one exists", async () => {
    mockAuth({
      baseline: { id: "b1", name: "Baseline 1" },
      baselineBlocks: [
        { block_task_code: "A1010", label: "Mobilize", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" },
      ],
    });
    const body = await (await post("show baseline variance")).json();
    expect(body.questionType).toBe("baseline_variance");
    expect(body.summary).toContain('baseline "Baseline 1"');
    // A1020 is in the current schedule but not the baseline -> added since baseline.
    expect(body.items.some((item) => item.taskCode === "A1020" && item.detail === "Added since baseline")).toBe(true);
  });

  it("404s for a project the caller cannot see", async () => {
    mockAuth();
    loadProjectRelational.mockResolvedValue({ project: null });
    const response = await post("What is the critical path?");
    expect(response.status).toBe(404);
  });

  it("never attempts a database write while answering -- not even through the CPM path", async () => {
    // Baseline-variance is the heaviest read path; the answer must still issue
    // zero writes, and the route must call computeCpm (pure) rather than
    // computeAndPersistCpm.
    const { createdNodes } = mockAuth({
      baseline: { id: "b1", name: "Baseline 1" },
      baselineBlocks: [],
    });
    const body = await (await post("What changed since the baseline?")).json();
    expect(body.questionType).toBe("baseline_variance");
    expect(computeCpm).toHaveBeenCalled();
    for (const node of createdNodes) {
      expect(node.update).not.toHaveBeenCalled();
    }
  });

  it("passes through the auth gate", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({ response: { status: 401 }, user: null });
    const response = await post("What is the critical path?");
    expect(response).toBeDefined();
  });
});
