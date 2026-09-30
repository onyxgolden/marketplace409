import { describe, expect, it } from "vitest";
import {
  DOOR_HANDLE_OFFSET_PX,
  ROTATION_HANDLE_GAP_PX,
  angleFromPointer,
  doorHandlePoints,
  doorSwingFrame,
  doorSwingOf,
  rotationHandlePoint,
} from "./designerHandles";

const close = (p, q) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

describe("doorSwingOf", () => {
  it("defaults a door with no stored swing to start hinge / positive face (the historic drawing)", () => {
    expect(doorSwingOf({ type: "door" })).toEqual({ hinge: "start", swing: "positive" });
  });
  it("reads stored values and ignores junk", () => {
    expect(doorSwingOf({ hinge: "end", swing: "negative" })).toEqual({ hinge: "end", swing: "negative" });
    expect(doorSwingOf({ hinge: "middle", swing: 7 })).toEqual({ hinge: "start", swing: "positive" });
  });
});

describe("doorSwingFrame", () => {
  // Wall along +x (plan, y-down). Positive normal = (dir.y, -dir.x) = (0, -1).
  const wall = { a: { x: 0, y: 0 }, b: { x: 120, y: 0 } };
  const base = { offsetIn: 24, widthIn: 36 };

  it("start / positive: hinge at the offset edge, leaf opens to the positive normal", () => {
    const f = doorSwingFrame(wall, base);
    close(f.hinge, { x: 24, y: 0 });
    close(f.latch, { x: 60, y: 0 });
    close(f.closedDir, { x: 1, y: 0 });
    close(f.openDir, { x: 0, y: -1 });
    expect(f.widthIn).toBe(36);
  });

  it("end hinge moves the hinge to the far edge; the leaf still opens to the same face", () => {
    const f = doorSwingFrame(wall, { ...base, hinge: "end" });
    close(f.hinge, { x: 60, y: 0 });
    close(f.latch, { x: 24, y: 0 });
    close(f.closedDir, { x: -1, y: 0 });
    close(f.openDir, { x: 0, y: -1 });
  });

  it("negative swing opens to the other face", () => {
    close(doorSwingFrame(wall, { ...base, swing: "negative" }).openDir, { x: 0, y: 1 });
  });

  it("follows the wall's angle", () => {
    const diag = { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } };
    const f = doorSwingFrame(diag, { offsetIn: 0, widthIn: 30 });
    const s = Math.SQRT1_2;
    close(f.closedDir, { x: s, y: s });
    close(f.openDir, { x: s, y: -s });
  });

  it("returns null for a zero-length wall", () => {
    expect(doorSwingFrame({ a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }, base)).toBeNull();
  });
});

describe("doorHandlePoints", () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 120, y: 0 } };
  it("puts the swing-flip handle on the opposite face and the hinge-flip handle past the latch", () => {
    const scale = 2; // px per inch
    const off = DOOR_HANDLE_OFFSET_PX / scale;
    const h = doorHandlePoints(doorSwingFrame(wall, { offsetIn: 24, widthIn: 36 }), scale);
    close(h.flipSwing, { x: 42, y: off }); // middle of the opening, negative face
    close(h.flipHinge, { x: 60 + off, y: -off }); // just past the latch, on the swing face
  });
});

describe("rotationHandlePoint", () => {
  it("sits above the piece (local up), a fixed screen gap beyond its edge", () => {
    const p = rotationHandlePoint({ x: 100, y: 100, depthIn: 40, rotationDeg: 0 }, 2);
    close(p, { x: 100, y: 100 - 20 - ROTATION_HANDLE_GAP_PX / 2 });
  });
  it("turns with the piece (clockwise degrees)", () => {
    const p = rotationHandlePoint({ x: 0, y: 0, depthIn: 20, rotationDeg: 90 }, 1);
    close(p, { x: 10 + ROTATION_HANDLE_GAP_PX, y: 0 });
  });
});

describe("angleFromPointer", () => {
  const c = { x: 0, y: 0 };
  it("measures clockwise from straight up", () => {
    expect(angleFromPointer(c, { x: 0, y: -10 })).toBe(0);
    expect(angleFromPointer(c, { x: 10, y: 0 })).toBe(90);
    expect(angleFromPointer(c, { x: 0, y: 10 })).toBe(180);
    expect(angleFromPointer(c, { x: -10, y: 0 })).toBe(270);
  });
  it("snaps to 15 degrees by default and 45 with the coarse option", () => {
    const p = { x: Math.sin((37 * Math.PI) / 180), y: -Math.cos((37 * Math.PI) / 180) };
    expect(angleFromPointer(c, p)).toBe(30);
    expect(angleFromPointer(c, p, { snapDeg: 45 })).toBe(45);
    expect(angleFromPointer(c, p, { snapDeg: 1 })).toBe(37);
  });
  it("normalizes into 0..359 and returns null when the pointer is on the centre", () => {
    const p = { x: -Math.sin((5 * Math.PI) / 180), y: -Math.cos((5 * Math.PI) / 180) }; // -5 deg
    expect(angleFromPointer(c, p, { snapDeg: 1 })).toBe(355);
    expect(angleFromPointer(c, p)).toBe(0); // -5 snaps to 0, never 360
    expect(angleFromPointer(c, { x: 0, y: 0 })).toBeNull();
  });
});
