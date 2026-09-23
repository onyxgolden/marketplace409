/**
 * Crash-resilience regression tests (Phase 1 — crash audit).
 *
 * Incident: while building a floorplan, dragging a handle in a "flip the
 * door 180 degrees" motion white-screened the designer; on refresh, all
 * unsaved work was gone.
 *
 * Root-cause chain under audit:
 *  1. The wall-endpoint drag handler (PlanCanvas onPointerMove,
 *     drag.kind === "wall-endpoint") dispatches MOVE_WALL_ENDPOINT on every
 *     pointermove with NO guard. Dragging the free endpoint onto or past the
 *     fixed endpoint collapses the wall under 1 inch, and moveWallEndpoint
 *     THROWS ("Wall would collapse under 1 inch"). A reducer throw unmounts
 *     the entire React tree (no error boundary exists), producing the blank
 *     page.
 *  2. Saves are manual-only (Ctrl+S / Save button via saveScheduler); there
 *     is no autosave and no localStorage copy of the document, so everything
 *     since the last manual save dies with the crashed tab. Refresh loads the
 *     last server revision, which is why the floor plan appeared "gone".
 *
 * The failing test below pins the hardened behavior Phase 2 must implement:
 * a collapse attempt clamps to the structural minimum instead of throwing,
 * matching the existing clamp-not-throw convention already used by
 * moveOpeningStart / resizeOpening / moveOpening ("Pushed past the end edge:
 * collapses to the structural minimum, not inverted.").
 */
import { describe, expect, it } from "vitest";
import {
  addOpening,
  addWall,
  createEmptyDesign,
  moveOpeningStart,
  moveWallEndpoint,
  resizeOpening,
} from "./designerDocument.js";
import { wallLength } from "./designerGeometry.js";

function doorDesign() {
  let d = createEmptyDesign("Crash audit");
  d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
  const wall = d.walls[0];
  d = addOpening(d, wall.id, { type: "door", offsetIn: 40, widthIn: 36 });
  return { d, wallId: wall.id, openingId: d.openings[0].id };
}

describe("designer crash resilience — handle-drag collapse", () => {
  it("dragging a wall endpoint into/past the fixed end clamps instead of throwing", () => {
    const { d, wallId } = doorDesign();
    // The "flip 180 degrees" motion: endpoint "b" dragged back across the
    // fixed endpoint "a" (0,0). Today the collapse zone THROWS inside the
    // reducer ("Wall would collapse under 1 inch") -> React unmounts the
    // whole page (no error boundary) and unsaved work is lost (no autosave).
    // Hardened behavior (matching the opening convention "collapses to the
    // structural minimum, not inverted"): clamp to the 1" minimum, never
    // throw, never invert the wall direction.
    for (const target of [{ x: 0.5, y: 0 }, { x: 0, y: 0 }, { x: -10, y: 0 }]) {
      let next;
      expect(() => {
        next = moveWallEndpoint(d, wallId, "b", target);
      }).not.toThrow();
      const w = next.walls[0];
      expect(wallLength(w)).toBeGreaterThanOrEqual(1);
      expect(w.b.x).toBeGreaterThanOrEqual(w.a.x);
    }
  });

  it("door resize handle dragged across the far edge never inverts the opening", () => {
    // The door's own resize handles are already hardened (guarded in both
    // the canvas handler and the domain): documented here so the audit
    // records which handle paths are safe.
    const { d, openingId } = doorDesign();
    const end = 40 + 36;
    for (const target of [end - 1, end, end + 50]) {
      const next = moveOpeningStart(d, openingId, target);
      const o = next.openings.find((x) => x.id === openingId);
      expect(o.widthIn).toBeGreaterThan(0);
      expect(o.offsetIn).toBeGreaterThanOrEqual(0);
      expect(o.offsetIn + o.widthIn).toBeLessThanOrEqual(144);
    }
    for (const w of [0, -20]) {
      const next = resizeOpening(d, openingId, w);
      const o = next.openings.find((x) => x.id === openingId);
      expect(o.widthIn).toBeGreaterThan(0);
    }
  });
});

describe("designer crash resilience — collapse drag through undo/redo", () => {
  it("drag through the fixed end -> undo restores the pre-drag wall, redo restores the clamped wall", async () => {
    // Reducer-level check of the ChatGPT-required flow: proposed endpoint
    // (the invalid pointer position) -> clamp geometry -> dispatch, so the
    // undo history records the clamped result and never the invalid state.
    const { createInitialState, designerReducer } = await import(
      "../../components/designer/designerReducer.js"
    );
    const { d, wallId } = doorDesign();
    const before = d.walls[0];
    let state = createInitialState(d);

    // The "flip 180 degrees" motion: endpoint b dragged across fixed end a
    // to (-10, 0). The domain clamps; the reducer must not throw.
    const coalesce = `move-wall-endpoint:${wallId}:b`;
    for (const point of [{ x: 100, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }]) {
      expect(() =>
        (state = designerReducer(state, {
          type: "MOVE_WALL_ENDPOINT",
          wallId,
          end: "b",
          point,
          coalesce,
        })),
      ).not.toThrow();
    }

    // The dispatched result is the clamped wall — never the invalid pointer
    // position, never inverted, direction preserved.
    const clamped = state.design.walls.find((w) => w.id === wallId);
    expect(clamped.b).toEqual({ x: 1, y: 0 });
    expect(clamped.a).toEqual(before.a);
    expect(state.past).toHaveLength(1); // whole drag = one coalesced undo step

    // Undo returns the wall to the EXACT pre-drag state.
    state = designerReducer(state, { type: "UNDO" });
    const undone = state.design.walls.find((w) => w.id === wallId);
    expect(undone.a).toEqual(before.a);
    expect(undone.b).toEqual(before.b);

    // Redo returns the clamped state, not the raw pointer position.
    state = designerReducer(state, { type: "REDO" });
    const redone = state.design.walls.find((w) => w.id === wallId);
    expect(redone.b).toEqual({ x: 1, y: 0 });
    expect(redone.a).toEqual(before.a);
  });
});
