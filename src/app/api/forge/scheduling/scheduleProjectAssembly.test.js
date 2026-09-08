import { describe, expect, it, vi } from "vitest";
import { computeAndPersistCpm, loadExportData, loadProjectRelational } from "./scheduleProjectAssembly";

// A single node per table: chainable (select/update/eq/in/order all return itself) and thenable,
// resolving to whatever this table was configured to resolve -- same pattern already used by
// [projectId]/route.test.js's mockDb.
function tableNode(resolution) {
  const node = {
    select: vi.fn(() => node), update: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), order: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
    then: (resolve, reject) => Promise.resolve(resolution).then(resolve, reject),
  };
  return node;
}

function stubClient(tables) {
  return { from: vi.fn((table) => tables[table] || tableNode({ data: [], error: null })) };
}

const PROJECT = { owner_id: "o1", id: "p1", start_date: "2026-01-05", end_date: "2026-02-28", default_calendar_id: "cal_1" };
const CALENDAR = { id: "cal_1", schedule_project_id: "p1", working_days: [1, 2, 3, 4, 5] };
const LANE = { id: "p1_lane1", schedule_project_id: "p1", calendar_id: null };
const BLOCK = {
  owner_id: "o1", id: "p1_b1", task_code: "A1", schedule_project_id: "p1", lane_id: "p1_lane1", wbs_node_id: null,
  label: "A", category: "eng", block_type: "task", start_date: "2026-01-05", duration_days: 1,
  percent_complete: 0, font_size: null, text_color: null, bold: true, calendar_id: null, constraint_type: null, constraint_date: null,
};

describe("loadProjectRelational — holidays and hammock anchors (SCHED-21A)", () => {
  it("fetches holidays scoped by this project's own calendar ids and hammock anchors scoped by this project's own block ids", async () => {
    const holiday = { id: "h1", calendar_id: "cal_1", holiday_date: "2026-01-06" };
    const hammockAnchor = { id: "ha1", hammock_block_id: "p1_h1", anchor_block_id: "p1_b1" };
    const tables = {
      schedule_projects: tableNode({ data: PROJECT, error: null }),
      schedule_calendars: tableNode({ data: [CALENDAR], error: null }),
      schedule_wbs_nodes: tableNode({ data: [], error: null }),
      schedule_blackout_windows: tableNode({ data: [], error: null }),
      schedule_lanes: tableNode({ data: [LANE], error: null }),
      schedule_blocks: tableNode({ data: [BLOCK], error: null }),
      schedule_calendar_holidays: tableNode({ data: [holiday], error: null }),
      schedule_hammock_anchors: tableNode({ data: [hammockAnchor], error: null }),
      schedule_dependencies: tableNode({ data: [], error: null }),
    };
    const client = stubClient(tables);
    const relational = await loadProjectRelational(client, "p1");
    expect(relational.holidays).toEqual([holiday]);
    expect(relational.hammockAnchors).toEqual([hammockAnchor]);
    expect(client.from).toHaveBeenCalledWith("schedule_calendar_holidays");
    expect(client.from).toHaveBeenCalledWith("schedule_hammock_anchors");
  });

  it("returns empty arrays without querying holidays/hammock anchors/dependencies when there are no calendars or blocks yet", async () => {
    const tables = {
      schedule_projects: tableNode({ data: PROJECT, error: null }),
      schedule_calendars: tableNode({ data: [], error: null }),
      schedule_wbs_nodes: tableNode({ data: [], error: null }),
      schedule_blackout_windows: tableNode({ data: [], error: null }),
      schedule_lanes: tableNode({ data: [], error: null }),
      schedule_blocks: tableNode({ data: [], error: null }),
    };
    const client = stubClient(tables);
    const relational = await loadProjectRelational(client, "p1");
    expect(relational.holidays).toEqual([]);
    expect(relational.hammockAnchors).toEqual([]);
    expect(relational.dependencies).toEqual([]);
    expect(client.from).not.toHaveBeenCalledWith("schedule_calendar_holidays");
    expect(client.from).not.toHaveBeenCalledWith("schedule_hammock_anchors");
  });
});

describe("computeAndPersistCpm — live holidays/blackout windows/dangling dependencies (SCHED-21A)", () => {
  function relationalWith(overrides) {
    return {
      blocks: [BLOCK], dependencies: [], calendars: [CALENDAR], lanes: [LANE],
      holidays: [], blackoutWindows: [], hammockAnchors: [], ...overrides,
    };
  }
  const client = stubClient({ schedule_blocks: tableNode({ data: null, error: null }) });

  it("factors a real calendar holiday into the persisted early/late dates -- proving holidays isn't hardcoded to [] anymore", async () => {
    const holiday = { id: "h1", calendar_id: "cal_1", holiday_date: "2026-01-05" }; // project.start_date itself, a Monday
    const withoutHoliday = await computeAndPersistCpm(client, PROJECT, relationalWith({ holidays: [] }));
    const withHoliday = await computeAndPersistCpm(client, PROJECT, relationalWith({ holidays: [holiday] }));
    expect(withoutHoliday.byTaskCode.A1.earlyStart).toBe("2026-01-05");
    expect(withHoliday.byTaskCode.A1.earlyStart).toBe("2026-01-06");
  });

  it("factors a real blackout window into the persisted early/late dates -- proving blackoutWindows reaches the live path, not just the verify script (PR #140's gap)", async () => {
    const blackoutWindows = [{ start_date: "2026-01-05", end_date: "2026-01-05", label: "Test blackout" }];
    const withoutBlackout = await computeAndPersistCpm(client, PROJECT, relationalWith({ blackoutWindows: [] }));
    const withBlackout = await computeAndPersistCpm(client, PROJECT, relationalWith({ blackoutWindows }));
    expect(withoutBlackout.byTaskCode.A1.earlyStart).toBe("2026-01-05");
    expect(withBlackout.byTaskCode.A1.earlyStart).toBe("2026-01-06");
  });

  it("no longer silently drops a dangling dependency before the engine can report it (removed the AND both-ends-present pre-filter)", async () => {
    const dependencies = [{ id: "p1_d1", predecessor_id: "p1_b1", successor_id: "ghost", relationship_type: "FS", lag_days: 0 }];
    const result = await computeAndPersistCpm(client, PROJECT, relationalWith({ dependencies }));
    expect(result.conflicts.some((conflict) => conflict.type === "dependency_out_of_scope")).toBe(true);
  });
});

describe("loadExportData — holiday fetch reuse (SCHED-21A)", () => {
  it("reuses relational.holidays for in-scope calendars, only querying for calendars outside project scope", async () => {
    const inScopeHoliday = { id: "h1", calendar_id: "cal_1", holiday_date: "2026-01-06" };
    const relational = {
      project: { ...PROJECT, default_calendar_id: "cal_1" },
      lanes: [LANE], calendars: [CALENDAR], holidays: [inScopeHoliday], dependencies: [],
    };
    const cpmBlocks = [{ id: "p1_b1", calendar_id: "cal_extra" }];
    const extraCalendar = { id: "cal_extra", schedule_project_id: null, working_days: [1, 2, 3, 4, 5] };
    const extraHoliday = { id: "h2", calendar_id: "cal_extra", holiday_date: "2026-03-17" };
    const client = stubClient({
      schedule_calendars: tableNode({ data: [extraCalendar], error: null }),
      schedule_calendar_holidays: tableNode({ data: [extraHoliday], error: null }),
    });

    const result = await loadExportData(client, relational, cpmBlocks, []);
    expect(result.holidays).toEqual([inScopeHoliday, extraHoliday]);
    expect(client.from).toHaveBeenCalledWith("schedule_calendar_holidays");
  });

  it("doesn't query holidays at all when every referenced calendar is already in project scope", async () => {
    const inScopeHoliday = { id: "h1", calendar_id: "cal_1", holiday_date: "2026-01-06" };
    const relational = {
      project: { ...PROJECT, default_calendar_id: "cal_1" },
      lanes: [LANE], calendars: [CALENDAR], holidays: [inScopeHoliday], dependencies: [],
    };
    const cpmBlocks = [{ id: "p1_b1", calendar_id: "cal_1" }];
    const client = stubClient({});

    const result = await loadExportData(client, relational, cpmBlocks, []);
    expect(result.holidays).toEqual([inScopeHoliday]);
    expect(client.from).not.toHaveBeenCalled();
  });
});
