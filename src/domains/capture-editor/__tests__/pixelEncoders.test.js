import { describe, expect, it } from "vitest";
import { encodeBmp, encodeGif, encodeTiff } from "../pixelEncoders.js";

// 2x2 RGBA: red, green / blue, white (row-major, top-down)
function makeRgba() {
  return new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
}

describe("encodeBmp", () => {
  it("writes a valid 24-bit BMP header with BGR bottom-up pixels", () => {
    const bytes = encodeBmp(makeRgba(), 2, 2);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("BM");
    expect(view.getUint32(2, true)).toBe(bytes.length); // file size
    expect(view.getUint32(10, true)).toBe(54); // pixel offset
    expect(view.getInt32(18, true)).toBe(2); // width
    expect(view.getInt32(22, true)).toBe(2); // height
    expect(view.getUint16(28, true)).toBe(24); // bpp
    // row stride: 2px * 3 = 6 -> padded to 8; bottom-up so blue/white row first
    expect(bytes.length).toBe(54 + 8 * 2);
    const firstRow = 54;
    expect([bytes[firstRow], bytes[firstRow + 1], bytes[firstRow + 2]]).toEqual([255, 0, 0]); // blue -> BGR
    expect([bytes[firstRow + 3], bytes[firstRow + 4], bytes[firstRow + 5]]).toEqual([255, 255, 255]); // white
    expect([bytes[firstRow + 6], bytes[firstRow + 7]]).toEqual([0, 0]); // padding
  });

  it("rejects bad dimensions and byte lengths", () => {
    expect(() => encodeBmp(makeRgba(), 0, 2)).toThrow();
    expect(() => encodeBmp(new Uint8ClampedArray(4), 2, 2)).toThrow();
  });
});

describe("encodeGif", () => {
  it("writes a GIF89a file", () => {
    const bytes = encodeGif(makeRgba(), 2, 2);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 6)).toString("ascii")).toBe("GIF89a");
  });

  it("rejects bad inputs", () => {
    expect(() => encodeGif(makeRgba(), -1, 2)).toThrow();
    expect(() => encodeGif(new Uint8Array(3), 1, 1)).toThrow();
  });
});

describe("encodeTiff", () => {
  it("writes a TIFF file with a valid magic number", () => {
    const bytes = encodeTiff(makeRgba(), 2, 2);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const magic = Buffer.from(bytes.slice(0, 4)).toString("hex");
    // "II*\0" (little-endian) or "MM\0*" (big-endian)
    expect(["49492a00", "4d4d002a"]).toContain(magic);
  });

  it("rejects bad inputs", () => {
    expect(() => encodeTiff(makeRgba(), 2, 0)).toThrow();
    expect(() => encodeTiff(null, 2, 2)).toThrow();
  });
});
