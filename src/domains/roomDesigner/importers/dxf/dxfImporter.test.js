// dxfImporter.test.js — DXF import: parsing, geometry, wall reconstruction,
// openings, rooms, units, layer roles, and a round trip through our own export.

import { beforeEach, describe, expect, it } from "vitest";
import { addOpening, addWall, createEmptyDesign, resetDesignerIds, validateDesign } from "../../designerDocument";
import { createHomeProject, resetHomeProjectIds } from "../../homeProject";
import { planToDxf } from "../../homeDxfExport";
import { wallLength } from "../../designerGeometry";
import { parseDxf } from "./dxfParser";
import { bulgePolyline, collectGeometry } from "./dxfGeometry";
import { suggestRole } from "./dxfLayers";
import { reconstructWalls } from "./dxfWalls";
import { commitDxfImport, prepareDxfImport, readDxfDrawing } from "./dxfImporter";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

// ---- tiny DXF writer for fixtures -------------------------------------------
const pairs = (...p) => p.flat().join("\n");
const line = (layer, x1, y1, x2, y2) => pairs(["0", "LINE", "8", layer, "10", x1, "20", y1, "11", x2, "21", y2]);
const lwpoly = (layer, pts, closed = false) =>
  pairs(["0", "LWPOLYLINE", "8", layer, "90", pts.length, "70", closed ? 1 : 0, ...pts.flatMap(([x, y, bulge]) => ["10", x, "20", y, ...(bulge ? ["42", bulge] : [])])]);
const text = (layer, x, y, value) => pairs(["0", "TEXT", "8", layer, "10", x, "20", y, "40", 6, "1", value]);
function dxf({ units = 1, entities = [], blocks = "", layers = [] } = {}) {
  return pairs(
    ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", units, "0", "ENDSEC"],
    ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", ...layers.flatMap(([name, color = 7, flags = 0]) => ["0", "LAYER", "2", name, "70", flags, "62", color]), "0", "ENDTAB", "0", "ENDSEC"],
    ["0", "SECTION", "2", "BLOCKS", blocks, "0", "ENDSEC"],
    ["0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC"],
    ["0", "EOF"],
  ).replace(/\n\n+/g, "\n");
}
/** A double-line wall along x from x0 to x1 at y, thickness t (faces at y±t/2). */
const hWall = (layer, x0, x1, y, t = 4.5) => [line(layer, x0, y + t / 2, x1, y + t / 2), line(layer, x0, y - t / 2, x1, y - t / 2)];
const vWall = (layer, y0, y1, x, t = 4.5) => [line(layer, x + t / 2, y0, x + t / 2, y1), line(layer, x - t / 2, y0, x - t / 2, y1)];

// ---- parsing ------------------------------------------------------------------
describe("parser", () => {
  it("reads units, layers (with off/frozen), blocks and entities", () => {
    const d = parseDxf(dxf({ units: 2, layers: [["A-WALL"], ["OLD", -7], ["FROZEN", 7, 1]], entities: [line("A-WALL", 0, 0, 10, 0)] }));
    expect(d.header.insUnits).toBe(2);
    expect(d.layers.get("OLD").off).toBe(true);
    expect(d.layers.get("FROZEN").frozen).toBe(true);
    expect(d.entities).toMatchObject([{ type: "LINE", layer: "A-WALL", x: 0, y: 0, x2: 10, y2: 0 }]);
  });

  it("refuses binary DXF, DWG and non-DXF input with clear messages", () => {
    const bytes = (s) => new TextEncoder().encode(s);
    expect(() => parseDxf(bytes("AutoCAD Binary DXF\r\n\u001a\u0000"))).toThrow(/binary DXF/);
    expect(() => parseDxf(bytes("AC1032\u0000\u0000binary"))).toThrow(/DWG/);
    expect(() => parseDxf("hello world")).toThrow(/doesn't look like a DXF/);
  });

  it("folds POLYLINE/VERTEX/SEQEND into one polyline", () => {
    const poly = pairs(["0", "POLYLINE", "8", "X", "66", 1, "70", 1, "0", "VERTEX", "8", "X", "10", 0, "20", 0, "0", "VERTEX", "8", "X", "10", 10, "20", 0, "0", "VERTEX", "8", "X", "10", 10, "20", 10, "0", "SEQEND"]);
    const g = collectGeometry(parseDxf(dxf({ entities: [poly] })));
    expect(g.polylines).toHaveLength(1);
    expect(g.polylines[0]).toMatchObject({ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  });
});

describe("geometry", () => {
  it("flattens bulges into true arcs (both directions)", () => {
    const up = bulgePolyline([{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0 }], false);
    const down = bulgePolyline([{ x: 0, y: 0, bulge: -1 }, { x: 2, y: 0 }], false);
    expect(up[Math.floor(up.length / 2)].y).toBeCloseTo(-1, 5);
    expect(down[Math.floor(down.length / 2)].y).toBeCloseTo(1, 5);
    for (const p of bulgePolyline([{ x: 1, y: 0, bulge: Math.tan(Math.PI / 8) }, { x: 0, y: 1 }], false)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 6);
    }
  });

  it("expands INSERTs with scale, rotation and base point; layer-0 content takes the insert's layer", () => {
    const block = pairs(["0", "BLOCK", "8", "0", "2", "DOORBLK", "10", 1, "20", 0, "70", 0], line("0", 1, 0, 3, 0), ["0", "ENDBLK"]);
    const insert = pairs(["0", "INSERT", "8", "A-DOOR", "2", "DOORBLK", "10", 100, "20", 50, "41", 2, "42", 2, "50", 90]);
    const g = collectGeometry(parseDxf(dxf({ blocks: block, entities: [insert] })));
    expect(g.polylines).toHaveLength(1);
    const [p0, p1] = g.polylines[0].points;
    expect(g.polylines[0].layer).toBe("A-DOOR");
    expect(p0.x).toBeCloseTo(100, 6);
    expect(p0.y).toBeCloseTo(50, 6);
    expect(p1.x).toBeCloseTo(100, 6);
    expect(p1.y).toBeCloseTo(54, 6);
  });

  it("strips MTEXT formatting", () => {
    const m = pairs(["0", "MTEXT", "8", "A-AREA", "10", 5, "20", 5, "40", 6, "1", "{\\fArial|b1;KITCHEN}\\P12'-0\""]);
    expect(collectGeometry(parseDxf(dxf({ entities: [m] }))).texts[0].text).toBe("KITCHEN 12'-0\"");
  });
});

describe("layer roles", () => {
  it("suggests roles from common layer names and ignores hidden layers", () => {
    expect(suggestRole("A-WALL")).toBe("walls");
    expect(suggestRole("A-L01-WALL")).toBe("walls");
    expect(suggestRole("A-WALL-PATT")).toBe("annotation");
    expect(suggestRole("A-DOOR")).toBe("doors");
    expect(suggestRole("A-GLAZ")).toBe("windows");
    expect(suggestRole("A-AREA-IDEN")).toBe("rooms");
    expect(suggestRole("DEFPOINTS")).toBe("ignore");
    expect(suggestRole("A-FURN")).toBe("annotation");
    expect(suggestRole("A-WALL", { off: true })).toBe("ignore");
  });
});

// ---- wall reconstruction --------------------------------------------------------
describe("reconstructWalls", () => {
  const S = (a, b) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });

  it("pairs two faces into one centerline with the right thickness", () => {
    const { walls } = reconstructWalls([S([0, 0], [120, 0]), S([0, 4.5], [120, 4.5])]);
    expect(walls).toHaveLength(1);
    expect(walls[0].thicknessIn).toBe(4.5);
    expect(walls[0].a.y).toBeCloseTo(2.25, 6);
    expect(wallLength(walls[0])).toBeCloseTo(120, 6);
  });

  it("rejoins a wall broken for a door and cuts the gap in as the opening", () => {
    const faces = [S([0, 0], [40, 0]), S([76, 0], [120, 0]), S([0, 4.5], [40, 4.5]), S([76, 4.5], [120, 4.5])];
    const door = { type: "door", points: [{ x: 40, y: 0 }, { x: 40, y: 4.5 }, { x: 76, y: 0 }, { x: 76, y: 4.5 }, { x: 40, y: 40 }] };
    const { walls, unplaced } = reconstructWalls(faces, [door]);
    expect(walls).toHaveLength(1);
    expect(walls[0].openings).toEqual([{ type: "door", offsetIn: 40, widthIn: 36 }]);
    expect(unplaced).toEqual([]);
  });

  it("does NOT bridge a gap with nothing in it (two separate walls)", () => {
    const faces = [S([0, 0], [40, 0]), S([76, 0], [120, 0]), S([0, 4.5], [40, 4.5]), S([76, 4.5], [120, 4.5])];
    expect(reconstructWalls(faces).walls).toHaveLength(2);
  });

  it("closes an L-corner where the face pairs stop short", () => {
    // Real CAD corner: outer faces meet at (−2.25, −2.25); inner at (2.25, 2.25).
    const faces = [S([-2.25, -2.25], [120, -2.25]), S([2.25, 2.25], [120, 2.25]), S([-2.25, -2.25], [-2.25, 96]), S([2.25, 2.25], [2.25, 96])];
    const { walls } = reconstructWalls(faces);
    expect(walls).toHaveLength(2);
    const ends = walls.flatMap((w) => [w.a, w.b]);
    const atCorner = ends.filter((p) => Math.hypot(p.x, p.y) < 0.01);
    expect(atCorner).toHaveLength(2);
  });

  it("takes long single lines as centerlines and drops short ticks", () => {
    const { walls, notes } = reconstructWalls([S([0, 0], [100, 0]), S([0, 50], [0, 54])]);
    expect(walls).toHaveLength(1);
    expect(notes[0]).toMatch(/single wall line/);
  });

  it("places a door drawn on an unbroken wall by projecting its linework", () => {
    const faces = [S([0, 0], [120, 0]), S([0, 4.5], [120, 4.5])];
    // Door leaf + 90° swing: spans x 30..66 along the wall.
    const swing = Array.from({ length: 10 }, (_, i) => ({ x: 30 + 36 * Math.cos((i / 9) * (Math.PI / 2)), y: 4.5 + 36 * Math.sin((i / 9) * (Math.PI / 2)) }));
    const { walls } = reconstructWalls(faces, [{ type: "door", points: [{ x: 30, y: 4.5 }, { x: 30, y: 40.5 }, ...swing] }]);
    expect(walls[0].openings).toHaveLength(1);
    expect(walls[0].openings[0].offsetIn).toBeCloseTo(30, 1);
    expect(walls[0].openings[0].widthIn).toBeCloseTo(36, 1);
  });
});

// ---- full pipeline ----------------------------------------------------------------
describe("prepareDxfImport", () => {
  function plan() {
    return dxf({
      units: 1,
      layers: [["A-WALL"], ["A-DOOR"], ["A-GLAZ"], ["A-AREA-IDEN"], ["A-FURN"]],
      entities: [
        // 10' x 8' room, walls centered on 0..120 x 0..96 (CAD Y-up)
        ...hWall("A-WALL", -2.25, 40, 0), ...hWall("A-WALL", 76, 122.25, 0), // south wall, door gap 40..76
        ...hWall("A-WALL", -2.25, 122.25, 96),
        ...vWall("A-WALL", 2.25, 93.75, 0), ...vWall("A-WALL", 2.25, 93.75, 120),
        line("A-DOOR", 40, -2.25, 40, 2.25), line("A-DOOR", 76, -2.25, 76, 2.25), line("A-DOOR", 40, 2.25, 40, 38.25),
        lwpoly("A-GLAZ", [[40, 95], [88, 95]]), lwpoly("A-GLAZ", [[40, 97], [88, 97]]),
        lwpoly("A-AREA-IDEN", [[0, 0], [120, 0], [120, 96], [0, 96]], true),
        text("A-AREA-IDEN", 60, 48, "KITCHEN"),
        text("A-AREA-IDEN", 500, 500, "PORCH"),
        lwpoly("A-FURN", [[20, 20], [50, 20], [50, 40], [20, 40]], true),
        pairs(["0", "HATCH", "8", "A-WALL-PATT"]),
      ],
    });
  }

  it("builds walls, a door cut into its gap, a window on its wall, a named room, and annotations", () => {
    const drawing = readDxfDrawing(plan());
    expect(drawing.units).toEqual({ unit: "in", known: true });
    const p = prepareDxfImport(drawing);
    expect(p.counts.walls).toBe(4);
    expect(p.records.openings.map((o) => [o.type, o.widthIn])).toEqual(expect.arrayContaining([["door", 36], ["window", 48]]));
    expect(p.records.rooms).toMatchObject([{ label: "KITCHEN" }]);
    expect(p.records.annotations.some((a) => a.kind === "label" && a.text === "PORCH")).toBe(true);
    expect(p.records.annotations.some((a) => a.kind === "path" && a.source.layer === "A-FURN")).toBe(true);
    expect(p.issues.some((i) => /PORCH|room name/.test(i.message))).toBe(true);
    expect(p.issues.some((i) => /HATCH/.test(i.message))).toBe(true);
    expect(p.wallThicknessIn).toBe(4.5);
    // The merged design is valid.
    const design = commitDxfImport(createEmptyDesign("x"), p);
    expect(validateDesign(design)).toEqual([]);
  });

  it("converts units and lets the user override them", () => {
    const feet = dxf({ units: 2, entities: [...hWall("A-WALL", 0, 10, 0, 0.375)] }); // 10 ft wall, 4.5" thick
    const p = prepareDxfImport(readDxfDrawing(feet));
    expect(wallLength(p.records.walls[0])).toBeCloseTo(120, 4);
    const unitless = dxf({ units: 0, entities: [...hWall("A-WALL", 0, 120, 0)] });
    const d = readDxfDrawing(unitless);
    expect(d.units.known).toBe(false);
    expect(prepareDxfImport(d).issues.some((i) => /doesn't say what units/.test(i.message))).toBe(true);
    expect(prepareDxfImport(d, { unit: "mm" }).sizeIn.w).toBeCloseTo(120 / 25.4, 1); // sizes are rounded to hundredths
  });

  it("follows the user's layer roles", () => {
    const d = readDxfDrawing(plan());
    const p = prepareDxfImport(d, { roles: { "A-WALL": "ignore" } });
    expect(p.counts.walls).toBe(0);
    expect(p.issues.some((i) => /No layer is set to Walls/.test(i.message))).toBe(true);
  });
});

describe("round trip through our own DXF export", () => {
  function roomProject() {
    let d = createEmptyDesign("Cabin");
    d = addWall(d, { x: 0, y: 0 }, { x: 120, y: 0 }, { id: "south" });
    d = addWall(d, { x: 120, y: 0 }, { x: 120, y: 96 }, { id: "east" });
    d = addWall(d, { x: 120, y: 96 }, { x: 0, y: 96 }, { id: "north" });
    d = addWall(d, { x: 0, y: 96 }, { x: 0, y: 0 }, { id: "west" });
    d = addOpening(d, "south", { type: "door", offsetIn: 40, widthIn: 36 });
    d = addOpening(d, "north", { type: "window", offsetIn: 30, widthIn: 48 });
    d = { ...d, rooms: [{ id: "room_1", label: "Cabin", polygon: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }] }] };
    const project = createHomeProject("Cabin project");
    return { original: d, project: { ...project, levels: [{ ...project.levels[0], design: d }] } };
  }

  it("re-imports the same walls, openings and room name", () => {
    const { original, project } = roomProject();
    const exported = planToDxf(project);
    expect(exported.ok).toBe(true);
    const p = prepareDxfImport(readDxfDrawing(exported.dxf));

    // Walls: same count and lengths; same rectangle up to translation.
    expect(p.records.walls).toHaveLength(4);
    const lengths = p.records.walls.map((w) => Math.round(wallLength(w))).sort((a, b) => a - b);
    expect(lengths).toEqual([96, 96, 120, 120]);
    const xs = p.records.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = p.records.walls.flatMap((w) => [w.a.y, w.b.y]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(96, 1);

    // Openings: same types, widths, and positions along their walls.
    const byType = (t) => p.records.openings.find((o) => o.type === t);
    expect(byType("door").widthIn).toBeCloseTo(36, 1);
    expect(byType("window").widthIn).toBeCloseTo(48, 1);
    const doorWall = p.records.walls.find((w) => w.id === byType("door").wallId);
    const doorFromStart = byType("door").offsetIn;
    // The door sits 40" from one end of a 120" wall (either direction).
    expect([40, 120 - 40 - 36].some((v) => Math.abs(doorFromStart - v) < 0.5)).toBe(true);
    expect(Math.round(wallLength(doorWall))).toBe(120);
    expect(original.openings).toHaveLength(p.records.openings.length);

    // Our export has room names but no room outlines → names come back as text.
    expect(p.records.annotations.some((a) => a.kind === "label" && a.text === "Cabin")).toBe(true);
    expect(p.wallThicknessIn).toBeCloseTo(4.5, 2);
  });
});

describe("large plans", () => {
  it("rebuilds a 60 x 60 grid of rooms (~14.6k face lines) into one wall per grid line", () => {
    const segs = [];
    for (let r = 0; r <= 60; r += 1) {
      for (let c = 0; c < 60; c += 1) {
        const x0 = c * 120;
        const x1 = x0 + 120;
        const y = r * 120;
        segs.push({ a: { x: x0, y: y - 2.25 }, b: { x: x1, y: y - 2.25 } }, { a: { x: x0, y: y + 2.25 }, b: { x: x1, y: y + 2.25 } });
        segs.push({ a: { x: y - 2.25, y: x0 }, b: { x: y - 2.25, y: x1 } }, { a: { x: y + 2.25, y: x0 }, b: { x: y + 2.25, y: x1 } });
      }
    }
    const { walls } = reconstructWalls(segs);
    expect(walls).toHaveLength(122);
    for (const w of walls) expect(Math.round(wallLength(w))).toBe(7200);
  });
});

describe("a realistic AutoCAD 2018 plan (fixture made with ezdxf, see testUtils)", () => {
  it("imports walls, T-junction, all openings, and named rooms", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(process.cwd(), "src/domains/roomDesigner/importers/dxf/testUtils/two-room-plan-r2018.dxf");
    const drawing = readDxfDrawing(fs.readFileSync(file, "utf8"));
    expect(drawing.header.acadVersion).toBe("AC1032");
    const p = prepareDxfImport(drawing);
    expect(p.counts).toEqual({ walls: 5, openings: 4, rooms: 2, annotations: 7 });
    expect(p.records.walls.map((w) => Math.round(wallLength(w))).sort((a, b) => a - b)).toEqual([192, 192, 192, 288, 288]);
    expect(p.records.openings.map((o) => [o.type, o.offsetIn, o.widthIn]).sort()).toEqual([
      ["door", 100, 36],
      ["door", 60, 32],
      ["window", 40, 48],
      ["window", 70, 48],
    ]);
    expect(p.records.rooms.map((r) => r.label).sort()).toEqual(["BEDROOM", "LIVING ROOM"]);
    expect(p.wallThicknessIn).toBe(6);
    expect(p.issues.map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringMatching(/HATCH/)]));
    expect(validateDesign(commitDxfImport(createEmptyDesign("x"), p))).toEqual([]);
  });
});

// ---- review fixes (PR #385 final review) --------------------------------------
describe("review fixes", () => {
  const blockDef = pairs(["0", "BLOCK", "8", "0", "2", "UNIT", "10", 0, "20", 0, "70", 0], line("0", 0, 0, 10, 0), ["0", "ENDBLK"]);

  it("expands an array INSERT (3 columns x 2 rows) into 6 placed instances", () => {
    const minsert = pairs(["0", "INSERT", "8", "A-FURN", "2", "UNIT", "10", 100, "20", 200, "70", 3, "71", 2, "44", 50, "45", 30]);
    const g = collectGeometry(parseDxf(dxf({ blocks: blockDef, entities: [minsert] })));
    expect(g.polylines).toHaveLength(6);
    const starts = g.polylines.map((p) => [Math.round(p.points[0].x), Math.round(p.points[0].y)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(starts).toEqual([[100, 200], [100, 230], [150, 200], [150, 230], [200, 200], [200, 230]]);
  });

  it("rotates array offsets with the insert (offsets are in the insert's frame, unscaled)", () => {
    const minsert = pairs(["0", "INSERT", "8", "X", "2", "UNIT", "10", 0, "20", 0, "41", 2, "42", 2, "50", 90, "70", 2, "71", 1, "44", 50]);
    const g = collectGeometry(parseDxf(dxf({ blocks: blockDef, entities: [minsert] })));
    const second = g.polylines.map((p) => p.points).find((pts) => Math.round(pts[0].y) === 50);
    expect(second).toBeTruthy();
    expect(second[0].x).toBeCloseTo(0, 6);
    expect(second[1].y).toBeCloseTo(70, 6); // block line scaled x2 (20 long), rotated 90°
  });

  it("parses a DXF whose structural tokens are indented", () => {
    const indented = dxf({ entities: [line("A-WALL", 0, 0, 120, 0)] })
      .split("\n")
      .map((l) => (/^(SECTION|ENDSEC|ENTITIES|HEADER|TABLES|BLOCKS|LINE|EOF)$/.test(l) ? `  ${l}` : l))
      .join("\n");
    expect(parseDxf(indented).entities).toHaveLength(1);
  });

  it("recognizes DWG files from their version string, including very old releases", () => {
    const bytes = (s) => new TextEncoder().encode(s);
    for (const head of ["AC1032", "AC1015", "AC1009", "AC1.50"]) {
      expect(() => parseDxf(bytes(`${head}\u0000\u0000binary`)), head).toThrow(/DWG/);
    }
  });

  it("anchors justified TEXT at its alignment point and Fit/Aligned TEXT at its midpoint", () => {
    const t = (h72, v73) => pairs(["0", "TEXT", "8", "A-AREA-IDEN", "10", 0, "20", 0, "11", 100, "21", 40, "40", 6, "72", h72, "73", v73, "1", "ROOM"]);
    const at = (h72, v73) => collectGeometry(parseDxf(dxf({ entities: [t(h72, v73)] }))).texts[0];
    expect(at(0, 0)).toMatchObject({ x: 0, y: 0 }); // left/baseline: 10/20
    expect(at(1, 2)).toMatchObject({ x: 100, y: 40 }); // center/middle: 11/21
    expect(at(5, 0)).toMatchObject({ x: 50, y: 20 }); // fit: midpoint
    expect(at(3, 0)).toMatchObject({ x: 50, y: 20 }); // aligned: midpoint
  });

  it("names a room from centered text whose 10/20 point lies outside the room", () => {
    // Center-justified label: 10/20 left of the room, alignment point 11/21 inside it.
    const label = pairs(["0", "TEXT", "8", "A-AREA-IDEN", "10", -500, "20", 48, "11", 60, "21", 48, "40", 6, "72", 1, "1", "KITCHEN"]);
    const d = readDxfDrawing(dxf({ entities: [lwpoly("A-AREA-IDEN", [[0, 0], [120, 0], [120, 96], [0, 96]], true), label] }));
    expect(prepareDxfImport(d).records.rooms[0].label).toBe("KITCHEN");
  });
});
