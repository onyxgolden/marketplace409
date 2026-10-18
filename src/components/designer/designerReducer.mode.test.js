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
