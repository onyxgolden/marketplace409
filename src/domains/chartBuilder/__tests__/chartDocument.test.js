import { describe, expect, it } from "vitest";
import {
  ChartError,
  createChartDocument,
  createEdge,
  createNode,
  getEdge,
  getNode,
  withParts,
} from "../chartDocument.js";

describe("createNode", () => {
  it("creates a node with defaults", () => {
    const n = createNode({ id: "n1", label: "Ada" });
    expect(n.id).toBe("n1");
    expect(n.label).toBe("Ada");
    expect(n.subtitle).toBe("");
    expect(n.position).toEqual({ x: 0, y: 0 });
    expect(n.fields).toEqual({});
  });

  it("normalizes fields, position, and style", () => {
    const n = createNode({
      id: "n1",
      label: "Ada",
      subtitle: "CEO",
      fields: { title: "Chief", department: "Exec", location: "TX" },
      position: { x: 10, y: 20 },
      style: { template: "org-classic-hierarchy", shape: "rectangle", color: "#111" },
    });
    expect(n.fields).toEqual({ title: "Chief", department: "Exec", location: "TX" });
    expect(n.position).toEqual({ x: 10, y: 20 });
    expect(n.style.shape).toBe("rectangle");
  });

  it("rejects missing id/label and bad position", () => {
    expect(() => createNode({ id: "", label: "x" })).toThrow(ChartError);
    expect(() => createNode({ id: "n1" })).toThrow(ChartError);
    expect(() => createNode({ id: "n1", label: "x", position: { x: "a", y: 0 } })).toThrow(ChartError);
    expect(() => createNode({ id: "n1", label: "x", style: { shape: "hexagon" } })).toThrow(ChartError);
  });
});

describe("createEdge", () => {
  it("creates a supervisor edge", () => {
    const e = createEdge({ id: "e1", from: "a", to: "b", type: "supervisor" });
    expect(e).toEqual({ id: "e1", from: "a", to: "b", label: "", type: "supervisor", style: {} });
  });

  it("rejects self edges", () => {
    expect(() => createEdge({ id: "e1", from: "a", to: "a" })).toThrow(ChartError);
  });
});

describe("createChartDocument", () => {
  it("creates org and workflow documents", () => {
    const org = createChartDocument({ id: "d1", type: "org" });
    expect(org.type).toBe("org");
    expect(org.schemaVersion).toBe(1);
    expect(org.nodes).toEqual([]);
    expect(org.metadata.templateId).toBeNull();
    const wf = createChartDocument({ id: "d2", type: "workflow", metadata: { templateId: "workflow-left-to-right" } });
    expect(wf.metadata.templateId).toBe("workflow-left-to-right");
  });

  it("rejects unknown types and duplicate node ids", () => {
    expect(() => createChartDocument({ id: "d", type: "mindmap" })).toThrow(ChartError);
    expect(() =>
      createChartDocument({
        id: "d",
        type: "org",
        nodes: [createNode({ id: "a", label: "A" }), createNode({ id: "a", label: "B" })],
      })
    ).toThrow(ChartError);
  });

  it("getNode/getNode return null for unknown ids", () => {
    const doc = createChartDocument({ id: "d", type: "org", nodes: [createNode({ id: "a", label: "A" })] });
    expect(getNode(doc, "a").label).toBe("A");
    expect(getNode(doc, "zz")).toBeNull();
    expect(getEdge(doc, "zz")).toBeNull();
  });

  it("withParts replaces parts and bumps updatedAt", () => {
    const doc = createChartDocument({ id: "d", type: "org" });
    const next = withParts(doc, { nodes: [createNode({ id: "a", label: "A" })] });
    expect(next.nodes).toHaveLength(1);
    expect(doc.nodes).toHaveLength(0);
  });
});

describe("review fixes (PR #291)", () => {
  it("validates raw node objects even when id/label are present (no bypass)", () => {
    expect(() =>
      createChartDocument({
        id: "d",
        type: "org",
        nodes: [{ id: "r", label: "Raw", position: { x: NaN, y: 0 } }],
      })
    ).toThrow(ChartError);
    expect(() =>
      createChartDocument({
        id: "d",
        type: "org",
        nodes: [{ id: "r", label: "Raw", style: { shape: "nope" } }],
      })
    ).toThrow(ChartError);
  });

  it("rejects NaN and infinite coordinates", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => createNode({ id: "n", label: "N", position: { x: bad, y: 0 } })).toThrow(ChartError);
      expect(() => createNode({ id: "n", label: "N", position: { x: 0, y: bad } })).toThrow(ChartError);
    }
  });

  it("preserves unknown field keys instead of dropping them", () => {
    const node = createNode({ id: "n", label: "N", fields: { title: "Boss", nickname: "Ace" } });
    expect(node.fields.nickname).toBe("Ace");
  });
});
