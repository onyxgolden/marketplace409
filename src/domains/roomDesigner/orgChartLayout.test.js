import { describe, expect, it } from "vitest";
import {
  ORG_CHART_METRICS,
  departmentColor,
  descendantsOf,
  layoutOrgChart,
  wouldCreateCycle,
} from "./orgChartLayout";

const { boxWidthIn: W, boxHeightIn: H, gapXIn: GX, gapYIn: GY } = ORG_CHART_METRICS;

const person = (id, name, managerId = null, extra = {}) => ({
  id,
  name,
  title: "Title",
  department: "Dept",
  managerId,
  ...extra,
});

function boxesOverlap(a, b) {
  return (
    a.x < b.x + W &&
    b.x < a.x + W &&
    a.y < b.y + H &&
    b.y < a.y + H
  );
}

describe("layoutOrgChart", () => {
  it("centers a single root on the anchor", () => {
    const layout = layoutOrgChart([person("a", "Alice")]);
    expect(layout.positions).toEqual([{ id: "a", x: -W / 2, y: 0 }]);
    expect(layout.edges).toEqual([]);
    expect(layout.widthIn).toBe(W);
    expect(layout.heightIn).toBe(H);
  });

  it("returns an empty layout for no nodes", () => {
    expect(layoutOrgChart([])).toEqual({ positions: [], edges: [], widthIn: 0, heightIn: 0 });
    expect(layoutOrgChart(null).positions).toEqual([]);
  });

  it("lays out a manager with two reports, parent centered", () => {
    const layout = layoutOrgChart([
      person("m", "Manager"),
      person("a", "Amy", "m"),
      person("b", "Bob", "m"),
    ]);
    const byId = new Map(layout.positions.map((p) => [p.id, p]));
    // children sort by name: Amy before Bob
    expect(byId.get("a").x).toBeLessThan(byId.get("b").x);
    expect(byId.get("a").y).toBe(H + GY);
    expect(byId.get("b").y).toBe(H + GY);
    const parentCenter = byId.get("m").x + W / 2;
    const kidsCenter = (byId.get("a").x + byId.get("b").x) / 2 + W / 2;
    expect(parentCenter).toBeCloseTo(kidsCenter, 6);
    // whole tree centered on the anchor
    expect(layout.widthIn).toBe(2 * W + GX);
    expect(byId.get("a").x).toBeCloseTo(-W - GX / 2, 6);
    expect(layout.edges).toEqual([
      { from: "m", to: "a" },
      { from: "m", to: "b" },
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const nodes = [
      person("m", "Manager"),
      person("a", "Amy", "m"),
      person("b", "Bob", "m"),
      person("c", "Cara", "a"),
      person("d", "Dan", "a"),
      person("e", "Eve", "b"),
    ];
    const first = layoutOrgChart(nodes);
    const shuffled = layoutOrgChart([...nodes].reverse());
    const reshuffled = layoutOrgChart([nodes[3], nodes[0], nodes[5], nodes[1], nodes[4], nodes[2]]);
    expect(shuffled).toEqual(first);
    expect(reshuffled).toEqual(first);
  });

  it("never overlaps boxes in a multi-level tree", () => {
    const nodes = [person("ceo", "CEO")];
    let n = 0;
    const addLevel = (parents) => {
      const kids = [];
      for (const p of parents) {
        for (let i = 0; i < 3; i += 1) {
          n += 1;
          const id = `p${n}`;
          nodes.push(person(id, `Person ${n}`, p));
          kids.push(id);
        }
      }
      return kids;
    };
    const l1 = addLevel(["ceo"]);
    const l2 = addLevel(l1);
    addLevel(l2);
    const layout = layoutOrgChart(nodes);
    expect(layout.positions).toHaveLength(nodes.length);
    for (let i = 0; i < layout.positions.length; i += 1) {
      for (let j = i + 1; j < layout.positions.length; j += 1) {
        expect(
          boxesOverlap(layout.positions[i], layout.positions[j]),
          `${layout.positions[i].id} overlaps ${layout.positions[j].id}`,
        ).toBe(false);
      }
    }
  });

  it("treats unknown managers as extra roots", () => {
    const layout = layoutOrgChart([
      person("a", "Alice"),
      person("b", "Bob", "ghost"),
    ]);
    const byId = new Map(layout.positions.map((p) => [p.id, p]));
    expect(byId.get("a").y).toBe(0);
    expect(byId.get("b").y).toBe(0);
    expect(layout.edges).toEqual([]);
    expect(layout.widthIn).toBe(2 * W + GX);
  });

  it("treats a self-manager as a root", () => {
    const layout = layoutOrgChart([person("a", "Alice", "a")]);
    expect(layout.positions).toHaveLength(1);
    expect(layout.positions[0].y).toBe(0);
  });

  it("terminates on reporting cycles and places everyone", () => {
    const layout = layoutOrgChart([
      person("a", "Alice", "b"),
      person("b", "Bob", "a"),
      person("c", "Cara", "a"),
    ]);
    expect(layout.positions).toHaveLength(3);
    const ids = new Set(layout.positions.map((p) => p.id));
    expect(ids).toEqual(new Set(["a", "b", "c"]));
  });

  it("lays out multiple roots left to right", () => {
    const layout = layoutOrgChart([person("b", "Bob"), person("a", "Alice")]);
    const byId = new Map(layout.positions.map((p) => [p.id, p]));
    expect(byId.get("a").x).toBeLessThan(byId.get("b").x);
  });

  it("supports custom metrics", () => {
    const layout = layoutOrgChart([person("a", "Alice")], {
      boxWidthIn: 200,
      boxHeightIn: 100,
      gapXIn: 10,
      gapYIn: 20,
    });
    expect(layout.widthIn).toBe(200);
    expect(layout.heightIn).toBe(100);
  });
});

describe("descendantsOf", () => {
  const nodes = [
    person("ceo", "CEO"),
    person("a", "Amy", "ceo"),
    person("b", "Bob", "ceo"),
    person("c", "Cara", "a"),
  ];

  it("collects transitive reports", () => {
    expect(descendantsOf(nodes, "ceo")).toEqual(new Set(["a", "b", "c"]));
    expect(descendantsOf(nodes, "a")).toEqual(new Set(["c"]));
    expect(descendantsOf(nodes, "c")).toEqual(new Set());
  });

  it("is safe on cycles", () => {
    const cyclic = [person("a", "Alice", "b"), person("b", "Bob", "a")];
    expect(descendantsOf(cyclic, "a")).toEqual(new Set(["b"]));
  });
});

describe("wouldCreateCycle", () => {
  const nodes = [
    person("ceo", "CEO"),
    person("a", "Amy", "ceo"),
    person("b", "Bob", "a"),
  ];

  it("rejects self-management", () => {
    expect(wouldCreateCycle(nodes, "a", "a")).toBe(true);
  });

  it("rejects making a descendant your manager", () => {
    expect(wouldCreateCycle(nodes, "ceo", "b")).toBe(true);
    expect(wouldCreateCycle(nodes, "a", "b")).toBe(true);
  });

  it("allows null and lateral moves", () => {
    expect(wouldCreateCycle(nodes, "b", null)).toBe(false);
    expect(wouldCreateCycle(nodes, "b", "ceo")).toBe(false);
  });
});

describe("departmentColor", () => {
  it("is deterministic and groups equal departments", () => {
    expect(departmentColor("Engineering")).toBe(departmentColor("engineering"));
    expect(departmentColor("Engineering")).toBe(departmentColor("  Engineering "));
  });

  it("returns slate for a blank department", () => {
    expect(departmentColor("")).toBe("#64748b");
    expect(departmentColor(null)).toBe("#64748b");
  });
});
