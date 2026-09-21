import { describe, expect, it } from "vitest";
import { createChartDocument, createEdge, createNode } from "../chartDocument.js";
import { validateOrgDocument, validateWorkflowDocument } from "../chartValidation.js";

function N(id, label) {
  return createNode({ id, label });
}
function sup(from, to, id) {
  return createEdge({ id: id ?? `${from}->${to}`, from, to, type: "supervisor" });
}
function types(result) {
  return result.errors.map((e) => e.type);
}

describe("validateOrgDocument", () => {
  it("accepts a valid org tree", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("ceo", "CEO"), N("cto", "CTO"), N("dev", "Dev")],
      edges: [sup("ceo", "cto"), sup("cto", "dev")],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts multiple roots (forest of trees)", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("a", "A"), N("b", "B"), N("c", "C")],
      edges: [sup("a", "c")],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(true);
  });

  it("detects supervisor cycles", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("a", "A"), N("b", "B"), N("c", "C")],
      edges: [sup("a", "b"), sup("b", "c"), sup("c", "a")],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(false);
    expect(types(result)).toContain("cycle");
    expect(result.errors.find((e) => e.type === "cycle").message).toMatch(/a -> b -> c -> a/);
  });

  it("reports a missing supervisor", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("ceo", "CEO"), N("cto", "CTO")],
      edges: [sup("ceo", "cto"), createEdge({ id: "e-bad", from: "ghost", to: "cto", type: "supervisor" })],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('missing supervisor "ghost"'))).toBe(true);
  });

  it("rejects multiple supervisors for one node", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("a", "A"), N("b", "B"), N("c", "C")],
      edges: [sup("a", "c"), sup("b", "c", "e2")],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(false);
    expect(types(result)).toContain("multiple-supervisors");
  });

  it("reports duplicate labels", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("a", "Manager"), N("b", "manager"), N("c", "Clerk")],
      edges: [],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(false);
    expect(types(result)).toContain("duplicate-label");
  });

  it("reports orphans as warnings, never silently attaching them", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("ceo", "CEO"), N("cto", "CTO"), N("stray", "Stray")],
      edges: [sup("ceo", "cto")],
    });
    const result = validateOrgDocument(doc);
    const orphan = result.errors.find((e) => e.type === "orphan");
    expect(orphan).toBeDefined();
    expect(orphan.severity).toBe("warning");
    expect(orphan.nodeId).toBe("stray");
    // Orphan does not invalidate the chart.
    expect(result.valid).toBe(true);
  });

  it("reports edges referencing unknown nodes", () => {
    const doc = createChartDocument({
      id: "d",
      type: "org",
      nodes: [N("a", "A")],
      edges: [createEdge({ id: "e1", from: "a", to: "nowhere", type: "supervisor" })],
    });
    const result = validateOrgDocument(doc);
    expect(result.valid).toBe(false);
    expect(types(result)).toContain("missing-node");
  });
});

describe("validateWorkflowDocument", () => {
  it("allows cycles in workflows", () => {
    const doc = createChartDocument({
      id: "d",
      type: "workflow",
      nodes: [N("a", "Step A"), N("b", "Step B")],
      edges: [
        createEdge({ id: "e1", from: "a", to: "b", type: "sequence" }),
        createEdge({ id: "e2", from: "b", to: "a", type: "sequence" }),
      ],
    });
    const result = validateWorkflowDocument(doc);
    // Every node has an incoming edge -> no start node, so invalid — but not
    // because of the cycle.
    expect(types(result)).toContain("no-start-node");
    expect(types(result)).not.toContain("cycle");
  });

  it("requires at least one start node", () => {
    const base = createChartDocument({
      id: "d",
      type: "workflow",
      nodes: [N("a", "Step A")],
    });
    // createEdge rejects self-edges; build the self-loop structurally.
    const doc = { ...base, edges: [{ id: "e1", from: "a", to: "a", label: "", type: "sequence" }] };
    const result = validateWorkflowDocument(doc);
    expect(result.valid).toBe(false);
    expect(types(result)).toContain("no-start-node");
  });

  it("accepts a workflow with a start node", () => {
    const doc = createChartDocument({
      id: "d",
      type: "workflow",
      nodes: [N("a", "Step A"), N("b", "Step B")],
      edges: [createEdge({ id: "e1", from: "a", to: "b", type: "sequence" })],
    });
    const result = validateWorkflowDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("warns about disconnected nodes without invalidating", () => {
    const doc = createChartDocument({
      id: "d",
      type: "workflow",
      nodes: [N("a", "Step A"), N("b", "Step B"), N("lonely", "Lonely")],
      edges: [createEdge({ id: "e1", from: "a", to: "b", type: "sequence" })],
    });
    const result = validateWorkflowDocument(doc);
    const warning = result.errors.find((e) => e.type === "disconnected-node");
    expect(warning).toBeDefined();
    expect(warning.severity).toBe("warning");
    expect(warning.nodeId).toBe("lonely");
    expect(result.valid).toBe(true);
  });
});
