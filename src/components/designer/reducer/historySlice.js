// historySlice: extracted verbatim from designerReducer.js.

import {
  createEmptyDesign,
} from "@/domains/roomDesigner/designerDocument";

import { touch, withPipeDefaults } from "./_shared";


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

export function historySlice(state, action) {
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
