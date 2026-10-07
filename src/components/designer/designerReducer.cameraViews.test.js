// Saving or deleting a camera view is a design edit: it goes through the reducer,
// so it is undoable and marks the design dirty like any other change.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { addNamedView } from "@/domains/roomDesigner/namedCameraViews";

const pose = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };

describe("SET_CAMERA_VIEWS", () => {
  it("stores the new list on the design and makes it undoable", () => {
    const start = createInitialState();
    const views = addNamedView([], "Entry", pose);
    const next = designerReducer(start, { type: "SET_CAMERA_VIEWS", views });
    expect(next.design.cameraViews).toEqual(views);
    expect(next.dirty).toBe(true);
    expect(designerReducer(next, { type: "UNDO" }).design.cameraViews).toEqual([]);
  });
});
