// pdfClassifier.test.js — geometry-only classification.
//
// A PDF carries no semantics, so the classifier's job is NOT to recognize
// walls: it is to transcribe visible geometry into editable segments and to
// filter only what can be filtered honestly (dashed drafting conventions,
// sub-threshold noise, degenerate geometry).

import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_DEFAULTS,
  DEFAULT_MIN_SEGMENT_IN,
  MIN_WALL_LENGTH_IN,
  INCIDENTAL_SEGMENT_LIMIT,
  classifyPageKind,
  classifyPath,
} from "./pdfClassifier";

const strokedPath = (points, extra = {}) => ({
  polylines: [{ points, closed: false }],
  stroked: true,
  filled: false,
  dashed: false,
  lineWidthIn: 0.02,
  ...extra,
});

describe("classifyPath", () => {
  it("turns a stroked polyline into wall segments", () => {
    const result = classifyPath(strokedPath([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }]));
    expect(result.kind).toBe("wall");
    expect(result.detail.segments).toHaveLength(2);
    expect(result.detail.segments[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 120, y: 0 } });
  });

  it("re-adds the closing edge of a closed subpath", () => {
    // A closed triangle stores 3 points but has 3 edges.
    const result = classifyPath({
      polylines: [{ points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }], closed: true }],
      stroked: true, filled: false, dashed: false,
    });
    expect(result.detail.segments).toHaveLength(3);
    const last = result.detail.segments[2];
    expect(last.a).toEqual({ x: 120, y: 120 });
    expect(last.b).toEqual({ x: 0, y: 0 });
  });

  it("skips dashed strokes by default and explains why", () => {
    const result = classifyPath(strokedPath([{ x: 0, y: 0 }, { x: 120, y: 0 }], { dashed: true }));
    expect(result.kind).toBe("skipped");
    expect(result.reason).toMatch(/dashed/);
  });

  it("keeps dashed strokes when the user opts in", () => {
    const result = classifyPath(
      strokedPath([{ x: 0, y: 0 }, { x: 120, y: 0 }], { dashed: true }),
      { includeDashed: true },
    );
    expect(result.kind).toBe("wall");
  });

  it("transcribes a filled region's outline and marks its origin", () => {
    const result = classifyPath({
      polylines: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }, { x: 0, y: 5 }], closed: true }],
      stroked: false, filled: true, dashed: false,
    });
    expect(result.kind).toBe("wall");
    expect(result.detail.fromFill).toBe(true);
    expect(result.reason).toMatch(/filled outline/);
  });

  it("can exclude filled regions entirely", () => {
    const result = classifyPath(
      { polylines: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }], stroked: false, filled: true, dashed: false },
      { includeFilledOutlines: false },
    );
    expect(result.kind).toBe("skipped");
    expect(result.reason).toMatch(/filled region/);
  });

  it("drops segments under the length floor and counts them", () => {
    const result = classifyPath(
      strokedPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 121, y: 0 }]),
      { minSegmentIn: 12 },
    );
    expect(result.kind).toBe("wall");
    expect(result.detail.segments).toHaveLength(1);
    expect(result.detail.droppedShort).toBe(1);
  });

  it("skips a path whose every segment is noise, naming the threshold", () => {
    const result = classifyPath(strokedPath([{ x: 0, y: 0 }, { x: 0.5, y: 0 }]), { minSegmentIn: 12 });
    expect(result.kind).toBe("skipped");
    expect(result.reason).toMatch(/shorter than the 12/);
    expect(result.reason).toMatch(/1 dropped/);
  });

  it("never emits a segment the document model would reject", () => {
    // Asking for a floor below the model's 1-inch minimum must not lower it.
    const result = classifyPath(
      strokedPath([{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 40, y: 0 }]),
      { minSegmentIn: 0 },
    );
    for (const segment of result.detail.segments) {
      expect(segment.lengthIn).toBeGreaterThanOrEqual(MIN_WALL_LENGTH_IN);
    }
  });

  it("skips a path with no drawable geometry", () => {
    expect(classifyPath(null).kind).toBe("skipped");
    expect(classifyPath({ polylines: [] }).kind).toBe("skipped");
    expect(classifyPath({ polylines: [{ points: [{ x: 1, y: 1 }] }], stroked: true }).kind).toBe("skipped");
  });

  it("defaults the length floor to a value that filters hatching", () => {
    expect(CLASSIFIER_DEFAULTS.minSegmentIn).toBe(DEFAULT_MIN_SEGMENT_IN);
    expect(DEFAULT_MIN_SEGMENT_IN).toBeGreaterThan(MIN_WALL_LENGTH_IN);
    expect(CLASSIFIER_DEFAULTS.includeDashed).toBe(false);
  });
});

describe("classifyPageKind", () => {
  it("calls a page with an image and no vector content a scan", () => {
    const kind = classifyPageKind({ pathCount: 0, segmentCount: 0, imageCount: 1 });
    expect(kind.kind).toBe("raster");
    expect(kind.reason).toMatch(/scan/);
  });

  it("still calls it a scan when a border or stamp sits on top", () => {
    // A scanned sheet often carries a few vector ticks or a frame.
    const kind = classifyPageKind({ pathCount: 4, segmentCount: INCIDENTAL_SEGMENT_LIMIT, imageCount: 1 });
    expect(kind.kind).toBe("raster");
  });

  it("judges by segments, not paths, so a few long polylines still read as vector", () => {
    // A clean floor plan can be a dozen polylines carrying hundreds of
    // segments; counting paths alone would call that empty.
    const kind = classifyPageKind({ pathCount: 11, segmentCount: 240, imageCount: 0 });
    expect(kind.kind).toBe("vector");
    expect(kind.reason).toMatch(/240 vector segments across 11 paths/);
  });

  it("calls a real but deliberately simple floor plan vector", () => {
    // Measured from the slice's own 40'x30' test plan: 11 paths, 21 segments.
    expect(classifyPageKind({ pathCount: 11, segmentCount: 21, imageCount: 0 }).kind).toBe("vector");
  });

  it("calls a path-only page vector", () => {
    expect(classifyPageKind({ pathCount: 400, segmentCount: 1800, imageCount: 0 }).kind).toBe("vector");
  });

  it("refuses to choose for a page that is genuinely both", () => {
    const kind = classifyPageKind({ pathCount: 900, segmentCount: 4000, imageCount: 2 });
    expect(kind.kind).toBe("mixed");
    expect(kind.reason).toMatch(/choose/);
  });

  it("reports a page with nothing on it as empty", () => {
    const kind = classifyPageKind({ pathCount: 0, segmentCount: 0, imageCount: 0 });
    expect(kind.kind).toBe("empty");
    expect(kind.reason).toMatch(/nothing to import/);
  });

  it("reports a nearly-blank vector page as sparse, not empty", () => {
    const kind = classifyPageKind({ pathCount: 2, segmentCount: 3, imageCount: 0 });
    expect(kind.kind).toBe("sparse");
    expect(kind.reason).toMatch(/little worth importing/);
  });

  it("falls back to the path count when no segment count is present", () => {
    expect(classifyPageKind({ pathCount: 900, imageCount: 0 }).kind).toBe("vector");
    expect(classifyPageKind({ pathCount: 0, imageCount: 1 }).kind).toBe("raster");
  });

  it("tolerates a missing census", () => {
    expect(classifyPageKind(null).kind).toBe("empty");
    expect(classifyPageKind(undefined).kind).toBe("empty");
  });
});
