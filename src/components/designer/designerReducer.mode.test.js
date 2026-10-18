// designerReducer.mode.test.js — the SET_MODE action: mode persists on the
// design document, validates through normalizeDesignMode, and is undoable
// like the other document edits (touch).

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

function freshState() {
  return createInitialState(createEmptyDesign("Modes"));
}

describe("SET_MODE", () => {
  it("sets the mode on the design document", () => {
    let state = freshState();
    expect(state.design.mode).toBe("home");
    state = designerReducer(state, { type: "SET_MODE", mode: "industrial" });
    expect(state.design.mode).toBe("industrial");
  });

  it("normalizes invalid modes to home", () => {
    let state = freshState();
    state = designerReducer(state, { type: "SET_MODE", mode: "bogus" });
    expect(state.design.mode).toBe("home");
  });

  it("is one undo step: undo restores the previous mode", () => {
    let state = freshState();
    state = designerReducer(state, { type: "SET_MODE", mode: "industrial" });
    expect(state.design.mode).toBe("industrial");
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.mode).toBe("home");
  });
});

// D647-002: switching modes clears armed tool state the target mode cannot
// show, atomically with the mode change. The reducer's active
// symbol-placement tool is the generic "symbol" (no TOOL_DEFS entry), so
// admissibility is derived from the full tool state, not just the palette
// tool id.
describe("SET_MODE clears mode-disallowed tool state", () => {
  function industrialWith(armed) {
    let state = freshState();
    state = designerReducer(state, { type: "SET_MODE", mode: "industrial" });
    return designerReducer(state, armed);
  }

  it("clears an armed process-equipment symbol switching industrial -> home", () => {
    let state = industrialWith({
      type: "SET_PENDING_SYMBOL",
      domain: "processEquipment",
      symbolId: "centrifugal-pump",
    });
    expect(state.tool).toBe("symbol");
    expect(state.pendingSymbol).toEqual({ domain: "processEquipment", symbolId: "centrifugal-pump" });
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.design.mode).toBe("home");
    expect(state.tool).toBe("select");
    expect(state.pendingSymbol).toBeNull();
  });

  it("clears an armed piping symbol switching industrial -> home", () => {
    let state = industrialWith({
      type: "SET_PENDING_SYMBOL",
      domain: "piping",
      symbolId: "gate-valve",
    });
    expect(state.tool).toBe("piping");
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("select");
    expect(state.pendingSymbol).toBeNull();
  });

  it("clears an armed furniture item switching home -> industrial", () => {
    let state = freshState();
    state = designerReducer(state, { type: "SET_PENDING_CATALOG", catalogId: "bed-queen" });
    expect(state.tool).toBe("furniture");
    state = designerReducer(state, { type: "SET_MODE", mode: "industrial" });
    expect(state.design.mode).toBe("industrial");
    expect(state.tool).toBe("select");
    expect(state.pendingCatalogId).toBeNull();
  });

  it("keeps an armed shared-domain symbol (site/outdoor deck) across modes", () => {
    let state = industrialWith({
      type: "SET_PENDING_SYMBOL",
      domain: "siteOutdoor",
      symbolId: "deck",
    });
    expect(state.tool).toBe("symbol");
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("symbol");
    expect(state.pendingSymbol).toEqual({ domain: "siteOutdoor", symbolId: "deck" });
  });

  it("keeps ordinary allowed tools (wall) and custom shapes across modes", () => {
    let state = industrialWith({ type: "SET_TOOL", tool: "wall" });
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("wall");

    state = industrialWith({
      type: "SET_PENDING_CUSTOM_SHAPE",
      shape: { id: "s1", entities: { walls: [] } },
    });
    expect(state.tool).toBe("custom-shape");
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("custom-shape");
    expect(state.pendingCustomShape.id).toBe("s1");
  });

  it("resets a piping-run tool switching industrial -> home", () => {
    let state = industrialWith({ type: "SET_TOOL", tool: "pipe" });
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("select");
  });

  it("the mode change stays one undo step even when tool state is cleared", () => {
    let state = industrialWith({
      type: "SET_PENDING_SYMBOL",
      domain: "processEquipment",
      symbolId: "centrifugal-pump",
    });
    state = designerReducer(state, { type: "SET_MODE", mode: "home" });
    expect(state.tool).toBe("select");
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.mode).toBe("industrial");
  });
});
