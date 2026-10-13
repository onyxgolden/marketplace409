// Shared helpers for the designer reducer slices. Extracted verbatim from
// designerReducer.js so every slice sees identical behavior.

import {
  pasteBundle,
  scopeOfSelection,
} from "@/domains/roomDesigner/designerObjectOps";
import {
  getCatalogEntry,
} from "@/domains/roomDesigner/furnitureCatalog";
import {
  reconcilePipeAttachments,
} from "@/domains/roomDesigner/pipeAttachments";

export {
  withPipeDefaults,
  touch,
  pruneMulti,
  movableScope,
  SINGLE_KIND_LISTS,
  selectionAfterPaste,
  placeCopy,
  multiPieces,
};


/** Designs saved before piping/org-charts/sheets/annotations existed lack the new arrays; default them. */
function withPipeDefaults(design) {
  return { pipes: [], symbols: [], orgCharts: [], sheets: [], decks: [], annotations: [], ...design };
}


/**
 * Apply a design change: flag dirty, bump the revision, and record the
 * previous design on the undo stack. Consecutive dispatches carrying the
 * same coalesceKey (one drag gesture) reuse the top stack entry instead of
 * pushing a new one, so a drag is a single undo step. Any non-coalesced
 * edit clears the redo stack.
 */
function touch(state, nextDesign, coalesceKey) {
  // Pipe ends attached to equipment nozzles follow every edit (move,
  // rotate, resize, reconfigure, delete); a no-op for unattached designs.
  const design = reconcilePipeAttachments(nextDesign);
  const past = state.past || [];
  // Coalescing only folds into the latest entry while no redo is pending; an
  // edit made after an undo starts its own undo record and clears redo.
  if (
    coalesceKey != null &&
    past.length > 0 &&
    (state.future || []).length === 0 &&
    past[past.length - 1].coalesceKey === coalesceKey
  ) {
    return {
      ...state,
      design,
      dirty: true,
      selection: state.selection,
      designRevision: state.designRevision + 1,
    };
  }
  return {
    ...state,
    design,
    dirty: true,
    selection: state.selection,
    designRevision: state.designRevision + 1,
    past: [...past, { design: state.design, coalesceKey }],
    future: [],
  };
}


/** Drop multi-selection entries whose furniture no longer exists. */
function pruneMulti(design, multiSelection) {
  const ids = new Set((design.furniture || []).map((f) => f.id));
  return (multiSelection || []).filter((m) => ids.has(m.id));
}


/** The elements a house or group selection moves together. Null for any other selection. */
function movableScope(state) {
  const kind = state.selection?.kind;
  if (kind !== "house" && kind !== "group") return null;
  return scopeOfSelection(state.design, state.selection, []);
}


// For a paste from a single-object selection, the pasted object is selected
// as that same kind. Anything else (house, multi-select, several kinds) is
// selected as a group.
const SINGLE_KIND_LISTS = {
  wall: "walls",
  room: "rooms",
  furniture: "furniture",
  symbol: "symbols",
  pipe: "pipes",
  orgchart: "orgCharts",
  deck: "decks",
};


function selectionAfterPaste(sourceKind, scope) {
  const list = SINGLE_KIND_LISTS[sourceKind];
  if (list && scope[list].length === 1) return { kind: sourceKind, id: scope[list][0] };
  return { kind: "group", id: "group", scope };
}


/** Paste a copied bundle shifted by `offset`, select what landed, and record one undo step. */
function placeCopy(state, bundle, sourceKind, offset) {
  const { design, scope } = pasteBundle(state.design, bundle, { dx: offset, dy: offset });
  return {
    ...touch(state, design),
    selection: selectionAfterPaste(sourceKind, scope),
    multiSelection: [],
  };
}


/** Furniture pieces currently multi-selected, with their rotated footprint dims. */
function multiPieces(state) {
  const ids = new Set(state.multiSelection.map((m) => m.id));
  return state.design.furniture
    .filter((f) => ids.has(f.id))
    .map((f) => {
      // Placed pieces carry only catalogId; resolve nominal dimensions from
      // the catalog so align/distribute work on real footprint edges.
      const entry = getCatalogEntry(f.catalogId);
      return {
        id: f.id,
        x: f.x,
        y: f.y,
        widthIn: f.widthIn ?? entry?.widthIn,
        depthIn: f.depthIn ?? entry?.depthIn,
        rotationDeg: f.rotationDeg,
      };
    });
}
