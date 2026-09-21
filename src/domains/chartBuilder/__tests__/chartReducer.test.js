import { describe, expect, it } from "vitest";
import { createChartDocument, createEdge, createNode } from "../chartDocument.js";
import {
  chartReducer,
  nodeChildren,
  nodeSupervisor,
} from "../chartReducer.js";

function orgDoc(extra = {}) {
  return createChartDocument({
    id: "d1",
    type: "org",
    nodes: [
      createNode({ id: "ceo", label: "CEO" }),
      createNode({ id: "cto", label: "CTO" }),
      createNode({ id: "cfo", label: "CFO" }),
    ],
    edges: [
      createEdge({ id: "e1", from: "ceo", to: "cto", type: "supervisor" }),
      createEdge({ id: "e2", from: "ceo", to: "cfo", type: "supervisor" }),
    ],
    ...extra,
  });
}

describe("ADD_NODE", () => {
  it("adds a node", () => {
    const { state, error } = chartReducer(orgDoc(), {
      type: "ADD_NODE",
      node: createNode({ id: "coo", label: "COO" }),
    });
    expect(error).toBeNull();
    expect(state.nodes).toHaveLength(4);
    expect(state.nodes[3].id).toBe("coo");
  });

  it("rejects duplicate ids", () => {
    const doc = orgDoc();
    const { state, error } = chartReducer(doc, { type: "ADD_NODE", node: createNode({ id: "ceo", label: "X" }) });
    expect(error).toMatch(/already exists/);
    expect(state).toBe(doc);
  });
});

describe("UPDATE_NODE / MOVE_NODE", () => {
  it("edits a node label and fields", () => {
    const { state, error } = chartReducer(orgDoc(), {
      type: "UPDATE_NODE",
      id: "cto",
      patch: { label: "Chief Tech", fields: { department: "Eng" } },
    });
    expect(error).toBeNull();
    const cto = state.nodes.find((n) => n.id === "cto");
    expect(cto.label).toBe("Chief Tech");
    expect(cto.fields.department).toBe("Eng");
  });

  it("moves a node", () => {
    const { state, error } = chartReducer(orgDoc(), {
      type: "MOVE_NODE",
      id: "cto",
      position: { x: 42, y: 7 },
    });
    expect(error).toBeNull();
    expect(state.nodes.find((n) => n.id === "cto").position).toEqual({ x: 42, y: 7 });
  });

  it("rejects unknown node ids", () => {
    const { error } = chartReducer(orgDoc(), { type: "MOVE_NODE", id: "zzz", position: { x: 0, y: 0 } });
    expect(error).toMatch(/unknown node/);
  });
});

describe("DELETE_NODE", () => {
  it("deletes the node and cleans up connected edges", () => {
    const { state, error } = chartReducer(orgDoc(), { type: "DELETE_NODE", id: "cto" });
    expect(error).toBeNull();
    expect(state.nodes.map((n) => n.id)).toEqual(["ceo", "cfo"]);
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].to).toBe("cfo");
  });
});

describe("ADD_EDGE / DELETE_EDGE", () => {
  it("adds a workflow edge freely", () => {
    const wf = createChartDocument({
      id: "w1",
      type: "workflow",
      nodes: [createNode({ id: "a", label: "A" }), createNode({ id: "b", label: "B" })],
    });
    const { state, error } = chartReducer(wf, {
      type: "ADD_EDGE",
      edge: createEdge({ id: "e1", from: "a", to: "b", type: "sequence" }),
    });
    expect(error).toBeNull();
    expect(state.edges).toHaveLength(1);
  });

  it("rejects an org edge that would create a cycle", () => {
    const { error } = chartReducer(orgDoc(), {
      type: "ADD_EDGE",
      edge: createEdge({ id: "e9", from: "cto", to: "ceo", type: "supervisor" }),
    });
    expect(error).toMatch(/cycle/);
  });

  it("deletes an edge", () => {
    const { state, error } = chartReducer(orgDoc(), { type: "DELETE_EDGE", id: "e1" });
    expect(error).toBeNull();
    expect(state.edges.map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("REPARENT_NODE", () => {
  it("reparents by swapping the incoming supervisor edge", () => {
    const { state, error } = chartReducer(orgDoc(), {
      type: "REPARENT_NODE",
      nodeId: "cto",
      newSupervisorId: "cfo",
      edgeId: "e-new",
    });
    expect(error).toBeNull();
    expect(state.edges.filter((e) => e.to === "cto")).toHaveLength(1);
    expect(state.edges.find((e) => e.to === "cto").from).toBe("cfo");
  });

  it("rejects reparenting under a descendant (cycle)", () => {
    const { state, error } = chartReducer(orgDoc(), {
      type: "REPARENT_NODE",
      nodeId: "ceo",
      newSupervisorId: "cto",
      edgeId: "e-bad",
    });
    expect(error).toMatch(/cycle/);
    expect(state).not.toBeNull();
  });

  it("rejects unknown supervisor ids", () => {
    const { error } = chartReducer(orgDoc(), {
      type: "REPARENT_NODE",
      nodeId: "cto",
      newSupervisorId: "zzz",
      edgeId: "e-x",
    });
    expect(error).toMatch(/unknown supervisor/);
  });

  it("rejects non-org documents", () => {
    const wf = createChartDocument({ id: "w1", type: "workflow" });
    const { error } = chartReducer(wf, { type: "REPARENT_NODE", nodeId: "a", newSupervisorId: "b", edgeId: "e" });
    expect(error).toMatch(/org documents only/);
  });
});

describe("readers", () => {
  it("nodeChildren and nodeSupervisor", () => {
    const doc = orgDoc();
    expect(nodeChildren(doc, "ceo").map((n) => n.id).sort()).toEqual(["cfo", "cto"]);
    expect(nodeSupervisor(doc, "cto").id).toBe("ceo");
    expect(nodeSupervisor(doc, "ceo")).toBeNull();
  });
});

describe("unknown actions", () => {
  it("rejects unknown action types without changing state", () => {
    const doc = orgDoc();
    const { state, error } = chartReducer(doc, { type: "TELEPORT_NODE" });
    expect(error).toMatch(/unknown action/);
    expect(state).toBe(doc);
  });
});

describe("review fixes (PR #291)", () => {
  it("rejects self-parenting reparents", () => {
    const doc = orgDoc();
    const { state, error } = chartReducer(doc, {
      type: "REPARENT_NODE",
      nodeId: "cto",
      newSupervisorId: "cto",
      edgeId: "e-self",
    });
    expect(error).toMatch(/itself/);
    expect(state).toBe(doc); // state unchanged
  });

  it("allows moving a descendant under a non-descendant node", () => {
    // cfo is a leaf; cto is not a descendant of cfo, so this must succeed.
    const { state, error } = chartReducer(orgDoc(), {
      type: "REPARENT_NODE",
      nodeId: "cfo",
      newSupervisorId: "cto",
      edgeId: "e-ok",
    });
    expect(error).toBeNull();
    expect(state.edges.find((e) => e.to === "cfo").from).toBe("cto");
  });

  it("suffixes colliding reparent edge ids instead of failing", () => {
    const doc = orgDoc({
      edges: [
        createEdge({ id: "e1", from: "ceo", to: "cto", type: "supervisor" }),
        createEdge({ id: "e2", from: "ceo", to: "cfo", type: "supervisor" }),
        createEdge({ id: "cto->cfo", from: "cto", to: "ceo", type: "supervisor" }),
      ],
    });
    const { state, error } = chartReducer(doc, {
      type: "REPARENT_NODE",
      nodeId: "cfo",
      newSupervisorId: "cto",
    });
    expect(error).toBeNull();
    const newEdge = state.edges.find((e) => e.to === "cfo" && e.from === "cto");
    expect(newEdge.id).toBe("cto->cfo#2");
  });

  it("rejects non-finite MOVE_NODE coordinates", () => {
    for (const bad of [NaN, Infinity]) {
      const { error } = chartReducer(orgDoc(), {
        type: "MOVE_NODE",
        id: "cto",
        position: { x: bad, y: 0 },
      });
      expect(error).toMatch(/finite/);
    }
  });
});
