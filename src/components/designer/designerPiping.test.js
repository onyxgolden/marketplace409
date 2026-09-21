import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

function stateWithPipe() {
  let state = createInitialState(createEmptyDesign("Piping test"));
  state = designerReducer(state, {
    type: "ADD_PIPE_RUN",
    points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
  });
  return state;
}

describe("designerReducer — piping mode", () => {
  it("starts with pipe/symbol defaults, ortho on, and all layers visible", () => {
    const state = createInitialState(createEmptyDesign("Blank"));
    expect(state.pendingPipe).toMatchObject({ diameterIn: 2, material: "Carbon steel", service: "Process" });
    expect(state.pendingSymbol).toBeNull();
    expect(state.orthoSnap).toBe(true);
    expect(state.layerVisibility).toEqual({ piping: true, equipment: true, annotations: true });
    expect(state.design.pipes).toEqual([]);
    expect(state.design.symbols).toEqual([]);
  });

  it("adds a pipe run and clears selection", () => {
    const state = stateWithPipe();
    expect(state.design.pipes).toHaveLength(1);
    expect(state.selection).toEqual({ kind: "pipe", id: state.design.pipes[0].id });
    expect(state.dirty).toBe(true);
    expect(state.design.pipes[0].diameterIn).toBe(2);
  });

  it("updates pending pipe settings, toggles ortho, and rejects bad diameters", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_PENDING_PIPE", pipe: { diameterIn: 6, service: "Chilled water" } });
    expect(state.pendingPipe).toMatchObject({ diameterIn: 6, service: "Chilled water" });
    state = designerReducer(state, { type: "SET_PENDING_PIPE", pipe: { diameterIn: 99 } });
    expect(state.pendingPipe.diameterIn).toBe(6);
    state = designerReducer(state, { type: "TOGGLE_ORTHO_SNAP" });
    expect(state.orthoSnap).toBe(false);
  });

  it("toggles discipline layers", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "TOGGLE_LAYER", layer: "piping" });
    expect(state.layerVisibility.piping).toBe(false);
    state = designerReducer(state, { type: "TOGGLE_LAYER", layer: "piping" });
    expect(state.layerVisibility.piping).toBe(true);
    state = designerReducer(state, { type: "TOGGLE_LAYER", layer: "bogus" });
    expect(state.layerVisibility.bogus).toBeUndefined();
  });

  it("patches pipe fields and moves a vertex", () => {
    let state = stateWithPipe();
    const id = state.design.pipes[0].id;
    state = designerReducer(state, { type: "SET_PIPE_FIELDS", pipeId: id, fields: { diameterIn: 4, material: "Copper" } });
    expect(state.design.pipes[0]).toMatchObject({ diameterIn: 4, material: "Copper" });
    state = designerReducer(state, { type: "MOVE_PIPE_VERTEX", pipeId: id, index: 1, point: { x: 96, y: 0 } });
    expect(state.design.pipes[0].points[1]).toEqual({ x: 96, y: 0 });
  });

  it("places, moves, rotates, tags, and deletes piping symbols", () => {
    let state = createInitialState(createEmptyDesign("Symbols"));
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL", domain: "piping", symbolId: "gate-valve" });
    expect(state.pendingSymbol).toEqual({ domain: "piping", symbolId: "gate-valve" });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 40, y: 50 });
    expect(state.design.symbols).toHaveLength(1);
    const id = state.design.symbols[0].id;
    expect(state.selection).toEqual({ kind: "symbol", id });
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL", domain: "piping", symbolId: "pump" });
    state = designerReducer(state, { type: "MOVE_SYMBOL", symbolId: id, x: 60, y: 70 });
    expect(state.design.symbols[0]).toMatchObject({ x: 60, y: 70 });
    state = designerReducer(state, { type: "ROTATE_SYMBOL", symbolId: id, rotationDeg: 45 });
    expect(state.design.symbols[0].rotationDeg).toBe(45);
    state = designerReducer(state, { type: "SET_SYMBOL_TAG", symbolId: id, tag: "XV-1" });
    expect(state.design.symbols[0].tag).toBe("XV-1");
    state = designerReducer(state, { type: "SET_SYMBOL_LAYER", symbolId: id, layer: "annotations" });
    expect(state.design.symbols[0].layer).toBe("annotations");
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.symbols).toHaveLength(0);
  });

  it("does not place a symbol without a pending selection", () => {
    const state = createInitialState(createEmptyDesign("Blank"));
    const next = designerReducer(state, { type: "PLACE_SYMBOL", x: 10, y: 10 });
    expect(next.design.symbols).toHaveLength(0);
  });

  it("ignores pipe/symbol actions for unknown ids", () => {
    let state = stateWithPipe();
    const before = state.design.pipes[0];
    state = designerReducer(state, { type: "SET_PIPE_FIELDS", pipeId: "missing", fields: { diameterIn: 8 } });
    state = designerReducer(state, { type: "MOVE_PIPE_VERTEX", pipeId: "missing", index: 0, point: { x: 1, y: 1 } });
    expect(state.design.pipes[0]).toBe(before);
  });

  it("allows the new tools in SET_TOOL", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_TOOL", tool: "pipe" });
    expect(state.tool).toBe("pipe");
    state = designerReducer(state, { type: "SET_TOOL", tool: "piping" });
    expect(state.tool).toBe("piping");
  });

  it("rejects unknown tool ids on the new actions", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_PENDING_PIPE" });
    expect(state.pendingPipe.diameterIn).toBe(2);
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL" });
    expect(state.pendingSymbol).toBeNull();
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL", domain: "nope", symbolId: "pump" });
    expect(state.pendingSymbol).toBeNull();
  });

  it("keeps the pending symbol active so several can be placed in a row", () => {
    let state = createInitialState();
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL", domain: "piping", symbolId: "pump" });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 10, y: 10 });
    // pending symbol stays so another pump can be dropped immediately
    expect(state.pendingSymbol).toEqual({ domain: "piping", symbolId: "pump" });
    expect(state.design.symbols).toHaveLength(1);
  });
});
