// pdfPageOps.test.js — pdf.js operator list → path geometry.
//
// These tests encode the pdf.js wire format the importer depends on, verified
// against pdfjs-dist 5.7 by running real PDFs through getOperatorList():
//   - `re`, `v` and `y` are pre-normalized by pdf.js into moveTo/lineTo/curveTo,
//     so only opcodes 0-4 ever appear;
//   - several subpaths share ONE buffer and split at each moveTo;
//   - path coordinates are in the CURRENT user space, so the walker must track
//     save/restore/transform and form XObjects to place them.

import { describe, expect, it, vi } from "vitest";
import { collectPageGeometry, decodePathBuffer, DRAW_OPS, MAX_PATHS_PER_PAGE, paintKind } from "./pdfPageOps";
import { applyMatrix } from "./pdfGeometry";
import { D, OPS, constructPath, operatorList, strokedPolyline, strokedRect } from "./testUtils/pdfFixture";

describe("decodePathBuffer", () => {
  it("splits one buffer into subpaths at each moveTo", () => {
    // Verified shape: `10 10 m 100 10 l 100 100 m 200 100 l S` arrives as one
    // buffer [0,10,10, 1,100,10, 0,100,100, 1,200,100].
    const { subpaths, truncated } = decodePathBuffer(
      new Float32Array([D.move, 10, 10, D.line, 100, 10, D.move, 100, 100, D.line, 200, 100]),
    );
    expect(truncated).toBe(false);
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0].ops).toEqual([
      { op: "move", x: 10, y: 10 },
      { op: "line", x: 100, y: 10 },
    ]);
    expect(subpaths[1].ops).toEqual([
      { op: "move", x: 100, y: 100 },
      { op: "line", x: 200, y: 100 },
    ]);
  });

  it("records closePath as a flag on the subpath, not an operation", () => {
    const { subpaths } = decodePathBuffer(
      new Float32Array([D.move, 0, 0, D.line, 10, 0, D.line, 10, 10, D.close]),
    );
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0].closed).toBe(true);
    expect(subpaths[0].ops.map((o) => o.op)).toEqual(["move", "line", "line"]);
  });

  it("starts a new subpath after a closePath", () => {
    const { subpaths } = decodePathBuffer(
      new Float32Array([D.move, 0, 0, D.line, 10, 0, D.close, D.move, 50, 50, D.line, 60, 60]),
    );
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0].closed).toBe(true);
    expect(subpaths[1].closed).toBe(false);
  });

  it("decodes cubic and quadratic curve commands with their operand counts", () => {
    const { subpaths } = decodePathBuffer(
      new Float32Array([
        D.move, 0, 0,
        D.cubic, 1, 2, 3, 4, 5, 6,
        D.quad, 7, 8, 9, 10,
      ]),
    );
    expect(subpaths[0].ops).toEqual([
      { op: "move", x: 0, y: 0 },
      { op: "cubic", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { op: "quadratic", x1: 7, y1: 8, x: 9, y: 10 },
    ]);
  });

  it("stops at an unknown opcode instead of emitting misaligned coordinates", () => {
    const result = decodePathBuffer(new Float32Array([D.move, 1, 1, 99, 5, 5, D.line, 9, 9]));
    expect(result.truncated).toBe(true);
    expect(result.unknownOpcode).toBe(99);
    // The valid prefix survives; the garbage after it does not become geometry.
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0].ops).toEqual([{ op: "move", x: 1, y: 1 }]);
  });

  it("stops on a buffer truncated mid-command", () => {
    const result = decodePathBuffer(new Float32Array([D.move, 1, 1, D.line, 5]));
    expect(result.truncated).toBe(true);
    expect(result.unknownOpcode).toBeNull();
    expect(result.subpaths[0].ops).toEqual([{ op: "move", x: 1, y: 1 }]);
  });

  it("tolerates a lineTo with no preceding moveTo", () => {
    const { subpaths } = decodePathBuffer(new Float32Array([D.line, 4, 4]));
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0].ops).toEqual([{ op: "line", x: 4, y: 4 }]);
  });

  it("returns nothing for an empty or missing buffer", () => {
    expect(decodePathBuffer(new Float32Array([])).subpaths).toEqual([]);
    expect(decodePathBuffer(null).subpaths).toEqual([]);
  });

  it("exposes the DrawOPS numbering pdf.js actually uses", () => {
    expect(DRAW_OPS).toEqual({ moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 });
  });
});

describe("paintKind", () => {
  it("classifies each PDF painting operator", () => {
    expect(paintKind(OPS.stroke, OPS)).toEqual({ stroked: true, filled: false });
    expect(paintKind(OPS.closeStroke, OPS)).toEqual({ stroked: true, filled: false });
    expect(paintKind(OPS.fill, OPS)).toEqual({ stroked: false, filled: true });
    expect(paintKind(OPS.eoFill, OPS)).toEqual({ stroked: false, filled: true });
    expect(paintKind(OPS.fillStroke, OPS)).toEqual({ stroked: true, filled: true });
    expect(paintKind(OPS.eoFillStroke, OPS)).toEqual({ stroked: true, filled: true });
    expect(paintKind(OPS.endPath, OPS)).toEqual({ stroked: false, filled: false });
  });
});

describe("collectPageGeometry", () => {
  it("collects a stroked polyline with its graphics state", () => {
    const { paths, census } = collectPageGeometry(
      operatorList([
        [OPS.setLineWidth, [2.5]],
        strokedPolyline([[0, 0], [100, 0]]),
      ]),
      OPS,
    );
    expect(paths).toHaveLength(1);
    expect(paths[0].lineWidthPt).toBe(2.5);
    expect(paths[0].stroked).toBe(true);
    expect(paths[0].filled).toBe(false);
    expect(paths[0].dashed).toBe(false);
    expect(census.pathCount).toBe(1);
    expect(census.strokedPathCount).toBe(1);
  });

  it("leaves path coordinates in user space and reports the matrix to apply", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.save],
        [OPS.transform, new Float32Array([2, 0, 0, 2, 5, 5])],
        strokedPolyline([[10, 10], [20, 20]]),
        [OPS.restore],
      ]),
      OPS,
    );
    // Raw coordinates are untouched...
    expect(paths[0].subpaths[0].ops[0]).toEqual({ op: "move", x: 10, y: 10 });
    // ...and the reported matrix is what places them.
    expect(applyMatrix(paths[0].matrix, { x: 10, y: 10 })).toEqual({ x: 25, y: 25 });
  });

  it("restores the matrix and line width on restore", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.setLineWidth, [1]],
        [OPS.save],
        [OPS.transform, new Float32Array([3, 0, 0, 3, 0, 0])],
        [OPS.setLineWidth, [9]],
        strokedPolyline([[1, 1], [2, 2]]),
        [OPS.restore],
        strokedPolyline([[1, 1], [2, 2]]),
      ]),
      OPS,
    );
    expect(paths[0].lineWidthPt).toBe(9);
    expect(applyMatrix(paths[0].matrix, { x: 1, y: 1 })).toEqual({ x: 3, y: 3 });
    expect(paths[1].lineWidthPt).toBe(1);
    expect(applyMatrix(paths[1].matrix, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });

  it("composes nested transforms in the order pdf.js applies them", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.transform, new Float32Array([1, 0, 0, 1, 100, 0])], // translate
        [OPS.transform, new Float32Array([2, 0, 0, 2, 0, 0])], // then scale
        strokedPolyline([[1, 0], [2, 0]]),
      ]),
      OPS,
    );
    // Inner scale applies first, then the outer translate: 1*2 + 100 = 102.
    expect(applyMatrix(paths[0].matrix, { x: 1, y: 0 })).toEqual({ x: 102, y: 0 });
  });

  it("treats paintFormXObjectBegin/End as pdf.js does: an implicit save + transform", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.paintFormXObjectBegin, [new Float32Array([1, 0, 0, 1, 400, 600]), new Float32Array([0, 0, 100, 100])]],
        strokedPolyline([[0, 0], [50, 50]]),
        [OPS.paintFormXObjectEnd, []],
        strokedPolyline([[0, 0], [50, 50]]),
      ]),
      OPS,
    );
    expect(applyMatrix(paths[0].matrix, { x: 0, y: 0 })).toEqual({ x: 400, y: 600 });
    expect(applyMatrix(paths[1].matrix, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("applies the caller's base matrix under everything", () => {
    const { paths } = collectPageGeometry(
      operatorList([strokedPolyline([[0, 72], [72, 72]])]),
      OPS,
      { baseMatrix: [1 / 72, 0, 0, -1 / 72, 0, 11] },
    );
    expect(applyMatrix(paths[0].matrix, { x: 0, y: 72 })).toEqual({ x: 0, y: 10 });
  });

  it("tracks the dash pattern so dashed strokes can be told apart", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.setDash, [[3, 2], 0]],
        strokedPolyline([[0, 0], [10, 0]]),
        [OPS.setDash, [[], 0]],
        strokedPolyline([[0, 0], [10, 0]]),
      ]),
      OPS,
    );
    expect(paths[0].dashed).toBe(true);
    expect(paths[1].dashed).toBe(false);
  });

  it("scopes the dash pattern to the graphics state", () => {
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.save],
        [OPS.setDash, [[4, 4], 0]],
        strokedPolyline([[0, 0], [10, 0]]),
        [OPS.restore],
        strokedPolyline([[0, 0], [10, 0]]),
      ]),
      OPS,
    );
    expect(paths[0].dashed).toBe(true);
    expect(paths[1].dashed).toBe(false);
  });

  it("treats an all-zero dash array as solid", () => {
    const { paths } = collectPageGeometry(
      operatorList([[OPS.setDash, [[0, 0], 0]], strokedPolyline([[0, 0], [10, 0]])]),
      OPS,
    );
    expect(paths[0].dashed).toBe(false);
  });

  it("ignores clip-only paths, which paint nothing", () => {
    const { paths, census } = collectPageGeometry(
      operatorList([constructPath([D.move, 0, 0, D.line, 10, 10], OPS.endPath)]),
      OPS,
    );
    expect(paths).toHaveLength(0);
    expect(census.pathCount).toBe(0);
  });

  it("keeps filled paths and marks them as filled", () => {
    const { paths, census } = collectPageGeometry(
      operatorList([strokedRect(0, 0, 10, 10, OPS.fill)]),
      OPS,
    );
    expect(paths).toHaveLength(1);
    expect(paths[0].filled).toBe(true);
    expect(paths[0].stroked).toBe(false);
    expect(census.pathCount).toBe(1);
    expect(census.strokedPathCount).toBe(0);
  });

  it("counts drawable segments, not paths, including a closing edge", () => {
    const { census } = collectPageGeometry(
      operatorList([
        strokedPolyline([[0, 0], [10, 0], [10, 10], [0, 10]]), // 3 segments
        strokedRect(0, 0, 5, 5), // 3 lineTo + closing edge = 4 segments
      ]),
      OPS,
    );
    expect(census.pathCount).toBe(2);
    expect(census.segmentCount).toBe(7);
  });

  it("does not count a lone moveTo as a segment", () => {
    const { census } = collectPageGeometry(
      operatorList([constructPath([D.move, 1, 1], OPS.stroke)]),
      OPS,
    );
    expect(census.segmentCount).toBe(0);
  });

  it("counts images and text runs for the scanned-page census", () => {
    const { census } = collectPageGeometry(
      operatorList([
        [OPS.paintImageXObject, ["img1"]],
        [OPS.paintInlineImageXObject, [{}]],
        [OPS.paintImageMaskXObject, [{}]],
        [OPS.beginText],
        [OPS.showText, [[]]],
        [OPS.showSpacedText, [[]]],
        [OPS.endText],
      ]),
      OPS,
    );
    expect(census.imageCount).toBe(3);
    expect(census.textRunCount).toBe(2);
    expect(census.pathCount).toBe(0);
  });

  it("ignores a non-finite transform and warns rather than poisoning coordinates", () => {
    const onWarning = vi.fn();
    const { paths } = collectPageGeometry(
      operatorList([
        [OPS.transform, new Float32Array([NaN, 0, 0, 1, 0, 0])],
        strokedPolyline([[1, 1], [2, 2]]),
      ]),
      OPS,
      { onWarning },
    );
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("non-finite"));
    expect(applyMatrix(paths[0].matrix, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });

  it("survives an unbalanced restore", () => {
    expect(() =>
      collectPageGeometry(operatorList([[OPS.restore], strokedPolyline([[0, 0], [1, 1]])]), OPS),
    ).not.toThrow();
  });

  it("accepts a plain array buffer as well as a typed array", () => {
    const entry = [OPS.constructPath, [OPS.stroke, [[D.move, 0, 0, D.line, 5, 5]], [0, 0, 5, 5]]];
    const flat = [OPS.constructPath, [OPS.stroke, [D.move, 0, 0, D.line, 5, 5], [0, 0, 5, 5]]];
    expect(collectPageGeometry(operatorList([entry]), OPS).paths).toHaveLength(1);
    expect(collectPageGeometry(operatorList([flat]), OPS).paths).toHaveLength(1);
  });

  it("counts malformed buffers and warns once", () => {
    const onWarning = vi.fn();
    const { census } = collectPageGeometry(
      operatorList([constructPath([D.move, 1, 1, 99, 5, 5])]),
      OPS,
      { onWarning },
    );
    expect(census.truncatedBuffers).toBe(1);
    expect(census.unknownDrawOpcodes).toBe(1);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("malformed"));
  });

  it("caps runaway pages and says so", () => {
    const onWarning = vi.fn();
    const entries = [];
    for (let i = 0; i < MAX_PATHS_PER_PAGE + 5; i += 1) {
      entries.push(strokedPolyline([[0, 0], [1, 1]]));
    }
    const { paths, census } = collectPageGeometry(operatorList(entries), OPS, { onWarning });
    expect(paths).toHaveLength(MAX_PATHS_PER_PAGE);
    expect(census.cappedPaths).toBe(true);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("paths"));
  });

  it("returns empty results for a missing operator list", () => {
    const { paths, census } = collectPageGeometry(null, OPS);
    expect(paths).toEqual([]);
    expect(census.pathCount).toBe(0);
  });
});
