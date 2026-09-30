// PlanCanvas.wallCovering.test.js — a wall's stroke when it has a
// user-uploaded covering (a flat color, or a wallpaper pattern tiled in
// screen pixels). Pure logic, extracted from renderWall specifically so it
// doesn't require mounting the whole PlanCanvas component.

import { describe, expect, it } from "vitest";
import { wallCoveringStroke } from "./PlanCanvas";

describe("wallCoveringStroke", () => {
  const wall = { id: "wall_1" };

  it("defaults to the plain gray when there's no covering", () => {
    expect(wallCoveringStroke(wall, { isSelected: false, scale: 2 })).toEqual({ stroke: "#e5e7eb", pattern: null });
  });

  it("uses the extracted color directly, no pattern", () => {
    const colored = { ...wall, wallCovering: { kind: "color", color: "#8a6f4d" } };
    expect(wallCoveringStroke(colored, { isSelected: false, scale: 2 })).toEqual({ stroke: "#8a6f4d", pattern: null });
  });

  it("builds a pattern reference for a wallpaper covering, sized in screen pixels (tileIn * scale)", () => {
    const papered = { ...wall, wallCovering: { kind: "pattern", dataUrl: "data:image/png;base64,x", tileIn: 12 } };
    const result = wallCoveringStroke(papered, { isSelected: false, scale: 3 });
    expect(result.stroke).toBe("url(#wall-covering-wall_1)");
    expect(result.pattern).toEqual({ id: "wall-covering-wall_1", dataUrl: "data:image/png;base64,x", tilePx: 36 });
  });

  it("defaults the pattern's tile size to 24 inches when tileIn is omitted", () => {
    const papered = { ...wall, wallCovering: { kind: "pattern", dataUrl: "data:image/png;base64,x" } };
    expect(wallCoveringStroke(papered, { isSelected: false, scale: 2 }).pattern.tilePx).toBe(48);
  });

  it("selection amber always wins, regardless of covering", () => {
    const colored = { ...wall, wallCovering: { kind: "color", color: "#8a6f4d" } };
    expect(wallCoveringStroke(colored, { isSelected: true, scale: 2 })).toEqual({ stroke: "#f59e0b", pattern: null });
    const papered = { ...wall, wallCovering: { kind: "pattern", dataUrl: "data:image/png;base64,x", tileIn: 12 } };
    expect(wallCoveringStroke(papered, { isSelected: true, scale: 2 })).toEqual({ stroke: "#f59e0b", pattern: null });
  });

  it("falls back to the plain gray (never a zero-size pattern) when scale is missing, zero, or negative", () => {
    const papered = { ...wall, wallCovering: { kind: "pattern", dataUrl: "data:image/png;base64,x", tileIn: 12 } };
    for (const scale of [0, -1, undefined, NaN]) {
      expect(wallCoveringStroke(papered, { isSelected: false, scale })).toEqual({ stroke: "#e5e7eb", pattern: null });
    }
  });

  it("falls back to the plain gray when a pattern covering has no dataUrl", () => {
    const broken = { ...wall, wallCovering: { kind: "pattern", tileIn: 12 } };
    expect(wallCoveringStroke(broken, { isSelected: false, scale: 2 })).toEqual({ stroke: "#e5e7eb", pattern: null });
  });
});
