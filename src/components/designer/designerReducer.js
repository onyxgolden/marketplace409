// UI state for the standalone room designer. Wraps the pure document
// model (src/domains/roomDesigner) so every edit stays testable and the
// React components stay thin.

import {
  addOpening,
  addRoomFromTemplate,
  addWall,
  calibrateUnderlay,
  createEmptyDesign,
  deleteFurniture,
  deleteOpening,
  deleteRoom,
  deleteWall,
  moveFurniture,
  moveFurnitureMany,
  moveOpening,
  moveUnderlay,
  moveWallEndpoint,
  placeFurniture,
  removeUnderlay,
  renameDesign,
  resizeOpening,
  rotateFurniture,
  setFurnitureUnitCost,
  setRoomFinish,
  setUnderlay,
  setWallMaterial,
  updateDesignSettings,
  updateUnderlay,
} from "@/domains/roomDesigner/designerDocument";
import { alignFurniture, distributeFurniture } from "@/domains/roomDesigner/designerGeometry";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";

export const TOOLS = Object.freeze([
  "select",
  "wall",
  "room",
  "door",
  "window",
  "furniture",
  "erase",
  "pan",
  "calibrate",
]);

export function createInitialState(design) {
  return {
    design: design || createEmptyDesign(),
    tool: "select",
    pendingCatalogId: null,
    pendingRoomTemplate: "bedroom",
    selection: null, // { kind: "wall"|"opening"|"furniture"|"room", id }
    multiSelection: [], // shift-clicked furniture: [{ kind: "furniture", id }]
    calibration: null, // scale-calibration clicks: { a: point, b?: point }
    view: "2d",
    dirty: false,
    // Monotonic revision of the design document: every mutation bumps it, and
    // MARK_SAVED clears `dirty` only when the completed save's revision is
    // still current -- edits made while a save was in flight stay dirty.
    designRevision: 0,
  };
}

function touch(state, design) {
  return {
    ...state,
    design,
    dirty: true,
    selection: state.selection,
    designRevision: state.designRevision + 1,
  };
}

/** Drop multi-selection entries whose furniture no longer exists. */
function pruneMulti(design, multiSelection) {
  const ids = new Set((design.furniture || []).map((f) => f.id));
  return (multiSelection || []).filter((m) => ids.has(m.id));
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
    case "SET_VIEW":
      return { ...state, view: action.view === "3d" ? "3d" : "2d" };
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
    case "MOVE_WALL_ENDPOINT":
      return touch(
        state,
        moveWallEndpoint(state.design, action.wallId, action.end, action.point),
      );
    case "ADD_ROOM":
      return touch(state, addRoomFromTemplate(state.design, action.templateId, action.at));
    case "DELETE_ROOM":
      return { ...touch(state, deleteRoom(state.design, action.roomId)), selection: null };
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
      return touch(state, moveOpening(state.design, action.openingId, action.offsetIn));
    case "RESIZE_OPENING":
      return touch(state, resizeOpening(state.design, action.openingId, action.widthIn));
    case "DELETE_OBJECT": {
      const target = action.target;
      if (!target) return state;
      let design = state.design;
      if (target.kind === "wall") design = deleteWall(design, target.id);
      else if (target.kind === "opening") design = deleteOpening(design, target.id);
      else if (target.kind === "furniture") design = deleteFurniture(design, target.id);
      else if (target.kind === "room") design = deleteRoom(design, target.id);
      return { ...touch(state, design), selection: null, multiSelection: pruneMulti(design, state.multiSelection) };
    }
    case "DELETE_SELECTION": {
      const sel = state.selection;
      if (!sel && state.multiSelection.length === 0) return state;
      let design = state.design;
      if (sel) {
        if (sel.kind === "wall") design = deleteWall(design, sel.id);
        else if (sel.kind === "opening") design = deleteOpening(design, sel.id);
        else if (sel.kind === "furniture") design = deleteFurniture(design, sel.id);
        else if (sel.kind === "room") design = deleteRoom(design, sel.id);
      }
      for (const m of state.multiSelection) {
        if (design.furniture.some((f) => f.id === m.id)) design = deleteFurniture(design, m.id);
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
    case "MOVE_FURNITURE":
      return touch(state, moveFurniture(state.design, action.furnitureId, action.x, action.y));
    case "ROTATE_FURNITURE":
      return touch(state, rotateFurniture(state.design, action.furnitureId, action.rotationDeg));
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
    case "SET_WALL_MATERIAL":
      return touch(state, setWallMaterial(state.design, action.wallId, action.material));
    case "SET_ROOM_FINISH":
      return touch(state, setRoomFinish(state.design, action.roomId, action.finish));
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
      return touch(state, moveUnderlay(state.design, action.x, action.y));
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
    default:
      return state;
  }
}
