import { describe, expect, it } from "vitest";
import { boardToRelationalTables } from "./schedulingRelationalMapping";
import { relationalTablesToBoard } from "./schedulingRelationalToBoard";

const OWNER_ID = "owner-1";
const PROJECT_ID = "schedule_project_test";

function minimalBoard(overrides = {}) {
  return {
    id: PROJECT_ID,
    projectName: "Test Project",
    templateId: "capital",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    weekWidth: 90,
    lanes: [],
    categoryNames: { gov: "Governance" },
    starterChips: [{ label: "Kickoff", category: "gov", durationWeeks: 0, milestone: true }],
    customChips: [],
    blocks: [],
    dependencies: [],
    calendars: [],
    defaultCalendarId: null,
    blackoutWindows: [],
    wbs: { nodes: [], activities: [] },
    nextId: 1,
    nextTaskNumber: 1010,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

// sync_schedule_project_from_board (the real write path) additionally populates next_id/
// next_task_number/client_metadata on the project row -- fields boardToRelationalTables doesn't
// produce, since those columns postdate that module. This mirrors that SQL function's own
// jsonb_build_object shape exactly, so the round-trip test reflects real runtime data.
function withResyncFields(projectRow, board) {
  return {
    ...projectRow,
    next_id: board.nextId,
    next_task_number: board.nextTaskNumber,
    client_metadata: {
      weekWidth: board.weekWidth,
      categoryNames: board.categoryNames,
      starterChips: board.starterChips,
      customChips: board.customChips,
    },
  };
}

function roundTrip(board, context) {
  const relational = boardToRelationalTables(board, context);
  const project = withResyncFields(relational.project, board);
  return relationalTablesToBoard({ ...relational, project });
}

describe("schedulingRelationalToBoard", () => {
  it("round-trips an empty board back to an equivalent shape", () => {
    const board = minimalBoard();
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.id).toBe(board.id);
    expect(result.projectName).toBe(board.projectName);
    expect(result.startDate).toBe(board.startDate);
    expect(result.endDate).toBe(board.endDate);
    expect(result.weekWidth).toBe(board.weekWidth);
    expect(result.categoryNames).toEqual(board.categoryNames);
    expect(result.starterChips).toEqual(board.starterChips);
    expect(result.customChips).toEqual(board.customChips);
    expect(result.blocks).toEqual([]);
    expect(result.dependencies).toEqual([]);
    expect(result.lanes).toEqual([]);
    expect(result.calendars).toEqual([]);
    expect(result.blackoutWindows).toEqual([]);
    expect(result.wbs).toEqual({ nodes: [], activities: [] });
    expect(result.defaultCalendarId).toBeNull();
    expect(result.nextId).toBe(board.nextId);
    expect(result.nextTaskNumber).toBe(board.nextTaskNumber);
  });

  it("round-trips a Gantt block, de-namespacing its id and lane_id back to the board-internal form", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_eng", name: "Engineering" }],
      blocks: [{ id: "b2", taskCode: "A1020", label: "Detailed Design", category: "eng", milestone: false, duration: 2, startIdx: 5, laneId: "lane_eng", fontSize: 14, textColor: "#ffffff", bold: true }],
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.blocks).toEqual([
      { id: "b2", taskCode: "A1020", label: "Detailed Design", category: "eng", milestone: false, duration: 2, startIdx: 5, laneId: "lane_eng", fontSize: 14, textColor: "#ffffff", bold: true },
    ]);
    expect(result.lanes).toEqual([{ id: "lane_eng", name: "Engineering" }]);
  });

  it("round-trips a milestone with duration 0 and preserves its startIdx", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_ms", name: "Milestones" }],
      blocks: [{ id: "b1", taskCode: "A1010", label: "Kickoff", category: "gov", milestone: true, duration: 0, startIdx: 3, laneId: "lane_ms", fontSize: null, textColor: null, bold: true }],
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.blocks[0]).toMatchObject({ milestone: true, duration: 0, startIdx: 3 });
  });

  it("round-trips a dependency, de-namespacing predecessor/successor ids and preserving relationship type + lag", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_eng", name: "Engineering" }],
      blocks: [
        { id: "b1", taskCode: "A1010", label: "One", category: "eng", milestone: false, duration: 1, startIdx: 0, laneId: "lane_eng", fontSize: null, textColor: null, bold: true },
        { id: "b2", taskCode: "A1020", label: "Two", category: "eng", milestone: false, duration: 1, startIdx: 1, laneId: "lane_eng", fontSize: null, textColor: null, bold: true },
      ],
      dependencies: [{ id: "dep1", predecessorId: "b1", successorId: "b2", relationshipType: "SS", lagDays: 3 }],
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.dependencies).toEqual([{ id: "dep1", predecessorId: "b1", successorId: "b2", relationshipType: "SS", lagDays: 3 }]);
  });

  it("round-trips calendars, a lane's optional calendar override, and the project's default calendar", () => {
    const board = minimalBoard({
      calendars: [{ id: "cal_1", name: "5-10s", workingDays: [1, 2, 3, 4, 5] }],
      lanes: [{ id: "lane_1", name: "With calendar", calendarId: "cal_1" }, { id: "lane_2", name: "No calendar" }],
      defaultCalendarId: "cal_1",
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.calendars).toEqual([{ id: "cal_1", name: "5-10s", workingDays: [1, 2, 3, 4, 5] }]);
    expect(result.lanes[0]).toEqual({ id: "lane_1", name: "With calendar", calendarId: "cal_1" });
    expect(result.lanes[1]).toEqual({ id: "lane_2", name: "No calendar" });
    expect(result.defaultCalendarId).toBe("cal_1");
  });

  it("round-trips blackout windows unchanged", () => {
    const board = minimalBoard({ blackoutWindows: [{ id: "bw_1", label: "Holiday shutdown", startDate: "2026-12-24", endDate: "2026-12-26" }] });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.blackoutWindows).toEqual([{ id: "bw_1", label: "Holiday shutdown", startDate: "2026-12-24", endDate: "2026-12-26" }]);
  });

  it("round-trips WBS nodes (with parent/child nesting) and activities, keeping them out of board.blocks", () => {
    const board = minimalBoard({
      wbs: {
        nodes: [
          { id: "wbs_1", code: "1", name: "Root", parentId: null, order: 0 },
          { id: "wbs_2", code: "1.1", name: "Child", parentId: "wbs_1", order: 0 },
        ],
        activities: [{ id: "activity_1", code: "A1", wbsId: "wbs_2", name: "Design review", durationWeeks: 2, percentComplete: 40, order: 0 }],
      },
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.wbs.nodes).toEqual([
      { id: "wbs_1", code: "1", name: "Root", parentId: null, order: 0 },
      { id: "wbs_2", code: "1.1", name: "Child", parentId: "wbs_1", order: 0 },
    ]);
    expect(result.wbs.activities).toEqual([{ id: "activity_1", code: "A1", wbsId: "wbs_2", name: "Design review", durationWeeks: 2, percentComplete: 40, order: 0 }]);
    expect(result.blocks).toEqual([]);
  });

  it("de-namespaces ids correctly even when the legacy id itself contains underscores", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_5", name: "Gov" }],
      blocks: [{ id: "b1", taskCode: "A1010", label: "Kickoff", category: "gov", milestone: true, duration: 0, startIdx: 0, laneId: "lane_5", fontSize: null, textColor: null, bold: true }],
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const result = roundTrip(board, context);
    expect(result.blocks[0].laneId).toBe("lane_5");
    expect(result.lanes[0].id).toBe("lane_5");
  });

  it("sorts lanes back into their original sort_order on the way out", () => {
    const board = minimalBoard({
      lanes: [{ id: "lane_a", name: "A" }, { id: "lane_b", name: "B" }, { id: "lane_c", name: "C" }],
    });
    const context = { ownerId: OWNER_ID, projectId: PROJECT_ID, projectName: board.projectName, isPublic: false };
    const relational = boardToRelationalTables(board, context);
    // Shuffle the relational rows to prove reconstruction relies on sort_order, not array order.
    const shuffled = [relational.lanes[2], relational.lanes[0], relational.lanes[1]];
    const project = withResyncFields(relational.project, board);
    const result = relationalTablesToBoard({ ...relational, lanes: shuffled, project });
    expect(result.lanes.map((lane) => lane.id)).toEqual(["lane_a", "lane_b", "lane_c"]);
  });
});
