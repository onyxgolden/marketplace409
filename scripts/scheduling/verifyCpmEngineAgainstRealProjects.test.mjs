import { describe, expect, it } from "vitest";
import { formatReport, verifyCpmEngineAgainstRealProjects } from "./verifyCpmEngineAgainstRealProjects.mjs";

// Stubbed Supabase client -- no real network or credentials, matching the project's convention
// (see scripts/rental/validateFirstTenantReadiness.test.mjs) of never hitting a live service in
// CI. Only .from(table).select() is ever called by the module under test.
function stubSupabaseClient(tables) {
  return {
    from(table) {
      return {
        select() {
          return Promise.resolve({ data: tables[table] ?? [], error: null });
        },
      };
    },
  };
}

function block(id, projectId, overrides = {}) {
  return {
    id, owner_id: "owner_1", task_code: id, schedule_project_id: projectId, lane_id: `${projectId}_lane`,
    wbs_node_id: null, label: id, category: "eng", block_type: "task", duration_days: 1,
    calendar_id: null, constraint_type: null, constraint_date: null, ...overrides,
  };
}

function dependency(id, predecessorId, successorId) {
  return { id, owner_id: "owner_1", predecessor_id: predecessorId, successor_id: successorId, relationship_type: "FS", lag_days: 0 };
}

describe("verifyCpmEngineAgainstRealProjects", () => {
  it("computes a per-project report for a simple FS chain", async () => {
    const tables = {
      schedule_projects: [{ id: "proj_1", owner_id: "owner_1", name: "Test Project", start_date: "2026-01-05", end_date: "2026-01-09", default_calendar_id: "cal_1" }],
      schedule_blocks: [block("A", "proj_1", { duration_days: 3 }), block("B", "proj_1", { duration_days: 2 })],
      schedule_dependencies: [dependency("d1", "A", "B")],
      schedule_calendars: [{ id: "cal_1", owner_id: "owner_1", schedule_project_id: "proj_1", working_days: [1, 2, 3, 4, 5] }],
      schedule_calendar_holidays: [],
      schedule_hammock_anchors: [],
      schedule_lanes: [{ id: "proj_1_lane", owner_id: "owner_1", schedule_project_id: "proj_1", calendar_id: null }],
    };

    const [report] = await verifyCpmEngineAgainstRealProjects({ supabaseClient: stubSupabaseClient(tables) });

    expect(report).toMatchObject({
      projectId: "proj_1",
      blockCount: 2,
      computedBlockCount: 2,
      excludedBlockIds: [],
      minFloatDays: 0,
      maxFloatDays: 0,
      outOfBoundsBlockIds: [],
      criticalPath: ["A", "B"],
      conflictCount: 0,
    });
  });

  it("scopes blocks/dependencies/calendars per project and does not leak data across projects", async () => {
    const tables = {
      schedule_projects: [
        { id: "proj_1", owner_id: "owner_1", name: "Project One", start_date: "2026-01-05", end_date: "2026-02-28", default_calendar_id: "cal_1" },
        { id: "proj_2", owner_id: "owner_1", name: "Project Two", start_date: "2026-01-05", end_date: "2026-02-28", default_calendar_id: "cal_2" },
      ],
      schedule_blocks: [block("A", "proj_1"), block("X", "proj_2")],
      // A cross-project dependency (references a block that belongs to a different project) --
      // must be dropped for both projects, not crash and not treat X as a predecessor of A.
      schedule_dependencies: [dependency("cross", "A", "X")],
      schedule_calendars: [
        { id: "cal_1", owner_id: "owner_1", schedule_project_id: "proj_1", working_days: [1, 2, 3, 4, 5] },
        { id: "cal_2", owner_id: "owner_1", schedule_project_id: "proj_2", working_days: [1, 2, 3, 4, 5] },
      ],
      schedule_calendar_holidays: [],
      schedule_hammock_anchors: [],
      schedule_lanes: [
        { id: "proj_1_lane", owner_id: "owner_1", schedule_project_id: "proj_1", calendar_id: null },
        { id: "proj_2_lane", owner_id: "owner_1", schedule_project_id: "proj_2", calendar_id: null },
      ],
    };

    const reports = await verifyCpmEngineAgainstRealProjects({ supabaseClient: stubSupabaseClient(tables) });

    expect(reports).toHaveLength(2);
    const byId = Object.fromEntries(reports.map((report) => [report.projectId, report]));
    // The cross-project edge is surfaced as a dependency_out_of_scope conflict on whichever side
    // referenced it, but each project's own block is still computed normally -- the whole point of
    // per-project scoping is that one bad cross-project edge doesn't take down either project.
    expect(byId.proj_1).toMatchObject({ blockCount: 1, computedBlockCount: 1, conflictCount: 1 });
    expect(byId.proj_1.conflictsByType.dependency_out_of_scope).toBe(1);
    expect(byId.proj_2).toMatchObject({ blockCount: 1, computedBlockCount: 1, conflictCount: 1 });
    expect(byId.proj_2.conflictsByType.dependency_out_of_scope).toBe(1);
  });

  it("flags an early_finish beyond the project's end_date as an anomaly", async () => {
    const tables = {
      schedule_projects: [{ id: "proj_1", owner_id: "owner_1", name: "Short Project", start_date: "2026-01-05", end_date: "2026-01-06", default_calendar_id: "cal_1" }],
      schedule_blocks: [block("A", "proj_1", { duration_days: 10 })],
      schedule_dependencies: [],
      schedule_calendars: [{ id: "cal_1", owner_id: "owner_1", schedule_project_id: "proj_1", working_days: [1, 2, 3, 4, 5] }],
      schedule_calendar_holidays: [],
      schedule_hammock_anchors: [],
      schedule_lanes: [{ id: "proj_1_lane", owner_id: "owner_1", schedule_project_id: "proj_1", calendar_id: null }],
    };

    const [report] = await verifyCpmEngineAgainstRealProjects({ supabaseClient: stubSupabaseClient(tables) });

    expect(report.outOfBoundsBlockIds).toEqual(["A"]);
  });

  it("throws when a table fetch returns an error", async () => {
    const supabaseClient = {
      from(table) {
        return { select: () => Promise.resolve({ data: null, error: table === "schedule_blocks" ? { message: "boom" } : null }) };
      },
    };

    await expect(verifyCpmEngineAgainstRealProjects({ supabaseClient })).rejects.toThrow(/schedule_blocks.*boom/);
  });

  it("formats a report into readable text", () => {
    const text = formatReport([
      {
        projectId: "proj_1", ownerId: "owner_1", projectName: "Test Project", blockCount: 2, computedBlockCount: 2,
        excludedBlockIds: [], minFloatDays: 0, maxFloatDays: 3, outOfBoundsBlockIds: [], criticalPath: ["A", "B"],
        conflictsByType: {}, conflictCount: 0,
      },
    ]);

    expect(text).toContain("Project proj_1 (Test Project), owner owner_1");
    expect(text).toContain("blocks: 2/2 computed");
    expect(text).toContain("critical path: A -> B");
  });
});
