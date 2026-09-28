// designerReducer.nudge.test.js — arrow-key nudging: NUDGE_SELECTION moves
// the selected object exactly one grid square per press.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import {
  addOrgChart,
  addRoomFromTemplate,
  addSheet,
  addWall,
  createEmptyDesign,
  placeFurniture,
  placeSymbol,
} from "@/domains/roomDesigner/designerDocument";

function stateWith(build) {
  const design = build(createEmptyDesign("Nudge"));
  return createInitialState(design);
}
const select = (state, kind, id) => designerReducer(state, { type: "SELECT", selection: { kind, id } });
const nudge = (state, dx, dy) => designerReducer(state, { type: "NUDGE_SELECTION", dx, dy });

describe("NUDGE_SELECTION", () => {
  it("moves selected furniture one grid square per press (default 6-inch grid)", () => {
    let state = stateWith((d) => placeFurniture(d, "bed-queen", 100, 100, 0));
    const id = state.design.furniture[0].id;
    state = select(state, "furniture", id);
    state = nudge(state, 1, 0);
    expect(state.design.furniture[0]).toMatchObject({ x: 106, y: 100 });
    state = nudge(state, 0, -1);
    expect(state.design.furniture[0]).toMatchObject({ x: 106, y: 94 });
    state = nudge(state, -1, 1);
    expect(state.design.furniture[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("uses the design's own grid size and keeps off-grid positions' offset", () => {
    let state = stateWith((d) => placeFurniture({ ...d, settings: { ...d.settings, gridIn: 12 } }, "toilet", 101, 50, 0));
    state = select(state, "furniture", state.design.furniture[0].id);
    state = nudge(state, 1, 1);
    expect(state.design.furniture[0]).toMatchObject({ x: 113, y: 62 });
  });

  it("moves process equipment and other placed symbols", () => {
    let state = stateWith((d) => placeSymbol(d, "processEquipment", "centrifugal-pump", 0, 0, { id: "p1" }));
    state = select(state, "symbol", "p1");
    state = nudge(state, 0, 1);
    expect(state.design.symbols[0]).toMatchObject({ x: 0, y: 6 });
  });

  it("moves rooms and walls rigidly", () => {
    let state = stateWith((d) => addWall(addRoomFromTemplate(d, "bedroom", { x: 0, y: 0 }), { x: 0, y: 200 }, { x: 120, y: 200 }));
    const room = state.design.rooms[0];
    const before = room.polygon.map((p) => ({ ...p }));
    state = nudge(select(state, "room", room.id), -1, 0);
    expect(state.design.rooms[0].polygon).toEqual(before.map((p) => ({ x: p.x - 6, y: p.y })));
    const wall = state.design.walls[state.design.walls.length - 1];
    state = nudge(select(state, "wall", wall.id), 0, 1);
    const moved = state.design.walls.find((w) => w.id === wall.id);
    expect(moved.a).toEqual({ x: 0, y: 206 });
    expect(moved.b).toEqual({ x: 120, y: 206 });
  });

  it("moves org charts and print sheets", () => {
    let state = stateWith((d) => addSheet(addOrgChart(d, "Ops", 100, 40), "letter", "landscape"));
    const chart = state.design.orgCharts[0];
    state = nudge(select(state, "orgchart", chart.id), 1, 0);
    expect(state.design.orgCharts[0]).toMatchObject({ x: chart.x + 6, y: chart.y });
    const sheet = state.design.sheets[0];
    state = nudge(select(state, "sheet", sheet.id), 0, -1);
    expect(state.design.sheets[0].y).toBeCloseTo(sheet.y - 6, 6);
  });

  it("moves every shift-selected piece of furniture together", () => {
    let state = stateWith((d) => placeFurniture(placeFurniture(d, "dining-chair", 10, 10, 0), "dining-chair", 50, 10, 0));
    const [a, b] = state.design.furniture;
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: a.id } });
    state = designerReducer(state, { type: "TOGGLE_MULTI_SELECT", target: { kind: "furniture", id: b.id } });
    state = nudge(state, 1, 0);
    expect(state.design.furniture.map((f) => f.x)).toEqual([16, 56]);
  });

  it("a burst of presses on the same object is one undo step", () => {
    let state = stateWith((d) => placeFurniture(d, "bathtub", 0, 0, 0));
    state = select(state, "furniture", state.design.furniture[0].id);
    for (let i = 0; i < 4; i += 1) state = nudge(state, 1, 0);
    expect(state.design.furniture[0].x).toBe(24);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.furniture[0].x).toBe(0);
  });

  it("does nothing without a selection, for unsupported kinds, or for a zero step", () => {
    const empty = stateWith((d) => placeFurniture(d, "bathtub", 0, 0, 0));
    expect(nudge(empty, 1, 0)).toBe(empty);
    const withPipe = stateWith((d) => d);
    const piped = designerReducer(withPipe, { type: "ADD_PIPE_RUN", points: [{ x: 0, y: 0 }, { x: 60, y: 0 }] });
    expect(nudge(piped, 1, 0)).toBe(piped); // pipes are reshaped by their vertices
    const sel = select(empty, "furniture", empty.design.furniture[0].id);
    expect(nudge(sel, 0, 0)).toBe(sel);
    const gone = select(empty, "furniture", "gone");
    expect(nudge(gone, 1, 0)).toBe(gone);
  });
});
