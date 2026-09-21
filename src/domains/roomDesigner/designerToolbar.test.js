import { describe, expect, it } from "vitest";
import { PINNED_TOOL_IDS, groupToolsByCategory, orderToolbarTools } from "./designerToolbar";

// Mirrors the real TOOL_DEFS declaration order in DesignerScreen.jsx:
// select first, erase/pan buried near the end, wallrect added later.
const tool = (id) => ({ id, label: id, icon: null, hint: "" });
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
].map(tool);

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

  it("groups house stuff under House in declared order", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    const house = categories.find((c) => c.id === "house");
    expect(house.label).toBe("House");
    expect(house.tools.map((t) => t.id)).toEqual([
      "wall",
      "wallrect",
      "room",
      "door",
      "window",
      "furniture",
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
    expect(seen).toHaveLength(withNew.length);
    expect(ungrouped.map((t) => t.id)).toEqual(["laser-measure"]);
  });

  it("categories follow the declared House, Mechanical, Plan order", () => {
    const { categories } = groupToolsByCategory(currentOrder);
    expect(categories.map((c) => c.id)).toEqual(["house", "mechanical", "plan"]);
  });

  it("does not mutate the input array", () => {
    const input = [...currentOrder];
    groupToolsByCategory(input);
    expect(input.map((t) => t.id)).toEqual(currentOrder.map((t) => t.id));
  });
});
