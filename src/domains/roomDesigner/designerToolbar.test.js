import { describe, expect, it } from "vitest";
import { PINNED_TOOL_IDS, orderToolbarTools } from "./designerToolbar";

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
