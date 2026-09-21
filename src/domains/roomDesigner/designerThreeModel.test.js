import { describe, expect, it } from "vitest";
import {
  buildThreeScene,
  furnitureToBox,
  pickWallAt,
  splitWallByOpenings,
} from "./designerThreeModel";
import {
  addOpening,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  resetDesignerIds,
} from "./designerDocument";
import { beforeEach } from "vitest";

beforeEach(() => resetDesignerIds());

function designWithDoor() {
  let d = createEmptyDesign();
  d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
  const wallId = d.walls[0].id;
  d = addOpening(d, wallId, { type: "door", offsetIn: 36, widthIn: 36 });
  return { design: d, wallId };
}

describe("designerThreeModel — splitWallByOpenings", () => {
  it("splits a wall into solid segments around a door gap", () => {
    const { design, wallId } = designWithDoor();
    const wall = design.walls[0];
    const segments = splitWallByOpenings(wall, design.openings, { wallHeightIn: 108 });
    const solids = segments.filter((s) => s.kind === "wall");
    expect(solids).toHaveLength(2);
    // [0,36] and [72,144]
    expect(solids[0].a.x).toBeCloseTo(0);
    expect(solids[0].b.x).toBeCloseTo(36);
    expect(solids[1].a.x).toBeCloseTo(72);
    expect(solids[1].b.x).toBeCloseTo(144);
    for (const s of solids) {
      expect(s.y0In).toBe(0);
      expect(s.y1In).toBe(108);
    }
  });

  it("emits sill and header boxes for a window, with a real gap between", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 48, widthIn: 48 });
    const segments = splitWallByOpenings(d.walls[0], d.openings, { wallHeightIn: 108 });
    const sill = segments.find((s) => s.kind === "sill");
    const header = segments.find((s) => s.kind === "header");
    expect(sill).toBeDefined();
    expect(sill.y0In).toBe(0);
    expect(sill.y1In).toBe(36);
    expect(header).toBeDefined();
    expect(header.y0In).toBe(84);
    expect(header.y1In).toBe(108);
    // no full-height solid may cover the window span
    const solids = segments.filter((s) => s.kind === "wall");
    expect(solids).toHaveLength(2);
    expect(solids[1].a.x).toBeCloseTo(96);
  });

  it("returns one full segment when there are no openings", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 100, y: 0 });
    const segments = splitWallByOpenings(d.walls[0], [], { wallHeightIn: 96 });
    expect(segments).toHaveLength(1);
    expect(segments[0].y1In).toBe(96);
  });

  it("handles multiple openings in offset order", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 200, y: 0 });
    const wallId = d.walls[0].id;
    d = addOpening(d, wallId, { type: "door", offsetIn: 120, widthIn: 36 });
    d = addOpening(d, wallId, { type: "door", offsetIn: 20, widthIn: 36 });
    const segments = splitWallByOpenings(d.walls[0], d.openings, { wallHeightIn: 108 });
    const solids = segments.filter((s) => s.kind === "wall");
    expect(solids).toHaveLength(3);
    expect(solids[0].b.x).toBeCloseTo(20);
    expect(solids[2].a.x).toBeCloseTo(156);
  });
});

describe("designerThreeModel — furnitureToBox", () => {
  it("maps a catalog piece to a 3D box with rotation", () => {
    const box = furnitureToBox({ id: "f1", catalogId: "bed-queen", x: 100, y: 50, rotationDeg: 90 });
    expect(box).toMatchObject({
      x: 100, z: 50, widthIn: 60, depthIn: 80, heightIn: 28, label: "Queen bed",
    });
    expect(box.rotY).toBeCloseTo(-Math.PI / 2);
  });

  it("returns null for unknown catalog pieces", () => {
    expect(furnitureToBox({ id: "f1", catalogId: "nope", x: 0, y: 0, rotationDeg: 0 })).toBeNull();
  });
});

describe("designerThreeModel — buildThreeScene", () => {
  it("builds walls, furniture, and a padded floor from a room template", () => {
    let d = createEmptyDesign();
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }); // 144x144
    d = placeFurniture(d, "bed-queen", 72, 72);
    const scene = buildThreeScene(d);
    expect(scene.walls).toHaveLength(4);
    expect(scene.furniture).toHaveLength(1);
    expect(scene.floor.minX).toBeLessThan(0);
    expect(scene.floor.maxX).toBeGreaterThan(144);
    for (const w of scene.walls) {
      expect(w.thicknessIn).toBe(4.5);
    }
  });

  it("throws on a non-document", () => {
    expect(() => buildThreeScene(null)).toThrow(/document/);
  });
});

describe("designerThreeModel — pickWallAt", () => {
  it("picks the nearest wall within tolerance", () => {
    const { design } = designWithDoor();
    const hit = pickWallAt(design, { x: 100, y: 5 });
    expect(hit.id).toBe(design.walls[0].id);
    expect(pickWallAt(design, { x: 100, y: 500 })).toBeNull();
  });
});
