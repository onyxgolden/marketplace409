// Tests for forge-capture-app/ui/workflow-symbols.js — PT-4's pure
// workflow symbol registry and geometry. No DOM.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKFLOW_SYMBOLS,
  WorkflowSymbolError,
  MAX_SEGMENTS_PER_SYMBOL,
  MAX_SYMBOL_LABEL_LENGTH,
  symbolDefinition,
  validateSymbolPlacement,
  symbolToDrawOps,
} from "../workflow-symbols.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPPORTED_OPS = new Set(["rect", "line", "text"]);

describe("WORKFLOW_SYMBOLS — registry shape", () => {
  it("has exactly 17 symbols, each with a stable snake_case id, name, category, and description", () => {
    expect(WORKFLOW_SYMBOLS).toHaveLength(17);
    const ids = new Set();
    for (const s of WORKFLOW_SYMBOLS) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
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

  it("includes every symbol named in the brief", () => {
    const ids = WORKFLOW_SYMBOLS.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        "process",
        "decision",
        "terminator",
        "data",
        "document",
        "multi_document",
        "predefined_process",
        "database",
        "stored_data",
        "manual_input",
        "manual_operation",
        "preparation",
        "delay",
        "on_page_connector",
        "off_page_connector",
        "display",
        "annotation",
      ].sort()
    );
  });
});

describe("symbolDefinition", () => {
  it("returns the definition for a known id", () => {
    expect(symbolDefinition("process").name).toBe("Process");
  });

  it("fails closed on an unknown id", () => {
    expect(() => symbolDefinition("not_a_symbol")).toThrow(WorkflowSymbolError);
  });
});

describe("validateSymbolPlacement and symbolToDrawOps — every symbol", () => {
  for (const def of WORKFLOW_SYMBOLS) {
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
        // Regression (round 1 review): a labeled symbol's text op used
        // to be anchored below the box, and this test used to skip text
        // ops entirely rather than catch it -- every op, text included,
        // is now actually checked against the box.
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
        ).toThrow(WorkflowSymbolError);
        expect(() =>
          validateSymbolPlacement(def.id, { w: def.defaultWidth, h: def.minHeight - 1 })
        ).toThrow(WorkflowSymbolError);
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
  // Regression (round 1 review): asks specifically for a labeled symbol
  // placed at the bottom/right edge of valid placement, since that's
  // exactly where the old below-the-box label anchor would have
  // overflowed the 640x480 canvas itself, not just the symbol's own box.
  const CANVAS_W = 640;
  const CANVAS_H = 480;

  for (const def of WORKFLOW_SYMBOLS) {
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
      // Inside the symbol's own box...
      expect(textOp.x).toBeGreaterThanOrEqual(shape.x);
      expect(textOp.x).toBeLessThanOrEqual(shape.x + shape.w);
      expect(textOp.y).toBeGreaterThanOrEqual(shape.y);
      expect(textOp.y).toBeLessThanOrEqual(shape.y + shape.h);
      // ...and therefore inside the 640x480 canvas too.
      expect(textOp.x).toBeLessThanOrEqual(CANVAS_W);
      expect(textOp.y).toBeLessThanOrEqual(CANVAS_H);
      expect(textOp.x + textOp.maxWidth).toBeLessThanOrEqual(CANVAS_W);
    });
  }
});

describe("validateSymbolPlacement — shared validation rules", () => {
  it("fails closed on non-finite width/height", () => {
    expect(() => validateSymbolPlacement("process", { w: NaN, h: 50 })).toThrow(WorkflowSymbolError);
    expect(() => validateSymbolPlacement("process", { w: 100, h: Infinity })).toThrow(WorkflowSymbolError);
  });

  it("fails closed on an empty-after-trim label by treating it as no label, not an error", () => {
    const result = validateSymbolPlacement("process", { w: 100, h: 50, label: "   " });
    expect(result.label).toBeNull();
  });

  it("fails closed on an oversized label", () => {
    expect(() =>
      validateSymbolPlacement("process", { w: 100, h: 50, label: "x".repeat(MAX_SYMBOL_LABEL_LENGTH + 1) })
    ).toThrow(WorkflowSymbolError);
  });

  it("accepts a label exactly at the length cap", () => {
    expect(() =>
      validateSymbolPlacement("process", { w: 100, h: 50, label: "x".repeat(MAX_SYMBOL_LABEL_LENGTH) })
    ).not.toThrow();
  });

  it("trims whitespace from a label", () => {
    const result = validateSymbolPlacement("process", { w: 100, h: 50, label: "  hi  " });
    expect(result.label).toBe("hi");
  });
});

describe("symbolToDrawOps — determinism and purity", () => {
  it("the same shape in always produces the same ops out", () => {
    const shape = { id: "a", symbolType: "decision", x: 10, y: 10, w: 100, h: 70, label: null };
    expect(symbolToDrawOps(shape)).toEqual(symbolToDrawOps(shape));
  });

  it("every symbol's registry buildParts is pure -- calling it twice gives the same result", () => {
    for (const def of WORKFLOW_SYMBOLS) {
      const a = def.buildParts(def.defaultWidth, def.defaultHeight);
      const b = def.buildParts(def.defaultWidth, def.defaultHeight);
      expect(a).toEqual(b);
    }
  });
});

describe("structural guarantee — no capture, no IPC, no persistence, no network, no DOM/HTML work", () => {
  it("workflow-symbols.js never references invoke(), the real session commands, storage, filesystem, network, or innerHTML", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "workflow-symbols.js"), "utf8");
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
