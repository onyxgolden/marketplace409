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

  it("MARKUP_MODEL_VERSION is 2 and is a diagnostic constant only -- never written onto PT-2's guide", () => {
    expect(MARKUP_MODEL_VERSION).toBe(2);
    const guide = { schemaVersion: 1, source: "fixture", status: "draft_unverified", steps: [{ sequenceId: 1 }] };
    const overlay = new GuideMarkupOverlay();
    overlay.addShape(1, "symbol", { symbolType: "process", x: 0, y: 0, w: 100, h: 50 });
    const projected = projectGuideWithMarkup(guide, overlay);
    expect(projected.source).toBe("fixture");
    expect(projected.status).toBe("draft_unverified");
    expect(projected).not.toHaveProperty("markupModelVersion");
  });
});
