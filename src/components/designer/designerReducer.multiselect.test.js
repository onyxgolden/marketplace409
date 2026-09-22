import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";

function stateWithGroup() {
  // A wall plus two furniture pieces; ids come from the reducer's own adds.
  let state = createInitialState();
  state = designerReducer(state, {
    type: "ADD_WALL",
    a: { x: 0, y: 0 },
    b: { x: 144, y: 0 },
  });
  for (const [catalogId, x] of [
    ["desk", 100],
    ["armchair", 300],
  ]) {
    state = designerReducer(state, { type: "PLACE_FURNITURE", catalogId, x, y: 100 });
  }
  const wallId = state.design.walls[0].id;
  const [a, b] = state.design.furniture;
  return { state, wallId, a, b };
}

describe("designerReducer — TOGGLE_GROUP_SELECT (ctrl/cmd multi-select)", () => {
  it("toggles any plan kind in and out without clearing the rest", () => {
    let { state, wallId, a, b } = stateWithGroup();
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "wall", id: wallId },
    });
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    expect(state.multiSelection).toEqual([
      { kind: "wall", id: wallId },
      { kind: "furniture", id: a.id },
    ]);
    expect(state.selection).toBeNull();
    // Toggling the wall again removes just it.
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "wall", id: wallId },
    });
    expect(state.multiSelection).toEqual([{ kind: "furniture", id: a.id }]);
    expect(b).toBeDefined();
  });

  it("folds an existing single selection into the group on toggle-add", () => {
    let { state, wallId, a } = stateWithGroup();
    state = designerReducer(state, {
      type: "SELECT",
      selection: { kind: "furniture", id: a.id },
    });
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "wall", id: wallId },
    });
    expect(state.selection).toBeNull();
    expect(state.multiSelection).toEqual([
      { kind: "furniture", id: a.id },
      { kind: "wall", id: wallId },
    ]);
  });

  it("ignores kinds outside the group-selectable set", () => {
    let { state } = stateWithGroup();
    const before = state;
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "underlay", id: "u1" },
    });
    expect(state).toBe(before);
    state = designerReducer(state, { type: "TOGGLE_GROUP_SELECT", target: null });
    expect(state).toBe(before);
  });

  it("does not duplicate an already-grouped target", () => {
    let { state, a } = stateWithGroup();
    state = designerReducer(state, {
      type: "SELECT",
      selection: { kind: "furniture", id: a.id },
    });
    // Toggling the already-selected piece removes it (toggle-out), it is
    // never added twice.
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    expect(state.multiSelection).toEqual([]);
    expect(state.selection).toBeNull();
  });
});

describe("designerReducer — MOVE_SELECTION_GROUP (group drag)", () => {
  it("moves every member and preserves relative offsets", () => {
    let { state, wallId, a, b } = stateWithGroup();
    for (const target of [
      { kind: "wall", id: wallId },
      { kind: "furniture", id: a.id },
      { kind: "furniture", id: b.id },
    ]) {
      state = designerReducer(state, { type: "TOGGLE_GROUP_SELECT", target });
    }
    const members = state.multiSelection;
    state = designerReducer(state, {
      type: "MOVE_SELECTION_GROUP",
      moves: members.map((m) => ({ ...m, dx: 12, dy: 24 })),
      coalesce: "move-selection-group:1",
    });
    const wall = state.design.walls[0];
    expect(wall.a).toEqual({ x: 12, y: 24 });
    expect(wall.b).toEqual({ x: 156, y: 24 });
    const [fa, fb] = state.design.furniture;
    expect([fa.x, fa.y]).toEqual([112, 124]);
    expect([fb.x, fb.y]).toEqual([312, 124]);
    // b was 200 right of a; it still is.
    expect(fb.x - fa.x).toBe(200);
  });

  it("collapses a whole group drag into a single undo entry", () => {
    let { state, a, b } = stateWithGroup();
    for (const target of [
      { kind: "furniture", id: a.id },
      { kind: "furniture", id: b.id },
    ]) {
      state = designerReducer(state, { type: "TOGGLE_GROUP_SELECT", target });
    }
    const pastBefore = state.past.length;
    const members = state.multiSelection;
    const key = "move-selection-group:7";
    state = designerReducer(state, {
      type: "MOVE_SELECTION_GROUP",
      moves: members.map((m) => ({ ...m, dx: 6, dy: 0 })),
      coalesce: key,
    });
    state = designerReducer(state, {
      type: "MOVE_SELECTION_GROUP",
      moves: members.map((m) => ({ ...m, dx: 6, dy: 0 })),
      coalesce: key,
    });
    // Two dispatches, one gesture: exactly one new undo step.
    expect(state.past.length).toBe(pastBefore + 1);
    expect(state.design.furniture[0].x).toBe(112);
    // One UNDO restores both pieces.
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.furniture[0].x).toBe(100);
    expect(state.design.furniture[1].x).toBe(300);
  });

  it("is a no-op for an empty move list", () => {
    let { state } = stateWithGroup();
    const before = state;
    state = designerReducer(state, { type: "MOVE_SELECTION_GROUP", moves: [] });
    expect(state).toBe(before);
  });
});

describe("designerReducer — DELETE_SELECTION with a cross-type group", () => {
  it("deletes every grouped kind, not just furniture", () => {
    let { state, wallId, a } = stateWithGroup();
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "wall", id: wallId },
    });
    state = designerReducer(state, {
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    state = designerReducer(state, { type: "DELETE_SELECTION" });
    expect(state.design.walls).toHaveLength(0);
    expect(state.design.furniture).toHaveLength(1);
    expect(state.multiSelection).toEqual([]);
    expect(state.selection).toBeNull();
  });

  it("leaves shift-click furniture multi-select behavior unchanged", () => {
    // Regression guard: the furniture-only TOGGLE_MULTI_SELECT path keeps
    // its exact semantics alongside the new cross-type action.
    let { state, a, b } = stateWithGroup();
    state = designerReducer(state, {
      type: "TOGGLE_MULTI_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    state = designerReducer(state, {
      type: "TOGGLE_MULTI_SELECT",
      target: { kind: "furniture", id: b.id },
    });
    expect(state.multiSelection.map((m) => m.id)).toEqual([a.id, b.id]);
    state = designerReducer(state, {
      type: "TOGGLE_MULTI_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    expect(state.multiSelection.map((m) => m.id)).toEqual([b.id]);
  });
});
