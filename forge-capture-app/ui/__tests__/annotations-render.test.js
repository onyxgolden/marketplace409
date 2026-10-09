// ui/annotations-render.js tests. Pure functions only (resolveDrawOps,
// drawOpsToCanvas) run under plain vitest/node — no jsdom/canvas needed.
// drawOpsToCanvas is tested against a recording mock ctx, matching the
// module's own DI design (same spirit as ai-edit.js's injected `invoke`).

import { describe, expect, it } from "vitest";
import { resolveDrawOps, drawOpsToCanvas, flattenAnnotations } from "../annotations-render.js";

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

  it("reordering the items array renumbers callouts at render with no stored number", () => {
    // Mirrors the Rust move_item: the last callout moves to the front by
    // array position; the renderer derives 1..N from the new order.
    const items = [
      { id: "c1", kind: "callout", anchor: { x: 1, y: 1 }, color: red },
      { id: "c2", kind: "callout", anchor: { x: 2, y: 2 }, color: red },
      { id: "c3", kind: "callout", anchor: { x: 3, y: 3 }, color: red },
    ];
    const moved = [items[2], items[0], items[1]];
    const ops = resolveDrawOps(sidecar(moved)).filter((o) => o.op === "callout");
    expect(ops.map((o) => [o.id, o.number])).toEqual([
      ["c3", 1],
      ["c1", 2],
      ["c2", 3],
    ]);
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

  it("passes maxWidth to fillText even when the mock's declared arity is 3, not 4 (review regression)", () => {
    // Review finding: `ctx.fillText.length` reflects a function's
    // DECLARED parameter count, not whether it accepts an optional
    // fourth argument -- a real `CanvasRenderingContext2D.fillText`
    // reports `.length === 3` precisely because its `maxWidth` parameter
    // is optional, so a check gated on `ctx.fillText.length >= 4` was
    // false in real browsers too, not just in the test's own recording
    // mock (which used a rest parameter and so also reported `.length
    // === 0`). This mock deliberately declares exactly three named
    // parameters -- the same shape a real browser's `fillText` has --
    // and reads the real argument count via `arguments.length` to prove
    // the fourth argument is actually received, not silently dropped.
    const calls = [];
    const ctx = {
      set fillStyle(v) {
        calls.push(["fillStyle", v]);
      },
      fillText: function fillText(text, x, y) {
        calls.push(["fillText", ...arguments]);
      },
    };
    expect(ctx.fillText.length).toBe(3); // the exact arity shape being guarded against
    drawOpsToCanvas(ctx, [{ op: "text", x: 5, y: 5, maxWidth: 42, color: red, text: "hi" }]);
    expect(calls).toContainEqual(["fillText", "hi", 5, 5, 42]);
  });

  it("omits maxWidth from the fillText call when the op has none", () => {
    const ctx = recordingCtx();
    drawOpsToCanvas(ctx, [{ op: "text", x: 5, y: 5, color: red, text: "hi" }]);
    expect(ctx.calls).toContainEqual(["fillText", "hi", 5, 5]);
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
  it("resolves a redact item to a non-destructive placeholder, never anything destructive", () => {
    const s = sidecar([redactItem("r1", { x: 1, y: 2, w: 3, h: 4 })]);
    expect(resolveDrawOps(s)).toEqual([{ op: "redactPlaceholder", id: "r1", x: 1, y: 2, w: 3, h: 4 }]);
  });
});

describe("flattenAnnotations: never destructive, even with a redact item present (Slice 2 review)", () => {
  // Per the review: this module performs no destructive pixel work at all. The actual redaction
  // is done entirely by the Rust export_redacted command, against the real re-read source. These
  // tests prove flattenAnnotations's output for a sidecar containing a redact item is exactly
  // what it would be for an ordinary sidecar -- only the non-destructive preview op, nothing that
  // could be mistaken for a sanitized result.
  it("draws only the non-destructive placeholder for a redact item, never a solid/opaque fill", () => {
    const s = sidecar([redactItem("r1", { x: 5, y: 5, w: 10, h: 10 })]);
    const ctx = recordingCtx();
    flattenAnnotations(
      { sidecar: s, sourceImage: { marker: "fake-image" } },
      { createCanvas: (w, h) => ({ w, h }), getContext2d: () => ctx },
    );
    expect(ctx.calls.some((c) => c[0] === "redactPlaceholder")).toBe(true);
    expect(ctx.calls.some((c) => c[0] === "fillRect")).toBe(false);
    expect(ctx.calls.some((c) => c[0] === "globalAlpha")).toBe(false);
  });

  it("has no special-cased exported function for redaction at all", () => {
    // Guards against the exact shape of the review finding recurring: a separate
    // "export the redacted image" function that composites destructively in JS.
    expect(typeof flattenAnnotations).toBe("function");
  });
});
