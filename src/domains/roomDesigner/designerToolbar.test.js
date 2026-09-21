import { describe, expect, it, beforeEach } from "vitest";
import {
  PINNED_TOOL_IDS,
  groupToolsByCategory,
  orderToolbarTools,
  registerToolCategory,
  getToolCategories,
  resetToolCategories,
} from "./designerToolbar";

// Mirrors the real TOOL_DEFS declaration order in DesignerScreen.jsx:
// select first, erase/pan buried near the end, wallrect added later.
// Furniture carries leftPalette: false like the real defs (it lives in the
// right panel, never the left palette).
const tool = (id, extra = {}) => ({ id, label: id, icon: null, hint: "", ...extra });
const currentOrder = [
  "select",
  "wall",
  "wallrect",
  "room",
  "door",
  "window",
  "furniture",
  "pipe",
  "piping",
  "orgchart",
  "erase",
  "pan",
  "calibrate",
].map((id) => (id === "furniture" ? tool(id, { leftPalette: false }) : tool(id)));

describe("orderToolbarTools", () => {
  it("pins select, erase and pan as the first three tools in that exact order", () => {
    const ids = orderToolbarTools(currentOrder).map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual(["select", "erase", "pan"]);
    expect(PINNED_TOOL_IDS).toEqual(["select", "erase", "pan"]);
  });

  it("keeps all remaining tools in their declared relative order", () => {
    const ids = orderToolbarTools(currentOrder).map((t) => t.id);
    expect(ids).toEqual([
      "select",
      "erase",
      "pan",
      "wall",
      "wallrect",
      "room",
      "door",
      "window",
      "furniture",
      "pipe",
      "piping",
      "orgchart",
      "calibrate",
    ]);
  });

  it("a newly added tool cannot displace the pinned three", () => {
    const withNew = [
      tool("laser-measure"),
      ...currentOrder,
      tool("sticker"),
    ];
    const ids = orderToolbarTools(withNew).map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual(["select", "erase", "pan"]);
    // new tools land after the pinned three, keeping their own order
    expect(ids.indexOf("laser-measure")).toBe(3);
    expect(ids.indexOf("sticker")).toBe(ids.length - 1);
  });

  it("works when a pinned tool is declared in an unexpected position", () => {
    const shuffled = [
      tool("wall"),
      tool("pan"),
      tool("select"),
      tool("room"),
      tool("erase"),
    ];
    const ids = orderToolbarTools(shuffled).map((t) => t.id);
    expect(ids).toEqual(["select", "erase", "pan", "wall", "room"]);
  });

  it("gracefully skips a missing pinned tool", () => {
    const withoutPan = currentOrder.filter((t) => t.id !== "pan");
    const ids = orderToolbarTools(withoutPan).map((t) => t.id);
    expect(ids.slice(0, 2)).toEqual(["select", "erase"]);
    expect(ids).toHaveLength(currentOrder.length - 1);
  });

  it("does not mutate the input array", () => {
    const input = [...currentOrder];
    orderToolbarTools(input);
    expect(input.map((t) => t.id)).toEqual(currentOrder.map((t) => t.id));
  });
});

describe("groupToolsByCategory", () => {
  it("keeps select, erase and pan pinned first, in order", () => {
    const { pinned } = groupToolsByCategory(currentOrder);
    expect(pinned.map((t) => t.id)).toEqual(["select", "erase", "pan"]);
  });

  it("groups house stuff under House in declared order (furniture lives in the right panel)", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    const house = categories.find((c) => c.id === "house");
    expect(house.label).toBe("House");
    expect(house.tools.map((t) => t.id)).toEqual([
      "wall",
      "wallrect",
      "room",
      "door",
      "window",
    ]);
  });

  it("groups piping under Mechanical and plan tools under Plan", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    const byId = new Map(categories.map((c) => [c.id, c]));
    expect(byId.get("mechanical").tools.map((t) => t.id)).toEqual(["pipe", "piping"]);
    expect(byId.get("plan").tools.map((t) => t.id)).toEqual(["orgchart", "calibrate"]);
  });

  it("hides the Process category until process tools exist", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    expect(categories.some((c) => c.id === "process")).toBe(false);
    const withProcess = [...currentOrder, tool("process-pump")];
    // process-pump is not in any category yet, so it lands ungrouped, not under Process
    const grouped = groupToolsByCategory(withProcess);
    expect(grouped.ungrouped.map((t) => t.id)).toEqual(["process-pump"]);
    expect(grouped.categories.some((c) => c.id === "process")).toBe(false);
  });

  it("never drops a tool: uncategorized tools land in ungrouped", () => {
    const withNew = [tool("laser-measure"), ...currentOrder];
    const { pinned, categories, ungrouped } = groupToolsByCategory(withNew);
    const seen = [
      ...pinned,
      ...categories.flatMap((c) => c.tools),
      ...ungrouped,
    ].map((t) => t.id);
    // furniture opts out of the left palette via leftPalette: false; every
    // other tool must be accounted for exactly once.
    expect(seen).toHaveLength(withNew.length - 1);
    expect(seen).not.toContain("furniture");
    expect(ungrouped.map((t) => t.id)).toEqual(["laser-measure"]);
  });

  it("categories follow the declared House, Mechanical, Plan order", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    expect(categories.map((c) => c.id)).toEqual(["house", "mechanical", "plan"]);
  });

  it("excludes tools with leftPalette: false from the left palette entirely", () => {
    const withOptOut = currentOrder.map((t) =>
      t.id === "furniture" ? { ...t, leftPalette: false } : t
    );
    const { pinned, categories, ungrouped } = groupToolsByCategory(withOptOut);
    const seen = [...pinned, ...categories.flatMap((c) => c.tools), ...ungrouped].map(
      (t) => t.id
    );
    // Furniture still exists as a tool (right panel), but never in the left palette.
    expect(seen).not.toContain("furniture");
    expect(seen).toHaveLength(withOptOut.length - 1);
  });

  it("throws on duplicate tool ids instead of silently dropping one", () => {
    expect(() => groupToolsByCategory([tool("wall"), tool("wall")])).toThrow(
      'duplicate tool id "wall"'
    );
  });

  it("does not mutate the input array", () => {
    const input = [...currentOrder];
    groupToolsByCategory(input);
    expect(input.map((t) => t.id)).toEqual(currentOrder.map((t) => t.id));
  });
});

describe("extensible tool categories", () => {
  beforeEach(() => {
    resetToolCategories();
  });

  it("returns the built-in House, Mechanical, Process, Plan categories by default", () => {
    expect(getToolCategories().map((c) => c.id)).toEqual([
      "house",
      "mechanical",
      "process",
      "plan",
    ]);
  });

  it("a registered Custom category appears once custom tools exist", () => {
    const customDefs = [...currentOrder, tool("my-sofa"), tool("my-table")];
    registerToolCategory({ id: "custom", label: "Custom", toolIds: ["my-sofa", "my-table"] });
    const { categories } = groupToolsByCategory(customDefs);
    const custom = categories.find((c) => c.id === "custom");
    expect(custom).toBeDefined();
    expect(custom.label).toBe("Custom");
    expect(custom.tools.map((t) => t.id)).toEqual(["my-sofa", "my-table"]);
  });

  it("a registered category with no matching tools stays hidden", () => {
    registerToolCategory({ id: "custom", label: "Custom", toolIds: ["not-a-tool"] });
    const { categories } = groupToolsByCategory(currentOrder);
    expect(categories.some((c) => c.id === "custom")).toBe(false);
  });

  it("registering an existing id replaces that built-in category", () => {
    registerToolCategory({ id: "plan", label: "Plan", toolIds: ["orgchart"] });
    const { categories } = groupToolsByCategory(currentOrder);
    const plan = categories.find((c) => c.id === "plan");
    expect(plan.tools.map((t) => t.id)).toEqual(["orgchart"]);
    // calibrate falls back to ungrouped rather than vanishing
    const { ungrouped } = groupToolsByCategory(currentOrder);
    expect(ungrouped.map((t) => t.id)).toContain("calibrate");
  });

  it("accepts categories passed directly as a second argument", () => {
    const { categories } = groupToolsByCategory(currentOrder, [
      { id: "shapes", label: "Shapes", toolIds: ["room"] },
    ]);
    expect(categories.map((c) => c.id)).toEqual(["shapes"]);
    expect(categories[0].tools.map((t) => t.id)).toEqual(["room"]);
  });

  it("rejects malformed category registrations", () => {
    expect(() => registerToolCategory({ id: "bad" })).toThrow();
    expect(() => registerToolCategory({ toolIds: [] })).toThrow();
  });
});
