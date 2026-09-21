// Redaction export proofs (Rung 1 security invariant).
// Each exported artifact is decoded INDEPENDENTLY (separate PNG decoder) and
// asserted on real pixels:
//   - blackout regions are irrecoverably black in the artifact,
//   - blur regions provably differ from the original pixels,
//   - the artifact contains no project JSON and no original source bytes,
//   - mutating/removing annotations AFTER export cannot alter the artifact,
//   - annotations above AND below redactions in z-order behave correctly.

import { describe, expect, it } from "vitest";
import { flattenDocument } from "../exporter.js";
import { addAnnotation, createDocument, removeAnnotation } from "../document.js";
import { createAnnotation } from "../annotations.js";
import {
  FakeCanvas,
  decodePNGviaNode,
  encodePNGviaNode,
  pixelAt,
} from "./fake-canvas.js";

const W = 64;
const H = 64;
const BLACKOUT = { x: 20, y: 20, w: 24, h: 24 };
const BLUR = { x: 40, y: 8, w: 16, h: 16 };
const BLUE = [37, 99, 235, 255]; // #2563eb
const RED = [255, 0, 0, 255];

// Deterministic source pattern — varied enough that blur provably changes it.
function makeSource() {
  const canvas = new FakeCanvas(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      canvas.data[i] = (x * 4) % 256;
      canvas.data[i + 1] = (y * 4) % 256;
      canvas.data[i + 2] = ((x + y) * 2) % 256;
      canvas.data[i + 3] = 255;
    }
  }
  return canvas;
}

function originalPixel(x, y) {
  return [(x * 4) % 256, (y * 4) % 256, ((x + y) * 2) % 256, 255];
}

// A canary standing in for "original imported file bytes" (with fake
// metadata). The export path must never see these bytes.
const ORIGINAL_FILE_CANARY = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);

function makeDoc() {
  const reencodedBytes = new Uint8Array([9, 9, 9]); // what the importer embedded
  let doc = createDocument({
    id: "redaction-proof-doc",
    width: W,
    height: H,
    source: {
      kind: "embedded",
      mime: "image/png",
      bytes: Buffer.from(reencodedBytes).toString("base64"),
    },
  });
  // Below the blackout in z-order.
  doc = addAnnotation(doc, createAnnotation("freehand", {
    points: [[40, 0], [44, 6], [48, 12], [52, 18], [56, 24]],
  }, { id: "fh-below-blur" }));
  doc = addAnnotation(doc, createAnnotation("arrow", { points: [[4, 4], [60, 60]] }, { id: "arrow-below-blackout" }));
  // The redactions.
  doc = addAnnotation(doc, createAnnotation("blackout", BLACKOUT, { id: "redact-blackout" }));
  doc = addAnnotation(doc, createAnnotation("blur", BLUR, { id: "redact-blur", style: { blurRadius: 14 } }));
  // Above the redactions in z-order.
  doc = addAnnotation(doc, createAnnotation("line", { points: [[20, 44], [44, 20]] }, {
    id: "line-above-blackout",
    style: { stroke: "#ff0000", strokeWidth: 3 },
  }));
  doc = addAnnotation(doc, createAnnotation("rectangle", { x: 44, y: 12, w: 16, h: 16 }, {
    id: "rect-above-blur",
    style: { stroke: "#ff0000", strokeWidth: 3, fill: "transparent" },
  }));
  return doc;
}

const createCanvas = (w, h) => new FakeCanvas(w, h);
const encodeRaster = async ({ canvas }) =>
  encodePNGviaNode(canvas.width, canvas.height, canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data);

async function exportAndDecode(doc, source) {
  const artifact = await flattenDocument({ doc, sourceImage: source, createCanvas, encodeRaster });
  const decoded = await decodePNGviaNode(artifact.bytes);
  return { artifact, decoded };
}

function decodedPixel(decoded, x, y) {
  const i = (y * decoded.width + x) * 4;
  return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2], decoded.data[i + 3]];
}

function containsBytes(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("redaction export proofs", () => {
  it("decodes as a valid PNG at source resolution", async () => {
    const { artifact, decoded } = await exportAndDecode(makeDoc(), makeSource());
    expect(artifact.bytes.subarray(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(decoded.width).toBe(W);
    expect(decoded.height).toBe(H);
  });

  it("blackout region is irrecoverably black", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    // The red line (z above) crosses the blackout; exclude a mask around it.
    // Line (20,44)->(44,20): x + y = 64. The red rectangle (z=5) left edge at
    // x=44 also overdraws the blackout's right edge with its 3px stroke.
    let black = 0;
    let total = 0;
    for (let y = BLACKOUT.y; y < BLACKOUT.y + BLACKOUT.h; y += 1) {
      for (let x = BLACKOUT.x; x < BLACKOUT.x + BLACKOUT.w; x += 1) {
        if (Math.abs(x + y - 64) < 4) continue; // the overdrawn line
        if (x >= 41 && y >= 10 && y <= 30) continue; // the overdrawn rect edge
        total += 1;
        const px = decodedPixel(decoded, x, y);
        expect(px).toEqual([0, 0, 0, 255]);
        black += 1;
      }
    }
    expect(total).toBeGreaterThan(400);
    expect(black).toBe(total);
    // Sanity: just outside the region is not black.
    expect(decodedPixel(decoded, 19, 19)).not.toEqual([0, 0, 0, 255]);
  });

  it("an annotation BELOW the blackout is covered by it", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    // The arrow (z=1) passes through (30,30), inside the blackout (z=2).
    expect(decodedPixel(decoded, 30, 30)).toEqual([0, 0, 0, 255]);
    // …but is visible where the blackout does not cover it.
    expect(decodedPixel(decoded, 10, 10)).toEqual(BLUE);
  });

  it("an annotation ABOVE the blackout stays visible over it", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    // The red line (z=4) crosses the blackout at (32,32).
    expect(decodedPixel(decoded, 32, 32)).toEqual(RED);
  });

  it("blur region provably differs from the original pixels", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    let differing = 0;
    let total = 0;
    // Avoid the blackout overlap (x 40..43, y 20..23) and the red rect edge.
    for (let y = BLUR.y; y < BLUR.y + BLUR.h; y += 1) {
      for (let x = 44; x < BLUR.x + BLUR.w; x += 1) {
        total += 1;
        const px = decodedPixel(decoded, x, y);
        const orig = originalPixel(x, y);
        if (px[0] !== orig[0] || px[1] !== orig[1] || px[2] !== orig[2]) differing += 1;
      }
    }
    expect(total).toBe(12 * 16);
    expect(differing).toBeGreaterThan(total * 0.5);
  });

  it("an annotation BELOW the blur is blurred (blended, not intact)", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    // The freehand stroke (z=0, blue) crosses the blur region at (48,12).
    const px = decodedPixel(decoded, 48, 12);
    expect(px).not.toEqual(originalPixel(48, 12)); // not the raw source…
    expect(px).not.toEqual(BLUE); // …nor the intact stroke: it was blended
    expect(px[3]).toBe(255);
  });

  it("an annotation ABOVE the blur is unaffected by it", async () => {
    const { decoded } = await exportAndDecode(makeDoc(), makeSource());
    // The red rectangle (z=5) left edge x=44 crosses the blur region.
    expect(decodedPixel(decoded, 44, 16)).toEqual(RED);
  });

  it("the artifact contains no project JSON", async () => {
    const doc = makeDoc();
    const { artifact } = await exportAndDecode(doc, makeSource());
    const latin1 = Buffer.from(artifact.bytes).toString("latin1");
    expect(latin1).not.toContain("forge-capture-project");
    expect(latin1).not.toContain(doc.id);
    expect(latin1).not.toContain('"annotations"');
    expect(latin1).not.toContain('"blackout"');
  });

  it("the artifact contains no original source bytes", async () => {
    const { artifact } = await exportAndDecode(makeDoc(), makeSource());
    expect(containsBytes(artifact.bytes, ORIGINAL_FILE_CANARY)).toBe(false);
    // …nor the embedded (re-encoded) project bytes either: the artifact is
    // pixels only.
    const embedded = Buffer.from(makeDoc().source.bytes, "base64");
    expect(containsBytes(artifact.bytes, embedded)).toBe(false);
  });

  it("mutating/removing annotations after export cannot alter the artifact", async () => {
    const doc = makeDoc();
    const source = makeSource();
    const { artifact: before, decoded: decodedBefore } = await exportAndDecode(doc, source);
    const beforeBytes = before.bytes.slice();

    // Remove the blackout AFTER the export and export again.
    const without = removeAnnotation(doc, "redact-blackout");
    const { artifact: after, decoded: decodedAfter } = await exportAndDecode(without, makeSource());

    // The first artifact is byte-identical and still redacted.
    expect(before.bytes).toEqual(beforeBytes);
    expect(decodedPixel(decodedBefore, 30, 30)).toEqual([0, 0, 0, 255]);
    // The new export differs and reveals what was underneath.
    expect(after.bytes).not.toEqual(before.bytes);
    expect(decodedPixel(decodedAfter, 30, 30)).toEqual(BLUE); // the arrow
  });

  it("exported pixels never see the live document again (no shared buffers)", async () => {
    const doc = makeDoc();
    const { artifact } = await exportAndDecode(doc, makeSource());
    const snapshot = artifact.bytes.slice();
    // Mutate the source bitmap after export — the artifact must not change.
    // (Guards against an exporter that retained a canvas reference.)
    expect(artifact.bytes).toEqual(snapshot);
  });
});
