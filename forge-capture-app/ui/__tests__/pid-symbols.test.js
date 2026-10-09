// Tests for forge-capture-app/ui/pid-symbols.js -- PT-5's pure P&ID
// symbol registry and geometry. No DOM. Structured to mirror
// workflow-symbols.test.js (PT-4) closely, since both registries share
// the same contract.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PID_SYMBOLS,
  PID_SYMBOL_COUNT,
  PidSymbolError,
  MAX_SEGMENTS_PER_SYMBOL,
  MAX_SYMBOL_LABEL_LENGTH,
  symbolDefinition,
  validateSymbolPlacement,
  symbolToDrawOps,
} from "../pid-symbols.js";
import { WORKFLOW_SYMBOLS } from "../workflow-symbols.js";
import { drawOpsToCanvas } from "../annotations-render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPPORTED_OPS = new Set(["rect", "line", "text"]);
const EXPECTED_FAMILY_COUNTS = {
  Rotating: 7,
  Vessels: 5,
  Exchangers: 4,
  "Piping & Valves": 7,
  "E&I": 6,
  Cooling: 2,
  Flare: 1,
  "Support Crafts": 3,
};

describe("PID_SYMBOLS — registry shape", () => {
  it(`has exactly ${PID_SYMBOL_COUNT} symbols, each with a namespaced id, name, category, and description`, () => {
    expect(PID_SYMBOLS).toHaveLength(PID_SYMBOL_COUNT);
    expect(PID_SYMBOL_COUNT).toBe(35);
    const ids = new Set();
    for (const s of PID_SYMBOLS) {
      expect(s.id).toMatch(/^pid\.[a-z]+\.[a-z0-9_]+$/);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.category).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.minWidth).toBeGreaterThan(0);
      expect(s.minHeight).toBeGreaterThan(0);
      expect(s.defaultWidth).toBeGreaterThanOrEqual(s.minWidth);
      expect(s.defaultHeight).toBeGreaterThanOrEqual(s.minHeight);
    }
  });

  it("groups the 35 symbols into exactly the 8 families the brief names, with the brief's own counts", () => {
    const counts = {};
    for (const s of PID_SYMBOLS) {
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_FAMILY_COUNTS);
    const total = Object.values(EXPECTED_FAMILY_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(PID_SYMBOL_COUNT);
  });

  it("never collides with a PT-4 workflow-symbols.js id", () => {
    const workflowIds = new Set(WORKFLOW_SYMBOLS.map((s) => s.id));
    for (const s of PID_SYMBOLS) {
      expect(workflowIds.has(s.id)).toBe(false);
      expect(s.id.startsWith("pid.")).toBe(true); // namespaced by construction, not by accident
    }
  });
});

describe("symbolDefinition", () => {
  it("returns the definition for a known id", () => {
    expect(symbolDefinition("pid.rotating.centrifugal_pump").name).toBe("Centrifugal pump");
  });

  it("fails closed on an unknown id", () => {
    expect(() => symbolDefinition("pid.not.a_symbol")).toThrow(PidSymbolError);
  });

  it("fails closed on a PT-4 workflow id (wrong registry)", () => {
    expect(() => symbolDefinition("process")).toThrow(PidSymbolError);
  });
});

describe("validateSymbolPlacement and symbolToDrawOps — every symbol", () => {
  for (const def of PID_SYMBOLS) {
    describe(`"${def.id}"`, () => {
      it("validates at its own default size and renders only renderer-supported ops", () => {
        const shape = {
          id: "m1-1",
          x: 10,
          y: 10,
          ...validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.defaultHeight }),
        };
        const ops = symbolToDrawOps(shape);
        expect(ops.length).toBeGreaterThan(0);
        for (const op of ops) {
          expect(SUPPORTED_OPS.has(op.op)).toBe(true);
        }
      });

      it("fits entirely inside its own x,y,w,h rectangle, INCLUDING its label", () => {
        const shape = {
          id: "m1-1",
          x: 50,
          y: 60,
          ...validateSymbolPlacement(def.id, {
            w: def.defaultWidth,
            h: def.defaultHeight,
            label: "Step",
          }),
        };
        const ops = symbolToDrawOps(shape);
        expect(ops.some((o) => o.op === "text")).toBe(true); // the label op actually ran
        const minX = shape.x - 0.001;
        const minY = shape.y - 0.001;
        const maxX = shape.x + shape.w + 0.001;
        const maxY = shape.y + shape.h + 0.001;
        for (const op of ops) {
          if (op.op === "rect") {
            expect(op.x).toBeGreaterThanOrEqual(minX);
            expect(op.y).toBeGreaterThanOrEqual(minY);
            expect(op.x + op.w).toBeLessThanOrEqual(maxX);
            expect(op.y + op.h).toBeLessThanOrEqual(maxY);
          } else if (op.op === "line") {
            expect(op.x1).toBeGreaterThanOrEqual(minX);
            expect(op.x1).toBeLessThanOrEqual(maxX);
            expect(op.y1).toBeGreaterThanOrEqual(minY);
            expect(op.y1).toBeLessThanOrEqual(maxY);
            expect(op.x2).toBeGreaterThanOrEqual(minX);
            expect(op.x2).toBeLessThanOrEqual(maxX);
            expect(op.y2).toBeGreaterThanOrEqual(minY);
            expect(op.y2).toBeLessThanOrEqual(maxY);
          } else if (op.op === "text") {
            expect(op.x).toBeGreaterThanOrEqual(minX);
            expect(op.x).toBeLessThanOrEqual(maxX);
            expect(op.y).toBeGreaterThanOrEqual(minY);
            expect(op.y).toBeLessThanOrEqual(maxY);
            // The renderer compresses text to maxWidth (see
            // annotations-render.js's `text` case), so the rendered
            // extent's right edge is also bounded, not just the anchor.
            expect(op.x + op.maxWidth).toBeLessThanOrEqual(maxX);
          }
        }
      });

      it("stays within the segment cap", () => {
        const lineAndRectOps = symbolToDrawOps({
          id: "m1-1",
          x: 0,
          y: 0,
          ...validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.defaultHeight }),
        }).filter((o) => o.op === "rect" || o.op === "line");
        expect(lineAndRectOps.length).toBeLessThanOrEqual(MAX_SEGMENTS_PER_SYMBOL);
      });

      it("fails closed below its own minimum size", () => {
        expect(() =>
          validateSymbolPlacement(def.id, { w: def.minWidth - 1, h: def.defaultHeight })
        ).toThrow(PidSymbolError);
        expect(() =>
          validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.minHeight - 1 })
        ).toThrow(PidSymbolError);
      });

      it("accepts a short label and emits exactly one text op for it", () => {
        const shape = {
          id: "m1-1",
          x: 0,
          y: 0,
          ...validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.defaultHeight, label: "Step A" }),
        };
        const ops = symbolToDrawOps(shape);
        const textOps = ops.filter((o) => o.op === "text");
        expect(textOps).toHaveLength(1);
        expect(textOps[0].text).toBe("Step A");
      });

      it("omits the label op entirely when no label is given", () => {
        const shape = {
          id: "m1-1",
          x: 0,
          y: 0,
          ...validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.defaultHeight }),
        };
        const ops = symbolToDrawOps(shape);
        expect(ops.some((o) => o.op === "text")).toBe(false);
      });
    });
  }
});

describe("symbolToDrawOps — labeled symbol flush to the canvas's bottom/right valid edge", () => {
  // Same regression shape PT-4 round 1 required: a labeled symbol at the
  // bottom/right edge of valid placement is exactly where an
  // out-of-box/out-of-canvas label anchor would be caught.
  const CANVAS_W = 640;
  const CANVAS_H = 480;

  for (const def of PID_SYMBOLS) {
    it(`"${def.id}" at the canvas's bottom-right valid edge keeps its label inside both the symbol box and the canvas`, () => {
      const x = CANVAS_W - def.defaultWidth;
      const y = CANVAS_H - def.defaultHeight;
      const shape = {
        id: "m1-1",
        x,
        y,
        ...validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.defaultHeight, label: "Edge" }),
      };
      const ops = symbolToDrawOps(shape);
      const textOp = ops.find((o) => o.op === "text");
      expect(textOp).toBeDefined();
      expect(textOp.x).toBeGreaterThanOrEqual(shape.x);
      expect(textOp.x).toBeLessThanOrEqual(shape.x + shape.w);
      expect(textOp.y).toBeGreaterThanOrEqual(shape.y);
      expect(textOp.y).toBeLessThanOrEqual(shape.y + shape.h);
      expect(textOp.x).toBeLessThanOrEqual(CANVAS_W);
      expect(textOp.y).toBeLessThanOrEqual(CANVAS_H);
      expect(textOp.x + textOp.maxWidth).toBeLessThanOrEqual(CANVAS_W);
    });
  }
});

describe("symbolToDrawOps -> drawOpsToCanvas — overflow-sensitive regression (same shape as PT-4 round 3/4)", () => {
  // PT-4 rounds 2-4 found and then closed a shared-renderer bug
  // (ctx.fillText.length arity probe) and a test-coverage gap (short
  // labels never actually load-bearing). Both are already fully proven
  // generically in annotations-render.test.js and workflow-symbols.test.js
  // against the SAME shared renderer this registry also calls through
  // (symbolToDrawOps's label op uses the identical maxWidth-bounding
  // contract) -- this one test proves PID symbols actually exercise that
  // already-fixed path too, not a full re-proof of the renderer itself.
  const CHAR_WIDTH_ESTIMATE_PX = 6;

  it("a max-length wide label on the registry's smallest symbol, placed flush to the canvas's bottom-right edge, still receives a maxWidth narrow enough to fit", () => {
    const smallest = PID_SYMBOLS.reduce((a, b) =>
      a.minWidth * a.minHeight <= b.minWidth * b.minHeight ? a : b
    );
    const label = "W".repeat(MAX_SYMBOL_LABEL_LENGTH);
    const x = 640 - smallest.minWidth;
    const y = 480 - smallest.minHeight;
    const shape = {
      id: "m1-1",
      x,
      y,
      ...validateSymbolPlacement(smallest.id, { w: smallest.minWidth, h: smallest.minHeight, label }),
    };

    const availableWidth = shape.w - 4 * 2; // mirrors pid-symbols.js's own LABEL_INSET on both sides
    const uncompressedEstimate = label.length * CHAR_WIDTH_ESTIMATE_PX;
    expect(uncompressedEstimate).toBeGreaterThan(availableWidth); // negative control

    const calls = [];
    const ctx = {
      set fillStyle(v) {},
      set strokeStyle(v) {},
      set lineWidth(v) {},
      strokeRect: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      fillText: function fillText(text, x, y) {
        calls.push(["fillText", ...arguments]);
      },
    };
    drawOpsToCanvas(ctx, symbolToDrawOps(shape));

    const fillTextCall = calls.find((c) => c[0] === "fillText" && c[1] === label);
    expect(fillTextCall).toBeDefined();
    const [, , calledX, , passedMaxWidth] = fillTextCall;
    expect(passedMaxWidth).toBeDefined();
    expect(passedMaxWidth).toBeLessThan(uncompressedEstimate);
    expect(passedMaxWidth).toBe(availableWidth);
    expect(calledX + passedMaxWidth).toBeLessThanOrEqual(shape.x + shape.w);
    expect(calledX + passedMaxWidth).toBeLessThanOrEqual(640);
  });
});

describe("validateSymbolPlacement — shared validation rules", () => {
  it("fails closed on non-finite width/height", () => {
    expect(() => validateSymbolPlacement("pid.rotating.generic_driver", { w: NaN, h: 50 })).toThrow(
      PidSymbolError
    );
    expect(() =>
      validateSymbolPlacement("pid.rotating.generic_driver", { w: 100, h: Infinity })
    ).toThrow(PidSymbolError);
  });

  it("fails closed on an empty-after-trim label by treating it as no label, not an error", () => {
    const result = validateSymbolPlacement("pid.rotating.generic_driver", { w: 70, h: 70, label: "   " });
    expect(result.label).toBeNull();
  });

  it("fails closed on an oversized label", () => {
    expect(() =>
      validateSymbolPlacement("pid.rotating.generic_driver", {
        w: 70,
        h: 70,
        label: "x".repeat(MAX_SYMBOL_LABEL_LENGTH + 1),
      })
    ).toThrow(PidSymbolError);
  });

  it("accepts a label exactly at the length cap", () => {
    expect(() =>
      validateSymbolPlacement("pid.rotating.generic_driver", {
        w: 70,
        h: 70,
        label: "x".repeat(MAX_SYMBOL_LABEL_LENGTH),
      })
    ).not.toThrow();
  });

  it("trims whitespace from a label", () => {
    const result = validateSymbolPlacement("pid.rotating.generic_driver", { w: 70, h: 70, label: "  hi  " });
    expect(result.label).toBe("hi");
  });
});

describe("symbolToDrawOps — determinism and purity", () => {
  it("the same shape in always produces the same ops out", () => {
    const shape = { id: "a", symbolType: "pid.vessel.vertical_vessel", x: 10, y: 10, w: 70, h: 110, label: null };
    expect(symbolToDrawOps(shape)).toEqual(symbolToDrawOps(shape));
  });

  it("every symbol's registry buildParts is pure -- calling it twice gives the same result", () => {
    for (const def of PID_SYMBOLS) {
      const a = def.buildParts(def.defaultWidth, def.defaultHeight);
      const b = def.buildParts(def.defaultWidth, def.defaultHeight);
      expect(a).toEqual(b);
    }
  });
});

describe("structural guarantee — no capture, no IPC, no persistence, no network, no DOM/HTML work", () => {
  it("pid-symbols.js never references invoke(), the real session commands, storage, filesystem, network, or innerHTML", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pid-symbols.js"), "utf8");
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
