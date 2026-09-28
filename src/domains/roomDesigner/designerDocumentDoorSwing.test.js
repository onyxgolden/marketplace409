// designerDocumentDoorSwing.test.js — which side a door hinges on and which
// face it swings to. Stored as optional opening fields; absent = the
// historic drawing (start hinge, positive face).

import { beforeEach, describe, expect, it } from "vitest";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  parseDesign,
  resetDesignerIds,
  serializeDesign,
  setDoorSwing,
  validateDesign,
} from "./designerDocument";

beforeEach(() => resetDesignerIds());

function withDoor(type = "door") {
  let d = addWall(createEmptyDesign("t"), { x: 0, y: 0 }, { x: 120, y: 0 });
  d = addOpening(d, d.walls[0].id, { type, offsetIn: 24 });
  return { d, id: d.openings[0].id };
}

describe("setDoorSwing", () => {
  it("new doors carry no swing fields (the default drawing)", () => {
    const { d } = withDoor();
    expect(d.openings[0].hinge).toBeUndefined();
    expect(d.openings[0].swing).toBeUndefined();
  });

  it("sets hinge and swing independently, immutably", () => {
    const { d, id } = withDoor();
    const d1 = setDoorSwing(d, id, { hinge: "end" });
    expect(d1.openings[0]).toMatchObject({ hinge: "end" });
    expect(d1.openings[0].swing).toBeUndefined();
    const d2 = setDoorSwing(d1, id, { swing: "negative" });
    expect(d2.openings[0]).toMatchObject({ hinge: "end", swing: "negative" });
    expect(d.openings[0].hinge).toBeUndefined();
  });

  it("round-trips through save/reopen and validates clean", () => {
    const { d, id } = withDoor();
    const d1 = setDoorSwing(d, id, { hinge: "end", swing: "negative" });
    const back = parseDesign(serializeDesign(d1));
    expect(back.openings[0]).toMatchObject({ hinge: "end", swing: "negative" });
    expect(validateDesign(back)).toEqual([]);
  });

  it("rejects bad values, windows, and unknown openings", () => {
    const { d, id } = withDoor();
    expect(() => setDoorSwing(d, id, { hinge: "middle" })).toThrow(/hinge/);
    expect(() => setDoorSwing(d, id, { swing: "up" })).toThrow(/swing/);
    expect(() => setDoorSwing(d, "nope", { hinge: "end" })).toThrow(/Unknown opening/);
    const w = withDoor("window");
    expect(() => setDoorSwing(w.d, w.id, { hinge: "end" })).toThrow(/door/);
  });
});

describe("validateDesign: door swing fields", () => {
  it("reports invalid stored values instead of silently drawing a default", () => {
    const { d } = withDoor();
    const bad = { ...d, openings: [{ ...d.openings[0], hinge: "left", swing: "in" }] };
    const errors = validateDesign(bad);
    expect(errors.some((e) => /hinge/.test(e))).toBe(true);
    expect(errors.some((e) => /swing/.test(e))).toBe(true);
  });
});
