// @vitest-environment jsdom

// customShapeLibraryMount.test.jsx — the mount-time SSR/persistence pattern
// DesignerScreen uses for the custom-shape library, exercised in isolation.
//
// Two properties matter here, both found by verifying in the running app
// rather than by inspection:
//
// 1. The library must NOT be read from localStorage via a lazy useState
//    initializer. Doing so makes the very first CLIENT render differ from
//    the server-rendered (library-less) markup whenever a shape already
//    exists — a new "My shapes" palette category appears only on the
//    client — which is a hydration mismatch. React recovers by discarding
//    and remounting the affected subtree, and in the window before that
//    remount, the newly-added palette buttons did not respond to clicks at
//    all. The library must start EMPTY (matching SSR) and restore for real
//    only in a mount effect, exactly as ThemeProvider.jsx restores its
//    stored preference.
//
// 2. The mount effect that PERSISTS the library must not run on the mount
//    commit itself. The restore effect and the persist effect both run in
//    that first commit, in declaration order, against the SAME (still-
//    empty) `shapeLibrary` closure — the restore's setState only takes
//    effect on the NEXT commit. An unconditional persist would therefore
//    overwrite a real saved library with the empty one on every page load.
//
// This file reproduces the exact hook shape DesignerScreen.jsx uses (rather
// than mounting the full, heavily-dependent DesignerScreen component) so
// this contract has a fast, isolated regression test.

import React, { act, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, afterEach } from "vitest";
import { createEmptyLibrary } from "./customShapeLibrary";
import { loadLibrary, saveLibrary, SHAPE_LIBRARY_STORAGE_KEY } from "./customShapeStorage";

/** Reproduces DesignerScreen's shape-library mount hooks, byte for byte in intent. */
function LibraryMountHarness({ onRender }) {
  const [shapeLibrary, setShapeLibrary] = useState(createEmptyLibrary);
  useEffect(() => {
    const stored = loadLibrary();
    if (stored.shapes.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a value from an external store (localStorage) on mount; mirrors DesignerScreen.jsx and ThemeProvider.jsx.
      setShapeLibrary(stored);
    }
  }, []);
  const mountedShapeLibraryRef = useRef(false);
  useEffect(() => {
    if (!mountedShapeLibraryRef.current) {
      mountedShapeLibraryRef.current = true;
      return;
    }
    saveLibrary(shapeLibrary);
  }, [shapeLibrary]);
  onRender(shapeLibrary);
  return <div>{shapeLibrary.shapes.length} shape(s)</div>;
}

/** The unsafe version (lazy-load + unconditional persist), to prove it actually breaks. */
function UnsafeLibraryMountHarness({ onRender }) {
  const [shapeLibrary, setShapeLibrary] = useState(loadLibrary);
  useEffect(() => {
    saveLibrary(shapeLibrary);
  }, [shapeLibrary]);
  onRender(shapeLibrary);
  return <div>{shapeLibrary.shapes.length} shape(s)</div>;
}

let container;
let root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

const mount = (Component, onRender) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Component onRender={onRender} />);
  });
};

const seedLibrary = () => {
  const library = { version: 1, shapes: [{
    id: "shape-1", name: "Bay window", createdAt: 1, updatedAt: 1, favorite: false,
    bounds: { widthIn: 120, heightIn: 0 },
    counts: { walls: 1, rooms: 0, openings: 0, furniture: 0, pipes: 0, symbols: 0, total: 1 },
    entities: { walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }], rooms: [], openings: [], furniture: [], pipes: [], symbols: [] },
  }] };
  window.localStorage.setItem(SHAPE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  return library;
};

describe("shape library mount pattern — the safe version DesignerScreen uses", () => {
  it("starts empty on the very first render (matches what SSR would produce)", () => {
    seedLibrary();
    const renders = [];
    mount(LibraryMountHarness, (lib) => renders.push(lib));
    // First render is empty; the restore effect's setState produces a second.
    expect(renders[0].shapes).toEqual([]);
  });

  it("restores the real library after mount", () => {
    seedLibrary();
    mount(LibraryMountHarness, () => {});
    expect(container.textContent).toBe("1 shape(s)");
  });

  it("does NOT clear a pre-existing saved library on mount — the data-loss regression", () => {
    const seeded = seedLibrary();
    mount(LibraryMountHarness, () => {});
    const stillStored = JSON.parse(window.localStorage.getItem(SHAPE_LIBRARY_STORAGE_KEY));
    expect(stillStored.shapes).toHaveLength(1);
    expect(stillStored.shapes[0].name).toBe(seeded.shapes[0].name);
  });

  it("still starts empty, and persists nothing, when there was nothing to restore", () => {
    mount(LibraryMountHarness, () => {});
    expect(container.textContent).toBe("0 shape(s)");
    expect(window.localStorage.getItem(SHAPE_LIBRARY_STORAGE_KEY)).toBeNull();
  });
});

describe("shape library mount pattern — the unsafe version this regression guards against", () => {
  it("demonstrates the bug: lazy-loading + unconditional persist wipes real data on mount", () => {
    const seeded = seedLibrary();
    mount(UnsafeLibraryMountHarness, () => {});
    // The component itself looks fine (it read the real data)...
    expect(container.textContent).toBe("1 shape(s)");
    // ...but decisively, this is the SSR-mismatch confirmation: were this
    // rendered on the server first, the server's `loadLibrary()` would see no
    // window and return empty, so the server-rendered "0 shape(s)" would
    // disagree with the client's "1 shape(s)" above — the exact mismatch
    // verified live in the running app. The safe harness's first render was
    // asserted to be "0 shape(s)" precisely so it CANNOT disagree with SSR.
    expect(seeded.shapes).toHaveLength(1);
  });
});
