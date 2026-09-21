/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { parseXml } from "./visioXml.js";
import { cellElementMap } from "./visioResolver.js";
import {
  applyToPoint,
  flip,
  IDENTITY,
  localTransform,
  multiply,
  pageTransform,
  rotation,
  translation,
} from "./visioTransforms.js";

/** Build a cell map from a plain object of V values (Node env: no DOMParser needed via manual map). */
function fakeCells(values) {
  const map = new Map();
  for (const [name, v] of Object.entries(values)) {
    map.set(name, { getAttribute: (attr) => (attr === "V" ? String(v) : attr === "F" ? null : null) });
  }
  return map;
}

const pt = (x, y) => ({ x, y });
const close = (p, x, y, eps = 1e-9) => {
  expect(Math.abs(p.x - x)).toBeLessThan(eps);
  expect(Math.abs(p.y - y)).toBeLessThan(eps);
};

describe("visioTransforms", () => {
  it("identity leaves points alone", () => {
    close(applyToPoint(IDENTITY, pt(3, 4)), 3, 4);
  });

  it("multiplies in the right order (m applied after n)", () => {
    const m = multiply(translation(10, 0), translation(0, 5));
    close(applyToPoint(m, pt(0, 0)), 10, 5);
  });

  it("rotates 90° counter-clockwise in Y-up space", () => {
    close(applyToPoint(rotation(Math.PI / 2), pt(1, 0)), 0, 1);
  });

  it("rotates 180°", () => {
    close(applyToPoint(rotation(Math.PI), pt(1, 2)), -1, -2);
  });

  it("rotates a non-right angle (30°)", () => {
    const p = applyToPoint(rotation(Math.PI / 6), pt(2, 0));
    close(p, 2 * Math.cos(Math.PI / 6), 2 * Math.sin(Math.PI / 6));
  });

  it("flips X, Y, and both", () => {
    close(applyToPoint(flip(true, false), pt(3, 4)), -3, 4);
    close(applyToPoint(flip(false, true), pt(3, 4)), 3, -4);
    close(applyToPoint(flip(true, true), pt(3, 4)), -3, -4);
  });

  it("builds local transform as T(Pin) · R(Angle) · Flip · T(-LocPin)", () => {
    // 2x1 rect, centered LocPin, pin at (5,5), rotated 90°.
    const cells = fakeCells({ PinX: 5, PinY: 5, LocPinX: 1, LocPinY: 0.5, Angle: Math.PI / 2 });
    const { matrix, approximated } = localTransform(cells);
    expect(approximated).toEqual([]);
    // Local corner (0,0) → translate(-1,-0.5) → rotate 90° → (0.5,-1) → pin → (5.5,4).
    close(applyToPoint(matrix, pt(0, 0)), 5.5, 4);
    // Local corner (2,1) → (1,0.5) → (-0.5,1) → (4.5,6).
    close(applyToPoint(matrix, pt(2, 1)), 4.5, 6);
  });

  it("honors non-centered LocPin", () => {
    // LocPin at the top-left corner of a 2x1 rect.
    const cells = fakeCells({ PinX: 5, PinY: 5, LocPinX: 0, LocPinY: 1, Angle: 0 });
    const { matrix } = localTransform(cells);
    close(applyToPoint(matrix, pt(0, 1)), 5, 5);
    close(applyToPoint(matrix, pt(2, 0)), 7, 4);
  });

  it("applies FlipX before rotation in the documented order", () => {
    const cells = fakeCells({ PinX: 0, PinY: 0, LocPinX: 0, LocPinY: 0, Angle: Math.PI / 2, FlipX: 1 });
    const { matrix } = localTransform(cells);
    // T(-LocPin) is identity; FlipX then R90: (1,0) → (-1,0) → (0,-1).
    close(applyToPoint(matrix, pt(1, 0)), 0, -1);
  });

  it("reports approximated cells instead of silently defaulting", () => {
    const cells = fakeCells({ PinX: 5 });
    const { matrix, approximated } = localTransform(cells);
    expect(approximated.length).toBeGreaterThan(0);
    expect(approximated.join(" ")).toContain("PinY");
    close(applyToPoint(matrix, pt(0, 0)), 5, 0);
  });

  it("composes nested group transforms outermost-first", () => {
    const parent = translation(10, 0); // group at x=10
    const child = multiply(translation(0, 5), rotation(Math.PI)); // child rotated 180° at y=5
    const m = pageTransform([parent], child);
    // Local (1,0) → child: rotate → (-1,0) → +y5 → (-1,5) → parent → (9,5).
    close(applyToPoint(m, pt(1, 0)), 9, 5);
  });

  it("composes three nesting levels in the right order", () => {
    const l1 = translation(100, 0);
    const l2 = translation(10, 0);
    const l3 = translation(1, 0);
    const m = pageTransform([l1, l2], l3);
    close(applyToPoint(m, pt(0, 0)), 111, 0);
  });

  it("reads real DOM cell elements end to end", () => {
    const doc = parseXml(
      `<Shape><Cell N="PinX" V="5"/><Cell N="PinY" V="5"/><Cell N="LocPinX" V="1"/><Cell N="LocPinY" V="0.5"/><Cell N="Angle" V="1.5707963267948966"/></Shape>`,
      "s.xml",
    );
    const cells = cellElementMap(doc.documentElement);
    const { matrix } = localTransform(cells);
    close(applyToPoint(matrix, pt(0, 0)), 5.5, 4, 1e-6);
  });
});
