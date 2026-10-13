// toolSlice: extracted verbatim from designerReducer.js.

import {
  calibrateUnderlay,
} from "@/domains/roomDesigner/designerDocument";
import {
  PIPE_DIAMETERS_IN,
  PIPE_LAYERS,
} from "@/domains/roomDesigner/pipingGeometry";
import {
  findSymbol,
  getSymbolSet,
} from "@/domains/roomDesigner/symbolRegistry";

import {
  touch,
} from "./_shared";

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

export function toolSlice(state, action) {
  switch (action.type) {
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
    default:
      return state;
  }
}
