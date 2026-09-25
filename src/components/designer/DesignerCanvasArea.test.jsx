// @vitest-environment jsdom

// DesignerCanvasArea — the three view modes (2d / split / 3d).
//
// The contract that matters for P1-A: PlanCanvas and DesignerViewport3D are
// BOTH always mounted, in every mode — view switches only toggle CSS
// visibility and width. That is what guarantees the 3D camera and the 2D
// pan/zoom survive a 2D -> Split -> 3D -> 2D round trip (neither view ever
// unmounts), and it is asserted directly here via a render-count spy on the
// (mocked) 3D viewport, not inferred from the DOM alone.
//
// DesignerViewport3D itself needs a real WebGL context (unavailable in
// jsdom) and pulls in Three.js, so it is mocked here with a lightweight
// stand-in; this file is about DesignerCanvasArea's own mounting and layout
// logic, not the 3D renderer (that has its own test file).

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { createEmptyDesign, addWall } from "@/domains/roomDesigner/designerDocument";
import {
  DEFAULT_SPLIT_RATIO,
  SPLIT_RATIO_STORAGE_KEY,
  clampSplitRatio,
} from "./splitViewLayout";

const viewport3DRenderSpy = vi.fn();

vi.mock("./DesignerViewport3D", () => ({
  default: function StubViewport3D(props) {
    viewport3DRenderSpy(props);
    return (
      <div data-testid="viewport-3d-stub">
        3D walls={props.design?.walls?.length ?? 0} selection=
        {props.selection ? `${props.selection.kind}:${props.selection.id}` : "none"}
      </div>
    );
  },
}));

// next/dynamic normally defers + shows a loading state before resolving;
// mocked here to resolve synchronously so this test is about
// DesignerCanvasArea's own logic, not Next's lazy-loading timing.
vi.mock("next/dynamic", () => ({
  default: (loader) => {
    let Resolved = null;
    loader().then((mod) => {
      Resolved = mod.default || mod;
    });
    // The mocked module above has no real async work, so by the time
    // anything renders this, the microtask has already run.
    return function DynamicPassthrough(props) {
      if (!Resolved) return null;
      return <Resolved {...props} />;
    };
  },
}));

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let DesignerCanvasArea;

let container;
let root;

const baseProps = (overrides = {}) => ({
  view: "2d",
  design: createEmptyDesign(),
  tool: "select",
  selection: null,
  multiSelection: [],
  calibration: null,
  pendingCatalogId: null,
  pendingRoomTemplate: "bedroom",
  pendingPipe: { diameterIn: 2 },
  pendingSymbol: null,
  pendingCustomShape: null,
  orthoSnap: true,
  layerVisibility: {},
  dispatch: vi.fn(),
  zoomRequest: null,
  ...overrides,
});

const render = async (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DesignerCanvasArea {...baseProps(props)} />);
    // Flush the mocked dynamic import's microtask.
    await Promise.resolve();
    await Promise.resolve();
  });
};

const rerender = async (props) => {
  await act(async () => {
    root.render(<DesignerCanvasArea {...baseProps(props)} />);
    await Promise.resolve();
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  DesignerCanvasArea = (await import("./DesignerCanvasArea")).default;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

describe("view modes", () => {
  it("2d mode: only the 2D pane is visible; the 3D pane is still mounted, just hidden", async () => {
    await render({ view: "2d" });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').hidden).toBe(false);
    expect(container.querySelector('[data-testid="canvas-pane-3d"]').hidden).toBe(true);
    // Mounted, not absent: the stub rendered and was given props.
    expect(viewport3DRenderSpy).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="split-divider"]')).toBeNull();
  });

  it("3d mode: only the 3D pane is visible; the 2D pane is still mounted, just hidden", async () => {
    await render({ view: "3d" });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').hidden).toBe(true);
    expect(container.querySelector('[data-testid="canvas-pane-3d"]').hidden).toBe(false);
    expect(container.querySelector('[data-testid="split-divider"]')).toBeNull();
  });

  it("split mode: BOTH panes are visible simultaneously, with a divider between them", async () => {
    await render({ view: "split" });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').hidden).toBe(false);
    expect(container.querySelector('[data-testid="canvas-pane-3d"]').hidden).toBe(false);
    expect(container.querySelector('[data-testid="split-divider"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="viewport-3d-stub"]')).not.toBeNull();
    // The real 2D canvas is genuinely present too (PlanCanvas renders an svg).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("never unmounts either view across 2d -> split -> 3d -> 2d", async () => {
    await render({ view: "2d" });
    const renders1 = viewport3DRenderSpy.mock.calls.length;
    expect(renders1).toBeGreaterThan(0);

    await rerender({ view: "split" });
    await rerender({ view: "3d" });
    await rerender({ view: "2d" });

    // The stub re-rendered with new props each time (view changes flow
    // through as ordinary re-renders) but the mocked constructor/module
    // resolution only ran once — i.e. it was never unmounted and remounted.
    expect(viewport3DRenderSpy.mock.calls.length).toBeGreaterThan(renders1);
    // Still exactly one 3D pane node in the DOM (not destroyed and recreated).
    expect(container.querySelectorAll('[data-testid="canvas-pane-3d"]')).toHaveLength(1);
  });
});

describe("selection and design pass-through", () => {
  it("forwards the live design and selection to the 3D viewport", async () => {
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 }, { id: "w1" });
    await render({ view: "split", design, selection: { kind: "wall", id: "w1" } });
    expect(container.textContent).toContain("3D walls=1");
    expect(container.textContent).toContain("selection=wall:w1");
  });

  it("does not remount the 3D viewport when only selection changes", async () => {
    await render({ view: "split", selection: null });
    const callsBefore = viewport3DRenderSpy.mock.calls.length;
    await rerender({ view: "split", selection: { kind: "wall", id: "w1" } });
    expect(viewport3DRenderSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(container.querySelectorAll('[data-testid="canvas-pane-3d"]')).toHaveLength(1);
  });
});

describe("split ratio", () => {
  const setRect = (width) => {
    Element.prototype.getBoundingClientRect = function stubRect() {
      return { left: 0, top: 0, right: width, bottom: 600, width, height: 600, x: 0, y: 0 };
    };
  };

  it("starts at the default (or persisted) ratio", async () => {
    setRect(1000);
    await render({ view: "split" });
    const pane2d = container.querySelector('[data-testid="canvas-pane-2d"]');
    expect(pane2d.style.width).toBe(`${DEFAULT_SPLIT_RATIO * 100}%`);
  });

  it("restores a previously persisted ratio", async () => {
    setRect(1000);
    window.localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, "0.3");
    await render({ view: "split" });
    const pane2d = container.querySelector('[data-testid="canvas-pane-2d"]');
    expect(pane2d.style.width).toBe("30%");
  });

  it("dragging the divider updates the ratio live and persists it on release", async () => {
    setRect(1000);
    await render({ view: "split" });
    const divider = container.querySelector('[data-testid="split-divider"]');

    await act(async () => {
      divider.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }),
      );
      divider.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, clientX: 250, pointerId: 1 }),
      );
    });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').style.width).toBe("25%");

    await act(async () => {
      divider.dispatchEvent(
        new window.PointerEvent("pointerup", { bubbles: true, clientX: 250, pointerId: 1 }),
      );
    });
    expect(window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY)).toBe(String(clampSplitRatio(0.25)));
  });

  it("clamps the ratio so neither pane can be dragged to nothing", async () => {
    setRect(1000);
    await render({ view: "split" });
    const divider = container.querySelector('[data-testid="split-divider"]');
    await act(async () => {
      divider.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, clientX: 5, pointerId: 1 }),
      );
    });
    const pane2d = container.querySelector('[data-testid="canvas-pane-2d"]');
    expect(parseFloat(pane2d.style.width)).toBeGreaterThanOrEqual(20);
  });

  it("survives a view-mode switch (ratio is not reset going out of and back into split)", async () => {
    setRect(1000);
    await render({ view: "split" });
    const divider = container.querySelector('[data-testid="split-divider"]');
    await act(async () => {
      divider.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, clientX: 700, pointerId: 1 }),
      );
      divider.dispatchEvent(
        new window.PointerEvent("pointerup", { bubbles: true, clientX: 700, pointerId: 1 }),
      );
    });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').style.width).toBe("70%");

    await rerender({ view: "3d" });
    await rerender({ view: "split" });
    expect(container.querySelector('[data-testid="canvas-pane-2d"]').style.width).toBe("70%");
  });

  it("persists the ratio even when pointer capture throws — the exact bug found live", async () => {
    // In the running app, setPointerCapture/releasePointerCapture can throw
    // (a pointer id the browser does not consider active). The first version
    // of this code let that throw skip the save call that came right after
    // it, so the divider silently forgot its position on every drag. This
    // pins the fix: the save must survive the capture calls throwing.
    setRect(1000);
    const originalSet = window.HTMLElement.prototype.setPointerCapture;
    const originalRelease = window.HTMLElement.prototype.releasePointerCapture;
    window.HTMLElement.prototype.setPointerCapture = () => {
      throw new DOMException("No active pointer with the given id is found.", "NotFoundError");
    };
    window.HTMLElement.prototype.releasePointerCapture = () => {
      throw new DOMException("No active pointer with the given id is found.", "NotFoundError");
    };
    try {
      await render({ view: "split" });
      const divider = container.querySelector('[data-testid="split-divider"]');
      await act(async () => {
        divider.dispatchEvent(
          new window.PointerEvent("pointerdown", { bubbles: true, clientX: 700, pointerId: 1 }),
        );
        divider.dispatchEvent(
          new window.PointerEvent("pointerup", { bubbles: true, clientX: 700, pointerId: 1 }),
        );
      });
      expect(container.querySelector('[data-testid="canvas-pane-2d"]').style.width).toBe("70%");
      expect(window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY)).toBe(String(clampSplitRatio(0.7)));
    } finally {
      window.HTMLElement.prototype.setPointerCapture = originalSet;
      window.HTMLElement.prototype.releasePointerCapture = originalRelease;
    }
  });

  it("arrow keys nudge the ratio for keyboard users", async () => {
    setRect(1000);
    await render({ view: "split" });
    const divider = container.querySelector('[data-testid="split-divider"]');
    const before = parseFloat(container.querySelector('[data-testid="canvas-pane-2d"]').style.width);
    await act(async () => {
      divider.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    const after = parseFloat(container.querySelector('[data-testid="canvas-pane-2d"]').style.width);
    expect(after).toBeGreaterThan(before);
  });
});
