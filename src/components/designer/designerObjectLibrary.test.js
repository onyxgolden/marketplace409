import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

describe("designerReducer — object library", () => {
  it("arms non-piping symbol domains on the generic symbol tool", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "buildingElements",
      symbolId: "door-single",
    });
    expect(state.pendingSymbol).toEqual({ domain: "buildingElements", symbolId: "door-single" });
    expect(state.tool).toBe("symbol");
  });

  it("keeps the piping domain on the piping tool (existing behavior)", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "piping",
      symbolId: "gate-valve",
    });
    expect(state.tool).toBe("piping");
  });

  it("ignores SET_PENDING_SYMBOL for unknown symbols", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "buildingElements",
      symbolId: "not-a-symbol",
    });
    expect(state.pendingSymbol).toBeNull();
  });

  it("places library symbols into design.symbols through the existing pipeline", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "buildingElements",
      symbolId: "door-single",
    });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 100, y: 50 });
    expect(state.design.symbols).toHaveLength(1);
    expect(state.design.symbols[0]).toMatchObject({
      domain: "buildingElements",
      symbolId: "door-single",
      x: 100,
      y: 50,
      layer: "equipment", // the symbol's defaultLayer
    });
    expect(state.selection).toEqual({ kind: "symbol", id: state.design.symbols[0].id });
  });

  it("places site and MEP symbols with their default layers", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "siteOutdoor",
      symbolId: "pool-rect",
    });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 10, y: 10 });
    expect(state.design.symbols[0]).toMatchObject({ domain: "siteOutdoor", layer: "equipment" });

    state = designerReducer(state, {
      type: "SET_PENDING_SYMBOL",
      domain: "mepFixtures",
      symbolId: "outlet-duplex",
    });
    state = designerReducer(state, { type: "PLACE_SYMBOL", x: 20, y: 20 });
    expect(state.design.symbols[1]).toMatchObject({ domain: "mepFixtures", layer: "piping" });
  });

  it("keeps furniture on its existing SET_PENDING_CATALOG contract", () => {
    let state = createInitialState(createEmptyDesign("Library"));
    state = designerReducer(state, { type: "SET_PENDING_CATALOG", catalogId: "armchair" });
    expect(state.pendingCatalogId).toBe("armchair");
    expect(state.tool).toBe("furniture");
    expect(state.pendingSymbol).toBeNull();
  });
});
