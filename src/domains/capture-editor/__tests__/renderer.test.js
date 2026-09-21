// Renderer tests on a RECORDING fake context: asserts each annotation type
// issues the expected Canvas 2D calls and that z-order is honored, without
// any raster math (pixel behavior is covered in redaction-export.test.js).

import { describe, expect, it } from "vitest";
import { drawAnnotation, renderDocument } from "../renderer.js";
import { addAnnotation, createDocument } from "../document.js";
import { createAnnotation } from "../annotations.js";

function makeRecordingCtx() {
  const calls = [];
  const state = {};
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === "calls") return calls;
        if (prop === "canvas") return { width: 64, height: 64 };
        if (prop in state) return state[prop];
        return (...args) => {
          calls.push({ method: prop, args });
          if (prop === "getContext") return makeRecordingCtx();
          return undefined;
        };
      },
      set(target, prop, value) {
        calls.push({ set: prop, value });
        state[prop] = value;
        return true;
      },
    },
  );
  return ctx;
}

const recordingCanvasFactory = (w, h) => ({
  width: w,
  height: h,
  getContext: () => makeRecordingCtx(),
});

function methodsOf(ctx) {
  return ctx.calls.filter((c) => c.method).map((c) => c.method);
}

function geometryFor(type) {
  if (type === "arrow" || type === "line") return { points: [[2, 2], [20, 20]] };
  if (type === "freehand" || type === "highlight") return { points: [[2, 2], [10, 12], [20, 4]] };
  return { x: 4, y: 4, w: 16, h: 12 };
}

describe("drawAnnotation", () => {
  it.each([
    ["arrow", ["stroke"]],
    ["line", ["stroke"]],
    ["rectangle", ["stroke"]],
    ["ellipse", ["ellipse", "stroke"]],
    ["freehand", ["stroke"]],
    ["highlight", ["stroke"]],
    ["text", ["fillText"]],
    ["callout", ["stroke", "fillText"]],
    ["step-marker", ["arc", "fillText"]],
    ["blackout", ["fillRect"]],
  ])("%s issues %s", (type, expected) => {
    const ctx = makeRecordingCtx();
    const annotation = createAnnotation(type, geometryFor(type), { id: `t-${type}` });
    drawAnnotation(ctx, annotation, { createCanvas: recordingCanvasFactory });
    const methods = methodsOf(ctx);
    for (const name of expected) expect(methods).toContain(name);
  });

  it("blur composites through a temp canvas", () => {
    const created = [];
    const createCanvas = (w, h) => {
      created.push([w, h]);
      return recordingCanvasFactory(w, h);
    };
    const ctx = makeRecordingCtx();
    drawAnnotation(ctx, createAnnotation("blur", { x: 4, y: 4, w: 32, h: 32 }, { id: "b1" }), { createCanvas });
    expect(created.length).toBe(1); // the downscale temp canvas
    const draws = ctx.calls.filter((c) => c.method === "drawImage");
    expect(draws.length).toBe(1); // temp drawn back up
  });

  it("blur requires createCanvas", () => {
    const ctx = makeRecordingCtx();
    expect(() => drawAnnotation(ctx, createAnnotation("blur", { x: 1, y: 1, w: 8, h: 8 }, { id: "b2" }), {}))
      .toThrow(/requires createCanvas/);
  });

  it("blackout always paints opaque black", () => {
    const ctx = makeRecordingCtx();
    drawAnnotation(ctx, createAnnotation("blackout", { x: 1, y: 1, w: 8, h: 8 }, { id: "k1" }), {
      createCanvas: recordingCanvasFactory,
    });
    const fillSets = ctx.calls.filter((c) => c.set === "fillStyle");
    expect(fillSets.at(-1).value).toBe("#000000");
    const alphas = ctx.calls.filter((c) => c.set === "globalAlpha");
    expect(alphas.at(-1).value).toBe(1);
  });

  it("callout with an anchor draws the leader line", () => {
    const ctx = makeRecordingCtx();
    const annotation = createAnnotation(
      "callout",
      { x: 4, y: 4, w: 30, h: 16 },
      { id: "c1", text: "hi", anchor: { x: 50, y: 50 } },
    );
    drawAnnotation(ctx, annotation, { createCanvas: recordingCanvasFactory });
    expect(methodsOf(ctx)).toContain("arc");
  });

  it("step-marker draws its number", () => {
    const ctx = makeRecordingCtx();
    const annotation = createAnnotation("step-marker", { x: 4, y: 4, w: 20, h: 20 }, { id: "s1" });
    const numbered = { ...annotation, stepNumber: 3 };
    drawAnnotation(ctx, numbered, { createCanvas: recordingCanvasFactory });
    const texts = ctx.calls.filter((c) => c.method === "fillText");
    expect(texts.some((c) => String(c.args[0]) === "3")).toBe(true);
  });

  it("unknown types draw nothing and do not throw", () => {
    const ctx = makeRecordingCtx();
    drawAnnotation(ctx, { type: "mystery", geometry: {}, style: {} }, { createCanvas: recordingCanvasFactory });
    // drawAnnotation wraps every call in save/restore; nothing else may run.
    const drawing = ctx.calls.filter((c) => c.method !== "save" && c.method !== "restore");
    expect(drawing).toEqual([]);
  });
});

describe("renderDocument", () => {
  function makeDoc() {
    let doc = createDocument({
      id: "render-doc",
      width: 64,
      height: 64,
      source: { kind: "embedded", mime: "image/png", bytes: "aGVsbG8=" },
    });
    return doc;
  }

  it("requires createCanvas and sourceImage", () => {
    const ctx = makeRecordingCtx();
    const doc = makeDoc();
    expect(() => renderDocument(ctx, doc, { sourceImage: { width: 64, height: 64 } })).toThrow(/requires createCanvas/);
    expect(() => renderDocument(ctx, doc, { createCanvas: recordingCanvasFactory })).toThrow(/requires sourceImage/);
  });

  it("draws annotations in z-order", () => {
    let doc = makeDoc();
    // Inserted out of z-order on purpose: addAnnotation re-stamps to the top.
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), {
      id: "first",
      style: { stroke: "#ff0000", strokeWidth: 2 },
    }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), {
      id: "second",
      style: { stroke: "#00ff00", strokeWidth: 2 },
    }));
    doc = addAnnotation(doc, createAnnotation("rectangle", geometryFor("rectangle"), {
      id: "third",
      style: { stroke: "#0000ff", strokeWidth: 2 },
    }));
    const display = makeRecordingCtx();
    const comp = renderDocument(display, doc, {
      sourceImage: { width: 64, height: 64 },
      createCanvas: recordingCanvasFactory,
    });
    expect(comp.width).toBe(64);
    expect(comp.height).toBe(64);
    // The composition context is a fresh recording canvas; find it via the
    // drawImage of the comp onto the display context is not enough — instead
    // re-render capturing the comp ctx through a spying factory.
    const seen = [];
    const spyingFactory = (w, h) => {
      const canvas = recordingCanvasFactory(w, h);
      const realGetContext = canvas.getContext;
      canvas.getContext = (...args) => {
        const ctx = realGetContext(...args);
        seen.push(ctx);
        return ctx;
      };
      return canvas;
    };
    renderDocument(makeRecordingCtx(), doc, { sourceImage: { width: 64, height: 64 }, createCanvas: spyingFactory });
    const compCtx = seen[0];
    const strokeColors = compCtx.calls.filter((c) => c.set === "strokeStyle").map((c) => c.value);
    expect(strokeColors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("draws the source image before any annotation", () => {
    let doc = makeDoc();
    doc = addAnnotation(doc, createAnnotation("blackout", { x: 1, y: 1, w: 8, h: 8 }, { id: "k" }));
    const seen = [];
    const spyingFactory = (w, h) => {
      const canvas = recordingCanvasFactory(w, h);
      const realGetContext = canvas.getContext;
      canvas.getContext = (...args) => {
        const ctx = realGetContext(...args);
        seen.push(ctx);
        return ctx;
      };
      return canvas;
    };
    renderDocument(makeRecordingCtx(), doc, {
      sourceImage: { width: 64, height: 64 },
      createCanvas: spyingFactory,
    });
    const compCtx = seen[0];
    const firstCall = compCtx.calls[0];
    expect(firstCall.method).toBe("drawImage");
  });

  it("applies the viewport transform on the display context only", () => {
    const doc = makeDoc();
    const display = makeRecordingCtx();
    renderDocument(display, doc, {
      sourceImage: { width: 64, height: 64 },
      viewport: { zoom: 2, panX: 10, panY: 20 },
      createCanvas: recordingCanvasFactory,
    });
    const transforms = display.calls.filter((c) => c.method === "setTransform");
    expect(transforms).toEqual([{ method: "setTransform", args: [2, 0, 0, 2, 10, 20] }]);
  });
});
