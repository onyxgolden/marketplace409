import { describe, expect, it } from "vitest";
import {
  buildThreeScene,
  furnitureToBox,
  highlightKeysForSelection,
  highlightRegistryKey,
  pickWallAt,
  pipeDescriptors,
  splitWallByOpenings,
  stairsDescriptors,
} from "./designerThreeModel";
import {
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
  resetDesignerIds,
} from "./designerDocument";
import { addSystem, setMemberColor, setMemberSystem, setPipeUnderground } from "./designSystems";
import { setRackParams } from "./rackGeometry";
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

  it("returns floor: null for an empty design", () => {
    expect(buildThreeScene(createEmptyDesign()).floor).toBeNull();
  });

  it("frames a pipes-only design far from the origin, with no wall or equipment (P661-001)", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 10000, y: 10000 }, { x: 11000, y: 10000 }], { id: "far", diameterIn: 4 });
    const scene = buildThreeScene(d);
    expect(scene.pipes).toHaveLength(1);
    // Centerline 10000..11000 x, 10000 z, expanded by radius 2, padded 24.
    expect(scene.floor).toEqual({ minX: 9974, maxX: 11026, minZ: 9974, maxZ: 10026 });
  });

  it("extends the floor past existing equipment when a pipe runs beyond it (P661-001)", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "processEquipment", "centrifugal-pump", 0, 0, { id: "pump" });
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 600, y: 0 }], { id: "long", diameterIn: 4 });
    const scene = buildThreeScene(d);
    expect(scene.equipment).toHaveLength(1);
    // Pipe end 600 + radius 2 + pad 24; the pump's own extent is far smaller.
    expect(scene.floor.maxX).toBe(626);
    expect(scene.floor.minZ).toBeLessThan(-26); // pump depth extends past the pipe's -26
  });

  it("keeps legacy framing when pipes are absent (P661-001)", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    const scene = buildThreeScene(d);
    expect(scene.pipes).toEqual([]);
    expect(scene.floor).toEqual({ minX: -24, maxX: 168, minZ: -24, maxZ: 24 });
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

  it("maps a symbol to its own key (process equipment has a 3D mesh; other symbols just match nothing)", () => {
    expect(highlightKeysForSelection({ kind: "symbol", id: "s1" }, createEmptyDesign())).toEqual(["symbol:s1"]);
  });

  it("maps a pipe selection to its own registry key — pipe runs have a 3D mesh", () => {
    expect(highlightKeysForSelection({ kind: "pipe", id: "p1" }, createEmptyDesign())).toEqual([
      "pipe:p1",
    ]);
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

describe("designerThreeModel — pipeDescriptors", () => {
  it("resolves colors own > system > default across three runs", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 120, y: 0 }], { id: "own", diameterIn: 4 });
    d = addPipeRun(d, [{ x: 0, y: 60 }, { x: 120, y: 60 }], { id: "sys" });
    d = addPipeRun(d, [{ x: 0, y: 120 }, { x: 120, y: 120 }], { id: "plain" });
    d = addSystem(d, { name: "Cooling water", color: "#22c55e" });
    d = setMemberColor(d, { kind: "pipe", id: "own" }, "#ef4444");
    d = setMemberSystem(d, { kind: "pipe", id: "sys" }, "system_1");

    const pipes = pipeDescriptors(d);
    expect(pipes.map((p) => p.id)).toEqual(["own", "sys", "plain"]);
    expect(pipes.map((p) => p.color)).toEqual(["#ef4444", "#22c55e", "#7dd3fc"]);
    // Diameter carries through and radius derives from it (default 2 in).
    expect(pipes[0]).toMatchObject({ kind: "pipe", diameterIn: 4, radiusIn: 2, underground: false });
    expect(pipes[1]).toMatchObject({ diameterIn: 2, radiusIn: 1 });
    // Plan coords map x -> x, y -> z, at the low pipeway centerline.
    expect(pipes[0].segments).toEqual([{ a: { x: 0, z: 0 }, b: { x: 120, z: 0 }, yIn: 30 }]);
    expect(pipes[0].joints).toEqual([
      { x: 0, z: 0, yIn: 30 },
      { x: 120, z: 0, yIn: 30 },
    ]);
    expect(pipes[0].risers).toEqual([]);
  });

  it("rides a segment on a pipe rack at tier-1 top of steel plus radius, and risers down to grade", () => {
    let d = createEmptyDesign();
    // Pipe rack: 480 x 240 footprint centered at (300, 160), so it spans
    // x 60..540, y 40..280; its tier-1 top of steel defaults to 180 in.
    d = placeSymbol(d, "processEquipment", "pipe-rack", 300, 160, { id: "pr" });
    // Segment 1's midpoint (250, 160) is inside the rack; segment 2's
    // midpoint (550, 160) is outside it.
    d = addPipeRun(d, [{ x: 100, y: 160 }, { x: 400, y: 160 }, { x: 700, y: 160 }], { id: "run" });

    const [pipe] = pipeDescriptors(d);
    expect(pipe.segments).toHaveLength(2);
    expect(pipe.segments[0].yIn).toBe(181); // 180 tier-1 TOS + 1 radius
    expect(pipe.segments[1].yIn).toBe(30); // low pipeway centerline off the rack
    // One riser at the transition vertex, spanning grade up to the rack.
    expect(pipe.risers).toEqual([{ x: 400, z: 160, y0In: 30, y1In: 181 }]);
    // Joints: start/end take their segment's elevation; the interior
    // vertex takes the higher of its two adjacent segments.
    expect(pipe.joints).toEqual([
      { x: 100, z: 160, yIn: 181 },
      { x: 400, z: 160, yIn: 181 },
      { x: 700, z: 160, yIn: 30 },
    ]);
    // The same descriptors come out of buildThreeScene.
    expect(buildThreeScene(d).pipes).toEqual([pipe]);
  });

  it("tests segment midpoints against the rack footprint in its rotated local frame", () => {
    let d = createEmptyDesign();
    // Rotated 90°: the 480-long axis runs along plan y and the 240-wide
    // axis along plan x, so the footprint spans x 180..420, y -80..400.
    d = placeSymbol(d, "processEquipment", "pipe-rack", 300, 160, { id: "pr", rotationDeg: 90 });
    d = addPipeRun(d, [{ x: 200, y: 350 }, { x: 400, y: 350 }], { id: "on-rotated" });
    d = addPipeRun(d, [{ x: 50, y: 160 }, { x: 150, y: 160 }], { id: "off-rotated" });
    const pipes = pipeDescriptors(d);
    // (300, 350) is inside only the rotated footprint; (100, 160) is
    // inside only the unrotated one.
    expect(pipes.find((p) => p.id === "on-rotated").segments[0].yIn).toBe(181);
    expect(pipes.find((p) => p.id === "off-rotated").segments[0].yIn).toBe(30);
  });

  it("rests on a sleeper rack below grade instead of floating at grade (P661-003)", () => {
    let d = createEmptyDesign();
    // Default sleeper rack: top of steel 18 in.
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 0, 0, { id: "sl", widthIn: 600, depthIn: 120 });
    d = addPipeRun(d, [{ x: -100, y: 0 }, { x: 100, y: 0 }], { id: "sleep", diameterIn: 4 });
    // 18 TOS + 2 radius = 20, NOT the 30 in grade baseline.
    expect(pipeDescriptors(d)[0].segments[0].yIn).toBe(20);
    expect(pipeDescriptors(d)[0].joints.map((j) => j.yIn)).toEqual([20, 20]);
  });

  it("picks the highest containing support among overlapping racks (P661-003)", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 0, 0, { id: "s1", widthIn: 600, depthIn: 120 });
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 0, 0, { id: "s2", widthIn: 600, depthIn: 120 });
    d = setRackParams(d, "s2", { elevationIn: 24 });
    d = addPipeRun(d, [{ x: -100, y: 0 }, { x: 100, y: 0 }], { id: "over", diameterIn: 4 });
    // Two containing sleepers (18 and 24): the higher wins — 24 + 2 = 26,
    // still below grade, proving grade never enters the support choice.
    expect(pipeDescriptors(d)[0].segments[0].yIn).toBe(26);

    // A containing pipe rack (TOS 180) overlapping the same midpoint wins overall.
    let d2 = createEmptyDesign();
    d2 = placeSymbol(d2, "processEquipment", "sleeper-rack", 0, 0, { id: "s1", widthIn: 600, depthIn: 120 });
    d2 = placeSymbol(d2, "processEquipment", "pipe-rack", 0, 0, { id: "pr" });
    d2 = addPipeRun(d2, [{ x: -100, y: 0 }, { x: 100, y: 0 }], { id: "over2", diameterIn: 4 });
    expect(pipeDescriptors(d2)[0].segments[0].yIn).toBe(182); // 180 + 2
  });

  it("uses grade only when no rack contains the segment (P661-003)", () => {
    let d = createEmptyDesign();
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 0, 0, { id: "sl", widthIn: 600, depthIn: 120 });
    d = addPipeRun(d, [{ x: 1000, y: 1000 }, { x: 1200, y: 1000 }], { id: "away", diameterIn: 4 });
    expect(pipeDescriptors(d)[0].segments[0].yIn).toBe(30);
  });

  it("tests sleeper-rack containment in its rotated local frame (P661-003)", () => {
    let d = createEmptyDesign();
    // Rotated 90°: the 600-long axis runs along plan y, 120-wide along x,
    // so the footprint spans x -60..60, y -300..300.
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 0, 0, { id: "sl", widthIn: 600, depthIn: 120, rotationDeg: 90 });
    d = addPipeRun(d, [{ x: -100, y: 200 }, { x: 100, y: 200 }], { id: "on-rot-sleeper", diameterIn: 4 });
    // Midpoint (0, 200) is inside only the rotated footprint.
    expect(pipeDescriptors(d)[0].segments[0].yIn).toBe(20);
  });

  it("still describes an underground run, with the flag carried through", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 120, y: 0 }], { id: "ug" });
    d = setPipeUnderground(d, "ug", true);
    const [pipe] = pipeDescriptors(d);
    expect(pipe.underground).toBe(true);
    expect(pipe.segments).toHaveLength(1);
    expect(pipe.joints).toHaveLength(2);
  });

  it("skips runs with fewer than two points", () => {
    let d = createEmptyDesign();
    d = { ...d, pipes: [{ id: "bad", points: [{ x: 0, y: 0 }] }] };
    expect(pipeDescriptors(d)).toEqual([]);
  });

  it("buildThreeScene returns pipes: [] for a design without pipes, other arrays unchanged", () => {
    let d = createEmptyDesign();
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    d = placeFurniture(d, "bed-queen", 72, 72);
    const scene = buildThreeScene(d);
    expect(scene.pipes).toEqual([]);
    expect(scene.walls).toHaveLength(1);
    expect(scene.furniture).toHaveLength(1);
    expect(scene.glass).toEqual([]);
    expect(scene.stairs).toEqual([]);
    expect(scene.equipment).toEqual([]);
  });

  it("is pure serializable JSON with no three.js objects", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }], { id: "p1" });
    const pipes = pipeDescriptors(d);
    expect(() => JSON.stringify(pipes)).not.toThrow();
    expect(JSON.parse(JSON.stringify(pipes))).toEqual(pipes);
  });
});
