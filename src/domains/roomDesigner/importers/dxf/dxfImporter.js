/**
 * DXF import orchestrator — the staged pipeline the UI drives:
 *
 *   readDxfDrawing(input)            parse once → layers (with suggested
 *                                    roles), detected units, geometry
 *   prepareDxfImport(drawing, opts)  pure; re-run cheaply as the user changes
 *                                    units or layer roles → preview + records
 *   commitDxfImport(design, prep)    ONE atomic merge (shared with VSDX)
 *
 * Mapping (conservative; everything else is reported, never guessed):
 *   Walls layers    → Designer walls (face pairs → centerlines, see dxfWalls)
 *   Doors/Windows   → openings cut into those walls
 *   Rooms layers    → rooms from closed outlines, named by text inside them;
 *                     room names without an outline become text labels
 *   Annotation      → read-only drawn linework and text
 *   Ignore          → nothing (off/frozen layers default here)
 * Fully local: nothing is uploaded.
 */

import { applyImportResult } from "../vsdx/visioMapper";
import { parseDxf } from "./dxfParser";
import { collectGeometry } from "./dxfGeometry";
import { DXF_UNITS, detectUnits } from "./dxfUnits";
import { LAYER_ROLES, suggestRole } from "./dxfLayers";
import { reconstructWalls } from "./dxfWalls";
import { DxfImportError } from "./dxfErrors";

export const DXF_MARGIN_IN = 24;
export const MAX_DXF_ANNOTATIONS = 20000;
const MIN_ROOM_AREA_SQIN = 4 * 144;

/** Parse and collect geometry once. */
export function readDxfDrawing(input) {
  const parsed = parseDxf(input);
  const geometry = collectGeometry(parsed);
  const byLayer = new Map();
  const touch = (name) => {
    if (!byLayer.has(name)) byLayer.set(name, { polylines: 0, texts: 0 });
    return byLayer.get(name);
  };
  for (const pl of geometry.polylines) touch(pl.layer).polylines += 1;
  for (const t of geometry.texts) touch(t.layer).texts += 1;
  const layers = [...byLayer.entries()]
    .map(([name, counts]) => {
      const def = parsed.layers.get(name) || { off: false, frozen: false };
      return { name, ...counts, off: def.off, frozen: def.frozen, suggestedRole: suggestRole(name, def) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (layers.length === 0) {
    throw new DxfImportError("This DXF has no drawable geometry in model space.", { code: "empty" });
  }
  return { header: parsed.header, units: detectUnits(parsed.header), layers, geometry };
}

/** Polygon area (shoelace), absolute. */
function area(points) {
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function bboxOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
const round2 = (v) => Math.round(v * 100) / 100;
const roundPt = (p) => ({ x: round2(p.x), y: round2(p.y) });

/** Group polylines whose bounding boxes touch (within `gap`) into clusters. */
function clusterPolylines(polylines, gap = 3) {
  const boxes = polylines.map((pl) => bboxOf(pl.points));
  const parent = polylines.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minY - gap <= b.maxY && b.minY - gap <= a.maxY) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map();
  polylines.forEach((pl, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pl);
  });
  return [...groups.values()];
}

/**
 * Build a previewable import.
 * options: { unit: "in"|"ft"|"mm"|"cm"|"m"|"yd", roles: { [layerName]: roleId } }
 */
export function prepareDxfImport(drawing, { unit, roles = {} } = {}) {
  const usedUnit = DXF_UNITS[unit] ? unit : drawing.units.unit;
  const f = DXF_UNITS[usedUnit].toInches;
  const roleOf = (layerName) => {
    const r = roles[layerName] ?? drawing.layers.find((l) => l.name === layerName)?.suggestedRole ?? "annotation";
    return LAYER_ROLES.some((x) => x.id === r) ? r : "annotation";
  };
  const issues = [];
  const note = (message, provenance = "drawing") => issues.push({ provenance, message });

  const active = drawing.geometry.polylines.filter((pl) => roleOf(pl.layer) !== "ignore");
  const activeTexts = drawing.geometry.texts.filter((t) => roleOf(t.layer) !== "ignore");
  const allPts = [...active.flatMap((pl) => pl.points), ...activeTexts];
  if (allPts.length === 0) {
    return { unit: usedUnit, sizeIn: { w: 0, h: 0 }, records: emptyRecords(), counts: emptyCounts(), issues: [{ provenance: "drawing", message: "Every layer is set to Ignore — nothing to import." }], wallThicknessIn: null };
  }
  const b = bboxOf(allPts);
  const toPlan = (p) => ({ x: (p.x - b.minX) * f + DXF_MARGIN_IN, y: (b.maxY - p.y) * f + DXF_MARGIN_IN });
  const planPolys = (list) => list.map((pl) => ({ ...pl, points: pl.points.map(toPlan) }));

  // --- walls & openings ---
  const wallPolys = planPolys(active.filter((pl) => roleOf(pl.layer) === "walls"));
  const segments = [];
  for (const pl of wallPolys) {
    const pts = pl.points;
    for (let i = 0; i + 1 < pts.length; i += 1) segments.push({ a: pts[i], b: pts[i + 1] });
    if (pl.closed && pts.length > 2) segments.push({ a: pts[pts.length - 1], b: pts[0] });
  }
  const clusters = [];
  for (const type of ["doors", "windows"]) {
    const polys = planPolys(active.filter((pl) => roleOf(pl.layer) === type));
    for (const group of clusterPolylines(polys)) {
      clusters.push({ type: type === "doors" ? "door" : "window", points: group.flatMap((pl) => pl.points), polylines: group });
    }
  }
  const rebuilt = reconstructWalls(segments, clusters);
  for (const n of rebuilt.notes) note(n, "walls");

  const records = emptyRecords();
  rebuilt.walls.forEach((w, i) => {
    const wallId = `dxf-w${i + 1}`;
    records.walls.push({ id: wallId, a: w.a, b: w.b });
    w.openings.forEach((op, k) => {
      records.openings.push({ id: `dxf-w${i + 1}-o${k + 1}`, wallId, type: op.type, offsetIn: op.offsetIn, widthIn: op.widthIn });
    });
  });

  let annotationCount = 0;
  let annotationsCapped = false;
  const pushPath = (pl, text) => {
    if (annotationCount >= MAX_DXF_ANNOTATIONS) {
      annotationsCapped = true;
      return;
    }
    annotationCount += 1;
    records.annotations.push({
      id: `dxf-a${annotationCount}`,
      kind: "path",
      points: pl.points.map(roundPt),
      closed: !!pl.closed,
      ...(text ? { text } : {}),
      source: { importer: "dxf", layer: pl.layer },
    });
  };
  if (rebuilt.unplaced.length > 0) {
    note(`${rebuilt.unplaced.length} door/window symbol${rebuilt.unplaced.length === 1 ? "" : "s"} had no wall close enough to cut an opening into — kept as drawn linework.`, "openings");
    for (const cl of rebuilt.unplaced) for (const pl of cl.polylines) pushPath(pl);
  }

  // --- rooms ---
  const roomPolys = planPolys(active.filter((pl) => roleOf(pl.layer) === "rooms"));
  const rooms = [];
  for (const pl of roomPolys) {
    if (pl.closed && pl.points.length >= 3 && area(pl.points) >= MIN_ROOM_AREA_SQIN) rooms.push({ polygon: pl.points.map(roundPt), label: "" });
    else pushPath(pl);
  }
  const planTexts = activeTexts.map((t) => ({ ...t, ...toPlan(t) }));
  const labelUsed = new Set();
  // Name each room from room-layer text inside it (smallest room wins for nested outlines).
  rooms.sort((r1, r2) => area(r1.polygon) - area(r2.polygon));
  planTexts.forEach((t, ti) => {
    if (roleOf(t.layer) !== "rooms") return;
    const room = rooms.find((r) => !r.label && pointInPolygon(t, r.polygon));
    if (room) {
      room.label = t.text;
      labelUsed.add(ti);
    }
  });
  rooms.forEach((r, i) => records.rooms.push({ id: `dxf-r${i + 1}`, label: r.label || "Room", polygon: r.polygon }));
  const unoutlinedRoomNames = planTexts.filter((t, ti) => roleOf(t.layer) === "rooms" && !labelUsed.has(ti)).length;
  if (unoutlinedRoomNames > 0) {
    note(`${unoutlinedRoomNames} room name${unoutlinedRoomNames === 1 ? "" : "s"} had no room outline in the drawing — kept as text labels.`, "rooms");
  }

  // --- annotation linework & all remaining text ---
  for (const pl of planPolys(active.filter((x) => roleOf(x.layer) === "annotation"))) pushPath(pl);
  let labelCount = 0;
  planTexts.forEach((t, ti) => {
    if (labelUsed.has(ti)) return;
    labelCount += 1;
    records.annotations.push({ id: `dxf-t${labelCount}`, kind: "label", points: [roundPt(t)], text: t.text, source: { importer: "dxf", layer: t.layer } });
  });
  if (annotationsCapped) note(`Only the first ${MAX_DXF_ANNOTATIONS.toLocaleString()} annotation shapes were imported.`);

  // --- reporting ---
  if (!drawing.units.known) note(`The DXF doesn't say what units it uses — imported as ${DXF_UNITS[usedUnit].label.toLowerCase()}. Check the size below and change the unit if it's wrong.`, "units");
  for (const n of drawing.geometry.notes) issues.push(n);
  for (const [type, count] of drawing.geometry.skipped) {
    note(`Skipped ${count} ${type} entit${count === 1 ? "y" : "ies"} (not imported).`, "entities");
  }
  if (records.walls.length === 0 && wallPolys.length > 0) note("Lines on the Walls layers didn't form walls (no parallel faces 2″–18″ apart and no long single lines).", "walls");
  if (wallPolys.length === 0) note("No layer is set to Walls, so no walls were created — pick the wall layer(s) above.", "walls");

  const counts = {
    walls: records.walls.length,
    openings: records.openings.length,
    rooms: records.rooms.length,
    annotations: records.annotations.length,
  };
  return {
    unit: usedUnit,
    sizeIn: { w: round2((b.maxX - b.minX) * f), h: round2((b.maxY - b.minY) * f) },
    records,
    counts,
    issues,
    wallThicknessIn: rebuilt.stats.thicknessIn == null ? null : round2(rebuilt.stats.thicknessIn),
  };
}

function emptyRecords() {
  return { walls: [], rooms: [], openings: [], pipes: [], symbols: [], furniture: [], annotations: [] };
}
function emptyCounts() {
  return { walls: 0, openings: 0, rooms: 0, annotations: 0 };
}

/** Pure single-step merge of a prepared import into a design. */
export function commitDxfImport(design, prepared) {
  if (!prepared || !prepared.records) throw new DxfImportError("Nothing prepared to commit.", { code: "nothing" });
  return applyImportResult(design, prepared.records);
}
