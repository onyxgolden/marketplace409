// UI state for the standalone room designer. Wraps the pure document
// model (src/domains/roomDesigner) so every edit stays testable and the
// React components stay thin.

import {
  addOpening,
  addOrgChart,
  addPerson,
  addPipeRun,
  addRoomFromTemplate,
  addSheet,
  addWall,
  addWallRect,
  calibrateUnderlay,
  createEmptyDesign,
  deleteFurniture,
  deleteOpening,
  deleteOrgChart,
  deletePipeRun,
  deleteRoom,
  deleteSheet,
  addDeck,
  setDeckDrop,
  setDeckMaterial,
  deleteDeck,
  deleteSymbol,
  deleteWall,
  findOrgChart,
  findPipeRun,
  findRoom,
  findSheet,
  findSymbolInstance,
  findWall,
  moveFurniture,
  moveFurnitureMany,
  moveOpening,
  moveOpeningStart,
  moveOrgChart,
  movePipeVertex,
  moveRoom,
  moveSheet,
  moveSymbol,
  moveUnderlay,
  moveWall,
  moveWallEndpoint,
  patchSheet,
  placeFurniture,
  placeSymbol,
  removePerson,
  removeUnderlay,
  renameDesign,
  renameOrgChart,
  renameRoom,
  resizeFurniture,
  setFurnitureMount,
  resizeOpening,
  setDoorSwing,
  resetFurnitureSize,
  rotateFurniture,
  rotateSymbol,
  setFurnitureUnitCost,
  setPersonManager,
  setPipeFields,
  setRoomFinish,
  setRoomFloorImage,
  setSymbolLayer,
  setSymbolTag,
  setUnderlay,
  setWallCovering,
  setWallMaterial,
  updateDesignSettings,
  updatePerson,
  updateSheetFormat,
  updateUnderlay,
} from "@/domains/roomDesigner/designerDocument";
import { doorSwingOf } from "@/domains/roomDesigner/designerHandles";
import { applyImportResult } from "@/domains/roomDesigner/importers/vsdx/visioMapper";
import { insertShapeCentered } from "@/domains/roomDesigner/customShapes/customShapeInstantiate";
import { addSavedEstimate, removeSavedEstimate } from "@/domains/roomDesigner/cabinetPriceBooks";
import { autoTagFor } from "@/domains/roomDesigner/equipmentTags";
import {
  initialTemaFields,
  replaceWithDetailedVersion,
  setSymbolDrawingMode,
  setSymbolSize,
  setSymbolTemaConfig,
} from "@/domains/roomDesigner/temaInstances";
import { detailedVersionFor } from "@/domains/roomDesigner/temaExchangerCatalog";
import { detectRunAttachments, reconcilePipeAttachments } from "@/domains/roomDesigner/pipeAttachments";
import { validateTemaConfig } from "@/domains/roomDesigner/temaTypes";
import { placedSelection } from "@/domains/roomDesigner/customShapes/customShapePlacement";
import { alignFurniture, distributeFurniture } from "@/domains/roomDesigner/designerGeometry";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { PIPE_DIAMETERS_IN, PIPE_LAYERS } from "@/domains/roomDesigner/pipingGeometry";
import { findSymbol, getSymbolSet } from "@/domains/roomDesigner/symbolRegistry";
import {
  DUPLICATE_OFFSET_IN,
  copyScope,
  deleteScope,
  flipScope,
  pasteBundle,
  scopeOfSelection,
  translateScope,
} from "@/domains/roomDesigner/designerObjectOps";

export const TOOLS = Object.freeze([
  "select",
  "wall",
  "wallrect",
  "deck",
  "room",
  "door",
  "window",
  "furniture",
  "pipe",
  "piping",
  "orgchart",
  "erase",
  "pan",
  "calibrate",
  // Placing a saved shape from the user's personal library.
  "custom-shape",
]);

export function createInitialState(design) {
  return {
    design: withPipeDefaults(design || createEmptyDesign()),
    tool: "select",
    pendingCatalogId: null,
    pendingRoomTemplate: "bedroom",
    // Phase 2: piping mode — defaults for new pipe runs.
    pendingPipe: { diameterIn: 2, material: "Carbon steel", service: "Process", layer: "auto" },
    pendingSymbol: null, // { domain, symbolId } for the piping-symbol tool
    libraryDomain: null, // object-library domain opened from a palette tool (e.g. process equipment)
    pendingCustomShape: null, // the saved shape record armed for placement
    orthoSnap: true, // orthogonal (90°) vertex snapping for pipe runs
    layerVisibility: { piping: true, equipment: true, annotations: true },
    selection: null, // { kind: "wall"|"opening"|"furniture"|"room"|"pipe"|"symbol", id }
    multiSelection: [], // shift-clicked furniture: [{ kind: "furniture", id }]
    // A group selection covers a set of elements left by a paste: { kind: "group", id: "group", scope }.
    // Copy/paste keeps its own snapshot here (not in the design), so Ctrl+V works after deletes.
    clipboard: null, // { bundle, sourceKind, pastes } from COPY_SELECTION
    calibration: null, // scale-calibration clicks: { a: point, b?: point }
    view: "2d",
    dirty: false,
    // Undo/redo stacks hold design snapshots; see touch(). Drag gestures pass
    // action.coalesce so a whole drag collapses into one undo step.
    past: [],
    future: [],
    // Monotonic revision of the design document: every mutation bumps it, and
    // MARK_SAVED clears `dirty` only when the completed save's revision is
    // still current -- edits made while a save was in flight stay dirty.
    designRevision: 0,
  };
}

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

export function designerReducer(state, action) {
  switch (action.type) {
    case "LOAD_DESIGN":
      return { ...createInitialState(action.design), view: state.view };
    // HOME DESIGNER slice 2: the project envelope (levels, names) changed
    // outside the edited document — mark dirty and bump the revision so the
    // next save persists the envelope and MARK_SAVED stays revision-guarded.
    //
    // NOTE: TOUCH intentionally does NOT append to the undo history (past).
    // Level management (add/rename/delete) are project-metadata operations,
    // not canvas edits — they are NOT undoable. The level switcher tab bar
    // ("Levels" label tooltip) tells the user this. Do not "fix" this by
    // pushing envelope snapshots onto past: past holds room-designer
    // documents, not envelopes, and mixing them would corrupt undo/redo.
    case "TOUCH":
      return { ...state, dirty: true, designRevision: state.designRevision + 1 };
    case "UNDO": {
      const past = state.past || [];
      if (past.length === 0) return state;
      const prev = past[past.length - 1];
      return {
        ...state,
        design: prev.design,
        past: past.slice(0, -1),
        future: [{ design: state.design }, ...(state.future || [])],
        dirty: true,
        designRevision: state.designRevision + 1,
        selection: null,
        multiSelection: [],
      };
    }
    case "REDO": {
      const future = state.future || [];
      if (future.length === 0) return state;
      const next = future[0];
      return {
        ...state,
        design: next.design,
        past: [...(state.past || []), { design: state.design, coalesceKey: null }],
        future: future.slice(1),
        dirty: true,
        designRevision: state.designRevision + 1,
        selection: null,
        multiSelection: [],
      };
    }
    case "SELECT_HOUSE":
      return { ...state, tool: "select", selection: { kind: "house", id: "house" }, multiSelection: [] };
    case "TRANSLATE_HOUSE": {
      const scope = movableScope(state);
      if (!scope) return state;
      return touch(state, translateScope(state.design, scope, action.dx, action.dy), action.coalesce);
    }
    // Ctrl+C: remember a snapshot of the selection. Nothing changes in the plan.
    case "COPY_SELECTION": {
      const scope = scopeOfSelection(state.design, state.selection, state.multiSelection);
      if (!scope) return state;
      return {
        ...state,
        clipboard: {
          bundle: copyScope(state.design, scope),
          sourceKind: state.selection?.kind ?? null,
          pastes: 0,
        },
      };
    }
    // Ctrl+V: each paste lands one more foot out, so repeated pastes don't stack on one spot.
    case "PASTE_CLIPBOARD": {
      const clip = state.clipboard;
      if (!clip) return state;
      const pastes = clip.pastes + 1;
      return placeCopy(
        { ...state, clipboard: { ...clip, pastes } },
        clip.bundle,
        clip.sourceKind,
        DUPLICATE_OFFSET_IN * pastes,
      );
    }
    // Ctrl+D: copy and paste in one step, a foot out from the original.
    case "DUPLICATE_SELECTION": {
      const scope = scopeOfSelection(state.design, state.selection, state.multiSelection);
      if (!scope) return state;
      return placeCopy(state, copyScope(state.design, scope), state.selection?.kind ?? null, DUPLICATE_OFFSET_IN);
    }
    case "FLIP_SELECTION": {
      if (action.axis !== "horizontal" && action.axis !== "vertical") return state;
      const scope = scopeOfSelection(state.design, state.selection, state.multiSelection);
      if (!scope) return state;
      return touch(state, flipScope(state.design, scope, action.axis));
    }
    case "SET_TOOL":
      if (!TOOLS.includes(action.tool)) return state;
      return {
        ...state,
        tool: action.tool,
        selection: null,
        multiSelection: [],
        calibration: action.tool === "calibrate" ? state.calibration : null,
      };
    case "SET_PENDING_CATALOG":
      return { ...state, pendingCatalogId: action.catalogId, tool: "furniture" };
    case "SET_PENDING_ROOM":
      return { ...state, pendingRoomTemplate: action.templateId, tool: "room" };
    case "SET_PENDING_PIPE": {
      if (action.pipe?.diameterIn && !PIPE_DIAMETERS_IN.includes(action.pipe.diameterIn)) {
        return state;
      }
      return { ...state, pendingPipe: { ...state.pendingPipe, ...action.pipe }, tool: "pipe" };
    }
    // Arm a saved shape for placement. The shape RECORD travels in the action
    // rather than an id: the library lives in the screen (it is per-user local
    // storage, not part of the design document), so the reducer never needs to
    // know how to look one up.
    case "SET_PENDING_CUSTOM_SHAPE": {
      if (!action.shape || !action.shape.entities) return state;
      return { ...state, pendingCustomShape: action.shape, tool: "custom-shape" };
    }
    case "PLACE_CUSTOM_SHAPE": {
      const shape = action.shape || state.pendingCustomShape;
      if (!shape) return state;
      // Placement is ONE pure merge and ONE undo touch, so a dropped shape is
      // a single undoable unit however many entities it contains.
      try {
        const next = touch(state, insertShapeCentered(state.design, shape, { x: action.x, y: action.y }));
        // One-tap placement from Favorites selects what it dropped, so the
        // user can immediately move or delete it — like a placed furniture piece.
        if (!action.selectPlaced) return next;
        return { ...next, ...placedSelection(state.design, next.design) };
      } catch {
        // A damaged shape must not take the canvas down mid-click.
        return state;
      }
    }
    // Open the object library on a given symbol domain without arming a
    // symbol yet (the Process "Equipment" palette tool). The canvas ignores
    // clicks under the symbol tool until a symbol is picked.
    case "OPEN_OBJECT_LIBRARY":
      if (!getSymbolSet(action.domain)) return state;
      return { ...state, tool: "symbol", pendingSymbol: null, libraryDomain: action.domain };
    case "SET_PENDING_SYMBOL": {
      if (!findSymbol(action.domain, action.symbolId)) return state;
      // The piping domain keeps its established tool; every other symbol
      // domain arms the generic "symbol" tool so the object library stays
      // visible while placing. Placement itself is unchanged
      // (PLACE_SYMBOL -> design.symbols for any domain).
      return {
        ...state,
        pendingSymbol: { domain: action.domain, symbolId: action.symbolId },
        tool: action.domain === "piping" ? "piping" : "symbol",
      };
    }
    case "TOGGLE_ORTHO_SNAP":
      return { ...state, orthoSnap: !state.orthoSnap };
    case "TOGGLE_LAYER": {
      if (!PIPE_LAYERS.includes(action.layer)) return state;
      return {
        ...state,
        layerVisibility: {
          ...state.layerVisibility,
          [action.layer]: state.layerVisibility[action.layer] === false,
        },
      };
    }
    // Three view modes: "2d" (PlanCanvas only), "3d" (DesignerViewport3D
    // only), "split" (both, side by side — see DesignerCanvasArea). Anything
    // else falls back to "2d" rather than rendering nothing.
    case "SET_VIEW":
      return {
        ...state,
        view: action.view === "3d" || action.view === "split" ? action.view : "2d",
      };
    case "SELECT":
      return { ...state, selection: action.selection, multiSelection: [] };
    case "TOGGLE_MULTI_SELECT": {
      const target = action.target;
      if (!target || target.kind !== "furniture") return state;
      const has = state.multiSelection.some((m) => m.id === target.id);
      return {
        ...state,
        selection: null,
        multiSelection: has
          ? state.multiSelection.filter((m) => m.id !== target.id)
          : [...state.multiSelection, { kind: "furniture", id: target.id }],
      };
    }
    case "CLEAR_SELECTION":
      return { ...state, selection: null, multiSelection: [] };
    case "RENAME":
      return touch(state, renameDesign(state.design, action.name));
    case "UPDATE_SETTINGS":
      return touch(state, updateDesignSettings(state.design, action.settings));
    case "ADD_WALL":
      return touch(state, addWall(state.design, action.a, action.b));
    case "ADD_WALL_RECT":
      return touch(state, addWallRect(state.design, action.a, action.b));
    // Saved 3D camera views: the viewport computes the next list and hands it over.
    case "SET_CAMERA_VIEWS":
      return touch(state, { ...state.design, cameraViews: action.views });
    case "ADD_DECK": {
      const design = addDeck(state.design, action.a, action.b);
      const deck = design.decks[design.decks.length - 1];
      return { ...touch(state, design), selection: { kind: "deck", id: deck.id } };
    }
    case "SET_DECK_MATERIAL":
      return touch(state, setDeckMaterial(state.design, action.deckId, action.material));
    case "SET_DECK_DROP":
      return touch(state, setDeckDrop(state.design, action.deckId, action.dropIn), action.coalesce);
    case "MOVE_WALL_ENDPOINT":
      return touch(
        state,
        moveWallEndpoint(state.design, action.wallId, action.end, action.point),
        action.coalesce,
      );
    // Rigid move of a whole wall, mirroring MOVE_ROOM: guarded on the wall
    // still existing, and coalesced so one drag is one undo step.
    case "MOVE_WALL": {
      if (!findWall(state.design, action.wallId)) return state;
      return touch(
        state,
        moveWall(state.design, action.wallId, action.dx, action.dy),
        action.coalesce,
      );
    }
    case "ADD_ROOM":
      return touch(state, addRoomFromTemplate(state.design, action.templateId, action.at));
    case "DELETE_ROOM":
      return { ...touch(state, deleteRoom(state.design, action.roomId)), selection: null };
    case "MOVE_ROOM": {
      if (!findRoom(state.design, action.roomId)) return state;
      return touch(
        state,
        moveRoom(state.design, action.roomId, action.dx, action.dy),
        action.coalesce,
      );
    }
    case "ADD_OPENING":
      return touch(
        state,
        addOpening(state.design, action.wallId, {
          type: action.openingType,
          offsetIn: action.offsetIn,
          widthIn: action.widthIn,
        }),
      );
    case "MOVE_OPENING":
      return touch(
        state,
        moveOpening(state.design, action.openingId, action.offsetIn),
        action.coalesce,
      );
    case "MOVE_OPENING_START":
      return touch(
        state,
        moveOpeningStart(state.design, action.openingId, action.offsetIn),
        action.coalesce,
      );
    case "RESIZE_OPENING":
      return touch(
        state,
        resizeOpening(state.design, action.openingId, action.widthIn),
        action.coalesce,
      );
    case "FLIP_DOOR": {
      // Canvas flip handles / inspector buttons: toggle hinge side or swing face.
      const door = state.design.openings.find((o) => o.id === action.openingId);
      if (!door || door.type !== "door") return state;
      const { hinge, swing } = doorSwingOf(door);
      if (action.part === "hinge") {
        return touch(state, setDoorSwing(state.design, door.id, { hinge: hinge === "end" ? "start" : "end" }));
      }
      if (action.part === "swing") {
        return touch(state, setDoorSwing(state.design, door.id, { swing: swing === "negative" ? "positive" : "negative" }));
      }
      return state;
    }
    case "DELETE_OBJECT": {
      const target = action.target;
      if (!target) return state;
      let design = state.design;
      if (target.kind === "wall") design = deleteWall(design, target.id);
      else if (target.kind === "opening") design = deleteOpening(design, target.id);
      else if (target.kind === "furniture") design = deleteFurniture(design, target.id);
      else if (target.kind === "room") design = deleteRoom(design, target.id);
      else if (target.kind === "pipe") design = deletePipeRun(design, target.id);
      else if (target.kind === "symbol") design = deleteSymbol(design, target.id);
      else if (target.kind === "orgchart") design = deleteOrgChart(design, target.id);
      else if (target.kind === "sheet") design = deleteSheet(design, target.id);
      else if (target.kind === "deck") design = deleteDeck(design, target.id);
      return { ...touch(state, design), selection: null, multiSelection: pruneMulti(design, state.multiSelection) };
    }
    // Delete / Backspace. Every selection is one undo step; a selection with
    // nothing left to delete changes nothing (and records no undo step).
    case "DELETE_SELECTION": {
      const sel = state.selection;
      if (!sel && state.multiSelection.length === 0) return state;
      let design;
      if (sel?.kind === "sheet") {
        design = deleteSheet(state.design, sel.id);
      } else if (sel?.kind === "opening") {
        design = deleteOpening(state.design, sel.id);
      } else {
        const scope = scopeOfSelection(state.design, sel, state.multiSelection);
        if (!scope) return state;
        design = deleteScope(state.design, scope);
      }
      return { ...touch(state, design), selection: null, multiSelection: [] };
    }
    case "PLACE_FURNITURE":
      return touch(
        state,
        placeFurniture(
          state.design, action.catalogId, action.x, action.y, action.rotationDeg || 0,
        ),
      );
    // Arrow keys: move the selection one grid square (design.settings.gridIn)
    // per press. dx/dy are grid steps (-1, 0, 1). A burst of presses on the
    // same selection coalesces into one undo step, like a drag.
    case "NUDGE_SELECTION": {
      const grid = state.design.settings?.gridIn || 6;
      const mx = (action.dx || 0) * grid;
      const my = (action.dy || 0) * grid;
      if (!mx && !my) return state;
      const movable = movableScope(state);
      if (movable) {
        const key = state.selection.kind === "house" ? "nudge:house" : "nudge:group";
        return touch(state, translateScope(state.design, movable, mx, my), key);
      }
      const multi = state.multiSelection || [];
      if (multi.length > 0) {
        const ids = new Set(multi.map((m) => m.id));
        let design = state.design;
        for (const f of design.furniture) if (ids.has(f.id)) design = moveFurniture(design, f.id, f.x + mx, f.y + my);
        return design === state.design ? state : touch(state, design, `nudge:multi:${[...ids].join(",")}`);
      }
      const sel = state.selection;
      if (!sel) return state;
      const key = `nudge:${sel.kind}:${sel.id}`;
      const d = state.design;
      switch (sel.kind) {
        case "furniture": {
          const f = d.furniture.find((p) => p.id === sel.id);
          return f ? touch(state, moveFurniture(d, f.id, f.x + mx, f.y + my), key) : state;
        }
        case "symbol": {
          const s = findSymbolInstance(d, sel.id);
          return s ? touch(state, moveSymbol(d, s.id, s.x + mx, s.y + my), key) : state;
        }
        case "room":
          return findRoom(d, sel.id) ? touch(state, moveRoom(d, sel.id, mx, my), key) : state;
        case "wall":
          return findWall(d, sel.id) ? touch(state, moveWall(d, sel.id, mx, my), key) : state;
        case "orgchart": {
          const c = findOrgChart(d, sel.id);
          return c ? touch(state, moveOrgChart(d, c.id, c.x + mx, c.y + my), key) : state;
        }
        case "sheet": {
          const sh = findSheet(d, sel.id);
          return sh ? touch(state, moveSheet(d, sh.id, sh.x + mx, sh.y + my), key) : state;
        }
        default:
          return state; // openings slide along their wall; pipes reshape by vertex
      }
    }
    case "MOVE_FURNITURE":
      return touch(
        state,
        moveFurniture(state.design, action.furnitureId, action.x, action.y),
        action.coalesce,
      );
    case "ROTATE_FURNITURE":
      return touch(state, rotateFurniture(state.design, action.furnitureId, action.rotationDeg), action.coalesce);
    case "RESIZE_FURNITURE":
      return touch(
        state,
        resizeFurniture(state.design, action.furnitureId, action.widthIn, action.depthIn, action.heightIn),
        action.coalesce,
      );
    case "SAVE_CABINET_ESTIMATE":
      if (!action.snapshot) return state;
      return touch(state, addSavedEstimate(state.design, action.snapshot));
    case "DELETE_CABINET_ESTIMATE":
      return touch(state, removeSavedEstimate(state.design, action.snapshotId));
    case "SET_FURNITURE_MOUNT":
      return touch(state, setFurnitureMount(state.design, action.furnitureId, action.mountIn), action.coalesce);
    case "RESET_FURNITURE_SIZE":
      return touch(state, resetFurnitureSize(state.design, action.furnitureId));
    case "ALIGN_FURNITURE": {
      const pieces = multiPieces(state);
      if (pieces.length < 2) return state;
      return touch(state, moveFurnitureMany(state.design, alignFurniture(pieces, action.mode)));
    }
    case "DISTRIBUTE_FURNITURE": {
      const pieces = multiPieces(state);
      if (pieces.length < 3) return state;
      return touch(state, moveFurnitureMany(state.design, distributeFurniture(pieces)));
    }
    // ---- Phase 2: piping mode ----
    case "ADD_PIPE_RUN": {
      const layer = state.pendingPipe.layer === "auto" ? "piping" : state.pendingPipe.layer;
      const added = addPipeRun(state.design, action.points, { ...state.pendingPipe, layer });
      const run = added.pipes[added.pipes.length - 1];
      // Ends snapped onto a nozzle attach to it.
      const design = detectRunAttachments(added, run.id);
      return { ...touch(state, design), selection: { kind: "pipe", id: run.id } };
    }
    case "SET_PIPE_FIELDS":
      if (!findPipeRun(state.design, action.pipeId)) return state;
      return touch(state, setPipeFields(state.design, action.pipeId, action.fields));
    case "MOVE_PIPE_VERTEX":
      if (!findPipeRun(state.design, action.pipeId)) return state;
      // Dragging an end re-derives its attachment: off a nozzle detaches,
      // dropped exactly on one attaches.
      return touch(
        state,
        detectRunAttachments(movePipeVertex(state.design, action.pipeId, action.index, action.point), action.pipeId),
        action.coalesce,
      );
    case "PLACE_SYMBOL": {
      const pending = state.pendingSymbol;
      if (!pending) return state;
      const domain = action.domain || pending.domain || "piping";
      const symbolId = action.symbolId || pending.symbolId;
      let design = placeSymbol(state.design, domain, symbolId, action.x, action.y, {
        layer: state.pendingPipe.layer === "auto" ? undefined : state.pendingPipe.layer,
        // Process equipment gets the next free tag for its letter code
        // (P-101, P-102, ...); other symbols stay untagged as before.
        tag: autoTagFor(state.design, domain, symbolId) || undefined,
      });
      const inst = design.symbols[design.symbols.length - 1];
      // A configurable TEMA exchanger saves its default configuration.
      const { tema } = initialTemaFields(findSymbol(domain, symbolId));
      if (tema) design = setSymbolTemaConfig(design, inst.id, tema);
      return { ...touch(state, design), selection: { kind: "symbol", id: inst.id } };
    }
    case "MOVE_SYMBOL":
      if (!findSymbolInstance(state.design, action.symbolId)) return state;
      return touch(
        state,
        moveSymbol(state.design, action.symbolId, action.x, action.y),
        action.coalesce,
      );
    case "ROTATE_SYMBOL":
      if (!findSymbolInstance(state.design, action.symbolId)) return state;
      return touch(state, rotateSymbol(state.design, action.symbolId, action.rotationDeg), action.coalesce);
    case "SET_SYMBOL_TAG":
      if (!findSymbolInstance(state.design, action.symbolId)) return state;
      return touch(state, setSymbolTag(state.design, action.symbolId, action.tag));
    case "SET_SYMBOL_LAYER":
      if (!findSymbolInstance(state.design, action.symbolId)) return state;
      return touch(state, setSymbolLayer(state.design, action.symbolId, action.layer));
    // ---- TEMA exchangers: configuration, drawing mode, size, replace ----
    case "SET_SYMBOL_TEMA": {
      const inst = findSymbolInstance(state.design, action.symbolId);
      if (!inst || findSymbol(inst.domain, inst.symbolId)?.tema?.kind !== "assembly") return state;
      if (!validateTemaConfig(action.config).valid) return state; // blocked: the picker explains why
      return touch(state, setSymbolTemaConfig(state.design, action.symbolId, action.config));
    }
    case "SET_SYMBOL_DRAWING_MODE": {
      const inst = findSymbolInstance(state.design, action.symbolId);
      if (!inst || !findSymbol(inst.domain, inst.symbolId)?.tema) return state;
      if (action.mode !== "detailed" && action.mode !== "pid") return state;
      return touch(state, setSymbolDrawingMode(state.design, action.symbolId, action.mode));
    }
    case "SET_SYMBOL_SIZE": {
      if (!findSymbolInstance(state.design, action.symbolId)) return state;
      const ok = (v) => v === undefined || (Number.isFinite(v) && v > 0);
      if (!ok(action.widthIn) || !ok(action.depthIn)) return state;
      return touch(
        state,
        setSymbolSize(state.design, action.symbolId, { widthIn: action.widthIn, depthIn: action.depthIn }),
        action.coalesce,
      );
    }
    case "REPLACE_WITH_DETAILED": {
      const inst = findSymbolInstance(state.design, action.symbolId);
      if (!inst || !detailedVersionFor(inst.domain, inst.symbolId)) return state;
      return {
        ...touch(state, replaceWithDetailedVersion(state.design, action.symbolId)),
        selection: { kind: "symbol", id: inst.id },
      };
    }
    // ---- Phase 3: people org charts ----
    case "ADD_ORG_CHART": {
      // Placing a chart is a one-shot: drop back to the select tool so the
      // new diagram can be dragged into place immediately.
      const design = addOrgChart(state.design, action.name, action.x, action.y);
      const chart = design.orgCharts[design.orgCharts.length - 1];
      return {
        ...touch(state, design),
        tool: "select",
        selection: { kind: "orgchart", id: chart.id },
      };
    }
    case "MOVE_ORG_CHART":
      if (!findOrgChart(state.design, action.chartId)) return state;
      return touch(
        state,
        moveOrgChart(state.design, action.chartId, action.x, action.y),
        action.coalesce,
      );
    case "RENAME_ORG_CHART":
      if (!findOrgChart(state.design, action.chartId)) return state;
      return touch(state, renameOrgChart(state.design, action.chartId, action.name));
    case "ADD_PERSON": {
      // User-reachable validation (blank names, bad managers) fails soft:
      // the panel already constrains its inputs, this is the backstop.
      if (!findOrgChart(state.design, action.chartId)) return state;
      try {
        return touch(state, addPerson(state.design, action.chartId, action.person));
      } catch {
        return state;
      }
    }
    case "UPDATE_PERSON": {
      if (!findOrgChart(state.design, action.chartId)) return state;
      try {
        return touch(state, updatePerson(state.design, action.chartId, action.personId, action.fields));
      } catch {
        return state;
      }
    }
    case "SET_PERSON_MANAGER": {
      if (!findOrgChart(state.design, action.chartId)) return state;
      try {
        return touch(
          state,
          setPersonManager(state.design, action.chartId, action.personId, action.managerId),
        );
      } catch {
        return state;
      }
    }
    case "DELETE_PERSON":
      if (!findOrgChart(state.design, action.chartId)) return state;
      try {
        return touch(state, removePerson(state.design, action.chartId, action.personId));
      } catch {
        return state;
      }
    case "SET_WALL_MATERIAL":
      return touch(state, setWallMaterial(state.design, action.wallId, action.material));
    // Naming a room. Coalesced so typing a name is one undo step, not one
    // per keystroke.
    case "RENAME_ROOM": {
      if (!findRoom(state.design, action.roomId)) return state;
      return touch(
        state,
        renameRoom(state.design, action.roomId, action.label),
        action.coalesce,
      );
    }
    case "SET_ROOM_FINISH":
      return touch(state, setRoomFinish(state.design, action.roomId, action.finish));
    // A user-uploaded flooring PHOTO (tiled pattern) — distinct from
    // SET_ROOM_FINISH's plain text estimating label above; see
    // setRoomFloorImage's own doc comment.
    case "SET_ROOM_FLOOR_IMAGE":
      return touch(state, setRoomFloorImage(state.design, action.roomId, action.floorImage));
    // A user-uploaded wall covering PHOTO (pattern or extracted color) —
    // distinct from SET_WALL_MATERIAL's plain text estimating label above;
    // see setWallCovering's own doc comment.
    case "SET_WALL_COVERING":
      return touch(state, setWallCovering(state.design, action.wallId, action.wallCovering));
    case "SET_FURNITURE_COST":
      return touch(state, setFurnitureUnitCost(state.design, action.furnitureId, action.costPerUnit));
    case "SET_UNDERLAY":
      return { ...touch(state, setUnderlay(state.design, action.underlay)), calibration: null };
    case "UPDATE_UNDERLAY":
      return touch(state, updateUnderlay(state.design, action.patch));
    case "REMOVE_UNDERLAY":
      return {
        ...touch(state, removeUnderlay(state.design)),
        calibration: null,
        tool: state.tool === "calibrate" ? "select" : state.tool,
      };
    case "MOVE_UNDERLAY":
      return touch(state, moveUnderlay(state.design, action.x, action.y), action.coalesce);
    // ---- Printable paper sheets ----
    case "ADD_SHEET": {
      const design = addSheet(state.design, action.sizeId, action.orientation, {
        x: action.x,
        y: action.y,
      });
      const sheet = design.sheets[design.sheets.length - 1];
      return { ...touch(state, design), selection: { kind: "sheet", id: sheet.id } };
    }
    case "MOVE_SHEET": {
      if (!findSheet(state.design, action.sheetId)) return state;
      return touch(
        state,
        moveSheet(state.design, action.sheetId, action.x, action.y),
        action.coalesce,
      );
    }
    case "DELETE_SHEET": {
      if (!findSheet(state.design, action.sheetId)) return state;
      return {
        ...touch(state, deleteSheet(state.design, action.sheetId)),
        selection: null,
      };
    }
    case "UPDATE_SHEET_FORMAT": {
      if (!findSheet(state.design, action.sheetId)) return state;
      return touch(
        state,
        updateSheetFormat(state.design, action.sheetId, {
          sizeId: action.sizeId,
          orientation: action.orientation,
        }),
      );
    }
    case "UPDATE_SHEET": {
      if (!findSheet(state.design, action.sheetId)) return state;
      return touch(state, patchSheet(state.design, action.sheetId, action.patch));
    }
    case "ADD_CALIBRATION_POINT": {
      if (!state.design.underlay) return state;
      const cal = state.calibration;
      if (!cal) return { ...state, calibration: { a: action.point } };
      if (!cal.b) return { ...state, calibration: { a: cal.a, b: action.point } };
      return { ...state, calibration: { a: action.point } };
    }
    case "CLEAR_CALIBRATION":
      return { ...state, calibration: null };
    case "APPLY_CALIBRATION": {
      const cal = state.calibration;
      if (!state.design.underlay || !cal || !cal.b) return state;
      return {
        ...touch(state, calibrateUnderlay(state.design, cal.a, cal.b, action.realDistanceIn)),
        calibration: null,
        tool: "select",
      };
    }
    case "MARK_SAVED":
      // Only a save whose revision is still current may clear the dirty flag:
      // an edit that landed while the PUT was in flight must remain dirty.
      return action.savedRevision === state.designRevision
        ? { ...state, dirty: false }
        : state;
    case "IMPORT_VSDX_RESULT":
      // Atomic VSDX import: the prepared result is merged in ONE pure step
      // and ONE undo touch, so the import is a single undoable unit and a
      // failed prepare can never leave a half-applied design behind.
      return touch(state, applyImportResult(withPipeDefaults(state.design), action.importResult));
    // Atomic DXF import, same contract as VSDX: the prepared record set is
    // merged in ONE pure step and ONE undo touch.
    case "IMPORT_DXF_RESULT":
      if (!action.importResult?.records) return state;
      return touch(state, applyImportResult(state.design, action.importResult.records));
    // Atomic PDF import, same contract as VSDX: ONE pure step, ONE undo touch.
    // A vector import appends native walls; a scanned import replaces the
    // background underlay. The merge is done here with the same primitives the
    // rest of the reducer uses rather than by calling into the importer, so
    // pdf.js and the importer pipeline stay out of the main bundle.
    case "IMPORT_PDF_RESULT": {
      const prepared = action.importResult;
      if (!prepared) return state;
      if (prepared.mode === "raster") {
        if (!prepared.image) return state;
        return {
          ...touch(state, setUnderlay(state.design, prepared.image)),
          // A new underlay invalidates any in-progress calibration clicks.
          calibration: null,
        };
      }
      if (!prepared.records) return state;
      return touch(state, applyImportResult(withPipeDefaults(state.design), prepared.records));
    }
    default:
      return state;
  }
}
