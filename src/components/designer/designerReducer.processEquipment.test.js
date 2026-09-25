// Placing process equipment through the reducer auto-tags it.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";

describe("PLACE_SYMBOL for process equipment", () => {
  it("assigns P-101, P-102 to successive pumps; piping symbols stay untagged", () => {
    let state = designerReducer(createInitialState(), { type: "SET_PENDING_SYMBOL", domain: "processEquipment", symbolId: "centrifugal-pump" });
    expect(state.tool).toBe("symbol");
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 10, y: 10 });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 60, y: 10 });
    expect(state.design.symbols.map((s) => s.tag)).toEqual(["P-101", "P-102"]);
    expect(state.design.symbols[0].layer).toBe("equipment");
    state = designerReducer(state, { type: "SET_PENDING_SYMBOL", domain: "piping", symbolId: "gate-valve" });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 90, y: 10 });
    expect(state.design.symbols[2].tag).toBeUndefined();
  });
});
