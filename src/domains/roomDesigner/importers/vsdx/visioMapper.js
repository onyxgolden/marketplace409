/**
 * VSDX → Designer mapping.
 *
 * buildImportRecords converts classified shapes into plain Designer record
 * arrays (walls, rooms, openings, pipes, symbols, furniture, annotations).
 * applyImportResult merges a COMPLETE record set into a design in ONE pure
 * step — the caller wraps it in a single undo touch, so a failed page
 * preparation leaves the original design untouched (atomicity).
 *
 * Records are deliberately plain data: no document-model mutation happens
 * here, and anything that cannot be represented cleanly becomes an
 * annotation or a skipped-with-note entry instead of a broken record.
 */

import { dedupeConsecutivePoints } from "../../pipingGeometry.js";

function sanitizeIdPart(value) {
  return String(value || "?").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
}

function makeIdFactory(pageIndex) {
  const counters = new Map();
  return (shapeId, kind) => {
    const key = `${shapeId}:${kind}`;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    return `vsdx-p${pageIndex}-s${sanitizeIdPart(shapeId)}-${kind}${n > 1 ? `-${n}` : ""}`;
  };
}

function finitePoints(points) {
  return (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Representative polyline: most points wins. */
function mainPolyline(polylines) {
  if (!polylines || polylines.length === 0) return null;
  return [...polylines].sort((a, b) => b.points.length - a.points.length)[0];
}

function distancePointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return { distance: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return {
    distance: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
    t,
  };
}

function annotationSource(resolved, page) {
  return {
    importer: "vsdx",
    pageId: page ? page.id : null,
    pageName: page ? page.name : null,
    shapeId: resolved.id,
    shapeName: resolved.nameU || null,
    masterId: resolved.masterId,
    masterName: resolved.masterNameU || null,
    classification: resolved.classificationKind || null,
  };
}

/**
 * Build Designer records from classified shapes.
 * items: [{ resolved, polylines, classification }]
 * Returns { records, notes, counts }.
 */
export function buildImportRecords(items, { pageIndex = 0, page = null } = {}) {
  const newId = makeIdFactory(pageIndex);
  const records = { walls: [], rooms: [], openings: [], pipes: [], symbols: [], furniture: [], annotations: [] };
  const notes = [];
  const counts = { mapped: 0, annotationShapes: 0, annotations: 0, skipped: 0 };

  const note = (resolved, message) => notes.push({ provenance: resolved.provenance, message });

  for (const item of items) {
    const { resolved, polylines, classification } = item;
    const kind = classification.kind;
    resolved.classificationKind = kind;
    const source = annotationSource(resolved, page);

    if (kind === "skipped") {
      counts.skipped += 1;
      note(resolved, `Skipped: ${classification.reason}`);
      continue;
    }

    if (kind === "label") {
      const text = (resolved.text || "").slice(0, 200);
      const anchor = item.labelAnchor || { x: 0, y: 0 };
      records.annotations.push({
        id: newId(resolved.id, "label"),
        kind: "label",
        points: [{ x: anchor.x, y: anchor.y }],
        text,
        source,
      });
      counts.annotations += 1;
      counts.annotationShapes += 1;
      counts.mapped += 1;
      continue;
    }

    if (kind === "annotation") {
      const lines = (polylines || []).filter((pl) => pl.points.length >= 1);
      if (lines.length === 0) {
        counts.skipped += 1;
        note(resolved, `Skipped: ${classification.reason} (no drawable geometry).`);
        continue;
      }
      lines.forEach((line, i) => {
        records.annotations.push({
          id: newId(resolved.id, `path${lines.length > 1 ? `-${i + 1}` : ""}`),
          kind: "path",
          points: line.points.map((p) => ({ x: p.x, y: p.y })),
          closed: !!line.closed,
          ...(resolved.text ? { text: resolved.text.slice(0, 200) } : {}),
          source,
        });
      });
      counts.annotations += lines.length;
      counts.annotationShapes += 1;
      counts.mapped += 1;
      continue;
    }

    if (kind === "wall") {
      const { a, b } = classification.detail || {};
      const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
      if (!(length >= 1)) {
        counts.skipped += 1;
        note(resolved, `Skipped: wall segment under 1 inch (${length.toFixed(2)} in).`);
        continue;
      }
      records.walls.push({ id: newId(resolved.id, "wall"), a: { ...a }, b: { ...b } });
      counts.mapped += 1;
      continue;
    }

    if (kind === "room") {
      const polygon = finitePoints(classification.detail && classification.detail.polygon);
      if (polygon.length < 3) {
        counts.skipped += 1;
        note(resolved, "Skipped: room polygon has fewer than 3 finite points.");
        continue;
      }
      records.rooms.push({
        id: newId(resolved.id, "room"),
        label: classification.detail.label || "Room",
        polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
      });
      counts.mapped += 1;
      continue;
    }

    if (kind === "opening") {
      const placed = tryPlaceOpening(records.walls, classification.detail, newId, resolved);
      if (placed) {
        records.openings.push(placed);
        counts.mapped += 1;
      } else {
        // Not safely resolvable on a wall → keep the outline as an annotation.
        const main = mainPolyline(polylines);
        if (main) {
          records.annotations.push({
            id: newId(resolved.id, "path"),
            kind: "path",
            points: main.points.map((p) => ({ x: p.x, y: p.y })),
            closed: !!main.closed,
            text: resolved.text ? resolved.text.slice(0, 200) : undefined,
            source,
          });
          counts.annotations += 1;
        }
        counts.mapped += 1;
        note(resolved, `Door/window kept as annotation: no imported wall resolved nearby to cut the opening into.`);
      }
      continue;
    }

    if (kind === "pipe") {
      const main = mainPolyline(polylines);
      const clean = main ? dedupeConsecutivePoints(finitePoints(main.points)) : [];
      if (clean.length < 2) {
        counts.skipped += 1;
        note(resolved, "Skipped: pipe run has fewer than two distinct points.");
        continue;
      }
      records.pipes.push({
        id: newId(resolved.id, "pipe"),
        points: clean.map((p) => ({ x: p.x, y: p.y })),
        diameterIn: 2,
        service: (classification.detail && classification.detail.service) || "plumbing",
        layer: "piping",
      });
      counts.mapped += 1;
      continue;
    }

    if (kind === "symbol") {
      const { domain, symbolId, x, y } = classification.detail || {};
      if (!domain || !symbolId || !Number.isFinite(x) || !Number.isFinite(y)) {
        counts.skipped += 1;
        note(resolved, "Skipped: symbol placement has no valid position.");
        continue;
      }
      records.symbols.push({ id: newId(resolved.id, "symbol"), domain, symbolId, x, y, rotationDeg: 0 });
      counts.mapped += 1;
      continue;
    }

    if (kind === "furniture") {
      const { catalogId, x, y } = classification.detail || {};
      if (!catalogId || !Number.isFinite(x) || !Number.isFinite(y)) {
        counts.skipped += 1;
        note(resolved, "Skipped: furniture placement has no valid position.");
        continue;
      }
      records.furniture.push({
        id: newId(resolved.id, "furniture"),
        catalogId,
        x,
        y,
        rotationDeg: Number.isFinite(item.rotationDeg) ? item.rotationDeg : 0,
      });
      counts.mapped += 1;
      continue;
    }

    counts.skipped += 1;
    note(resolved, `Skipped: unhandled classification '${kind}'.`);
  }

  return { records, notes, counts };
}

/**
 * Cut a door/window opening into the nearest already-imported wall.
 * Returns the opening record, or null when no wall resolves safely.
 */
function tryPlaceOpening(walls, detail, newId, resolved) {
  if (!detail || !Number.isFinite(detail.widthIn)) return null;
  const widthIn = Math.min(Math.max(detail.widthIn, 6), 96);
  const center = detail.center;
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  let best = null;
  for (const wall of walls) {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    if (length < widthIn + 1) continue;
    const { distance, t } = distancePointToSegment(center, wall.a, wall.b);
    if (distance > 12) continue;
    if (!best || distance < best.distance) best = { wall, distance, t, length };
  }
  if (!best) return null;
  const offsetIn = Math.max(0, Math.min(best.length - widthIn, best.t * best.length - widthIn / 2));
  return {
    id: newId(resolved.id, "opening"),
    wallId: best.wall.id,
    type: detail.openingType === "window" ? "window" : "door",
    offsetIn: Math.round(offsetIn * 100) / 100,
    widthIn: Math.round(widthIn * 100) / 100,
  };
}

/**
 * Atomically merge a complete import record set into a design.
 * Pure: returns a new design; the input design is never mutated.
 * All arrays are appended in one step so the caller can wrap this in a
 * single undo touch — partial application is impossible.
 */
export function applyImportResult(design, importRecords) {
  const r = importRecords.records || importRecords;
  return {
    ...design,
    walls: [...(design.walls || []), ...(r.walls || [])],
    rooms: [...(design.rooms || []), ...(r.rooms || [])],
    openings: [...(design.openings || []), ...(r.openings || [])],
    furniture: [...(design.furniture || []), ...(r.furniture || [])],
    pipes: [...(design.pipes || []), ...(r.pipes || [])],
    symbols: [...(design.symbols || []), ...(r.symbols || [])],
    annotations: [...(design.annotations || []), ...(r.annotations || [])],
  };
}
