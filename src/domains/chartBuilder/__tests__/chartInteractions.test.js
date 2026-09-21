import { describe, expect, it } from "vitest";
import {
  createChartDocument,
  createEdge,
  createNode,
  nodeSupervisor,
  resolveCanvasDrop,
} from "../index.js";

function orgDoc() {
  return createChartDocument({
    id: "org",
    type: "org",
    nodes: [
      createNode({ id: "ceo", label: "CEO" }),
      createNode({ id: "vp", label: "VP" }),
      createNode({ id: "mgr", label: "Mgr" }),
    ],
    edges: [
      createEdge({ id: "e1", from: "ceo", to: "vp", type: "supervisor" }),
      createEdge({ id: "e2", from: "vp", to: "mgr", type: "supervisor" }),
    ],
  });
}

function workflowDoc() {
  return createChartDocument({
    id: "wf",
    type: "workflow",
    nodes: [
      createNode({ id: "s", label: "Start" }),
      createNode({ id: "e", label: "End" }),
    ],
    edges: [createEdge({ id: "e1", from: "s", to: "e", type: "sequence" })],
  });
}

describe("canvas drop resolution", () => {
  it("reparents when dropped on another node (org)", () => {
    const doc = orgDoc();
    const result = resolveCanvasDrop(doc, {
      nodeId: "mgr",
      position: { x: 400, y: 300 },
      dropTargetId: "ceo",
    });
    expect(result.error).toBe(null);
    expect(result.reparented).toBe(true);
    expect(result.reparentError).toBe(null);
    expect(nodeSupervisor(result.state, "mgr")?.id).toBe("ceo");
  });

  it("rejects a drop that would create a cycle and keeps the document intact", () => {
    const doc = orgDoc();
    // Dropping the CEO onto their own descendant (mgr) must not reparent.
    const result = resolveCanvasDrop(doc, {
      nodeId: "ceo",
      position: { x: 10, y: 20 },
      dropTargetId: "mgr",
    });
    expect(result.reparented).toBe(false);
    expect(result.reparentError).toMatch(/cycle/);
    // The hierarchy is unchanged: ceo still has no supervisor, vp still
    // reports to ceo.
    expect(nodeSupervisor(result.state, "ceo")).toBe(null);
    expect(nodeSupervisor(result.state, "vp")?.id).toBe("ceo");
    expect(result.state.edges).toHaveLength(2);
    // The drag position still applied (the canvas shows where it was dropped).
    expect(
      result.state.nodes.find((n) => n.id === "ceo").position
    ).toEqual({ x: 10, y: 20 });
  });

  it("rejects dropping a node onto itself as a reparent", () => {
    const doc = orgDoc();
    const result = resolveCanvasDrop(doc, {
      nodeId: "vp",
      position: { x: 5, y: 5 },
      dropTargetId: "vp",
    });
    expect(result.reparented).toBe(false);
    expect(nodeSupervisor(result.state, "vp")?.id).toBe("ceo");
  });

  it("moves without reparenting when dropped on empty canvas space", () => {
    const doc = orgDoc();
    const result = resolveCanvasDrop(doc, {
      nodeId: "vp",
      position: { x: 500, y: 500 },
      dropTargetId: null,
    });
    expect(result.error).toBe(null);
    expect(result.reparented).toBe(false);
    expect(nodeSupervisor(result.state, "vp")?.id).toBe("ceo");
    expect(
      result.state.nodes.find((n) => n.id === "vp").position
    ).toEqual({ x: 500, y: 500 });
  });

  it("never reparents in workflow documents", () => {
    const doc = workflowDoc();
    const result = resolveCanvasDrop(doc, {
      nodeId: "s",
      position: { x: 42, y: 42 },
      dropTargetId: "e",
    });
    expect(result.reparented).toBe(false);
    expect(result.reparentError).toBe(null);
    expect(result.state.edges).toHaveLength(1);
    expect(
      result.state.nodes.find((n) => n.id === "s").position
    ).toEqual({ x: 42, y: 42 });
  });

  it("reports move errors instead of throwing", () => {
    const doc = orgDoc();
    const result = resolveCanvasDrop(doc, {
      nodeId: "nope",
      position: { x: 1, y: 1 },
      dropTargetId: null,
    });
    expect(result.error).toMatch(/unknown node id/);
    expect(result.state).toBe(doc);
  });
});
