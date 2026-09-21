import { describe, expect, it } from "vitest";
import { buildConnectAction } from "../chartConnect.js";
import { chartReducer } from "../chartReducer.js";
import { createChartDocument, createEdge, createNode } from "../chartDocument.js";

function makeOrg() {
  return createChartDocument({
    id: "connect-org",
    type: "org",
    nodes: [
      createNode({ id: "boss", label: "Boss" }),
      createNode({ id: "a", label: "A" }),
      createNode({ id: "b", label: "B" }),
    ],
    edges: [createEdge({ id: "e1", from: "boss", to: "a", type: "supervisor" })],
  });
}

function makeWorkflow() {
  return createChartDocument({
    id: "connect-wf",
    type: "workflow",
    nodes: [
      createNode({ id: "s1", label: "One" }),
      createNode({ id: "s2", label: "Two" }),
      createNode({ id: "s3", label: "Three" }),
    ],
    edges: [createEdge({ id: "e1", from: "s1", to: "s2", type: "sequence" })],
  });
}

describe("buildConnectAction", () => {
  it("refuses to connect a card to itself", () => {
    expect(buildConnectAction(makeOrg(), "a", "a")).toEqual({
      error: "A card can't connect to itself.",
    });
  });

  it("errors on unknown source or target ids", () => {
    expect(buildConnectAction(makeOrg(), "ghost", "a").error).toBeTruthy();
    expect(buildConnectAction(makeOrg(), "a", "ghost").error).toBeTruthy();
    expect(buildConnectAction(null, "a", "b").error).toBeTruthy();
  });

  it("builds a REPARENT_NODE action for org charts", () => {
    expect(buildConnectAction(makeOrg(), "boss", "b")).toEqual({
      action: { type: "REPARENT_NODE", nodeId: "b", newSupervisorId: "boss" },
    });
  });

  it("the org action applies through the reducer and swaps the supervisor edge", () => {
    const doc = makeOrg();
    const { action } = buildConnectAction(doc, "b", "a");
    const result = chartReducer(doc, action);
    expect(result.error).toBeNull();
    const edges = result.state.edges.filter(
      (e) => e.to === "a" && e.type === "supervisor"
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBe("b");
  });

  it("lets the reducer's cycle message surface for org charts", () => {
    const doc = makeOrg();
    // a reports to boss; putting boss under a would cycle.
    const { action, error } = buildConnectAction(doc, "a", "boss");
    expect(error).toBeUndefined();
    const result = chartReducer(doc, action);
    expect(result.error).toMatch(/cycle/);
  });

  it("builds an ADD_EDGE sequence action for workflow charts", () => {
    const { action, error } = buildConnectAction(makeWorkflow(), "s2", "s3");
    expect(error).toBeUndefined();
    expect(action.type).toBe("ADD_EDGE");
    expect(action.edge.from).toBe("s2");
    expect(action.edge.to).toBe("s3");
    expect(action.edge.type).toBe("sequence");
    expect(typeof action.edge.id).toBe("string");
  });

  it("refuses a duplicate workflow edge", () => {
    expect(buildConnectAction(makeWorkflow(), "s1", "s2")).toEqual({
      error: "Those steps are already connected.",
    });
  });

  it("allows the reverse direction as a feedback edge", () => {
    const { action, error } = buildConnectAction(makeWorkflow(), "s2", "s1");
    expect(error).toBeUndefined();
    expect(action.type).toBe("ADD_EDGE");
  });

  it("avoids edge id collisions deterministically", () => {
    const doc = makeWorkflow();
    const withCollision = {
      ...doc,
      edges: [...doc.edges, createEdge({ id: "edge-s2-s3", from: "s1", to: "s3", type: "sequence" })],
    };
    const { action } = buildConnectAction(withCollision, "s2", "s3");
    expect(action.edge.id).toBe("edge-s2-s3-2");
  });

  it("the workflow action applies through the reducer", () => {
    const doc = makeWorkflow();
    const { action } = buildConnectAction(doc, "s2", "s3");
    const result = chartReducer(doc, action);
    expect(result.error).toBeNull();
    expect(
      result.state.edges.some((e) => e.from === "s2" && e.to === "s3")
    ).toBe(true);
  });
});
