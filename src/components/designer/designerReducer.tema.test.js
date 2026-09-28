// designerReducer.tema.test.js — placing, configuring, switching and replacing
// TEMA exchangers through the reducer, with undo/redo.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { TEMA_PRESETS } from "@/domains/roomDesigner/temaTypes";

const D = "processEquipment";
function placed(symbolId = "tema-exchanger") {
  let state = designerReducer(createInitialState(), { type: "SET_PENDING_SYMBOL", domain: D, symbolId });
  state = designerReducer(state, { type: "PLACE_SYMBOL", x: 100, y: 50 });
  return state;
}
const inst = (state) => state.design.symbols[0];

describe("TEMA exchanger through the reducer", () => {
  it("places an exchanger with its default configuration and the next E tag", () => {
    const state = placed();
    expect(inst(state)).toMatchObject({ symbolId: "tema-exchanger", tag: "E-101", tema: { ...TEMA_PRESETS.AES } });
    expect(inst(state).drawingMode).toBeUndefined();
    expect(placed("tema-front-a").design.symbols[0].tema).toBeUndefined();
  });

  it("saves a new configuration and undoes/redoes it", () => {
    let state = placed();
    const id = inst(state).id;
    state = designerReducer(state, { type: "SET_SYMBOL_TEMA", symbolId: id, config: TEMA_PRESETS.BEU });
    expect(inst(state).tema).toEqual({ ...TEMA_PRESETS.BEU });
    state = designerReducer(state, { type: "UNDO" });
    expect(inst(state).tema).toEqual({ ...TEMA_PRESETS.AES });
    state = designerReducer(state, { type: "REDO" });
    expect(inst(state).tema).toEqual({ ...TEMA_PRESETS.BEU });
  });

  it("ignores a blocked configuration (no history entry)", () => {
    const state = placed();
    const next = designerReducer(state, { type: "SET_SYMBOL_TEMA", symbolId: inst(state).id, config: { front: "B", shell: "E", rear: "U", tubePasses: 1 } });
    expect(next).toBe(state);
  });

  it("switches drawing mode and back without touching anything else", () => {
    let state = placed();
    const id = inst(state).id;
    state = designerReducer(state, { type: "ROTATE_SYMBOL", symbolId: id, rotationDeg: 90 });
    state = designerReducer(state, { type: "SET_SYMBOL_SIZE", symbolId: id, widthIn: 240, depthIn: 48 });
    const before = inst(state);
    state = designerReducer(state, { type: "SET_SYMBOL_DRAWING_MODE", symbolId: id, mode: "pid" });
    expect(inst(state).drawingMode).toBe("pid");
    state = designerReducer(state, { type: "UNDO" });
    expect(inst(state)).toEqual(before);
    expect(designerReducer(state, { type: "SET_SYMBOL_DRAWING_MODE", symbolId: id, mode: "bogus" })).toBe(state);
  });

  it("coalesces a burst of size edits into one undo step", () => {
    let state = placed();
    const id = inst(state).id;
    state = designerReducer(state, { type: "SET_SYMBOL_SIZE", symbolId: id, widthIn: 200, coalesce: `size:${id}` });
    state = designerReducer(state, { type: "SET_SYMBOL_SIZE", symbolId: id, widthIn: 210, coalesce: `size:${id}` });
    expect(inst(state).widthIn).toBe(210);
    state = designerReducer(state, { type: "UNDO" });
    expect(inst(state).widthIn).toBeUndefined();
    expect(designerReducer(state, { type: "SET_SYMBOL_SIZE", symbolId: id, widthIn: -1 })).toBe(state);
  });

  it("replaces a simple exchanger with the detailed version in place, keeping it selected", () => {
    let state = placed("shell-tube-exchanger");
    const before = inst(state);
    state = designerReducer(state, { type: "REPLACE_WITH_DETAILED", symbolId: before.id });
    expect(inst(state)).toMatchObject({
      id: before.id, symbolId: "tema-exchanger", x: 100, y: 50, tag: before.tag, layer: before.layer,
      rotationDeg: 0, widthIn: 144, depthIn: 30, tema: { ...TEMA_PRESETS.AES },
    });
    expect(state.selection).toEqual({ kind: "symbol", id: before.id });
    state = designerReducer(state, { type: "UNDO" });
    expect(inst(state)).toEqual(before);
    const pump = placed("centrifugal-pump");
    expect(designerReducer(pump, { type: "REPLACE_WITH_DETAILED", symbolId: inst(pump).id })).toBe(pump);
  });
});

describe("pipes attached to TEMA nozzles through the reducer", async () => {
  const { findSymbol } = await import("@/domains/roomDesigner/symbolRegistry");
  const { temaAnchorsWorld } = await import("@/domains/roomDesigner/temaGeometry");
  const nozzle = (state, id) =>
    temaAnchorsWorld(findSymbol(D, "tema-exchanger"), state.design.symbols[0]).find((a) => a.id === id);
  function pipedState() {
    let state = placed();
    const a = nozzle(state, "tube-in");
    state = designerReducer(state, { type: "ADD_PIPE_RUN", points: [{ x: a.x, y: a.y }, { x: a.x, y: -300 }] });
    return state;
  }
  const pipe = (state) => state.design.pipes[0];
  const onNozzle = (state) => {
    const a = nozzle(state, "tube-in");
    expect(pipe(state).points[0].x).toBeCloseTo(a.x, 9);
    expect(pipe(state).points[0].y).toBeCloseTo(a.y, 9);
  };

  it("attaches a committed run whose end was snapped onto a nozzle", () => {
    const state = pipedState();
    expect(pipe(state).attachments).toEqual({ start: { symbolId: inst(state).id, anchorId: "tube-in" } });
  });

  it("keeps the end on the nozzle through move, rotate, resize and reconfigure — and undo", () => {
    let state = pipedState();
    const id = inst(state).id;
    const start = pipe(state).points[0];
    state = designerReducer(state, { type: "MOVE_SYMBOL", symbolId: id, x: 180, y: 90, coalesce: `move-symbol:${id}` });
    state = designerReducer(state, { type: "MOVE_SYMBOL", symbolId: id, x: 200, y: 120, coalesce: `move-symbol:${id}` });
    onNozzle(state);
    state = designerReducer(state, { type: "ROTATE_SYMBOL", symbolId: id, rotationDeg: 45 });
    onNozzle(state);
    state = designerReducer(state, { type: "SET_SYMBOL_SIZE", symbolId: id, widthIn: 260 });
    onNozzle(state);
    state = designerReducer(state, { type: "SET_SYMBOL_TEMA", symbolId: id, config: TEMA_PRESETS.BEU });
    onNozzle(state);
    for (let i = 0; i < 4; i += 1) state = designerReducer(state, { type: "UNDO" });
    expect(pipe(state).points[0]).toEqual(start);
  });

  it("detaches an end dragged off the nozzle, and re-attaches one dropped back on", () => {
    let state = pipedState();
    const a = nozzle(state, "tube-in");
    state = designerReducer(state, { type: "MOVE_PIPE_VERTEX", pipeId: pipe(state).id, index: 0, point: { x: a.x - 24, y: a.y - 24 } });
    expect(pipe(state).attachments).toBeUndefined();
    state = designerReducer(state, { type: "MOVE_SYMBOL", symbolId: inst(state).id, x: 0, y: 0 });
    expect(pipe(state).points[0]).toEqual({ x: a.x - 24, y: a.y - 24 }); // no longer follows
    const b = nozzle(state, "tube-in");
    state = designerReducer(state, { type: "MOVE_PIPE_VERTEX", pipeId: pipe(state).id, index: 0, point: { x: b.x, y: b.y } });
    expect(pipe(state).attachments.start.anchorId).toBe("tube-in");
  });

  it("leaves the pipe end where it was when the exchanger is deleted", () => {
    let state = pipedState();
    const points = pipe(state).points;
    state = designerReducer(state, { type: "SELECT", selection: { kind: "symbol", id: inst(state).id } });
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.symbols).toHaveLength(0);
    expect(pipe(state).points).toEqual(points);
    expect(pipe(state).attachments).toBeUndefined();
  });
});
