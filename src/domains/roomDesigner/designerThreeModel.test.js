import { describe, expect, it } from "vitest";
import {
  buildThreeScene,
  furnitureToBox,
  highlightKeysForSelection,
  highlightRegistryKey,
  pickWallAt,
  splitWallByOpenings,
  stairsDescriptors,
} from "./designerThreeModel";
import {
  addOpening,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
  resetDesignerIds,
} from "./designerDocument";
import { STAIR_ANNOTATION_SOURCE } from "./sampleProjects";
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

describe("designerThreeModel — windowGlassForWall", () => {
  it("emits a glass pane per window opening between sill and header", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 48, widthIn: 48 });
    const scene = buildThreeScene(d);
    expect(scene.glass).toHaveLength(1);
    const g = scene.glass[0];
    expect(g.a.x).toBeCloseTo(48);
    expect(g.b.x).toBeCloseTo(96);
    expect(g.y0In).toBe(36);
    expect(g.y1In).toBe(84);
    expect(g.thicknessIn).toBe(4.5);
    expect(g.openingId).toBe(d.openings[0].id);
  });
  it("emits no glass for doors", () => {
    const { design } = designWithDoor();
    expect(buildThreeScene(design).glass).toHaveLength(0);
  });
  it("emits no glass when the wall is shorter than the sill", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 48, widthIn: 48 });
    d.settings = { ...d.settings, wallHeightIn: 30 };
    expect(buildThreeScene(d).glass).toHaveLength(0);
  });
});

describe("designerThreeModel — furniture catalogId passthrough", () => {
  it("carries catalogId on furniture descriptors for 3D composition", () => {
    let d = createEmptyDesign();
    d = addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 });
    d = placeFurniture(d, "bed-queen", 72, 72);
    const scene = buildThreeScene(d);
    expect(scene.furniture[0].catalogId).toBe("bed-queen");
  });
});

describe("designerThreeModel — stairsDescriptors", () => {
  it("returns [] when the design has no stairs", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    expect(stairsDescriptors(d)).toEqual([]);
    expect(buildThreeScene(d).stairs).toEqual([]);
  });

  it("builds a straight stair descriptor from a native symbol", () => {
    let d = createEmptyDesign();
    d.settings = { ...d.settings, wallHeightIn: 108 };
    d = placeSymbol(d, "buildingElements", "stairs-straight", 100, 200, {});
    const [stair] = stairsDescriptors(d);
    expect(stair.kind).toBe("stairs");
    expect(stair.type).toBe("straight");
    expect(stair.x).toBe(100);
    expect(stair.z).toBe(200);
    expect(stair.rotY).toBeCloseTo(0);
    // Arch review required changes: explicit axis convention + elevation hook.
    expect(stair.axis).toBe("local-x");
    expect(stair.runDirection).toBe("positive-x");
    expect(stair.baseElevationIn).toBe(0);
    expect(stair.riseIn).toBe(108);
    // 108 / 7.75 -> 14 steps, 144" run -> ~10.3" treads: valid.
    expect(stair.parts).toHaveLength(1);
    expect(stair.parts[0].kind).toBe("run");
    expect(stair.parts[0].steps).toBe(14);
    expect(stair.parts[0].riserIn).toBeLessThanOrEqual(7.75);
    expect(stair.validGeometry).toBe(true);
    expect(stair.warnings).toEqual([]);
  });

  it("maps screen-clockwise rotation to three.js counter-clockwise radians", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-straight", 0, 0, { rotationDeg: 90 });
    const [stair] = stairsDescriptors(d);
    expect(stair.rotY).toBeCloseTo(-Math.PI / 2);
  });

  it("sizes the stair from per-instance overrides", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-straight", 258, 204, {
      rotationDeg: 90,
      widthIn: 104,
      depthIn: 60,
    });
    const [stair] = stairsDescriptors(d);
    expect(stair.runIn).toBe(104);
    expect(stair.widthIn).toBe(60);
    expect(stair.parts[0].treadIn).toBeCloseTo(104 / 14, 5);
  });

  it("warns without blocking on unrealistic tread depth", () => {
    let d = createEmptyDesign();
    // 108" rise but only a 42" run: 14 steps of 3" treads.
    d = placeSymbol(d, "buildingElements", "stairs-straight", 0, 0, {
      widthIn: 42,
      depthIn: 42,
    });
    const [stair] = stairsDescriptors(d);
    expect(stair.validGeometry).toBe(false);
    expect(stair.warnings.length).toBeGreaterThan(0);
    expect(stair.warnings[0]).toMatch(/Tread depth/);
    // Still fully described — the renderer draws it anyway.
    expect(stair.parts[0].steps).toBe(14);
  });

  it("composes L stairs from two runs and a landing", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-l", 0, 0, {});
    const [stair] = stairsDescriptors(d);
    expect(stair.type).toBe("l");
    expect(stair.parts.map((p) => p.kind)).toEqual(["run", "landing", "run"]);
    const [runA, landing, runB] = stair.parts;
    expect(runA.dir).toBe("positive-x");
    expect(runB.dir).toBe("positive-z");
    expect(landing.y0).toBeCloseTo(54, 5); // half of 108
    expect(runA.riseIn + runB.riseIn).toBeCloseTo(108, 5);
  });

  it("composes U stairs from two runs and a landing", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-u", 0, 0, {});
    const [stair] = stairsDescriptors(d);
    expect(stair.type).toBe("u");
    expect(stair.parts.map((p) => p.kind)).toEqual(["run", "landing", "run"]);
    const [runA, landing, runB] = stair.parts;
    expect(runA.dir).toBe("negative-x");
    expect(runB.dir).toBe("positive-x");
    expect(landing.y0).toBeCloseTo(54, 5);
  });

  it("falls back to legacy annotations when no native stair exists", () => {
    let d = createEmptyDesign();
    d = {
      ...d,
      annotations: [
        {
          id: "a1",
          kind: "path",
          closed: true,
          points: [
            { x: 228, y: 152 },
            { x: 288, y: 152 },
            { x: 288, y: 256 },
            { x: 228, y: 256 },
          ],
          source: STAIR_ANNOTATION_SOURCE,
        },
      ],
    };
    const [stair] = stairsDescriptors(d);
    expect(stair).toBeTruthy();
    expect(stair.legacy).toBe(true);
    expect(stair.runIn).toBe(104);
    expect(stair.widthIn).toBe(60);
    // Long axis is plan Y -> rotY -90deg maps local +x to plan +y.
    expect(stair.rotY).toBeCloseTo(-Math.PI / 2);
  });

  it("native symbols take priority over legacy annotations", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-straight", 0, 0, {});
    d = {
      ...d,
      annotations: [
        {
          id: "a1",
          kind: "path",
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 104 },
            { x: 0, y: 104 },
          ],
          source: STAIR_ANNOTATION_SOURCE,
        },
      ],
    };
    const stairs = stairsDescriptors(d);
    expect(stairs).toHaveLength(1);
    expect(stairs[0].legacy).toBeFalsy();
  });

  it("is pure serializable JSON with no three.js objects", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "buildingElements", "stairs-l", 10, 20, { rotationDeg: 45 });
    const stairs = stairsDescriptors(d);
    expect(() => JSON.stringify(stairs)).not.toThrow();
    expect(JSON.parse(JSON.stringify(stairs))).toEqual(stairs);
  });
});


// P1-A: split-screen view sync — selection -> 3D highlight-registry mapping.
// Pure, framework-free: no Three.js object is created or needed to test this.
describe("highlightRegistryKey / highlightKeysForSelection", () => {
  it("builds a stable, distinct key per kind and id", () => {
    expect(highlightRegistryKey("wall", "w1")).toBe("wall:w1");
    expect(highlightRegistryKey("wall", "w2")).not.toBe(highlightRegistryKey("wall", "w1"));
    expect(highlightRegistryKey("wall", "w1")).not.toBe(highlightRegistryKey("opening", "w1"));
  });

  it("maps a wall selection to its own registry key", () => {
    expect(highlightKeysForSelection({ kind: "wall", id: "w1" }, createEmptyDesign())).toEqual([
      "wall:w1",
    ]);
  });

  it("maps an opening selection to its own registry key", () => {
    expect(highlightKeysForSelection({ kind: "opening", id: "o1" }, createEmptyDesign())).toEqual([
      "opening:o1",
    ]);
  });

  it("maps a furniture selection to its own registry key", () => {
    expect(highlightKeysForSelection({ kind: "furniture", id: "f1" }, createEmptyDesign())).toEqual([
      "furniture:f1",
    ]);
  });

  it("maps a room selection to ALL of its walls' keys, since a room has no mesh of its own", () => {
    let d = addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 0, y: 0 });
    const room = d.rooms[0];
    expect(room.wallIds).toHaveLength(4);
    const keys = highlightKeysForSelection({ kind: "room", id: room.id }, d);
    expect(keys).toEqual(room.wallIds.map((id) => `wall:${id}`));
  });

  it("maps an unknown room id to no keys, rather than throwing", () => {
    expect(highlightKeysForSelection({ kind: "room", id: "nope" }, createEmptyDesign())).toEqual([]);
  });

  it("maps symbol and pipe selections to no keys — no 3D mesh exists for them yet", () => {
    expect(highlightKeysForSelection({ kind: "symbol", id: "s1" }, createEmptyDesign())).toEqual([]);
    expect(highlightKeysForSelection({ kind: "pipe", id: "p1" }, createEmptyDesign())).toEqual([]);
  });

  it("maps a sheet or org-chart selection to no keys — neither exists in 3D", () => {
    expect(highlightKeysForSelection({ kind: "sheet", id: "sh1" }, createEmptyDesign())).toEqual([]);
    expect(highlightKeysForSelection({ kind: "orgchart", id: "oc1" }, createEmptyDesign())).toEqual([]);
  });

  it("maps no selection to no keys", () => {
    expect(highlightKeysForSelection(null, createEmptyDesign())).toEqual([]);
    expect(highlightKeysForSelection(undefined, createEmptyDesign())).toEqual([]);
    expect(highlightKeysForSelection({}, createEmptyDesign())).toEqual([]);
  });

  it("tolerates a missing design for a non-room selection", () => {
    expect(highlightKeysForSelection({ kind: "wall", id: "w1" }, null)).toEqual(["wall:w1"]);
  });
});
