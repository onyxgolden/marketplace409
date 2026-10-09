// Tests for forge-capture-app/ui/process-guide-markup.js — PT-3's pure,
// in-memory guide markup overlay. No DOM.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GuideMarkupOverlay,
  MarkupError,
  MARKUP_CANVAS,
  MARKUP_MODEL_VERSION,
  MAX_TEXT_LENGTH,
  resolveMarkupDrawOps,
  projectGuideWithMarkup,
} from "../process-guide-markup.js";
import { WORKFLOW_SYMBOLS } from "../workflow-symbols.js";
import { PID_SYMBOLS } from "../pid-symbols.js";
import { PAPER_SIZES, LEGACY_CANVAS_ID, resolveCanvasSize, canvasSizeKey } from "../markup-canvas-sizes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("GuideMarkupOverlay — add/select/move/delete per step", () => {
  it("adds a rect and returns it from shapesFor", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "rect", { x: 10, y: 10, w: 50, h: 20 });
    const shapes = overlay.shapesFor(1);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ id, kind: "rect", x: 10, y: 10, w: 50, h: 20 });
  });

  it("adds an arrow and a text label", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "arrow", { x1: 0, y1: 0, x2: 100, y2: 100 });
    overlay.addShape(1, "text", { x: 5, y: 5, text: "Click here" });
    const shapes = overlay.shapesFor(1);
    expect(shapes.map((s) => s.kind)).toEqual(["arrow", "text"]);
  });

  it("updates (moves/resizes) an existing shape by id", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.updateShape(1, id, { x: 20, y: 20 });
    const shape = overlay.shapesFor(1)[0];
    expect(shape.x).toBe(20);
    expect(shape.y).toBe(20);
    expect(shape.w).toBe(10); // unpatched fields retained
  });

  it("deletes a shape by id", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.deleteShape(1, id);
    expect(overlay.shapesFor(1)).toEqual([]);
  });

  it("fails closed on an unknown shape id for update/delete", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.updateShape(1, "nope", { x: 1, y: 1 })).toThrow(MarkupError);
    expect(() => overlay.deleteShape(1, "nope")).toThrow(MarkupError);
  });
});

describe("GuideMarkupOverlay — deterministic projection / per-step isolation", () => {
  it("editing one step cannot modify another", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(2, "rect", { x: 5, y: 5, w: 10, h: 10 });
    overlay.deleteShape(1, overlay.shapesFor(1)[0].id);
    expect(overlay.shapesFor(1)).toEqual([]);
    expect(overlay.shapesFor(2)).toHaveLength(1);
  });

  it("stays correctly associated by sequenceId after a different compile/iteration order", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(5, "text", { x: 1, y: 1, text: "note" });
    // Simulate "reordered evidence" by just querying sequenceIds in a
    // different order than they were added -- the overlay is keyed by
    // sequenceId alone, never by array position, so order never matters.
    expect(overlay.shapesFor(5)).toHaveLength(1);
    expect(overlay.shapesFor(5)[0].text).toBe("note");
  });
});

describe("GuideMarkupOverlay — undo/redo", () => {
  it("undo reverts the last add; redo restores it", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    expect(overlay.shapesFor(1)).toHaveLength(1);
    overlay.undo(1);
    expect(overlay.shapesFor(1)).toHaveLength(0);
    overlay.redo(1);
    expect(overlay.shapesFor(1)).toHaveLength(1);
  });

  it("undo/redo are no-ops (return false) when unavailable, not errors", () => {
    const overlay = new GuideMarkupOverlay();
    expect(overlay.canUndo(1)).toBe(false);
    expect(overlay.undo(1)).toBe(false);
    expect(overlay.canRedo(1)).toBe(false);
    expect(overlay.redo(1)).toBe(false);
  });

  it("a new action after undo clears the redo stack", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.undo(1);
    overlay.addShape(1, "rect", { x: 5, y: 5, w: 10, h: 10 });
    expect(overlay.canRedo(1)).toBe(false);
  });
});

describe("GuideMarkupOverlay — empty state", () => {
  it("a step with no markup yet returns an empty array, not an error", () => {
    const overlay = new GuideMarkupOverlay();
    expect(overlay.shapesFor(999)).toEqual([]);
    expect(overlay.canUndo(999)).toBe(false);
  });
});

describe("GuideMarkupOverlay — immutable input / output", () => {
  it("shapesFor returns a copy, not a live reference", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    const shapes = overlay.shapesFor(1);
    shapes[0].x = 999; // mutate the returned copy
    expect(overlay.shapesFor(1)[0].x).toBe(0); // internal state untouched
  });
});

describe("GuideMarkupOverlay — malformed input fails closed", () => {
  it("rejects an unknown shape kind", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.addShape(1, "circle", {})).toThrow(MarkupError);
  });

  it("rejects a malformed sequenceId", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.addShape(-1, "rect", { x: 0, y: 0, w: 10, h: 10 })).toThrow(MarkupError);
    expect(() => overlay.addShape(1.5, "rect", { x: 0, y: 0, w: 10, h: 10 })).toThrow(MarkupError);
    expect(() => overlay.addShape("x", "rect", { x: 0, y: 0, w: 10, h: 10 })).toThrow(MarkupError);
  });

  it("rejects a rect with non-positive dimensions or out-of-bounds placement", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.addShape(1, "rect", { x: 0, y: 0, w: 0, h: 10 })).toThrow(MarkupError);
    expect(() => overlay.addShape(1, "rect", { x: 0, y: 0, w: -5, h: 10 })).toThrow(MarkupError);
    expect(() =>
      overlay.addShape(1, "rect", { x: MARKUP_CANVAS.width - 1, y: 0, w: 10, h: 10 })
    ).toThrow(MarkupError);
  });

  it("rejects an arrow with identical endpoints or out-of-bounds points", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.addShape(1, "arrow", { x1: 5, y1: 5, x2: 5, y2: 5 })).toThrow(MarkupError);
    expect(() =>
      overlay.addShape(1, "arrow", { x1: -1, y1: 0, x2: 10, y2: 10 })
    ).toThrow(MarkupError);
  });

  it("rejects an empty or overlong text annotation", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.addShape(1, "text", { x: 0, y: 0, text: "" })).toThrow(MarkupError);
    expect(() => overlay.addShape(1, "text", { x: 0, y: 0, text: "   " })).toThrow(MarkupError);
    expect(() =>
      overlay.addShape(1, "text", { x: 0, y: 0, text: "x".repeat(MAX_TEXT_LENGTH + 1) })
    ).toThrow(MarkupError);
  });

  it("accepts a text annotation right at the length cap", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "text", { x: 0, y: 0, text: "x".repeat(MAX_TEXT_LENGTH) })
    ).not.toThrow();
  });
});

describe("GuideMarkupOverlay — clearStep / clearAll", () => {
  it("clearStep removes one step's markup and history only", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(2, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.clearStep(1);
    expect(overlay.shapesFor(1)).toEqual([]);
    expect(overlay.shapesFor(2)).toHaveLength(1);
  });

  it("clearAll removes every step's markup", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(2, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.clearAll();
    expect(overlay.shapesFor(1)).toEqual([]);
    expect(overlay.shapesFor(2)).toEqual([]);
  });
});

describe("resolveMarkupDrawOps", () => {
  it("emits a rect op for a rect shape", () => {
    const ops = resolveMarkupDrawOps([{ id: "a", kind: "rect", x: 1, y: 2, w: 3, h: 4 }]);
    expect(ops).toEqual([
      expect.objectContaining({ op: "rect", id: "a", x: 1, y: 2, w: 3, h: 4 }),
    ]);
  });

  it("emits a line + filledTriangle (arrowhead) for an arrow shape", () => {
    const ops = resolveMarkupDrawOps([{ id: "a", kind: "arrow", x1: 0, y1: 0, x2: 50, y2: 0 }]);
    expect(ops.map((o) => o.op)).toEqual(["line", "filledTriangle"]);
  });

  it("emits a text op for a text shape, carrying the plain text through unescaped (escaping is the renderer's job)", () => {
    const ops = resolveMarkupDrawOps([{ id: "a", kind: "text", x: 1, y: 1, text: "<b>hi</b>" }]);
    expect(ops[0]).toMatchObject({ op: "text", text: "<b>hi</b>" });
  });

  it("is pure -- the same shapes in always produce the same ops out", () => {
    const shapes = [{ id: "a", kind: "rect", x: 1, y: 2, w: 3, h: 4 }];
    expect(resolveMarkupDrawOps(shapes)).toEqual(resolveMarkupDrawOps(shapes));
  });
});

describe("projectGuideWithMarkup", () => {
  const guide = { schemaVersion: 1, source: "fixture", status: "draft_unverified", steps: [{ sequenceId: 1 }, { sequenceId: 2 }] };

  it("attaches each step's markup by sequenceId", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    const projected = projectGuideWithMarkup(guide, overlay);
    expect(projected.steps[0].markup).toHaveLength(1);
    expect(projected.steps[1].markup).toEqual([]);
  });

  it("never mutates the input guide", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    const before = JSON.parse(JSON.stringify(guide));
    projectGuideWithMarkup(guide, overlay);
    expect(guide).toEqual(before);
  });

  it("never changes source/status -- markup never promotes draft_unverified to verified", () => {
    const overlay = new GuideMarkupOverlay();
    const projected = projectGuideWithMarkup(guide, overlay);
    expect(projected.source).toBe("fixture");
    expect(projected.status).toBe("draft_unverified");
  });

  it("fails closed on a guide with no steps array", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => projectGuideWithMarkup({}, overlay)).toThrow(MarkupError);
    expect(() => projectGuideWithMarkup(null, overlay)).toThrow(MarkupError);
  });
});

describe("structural guarantee — no capture, no IPC, no persistence, no DOM/HTML work", () => {
  it("process-guide-markup.js never references invoke(), the real session commands, storage, filesystem, network, or innerHTML", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-markup.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    // Matches actual API usage (a property/call access), not this file's
    // own header comment naming the prohibited APIs in prose.
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\s*[.(]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/writeFile|readFile|require\(["']fs["']\)|from ["']fs["']/);
    // Matches actual innerHTML assignment/access, not this file's own
    // header comments discussing it in prose.
    expect(source).not.toMatch(/\.innerHTML\s*[=.]/);
  });
});

describe("PT-4: GuideMarkupOverlay — symbol kind", () => {
  it("adds every one of the 17 registry symbols at its own default size", () => {
    const overlay = new GuideMarkupOverlay();
    for (const def of WORKFLOW_SYMBOLS) {
      expect(() =>
        overlay.addShape(1, "symbol", {
          symbolType: def.id,
          x: 10,
          y: 10,
          w: def.defaultWidth,
          h: def.defaultHeight,
        })
      ).not.toThrow();
    }
    expect(overlay.shapesFor(1)).toHaveLength(WORKFLOW_SYMBOLS.length);
  });

  it("legacy rect/arrow/text kinds still work unchanged alongside symbols", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(1, "arrow", { x1: 0, y1: 0, x2: 50, y2: 50 });
    overlay.addShape(1, "text", { x: 0, y: 0, text: "hi" });
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    expect(overlay.shapesFor(1).map((s) => s.kind)).toEqual(["rect", "arrow", "text", "symbol"]);
  });

  it("fails closed on an unknown symbolType", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", { symbolType: "not_a_symbol", x: 0, y: 0, w: 100, h: 50 })
    ).toThrow(MarkupError);
  });

  it("fails closed on a symbol below its own registry minimum size", () => {
    const overlay = new GuideMarkupOverlay();
    const def = WORKFLOW_SYMBOLS.find((s) => s.id === "process");
    expect(() =>
      overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: def.minWidth - 1, h: def.defaultHeight })
    ).toThrow(MarkupError);
  });

  it("fails closed on a symbol placed outside the shared markup canvas", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", {
        symbolType: "process",
        x: MARKUP_CANVAS.width - 10,
        y: 0,
        w: 100,
        h: 50,
      })
    ).toThrow(MarkupError);
  });

  it("fails closed on an oversized symbol label", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", {
        symbolType: "process",
        x: 0,
        y: 0,
        w: 100,
        h: 50,
        label: "x".repeat(100),
      })
    ).toThrow(MarkupError);
  });

  it("undo/redo/delete work for symbol shapes exactly as for the legacy kinds", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "symbol", { symbolType: "decision", x: 10, y: 10, w: 100, h: 70 });
    expect(overlay.shapesFor(1)).toHaveLength(1);
    overlay.undo(1);
    expect(overlay.shapesFor(1)).toHaveLength(0);
    overlay.redo(1);
    expect(overlay.shapesFor(1)).toHaveLength(1);
    overlay.deleteShape(1, id);
    expect(overlay.shapesFor(1)).toHaveLength(0);
  });

  it("symbol placement and legacy shapes share one undo history per step, in order", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(1, "symbol", { symbolType: "process", x: 20, y: 20, w: 100, h: 50 });
    expect(overlay.shapesFor(1)).toHaveLength(2);
    overlay.undo(1); // undoes the symbol add
    expect(overlay.shapesFor(1).map((s) => s.kind)).toEqual(["rect"]);
  });

  it("switching steps keeps each step's own symbol history separate", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    overlay.addShape(2, "symbol", { symbolType: "decision", x: 0, y: 0, w: 100, h: 70 });
    expect(overlay.shapesFor(1)).toHaveLength(1);
    expect(overlay.shapesFor(2)).toHaveLength(1);
    overlay.undo(1);
    expect(overlay.shapesFor(1)).toHaveLength(0);
    expect(overlay.shapesFor(2)).toHaveLength(1); // untouched
  });

  it("resolveMarkupDrawOps renders a symbol shape via workflow-symbols.js, emitting only supported ops", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "database", x: 10, y: 10, w: 90, h: 60, label: "Orders" });
    const ops = resolveMarkupDrawOps(overlay.shapesFor(1));
    expect(ops.length).toBeGreaterThan(0);
    const allowed = new Set(["rect", "line", "text"]);
    for (const op of ops) {
      expect(allowed.has(op.op)).toBe(true);
    }
    expect(ops.some((o) => o.op === "text" && o.text === "Orders")).toBe(true);
  });

  it("MARKUP_MODEL_VERSION is 3 and is a diagnostic constant only -- never written onto PT-2's guide", () => {
    // 3, not the PT-4/PT-5 baseline of 2 -- bumped for the plotter-size
    // slice's additive per-step canvas-size field (see this file's own
    // header comment). Still never a persisted schema version.
    expect(MARKUP_MODEL_VERSION).toBe(3);
    const guide = { schemaVersion: 1, source: "fixture", status: "draft_unverified", steps: [{ sequenceId: 1 }] };
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    const projected = projectGuideWithMarkup(guide, overlay);
    expect(projected.source).toBe("fixture");
    expect(projected.status).toBe("draft_unverified");
    expect(projected).not.toHaveProperty("markupModelVersion");
  });
});

describe("PT-5: GuideMarkupOverlay — pid.* symbol kind, via the shared symbol-registry.js adapter", () => {
  // Same `symbol` kind as PT-4 -- no new MARKUP_SHAPE_KINDS entry, no
  // MARKUP_MODEL_VERSION bump (see this file's own header comment for
  // why). Only the symbolType namespace differs (`pid.<family>.<name>`
  // vs PT-4's plain snake_case), dispatched by symbol-registry.js, which
  // this module calls exclusively -- it never imports pid-symbols.js
  // directly.

  it("adds every one of the 35 registry symbols at its own default size", () => {
    const overlay = new GuideMarkupOverlay();
    for (const def of PID_SYMBOLS) {
      expect(() =>
        overlay.addShape(1, "symbol", {
          symbolType: def.id,
          x: 10,
          y: 10,
          w: def.defaultWidth,
          h: def.defaultHeight,
        })
      ).not.toThrow();
    }
    expect(overlay.shapesFor(1)).toHaveLength(PID_SYMBOLS.length);
  });

  it("a PT-4 workflow symbol and a PT-5 pid symbol coexist on the same step, each rendering through its own registry", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    overlay.addShape(1, "symbol", { symbolType: "pid.rotating.centrifugal_pump", x: 150, y: 0, w: 70, h: 70 });
    const shapes = overlay.shapesFor(1);
    expect(shapes.map((s) => s.symbolType)).toEqual(["process", "pid.rotating.centrifugal_pump"]);
    const ops = resolveMarkupDrawOps(shapes);
    expect(ops.length).toBeGreaterThan(0);
    const allowed = new Set(["rect", "line", "text"]);
    for (const op of ops) {
      expect(allowed.has(op.op)).toBe(true);
    }
  });

  it("legacy rect/arrow/text and PT-4 workflow symbols still work unchanged alongside pid symbols", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.addShape(1, "arrow", { x1: 0, y1: 0, x2: 50, y2: 50 });
    overlay.addShape(1, "text", { x: 0, y: 0, text: "hi" });
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    overlay.addShape(1, "symbol", { symbolType: "pid.flare.flare_stack", x: 200, y: 0, w: 40, h: 110 });
    expect(overlay.shapesFor(1).map((s) => s.kind)).toEqual(["rect", "arrow", "text", "symbol", "symbol"]);
  });

  it("fails closed on an unknown pid.* symbolType", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", { symbolType: "pid.not.a_symbol", x: 0, y: 0, w: 100, h: 50 })
    ).toThrow(MarkupError);
  });

  it("fails closed on a pid symbol below its own registry minimum size", () => {
    const overlay = new GuideMarkupOverlay();
    const def = PID_SYMBOLS.find((s) => s.id === "pid.rotating.generic_driver");
    expect(() =>
      overlay.addShape(1, "symbol", {
        symbolType: def.id,
        x: 0,
        y: 0,
        w: def.minWidth - 1,
        h: def.defaultHeight,
      })
    ).toThrow(MarkupError);
  });

  it("fails closed on a pid symbol placed outside the shared markup canvas", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", {
        symbolType: "pid.rotating.generic_driver",
        x: MARKUP_CANVAS.width - 10,
        y: 0,
        w: 70,
        h: 70,
      })
    ).toThrow(MarkupError);
  });

  it("fails closed on an oversized pid symbol label", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() =>
      overlay.addShape(1, "symbol", {
        symbolType: "pid.rotating.generic_driver",
        x: 0,
        y: 0,
        w: 70,
        h: 70,
        label: "x".repeat(100),
      })
    ).toThrow(MarkupError);
  });

  it("undo/redo/delete work for pid symbol shapes exactly as for PT-4 workflow symbols", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "symbol", { symbolType: "pid.vessel.vertical_vessel", x: 10, y: 10, w: 70, h: 110 });
    expect(overlay.shapesFor(1)).toHaveLength(1);
    overlay.undo(1);
    expect(overlay.shapesFor(1)).toHaveLength(0);
    overlay.redo(1);
    expect(overlay.shapesFor(1)).toHaveLength(1);
    overlay.deleteShape(1, id);
    expect(overlay.shapesFor(1)).toHaveLength(0);
  });

  it("switching steps keeps each step's own pid symbol history separate, same as PT-4 workflow symbols", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "pid.rotating.generic_driver", x: 0, y: 0, w: 70, h: 70 });
    overlay.addShape(2, "symbol", { symbolType: "pid.flare.flare_stack", x: 0, y: 0, w: 40, h: 110 });
    expect(overlay.shapesFor(1)).toHaveLength(1);
    expect(overlay.shapesFor(2)).toHaveLength(1);
    overlay.undo(1);
    expect(overlay.shapesFor(1)).toHaveLength(0);
    expect(overlay.shapesFor(2)).toHaveLength(1); // untouched
  });

  it("resolveMarkupDrawOps renders a pid symbol shape via symbol-registry.js, emitting only supported ops", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "pid.exchanger.shell_and_tube", x: 10, y: 10, w: 110, h: 50, label: "E-101" });
    const ops = resolveMarkupDrawOps(overlay.shapesFor(1));
    expect(ops.length).toBeGreaterThan(0);
    const allowed = new Set(["rect", "line", "text"]);
    for (const op of ops) {
      expect(allowed.has(op.op)).toBe(true);
    }
    expect(ops.some((o) => o.op === "text" && o.text === "E-101")).toBe(true);
  });

  it("MARKUP_MODEL_VERSION is 3 with a pid symbol present -- never bumped merely for allowlisted symbol IDs", () => {
    // 3 per the plotter-size slice's own bump (see the other
    // MARKUP_MODEL_VERSION test's comment) -- the point of this test is
    // still that adding a PT-5 symbol alone never bumps it further.
    expect(MARKUP_MODEL_VERSION).toBe(3);
    const guide = { schemaVersion: 1, source: "fixture", status: "draft_unverified", steps: [{ sequenceId: 1 }] };
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "pid.rotating.generic_driver", x: 0, y: 0, w: 70, h: 70 });
    const projected = projectGuideWithMarkup(guide, overlay);
    expect(projected.source).toBe("fixture");
    expect(projected.status).toBe("draft_unverified");
    expect(projected).not.toHaveProperty("markupModelVersion");
  });
});

describe("Plotter-size Slice A: GuideMarkupOverlay — per-step canvas size", () => {
  it("defaults every new step to the legacy 640x480 canvas, unstamped behavior unchanged", () => {
    const overlay = new GuideMarkupOverlay();
    expect(overlay.canvasSizeFor(1)).toEqual({ id: "legacy", orientation: null, width: 640, height: 480 });
  });

  describe("canvasSizeFor returns a frozen identity (review finding, round 1)", () => {
    // markup-canvas-sizes.js's own tests prove resolveCanvasSize itself
    // returns frozen objects; these prove that guarantee actually reaches
    // callers THROUGH this overlay, specifically closing the cross-step
    // contamination the review named: every legacy-default step shares
    // the one DEFAULT_CANVAS_SIZE instance by reference, so an unfrozen
    // result would let mutating one step's returned object corrupt every
    // other legacy step's bounds too.
    it("the legacy-default canvas returned for a step is frozen; mutating it throws and leaves it (and the step) unchanged", () => {
      const overlay = new GuideMarkupOverlay();
      const size = overlay.canvasSizeFor(1);
      expect(Object.isFrozen(size)).toBe(true);
      expect(() => {
        size.width = 999999;
      }).toThrow(TypeError);
      expect(overlay.canvasSizeFor(1).width).toBe(640);
    });

    it("a non-legacy canvas returned for a step is also frozen; mutating it throws and leaves it unchanged", () => {
      const overlay = new GuideMarkupOverlay();
      overlay.setCanvasSize(1, "ansi_b", "landscape");
      const size = overlay.canvasSizeFor(1);
      expect(Object.isFrozen(size)).toBe(true);
      expect(() => {
        size.width = 999999;
      }).toThrow(TypeError);
      expect(overlay.canvasSizeFor(1).width).toBe(17 * 96);
    });

    it("an attempted mutation of one legacy-default step's returned canvas cannot corrupt an UNRELATED legacy-default step's canvas (the exact cross-step scenario the review named)", () => {
      const overlay = new GuideMarkupOverlay();
      const size1 = overlay.canvasSizeFor(1); // never switched -- shares DEFAULT_CANVAS_SIZE by reference
      try {
        size1.width = 999999;
      } catch {
        /* expected -- frozen */
      }
      expect(overlay.canvasSizeFor(2)).toEqual({ id: "legacy", orientation: null, width: 640, height: 480 });
    });

    it("an attempted mutation of a returned canvas cannot widen what addShape will accept -- shape bounds stay governed by the real, unmutated canvas", () => {
      const overlay = new GuideMarkupOverlay();
      const size = overlay.canvasSizeFor(1); // legacy, 640x480
      try {
        size.width = 999999; // an attacker/bug trying to widen the legacy bound
      } catch {
        /* expected -- frozen */
      }
      // Still rejected: the real legacy width (640) governs validation,
      // not whatever a caller tried to write onto the returned object.
      expect(() => overlay.addShape(1, "rect", { x: 900, y: 10, w: 10, h: 10 })).toThrow(MarkupError);
    });
  });

  for (const def of PAPER_SIZES) {
    for (const orientation of ["landscape", "portrait"]) {
      it(`switches an empty step to "${def.id}" ${orientation} and resolves exactly as markup-canvas-sizes.js would`, () => {
        const overlay = new GuideMarkupOverlay();
        const resolved = overlay.setCanvasSize(1, def.id, orientation);
        expect(resolved).toEqual(resolveCanvasSize(def.id, orientation));
        expect(overlay.canvasSizeFor(1)).toEqual(resolved);
      });
    }
  }

  it("fails closed on an unknown size id or invalid orientation, as MarkupError, without mutating the step's current size", () => {
    const overlay = new GuideMarkupOverlay();
    expect(() => overlay.setCanvasSize(1, "not_a_size", "landscape")).toThrow(MarkupError);
    expect(() => overlay.setCanvasSize(1, "ansi_b", "sideways")).toThrow(MarkupError);
    expect(overlay.canvasSizeFor(1).id).toBe("legacy"); // unchanged
  });

  it("rejects switching a step that already has a shape, without mutating size or shapes", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    expect(() => overlay.setCanvasSize(1, "ansi_b", "landscape")).toThrow(MarkupError);
    expect(overlay.canvasSizeFor(1).id).toBe("legacy");
    expect(overlay.shapesFor(1)).toHaveLength(1);
  });

  it("rejects switching a step that has undo history even after its shapes are individually deleted", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    overlay.deleteShape(1, id); // shapes is now empty again, but undo/redo history is not
    expect(overlay.shapesFor(1)).toHaveLength(0);
    expect(() => overlay.setCanvasSize(1, "ansi_b", "landscape")).toThrow(MarkupError);
  });

  it("allows switching again after clearStep (the brief's own 'offer explicit clear-step/history first')", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 });
    expect(() => overlay.setCanvasSize(1, "ansi_b", "landscape")).toThrow(MarkupError);
    overlay.clearStep(1);
    expect(() => overlay.setCanvasSize(1, "ansi_b", "landscape")).not.toThrow();
    expect(overlay.canvasSizeFor(1).id).toBe("ansi_b");
  });

  it("never migrates, rescales, or discards shapes merely because a later switch attempt is rejected", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "rect", { x: 10, y: 10, w: 20, h: 20 });
    const before = overlay.shapesFor(1);
    try {
      overlay.setCanvasSize(1, "ansi_b", "landscape");
    } catch {
      /* expected */
    }
    expect(overlay.shapesFor(1)).toEqual(before);
  });

  it("validates a shape against the step's OWN current canvas, not the legacy default", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_b", "landscape"); // 1632x1056
    // Well outside legacy's 640x480, but inside ansi_b landscape -- this
    // must succeed, proving bounds really did move with the canvas.
    expect(() => overlay.addShape(1, "rect", { x: 1000, y: 900, w: 50, h: 50 })).not.toThrow();
  });

  it("rejects a shape placed outside the step's actual (non-legacy) canvas edge", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_b", "portrait");
    const size = resolveCanvasSize("ansi_b", "portrait");
    expect(() => overlay.addShape(1, "rect", { x: size.width - 10, y: 0, w: 20, h: 10 })).toThrow(MarkupError);
  });

  it("mixed-size steps stay fully isolated -- each keeps its own canvas and bounds independently", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_e", "landscape"); // 4224x3264, the largest
    overlay.setCanvasSize(2, "ansi_b", "landscape"); // 1632x1056, the smallest
    expect(() => overlay.addShape(1, "rect", { x: 4000, y: 3000, w: 50, h: 50 })).not.toThrow();
    expect(() => overlay.addShape(2, "rect", { x: 4000, y: 3000, w: 50, h: 50 })).toThrow(MarkupError);
    expect(overlay.canvasSizeFor(1).id).toBe("ansi_e");
    expect(overlay.canvasSizeFor(2).id).toBe("ansi_b");
  });

  it("sequenceId reorder/renumbering in a later compile does not move a step's own canvas size -- it's keyed by sequenceId, same as shapes", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(5, "arch_d", "portrait");
    expect(overlay.canvasSizeFor(5).id).toBe("arch_d");
    expect(overlay.canvasSizeFor(3).id).toBe("legacy"); // an unrelated sequenceId is unaffected
  });

  it("stamps every new shape with the step's current canvasId, preserved (not recomputed) across updateShape", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_b", "landscape");
    const id = overlay.addShape(1, "rect", { x: 10, y: 10, w: 20, h: 20 });
    const expectedKey = canvasSizeKey(resolveCanvasSize("ansi_b", "landscape"));
    expect(overlay.shapesFor(1)[0].canvasId).toBe(expectedKey);
    overlay.updateShape(1, id, { x: 50, y: 50 });
    expect(overlay.shapesFor(1)[0].canvasId).toBe(expectedKey);
  });

  it("legacy-canvas shapes are stamped with the legacy canvasId -- 'legacy unstamped shapes mean legacy canvas only' holds as a real, checkable invariant", () => {
    const overlay = new GuideMarkupOverlay();
    const id = overlay.addShape(1, "rect", { x: 0, y: 0, w: 10, h: 10 }); // never called setCanvasSize
    expect(overlay.shapesFor(1).find((s) => s.id === id).canvasId).toBe(canvasSizeKey({ id: "legacy", orientation: null }));
  });

  it("undo/redo stay within one canvas identity -- restoring a snapshot never changes the step's current canvas", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_b", "landscape");
    overlay.addShape(1, "rect", { x: 10, y: 10, w: 20, h: 20 });
    overlay.undo(1);
    expect(overlay.canvasSizeFor(1).id).toBe("ansi_b"); // unchanged by undo
    overlay.redo(1);
    expect(overlay.canvasSizeFor(1).id).toBe("ansi_b"); // unchanged by redo
  });

  it("clearStep resets a step back to the legacy canvas (the explicit unlock point) and clearAll does the same for every step", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_b", "landscape");
    overlay.setCanvasSize(2, "arch_c", "portrait");
    overlay.clearStep(1);
    expect(overlay.canvasSizeFor(1).id).toBe("legacy");
    expect(overlay.canvasSizeFor(2).id).toBe("arch_c"); // untouched by clearStep(1)
    overlay.clearAll();
    expect(overlay.canvasSizeFor(2).id).toBe("legacy");
  });

  it("every workflow symbol fits a labeled placement at the largest sheet (ARCH E landscape)'s own edges", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "arch_e", "landscape"); // 4608x3456
    const canvasSize = overlay.canvasSizeFor(1);
    for (const def of WORKFLOW_SYMBOLS) {
      const x = canvasSize.width - def.defaultWidth;
      const y = canvasSize.height - def.defaultHeight;
      expect(() =>
        overlay.addShape(1, "symbol", { symbolType: def.id, x, y, w: def.defaultWidth, h: def.defaultHeight, label: "Edge" })
      ).not.toThrow();
      overlay.deleteShape(1, overlay.shapesFor(1).at(-1).id);
    }
  });

  it("every P&ID symbol fits a labeled placement at the largest sheet (ARCH E landscape)'s own edges", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "arch_e", "landscape");
    const canvasSize = overlay.canvasSizeFor(1);
    for (const def of PID_SYMBOLS) {
      const x = canvasSize.width - def.defaultWidth;
      const y = canvasSize.height - def.defaultHeight;
      expect(() =>
        overlay.addShape(1, "symbol", { symbolType: def.id, x, y, w: def.defaultWidth, h: def.defaultHeight, label: "Edge" })
      ).not.toThrow();
      overlay.deleteShape(1, overlay.shapesFor(1).at(-1).id);
    }
  });

  it("a text annotation's maxWidth stays bounded against the step's actual (larger) canvas, via resolveMarkupDrawOps's canvasSize parameter", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.setCanvasSize(1, "ansi_e", "landscape"); // 4224x3264
    overlay.addShape(1, "text", { x: 4000, y: 100, text: "hi" });
    const shapes = overlay.shapesFor(1);
    const canvasSize = overlay.canvasSizeFor(1);
    const ops = resolveMarkupDrawOps(shapes, canvasSize);
    const textOp = ops.find((o) => o.op === "text");
    expect(textOp.maxWidth).toBe(canvasSize.width - 4000);
  });

  it("resolveMarkupDrawOps without a canvasSize argument keeps its exact prior legacy-bounded behavior (default parameter, backward compatible)", () => {
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "text", { x: 600, y: 100, text: "hi" });
    const ops = resolveMarkupDrawOps(overlay.shapesFor(1)); // no second argument
    const textOp = ops.find((o) => o.op === "text");
    expect(textOp.maxWidth).toBe(MARKUP_CANVAS.width - 600);
  });
});
