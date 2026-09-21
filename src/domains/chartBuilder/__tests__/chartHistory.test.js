import { describe, expect, it } from "vitest";
import { createChartDocument, createNode } from "../chartDocument.js";
import { chartReducer } from "../chartReducer.js";
import {
  canRedoChart,
  canUndoChart,
  commitChartAction,
  emptyChartHistory,
  redoChart,
  undoChart,
} from "../chartHistory.js";

function baseDoc() {
  return createChartDocument({ id: "d", type: "org", nodes: [createNode({ id: "a", label: "A" })] });
}

function apply(history, doc, action, nodeLabel) {
  const { state, error } = chartReducer(doc, action);
  expect(error).toBeNull();
  return commitChartAction(history, nodeLabel, state);
}

describe("chartHistory", () => {
  it("do: commit advances present and records the entry", () => {
    let h = emptyChartHistory(baseDoc());
    expect(canUndoChart(h)).toBe(false);
    h = apply(h, h.present, { type: "ADD_NODE", node: createNode({ id: "b", label: "B" }) }, "add b");
    expect(h.present.nodes).toHaveLength(2);
    expect(h.past).toHaveLength(1);
    expect(h.past[0].action).toBe("add b");
    expect(h.past[0].before.nodes).toHaveLength(1);
    expect(h.past[0].after.nodes).toHaveLength(2);
    expect(canUndoChart(h)).toBe(true);
  });

  it("undo restores before and moves the entry to future", () => {
    let h = emptyChartHistory(baseDoc());
    h = apply(h, h.present, { type: "ADD_NODE", node: createNode({ id: "b", label: "B" }) }, "add b");
    const { history, present } = undoChart(h);
    expect(present.nodes).toHaveLength(1);
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(1);
    expect(canRedoChart(history)).toBe(true);
  });

  it("redo restores after", () => {
    let h = emptyChartHistory(baseDoc());
    h = apply(h, h.present, { type: "ADD_NODE", node: createNode({ id: "b", label: "B" }) }, "add b");
    const afterUndo = undoChart(h);
    const { history, present } = redoChart(afterUndo.history);
    expect(present.nodes).toHaveLength(2);
    expect(history.future).toHaveLength(0);
    expect(history.past).toHaveLength(1);
  });

  it("a new action clears the redo stack", () => {
    let h = emptyChartHistory(baseDoc());
    h = apply(h, h.present, { type: "ADD_NODE", node: createNode({ id: "b", label: "B" }) }, "add b");
    const afterUndo = undoChart(h);
    h = apply(afterUndo.history, afterUndo.present, {
      type: "ADD_NODE",
      node: createNode({ id: "c", label: "C" }),
    }, "add c");
    expect(h.present.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(h.future).toHaveLength(0);
    expect(canRedoChart(h)).toBe(false);
  });

  it("undo/redo with empty stacks are no-ops", () => {
    const h = emptyChartHistory(baseDoc());
    expect(undoChart(h).present).toBe(h.present);
    expect(redoChart(h).present).toBe(h.present);
  });
});
