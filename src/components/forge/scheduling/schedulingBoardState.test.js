import { describe, expect, it } from "vitest";
import {
  addBlock, addCustomChip, addLane, blockToChip, chipsByCategory, computeWeeks, deleteLane, defaultBoardState,
  deserializeBoardState, moveBlock, removeBlock, renameBlock, renameLane, resizeBlock, serializeBoardState,
  setProjectDates,
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
});

describe("blockToChip", () => {
  it("converts a placed task block back into pasteable chip shape", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 2, 1);
    expect(blockToChip(state.blocks[0])).toEqual({ label: "Detailed Design", category: "eng", milestone: false, durationWeeks: 8 });
  });
  it("keeps a milestone's duration at zero", () => {
    let state = addBlock(defaultBoardState(), CHIP, 0, 0);
    expect(blockToChip(state.blocks[0])).toEqual({ label: "Kickoff", category: "gov", milestone: true, durationWeeks: 0 });
  });
  it("round-trips through addBlock so a copied block can be pasted back in", () => {
    let state = addBlock(defaultBoardState(), TASK_CHIP, 0, 0);
    const chip = blockToChip(state.blocks[0]);
    state = addBlock(state, chip, 10, 1);
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[1]).toMatchObject({ label: "Detailed Design", duration: 8, startIdx: 10, laneId: "lane_gov" });
  });
});
