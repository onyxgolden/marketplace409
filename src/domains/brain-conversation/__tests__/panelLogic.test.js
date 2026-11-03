import { describe, expect, it } from "vitest";
import {
  DRAG_TAP_THRESHOLD_PIXELS,
  dragDistancePixels,
  dragPosition,
} from "../panelLogic.js";

describe("panel drag math (Q1)", () => {
  it("converts pixel deltas to viewport percents", () => {
    expect(
      dragPosition({
        startX: 92,
        startY: 85,
        deltaXPixels: 100,
        deltaYPixels: -50,
        viewportWidth: 1000,
        viewportHeight: 1000,
      }),
    ).toEqual({ x: 100, y: 80 });
  });

  it("clamps to the viewport", () => {
    const pos = dragPosition({
      startX: 95,
      startY: 5,
      deltaXPixels: 500,
      deltaYPixels: -500,
      viewportWidth: 1000,
      viewportHeight: 1000,
    });
    expect(pos).toEqual({ x: 100, y: 0 });
  });

  it("measures drag distance and treats small moves as taps", () => {
    expect(dragDistancePixels(3, 4)).toBe(5);
    expect(DRAG_TAP_THRESHOLD_PIXELS).toBe(4);
    expect(dragDistancePixels(2, 2)).toBeLessThanOrEqual(DRAG_TAP_THRESHOLD_PIXELS);
  });
});
