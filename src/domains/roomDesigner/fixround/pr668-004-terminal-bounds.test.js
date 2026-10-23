// PR668-004 probe — the terminal downcomer assembly is geometrically out
// of bounds with no finding. A 30-ft column creates the terminal level at
// 360 in with a 24-in manway whose opening extends past the stated vessel
// height; no shell/head fit rule runs.
//
// These probes FAIL against the current implementation
// (`downcomerGeometryErrors` / `downcomerShellIntervalIn` do not exist) and
// must PASS after the fix: levels bind to an explicit usable-shell/head
// interval; the complete terminal assembly fits inside it or a NAMED
// out-of-bounds validation issue fires. Fixtures: below/exact/above the
// 10-ft rule, the 30-ft terminal, stable IDs, and attached pipes preserved.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import {
  downcomerLevelSpecs,
  downcomerGeometryErrors,
  downcomerShellIntervalIn,
} from "../downcomers";
import { detectRunAttachments } from "../pipeAttachments";

beforeEach(() => {
  resetDesignerIds();
});

function columnDesign(id, heightIn, extra = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "column", 0, 0, { id });
  design = {
    ...design,
    symbols: design.symbols.map((s) => (s.id === id ? { ...s, heightIn, ...extra } : s)),
  };
  const symbol = findSymbol("processEquipment", "column");
  const inst = design.symbols.find((s) => s.id === id);
  return { design, symbol, inst };
}

describe("PR668-004 terminal downcomer assembly bounds", () => {
  it("below 10 ft: no levels; exact 10 ft: one level; above: levels at every 10 ft", () => {
    const below = columnDesign("c-below", 96);
    expect(downcomerLevelSpecs(below.symbol, below.inst)).toHaveLength(0);
    const exact = columnDesign("c-exact", 120);
    const exactLevels = downcomerLevelSpecs(exact.symbol, exact.inst);
    expect(exactLevels.map((l) => l.elevationIn)).toEqual([120]);
    const above = columnDesign("c-above", 300);
    expect(downcomerLevelSpecs(above.symbol, above.inst).map((l) => l.elevationIn)).toEqual([
      120, 240,
    ]);
  });

  it("the usable shell/head interval is explicit on the model", () => {
    const { symbol, inst } = columnDesign("c-int", 360);
    const interval = downcomerShellIntervalIn(symbol, inst);
    expect(interval.minIn).toBe(0);
    expect(interval.maxIn).toBe(360);
    expect(interval.headAllowanceIn).toBeGreaterThan(0);
  });

  it("30-ft terminal assembly fits inside the explicit interval: no finding", () => {
    const { design } = columnDesign("c-30", 360);
    expect(downcomerGeometryErrors(design)).toEqual([]);
  });

  it("a column modeled with NO head allowance gets the named out-of-bounds finding", () => {
    const { design } = columnDesign("c-nohead", 360, { headIn: 0 });
    const errors = downcomerGeometryErrors(design);
    expect(errors.some((e) => /out-of-bounds|out of bounds/i.test(e))).toBe(true);
  });

  it("resizing keeps stable level IDs and preserves attached pipes", () => {
    let { design, symbol } = columnDesign("c-resize", 360);
    // Attach a run end to the level-2 draw outlet anchor (column is
    // 36 in wide; level 2's draw sits at fx=-1 -> x=-18).
    design = addPipeRun(design, [{ x: 1000, y: 0 }, { x: -18, y: 0 }], {
      id: "draw-run",
      diameterIn: 6,
      elevationIn: 240,
    });
    design = detectRunAttachments(design, "draw-run");
    const before = design.pipes.find((p) => p.id === "draw-run");
    expect(before.attachments?.end?.anchorId).toBe("downcomer-2-draw");
    // Shrink below the level-3 elevation: levels 1-2 keep their
    // elevation-derived IDs and the attachment survives.
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "c-resize" ? { ...s, heightIn: 300 } : s)),
    };
    const inst = design.symbols.find((s) => s.id === "c-resize");
    expect(downcomerLevelSpecs(symbol, inst).map((l) => l.index)).toEqual([1, 2]);
    design = detectRunAttachments(design, "draw-run");
    const after = design.pipes.find((p) => p.id === "draw-run");
    expect(after.attachments?.end?.anchorId).toBe("downcomer-2-draw");
  });
});
