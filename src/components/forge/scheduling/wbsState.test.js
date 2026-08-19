import { describe, expect, it } from "vitest";
import { defaultBoardState } from "./schedulingBoardState";
import {
  MAX_WBS_DEPTH, activitiesForWbsNode, addActivity, addWbsNode, deleteWbsNode, moveActivity, moveWbsNode,
  removeActivity, renameWbsNodeCode, reorderWbsNode, renameWbsNode, updateActivity, wbsChildren, wbsNodeDepth, wbsTree,
} from "./wbsState";

function boardWithNode(name = "Site Work") {
  return addWbsNode(defaultBoardState(), { name });
}

describe("defaultBoardState wbs shape", () => {
  it("seeds an empty WBS on every new board", () => {
    const board = defaultBoardState();
    expect(board.wbs).toEqual({ nodes: [], activities: [] });
  });
});

describe("addWbsNode / renameWbsNode", () => {
  it("adds a root-level node", () => {
    const board = boardWithNode();
    expect(board.wbs.nodes).toHaveLength(1);
    expect(board.wbs.nodes[0]).toMatchObject({ name: "Site Work", parentId: null, order: 0 });
  });
  it("adds a child node under a given parent", () => {
    let board = boardWithNode();
    const parentId = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Grading", parentId });
    expect(board.wbs.nodes[1]).toMatchObject({ name: "Grading", parentId });
  });
  it("assigns increasing order among siblings, independently per parent", () => {
    let board = boardWithNode("A");
    board = addWbsNode(board, { name: "B" });
    expect(board.wbs.nodes.map((n) => n.order)).toEqual([0, 1]);
  });
  it("rejects an empty name", () => {
    const board = defaultBoardState();
    expect(addWbsNode(board, { name: "  " })).toBe(board);
  });
  it("renames a node, trimmed", () => {
    let board = boardWithNode();
    board = renameWbsNode(board, board.wbs.nodes[0].id, "  Sitework  ");
    expect(board.wbs.nodes[0].name).toBe("Sitework");
  });
  it("auto-assigns a dotted P6-style code based on position, but renameWbsNodeCode can freely overwrite it", () => {
    let board = boardWithNode("Phase 1");
    board = addWbsNode(board, { name: "Phase 2" });
    expect(board.wbs.nodes.map((n) => n.code)).toEqual(["1", "2"]);
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Sub", parentId: phase1 });
    expect(board.wbs.nodes[2].code).toBe("1.1");
    board = renameWbsNodeCode(board, phase1, "SITE-01");
    expect(board.wbs.nodes[0].code).toBe("SITE-01");
  });
});

describe("deleteWbsNode", () => {
  it("cascades to descendant nodes at any depth and their activities", () => {
    let board = boardWithNode("Phase 1");
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Sub-phase", parentId: phase1 });
    const subPhase = board.wbs.nodes[1].id;
    board = addActivity(board, subPhase, { name: "Dig footings", durationWeeks: 2 });
    board = deleteWbsNode(board, phase1);
    expect(board.wbs.nodes).toHaveLength(0);
    expect(board.wbs.activities).toHaveLength(0);
  });
  it("leaves unrelated nodes and activities alone", () => {
    let board = boardWithNode("Phase 1");
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Phase 2" });
    const phase2 = board.wbs.nodes[1].id;
    board = addActivity(board, phase2, { name: "Framing", durationWeeks: 3 });
    board = deleteWbsNode(board, phase1);
    expect(board.wbs.nodes).toHaveLength(1);
    expect(board.wbs.activities).toHaveLength(1);
  });
});

describe("moveWbsNode", () => {
  it("reparents a node under a new parent", () => {
    let board = boardWithNode("Phase 1");
    board = addWbsNode(board, { name: "Phase 2" });
    const [phase1, phase2] = board.wbs.nodes.map((n) => n.id);
    board = moveWbsNode(board, phase2, phase1);
    expect(board.wbs.nodes.find((n) => n.id === phase2).parentId).toBe(phase1);
  });
  it("moves a node back to the root with null", () => {
    let board = boardWithNode("Phase 1");
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Sub", parentId: phase1 });
    const sub = board.wbs.nodes[1].id;
    board = moveWbsNode(board, sub, null);
    expect(board.wbs.nodes.find((n) => n.id === sub).parentId).toBeNull();
  });
  it("refuses to move a node under itself", () => {
    const board = boardWithNode();
    const id = board.wbs.nodes[0].id;
    expect(moveWbsNode(board, id, id)).toBe(board);
  });
  it("refuses to move a node under its own descendant (would disconnect the branch)", () => {
    let board = boardWithNode("Phase 1");
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Sub", parentId: phase1 });
    const sub = board.wbs.nodes[1].id;
    const result = moveWbsNode(board, phase1, sub);
    expect(result).toBe(board);
  });
});

describe("reorderWbsNode", () => {
  it("swaps order with the next sibling when moving down", () => {
    let board = boardWithNode("A");
    board = addWbsNode(board, { name: "B" });
    const [a, b] = board.wbs.nodes.map((n) => n.id);
    board = reorderWbsNode(board, a, 1);
    expect(wbsChildren(board, null).map((n) => n.id)).toEqual([b, a]);
  });
  it("is a no-op at the start of the list moving up", () => {
    const board = boardWithNode();
    const id = board.wbs.nodes[0].id;
    expect(reorderWbsNode(board, id, -1)).toBe(board);
  });
});

describe("addActivity / updateActivity / removeActivity", () => {
  it("adds an activity under a WBS node, defaulting percentComplete to 0", () => {
    let board = boardWithNode();
    const wbsId = board.wbs.nodes[0].id;
    board = addActivity(board, wbsId, { name: "Excavate", durationWeeks: 2 });
    expect(activitiesForWbsNode(board, wbsId)).toMatchObject([{ name: "Excavate", durationWeeks: 2, percentComplete: 0 }]);
  });
  it("rejects an activity targeting a WBS node that doesn't exist", () => {
    const board = defaultBoardState();
    expect(addActivity(board, "wbs_missing", { name: "X" })).toBe(board);
  });
  it("assigns an activity code from the same A1010-style counter as Gantt blocks, and lets it be freely edited", () => {
    let board = boardWithNode();
    const wbsId = board.wbs.nodes[0].id;
    board = addActivity(board, wbsId, { name: "Excavate" });
    board = addActivity(board, wbsId, { name: "Pour footings" });
    expect(board.wbs.activities.map((a) => a.code)).toEqual(["A1010", "A1020"]);
    board = updateActivity(board, board.wbs.activities[0].id, { code: "EXC-01" });
    expect(board.wbs.activities[0].code).toBe("EXC-01");
  });
  it("clamps duration to at least 1 and percentComplete to 0-100", () => {
    let board = boardWithNode();
    const wbsId = board.wbs.nodes[0].id;
    board = addActivity(board, wbsId, { name: "Excavate", durationWeeks: 0 });
    expect(board.wbs.activities[0].durationWeeks).toBe(1);
    board = updateActivity(board, board.wbs.activities[0].id, { percentComplete: 150 });
    expect(board.wbs.activities[0].percentComplete).toBe(100);
    board = updateActivity(board, board.wbs.activities[0].id, { percentComplete: -10 });
    expect(board.wbs.activities[0].percentComplete).toBe(0);
  });
  it("removes an activity", () => {
    let board = boardWithNode();
    const wbsId = board.wbs.nodes[0].id;
    board = addActivity(board, wbsId, { name: "Excavate" });
    board = removeActivity(board, board.wbs.activities[0].id);
    expect(board.wbs.activities).toHaveLength(0);
  });
});

describe("moveActivity", () => {
  it("reassigns an activity to a different WBS node", () => {
    let board = boardWithNode("Phase 1");
    board = addWbsNode(board, { name: "Phase 2" });
    const [phase1, phase2] = board.wbs.nodes.map((n) => n.id);
    board = addActivity(board, phase1, { name: "Excavate" });
    board = moveActivity(board, board.wbs.activities[0].id, phase2);
    expect(board.wbs.activities[0].wbsId).toBe(phase2);
  });
  it("rejects moving to a WBS node that doesn't exist", () => {
    let board = boardWithNode();
    board = addActivity(board, board.wbs.nodes[0].id, { name: "Excavate" });
    const before = board;
    board = moveActivity(board, board.wbs.activities[0].id, "wbs_missing");
    expect(board).toBe(before);
  });
});

describe("wbsTree", () => {
  it("nests children and attaches each node's own activities", () => {
    let board = boardWithNode("Phase 1");
    const phase1 = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "Sub-phase", parentId: phase1 });
    const subPhase = board.wbs.nodes[1].id;
    board = addActivity(board, subPhase, { name: "Dig footings" });
    const tree = wbsTree(board);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Phase 1");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].activities).toMatchObject([{ name: "Dig footings" }]);
  });
});

describe("WBS depth limit", () => {
  function chainToDepth(board, depth) {
    let parentId = null;
    for (let i = 0; i <= depth; i += 1) {
      board = addWbsNode(board, { name: `Level ${i}`, parentId });
      parentId = board.wbs.nodes[board.wbs.nodes.length - 1].id;
    }
    return { board, deepestId: parentId };
  }

  it("allows chaining nodes up to MAX_WBS_DEPTH levels (depths 0 through MAX_WBS_DEPTH-1)", () => {
    const { board } = chainToDepth(defaultBoardState(), MAX_WBS_DEPTH - 1);
    expect(board.wbs.nodes).toHaveLength(MAX_WBS_DEPTH);
    const deepest = board.wbs.nodes[board.wbs.nodes.length - 1];
    expect(wbsNodeDepth(board, deepest.parentId) + 1).toBe(MAX_WBS_DEPTH - 1);
  });

  it("refuses to add a node one level past the limit", () => {
    const { board, deepestId } = chainToDepth(defaultBoardState(), MAX_WBS_DEPTH - 1);
    const result = addWbsNode(board, { name: "Too deep", parentId: deepestId });
    expect(result).toBe(board);
    expect(result.wbs.nodes).toHaveLength(MAX_WBS_DEPTH);
  });

  it("refuses to move (indent) a node under a parent that would push it past the limit", () => {
    const { board, deepestId } = chainToDepth(defaultBoardState(), MAX_WBS_DEPTH - 1);
    const withLooseNode = addWbsNode(board, { name: "Loose node" });
    const looseId = withLooseNode.wbs.nodes[withLooseNode.wbs.nodes.length - 1].id;
    const result = moveWbsNode(withLooseNode, looseId, deepestId);
    expect(result).toBe(withLooseNode);
  });

  it("refuses a move that would push an already-nested subtree past the limit, even if the moved node itself would be fine", () => {
    // Build a 3-deep chain (A -> B -> C) separately, then try to move A under something at
    // depth MAX_WBS_DEPTH-2 -- A itself would fit, but C (2 levels below A) would not.
    let board = defaultBoardState();
    board = addWbsNode(board, { name: "A" });
    const a = board.wbs.nodes[0].id;
    board = addWbsNode(board, { name: "B", parentId: a });
    const b = board.wbs.nodes[1].id;
    board = addWbsNode(board, { name: "C", parentId: b });
    const { board: deepBoard, deepestId } = chainToDepth(board, MAX_WBS_DEPTH - 3);
    const result = moveWbsNode(deepBoard, a, deepestId);
    expect(result).toBe(deepBoard);
  });
});
