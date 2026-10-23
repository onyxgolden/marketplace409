import { describe, expect, it } from "vitest";
import {
  NOZZLE_NECK_LENGTH_IN,
  flangeComponent,
  flangeDims,
  flangeNominalSizeIn,
  nozzleComponent,
  pipeOdIn,
} from "./flangeGeometry";

// D0: the flange component model — one source of dimensions for the
// plan glyph, print, elevation, and 3D. Sizes follow the standard
// nominal-pipe-size series; a connection size snaps UP to the next
// listed nominal size, never down.
describe("flange geometry", () => {
  it("snaps a connection size up to the next nominal size", () => {
    expect(flangeNominalSizeIn(2)).toBe(2);
    expect(flangeNominalSizeIn(2.1)).toBe(2.5);
    expect(flangeNominalSizeIn(3)).toBe(3);
    expect(flangeNominalSizeIn(6)).toBe(6);
    expect(flangeNominalSizeIn(0)).toBe(2); // non-positive falls back to the smallest useful size
    expect(flangeNominalSizeIn(100)).toBe(16); // beyond the table: largest listed
  });

  it("gives real outside diameters and thicknesses per nominal size", () => {
    expect(flangeDims(2)).toEqual({ sizeIn: 2, odIn: 6, thicknessIn: 0.75 });
    expect(flangeDims(4)).toEqual({ sizeIn: 4, odIn: 9, thicknessIn: 1.19 });
    expect(flangeDims(12)).toEqual({ sizeIn: 12, odIn: 19, thicknessIn: 2 });
    expect(flangeDims(16)).toEqual({ sizeIn: 16, odIn: 23.5, thicknessIn: 2.19 });
    for (const size of [0.5, 1, 1.5, 2, 3, 6, 8, 10]) {
      const dims = flangeDims(size);
      expect(dims.odIn).toBeGreaterThan(dims.sizeIn);
      expect(dims.thicknessIn).toBeGreaterThan(0);
    }
  });

  it("pipe outside diameter comes from the standard OD table", () => {
    expect(pipeOdIn(2)).toBe(2.375);
    expect(pipeOdIn(4)).toBe(4.5);
    expect(pipeOdIn(6)).toBe(6.625);
    expect(pipeOdIn(12)).toBe(12.75);
    expect(pipeOdIn(16)).toBe(16);
  });

  it("flangeComponent is the shared descriptor every view renders", () => {
    const c = flangeComponent(8);
    expect(c).toEqual({ kind: "flange", sizeIn: 8, odIn: 13.5, thicknessIn: 1.62 });
  });

  it("nozzleComponent is a neck stub carrying a flange at its face", () => {
    const n = nozzleComponent(8);
    expect(n.kind).toBe("nozzle");
    expect(n.sizeIn).toBe(8);
    expect(n.neckOdIn).toBe(8.625);
    expect(n.neckLengthIn).toBe(NOZZLE_NECK_LENGTH_IN);
    expect(n.flange).toEqual(flangeComponent(8));
    expect(nozzleComponent(8, 12).neckLengthIn).toBe(12);
  });
});
