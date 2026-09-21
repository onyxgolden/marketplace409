/**
 * VSDX import orchestrator: the staged pipeline the UI drives.
 *
 *   prepareVsdxImport(bytes, { pageIndex }) → previewable result (pure, no
 *       design mutation)
 *   commitVsdxImport(design, prepared)    → new design with records merged
 *
 * Stages (surfaced as progress phases, never fake percentages):
 *   opening → reading pages → resolving shapes → converting geometry →
 *   classifying → preparing import → (explicit user commit)
 *
 * Atomicity: prepare builds the COMPLETE record set first; commit is one
 * pure merge. A failed prepare leaves the caller's design untouched.
 * All processing is browser-local.
 */

import { openVsdxPackage } from "./vsdxPackage";
import { parseXml } from "./visioXml";
import { listVisioPages } from "./visioPages";
import {
  buildMasterIndex,
  constantOf,
  readPageSize,
  resolveCell,
  resolvePageShapes,
} from "./visioResolver";
import { localTransform, pageTransform, applyToPoint } from "./visioTransforms";
import { buildPath, flattenPath } from "./visioGeometry";
import { toDesignerPoint, toDesignerPolyline } from "./visioCoordinates";
import { classifyShape } from "./visioClassifier";
import { buildImportRecords, applyImportResult } from "./visioMapper";

/** Maximum shapes resolved from a single page before refusing. */
export const MAX_SHAPES_PER_PAGE = 20000;

export const IMPORT_PHASES = Object.freeze([
  "opening",
  "reading-pages",
  "resolving-shapes",
  "converting-geometry",
  "classifying",
  "preparing",
]);

/**
 * List pages without resolving shapes (for the page picker).
 * Accepts ArrayBuffer, Uint8Array, or Blob.
 */
export async function listVsdxPages(bytes) {
  const data = await toBytes(bytes);
  const pkg = openVsdxPackage(data);
  return listVisioPages(pkg).map((p) => ({ id: p.id, name: p.name, index: p.index }));
}

async function toBytes(bytes) {
  if (bytes instanceof Blob) return new Uint8Array(await bytes.arrayBuffer());
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new Error("Import needs the .vsdx file bytes.");
}

/** Shape's own Angle cell → Designer rotation degrees (approximation: ignores group rotation). */
function localRotationDeg(cells) {
  const resolved = resolveCell(cells.get("Angle"), cells);
  if (resolved.state !== "constant") return 0;
  // Designer Y-down mirrors Visio Y-up rotation direction.
  const deg = (-resolved.value * 180) / Math.PI;
  const normalized = ((deg % 360) + 360) % 360;
  return Math.round((normalized > 180 ? normalized - 360 : normalized) * 10) / 10;
}

/**
 * Walk a resolved shape tree, producing page-space (Visio Y-up) geometry.
 * Returns [{ resolved, pagePolylines, pageMatrix, rotationDeg }].
 */
function walkPageSpace(resolved, ancestorMatrices, state) {
  state.shapeCount += 1;
  if (state.shapeCount > MAX_SHAPES_PER_PAGE) {
    throw new Error(
      `Page '${state.pageName}' has more than ${MAX_SHAPES_PER_PAGE} shapes — refusing to import.`,
    );
  }
  const { matrix, approximated } = localTransform(resolved.cells);
  if (approximated.length > 0) {
    state.warn(resolved.provenance, `Placement cells defaulted (${approximated.join(", ")}) — geometry may be misplaced.`);
  }
  const pageMatrix = pageTransform(ancestorMatrices, matrix);

  const pagePolylines = [];
  for (const section of resolved.geometrySections) {
    const { subpaths } = buildPath(section.rows, resolved.cells, {
      provenance: resolved.provenance,
      onWarning: (message) => state.warn(null, message),
    });
    const flat = flattenPath(subpaths);
    for (const fp of flat) {
      if (fp.points.length === 0) continue;
      pagePolylines.push({ points: fp.points, closed: fp.closed, allLines: fp.allLines });
    }
  }

  const items = [
    {
      resolved,
      pagePolylines,
      pageMatrix,
      rotationDeg: localRotationDeg(resolved.cells),
    },
  ];
  const nextAncestors = [...ancestorMatrices, matrix];
  for (const child of resolved.children) {
    items.push(...walkPageSpace(child, nextAncestors, state));
  }
  return items;
}

function pageSpaceBounds(items) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    for (const pl of item.pagePolylines) {
      for (const p of pl.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Full prepare pipeline. Returns a staged import the UI can preview and the
 * user can explicitly commit. Never mutates the caller's design.
 */
export async function prepareVsdxImport(bytes, { pageIndex = 0, onPhase } = {}) {
  const phase = (p) => {
    if (typeof onPhase === "function") onPhase(p);
  };
  const issues = [];
  const warn = (provenance, message) =>
    issues.push({ provenance: provenance || "drawing", message });

  phase("opening");
  const data = await toBytes(bytes);
  const pkg = openVsdxPackage(data);

  phase("reading-pages");
  const masterIndex = buildMasterIndex(pkg);
  const pages = listVisioPages(pkg);
  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`Page index ${pageIndex} is out of range (drawing has ${pages.length} page(s)).`);
  }
  const page = pages[pageIndex];
  const pageDoc = parseXml(pkg.getText(page.contentPath), page.contentPath);

  phase("resolving-shapes");
  const state = { shapeCount: 0, pageName: page.name, warn };
  const { shapes, pageSheetCells } = resolvePageShapes(pageDoc, {
    masterIndex,
    pageName: page.name,
    warnings: issues,
    depth: 0,
  });

  phase("converting-geometry");
  let items = [];
  for (const shape of shapes) {
    items.push(...walkPageSpace(shape, [], state));
  }

  // Page height: PageSheet constant preferred; drawing-bounds fallback.
  let pageHeightIn = readPageSize(pageSheetCells).heightIn;
  if (!(pageHeightIn > 0)) {
    const b = pageSpaceBounds(items);
    pageHeightIn = b ? b.maxY - b.minY : 0;
    warn(
      `Page '${page.name}'`,
      "Page size is missing or non-constant — Y coordinates are relative to the drawing bounds, not the Visio page.",
    );
    // Shift so the fallback frame starts at 0.
    if (b) {
      const dy = -b.minY;
      if (dy !== 0) {
        for (const item of items) {
          for (const pl of item.pagePolylines) {
            for (const p of pl.points) p.y += dy;
          }
        }
      }
    }
  }

  phase("classifying");
  const classified = items.map((item) => {
    const polylines = item.pagePolylines.map((pl) => ({
      points: toDesignerPolyline(pl.points, item.pageMatrix, pageHeightIn),
      closed: pl.closed,
      allLines: pl.allLines,
    }));
    const classification = classifyShape(item.resolved, {
      polylines,
      text: item.resolved.text,
      isOneD: item.resolved.isOneD,
      hasRasterImage: item.resolved.hasRasterImage,
      masterNameU: item.resolved.masterNameU,
      masterName: item.resolved.masterName,
      shapeNameU: item.resolved.nameU,
    });
    const labelAnchor = toDesignerPoint(applyToPoint(item.pageMatrix, { x: 0, y: 0 }), pageHeightIn);
    return { resolved: item.resolved, polylines, classification, rotationDeg: item.rotationDeg, labelAnchor };
  });

  phase("preparing");
  const { records, notes, counts } = buildImportRecords(classified, { pageIndex, page });
  for (const n of notes) issues.push(n);

  return {
    page: { id: page.id, name: page.name, index: page.index },
    pages: pages.map((p) => ({ id: p.id, name: p.name, index: p.index })),
    pageHeightIn,
    shapeCount: state.shapeCount,
    records,
    counts,
    issues,
  };
}

/** Pure single-step merge of a prepared import into a design. */
export function commitVsdxImport(design, prepared) {
  if (!prepared || !prepared.records) throw new Error("Nothing prepared to commit.");
  return applyImportResult(design, prepared.records);
}

/** Re-export for tests that exercise pipeline stages directly. */
export { constantOf };
