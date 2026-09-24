// @vitest-environment jsdom

// Room presets + shipping container shapes: catalog integrity against the
// REAL palette defs. Every preset button in the left sidebar must resolve
// to a valid drop template, rooms must live only under the Rooms category,
// and containers must drop as labeled footprints.

import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "./DesignerScreen";
import {
  addRoomFromTemplate,
  createEmptyDesign,
  getRoomTemplate,
} from "@/domains/roomDesigner/designerDocument";
import { ROOM_TEMPLATES, STRUCTURE_TEMPLATES } from "@/domains/roomDesigner/furnitureCatalog";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";

const EXPECTED_ROOM_TOOL_IDS = [
  "room-living-room",
  "room-bedroom",
  "room-bedroom-small",
  "room-bedroom-12x14",
  "room-kitchen",
  "room-kitchen-12x14",
  "room-dining-room",
  "room-master-bedroom",
  "room-bathroom",
  "room-bathroom-small",
  "room-garage",
  "room-office",
];

const EXPECTED_STRUCTURE_TOOL_IDS = ["structure-container-20", "structure-container-40"];

describe("room preset + container catalog integrity", () => {
  it("has no duplicate tool ids across the real palette defs", () => {
    const ids = TOOL_DEFS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // groupToolsByCategory also fails fast on duplicates.
    expect(() => groupToolsByCategory(TOOL_DEFS)).not.toThrow();
  });

  it("every palette entry with roomTemplate resolves to a real drop template", () => {
    const presetDefs = TOOL_DEFS.filter((t) => t.roomTemplate);
    expect(presetDefs.length).toBe(
      EXPECTED_ROOM_TOOL_IDS.length + EXPECTED_STRUCTURE_TOOL_IDS.length
    );
    for (const def of presetDefs) {
      const template = getRoomTemplate(def.roomTemplate);
      expect(template, `unresolvable roomTemplate on tool "${def.id}"`).toBeDefined();
      expect(template.widthIn).toBeGreaterThan(0);
      expect(template.depthIn).toBeGreaterThan(0);
    }
  });

  it("the Rooms category holds exactly the expected presets, in order", () => {
    const { categories, ungrouped } = groupToolsByCategory(TOOL_DEFS);
    const rooms = categories.find((c) => c.id === "rooms");
    expect(rooms).toBeDefined();
    expect(rooms.label).toBe("Rooms");
    expect(rooms.tools.map((t) => t.id)).toEqual(EXPECTED_ROOM_TOOL_IDS);
    // No preset leaks into ungrouped.
    expect(ungrouped.map((t) => t.id)).not.toContain("room-bedroom");
  });

  it("the Structures category holds exactly the two container shapes", () => {
    const { categories } = groupToolsByCategory(TOOL_DEFS);
    const structures = categories.find((c) => c.id === "structures");
    expect(structures).toBeDefined();
    expect(structures.label).toBe("Structures");
    expect(structures.tools.map((t) => t.id)).toEqual(EXPECTED_STRUCTURE_TOOL_IDS);
  });

  it("room presets live only under Rooms — never in House", () => {
    const { categories } = groupToolsByCategory(TOOL_DEFS);
    const house = categories.find((c) => c.id === "house");
    const houseIds = house.tools.map((t) => t.id);
    for (const id of EXPECTED_ROOM_TOOL_IDS) {
      expect(houseIds).not.toContain(id);
    }
    for (const id of EXPECTED_STRUCTURE_TOOL_IDS) {
      expect(houseIds).not.toContain(id);
    }
  });

  it("ROOM_TEMPLATES holds 12 presets with positive dimensions and unique ids", () => {
    expect(ROOM_TEMPLATES).toHaveLength(12);
    const ids = new Set();
    for (const t of ROOM_TEMPLATES) {
      expect(t.widthIn).toBeGreaterThan(0);
      expect(t.depthIn).toBeGreaterThan(0);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("includes the new standard sizes with exact dimensions", () => {
    const byId = new Map(ROOM_TEMPLATES.map((t) => [t.id, t]));
    expect([byId.get("bedroom-12x14").widthIn, byId.get("bedroom-12x14").depthIn]).toEqual([144, 168]);
    expect([byId.get("kitchen-12x14").widthIn, byId.get("kitchen-12x14").depthIn]).toEqual([144, 168]);
    expect([byId.get("master-bedroom").widthIn, byId.get("master-bedroom").depthIn]).toEqual([168, 216]);
  });

  it("STRUCTURE_TEMPLATES holds the two standard container sizes, ids unique across both lists", () => {
    expect(STRUCTURE_TEMPLATES).toHaveLength(2);
    const byId = new Map(STRUCTURE_TEMPLATES.map((t) => [t.id, t]));
    expect([byId.get("container-20").widthIn, byId.get("container-20").depthIn]).toEqual([240, 96]);
    expect([byId.get("container-40").widthIn, byId.get("container-40").depthIn]).toEqual([480, 96]);
    const roomIds = new Set(ROOM_TEMPLATES.map((t) => t.id));
    for (const t of STRUCTURE_TEMPLATES) {
      expect(roomIds.has(t.id)).toBe(false);
      expect(t.widthIn).toBeGreaterThan(0);
      expect(t.depthIn).toBeGreaterThan(0);
    }
  });

  it("a 40' container drops unnamed as a 480×96 footprint with four walls", () => {
    const design = addRoomFromTemplate(createEmptyDesign(), "container-40", { x: 0, y: 0 });
    expect(design.rooms).toHaveLength(1);
    const [room] = design.rooms;
    // Presets drop unnamed now; the preset identity is on templateId.
    expect(room.label).toBe("");
    expect(room.templateId).toBe("container-40");
    expect(room.wallIds).toHaveLength(4);
    expect(design.walls).toHaveLength(4);
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(480);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(96);
  });
});
