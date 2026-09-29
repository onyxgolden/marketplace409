import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";

describe("SET_RACK_PARAMS", () => {
  const start = () => createInitialState(placeSymbol(createEmptyDesign("R"), "processEquipment", "pipe-rack", 0, 0, { id: "r1" }));

  it("sets rack parameters as one undo step", () => {
    let s = designerReducer(start(), { type: "SET_RACK_PARAMS", symbolId: "r1", fields: { tiers: 3, elevationIn: 240 } });
    expect(s.design.symbols[0].rack).toEqual({ tiers: 3, elevationIn: 240 });
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.symbols[0].rack).toBeUndefined();
  });

  it("fails soft on out-of-range values and unknown instances", () => {
    const s = start();
    expect(designerReducer(s, { type: "SET_RACK_PARAMS", symbolId: "r1", fields: { tiers: 9 } })).toBe(s);
    expect(designerReducer(s, { type: "SET_RACK_PARAMS", symbolId: "zz", fields: { tiers: 2 } })).toBe(s);
  });
});
