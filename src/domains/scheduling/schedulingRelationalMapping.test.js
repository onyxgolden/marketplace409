import { describe, expect, it } from "vitest";
import {
  boardToRelationalTables,
  mapActivityBlockRows,
  mapBlackoutWindowRows,
  mapBlockRows,
  mapCalendarRows,
  mapDependencyRows,
  mapGanttBlockRows,
  mapLaneRows,
  mapProjectRow,
  mapWbsNodeRows,
} from "./schedulingRelationalMapping";

const OWNER_ID = "owner-1";
const PROJECT_ID = "schedule_project_test";

function minimalBoard(overrides = {}) {
  return {
    id: PROJECT_ID,
    projectName: "Test Project",
    templateId: "capital",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    lanes: [],
    blocks: [],
    dependencies: [],
    calendars: [],
    defaultCalendarId: null,
    blackoutWindows: [],
    wbs: { nodes: [], activities: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("schedulingRelationalMapping — minimal/edge-case boards", () => {
  it("maps an empty board to a project row and zero rows everywhere else, not an error", () => {
    const board = minimalBoard();
    const result = boardToRelationalTables(board, { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: "Test Project", isPublic: false });
    expect(result.project).toMatchObject({ owner_id: OWNER_ID, id: PROJECT_ID, name: "Test Project", is_public: false });
    expect(result.calendars).toEqual([]);
    expect(result.wbsNodes).toEqual([]);
    expect(result.blackoutWindows).toEqual([]);
    expect(result.lanes).toEqual([]);
    expect(result.blocks).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });

  it("handles a board with no wbs field at all, not just an empty one (matches the real seeded Example project, which has no wbs key)", () => {
    const board = minimalBoard();
    delete board.wbs;
    expect(mapWbsNodeRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID })).toEqual([]);
    expect(mapActivityBlockRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID })).toEqual([]);
  });

  it("converts a milestone block to duration_days=0 regardless of its stored duration", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_ms", name: "Milestones" }],
      blocks: [{ id: "b1", taskCode: "A1010", label: "Kickoff", category: "gov", milestone: true, duration: 3, startIdx: 0, laneId: "lane_ms", fontSize: null, textColor: null, bold: true }],
    });
    const [row] = mapGanttBlockRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(row).toMatchObject({ block_type: "milestone", duration_days: 0, start_date: "2026-01-01" });
  });

  it("converts week-index/week-duration to day-granular dates using board.startDate + startIdx*7 / duration*7", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_eng", name: "Engineering" }],
      blocks: [{ id: "b2", taskCode: "A1020", label: "Detailed Design", category: "eng", milestone: false, duration: 2, startIdx: 5, laneId: "lane_eng", fontSize: null, textColor: null, bold: true }],
    });
    const [row] = mapGanttBlockRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    // startIdx=5 weeks -> 35 days after 2026-01-01 = 2026-02-05; duration=2 weeks -> 14 days
    expect(row.start_date).toBe("2026-02-05");
    expect(row.duration_days).toBe(14);
  });

  it("carries text styling through when set, and lets it stay null when unset", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_eng", name: "Engineering" }],
      blocks: [
        { id: "b1", taskCode: "A1010", label: "Styled", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_eng", fontSize: 14, textColor: "#ffffff", bold: true },
        { id: "b2", taskCode: "A1020", label: "Unstyled", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_eng", fontSize: null, textColor: null, bold: true },
      ],
    });
    const rows = mapGanttBlockRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(rows[0]).toMatchObject({ font_size: 14, text_color: "#ffffff" });
    expect(rows[1]).toMatchObject({ font_size: null, text_color: null });
  });

  it("namespaces every id and id-reference by project id, so two projects with the same board-internal ids never collide", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_1", name: "Lane" }],
      blocks: [{ id: "b1", taskCode: "A1010", label: "Task", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_1", fontSize: null, textColor: null, bold: true }],
      dependencies: [],
    });
    const projectA = mapBlockRows(board, { ownerId: OWNER_ID, projectId: "schedule_project_a" });
    const projectB = mapBlockRows(board, { ownerId: OWNER_ID, projectId: "schedule_project_b" });
    expect(projectA[0].id).toBe("schedule_project_a_b1");
    expect(projectB[0].id).toBe("schedule_project_b_b1");
    expect(projectA[0].id).not.toBe(projectB[0].id);
    expect(projectA[0].lane_id).toBe("schedule_project_a_lane_1");
  });

  it("maps a WBS activity to lane_id=null, wbs_node_id set, start_date=null, category='wbs'", () => {
    const board = minimalBoard({
      wbs: {
        nodes: [{ id: "wbs_1", code: "1", name: "Phase 1", parentId: null, order: 0 }],
        activities: [{ id: "activity_1", code: "A1", wbsId: "wbs_1", name: "Design review", durationWeeks: 2, percentComplete: 40, order: 0 }],
      },
    });
    const [row] = mapActivityBlockRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(row).toMatchObject({
      lane_id: null,
      wbs_node_id: `${PROJECT_ID}_wbs_1`,
      category: "wbs",
      block_type: "task",
      start_date: null,
      duration_days: 14,
      percent_complete: 40,
    });
  });

  it("namespaces a WBS node's parent_id, and leaves a root node's parent_id null", () => {
    const board = minimalBoard({
      wbs: {
        nodes: [
          { id: "wbs_1", code: "1", name: "Root", parentId: null, order: 0 },
          { id: "wbs_2", code: "1.1", name: "Child", parentId: "wbs_1", order: 0 },
        ],
        activities: [],
      },
    });
    const rows = mapWbsNodeRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(rows[0]).toMatchObject({ id: `${PROJECT_ID}_wbs_1`, parent_id: null });
    expect(rows[1]).toMatchObject({ id: `${PROJECT_ID}_wbs_2`, parent_id: `${PROJECT_ID}_wbs_1` });
  });

  it("namespaces a lane's optional calendarId override, and leaves it null when unset", () => {
    const board = minimalBoard({
      calendars: [{ id: "cal_1", name: "5-10s", workingDays: [1, 2, 3, 4, 5] }],
      lanes: [
        { id: "lane_1", name: "With calendar", calendarId: "cal_1" },
        { id: "lane_2", name: "No calendar" },
      ],
    });
    const rows = mapLaneRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(rows[0].calendar_id).toBe(`${PROJECT_ID}_cal_1`);
    expect(rows[1].calendar_id).toBeNull();
  });

  it("maps calendars' workingDays array through unchanged (already the live shape, no conversion needed)", () => {
    const board = minimalBoard({ calendars: [{ id: "cal_1", name: "7-10s", workingDays: [0, 1, 2, 3, 4, 5, 6] }] });
    const [row] = mapCalendarRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(row.working_days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("maps blackout windows with label/date-range through unchanged", () => {
    const board = minimalBoard({ blackoutWindows: [{ id: "bw_1", label: "Holiday shutdown", startDate: "2026-12-24", endDate: "2026-12-26" }] });
    const [row] = mapBlackoutWindowRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(row).toMatchObject({ label: "Holiday shutdown", start_date: "2026-12-24", end_date: "2026-12-26" });
  });

  it("namespaces dependency predecessor/successor ids and carries relationship type + lag through", () => {
    const board = minimalBoard({
      dependencies: [{ id: "dep1", predecessorId: "b1", successorId: "b2", relationshipType: "SS", lagDays: 3 }],
    });
    const [row] = mapDependencyRows(board, { ownerId: OWNER_ID, projectId: PROJECT_ID });
    expect(row).toMatchObject({
      predecessor_id: `${PROJECT_ID}_b1`,
      successor_id: `${PROJECT_ID}_b2`,
      relationship_type: "SS",
      lag_days: 3,
    });
  });

  it("namespaces a project's default_calendar_id, and leaves it null when unset", () => {
    const boardWithDefault = minimalBoard({ defaultCalendarId: "cal_1" });
    const rowWithDefault = mapProjectRow(boardWithDefault, { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: "P" });
    expect(rowWithDefault.default_calendar_id).toBe(`${PROJECT_ID}_cal_1`);

    const boardWithoutDefault = minimalBoard({ defaultCalendarId: null });
    const rowWithoutDefault = mapProjectRow(boardWithoutDefault, { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: "P" });
    expect(rowWithoutDefault.default_calendar_id).toBeNull();
  });
});

describe("schedulingRelationalMapping — golden fixture: the seeded Example project board", () => {
  // Reproduced from the literal insert in
  // supabase/migrations/20260818140000_create_forge_scheduling_projects.sql — 15 lanes, 17
  // blocks, 10 dependencies, 5 calendars, no wbs key at all.
  const exampleBoard = {
    id: "schedule_project_abc795c6-f018-4913-98b4-adb3a002e5a2",
    projectName: "Example project",
    startDate: "2026-08-18",
    endDate: "2027-08-17",
    weekWidth: 144,
    lanes: [
      { id: "lane_ms", name: "Milestones" },
      { id: "lane_5", name: "Gov", calendarId: "cal_4_10s" },
      { id: "lane_6", name: "Gov", calendarId: "cal_4_10s" },
      { id: "lane_gov", name: "Governance", calendarId: "cal_4_10s" },
      { id: "lane_10", name: "Eng", calendarId: "cal_5_10s" },
      { id: "lane_11", name: "Eng", calendarId: "cal_5_10s" },
      { id: "lane_16", name: "Eng", calendarId: "cal_5_10s" },
      { id: "lane_20", name: "Eng" },
      { id: "lane_eng", name: "Engineering" },
      { id: "lane_proc", name: "Procurement" },
      { id: "lane_21", name: "FE" },
      { id: "lane_field1", name: "Field Execution" },
      { id: "lane_field2", name: "Field Execution (cont.)" },
      { id: "lane_shut", name: "Shutdown & Startup" },
      { id: "lane_23", name: "Scaffolding Support" },
    ],
    blocks: [
      { id: "b1", label: "Kickoff", category: "gov", milestone: true, duration: 0, startIdx: 0, laneId: "lane_5", taskCode: "A1010", fontSize: null, textColor: null, bold: true },
      { id: "b7", taskCode: "A1040", label: "Charter Approval", category: "gov", milestone: false, duration: 1, startIdx: 0, laneId: "lane_6", fontSize: null, textColor: null, bold: true },
      { id: "b8", taskCode: "A1050", label: "Stage Gate Review", category: "gov", milestone: false, duration: 1, startIdx: 1, laneId: "lane_gov", fontSize: null, textColor: null, bold: true },
      { id: "b9", taskCode: "A1060", label: "Piping Install", category: "field", milestone: false, duration: 6, startIdx: 21, laneId: "lane_field1", fontSize: null, textColor: null, bold: true },
      { id: "b12", taskCode: "A1070", label: "Conceptual Design", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_10", fontSize: null, textColor: null, bold: true },
      { id: "b13", taskCode: "A1080", label: "Feasibility / FEED", category: "eng", milestone: false, duration: 1, startIdx: 1, laneId: "lane_10", fontSize: null, textColor: null, bold: true },
      { id: "b14", taskCode: "A1090", label: "Detailed Design", category: "eng", milestone: false, duration: 2, startIdx: 2, laneId: "lane_10", fontSize: null, textColor: "#ffffff", bold: true },
      { id: "b15", taskCode: "A1100", label: "Civil Engineering", category: "eng", milestone: false, duration: 2, startIdx: 5, laneId: "lane_11", fontSize: null, textColor: null, bold: true },
      { id: "b17", taskCode: "A1110", label: "Mechanical Engineering", category: "eng", milestone: false, duration: 5, startIdx: 5, laneId: "lane_16", fontSize: null, textColor: null, bold: true },
      { id: "b18", taskCode: "A1120", label: "Electrical Engineering", category: "eng", milestone: false, duration: 5, startIdx: 7, laneId: "lane_20", fontSize: null, textColor: null, bold: true },
      { id: "b19", taskCode: "A1130", label: "Instrumentation Engineering", category: "eng", milestone: false, duration: 5, startIdx: 7, laneId: "lane_eng", fontSize: null, textColor: null, bold: true },
      { id: "b25", taskCode: "A1150", label: "scaffolding support", category: "proc", milestone: false, duration: 12, startIdx: 15, laneId: "lane_field2", fontSize: null, textColor: null, bold: true },
      { id: "b26", taskCode: "A1160", label: "Turnaround Window", category: "shut", milestone: false, duration: 3, startIdx: 12, laneId: "lane_field1", fontSize: null, textColor: null, bold: true },
      { id: "b27", taskCode: "A1170", label: "Turnaround Window Make Captial Tie-ins", category: "shut", milestone: false, duration: 6, startIdx: 27, laneId: "lane_field1", fontSize: null, textColor: null, bold: true },
      { id: "b28", taskCode: "A1180", label: "Pre-Startup Safety Review (PSSR)", category: "shut", milestone: true, duration: 0, startIdx: 33, laneId: "lane_21", fontSize: null, textColor: null, bold: true },
      { id: "b29", taskCode: "A1190", label: "Return to Service", category: "shut", milestone: true, duration: 0, startIdx: 34, laneId: "lane_field1", fontSize: null, textColor: null, bold: true },
      { id: "b30", taskCode: "A1200", label: "Investment / Funding Approval", category: "gov", milestone: true, duration: 0, startIdx: 21, laneId: "lane_gov", fontSize: null, textColor: null, bold: true },
    ],
    dependencies: [
      { id: "dep31", predecessorId: "b13", successorId: "b14", relationshipType: "FS", lagDays: 0 },
      { id: "dep32", predecessorId: "b12", successorId: "b13", relationshipType: "FS", lagDays: 0 },
      { id: "dep33", predecessorId: "b14", successorId: "b15", relationshipType: "FS", lagDays: 0 },
      { id: "dep34", predecessorId: "b15", successorId: "b18", relationshipType: "FS", lagDays: 0 },
      { id: "dep35", predecessorId: "b18", successorId: "b25", relationshipType: "FS", lagDays: 0 },
      { id: "dep36", predecessorId: "b25", successorId: "b27", relationshipType: "FS", lagDays: 0 },
      { id: "dep37", predecessorId: "b27", successorId: "b28", relationshipType: "FS", lagDays: 0 },
      { id: "dep38", predecessorId: "b28", successorId: "b29", relationshipType: "FS", lagDays: 0 },
      { id: "dep39", predecessorId: "b7", successorId: "b8", relationshipType: "FS", lagDays: 0 },
      { id: "dep40", predecessorId: "b8", successorId: "b14", relationshipType: "FS", lagDays: 0 },
    ],
    customChips: [],
    calendars: [
      { id: "cal_4_10s", name: "4-10s", workingDays: [1, 2, 3, 4] },
      { id: "cal_4_10s_8", name: "4-10s + 8", workingDays: [1, 2, 3, 4, 5] },
      { id: "cal_5_10s", name: "5-10s", workingDays: [1, 2, 3, 4, 5] },
      { id: "cal_6_10s", name: "6-10s", workingDays: [1, 2, 3, 4, 5, 6] },
      { id: "cal_7_10s", name: "7-10s", workingDays: [0, 1, 2, 3, 4, 5, 6] },
    ],
    defaultCalendarId: "cal_5_10s",
    blackoutWindows: [],
    nextId: 41,
    nextTaskNumber: 1210,
    createdAt: "2026-08-18T04:40:17.149Z",
    updatedAt: "2026-08-18T23:17:02.382Z",
    // Deliberately no `wbs` key at all -- matches the real seeded row exactly.
  };

  const context = { ownerId: "example", projectId: exampleBoard.id, projectName: "Example project", isPublic: true };

  it("maps exactly 15 lanes, 17 blocks, 10 dependencies, 5 calendars, 0 wbs nodes", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    expect(result.lanes).toHaveLength(15);
    expect(result.blocks).toHaveLength(17);
    expect(result.dependencies).toHaveLength(10);
    expect(result.calendars).toHaveLength(5);
    expect(result.wbsNodes).toHaveLength(0);
    expect(result.blackoutWindows).toHaveLength(0);
  });

  it("maps the project row with is_public carried through", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    expect(result.project).toMatchObject({
      owner_id: "example",
      id: exampleBoard.id,
      name: "Example project",
      is_public: true,
      default_calendar_id: `${exampleBoard.id}_cal_5_10s`,
      start_date: "2026-08-18",
      end_date: "2027-08-17",
    });
  });

  it("spot-checks the Kickoff milestone (b1/A1010) maps correctly", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const kickoff = result.blocks.find((row) => row.task_code === "A1010");
    expect(kickoff).toMatchObject({
      id: `${exampleBoard.id}_b1`,
      label: "Kickoff",
      block_type: "milestone",
      duration_days: 0,
      start_date: "2026-08-18",
      bold: true,
    });
  });

  it("spot-checks Charter Approval (b7/A1040), which has bold:true carried from real seeded data", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const charter = result.blocks.find((row) => row.task_code === "A1040");
    expect(charter).toMatchObject({ label: "Charter Approval", bold: true, text_color: null });
  });

  it("spot-checks Detailed Design (b14/A1090), which has a real non-null text_color in the seed", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const detailedDesign = result.blocks.find((row) => row.task_code === "A1090");
    expect(detailedDesign).toMatchObject({ text_color: "#ffffff", duration_days: 14 });
  });

  it("every task_code is unique within the project (matches the unique(owner_id, schedule_project_id, task_code) constraint)", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const taskCodes = result.blocks.map((row) => row.task_code);
    expect(new Set(taskCodes).size).toBe(taskCodes.length);
  });

  it("every dependency's predecessor/successor id resolves to a real mapped block id", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const blockIds = new Set(result.blocks.map((row) => row.id));
    for (const dependency of result.dependencies) {
      expect(blockIds.has(dependency.predecessor_id)).toBe(true);
      expect(blockIds.has(dependency.successor_id)).toBe(true);
    }
  });

  it("every lane's calendar_id override, when set, resolves to a real mapped calendar id", () => {
    const result = boardToRelationalTables(exampleBoard, context);
    const calendarIds = new Set(result.calendars.map((row) => row.id));
    for (const lane of result.lanes) {
      if (lane.calendar_id) expect(calendarIds.has(lane.calendar_id)).toBe(true);
    }
  });
});
