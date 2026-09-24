// designerDocumentRenameRoom.test.js — room naming.
//
// Rooms used to arrive pre-named from their template ("Bedroom") with no way
// to change it. Now they arrive UNNAMED and renameRoom supplies the name.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addRoomFromTemplate,
  createEmptyDesign,
  renameRoom,
  resetDesignerIds,
  validateDesign,
} from "./designerDocument";
import { planToDxf } from "./homeDxfExport";
import { createHomeProject, resetHomeProjectIds } from "./homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

const withRoom = () => addRoomFromTemplate(createEmptyDesign("Plan"), "bedroom", { x: 0, y: 0 });
/** The id of a design's first room — never hard-code it; ids are sequential. */
const roomId = (design) => design.rooms[0].id;

describe("new rooms", () => {
  it("arrive unnamed rather than carrying the template's label", () => {
    const design = withRoom();
    expect(design.rooms[0].label).toBe("");
  });

  it("keep the template identity for whatever keys off it", () => {
    expect(withRoom().rooms[0].templateId).toBe("bedroom");
  });

  it("are still valid unnamed", () => {
    expect(validateDesign(withRoom())).toEqual([]);
  });
});

describe("renameRoom", () => {
  it("sets the label", () => {
    const base = withRoom();
    const design = renameRoom(base, roomId(base), "Primary bedroom");
    expect(design.rooms[0].label).toBe("Primary bedroom");
  });

  it("trims surrounding whitespace", () => {
    const base = withRoom();
    const design = renameRoom(base, roomId(base), "   Guest room \n ");
    expect(design.rooms[0].label).toBe("Guest room");
  });

  it("accepts a blank name as 'unnamed' rather than rejecting it", () => {
    const base = withRoom();
    let design = renameRoom(base, roomId(base), "Office");
    design = renameRoom(design, roomId(base), "   ");
    expect(design.rooms[0].label).toBe("");
    expect(validateDesign(design)).toEqual([]);
  });

  it("coerces a non-string name to blank instead of storing junk", () => {
    const a = withRoom();
    expect(renameRoom(a, roomId(a), null).rooms[0].label).toBe("");
    const b = withRoom();
    expect(renameRoom(b, roomId(b), 42).rooms[0].label).toBe("");
  });

  it("caps an absurdly long name", () => {
    const base = withRoom();
    const design = renameRoom(base, roomId(base), "x".repeat(500));
    expect(design.rooms[0].label).toHaveLength(120);
  });

  it("returns the design unchanged for an unknown room id", () => {
    const design = withRoom();
    expect(renameRoom(design, "nope", "Kitchen")).toBe(design);
  });

  it("does not mutate the input design", () => {
    const design = withRoom();
    const snapshot = JSON.stringify(design);
    renameRoom(design, roomId(design), "Kitchen");
    expect(JSON.stringify(design)).toBe(snapshot);
  });

  it("leaves other rooms alone", () => {
    let design = withRoom();
    design = addRoomFromTemplate(design, "kitchen", { x: 200, y: 0 });
    const renamed = renameRoom(design, design.rooms[0].id, "Primary");
    expect(renamed.rooms[1].label).toBe("");
    expect(renamed.rooms[0].label).toBe("Primary");
  });
});

describe("downstream fallbacks", () => {
  it("DXF export still writes 'Room' for an unnamed room, and the name when set", () => {
    const project = (design) => {
      const base = createHomeProject("Plan project");
      return { ...base, levels: [{ ...base.levels[0], design }] };
    };
    const unnamed = planToDxf(project(withRoom()), {});
    expect(unnamed.ok).toBe(true);
    expect(unnamed.dxf).toContain("Room");

    const namedBase = withRoom();
    const named = planToDxf(project(renameRoom(namedBase, roomId(namedBase), "Nursery")), {});
    expect(named.ok).toBe(true);
    expect(named.dxf).toContain("Nursery");
  });
});
