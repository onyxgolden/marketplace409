import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

const importResult = {
  walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
  rooms: [],
  openings: [],
  pipes: [],
  symbols: [],
  furniture: [],
  annotations: [
    { id: "a1", kind: "path", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
  ],
};

describe("designerReducer IMPORT_VSDX_RESULT", () => {
  it("merges the import in one undo step", () => {
    let state = createInitialState(createEmptyDesign("Test"));
    const pastBefore = state.past.length;
    state = designerReducer(state, { type: "IMPORT_VSDX_RESULT", importResult });
    expect(state.design.walls).toHaveLength(1);
    expect(state.design.annotations).toHaveLength(1);
    // Exactly one undo entry was pushed for the whole import.
    expect(state.past.length).toBe(pastBefore + 1);
  });

  it("one UNDO removes the entire import", () => {
    let state = createInitialState(createEmptyDesign("Test"));
    state = designerReducer(state, { type: "IMPORT_VSDX_RESULT", importResult });
    expect(state.design.walls).toHaveLength(1);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.walls).toHaveLength(0);
    expect(state.design.annotations).toHaveLength(0);
  });

  it("does not mutate the pre-import design object", () => {
    const design = createEmptyDesign("Test");
    const state = createInitialState(design);
    designerReducer(state, { type: "IMPORT_VSDX_RESULT", importResult });
    expect(design.walls).toHaveLength(0);
    expect(design.annotations).toHaveLength(0);
  });
});
