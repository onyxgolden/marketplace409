// ui/annotations-render.js tests. Pure functions only (resolveDrawOps,
// drawOpsToCanvas) run under plain vitest/node — no jsdom/canvas needed.
// drawOpsToCanvas is tested against a recording mock ctx, matching the
// module's own DI design (same spirit as ai-edit.js's injected `invoke`).

import { describe, expect, it } from "vitest";
import {
  resolveDrawOps,
  resolveRedactionFills,
  drawOpsToCanvas,
  flattenAnnotations,
  exportRedacted,
} from "../annotations-render.js";

const red = { r: 255, g: 0, b: 0, a: 255 };

function sidecar(items) {
  return {
    schemaVersion: 1,
    kind: "annotations",
    sourceSha256: "a".repeat(64),
    canvas: { w: 800, h: 600 },
    items,
  };
}

describe("resolveDrawOps", () => {
  it("resolves a rect to a single rect op", () => {
    const s = sidecar([
      { id: "a1", kind: "rect", geometry: { x: 10, y: 10, w: 100, h: 50 }, color: red, strokeWidth: 2 },
    ]);
    expect(resolveDrawOps(s)).toEqual([
      { op: "rect", id: "a1", x: 10, y: 10, w: 100, h: 50, color: red, strokeWidth: 2 },
    ]);
  });

  it("resolves a highlight to a fillRect op (no stroke)", () => {
    const s = sidecar([{ id: "a1", kind: "highlight", geometry: { x: 0, y: 0, w: 20, h: 20 }, color: red }]);
    expect(resolveDrawOps(s)).toEqual([{ op: "fillRect", id: "a1", x: 0, y: 0, w: 20, h: 20, color: red }]);
  });

  it("resolves a line to a single line op", () => {
    const s = sidecar([
      { id: "a1", kind: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: red, strokeWidth: 1 },
    ]);
    expect(resolveDrawOps(s)).toEqual([
      { op: "line", id: "a1", x1: 0, y1: 0, x2: 10, y2: 0, color: red, strokeWidth: 1 },
    ]);
  });

  it("resolves an arrow to a line plus a filled triangle arrowhead at the endpoint", () => {
    const s = sidecar([
      { id: "a1", kind: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, color: red, strokeWidth: 2 },
    ]);
    const ops = resolveDrawOps(s);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ op: "line", id: "a1", x1: 0, y1: 0, x2: 100, y2: 0, color: red, strokeWidth: 2 });
    expect(ops[1].op).toBe("filledTriangle");
    expect(ops[1].points[0]).toEqual({ x: 100, y: 0 }); // the tip is exactly the arrow's `to` point
    // The two back points must be behind the tip (x < 100) and symmetric about the shaft (y mirrored).
    expect(ops[1].points[1].x).toBeLessThan(100);
    expect(ops[1].points[2].x).toBeLessThan(100);
    expect(ops[1].points[1].y).toBeCloseTo(-ops[1].points[2].y, 6);
  });

  it("a thicker stroke gives a longer arrowhead", () => {
    const thin = sidecar([
      { id: "a1", kind: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, color: red, strokeWidth: 1 },
    ]);
    const thick = sidecar([
      { id: "a1", kind: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, color: red, strokeWidth: 10 },
    ]);
    const thinLen = 100 - resolveDrawOps(thin)[1].points[1].x;
    const thickLen = 100 - resolveDrawOps(thick)[1].points[1].x;
    expect(thickLen).toBeGreaterThan(thinLen);
  });

  it("resolves text with its anchor, color, and max width", () => {
    const s = sidecar([
      { id: "a1", kind: "text", anchor: { x: 5, y: 5 }, maxWidth: 200, color: red, text: "note" },
    ]);
    expect(resolveDrawOps(s)).toEqual([
      { op: "text", id: "a1", x: 5, y: 5, maxWidth: 200, color: red, text: "note" },
    ]);
  });

  it("resolves blur to a blurRect op carrying only the region, no color", () => {
    const s = sidecar([{ id: "a1", kind: "blur", geometry: { x: 1, y: 2, w: 3, h: 4 } }]);
    expect(resolveDrawOps(s)).toEqual([{ op: "blurRect", id: "a1", x: 1, y: 2, w: 3, h: 4 }]);
  });

  it("numbers callouts 1..N in array order, skipping non-callout items, and never reads a stored number", () => {
    const s = sidecar([
      { id: "c1", kind: "callout", anchor: { x: 1, y: 1 }, color: red },
      { id: "r1", kind: "rect", geometry: { x: 0, y: 0, w: 1, h: 1 }, color: red, strokeWidth: 1 },
      { id: "c2", kind: "callout", anchor: { x: 2, y: 2 }, color: red, step: 999 }, // a stray `step` must be ignored
    ]);
    const ops = resolveDrawOps(s);
    const callouts = ops.filter((o) => o.op === "callout");
    expect(callouts.map((o) => [o.id, o.number])).toEqual([
      ["c1", 1],
      ["c2", 2],
    ]);
  });

  it("deleting the first callout renumbers the rest with no gap", () => {
    const items = [
      { id: "c1", kind: "callout", anchor: { x: 1, y: 1 }, color: red },
      { id: "c2", kind: "callout", anchor: { x: 2, y: 2 }, color: red },
      { id: "c3", kind: "callout", anchor: { x: 3, y: 3 }, color: red },
    ];
    const after = sidecar(items.filter((i) => i.id !== "c1"));
    expect(resolveDrawOps(after).map((o) => o.number)).toEqual([1, 2]);
  });

  it("skips an item of an unknown kind rather than guessing how to draw it", () => {
    const s = sidecar([{ id: "a1", kind: "future-kind-v2", color: red }]);
    expect(resolveDrawOps(s)).toEqual([]);
  });

  it("an empty sidecar resolves to no ops", () => {
    expect(resolveDrawOps(sidecar([]))).toEqual([]);
  });

  it("is deterministic", () => {
    const s = sidecar([
      { id: "a1", kind: "rect", geometry: { x: 10, y: 10, w: 100, h: 50 }, color: red, strokeWidth: 2 },
    ]);
    expect(resolveDrawOps(s)).toEqual(resolveDrawOps(s));
  });
});

function recordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    set strokeStyle(v) {
      calls.push(["strokeStyle", v]);
    },
    set fillStyle(v) {
      calls.push(["fillStyle", v]);
    },
    set lineWidth(v) {
      calls.push(["lineWidth", v]);
    },
    strokeRect: (...a) => calls.push(["strokeRect", ...a]),
    fillRect: (...a) => calls.push(["fillRect", ...a]),
    beginPath: (...a) => calls.push(["beginPath", ...a]),
    moveTo: (...a) => calls.push(["moveTo", ...a]),
    lineTo: (...a) => calls.push(["lineTo", ...a]),
    closePath: (...a) => calls.push(["closePath", ...a]),
    stroke: (...a) => calls.push(["stroke", ...a]),
    fill: (...a) => calls.push(["fill", ...a]),
    fillText: (...a) => calls.push(["fillText", ...a]),
    arc: (...a) => calls.push(["arc", ...a]),
    blurRegion: (...a) => calls.push(["blurRegion", ...a]),
    redactPlaceholder: (...a) => calls.push(["redactPlaceholder", ...a]),
    set globalAlpha(v) {
      calls.push(["globalAlpha", v]);
    },
    drawImage: (...a) => calls.push(["drawImage", ...a]),
  };
  return ctx;
}

describe("drawOpsToCanvas", () => {
  it("draws a rect op as strokeRect with the op's color and width", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "rect", x: 1, y: 2, w: 3, h: 4, color: red, strokeWidth: 2 }]);
    expect(ctx.calls).toEqual([
      ["strokeStyle", "rgba(255, 0, 0, 1)"],
      ["lineWidth", 2],
      ["strokeRect", 1, 2, 3, 4],
    ]);
  });

  it("draws a fillRect op as fillRect with no stroke calls", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "fillRect", x: 0, y: 0, w: 5, h: 5, color: red }]);
    expect(ctx.calls).toEqual([
      ["fillStyle", "rgba(255, 0, 0, 1)"],
      ["fillRect", 0, 0, 5, 5],
    ]);
  });

  it("draws a line op as a begin/move/line/stroke path", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "line", x1: 0, y1: 0, x2: 10, y2: 0, color: red, strokeWidth: 1 }]);
    expect(ctx.calls).toEqual([
      ["strokeStyle", "rgba(255, 0, 0, 1)"],
      ["lineWidth", 1],
      ["beginPath"],
      ["moveTo", 0, 0],
      ["lineTo", 10, 0],
      ["stroke"],
    ]);
  });

  it("draws a filledTriangle op as a closed, filled path through its three points", () => {
    const ctx = recordingCtx();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    drawOpsToCanvas(ctx, [{ op: "filledTriangle", points, color: red }]);
    expect(ctx.calls).toEqual([
      ["fillStyle", "rgba(255, 0, 0, 1)"],
      ["beginPath"],
      ["moveTo", 0, 0],
      ["lineTo", 1, 1],
      ["lineTo", 2, 2],
      ["closePath"],
      ["fill"],
    ]);
  });

  it("draws a callout as a filled circle plus its number as white text", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "callout", x: 5, y: 5, color: red, number: 3 }]);
    expect(ctx.calls[0]).toEqual(["fillStyle", "rgba(255, 0, 0, 1)"]);
    expect(ctx.calls.some((c) => c[0] === "arc")).toBe(true);
    expect(ctx.calls).toContainEqual(["fillStyle", "#ffffff"]);
    expect(ctx.calls).toContainEqual(["fillText", "3", 5, 5]);
  });

  it("draws a blurRect op via ctx.blurRegion, nothing else", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "blurRect", x: 1, y: 2, w: 3, h: 4 }]);
    expect(ctx.calls).toEqual([["blurRegion", 1, 2, 3, 4]]);
  });

  it("draws ops in the given order", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [
      { op: "fillRect", x: 0, y: 0, w: 1, h: 1, color: red },
      { op: "line", x1: 0, y1: 0, x2: 1, y2: 1, color: red, strokeWidth: 1 },
    ]);
    const opOrder = ctx.calls.filter((c) => c[0] === "fillRect" || c[0] === "beginPath").map((c) => c[0]);
    expect(opOrder).toEqual(["fillRect", "beginPath"]);
  });
});

describe("flattenAnnotations", () => {
  it("creates a canvas sized to the sidecar, draws the source image first, then the annotation ops", () => {
    const s = sidecar([{ id: "a1", kind: "highlight", geometry: { x: 0, y: 0, w: 1, h: 1 }, color: red }]);
    const ctx = recordingCtx();
    let createdSize = null;
    const canvas = { marker: "fake-canvas" };
    const sourceImage = { marker: "fake-image" };
    const result = flattenAnnotations(
      { sidecar: s, sourceImage },
      {
        createCanvas: (w, h) => {
          createdSize = { w, h };
          return canvas;
        },
        getContext2d: (c) => {
          expect(c).toBe(canvas);
          return ctx;
        },
      },
    );
    expect(result).toBe(canvas);
    expect(createdSize).toEqual({ w: 800, h: 600 });
    expect(ctx.calls[0]).toEqual(["drawImage", sourceImage, 0, 0, 800, 600]);
    // The source image is drawn before any annotation op.
    const firstAnnotationCallIndex = ctx.calls.findIndex((c) => c[0] === "fillStyle" || c[0] === "fillRect");
    expect(firstAnnotationCallIndex).toBeGreaterThan(0);
  });

  it("never mutates the sourceImage object it was given", () => {
    const s = sidecar([]);
    const sourceImage = { marker: "fake-image" };
    const before = JSON.stringify(sourceImage);
    flattenAnnotations(
      { sidecar: s, sourceImage },
      { createCanvas: () => ({}), getContext2d: () => recordingCtx() },
    );
    expect(JSON.stringify(sourceImage)).toBe(before);
  });
});

function redactItem(id, geometry) {
  return { id, kind: "redact", geometry };
}

describe("resolveDrawOps: redact", () => {
  it("resolves a redact item to a non-destructive placeholder, never an opaque fill", () => {
    const s = sidecar([redactItem("r1", { x: 1, y: 2, w: 3, h: 4 })]);
    expect(resolveDrawOps(s)).toEqual([{ op: "redactPlaceholder", id: "r1", x: 1, y: 2, w: 3, h: 4 }]);
  });
});

describe("resolveRedactionFills", () => {
  it("resolves each redact item to an opaqueFill op, and ignores every other kind", () => {
    const s = sidecar([
      redactItem("r1", { x: 1, y: 2, w: 3, h: 4 }),
      { id: "b1", kind: "blur", geometry: { x: 0, y: 0, w: 1, h: 1 } },
      { id: "r2", kind: "rect", geometry: { x: 0, y: 0, w: 1, h: 1 }, color: red, strokeWidth: 1 },
    ]);
    expect(resolveRedactionFills(s)).toEqual([{ op: "opaqueFill", id: "r1", x: 1, y: 2, w: 3, h: 4 }]);
  });

  it("is empty for a sidecar with no redact items", () => {
    expect(resolveRedactionFills(sidecar([]))).toEqual([]);
  });
});

describe("drawOpsToCanvas: opaqueFill", () => {
  it("resets globalAlpha to 1 and fills with the fixed sanitizing color, carrying no caller-chosen color", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "opaqueFill", x: 1, y: 2, w: 3, h: 4 }]);
    expect(ctx.calls).toEqual([
      ["globalAlpha", 1],
      ["fillStyle", "#000000"],
      ["fillRect", 1, 2, 3, 4],
    ]);
  });
});

describe("exportRedacted", () => {
  const sourceImage = { marker: "fake-image" };
  const deps = (ctx) => ({ createCanvas: (w, h) => ({ w, h }), getContext2d: () => ctx });

  it("refuses to run when the sidecar has no redact regions", () => {
    const s = sidecar([{ id: "b1", kind: "blur", geometry: { x: 0, y: 0, w: 1, h: 1 } }]);
    expect(() => exportRedacted({ sidecar: s, sourceImage }, deps(recordingCtx()))).toThrow(
      /nothing to redact/,
    );
  });

  it("draws the source image, then ordinary annotations, then the redaction fill strictly last", () => {
    const s = sidecar([
      { id: "h1", kind: "highlight", geometry: { x: 0, y: 0, w: 1, h: 1 }, color: red },
      redactItem("r1", { x: 5, y: 5, w: 10, h: 10 }),
    ]);
    const ctx = recordingCtx();
    exportRedacted({ sidecar: s, sourceImage }, deps(ctx));
    const drawImageIndex = ctx.calls.findIndex((c) => c[0] === "drawImage");
    const highlightIndex = ctx.calls.findIndex((c) => c[0] === "fillRect" && c[3] === 1 && c[4] === 1);
    const redactFillIndex = ctx.calls.findIndex((c) => c[0] === "fillRect" && c[3] === 10 && c[4] === 10);
    expect(drawImageIndex).toBe(0);
    expect(highlightIndex).toBeGreaterThan(drawImageIndex);
    expect(redactFillIndex).toBeGreaterThan(highlightIndex);
    // Nothing is drawn after the redaction fill: it is strictly the last drawing call.
    const lastDrawCallIndex = ctx.calls.length - 1;
    expect(redactFillIndex).toBe(lastDrawCallIndex);
  });

  it("a redact region that overlaps an earlier annotation still ends up fully opaque black there, by draw order", () => {
    // Canvas 2D semantics: an opaque fillRect with globalAlpha=1 and the default 'source-over'
    // composite operation completely replaces whatever was drawn before it in that region. This
    // test proves the ORDER guarantee that makes that true (the fill is strictly last); it does
    // not re-simulate canvas compositing itself (no real canvas/pixel buffer is available here).
    const s = sidecar([
      { id: "h1", kind: "highlight", geometry: { x: 5, y: 5, w: 10, h: 10 }, color: red }, // same region
      redactItem("r1", { x: 5, y: 5, w: 10, h: 10 }),
    ]);
    const ctx = recordingCtx();
    exportRedacted({ sidecar: s, sourceImage }, deps(ctx));
    const opaqueFillCalls = ctx.calls.filter(
      (c) => c[0] === "fillRect" && c[1] === 5 && c[2] === 5 && c[3] === 10 && c[4] === 10,
    );
    // Both the highlight and the redaction fill touch the same rect; the LAST one drawn (verified
    // above to always be the redaction fill) is what canvas compositing actually leaves visible.
    expect(opaqueFillCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate sourceImage", () => {
    const s = sidecar([redactItem("r1", { x: 0, y: 0, w: 1, h: 1 })]);
    const before = JSON.stringify(sourceImage);
    exportRedacted({ sidecar: s, sourceImage }, deps(recordingCtx()));
    expect(JSON.stringify(sourceImage)).toBe(before);
  });
});
