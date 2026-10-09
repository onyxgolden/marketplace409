// Tests for forge-capture-app/ui/process-guide-background.js -- Slice B's
// pure background/overlay validation, fit math, and in-memory store.
// No DOM, no real image decode -- every "decoded" record here is a fake
// {url, bitmap, width, height} the tests construct directly, exactly as
// process-training.js's own wiring would hand the store after a real
// browser decode.

import { describe, it, expect } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_DECODED_PIXELS,
  MAX_DIMENSION_PX,
  MAX_OVERLAYS_PER_STEP,
  MAX_AGGREGATE_PIXELS_PER_STEP,
  BackgroundImageError,
  sniffImageType,
  validateCandidateBytes,
  validateDecodedDimensions,
  computeContainFit,
  GuideBackgroundStore,
} from "../process-guide-background.js";

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
const GARBAGE_HEADER = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function fakeDecoded(width, height, label = "img") {
  return { url: `blob:${label}`, bitmap: { width, height, closed: false }, width, height };
}

describe("sniffImageType -- magic-byte sniffing, never extension/MIME", () => {
  it("recognizes a real PNG signature", () => {
    expect(sniffImageType(PNG_HEADER)).toBe("png");
  });

  it("recognizes a real JPEG signature", () => {
    expect(sniffImageType(JPEG_HEADER)).toBe("jpeg");
  });

  it("rejects a PDF with its own specific, distinguishing error -- never silently accepted, never lumped in with a truly unrecognized file", () => {
    let caught;
    try {
      sniffImageType(PDF_HEADER);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackgroundImageError);
    expect(caught.code).toBe("pdf-not-supported");
  });

  it("rejects a GIF and other unrecognized signatures as generic unsupported-type (distinct from the PDF case)", () => {
    expect(() => sniffImageType(GIF_HEADER)).toThrow(BackgroundImageError);
    try {
      sniffImageType(GIF_HEADER);
    } catch (e) {
      expect(e.code).toBe("unsupported-type");
    }
    expect(() => sniffImageType(GARBAGE_HEADER)).toThrow(BackgroundImageError);
  });

  it("accepts a plain ArrayBuffer as well as a Uint8Array", () => {
    expect(sniffImageType(PNG_HEADER.buffer)).toBe("png");
  });

  it("rejects a PNG-claiming file whose actual bytes are a PDF (MIME/extension spoofing) -- sniffing is byte-based, not label-based", () => {
    // The caller might claim this came from a "plan.png" file picker
    // selection with MIME "image/png" -- this function never looks at
    // either; only the real bytes decide.
    expect(() => sniffImageType(PDF_HEADER)).toThrow(BackgroundImageError);
  });
});

describe("validateCandidateBytes -- pre-decode size + signature gate", () => {
  it("accepts a reasonably sized real PNG header", () => {
    expect(validateCandidateBytes(1024, PNG_HEADER)).toBe("png");
  });

  it("rejects an empty or non-finite byte length", () => {
    expect(() => validateCandidateBytes(0, PNG_HEADER)).toThrow(BackgroundImageError);
    expect(() => validateCandidateBytes(NaN, PNG_HEADER)).toThrow(BackgroundImageError);
    expect(() => validateCandidateBytes(-5, PNG_HEADER)).toThrow(BackgroundImageError);
  });

  it("rejects a file over the 20 MiB cap, even with a valid signature", () => {
    expect(() => validateCandidateBytes(MAX_FILE_BYTES + 1, PNG_HEADER)).toThrow(BackgroundImageError);
  });

  it("accepts a file exactly at the cap", () => {
    expect(() => validateCandidateBytes(MAX_FILE_BYTES, PNG_HEADER)).not.toThrow();
  });

  it("rejects an unsupported signature even at a trivially small size", () => {
    expect(() => validateCandidateBytes(8, GARBAGE_HEADER)).toThrow(BackgroundImageError);
  });
});

describe("validateDecodedDimensions -- post-decode gate", () => {
  it("accepts ordinary decoded dimensions", () => {
    expect(validateDecodedDimensions(1000, 800)).toBe(800000);
  });

  it("fails closed on non-finite, zero, or negative dimensions (a failed/garbage decode)", () => {
    expect(() => validateDecodedDimensions(NaN, 100)).toThrow(BackgroundImageError);
    expect(() => validateDecodedDimensions(100, 0)).toThrow(BackgroundImageError);
    expect(() => validateDecodedDimensions(-10, 100)).toThrow(BackgroundImageError);
  });

  it("rejects a dimension over the 10000px cap even if total pixels would be under the pixel cap", () => {
    expect(() => validateDecodedDimensions(MAX_DIMENSION_PX + 1, 10)).toThrow(BackgroundImageError);
    expect(() => validateDecodedDimensions(10, MAX_DIMENSION_PX + 1)).toThrow(BackgroundImageError);
  });

  it("accepts exactly the maximum dimension", () => {
    expect(() => validateDecodedDimensions(MAX_DIMENSION_PX, 1)).not.toThrow();
  });

  it("rejects a decode whose total pixel count exceeds the 20-megapixel cap", () => {
    // 5000 x 5000 = 25,000,000 > MAX_DECODED_PIXELS, and both dimensions
    // individually stay under MAX_DIMENSION_PX -- isolates the pixel
    // check from the per-dimension check.
    expect(5000 * 5000).toBeGreaterThan(MAX_DECODED_PIXELS);
    expect(() => validateDecodedDimensions(5000, 5000)).toThrow(BackgroundImageError);
  });

  it("accepts a decode exactly at the pixel cap", () => {
    // 5000 x 4000 = 20,000,000 exactly, and both dimensions individually
    // stay under MAX_DIMENSION_PX (unlike MAX_DECODED_PIXELS x 1, which
    // would trip the per-dimension cap instead).
    expect(5000 * 4000).toBe(MAX_DECODED_PIXELS);
    expect(() => validateDecodedDimensions(5000, 4000)).not.toThrow();
  });
});

describe("computeContainFit -- deterministic aspect-preserving letterbox", () => {
  it("is pure/deterministic -- same inputs always produce the same output", () => {
    expect(computeContainFit(1000, 500, 640, 480)).toEqual(computeContainFit(1000, 500, 640, 480));
  });

  it("never stretches a wider-than-canvas-aspect image -- width-limited, centered vertically", () => {
    // scale = min(640/1000, 480/500) = min(0.64, 0.96) = 0.64 -- width is
    // the binding constraint here, so the blank margin is top/bottom.
    const fit = computeContainFit(1000, 500, 640, 480);
    expect(fit.w).toBeCloseTo(640);
    expect(fit.h).toBeCloseTo(320);
    expect(fit.x).toBe(0);
    expect(fit.y).toBeCloseTo((480 - 320) / 2);
  });

  it("never stretches a taller-than-canvas-aspect image -- height-limited, centered horizontally", () => {
    // scale = min(640/500, 480/1000) = min(1.28, 0.48) = 0.48 -- height
    // is the binding constraint here, so the blank margin is left/right.
    const fit = computeContainFit(500, 1000, 640, 480);
    expect(fit.w).toBeCloseTo(240);
    expect(fit.h).toBeCloseTo(480);
    expect(fit.x).toBeCloseTo((640 - 240) / 2);
    expect(fit.y).toBe(0);
  });

  it("never exceeds the destination rectangle in either dimension", () => {
    for (const [srcW, srcH] of [[100, 100], [4608, 3456], [20, 2000], [2000, 20]]) {
      const fit = computeContainFit(srcW, srcH, 640, 480);
      expect(fit.x).toBeGreaterThanOrEqual(0);
      expect(fit.y).toBeGreaterThanOrEqual(0);
      expect(fit.x + fit.w).toBeLessThanOrEqual(640 + 1e-9);
      expect(fit.y + fit.h).toBeLessThanOrEqual(480 + 1e-9);
    }
  });

  it("fits an image with the exact same aspect ratio flush to both edges, with no blank margin", () => {
    const fit = computeContainFit(640, 480, 640, 480);
    expect(fit).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });

  it("fails closed on non-finite or non-positive inputs", () => {
    expect(() => computeContainFit(0, 100, 640, 480)).toThrow(BackgroundImageError);
    expect(() => computeContainFit(100, 100, NaN, 480)).toThrow(BackgroundImageError);
    expect(() => computeContainFit(-1, 100, 640, 480)).toThrow(BackgroundImageError);
  });
});

describe("GuideBackgroundStore -- background lifecycle", () => {
  const canvas640 = { id: "legacy", orientation: null, width: 640, height: 480 };

  it("a step with no background yet returns null, not an error", () => {
    const store = new GuideBackgroundStore();
    expect(store.backgroundFor(1)).toBeNull();
    expect(store.hasContentFor(1)).toBe(false);
  });

  it("setBackground stores the decoded record with a computed fit and canvas stamp", () => {
    const store = new GuideBackgroundStore();
    store.setBackground(1, fakeDecoded(1280, 960, "plan"), canvas640);
    const bg = store.backgroundFor(1);
    expect(bg.width).toBe(1280);
    expect(bg.height).toBe(960);
    expect(bg.canvasId).toBe("legacy:");
    expect(bg.w).toBeCloseTo(640);
    expect(bg.h).toBeCloseTo(480);
    expect(store.hasContentFor(1)).toBe(true);
  });

  it("backgroundFor returns a copy, not a live reference", () => {
    const store = new GuideBackgroundStore();
    store.setBackground(1, fakeDecoded(100, 100), canvas640);
    const bg = store.backgroundFor(1);
    bg.width = 999999;
    expect(store.backgroundFor(1).width).toBe(100);
  });

  it("fails closed on a decode with invalid dimensions, without storing anything", () => {
    const store = new GuideBackgroundStore();
    expect(() => store.setBackground(1, fakeDecoded(NaN, 100), canvas640)).toThrow(BackgroundImageError);
    expect(store.backgroundFor(1)).toBeNull();
  });

  it("replacing a background revokes the old one's object URL", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    store.setBackground(1, fakeDecoded(100, 100, "first"), canvas640);
    store.setBackground(1, fakeDecoded(200, 200, "second"), canvas640);
    expect(revoked).toContain("blob:first");
    expect(store.backgroundFor(1).url).toBe("blob:second");
  });

  it("replacing a background also clears and revokes every existing overlay", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    store.setBackground(1, fakeDecoded(100, 100, "bg1"), canvas640);
    store.addOverlay(1, fakeDecoded(50, 50, "ov1"), canvas640);
    store.setBackground(1, fakeDecoded(100, 100, "bg2"), canvas640);
    expect(revoked).toEqual(expect.arrayContaining(["blob:bg1", "blob:ov1"]));
    expect(store.overlaysFor(1)).toEqual([]);
  });

  it("clearBackground revokes the background and every overlay, and is a no-op (not an error) when there is none", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    store.setBackground(1, fakeDecoded(100, 100, "bg"), canvas640);
    store.addOverlay(1, fakeDecoded(50, 50, "ov"), canvas640);
    store.clearBackground(1);
    expect(revoked).toEqual(expect.arrayContaining(["blob:bg", "blob:ov"]));
    expect(store.backgroundFor(1)).toBeNull();
    expect(store.overlaysFor(1)).toEqual([]);
    expect(() => store.clearBackground(1)).not.toThrow();
  });

  it("per-step isolation: setting step 1's background never affects step 2", () => {
    const store = new GuideBackgroundStore();
    store.setBackground(1, fakeDecoded(100, 100), canvas640);
    expect(store.backgroundFor(2)).toBeNull();
    expect(store.hasContentFor(2)).toBe(false);
  });
});

describe("GuideBackgroundStore -- overlay lifecycle", () => {
  const canvas640 = { id: "legacy", orientation: null, width: 640, height: 480 };

  it("addOverlay returns a stable id and stores a fit+stamp just like a background", () => {
    const store = new GuideBackgroundStore();
    const id = store.addOverlay(1, fakeDecoded(200, 100, "ov"), canvas640);
    expect(typeof id).toBe("string");
    const overlays = store.overlaysFor(1);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].id).toBe(id);
    expect(overlays[0].canvasId).toBe("legacy:");
  });

  it("overlaysFor returns copies, not live references", () => {
    const store = new GuideBackgroundStore();
    store.addOverlay(1, fakeDecoded(100, 100), canvas640);
    const overlays = store.overlaysFor(1);
    overlays[0].width = 999999;
    expect(store.overlaysFor(1)[0].width).toBe(100);
  });

  it("enforces the 8-overlay-per-step cap, rejecting the 9th without disturbing the existing 8", () => {
    const store = new GuideBackgroundStore();
    for (let i = 0; i < MAX_OVERLAYS_PER_STEP; i++) {
      store.addOverlay(1, fakeDecoded(10, 10, `ov${i}`), canvas640);
    }
    expect(store.overlaysFor(1)).toHaveLength(MAX_OVERLAYS_PER_STEP);
    expect(() => store.addOverlay(1, fakeDecoded(10, 10, "ov-ninth"), canvas640)).toThrow(BackgroundImageError);
    expect(store.overlaysFor(1)).toHaveLength(MAX_OVERLAYS_PER_STEP); // unchanged
  });

  it("enforces the 40-megapixel aggregate budget across background + overlays, rejecting an over-budget addition without disturbing existing content", () => {
    const store = new GuideBackgroundStore();
    // Background alone: 6000 x 6000 = 36,000,000 px (under the 40M aggregate cap, and under the 20M-per-file cap? no -- let's use per-overlay-sized pieces instead, since a single file is still capped at 20M pixels individually)
    store.setBackground(1, fakeDecoded(4000, 4000, "bg"), canvas640); // 16,000,000 px
    store.addOverlay(1, fakeDecoded(4000, 4000, "ov1"), canvas640); // +16,000,000 = 32,000,000
    expect(() => store.addOverlay(1, fakeDecoded(3000, 3000, "ov-over"), canvas640)).toThrow(BackgroundImageError); // +9,000,000 = 41,000,000 > 40,000,000
    expect(store.overlaysFor(1)).toHaveLength(1); // the rejected one never got added
  });

  it("each individual overlay is still independently capped by MAX_DECODED_PIXELS/MAX_DIMENSION_PX regardless of aggregate budget headroom", () => {
    const store = new GuideBackgroundStore();
    expect(() => store.addOverlay(1, fakeDecoded(MAX_DIMENSION_PX + 1, 10), canvas640)).toThrow(BackgroundImageError);
  });

  it("updateOverlayPlacement accepts a valid in-bounds placement and rejects one that would extend outside the canvas, without mutating on rejection", () => {
    const store = new GuideBackgroundStore();
    const id = store.addOverlay(1, fakeDecoded(100, 100), canvas640);
    store.updateOverlayPlacement(1, id, { x: 10, y: 10, w: 50, h: 50 }, canvas640);
    expect(store.overlaysFor(1)[0]).toMatchObject({ x: 10, y: 10, w: 50, h: 50 });

    expect(() =>
      store.updateOverlayPlacement(1, id, { x: 600, y: 10, w: 50, h: 50 }, canvas640)
    ).toThrow(BackgroundImageError);
    expect(store.overlaysFor(1)[0]).toMatchObject({ x: 10, y: 10, w: 50, h: 50 }); // unchanged
  });

  it("updateOverlayPlacement fails closed on non-finite or non-positive dimensions", () => {
    const store = new GuideBackgroundStore();
    const id = store.addOverlay(1, fakeDecoded(100, 100), canvas640);
    expect(() => store.updateOverlayPlacement(1, id, { x: 0, y: 0, w: 0, h: 50 }, canvas640)).toThrow(BackgroundImageError);
    expect(() => store.updateOverlayPlacement(1, id, { x: NaN, y: 0, w: 10, h: 50 }, canvas640)).toThrow(BackgroundImageError);
  });

  it("updateOverlayPlacement fails closed on an unknown overlay id", () => {
    const store = new GuideBackgroundStore();
    expect(() => store.updateOverlayPlacement(1, "not-real", { x: 0, y: 0, w: 10, h: 10 }, canvas640)).toThrow(
      BackgroundImageError
    );
  });

  it("updateOverlayPlacement fails closed if the overlay's stamped canvas no longer matches the one passed in (defensive, otherwise-unreachable invariant)", () => {
    const store = new GuideBackgroundStore();
    const id = store.addOverlay(1, fakeDecoded(100, 100), canvas640);
    const otherCanvas = { id: "ansi_b", orientation: "landscape", width: 1632, height: 1056 };
    expect(() => store.updateOverlayPlacement(1, id, { x: 0, y: 0, w: 10, h: 10 }, otherCanvas)).toThrow(
      BackgroundImageError
    );
  });

  it("moveOverlayForward/Backward swap adjacent z-order positions and are a no-op at either end", () => {
    const store = new GuideBackgroundStore();
    const a = store.addOverlay(1, fakeDecoded(10, 10, "a"), canvas640);
    const b = store.addOverlay(1, fakeDecoded(10, 10, "b"), canvas640);
    const c = store.addOverlay(1, fakeDecoded(10, 10, "c"), canvas640);
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([a, b, c]);

    store.moveOverlayForward(1, a);
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([b, a, c]);

    store.moveOverlayBackward(1, c);
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([b, c, a]);

    // No-ops at the ends:
    store.moveOverlayForward(1, a); // a is already frontmost (last)
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([b, c, a]);
    store.moveOverlayBackward(1, b); // b is already backmost (first)
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([b, c, a]);
  });

  it("moveOverlayForward/Backward fail closed on an unknown overlay id", () => {
    const store = new GuideBackgroundStore();
    expect(() => store.moveOverlayForward(1, "nope")).toThrow(BackgroundImageError);
    expect(() => store.moveOverlayBackward(1, "nope")).toThrow(BackgroundImageError);
  });

  it("removeOverlay revokes its resource and removes only that overlay; fails closed on an unknown id", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    const a = store.addOverlay(1, fakeDecoded(10, 10, "a"), canvas640);
    const b = store.addOverlay(1, fakeDecoded(10, 10, "b"), canvas640);
    store.removeOverlay(1, a);
    expect(revoked).toEqual(["blob:a"]);
    expect(store.overlaysFor(1).map((o) => o.id)).toEqual([b]);
    expect(() => store.removeOverlay(1, a)).toThrow(BackgroundImageError); // already gone
  });

  it("per-step isolation: step 1's overlays never leak into step 2's, and an immutable sequenceId key keeps content attached correctly", () => {
    const store = new GuideBackgroundStore();
    store.addOverlay(1, fakeDecoded(10, 10, "s1"), canvas640);
    store.addOverlay(2, fakeDecoded(10, 10, "s2"), canvas640);
    expect(store.overlaysFor(1)).toHaveLength(1);
    expect(store.overlaysFor(2)).toHaveLength(1);
    expect(store.overlaysFor(1)[0].url).toBe("blob:s1");
    expect(store.overlaysFor(2)[0].url).toBe("blob:s2");
  });
});

describe("GuideBackgroundStore -- clearStep/clearAll", () => {
  const canvas640 = { id: "legacy", orientation: null, width: 640, height: 480 };

  it("clearStep revokes everything for that step only, leaving other steps untouched", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    store.setBackground(1, fakeDecoded(10, 10, "bg1"), canvas640);
    store.addOverlay(1, fakeDecoded(10, 10, "ov1"), canvas640);
    store.setBackground(2, fakeDecoded(10, 10, "bg2"), canvas640);
    store.clearStep(1);
    expect(revoked).toEqual(expect.arrayContaining(["blob:bg1", "blob:ov1"]));
    expect(revoked).not.toContain("blob:bg2");
    expect(store.backgroundFor(1)).toBeNull();
    expect(store.backgroundFor(2)).not.toBeNull();
  });

  it("clearAll revokes every step's background and overlays", () => {
    const revoked = [];
    const store = new GuideBackgroundStore({ revokeObjectURL: (url) => revoked.push(url) });
    store.setBackground(1, fakeDecoded(10, 10, "bg1"), canvas640);
    store.addOverlay(2, fakeDecoded(10, 10, "ov2"), canvas640);
    store.clearAll();
    expect(revoked).toEqual(expect.arrayContaining(["blob:bg1", "blob:ov2"]));
    expect(store.backgroundFor(1)).toBeNull();
    expect(store.overlaysFor(2)).toEqual([]);
  });
});

describe("GuideBackgroundStore -- malformed sequenceId fails closed", () => {
  it("rejects a non-integer or negative sequenceId", () => {
    const store = new GuideBackgroundStore();
    expect(() => store.backgroundFor(1.5)).toThrow(BackgroundImageError);
    expect(() => store.backgroundFor(-1)).toThrow(BackgroundImageError);
    expect(() => store.backgroundFor("1")).toThrow(BackgroundImageError);
  });
});

describe("structural guarantee -- no capture, no IPC, no persistence, no network, no DOM/HTML work", () => {
  it("process-guide-background.js never references invoke(), the real session commands, storage, filesystem, network fetch, or innerHTML", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-background.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\s*[.(]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/writeFile|readFile|require\(["']fs["']\)|from ["']fs["']/);
    expect(source).not.toMatch(/\.innerHTML\s*[=.]/);
  });
});
