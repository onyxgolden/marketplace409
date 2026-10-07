import { describe, expect, it, vi } from "vitest";
import {
  MAX_NAMED_VIEWS,
  addNamedView,
  isCameraPose,
  nextViewName,
  poseFromCamera,
  removeNamedView,
} from "./namedCameraViews";

const pose = (x) => ({ position: { x, y: 100, z: 200 }, target: { x: 0, y: 0, z: 0 } });

describe("poseFromCamera", () => {
  it("copies the position and target numbers, not references to the live objects", () => {
    const camera = { position: { x: 1, y: 2, z: 3 } };
    const target = { x: 4, y: 5, z: 6 };
    const captured = poseFromCamera(camera, target);
    camera.position.x = 999;
    target.x = 999;
    expect(captured).toEqual({ position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } });
  });
});

describe("isCameraPose", () => {
  it("accepts a finite pose and rejects anything else", () => {
    expect(isCameraPose(pose(10))).toBe(true);
    expect(isCameraPose({ position: { x: NaN, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } })).toBe(false);
    expect(isCameraPose(null)).toBe(false);
  });
});

describe("addNamedView", () => {
  it("adds a view with a trimmed name and a stable id", () => {
    const views = addNamedView([], "  Front entry ", pose(10));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ name: "Front entry", pose: pose(10) });
    expect(typeof views[0].id).toBe("string");
  });

  it("ignores a blank name", () => {
    expect(addNamedView([], "   ", pose(10))).toEqual([]);
  });

  it("ignores an invalid pose", () => {
    expect(addNamedView([], "Bad", { position: null, target: null })).toEqual([]);
  });

  it("replaces a view that has the same name, rather than duplicating it", () => {
    const first = addNamedView([], "Kitchen", pose(10));
    const second = addNamedView(first, "Kitchen", pose(50));
    expect(second).toHaveLength(1);
    expect(second[0].pose).toEqual(pose(50));
  });

  it("stops at the limit", () => {
    let views = [];
    for (let i = 0; i < MAX_NAMED_VIEWS; i += 1) views = addNamedView(views, `View ${i}`, pose(i));
    expect(views).toHaveLength(MAX_NAMED_VIEWS);
    expect(addNamedView(views, "One too many", pose(99))).toHaveLength(MAX_NAMED_VIEWS);
  });

  it("does not change the list it was given", () => {
    const before = addNamedView([], "A", pose(1));
    const snapshot = JSON.stringify(before);
    addNamedView(before, "B", pose(2));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("view IDs stay unique across a reload", () => {
  it("a view saved after a reload does not reuse an ID already stored in the design", async () => {
    // Session 1 saved two views. The design was saved and reloaded, which
    // gives a fresh module (a counter starting over) and the stored list.
    const session1 = await loadFreshModule();
    let views = session1.addNamedView([], "Entry", pose(1));
    views = session1.addNamedView(views, "Kitchen", pose(2));
    const stored = JSON.parse(JSON.stringify(views));

    const fresh = await loadFreshModule();
    const after = fresh.addNamedView(stored, "Garage", pose(3));
    const ids = after.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(after).toHaveLength(3);
  });

  it("deleting a view after a reload removes only that view, not its twin", async () => {
    const session1 = await loadFreshModule();
    let views = session1.addNamedView([], "Entry", pose(1));
    views = session1.addNamedView(views, "Kitchen", pose(2));
    const fresh = await loadFreshModule();
    const withNew = fresh.addNamedView(JSON.parse(JSON.stringify(views)), "Garage", pose(3));
    const garage = withNew.find((v) => v.name === "Garage");
    const remaining = fresh.removeNamedView(withNew, garage.id);
    expect(remaining.map((v) => v.name)).toEqual(["Entry", "Kitchen"]);
  });

  it("the next ID follows the highest stored one, whatever the gap", () => {
    const stored = [{ id: "view-7", name: "A", pose: pose(1) }];
    const after = addNamedView(stored, "B", pose(2));
    expect(after[1].id).toBe("view-8");
  });
});

async function loadFreshModule() {
  vi.resetModules();
  return import("./namedCameraViews");
}

describe("removeNamedView", () => {
  it("removes only the view with that id", () => {
    let views = addNamedView([], "A", pose(1));
    views = addNamedView(views, "B", pose(2));
    const [keep, drop] = views;
    expect(removeNamedView(views, drop.id)).toEqual([keep]);
  });
});

describe("nextViewName", () => {
  it("suggests the next free 'View N' name", () => {
    expect(nextViewName([])).toBe("View 1");
    const views = addNamedView(addNamedView([], "View 1", pose(1)), "View 2", pose(2));
    expect(nextViewName(views)).toBe("View 3");
  });
});
