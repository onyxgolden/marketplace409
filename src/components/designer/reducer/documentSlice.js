// documentSlice: extracted verbatim from designerReducer.js.

import {
  addSavedEstimate,
  removeSavedEstimate,
} from "@/domains/roomDesigner/cabinetPriceBooks";
import {
  insertShapeCentered,
} from "@/domains/roomDesigner/customShapes/customShapeInstantiate";
import {
  placedSelection,
} from "@/domains/roomDesigner/customShapes/customShapePlacement";
import {
  addDeck,
  addOpening,
  addOrgChart,
  addPerson,
  addPipeRun,
  addRoomFromTemplate,
  addSheet,
  addWall,
  addWallRect,
  deleteDeck,
  deleteFurniture,
  deleteOpening,
  deleteOrgChart,
  deletePipeRun,
  deleteRoom,
  deleteSheet,
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
  resetFurnitureSize,
  resizeFurniture,
  resizeOpening,
  rotateFurniture,
  rotateSymbol,
  setDeckDrop,
  setDeckMaterial,
  setDoorSwing,
  setFurnitureMount,
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
import {
  alignFurniture,
  distributeFurniture,
} from "@/domains/roomDesigner/designerGeometry";
import {
  doorSwingOf,
} from "@/domains/roomDesigner/designerHandles";
import {
  setDesignMode,
} from "@/domains/roomDesigner/designerModes";
import {
  DUPLICATE_OFFSET_IN,
  copyScope,
  deleteScope,
  flipScope,
  scopeOfSelection,
  translateScope,
} from "@/domains/roomDesigner/designerObjectOps";
import {
  autoTagFor,
} from "@/domains/roomDesigner/equipmentTags";
import {
  applyImportResult,
} from "@/domains/roomDesigner/importers/vsdx/visioMapper";
import {
  detectRunAttachments,
} from "@/domains/roomDesigner/pipeAttachments";
import {
  findSymbol,
} from "@/domains/roomDesigner/symbolRegistry";
import {
  detailedVersionFor,
} from "@/domains/roomDesigner/temaExchangerCatalog";
import {
  initialTemaFields,
  replaceWithDetailedVersion,
  setSymbolDrawingMode,
  setSymbolSize,
  setSymbolTemaConfig,
} from "@/domains/roomDesigner/temaInstances";
import {
  validateTemaConfig,
} from "@/domains/roomDesigner/temaTypes";

import {
  withPipeDefaults,
  touch,
  pruneMulti,
  movableScope,
  placeCopy,
  multiPieces,
} from "./_shared";

export function documentSlice(state, action) {
  switch (action.type) {
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

    case "RENAME":
      return touch(state, renameDesign(state.design, action.name));

    case "SET_MODE":
      return touch(state, setDesignMode(state.design, action.mode));

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
