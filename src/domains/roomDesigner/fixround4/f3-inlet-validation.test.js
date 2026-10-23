// F3.1 probe (PR #668 fix round 4) — the spray inlet reference and
// approach validation still default malformed or reversed inputs to
// valid supply. ChatGPT's round-3 re-review at head 7a243870, file
// firewater.js:verifiedSpraySupply:
//   1. A persisted inletEnd:"typo" is silently interpreted as "end"
//      (only truthiness is checked before the start/end ternary).
//   2. The approach check uses an absolute elevation difference, so a
//      branch DESCENDING into the below-fed inlet from above verifies
//      exactly like a riser from below.
//   3. connectSprayInlet exists in the domain but no DesignerScreen /
//      reducer path reaches it — a non-seed monitor cannot author
//      the reference the new requirement demands.
//
// These probes FAIL against the round-3 implementation and must PASS
// after the fix: the runtime boundary admits only exact start/end
// (named invalid-reference problem otherwise), the approach must RISE
// into the inlet from below, and the inlet connection is wired
// through the undoable document actions.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
} from "../designerDocument";
import { sprayAssignmentStatus, verifiedSpraySupply } from "../firewater";
import { placeReducer } from "../pipeReducerModel";
import {
  createInitialState,
  designerReducer,
} from "../../../components/designer/designerReducer";

beforeEach(() => {
  resetDesignerIds();
});

const BOUNDARY_AROUND_VESSEL = [
  { x: 900, y: 900 },
  { x: 1100, y: 900 },
  { x: 1100, y: 1100 },
  { x: 900, y: 1100 },
];

function sprayDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 1000, 1000, {
    id: "v",
    tag: "V-101",
  });
  design = placeSymbol(design, "piping", "spray-nozzle", 0, 1000, { id: "s", tag: "FA-101" });
  design = {
    ...design,
    unitBoundary: BOUNDARY_AROUND_VESSEL,
    symbols: design.symbols.map((sy) =>
      sy.id === "v"
        ? { ...sy, flammable: true }
        : sy.id === "s"
          ? { ...sy, protects: "v", aimAt: { x: 1000, y: 1000 } }
          : sy,
    ),
  };
  return design;
}

/**
 * Buried 12-in source main + a 6-in branch junctioned at (0, 0). The
 * branch has three vertices: it leaves the main at -36, holds a
 * preceding elevation (the vertex before the inlet end), and arrives
 * at the inlet at elevation 0. midElevIn < 0 = fed from below (the
 * modeled inlet); midElevIn > 0 = descending from above.
 */
function suppliedDesign({ midElevIn = -36 } = {}) {
  let design = sprayDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 1200, y: 0 }], {
    id: "main",
    diameterIn: 12,
    elevationIn: -36,
    utility: "firewater",
    sourceOf: "firewater",
    underground: true,
  });
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 0, y: 500 }, { x: 0, y: 1000 }], {
    id: "takeoff",
    diameterIn: 6,
    utility: "firewater",
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "takeoff"
        ? { ...p, elevIn: [-36, midElevIn, 0], junctions: { start: { runId: "main" } } }
        : p,
    ),
  };
  design = placeReducer(design, 0, 0, { id: "tap-red", inletSizeIn: 12, outletSizeIn: 6 });
  return design;
}

function withInletRef(design, extra = {}) {
  return {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "s" ? { ...s, inletRunId: "takeoff", inletEnd: "end", ...extra } : s,
    ),
  };
}

const sprayOf = (design) => design.symbols.find((s) => s.id === "s");

describe("F3.1 inlet reference and approach validation fail closed", () => {
  it("valid below-fed positive still verifies (regression partner)", () => {
    const design = withInletRef(suppliedDesign());
    expect(verifiedSpraySupply(design, sprayOf(design))).toMatchObject({ ok: true, problems: [] });
    expect(sprayAssignmentStatus(design, sprayOf(design)).ok).toBe(true);
  });

  it("a malformed persisted inletEnd is an invalid reference, never a silent 'end'", () => {
    const design = withInletRef(suppliedDesign(), { inletEnd: "typo" });
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /invalid|malformed/i.test(p) && /inlet/i.test(p))).toBe(
      true,
    );
    expect(sprayAssignmentStatus(design, sprayOf(design)).ok).toBe(false);
    // The refusal survives the rehydration boundary unchanged.
    const reloaded = parseDesign(serializeDesign(design));
    expect(verifiedSpraySupply(reloaded, sprayOf(reloaded)).ok).toBe(false);
  });

  it("a branch descending into the inlet from above proves no supply", () => {
    const design = withInletRef(suppliedDesign({ midElevIn: 36 }));
    const supply = verifiedSpraySupply(design, sprayOf(design));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /below|riser|above/i.test(p))).toBe(true);
    expect(sprayAssignmentStatus(design, sprayOf(design)).ok).toBe(false);
  });

  it("missing reference and wrong-size negatives still fail closed", () => {
    const unreferenced = suppliedDesign();
    expect(verifiedSpraySupply(unreferenced, sprayOf(unreferenced)).ok).toBe(false);
    const wrongSize = withInletRef(suppliedDesign(), { inletSizeIn: 4 });
    const supply = verifiedSpraySupply(wrongSize, sprayOf(wrongSize));
    expect(supply.ok).toBe(false);
    expect(supply.problems.some((p) => /size|reducer/i.test(p))).toBe(true);
  });
});

describe("F3.1 the inlet connection is wired through the document actions", () => {
  it("SET_SPRAY_INLET authors and clears the reference, undoably, and soft-fails on strangers", () => {
    const base = suppliedDesign();
    let s = createInitialState(base);
    s = designerReducer(s, {
      type: "SET_SPRAY_INLET",
      symbolId: "s",
      runId: "takeoff",
      end: "end",
    });
    const spray = s.design.symbols.find((x) => x.id === "s");
    expect(spray.inletRunId).toBe("takeoff");
    expect(spray.inletEnd).toBe("end");
    expect(verifiedSpraySupply(s.design, spray).ok).toBe(true);

    // A non-firewater / off-face stranger changes nothing (soft fail).
    const before = s;
    s = designerReducer(s, {
      type: "SET_SPRAY_INLET",
      symbolId: "s",
      runId: "takeoff",
      end: "start",
    });
    expect(s).toBe(before);

    // Clearing removes the authored reference; supply lapses honestly.
    s = designerReducer(s, { type: "SET_SPRAY_INLET", symbolId: "s", runId: null });
    const cleared = s.design.symbols.find((x) => x.id === "s");
    expect(cleared.inletRunId).toBeUndefined();
    expect(cleared.inletEnd).toBeUndefined();
    expect(verifiedSpraySupply(s.design, cleared).ok).toBe(false);

    // The whole path is undoable.
    s = designerReducer(s, { type: "UNDO" });
    const restored = s.design.symbols.find((x) => x.id === "s");
    expect(restored.inletRunId).toBe("takeoff");
    expect(restored.inletEnd).toBe("end");
  });
});
