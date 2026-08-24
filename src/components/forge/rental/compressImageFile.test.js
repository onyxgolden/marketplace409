import { describe, expect, it, vi } from "vitest";
import { compressImageFile } from "./compressImageFile";

function fakeCanvas(resultBlob) {
  return {
    width: 0, height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (resolve) => resolve(resultBlob),
  };
}

describe("compressImageFile", () => {
  it("passes through non-image files unchanged (e.g. a PDF)", async () => {
    const file = new File(["%PDF"], "survey.pdf", { type: "application/pdf" });
    const result = await compressImageFile(file);
    expect(result).toBe(file);
  });

  it("passes through a small image unchanged, without invoking the canvas at all", async () => {
    const file = new File(["x"], "small.jpg", { type: "image/jpeg" });
    const createBitmap = vi.fn();
    const createCanvas = vi.fn();
    const result = await compressImageFile(file, { createBitmap, createCanvas });
    expect(result).toBe(file);
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("downscales and re-encodes an oversized image as JPEG", async () => {
    const oversized = new File([new Uint8Array(3 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" });
    const compressedBlob = new Blob([new Uint8Array(500 * 1024)], { type: "image/jpeg" });
    const createBitmap = vi.fn().mockResolvedValue({ width: 4000, height: 3000 });
    const canvas = fakeCanvas(compressedBlob);
    const createCanvas = vi.fn(() => canvas);

    const result = await compressImageFile(oversized, { createBitmap, createCanvas });

    expect(createBitmap).toHaveBeenCalledWith(oversized);
    expect(canvas.width).toBe(2000); // max dimension, scaled down from 4000x3000 keeping aspect
    expect(canvas.height).toBe(1500);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("photo.jpg");
    expect(result.size).toBe(compressedBlob.size);
  });

  it("keeps the original file if compression didn't actually shrink it", async () => {
    const original = new File([new Uint8Array(3 * 1024 * 1024)], "photo.png", { type: "image/png" });
    const largerBlob = new Blob([new Uint8Array(4 * 1024 * 1024)], { type: "image/jpeg" });
    const createBitmap = vi.fn().mockResolvedValue({ width: 1000, height: 1000 });
    const createCanvas = vi.fn(() => fakeCanvas(largerBlob));
    const result = await compressImageFile(original, { createBitmap, createCanvas });
    expect(result).toBe(original);
  });

  it("falls back to the original file if the browser can't compress it", async () => {
    const oversized = new File([new Uint8Array(3 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" });
    const createBitmap = vi.fn().mockRejectedValue(new Error("createImageBitmap unsupported"));
    const result = await compressImageFile(oversized, { createBitmap, createCanvas: vi.fn() });
    expect(result).toBe(oversized);
  });
});
