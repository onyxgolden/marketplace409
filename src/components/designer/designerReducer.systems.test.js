// designerReducer.systems.test.js — system/color/underground actions:
// undoable, fail soft on bad input, color-picker drags coalesce.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { addPipeRun, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";

function start() {
  let d = addPipeRun(createEmptyDesign("S"), [{ x: 0, y: 0 }, { x: 60, y: 0 }], { id: "l1" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 100, 0, { id: "p1" });
  return createInitialState(d);
}
const run = (state, ...actions) => actions.reduce((s, a) => designerReducer(s, a), state);

describe("system actions", () => {
  it("add → assign → recolor → delete, each undoable", () => {
    let s = run(start(),
      { type: "ADD_SYSTEM", name: "Cooling water", color: "#22c55e" },
      { type: "SET_MEMBER_SYSTEM", target: { kind: "pipe", id: "l1" }, systemId: "system_1" },
      { type: "SET_MEMBER_SYSTEM", target: { kind: "symbol", id: "p1" }, systemId: "system_1" },
      { type: "UPDATE_SYSTEM", systemId: "system_1", fields: { color: "#16a34a" } });
    expect(s.design.systems[0].color).toBe("#16a34a");
    expect(s.design.pipes[0].systemId).toBe("system_1");
    s = run(s, { type: "UNDO" });
    expect(s.design.systems[0].color).toBe("#22c55e");
    s = run(s, { type: "DELETE_SYSTEM", systemId: "system_1" });
    expect(s.design.systems).toEqual([]);
    expect(s.design.symbols[0].systemId).toBeUndefined();
  });

  it("ADD_SYSTEM with assignTo creates and assigns in one undo step", () => {
    let s = run(start(), { type: "ADD_SYSTEM", name: "Steam", color: "#ef4444", assignTo: { kind: "symbol", id: "p1" } });
    expect(s.design.symbols[0].systemId).toBe("system_1");
    s = run(s, { type: "UNDO" });
    expect(s.design.systems ?? []).toEqual([]);
    expect(s.design.symbols[0].systemId).toBeUndefined();
  });

  it("member color and underground", () => {
    let s = run(start(),
      { type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "p1" }, color: "#a855f7" },
      { type: "SET_PIPE_UNDERGROUND", pipeId: "l1", underground: true });
    expect(s.design.symbols[0].color).toBe("#a855f7");
    expect(s.design.pipes[0].underground).toBe(true);
    s = run(s, { type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "p1" }, color: null });
    expect(s.design.symbols[0].color).toBeUndefined();
  });

  it("color-picker drags coalesce into one undo step", () => {
    let s = start();
    for (const c of ["#111111", "#222222", "#333333"]) {
      s = run(s, { type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "p1" }, color: c, coalesce: "color:p1" });
    }
    s = run(s, { type: "UNDO" });
    expect(s.design.symbols[0].color).toBeUndefined();
  });

  it("fails soft on bad input (state unchanged)", () => {
    const s = run(start(), { type: "ADD_SYSTEM", name: "Steam", color: "#ef4444" });
    for (const a of [
      { type: "ADD_SYSTEM", name: "steam", color: "#000000" },
      { type: "ADD_SYSTEM", name: "X", color: "red" },
      { type: "UPDATE_SYSTEM", systemId: "nope", fields: { name: "Y" } },
      { type: "DELETE_SYSTEM", systemId: "nope" },
      { type: "SET_MEMBER_SYSTEM", target: { kind: "pipe", id: "l1" }, systemId: "nope" },
      { type: "SET_MEMBER_COLOR", target: { kind: "symbol", id: "zz" }, color: null },
      { type: "SET_PIPE_UNDERGROUND", pipeId: "zz", underground: true },
    ]) {
      expect(designerReducer(s, a)).toBe(s);
    }
  });
});
