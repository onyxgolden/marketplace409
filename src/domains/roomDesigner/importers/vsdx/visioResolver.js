/**
 * VSDX master resolution and ShapeSheet cell reading.
 *
 * A placed shape may carry only overrides; its effective state is
 *   master definition + placed-shape overrides (+ group ancestry, which the
 *   transform stage composes separately).
 * Master index is built ONCE per import and master elements are NEVER
 * mutated — every resolution allocates fresh maps.
 *
 * Cell policy (explicit fidelity boundary, no formula engine in V1):
 *   - no F attribute, numeric V            → constant
 *   - F is a plain numeric literal         → constant
 *   - F is a bare reference to another cell that itself resolves to a
 *     constant (e.g. F="BeginX", F="Width") → constant (depth-limited,
 *     cycle-guarded; this is the documented "directly resolvable constant")
 *   - anything else in F (Width*0.5, GUARD(...), IF(...), …) → unsupported-formula.
 *     The stored value is NEVER used — an unsupported formula must never
 *     silently become zero or any other number.
 *   - cell absent or V unparsable          → missing (distinct from zero)
 */

import { VsdxImportError } from "./vsdxErrors";
import { childElements, firstChild, getAttr, parseXml, textOf } from "./visioXml";
import { resolveTarget } from "./visioPages";

const MASTERS_XML = "visio/masters/masters.xml";
const MASTERS_RELS = "visio/masters/_rels/masters.xml.rels";

/** Maximum master/group nesting depth before we call the file pathological. */
export const MAX_SHAPE_DEPTH = 32;
/** Maximum text characters kept per shape (longer text is truncated + warned). */
export const MAX_TEXT_CHARS = 500;

const NUMERIC_LITERAL = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const BARE_CELL_REF = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isNumericLiteral(text) {
  return NUMERIC_LITERAL.test(String(text || "").trim());
}

function parseFiniteNumber(text) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Resolve one <Cell> element to { state, value, formula }.
 * cellMap is the shape's merged name→Cell element map (for bare references).
 */
export function resolveCell(cellEl, cellMap, seen = new Set(), depth = 0) {
  if (!cellEl) return { state: "missing", value: undefined, formula: undefined };
  const formula = getAttr(cellEl, "F");
  if (formula != null && formula.trim() !== "") {
    const f = formula.trim();
    if (isNumericLiteral(f)) {
      return { state: "constant", value: Number(f), formula: undefined };
    }
    if (BARE_CELL_REF.test(f) && depth < 8 && !seen.has(f)) {
      const target = cellMap ? cellMap.get(f) : null;
      if (target && target !== cellEl) {
        const nextSeen = new Set(seen);
        nextSeen.add(f);
        const resolved = resolveCell(target, cellMap, nextSeen, depth + 1);
        if (resolved.state === "constant") return resolved;
      }
    }
    return { state: "unsupported-formula", value: undefined, formula: f };
  }
  const value = parseFiniteNumber(getAttr(cellEl, "V"));
  if (value == null) return { state: "missing", value: undefined, formula: undefined };
  return { state: "constant", value, formula: undefined };
}

/** Build a name→Cell element map from a Shape/PageSheet element's direct Cell children. */
export function cellElementMap(el) {
  const map = new Map();
  for (const cell of childElements(el, "Cell")) {
    const name = getAttr(cell, "N");
    if (name) map.set(name, cell);
  }
  return map;
}

/** Merge master cells with placed-shape overrides (override wins per name). */
export function mergedCellMap(masterEl, placedEl) {
  const map = cellElementMap(masterEl);
  for (const [name, cell] of cellElementMap(placedEl)) map.set(name, cell);
  return map;
}

/** Read a resolved constant cell value, or undefined when not a constant. */
export function constantOf(resolved) {
  return resolved && resolved.state === "constant" ? resolved.value : undefined;
}

/**
 * Build the master index once per import: Map<masterId, { id, nameU, name, shapeEl }>.
 * Master parts are matched to <Master> entries positionally (document order),
 * the same rule as pages. A file with no masters at all yields an empty map.
 */
export function buildMasterIndex(pkg) {
  const index = new Map();
  if (!pkg.has(MASTERS_XML)) return index;
  const doc = parseXml(pkg.getText(MASTERS_XML), MASTERS_XML);
  const mastersEl = firstChild(doc.documentElement, "Masters") || doc.documentElement;
  const masterEls = childElements(mastersEl, "Master");
  if (masterEls.length === 0) return index;

  let rels = [];
  if (pkg.has(MASTERS_RELS)) {
    const relDoc = parseXml(pkg.getText(MASTERS_RELS), MASTERS_RELS);
    for (const rel of childElements(relDoc.documentElement, "Relationship")) {
      const type = getAttr(rel, "Type") || "";
      if (!/(^|\/)master$/.test(type)) continue;
      const target = getAttr(rel, "Target");
      if (target) rels.push(resolveTarget(MASTERS_XML, target));
    }
  }
  if (rels.length !== masterEls.length) {
    throw new VsdxImportError(
      `Master list (${masterEls.length}) does not match master relationships (${rels.length}) — refusing to guess the mapping.`,
      { provenance: MASTERS_XML, code: "master-rel-mismatch" },
    );
  }

  masterEls.forEach((el, i) => {
    const id = getAttr(el, "ID");
    const contentPath = rels[i];
    if (!pkg.has(contentPath)) {
      throw new VsdxImportError(`Master '${getAttr(el, "NameU") || id}' points at missing part '${contentPath}'.`, {
        provenance: MASTERS_XML,
        code: "missing-part",
      });
    }
    const masterDoc = parseXml(pkg.getText(contentPath), contentPath);
    const shapesEl = firstChild(masterDoc.documentElement, "Shapes");
    const shapeEl = shapesEl ? firstChild(shapesEl, "Shape") : null;
    if (!shapeEl) {
      throw new VsdxImportError(`Master part '${contentPath}' contains no shape definition.`, {
        provenance: contentPath,
        code: "bad-master",
      });
    }
    index.set(String(id), {
      id: String(id),
      nameU: getAttr(el, "NameU") || "",
      name: getAttr(el, "Name") || "",
      shapeEl,
    });
  });
  return index;
}

/** Geometry sections merged by IX: placed sections override master's per IX. */
function mergedGeometrySections(masterShapeEl, placedShapeEl) {
  const byIx = new Map();
  const collect = (shapeEl) => {
    if (!shapeEl) return;
    for (const section of childElements(shapeEl, "Section")) {
      if (getAttr(section, "N") !== "Geometry") continue;
      const ix = getAttr(section, "IX") || "1";
      const rows = childElements(section, "Row").map((row) => ({
        type: getAttr(row, "T") || "",
        del: getAttr(row, "Del") === "1",
        el: row,
      }));
      byIx.set(ix, { ix, rows });
    }
  };
  collect(masterShapeEl);
  collect(placedShapeEl);
  return [...byIx.values()].sort((a, b) => Number(a.ix) - Number(b.ix));
}

function readText(masterShapeEl, placedShapeEl) {
  const textEl = firstChild(placedShapeEl, "Text") || (masterShapeEl ? firstChild(masterShapeEl, "Text") : null);
  if (!textEl) return { text: "", truncated: false };
  const raw = textOf(textEl);
  if (raw.length > MAX_TEXT_CHARS) {
    return { text: raw.slice(0, MAX_TEXT_CHARS), truncated: true };
  }
  return { text: raw, truncated: false };
}

/**
 * Resolve one <Shape> element into the neutral IR.
 * ctx: { masterIndex, pageName, parentNames, warnings, depth }
 */
export function resolveShape(shapeEl, ctx) {
  const { masterIndex, pageName, parentNames = [], warnings, depth = 0 } = ctx;
  if (depth > MAX_SHAPE_DEPTH) {
    throw new VsdxImportError("Shape nesting exceeds the supported depth — the file may be pathological.", {
      provenance: (pageName ? `Page '${pageName}'` : "drawing"),
      code: "nesting-too-deep",
    });
  }
  const id = getAttr(shapeEl, "ID") || `?${depth}`;
  const nameU = getAttr(shapeEl, "NameU") || "";
  const masterId = getAttr(shapeEl, "Master");
  const master = masterId != null ? masterIndex.get(String(masterId)) : null;
  if (masterId != null && !master) {
    warnings.push({
      provenance: [...(pageName ? [`Page '${pageName}'`] : []), ...parentNames, `Shape ${id}`].join(" → "),
      message: `References unknown master '${masterId}'; shape imported from its local definition only.`,
    });
  }
  const masterShapeEl = master ? master.shapeEl : null;
  const cells = mergedCellMap(masterShapeEl, shapeEl);
  const geometrySections = mergedGeometrySections(masterShapeEl, shapeEl);
  const { text, truncated } = readText(masterShapeEl, shapeEl);
  const provenanceParts = [...(pageName ? [`Page '${pageName}'`] : []), ...parentNames];
  if (truncated) {
    warnings.push({
      provenance: [...provenanceParts, `Shape ${id}`].join(" → "),
      message: `Text truncated to ${MAX_TEXT_CHARS} characters.`,
    });
  }

  const childProvenanceNames = [...parentNames, `Group ${id}${nameU ? ` '${nameU}'` : ""}`];
  const shapesEl = firstChild(shapeEl, "Shapes") || (masterShapeEl ? firstChild(masterShapeEl, "Shapes") : null);
  const children = [];
  if (shapesEl) {
    for (const childEl of childElements(shapesEl, "Shape")) {
      children.push(
        resolveShape(childEl, { masterIndex, pageName, parentNames: childProvenanceNames, warnings, depth: depth + 1 }),
      );
    }
  }

  const hasForeign = !!firstChild(shapeEl, "ForeignData") || (masterShapeEl ? !!firstChild(masterShapeEl, "ForeignData") : false);

  return {
    id: String(id),
    nameU,
    masterId: masterId != null ? String(masterId) : null,
    masterNameU: master ? master.nameU : "",
    masterName: master ? master.name : "",
    provenance: [...provenanceParts, `Shape ${id}${nameU ? ` '${nameU}'` : ""}`].join(" → "),
    cells,
    geometrySections,
    text,
    children,
    isGroup: children.length > 0,
    isOneD: cells.has("BeginX") || cells.has("EndX"),
    hasRasterImage: hasForeign,
    warnings,
  };
}

/**
 * Resolve all top-level shapes of a page content document.
 * Returns { shapes, pageSheetCells }.
 */
export function resolvePageShapes(pageDoc, ctx) {
  const root = pageDoc.documentElement;
  const shapesEl = firstChild(root, "Shapes");
  const pageSheetEl = firstChild(root, "PageSheet");
  const shapes = [];
  if (shapesEl) {
    for (const shapeEl of childElements(shapesEl, "Shape")) {
      shapes.push(resolveShape(shapeEl, ctx));
    }
  }
  return { shapes, pageSheetCells: cellElementMap(pageSheetEl) };
}

/** Read PageWidth/PageHeight constants from a page sheet cell map. */
export function readPageSize(pageSheetCells) {
  const width = resolveCell(pageSheetCells.get("PageWidth"), pageSheetCells);
  const height = resolveCell(pageSheetCells.get("PageHeight"), pageSheetCells);
  return {
    widthIn: constantOf(width),
    heightIn: constantOf(height),
    widthState: width.state,
    heightState: height.state,
  };
}
