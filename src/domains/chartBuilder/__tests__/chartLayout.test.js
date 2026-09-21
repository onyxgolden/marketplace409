import { describe, expect, it } from "vitest";
import {
  createChartDocument,
  createEdge,
  createNode,
  layoutChart,
  contentBounds,
  getChartTemplate,
  seedChartFromTemplate,
  LAYOUT_NODE_ORG,
  LAYOUT_NODE_WORKFLOW,
} from "../index.js";

function orgDoc(nodes, edges) {
  return createChartDocument({ id: "org", type: "org", nodes, edges });
}

function workflowDoc(nodes, edges) {
  return createChartDocument({ id: "wf", type: "workflow", nodes, edges });
}

function orgChain() {
  const nodes = [
    createNode({ id: "a", label: "A" }),
    createNode({ id: "b", label: "B" }),
    createNode({ id: "c", label: "C" }),
    createNode({ id: "d", label: "D" }),
  ];
  const edges = [
    createEdge({ id: "e1", from: "a", to: "b", type: "supervisor" }),
    createEdge({ id: "e2", from: "a", to: "c", type: "supervisor" }),
    createEdge({ id: "e3", from: "b", to: "d", type: "supervisor" }),
  ];
  return orgDoc(nodes, edges);
}

describe("chart layout determinism", () => {
  it("produces identical coordinates for the same input", () => {
    const doc = orgChain();
    const first = layoutChart(doc, getChartTemplate("org-classic-hierarchy"));
    const second = layoutChart(doc, getChartTemplate("org-classic-hierarchy"));
    expect(first).toEqual(second);
  });

  it("is deterministic across all eight template algorithms", () => {
    const templates = [
      "org-classic-hierarchy",
      "org-executive-tree",
      "org-department-columns",
      "org-compact-tv-board",
      "workflow-left-to-right",
      "workflow-swimlane",
      "workflow-decision-tree",
      "workflow-kanban-flow",
    ];
    for (const id of templates) {
      const template = getChartTemplate(id);
      const seed = seedChartFromTemplate(template);
      const doc = createChartDocument({
        id: `seed-${id}`,
        type: template.type,
        nodes: seed.nodes,
        edges: seed.edges,
      });
      expect(layoutChart(doc, template)).toEqual(layoutChart(doc, template));
      expect(Object.keys(layoutChart(doc, template))).toHaveLength(seed.nodes.length);
    }
  });

  it("centers parents over their children in a tidy tree", () => {
    const pos = layoutChart(orgChain(), getChartTemplate("org-classic-hierarchy"));
    const w = LAYOUT_NODE_ORG.w;
    const centerA = pos.a.x + w / 2;
    const centerB = pos.b.x + w / 2;
    const centerC = pos.c.x + w / 2;
    expect(centerA).toBeCloseTo((centerB + centerC) / 2, 6);
    // Depth increases downward.
    expect(pos.b.y).toBeGreaterThan(pos.a.y);
    expect(pos.d.y).toBeGreaterThan(pos.b.y);
  });

  it("lays out multiple roots as non-overlapping forests", () => {
    const doc = orgDoc(
      [
        createNode({ id: "r1", label: "R1" }),
        createNode({ id: "r1c", label: "R1C" }),
        createNode({ id: "r2", label: "R2" }),
        createNode({ id: "r2c", label: "R2C" }),
      ],
      [
        createEdge({ id: "e1", from: "r1", to: "r1c", type: "supervisor" }),
        createEdge({ id: "e2", from: "r2", to: "r2c", type: "supervisor" }),
      ]
    );
    const pos = layoutChart(doc, getChartTemplate("org-classic-hierarchy"));
    const w = LAYOUT_NODE_ORG.w;
    const right1 = Math.max(pos.r1.x + w, pos.r1c.x + w);
    const left2 = Math.min(pos.r2.x, pos.r2c.x);
    expect(left2).toBeGreaterThan(right1);
  });

  it("keeps department columns disjoint", () => {
    const template = getChartTemplate("org-department-columns");
    const seed = seedChartFromTemplate(template);
    const doc = createChartDocument({
      id: "cols",
      type: "org",
      nodes: seed.nodes,
      edges: seed.edges,
    });
    const pos = layoutChart(doc, template);
    const w = LAYOUT_NODE_ORG.w;
    const byDept = {};
    for (const node of seed.nodes) {
      const dept = node.fields.department;
      byDept[dept] = byDept[dept] ?? { min: Infinity, max: -Infinity };
      byDept[dept].min = Math.min(byDept[dept].min, pos[node.id].x);
      byDept[dept].max = Math.max(byDept[dept].max, pos[node.id].x + w);
    }
    const spans = Object.values(byDept).sort((a, b) => a.min - b.min);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].min).toBeGreaterThanOrEqual(spans[i - 1].max);
    }
  });

  it("respects maxColumns in the compact grid", () => {
    const template = getChartTemplate("org-compact-tv-board");
    const seed = seedChartFromTemplate(template);
    const doc = createChartDocument({
      id: "grid",
      type: "org",
      nodes: seed.nodes,
      edges: seed.edges,
    });
    const pos = layoutChart(doc, template);
    const xs = new Set(Object.values(pos).map((p) => p.x));
    expect(xs.size).toBeLessThanOrEqual(6);
  });

  it("ranks workflow nodes along edges and stays finite with a feedback cycle", () => {
    const doc = workflowDoc(
      [
        createNode({ id: "s", label: "Start" }),
        createNode({ id: "m", label: "Middle" }),
        createNode({ id: "e", label: "End" }),
      ],
      [
        createEdge({ id: "e1", from: "s", to: "m", type: "sequence" }),
        createEdge({ id: "e2", from: "m", to: "e", type: "sequence" }),
        createEdge({ id: "e3", from: "e", to: "m", type: "sequence" }), // feedback
      ]
    );
    const pos = layoutChart(doc, getChartTemplate("workflow-left-to-right"));
    expect(pos.s.x).toBeLessThan(pos.m.x);
    expect(pos.m.x).toBeLessThanOrEqual(pos.e.x);
    for (const p of Object.values(pos)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Deterministic across runs.
    expect(layoutChart(doc, getChartTemplate("workflow-left-to-right"))).toEqual(pos);
  });

  it("lays swimlanes out below each other without overlap", () => {
    const template = getChartTemplate("workflow-swimlane");
    const seed = seedChartFromTemplate(template);
    const doc = createChartDocument({
      id: "lanes",
      type: "workflow",
      nodes: seed.nodes,
      edges: seed.edges,
    });
    const pos = layoutChart(doc, template);
    const h = LAYOUT_NODE_WORKFLOW.h;
    const laneOf = (id) =>
      seed.nodes.find((n) => n.id === id).fields.department || "General";
    const byLane = {};
    for (const id of Object.keys(pos)) {
      const lane = laneOf(id);
      byLane[lane] = byLane[lane] ?? { min: Infinity, max: -Infinity };
      byLane[lane].min = Math.min(byLane[lane].min, pos[id].y);
      byLane[lane].max = Math.max(byLane[lane].max, pos[id].y + h);
    }
    const spans = Object.values(byLane).sort((a, b) => a.min - b.min);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].min).toBeGreaterThan(spans[i - 1].max);
    }
  });

  it("returns an empty map for an empty document", () => {
    expect(layoutChart(orgDoc([], []), getChartTemplate("org-classic-hierarchy"))).toEqual({});
  });

  it("contentBounds covers every laid-out node", () => {
    const doc = orgChain();
    const pos = layoutChart(doc, getChartTemplate("org-classic-hierarchy"));
    const bounds = contentBounds(pos, LAYOUT_NODE_ORG);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.x);
      expect(p.y).toBeGreaterThanOrEqual(bounds.y);
    }
  });
});
