/**
 * PDF → Designer mapping.
 *
 * buildPdfRecords turns classified paths into plain Designer record arrays.
 * The only entity kind produced is `walls`, and that is the point: a wall is
 * the Designer's native editable line primitive, so imported geometry is
 * selectable, movable, endpoint-editable and deletable exactly like a wall
 * drawn by hand. The read-only `annotations` kind (which the VSDX importer
 * uses for geometry it cannot vouch for) is deliberately NOT used here —
 * annotations render with pointer events disabled, and the requirement for
 * this slice is that imported vector geometry behaves like a native entity.
 *
 * Records are plain data; nothing here touches the document model. The merge
 * itself reuses the VSDX importer's applyImportResult: it is a generic,
 * importer-agnostic atomic merge (ID de-collision + one-step append), and
 * duplicating it would mean two copies of the same collision logic drifting
 * apart.
 */

import { MIN_WALL_LENGTH_IN } from "./pdfClassifier";

/** Hard cap on walls produced by one import, so a dense plan cannot wedge the canvas. */
export const MAX_WALLS_PER_IMPORT = 20000;

function sanitizeIdPart(value) {
  return String(value ?? "?").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
}

function makeIdFactory(importId) {
  let n = 0;
  return () => {
    n += 1;
    return `pdf-${sanitizeIdPart(importId)}-w${n}`;
  };
}

/**
 * Build Designer records from classified paths.
 *
 * items: [{ classification, path, index }]
 * Returns { records, notes, counts }.
 */
export function buildPdfRecords(items, { importId = "import", pageNumber = 1, scaleFactor = 1 } = {}) {
  const newId = makeIdFactory(importId);
  const records = { walls: [], rooms: [], openings: [], pipes: [], symbols: [], furniture: [], annotations: [] };
  const notes = [];
  const counts = {
    paths: 0,
    walls: 0,
    skippedPaths: 0,
    droppedShortSegments: 0,
    filledOutlinePaths: 0,
    cappedAtLimit: false,
  };
  const skipReasons = new Map();

  for (const item of items || []) {
    counts.paths += 1;
    const classification = item.classification;
    if (!classification || classification.kind !== "wall") {
      counts.skippedPaths += 1;
      const reason = (classification && classification.reason) || "unclassified";
      skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
      continue;
    }
    const detail = classification.detail || {};
    counts.droppedShortSegments += detail.droppedShort || 0;
    if (detail.fromFill) counts.filledOutlinePaths += 1;

    for (const segment of detail.segments || []) {
      if (records.walls.length >= MAX_WALLS_PER_IMPORT) {
        counts.cappedAtLimit = true;
        break;
      }
      // Belt and braces: the classifier already enforces the floor, but a
      // wall under an inch would be rejected by the document model and would
      // fail validateDesign after the merge.
      const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
      if (!(length >= MIN_WALL_LENGTH_IN)) continue;
      records.walls.push({
        id: newId(),
        a: { x: segment.a.x, y: segment.a.y },
        b: { x: segment.b.x, y: segment.b.y },
        source: {
          importer: "pdf",
          importId,
          pageNumber,
          scaleFactor,
          fromFill: !!detail.fromFill,
        },
      });
      counts.walls += 1;
    }
    if (counts.cappedAtLimit) break;
  }

  for (const [reason, n] of skipReasons) {
    notes.push({
      provenance: `Page ${pageNumber}`,
      message: `${n} path${n === 1 ? "" : "s"} skipped: ${reason}.`,
    });
  }
  if (counts.droppedShortSegments > 0) {
    notes.push({
      provenance: `Page ${pageNumber}`,
      message: `${counts.droppedShortSegments} segment(s) below the length floor were dropped — hatching, text outlines and symbol detail import as noise otherwise.`,
    });
  }
  if (counts.filledOutlinePaths > 0) {
    notes.push({
      provenance: `Page ${pageNumber}`,
      message: `${counts.filledOutlinePaths} filled region(s) were transcribed as their outline — a poché-filled wall becomes its two faces, not a centerline.`,
    });
  }
  if (counts.cappedAtLimit) {
    notes.push({
      provenance: `Page ${pageNumber}`,
      message: `Hit the ${MAX_WALLS_PER_IMPORT}-wall import cap; the rest of the page was not converted.`,
    });
  }

  return { records, notes, counts };
}
