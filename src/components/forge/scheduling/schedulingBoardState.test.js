import { describe, expect, it } from "vitest";
import {
  BASE_BLOCK_FONT_SIZE_PX, HISTORY_LIMIT, MIN_BLOCK_FONT_SIZE_PX,
  addBlock, addCustomChip, addDependency, addLane, blockAnchorPoint, blockToChip, chipsByCategory, computeWeeks,
  deleteLane, defaultBoardState, dependenciesForBlock, dependencyArrowPoints, deserializeBoardState, emptyHistory,
  fitBlockFontSizePx, fitWeekWidthPx, generateProjectId, linkBlocksInOrder, moveBlock, moveBlocksBy,
  occupiedWeekIndices, projectSummaryFromBoard, projectStorageKey, recordHistory, redoHistory, removeBlock,
  removeDependency, renameBlock, renameLane, resizeBlock, resizeBlockFromStart, serializeBoardState,
  setBlockTextStyle, setProjectDates, suggestPredecessors, undoHistory, visibleWeekIndices,
} from "./schedulingBoardState";

const CHIP = { label: "Kickoff", category: "gov", durationWeeks: 0, milestone: true };
const TASK_CHIP = { label: "Detailed Design", category: "eng", durationWeeks: 8, milestone: false };

describe("computeWeeks", () => {
  it("returns one column per week, inclusive of the end date's week", () => {
    expect(computeWeeks("2026-01-01", "2026-01-22")).toEqual(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]);
  });
  it("returns at least the start date when the range is shorter than a week", () => {
    expect(computeWeeks("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });
});

describe("defaultBoardState", () => {
  it("seeds the default 7 lanes and an empty block list", () => {
    const state = defaultBoardState();
    expect(state.lanes).toHaveLength(7);
    expect(state.blocks).toHaveLength(0);
  });
  it("generates a fresh id and createdAt/updatedAt timestamps when none is given", () => {
    const a = defaultBoardState();
    const b = defaultBoardState();
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id); // each new project gets its own identity
    expect(a.createdAt).toBe(a.updatedAt); // freshly created: never modified since
  });
  it("uses the given id instead of generating one", () => {
    expect(defaultBoardState("schedule_project_fixed").id).toBe("schedule_project_fixed");
  });
});

describe("generateProjectId", () => {
  it("produces a project-prefixed, unique id", () => {
    expect(generateProjectId()).toMatch(/^schedule_project_/);
    expect(generateProjectId()).not.toBe(generateProjectId());
  });
});

describe("projectStorageKey", () => {
  it("namespaces a project id for localStorage", () => {
    expect(projectStorageKey("schedule_project_1")).toBe("forge-scheduling-project:schedule_project_1");
  });
});

describe("projectSummaryFromBoard", () => {
  it("projects just the columns the Projects list shows", () => {
    const board = defaultBoardState("schedule_project_1");
    expect(projectSummaryFromBoard(board)).toEqual({
      id: "schedule_project_1", name: board.projectName, startDate: board.startDate,
      endDate: board.endDate, createdAt: board.createdAt, updatedAt: board.updatedAt,
    });
  });
});

describe("addBlock", () => {
  it("places a milestone chip at zero duration on the target lane", () => {
    const state = addBlock(defaultBoardState(), CHIP, 2, 0);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ label: "Kickoff", milestone: true, duration: 0, startIdx: 2, laneId: "lane_ms" });
  });
  it("does not mutate the original state", () => {
    const original = defaultBoardState();
    addBlock(original, CHIP, 0, 0);
    expect(original.blocks).toHaveLength(0);
  });
  it("clamps a lane index beyond the last lane", () => {
    const state = addBlock(defaultBoardState(), CHIP, 0, 99);
    expect(state.blocks[0].laneId).toBe("lane_shut");
  });
  it("assigns increasing ids across multiple placements", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0);
    state = addBlock(state, TASK_CHIP, 1, 1);
    expect(state.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
  it("assigns an immutable, sequential task code to every block", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0);
    state = addBlock(state, TASK_CHIP, 1, 1);
    expect(state.blocks.map((b) => b.taskCode)).toEqual(["A1010", "A1020"]);
  });
  it("never reuses a task code once a block is deleted", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0); // A1010
    state = removeBlock(state, "b1");
    state = addBlock(state, TASK_CHIP, 0, 0);
    expect(state.blocks[0].taskCode).toBe("A1020");
  });
});

describe("moveBlock", () => {
  it("updates the block's week index and lane", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    state = moveBlock(state, "b1", 5, 2);
    expect(state.blocks[0]).toMatchObject({ startIdx: 5, laneId: "lane_eng" });
  });
  it("never lets a block move before the first week", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 3, 0);
    state = moveBlock(state, "b1", -4, 0);
    expect(state.blocks[0].startIdx).toBe(0);
  });
});

describe("resizeBlock", () => {
  it("enforces a minimum duration of one week", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    state = resizeBlock(state, "b1", -3);
    expect(state.blocks[0].duration).toBe(1);
  });
  it("never resizes a milestone", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0);
    state = resizeBlock(state, "b1", 5);
    expect(state.blocks[0].duration).toBe(0);
  });
});

describe("resizeBlockFromStart", () => {
  it("moves the start earlier and grows duration, keeping the finish week fixed", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4 }, 10, 0); // weeks 10-14
    state = resizeBlockFromStart(state, "b1", 6);
    expect(state.blocks[0]).toMatchObject({ startIdx: 6, duration: 8 }); // still finishes at week 14
  });
  it("moves the start later and shrinks duration, keeping the finish week fixed", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4 }, 10, 0); // weeks 10-14
    state = resizeBlockFromStart(state, "b1", 12);
    expect(state.blocks[0]).toMatchObject({ startIdx: 12, duration: 2 });
  });
  it("never lets the start reach or pass the finish week (minimum 1 week duration)", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4 }, 10, 0); // finishes at week 14
    state = resizeBlockFromStart(state, "b1", 20);
    expect(state.blocks[0]).toMatchObject({ startIdx: 13, duration: 1 });
  });
  it("never lets the start go before the first week", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4 }, 10, 0);
    state = resizeBlockFromStart(state, "b1", -50);
    expect(state.blocks[0]).toMatchObject({ startIdx: 0, duration: 14 });
  });
  it("never resizes a milestone", () => {
    let state = addBlock(defaultBoardState(), CHIP, 5, 0);
    state = resizeBlockFromStart(state, "b1", 0);
    expect(state.blocks[0]).toMatchObject({ startIdx: 5, duration: 0 });
  });
});

describe("renameBlock / removeBlock", () => {
  it("renames a block, ignoring blank input", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    expect(renameBlock(state, "b1", "  ").blocks[0].label).toBe("Detailed Design");
    expect(renameBlock(state, "b1", "Redesign").blocks[0].label).toBe("Redesign");
  });
  it("removes a block by id", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    expect(removeBlock(state, "b1").blocks).toHaveLength(0);
  });
});

describe("lane management", () => {
  it("appends a lane with a generated id when no index is given", () => {
    const state = addLane(defaultBoardState(), "Commissioning");
    expect(state.lanes.at(-1)).toMatchObject({ name: "Commissioning" });
  });
  it("inserts a lane between two existing lanes at the given index", () => {
    const state = addLane(defaultBoardState(), "Site Prep", 2); // between lane_gov and lane_eng
    expect(state.lanes.map((l) => l.name)).toEqual([
      "Milestones", "Governance", "Site Prep", "Engineering", "Procurement",
      "Field Execution", "Field Execution (cont.)", "Shutdown & Startup",
    ]);
  });
  it("inserts as the new first lane at index 0", () => {
    const state = addLane(defaultBoardState(), "Pre-Kickoff", 0);
    expect(state.lanes[0].name).toBe("Pre-Kickoff");
    expect(state.lanes).toHaveLength(8);
  });
  it("clamps an out-of-range index to the end", () => {
    const state = addLane(defaultBoardState(), "Overflow", 999);
    expect(state.lanes.at(-1).name).toBe("Overflow");
  });
  it("renames a lane", () => {
    const state = renameLane(defaultBoardState(), "lane_gov", "Governance & Controls");
    expect(state.lanes.find((l) => l.id === "lane_gov").name).toBe("Governance & Controls");
  });
  it("deleting a lane also removes any blocks placed on it", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, category: "gov" }, 0, 1); // lane_gov
    state = deleteLane(state, "lane_gov");
    expect(state.lanes.some((l) => l.id === "lane_gov")).toBe(false);
    expect(state.blocks).toHaveLength(0);
  });
  it("deleting a lane also removes dependencies touching any block it took with it", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0); // lane_ms, b1
    state = addBlock(state, { ...TASK_CHIP, category: "gov" }, 1, 1); // lane_gov, b2
    state = addDependency(state, "b1", "b2");
    state = deleteLane(state, "lane_gov");
    expect(state.dependencies).toHaveLength(0);
  });
});

describe("addCustomChip", () => {
  it("adds a chip to the palette under its category", () => {
    const state = addCustomChip(defaultBoardState(), { label: "Site Survey", category: "field", durationWeeks: 2, milestone: false });
    expect(chipsByCategory(state).field.some((chip) => chip.label === "Site Survey")).toBe(true);
  });
  it("rejects an unknown category", () => {
    const state = addCustomChip(defaultBoardState(), { label: "Bad", category: "nope", durationWeeks: 1, milestone: false });
    expect(state.customChips).toHaveLength(0);
  });
});

describe("setProjectDates", () => {
  it("rejects an end date on or before the start date", () => {
    const state = defaultBoardState();
    expect(setProjectDates(state, "2026-06-01", "2026-06-01")).toBe(state);
    expect(setProjectDates(state, "2026-06-10", "2026-06-01")).toBe(state);
  });
  it("applies a valid range", () => {
    const state = setProjectDates(defaultBoardState(), "2026-01-01", "2026-12-31");
    expect(state).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31" });
  });
});

describe("serializeBoardState / deserializeBoardState", () => {
  it("round-trips a board including placed blocks and custom chips", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 1, 1);
    state = addCustomChip(state, { label: "Site Survey", category: "field", durationWeeks: 2, milestone: false });
    const restored = deserializeBoardState(serializeBoardState(state));
    expect(restored.blocks).toEqual(state.blocks);
    expect(restored.customChips).toEqual(state.customChips);
  });
  it("backfills missing fields from the default state on import", () => {
    const restored = deserializeBoardState(JSON.stringify({ projectName: "Imported" }));
    expect(restored.projectName).toBe("Imported");
    expect(restored.lanes).toHaveLength(7);
  });
  it("keeps a project's own id and timestamps across a save/load round-trip", () => {
    const state = defaultBoardState("schedule_project_fixed");
    const restored = deserializeBoardState(serializeBoardState(state));
    expect(restored.id).toBe("schedule_project_fixed");
    expect(restored.createdAt).toBe(state.createdAt);
  });
  it("generates an id and timestamps for a save from before they existed", () => {
    const restored = deserializeBoardState(JSON.stringify({ projectName: "Legacy save" }));
    expect(restored.id).toBeTruthy();
    expect(restored.createdAt).toBeTruthy();
    expect(restored.updatedAt).toBeTruthy();
  });
});

describe("blockToChip", () => {
  it("converts a placed task block back into pasteable chip shape", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 2, 1);
    expect(blockToChip(state.blocks[0])).toEqual({
      label: "Detailed Design", category: "eng", milestone: false, durationWeeks: 8,
      fontSize: null, textColor: null, bold: true,
    });
  });
  it("keeps a milestone's duration at zero", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0);
    expect(blockToChip(state.blocks[0])).toEqual({
      label: "Kickoff", category: "gov", milestone: true, durationWeeks: 0,
      fontSize: null, textColor: null, bold: true,
    });
  });
  it("preserves a copied block's text style so paste keeps its formatting", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    state = setBlockTextStyle(state, ["b1"], { fontSize: 18, textColor: "#dc2626", bold: false });
    expect(blockToChip(state.blocks[0])).toMatchObject({ fontSize: 18, textColor: "#dc2626", bold: false });
  });
  it("round-trips through addBlock so a copied block can be pasted back in", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    const chip = blockToChip(state.blocks[0]);
    state = addBlock(state, chip, 10, 1);
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[1]).toMatchObject({ label: "Detailed Design", duration: 8, startIdx: 10, laneId: "lane_gov" });
  });
});

function twoBlockState() {
  let state = addBlock(defaultBoardState(), { ...TASK_CHIP, category: "gov" }, 0, 1); // b1, lane_gov, weeks 0-8
  state = addBlock(state, { ...TASK_CHIP, category: "eng" }, 10, 2); // b2, lane_eng, weeks 10-18
  return state;
}

describe("addDependency / removeDependency / dependenciesForBlock", () => {
  it("links a predecessor to a successor", () => {
    const state = addDependency(twoBlockState(), "b1", "b2", "FS", 2);
    expect(state.dependencies).toHaveLength(1);
    expect(state.dependencies[0]).toMatchObject({ predecessorId: "b1", successorId: "b2", relationshipType: "FS", lagDays: 2 });
  });
  it("rejects a block linking to itself", () => {
    const state = twoBlockState();
    expect(addDependency(state, "b1", "b1")).toBe(state);
  });
  it("rejects an unsupported relationship type", () => {
    const state = twoBlockState();
    expect(addDependency(state, "b1", "b2", "NOPE")).toBe(state);
  });
  it("rejects a link to a block that doesn't exist", () => {
    const state = twoBlockState();
    expect(addDependency(state, "b1", "b99")).toBe(state);
  });
  it("rejects an exact duplicate link", () => {
    let state = addDependency(twoBlockState(), "b1", "b2");
    state = addDependency(state, "b1", "b2");
    expect(state.dependencies).toHaveLength(1);
  });
  it("removes a dependency by id", () => {
    let state = addDependency(twoBlockState(), "b1", "b2");
    const depId = state.dependencies[0].id;
    expect(removeDependency(state, depId).dependencies).toHaveLength(0);
  });
  it("splits predecessors and successors for a given block", () => {
    let state = addBlock(twoBlockState(), { ...TASK_CHIP, category: "proc" }, 20, 3); // b3
    state = addDependency(state, "b1", "b2");
    state = addDependency(state, "b2", "b3");
    const { predecessors, successors } = dependenciesForBlock(state, "b2");
    expect(predecessors).toHaveLength(1);
    expect(predecessors[0].predecessorId).toBe("b1");
    expect(successors).toHaveLength(1);
    expect(successors[0].successorId).toBe("b3");
  });
});

describe("removeBlock cascades to its dependencies", () => {
  it("drops any dependency touching the removed block", () => {
    let state = addDependency(twoBlockState(), "b1", "b2");
    state = removeBlock(state, "b1");
    expect(state.dependencies).toHaveLength(0);
  });
});

describe("suggestPredecessors", () => {
  it("suggests a same-lane block that finishes at the new block's start", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4, category: "eng" }, 0, 2); // b1: weeks 0-4, lane_eng
    state = addBlock(state, { ...TASK_CHIP, category: "eng" }, 4, 2); // b2: starts week 4, lane_eng
    const suggestions = suggestPredecessors(state, "b2");
    expect(suggestions.map((b) => b.id)).toEqual(["b1"]);
  });
  it("suggests an adjacent-lane block but not one two lanes away", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4, category: "gov" }, 0, 1); // b1: lane_gov
    state = addBlock(state, { ...TASK_CHIP, durationWeeks: 4, category: "shut" }, 0, 6); // b2: lane_shut, far away
    state = addBlock(state, { ...TASK_CHIP, category: "eng" }, 4, 2); // b3: lane_eng (adjacent to lane_gov)
    const suggestions = suggestPredecessors(state, "b3");
    expect(suggestions.map((b) => b.id)).toEqual(["b1"]);
  });
  it("excludes candidates outside the finish-proximity threshold", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4, category: "eng" }, 0, 2); // finishes week 4
    state = addBlock(state, { ...TASK_CHIP, category: "eng" }, 10, 2); // starts week 10 -- far from week 4
    expect(suggestPredecessors(state, "b2")).toHaveLength(0);
  });
  it("never suggests the block itself or an already-linked predecessor", () => {
    let state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 4, category: "eng" }, 0, 2);
    state = addBlock(state, { ...TASK_CHIP, category: "eng" }, 4, 2);
    state = addDependency(state, "b1", "b2");
    expect(suggestPredecessors(state, "b2")).toHaveLength(0);
    expect(suggestPredecessors(state, "b1").some((b) => b.id === "b1")).toBe(false);
  });
});

describe("blockAnchorPoint / dependencyArrowPoints", () => {
  it("anchors a milestone at the horizontal center of its week cell", () => {
    const milestone = { startIdx: 2, milestone: true, duration: 0 };
    expect(blockAnchorPoint(milestone, 0, 90, "start")).toEqual({ x: 2 * 90 + 45, y: 23 });
    expect(blockAnchorPoint(milestone, 0, 90, "finish")).toEqual({ x: 2 * 90 + 45, y: 23 });
  });
  it("anchors a task's start/finish edges to match how it's rendered", () => {
    const task = { startIdx: 1, milestone: false, duration: 3 };
    expect(blockAnchorPoint(task, 1, 90, "start")).toEqual({ x: 1 * 90 + 2, y: 46 + 23 });
    expect(blockAnchorPoint(task, 1, 90, "finish")).toEqual({ x: 4 * 90 - 2, y: 46 + 23 });
  });
  it("connects predecessor-finish to successor-start for an FS link", () => {
    const state = addDependency(twoBlockState(), "b1", "b2", "FS");
    const points = dependencyArrowPoints(state, state.dependencies[0], 90);
    const predecessor = blockAnchorPoint(state.blocks[0], 1, 90, "finish");
    const successor = blockAnchorPoint(state.blocks[1], 2, 90, "start");
    expect(points).toEqual({ x1: predecessor.x, y1: predecessor.y, x2: successor.x, y2: successor.y });
  });
  it("connects start-to-start for an SS link", () => {
    const state = addDependency(twoBlockState(), "b1", "b2", "SS");
    const points = dependencyArrowPoints(state, state.dependencies[0], 90);
    const predecessor = blockAnchorPoint(state.blocks[0], 1, 90, "start");
    const successor = blockAnchorPoint(state.blocks[1], 2, 90, "start");
    expect(points).toEqual({ x1: predecessor.x, y1: predecessor.y, x2: successor.x, y2: successor.y });
  });
  it("returns null when either linked block no longer exists", () => {
    const state = addDependency(twoBlockState(), "b1", "b2");
    const stale = removeBlock(state, "b2");
    const dependency = state.dependencies[0]; // stale.dependencies is already empty via cascade, so use the pre-removal record
    expect(dependencyArrowPoints(stale, dependency, 90)).toBeNull();
  });
});

describe("fitBlockFontSizePx", () => {
  it("keeps the base size when a short label comfortably fits", () => {
    expect(fitBlockFontSizePx("Kickoff", 86, 36)).toBe(BASE_BLOCK_FONT_SIZE_PX);
  });
  it("shrinks a long label on a narrow bar", () => {
    const size = fitBlockFontSizePx("Long-Lead Equipment Fabrication", 86, 36);
    expect(size).toBeLessThan(BASE_BLOCK_FONT_SIZE_PX);
    expect(size).toBeGreaterThanOrEqual(MIN_BLOCK_FONT_SIZE_PX);
  });
  it("never returns smaller than the floor even for an extremely narrow bar", () => {
    expect(fitBlockFontSizePx("Long-Lead Equipment Fabrication", 20, 20)).toBe(MIN_BLOCK_FONT_SIZE_PX);
  });
  it("shrinks further as the same label gets a narrower box", () => {
    const wide = fitBlockFontSizePx("Detailed Design", 200, 36);
    const narrow = fitBlockFontSizePx("Detailed Design", 60, 36);
    expect(narrow).toBeLessThanOrEqual(wide);
  });
  it("treats a blank label as fully fitting", () => {
    expect(fitBlockFontSizePx("", 10, 10)).toBe(BASE_BLOCK_FONT_SIZE_PX);
  });
});

describe("linkBlocksInOrder", () => {
  it("chains consecutive pairs in exactly the given order, not a fan-out from the first block", () => {
    let state = twoBlockState();
    state = addBlock(state, { ...TASK_CHIP, category: "proc" }, 20, 3); // b3
    state = linkBlocksInOrder(state, ["b1", "b2", "b3"]);
    expect(state.dependencies).toHaveLength(2);
    expect(state.dependencies.map((d) => [d.predecessorId, d.successorId])).toEqual([["b1", "b2"], ["b2", "b3"]]);
  });
  it("defaults to a Finish-to-Start link with no lag", () => {
    const state = linkBlocksInOrder(twoBlockState(), ["b1", "b2"]);
    expect(state.dependencies[0]).toMatchObject({ relationshipType: "FS", lagDays: 0 });
  });
  it("honors an explicit relationship type and lag", () => {
    const state = linkBlocksInOrder(twoBlockState(), ["b1", "b2"], "SS", 3);
    expect(state.dependencies[0]).toMatchObject({ relationshipType: "SS", lagDays: 3 });
  });
  it("does nothing for fewer than two blocks", () => {
    const state = twoBlockState();
    expect(linkBlocksInOrder(state, ["b1"])).toBe(state);
    expect(linkBlocksInOrder(state, [])).toBe(state);
  });
  it("skips a pair that's already linked instead of erroring, and still links the rest", () => {
    let state = addDependency(twoBlockState(), "b1", "b2");
    state = addBlock(state, { ...TASK_CHIP, category: "proc" }, 20, 3);
    const thirdBlockId = state.blocks.at(-1).id; // the shared id counter advanced past "b3" when the dependency above was created
    state = linkBlocksInOrder(state, ["b1", "b2", thirdBlockId]);
    expect(state.dependencies).toHaveLength(2); // the pre-existing b1->b2, plus the new b2->thirdBlockId
  });
});

describe("moveBlocksBy", () => {
  it("shifts every listed block by the same week and lane delta", () => {
    // b1: lane_gov (idx 1), startIdx 0 -- b2: lane_eng (idx 2), startIdx 10
    const state = moveBlocksBy(twoBlockState(), ["b1", "b2"], 3, 1);
    expect(state.blocks[0]).toMatchObject({ startIdx: 3, laneId: "lane_eng" }); // idx 1+1=2
    expect(state.blocks[1]).toMatchObject({ startIdx: 13, laneId: "lane_proc" }); // idx 2+1=3
  });
  it("preserves the group's relative week and lane spacing", () => {
    const before = twoBlockState();
    const after = moveBlocksBy(before, ["b1", "b2"], 3, 1);
    const laneGap = (block, state) => state.lanes.findIndex((l) => l.id === block.laneId);
    const beforeWeekGap = before.blocks[1].startIdx - before.blocks[0].startIdx;
    const afterWeekGap = after.blocks[1].startIdx - after.blocks[0].startIdx;
    const beforeLaneGap = laneGap(before.blocks[1], before) - laneGap(before.blocks[0], before);
    const afterLaneGap = laneGap(after.blocks[1], after) - laneGap(after.blocks[0], after);
    expect(afterWeekGap).toBe(beforeWeekGap);
    expect(afterLaneGap).toBe(beforeLaneGap);
  });
  it("leaves blocks outside the group untouched", () => {
    let state = addBlock(twoBlockState(), { ...TASK_CHIP, category: "proc" }, 20, 3);
    const untouchedId = state.blocks.at(-1).id;
    state = moveBlocksBy(state, ["b1", "b2"], 5, 0);
    expect(state.blocks.find((b) => b.id === untouchedId).startIdx).toBe(20);
  });
  it("never lets a shifted block go before the first week", () => {
    const state = moveBlocksBy(twoBlockState(), ["b1"], -10, 0);
    expect(state.blocks[0].startIdx).toBe(0);
  });
  it("clamps a lane shift at the first and last lane", () => {
    const state = moveBlocksBy(twoBlockState(), ["b1", "b2"], 0, -99);
    expect(state.blocks.every((block) => block.laneId === "lane_ms")).toBe(true);
    const shiftedFar = moveBlocksBy(twoBlockState(), ["b1", "b2"], 0, 99);
    expect(shiftedFar.blocks.every((block) => block.laneId === "lane_shut")).toBe(true);
  });
});

describe("addBlock text style defaults", () => {
  it("defaults every new block to the unstyled state", () => {
    const state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    expect(state.blocks[0]).toMatchObject({ fontSize: null, textColor: null, bold: true });
  });
});

describe("setBlockTextStyle", () => {
  it("applies a partial patch to every listed block", () => {
    const state = setBlockTextStyle(twoBlockState(), ["b1", "b2"], { bold: false });
    expect(state.blocks.every((block) => block.bold === false)).toBe(true);
  });
  it("only touches the fields provided in the patch", () => {
    let state = setBlockTextStyle(twoBlockState(), ["b1"], { textColor: "#dc2626" });
    state = setBlockTextStyle(state, ["b1"], { bold: false });
    expect(state.blocks[0]).toMatchObject({ textColor: "#dc2626", bold: false, fontSize: null });
  });
  it("leaves blocks outside the target list unchanged", () => {
    const state = setBlockTextStyle(twoBlockState(), ["b1"], { bold: false });
    expect(state.blocks[1].bold).toBe(true);
  });
  it("is a no-op for an empty selection or an empty patch", () => {
    const state = twoBlockState();
    expect(setBlockTextStyle(state, [], { bold: false })).toBe(state);
    expect(setBlockTextStyle(state, ["b1"], {})).toBe(state);
  });
  it("allows explicitly resetting a color back to default (null)", () => {
    let state = setBlockTextStyle(twoBlockState(), ["b1"], { textColor: "#dc2626" });
    state = setBlockTextStyle(state, ["b1"], { textColor: null });
    expect(state.blocks[0].textColor).toBeNull();
  });
});

describe("fitBlockFontSizePx with a preferred base size", () => {
  it("uses the preferred size instead of the constant default when it fits", () => {
    expect(fitBlockFontSizePx("Kickoff", 200, 36, 18)).toBe(18);
  });
  it("still shrinks a large preferred size toward the floor on a narrow bar", () => {
    const size = fitBlockFontSizePx("Long-Lead Equipment Fabrication", 46, 20, 18);
    expect(size).toBeLessThan(18);
    expect(size).toBeGreaterThanOrEqual(MIN_BLOCK_FONT_SIZE_PX);
  });
  it("falls back to the constant default for an invalid preferred size", () => {
    expect(fitBlockFontSizePx("Kickoff", 200, 36, null)).toBe(BASE_BLOCK_FONT_SIZE_PX);
    expect(fitBlockFontSizePx("Kickoff", 200, 36, 0)).toBe(BASE_BLOCK_FONT_SIZE_PX);
  });
});

describe("occupiedWeekIndices / visibleWeekIndices", () => {
  it("marks only a milestone's own week as occupied", () => {
    const state = addBlock(defaultBoardState(), CHIP, 5, 0);
    expect([...occupiedWeekIndices(state)]).toEqual([5]);
  });
  it("marks a task's full span as occupied, not just its start week", () => {
    const state = addBlock(defaultBoardState(), { ...TASK_CHIP, durationWeeks: 3 }, 2, 1);
    expect([...occupiedWeekIndices(state)].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });
  it("returns only occupied indices, in ascending order, within a given week count", () => {
    let state = addBlock(defaultBoardState(), CHIP, 1, 0);
    state = addBlock(state, { ...TASK_CHIP, durationWeeks: 2 }, 8, 1);
    expect(visibleWeekIndices(state, 12)).toEqual([1, 8, 9]);
  });
  it("returns an empty list for a board with no blocks", () => {
    expect(visibleWeekIndices(defaultBoardState(), 52)).toEqual([]);
  });
});

describe("fitWeekWidthPx", () => {
  it("divides the available width evenly across the column count", () => {
    expect(fitWeekWidthPx(900, 30)).toBe(30);
  });
  it("floors a non-exact division", () => {
    expect(fitWeekWidthPx(100, 3)).toBe(33);
  });
  it("never returns below the given minimum, even for a huge column count", () => {
    expect(fitWeekWidthPx(900, 5000)).toBe(1);
    expect(fitWeekWidthPx(900, 5000, 4)).toBe(4);
  });
  it("falls back to the minimum for invalid inputs", () => {
    expect(fitWeekWidthPx(0, 30)).toBe(1);
    expect(fitWeekWidthPx(900, 0)).toBe(1);
    expect(fitWeekWidthPx(NaN, 30, 6)).toBe(6);
  });
});

describe("undo/redo history", () => {
  it("starts empty", () => {
    expect(emptyHistory()).toEqual({ past: [], future: [] });
  });

  it("records the replaced board onto the undo stack and clears redo", () => {
    let history = emptyHistory();
    history = recordHistory(history, "board-v1");
    expect(history.past).toEqual(["board-v1"]);
    expect(history.future).toEqual([]);
  });

  it("a new edit clears any existing redo history", () => {
    let history = recordHistory(emptyHistory(), "board-v1");
    history = { ...history, future: Object.freeze(["board-v3"]) }; // pretend an undo happened
    history = recordHistory(history, "board-v2");
    expect(history.future).toEqual([]);
  });

  it("undo moves the top of the undo stack to current, pushing current onto redo", () => {
    let history = recordHistory(emptyHistory(), "board-v1");
    const result = undoHistory(history, "board-v2");
    expect(result.board).toBe("board-v1");
    expect(result.history.past).toEqual([]);
    expect(result.history.future).toEqual(["board-v2"]);
  });

  it("is a no-op when there's nothing to undo", () => {
    const history = emptyHistory();
    const result = undoHistory(history, "board-current");
    expect(result.board).toBe("board-current");
    expect(result.history).toBe(history);
  });

  it("redo moves the front of the redo stack back to current, pushing current onto undo", () => {
    const history = Object.freeze({ past: Object.freeze([]), future: Object.freeze(["board-v2"]) });
    const result = redoHistory(history, "board-v1");
    expect(result.board).toBe("board-v2");
    expect(result.history.past).toEqual(["board-v1"]);
    expect(result.history.future).toEqual([]);
  });

  it("is a no-op when there's nothing to redo", () => {
    const history = emptyHistory();
    const result = redoHistory(history, "board-current");
    expect(result.board).toBe("board-current");
    expect(result.history).toBe(history);
  });

  it("undo followed by redo round-trips back to the original board", () => {
    let history = recordHistory(emptyHistory(), "board-v1");
    const undone = undoHistory(history, "board-v2");
    const redone = redoHistory(undone.history, undone.board);
    expect(redone.board).toBe("board-v2");
  });

  it("caps the undo stack at HISTORY_LIMIT, dropping the oldest entries first", () => {
    let history = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = recordHistory(history, `board-v${i}`);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe("board-v5"); // the oldest 5 were dropped
    expect(history.past.at(-1)).toBe(`board-v${HISTORY_LIMIT + 4}`);
  });

  it("caps the redo stack at HISTORY_LIMIT too", () => {
    let history = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = recordHistory(history, `board-v${i}`);
    let current = `board-v${HISTORY_LIMIT + 5}`;
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      const result = undoHistory(history, current);
      history = result.history;
      current = result.board;
    }
    expect(history.future.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });
});
