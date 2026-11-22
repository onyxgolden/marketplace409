// hiddenPaneWork — the policy behind the phone scroll-freeze fix (FCCU
// Designer, Jason's live report 2026-11-21: scrolling to the 3D picker froze
// four times, 10-15s each).
//
// Two main-thread hogs were verified in DesignerViewport3D on main:
// (a) the animate loop rendered the full FCCU scene 60x/s into a hidden
// pane with no visibility guard; (b) every design change ran a synchronous
// buildThreeScene rebuild (120ms debounce) on the main thread. This module
// is the narrowest testable boundary for the fix's decisions:
//
// - shouldRenderFrame: the animate loop renders only while the pane is
//   visible and the document is shown.
// - createDeferredRebuild: a rebuild requested while the pane is hidden is
//   deferred (not run); becoming visible makes exactly one rebuild due,
//   however many requests piled up while hidden (coalesced).
//
// The component wires shouldRenderFrame into the animate loop and the
// deferred-rebuild machine into the rebuild effect + ResizeObserver. Those
// wirings need WebGL and are verified by the live phone-width measurement
// (see the slice result file), not by these unit tests.

import { describe, expect, it } from "vitest";
import { createDeferredRebuild, shouldRenderFrame } from "./hiddenPaneWork";

describe("shouldRenderFrame", () => {
  it("renders when the pane is visible and the document is shown", () => {
    expect(shouldRenderFrame(true, false)).toBe(true);
  });

  it("does not render into a hidden pane", () => {
    expect(shouldRenderFrame(false, false)).toBe(false);
  });

  it("does not render when the document is hidden, even if the pane has size", () => {
    expect(shouldRenderFrame(true, true)).toBe(false);
  });

  it("does not render when both are hidden", () => {
    expect(shouldRenderFrame(false, true)).toBe(false);
  });
});

describe("createDeferredRebuild", () => {
  it("a rebuild requested while visible runs immediately and never defers", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.requestRebuild(true)).toBe("run");
    expect(rebuild.isDeferred()).toBe(false);
    expect(rebuild.noteBecameVisible()).toBe(false);
  });

  it("a rebuild requested while hidden defers, and becoming visible makes exactly one rebuild due", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.requestRebuild(false)).toBe("defer");
    expect(rebuild.isDeferred()).toBe(true);
    expect(rebuild.noteBecameVisible()).toBe(true);
    // One-shot: the due rebuild is consumed, not re-reported.
    expect(rebuild.isDeferred()).toBe(false);
    expect(rebuild.noteBecameVisible()).toBe(false);
  });

  it("many requests while hidden coalesce into a single rebuild on show", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.requestRebuild(false)).toBe("defer");
    expect(rebuild.requestRebuild(false)).toBe("defer");
    expect(rebuild.requestRebuild(false)).toBe("defer");
    expect(rebuild.noteBecameVisible()).toBe(true);
    expect(rebuild.noteBecameVisible()).toBe(false);
  });

  it("becoming visible with nothing deferred makes no rebuild due", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.noteBecameVisible()).toBe(false);
    expect(rebuild.noteBecameVisible()).toBe(false);
  });

  it("a hide-show cycle with no intervening request makes no rebuild due", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.requestRebuild(true)).toBe("run");
    expect(rebuild.noteBecameVisible()).toBe(false);
  });

  it("a request while visible clears a stale deferred flag", () => {
    const rebuild = createDeferredRebuild();
    expect(rebuild.requestRebuild(false)).toBe("defer");
    expect(rebuild.isDeferred()).toBe(true);
    // The pane became visible through a path that already ran the build
    // (e.g. a fresh effect run): a later visible request must not leave a
    // stale deferred flag behind to fire a duplicate build.
    expect(rebuild.requestRebuild(true)).toBe("run");
    expect(rebuild.isDeferred()).toBe(false);
    expect(rebuild.noteBecameVisible()).toBe(false);
  });
});
