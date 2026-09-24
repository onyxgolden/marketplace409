/**
 * Insert: a saved shape + a point → records merged into a design.
 *
 * A shape's geometry is stored relative to its own origin, so inserting is a
 * translation plus fresh identity. Identity is the part that matters: the
 * saved entities carry the ids they had when captured, and re-using those
 * would collide with the originals the moment a shape is inserted into the
 * design it came from.
 *
 * The merge itself reuses the VSDX importer's applyImportResult — a generic,
 * importer-agnostic atomic append that already de-collides ids AND keeps each
 * opening pointing at its wall's new id. Rewriting that here would mean two
 * copies of the same collision logic drifting apart.
 */

import { applyImportResult } from "../importers/vsdx/visioMapper";
import { CustomShapeError } from "./customShapeErrors";

/**
 * Build the record set for placing `shape` with its top-left at `at`.
 * Pure; the shape is never mutated.
 */
export function buildShapeRecords(shape, at, { instanceId = null } = {}) {
  if (!shape || !shape.entities) {
    throw new CustomShapeError("That shape has nothing to place.", { code: "empty-shape" });
  }
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    throw new CustomShapeError("A shape needs a valid point to be placed at.", {
      code: "bad-point",
    });
  }
  const stamp = instanceId || `i${Date.now().toString(36)}`;
  const prefix = `cs-${sanitize(shape.id)}-${sanitize(stamp)}`;
  const move = (p) => ({ x: round6(p.x + at.x), y: round6(p.y + at.y) });

  // Old id -> new id, so intra-shape references (room.wallIds,
  // opening.wallId) still point at this instance's own entities.
  const idMap = new Map();
  const remap = (kind, oldId) => {
    const next = `${prefix}-${kind}${idMap.size}`;
    idMap.set(String(oldId), next);
    return next;
  };

  const e = shape.entities;
  const walls = (e.walls || []).map((w) => ({ ...w, id: remap("w", w.id), a: move(w.a), b: move(w.b) }));
  const rooms = (e.rooms || []).map((r) => ({
    ...r,
    id: remap("r", r.id),
    polygon: (r.polygon || []).map(move),
    wallIds: (r.wallIds || []).map((id) => idMap.get(String(id))).filter(Boolean),
  }));
  const openings = (e.openings || [])
    .map((o) => {
      const wallId = idMap.get(String(o.wallId));
      // An opening whose wall was not captured has nothing to cut into.
      if (!wallId) return null;
      return { ...o, id: remap("o", o.id), wallId };
    })
    .filter(Boolean);
  const furniture = (e.furniture || []).map((f) => ({ ...f, id: remap("f", f.id), ...move({ x: f.x, y: f.y }) }));
  const pipes = (e.pipes || []).map((p) => ({ ...p, id: remap("p", p.id), points: (p.points || []).map(move) }));
  const symbols = (e.symbols || []).map((s) => ({ ...s, id: remap("s", s.id), ...move({ x: s.x, y: s.y }) }));

  return { walls, rooms, openings, furniture, pipes, symbols, annotations: [] };
}

/**
 * Place a saved shape into a design with its top-left at `at`.
 * Pure: returns a new design in ONE merge, so the caller can wrap it in a
 * single undo touch.
 */
export function insertShape(design, shape, at, options = {}) {
  const records = buildShapeRecords(shape, at, options);
  return applyImportResult(design, records);
}

/**
 * Place a shape CENTERED on `at`, which is what a click on the canvas means
 * for a drop-in shape.
 */
export function insertShapeCentered(design, shape, at, options = {}) {
  if (!shape || !shape.bounds) {
    throw new CustomShapeError("That shape has nothing to place.", { code: "empty-shape" });
  }
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    throw new CustomShapeError("A shape needs a valid point to be placed at.", { code: "bad-point" });
  }
  const topLeft = {
    x: at.x - (shape.bounds.widthIn || 0) / 2,
    y: at.y - (shape.bounds.heightIn || 0) / 2,
  };
  return insertShape(design, shape, topLeft, options);
}

function sanitize(value) {
  return String(value ?? "x").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
