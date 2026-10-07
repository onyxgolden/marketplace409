// Saved 3D camera views live in the design document as `cameraViews`.
// Documents saved before this field existed must still load, with an empty list.

import { describe, expect, it } from "vitest";
import { addNamedView } from "./namedCameraViews";
import { createEmptyDesign, parseDesign, serializeDesign, validateDesign } from "./designerDocument";

const pose = { position: { x: 10, y: 100, z: 200 }, target: { x: 0, y: 0, z: 0 } };

describe("cameraViews in the design document", () => {
  it("a new design starts with no saved views", () => {
    expect(createEmptyDesign().cameraViews).toEqual([]);
  });

  it("saved views survive a serialize and parse round trip", () => {
    const design = { ...createEmptyDesign(), cameraViews: addNamedView([], "Entry", pose) };
    const loaded = parseDesign(serializeDesign(design));
    expect(loaded.cameraViews).toEqual(design.cameraViews);
  });

  it("an older document without cameraViews loads with an empty list", () => {
    const legacy = createEmptyDesign();
    delete legacy.cameraViews;
    const loaded = parseDesign(JSON.stringify(legacy));
    expect(loaded.cameraViews).toEqual([]);
  });

  it("validation reports a saved view with a broken pose", () => {
    const design = {
      ...createEmptyDesign(),
      cameraViews: [{ id: "view-x", name: "Bad", pose: { position: { x: NaN, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } } }],
    };
    expect(validateDesign(design).join(" ")).toMatch(/camera view "Bad"/);
  });

  it("validation reports two saved views sharing an ID", () => {
    const first = addNamedView([], "Entry", pose);
    const second = addNamedView([], "Kitchen", pose);
    const design = { ...createEmptyDesign(), cameraViews: [first[0], { ...second[0], id: first[0].id }] };
    expect(validateDesign(design).join(" ")).toMatch(/duplicate camera view id/);
  });

  it("loading a design with duplicate view IDs gives every view its own ID and keeps the names and poses", () => {
    const first = addNamedView([], "Entry", pose);
    const second = addNamedView([], "Kitchen", pose);
    const design = { ...createEmptyDesign(), cameraViews: [first[0], { ...second[0], id: first[0].id }] };
    const loaded = parseDesign(JSON.stringify(design));
    const ids = loaded.cameraViews.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(loaded.cameraViews.map((v) => v.name)).toEqual(["Entry", "Kitchen"]);
    expect(loaded.cameraViews[1].pose).toEqual(pose);
  });

  it("validation accepts well-formed saved views", () => {
    const design = { ...createEmptyDesign(), cameraViews: addNamedView([], "Entry", pose) };
    expect(validateDesign(design)).toEqual([]);
  });
});
