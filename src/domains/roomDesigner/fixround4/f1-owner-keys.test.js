// F1.1 probe (PR #668 fix round 4) — distinct nozzle owners compare
// equal through ambiguous string keys. ChatGPT's round-3 re-review at
// head 7a243870: pipeReducerModel.reducerOwnerKey encodes owner
// identity by raw colon concatenation; identifiers are not restricted
// to exclude the delimiter, so { nozzle, "v:a", "b" } and
// { nozzle, "v", "a:b" } both key as "nozzle:v:a:b" and compare
// equal — defeating the exact owner-pair binding F1 built.
//
// These probes FAIL against the round-3 implementation and must PASS
// after the fix: owner identity is compared as validated structured
// references (canonical encoding over closed kind-specific schemas),
// malformed references refuse (never compare equal, never bind), and
// the unordered pair-dedup key is equally unambiguous.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
} from "../designerDocument";
import { connectionCompatibilityErrors } from "../pipeAttachments";
import {
  boundReducerAt,
  normalizeOwnerRef,
  ownerPairKey,
  placeReducer,
  reducerErrors,
  reducerOwnerKey,
  reducerOwnersEqual,
} from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

const NOZZLE_A = { kind: "nozzle", symbolId: "v:a", anchorId: "b" };
const NOZZLE_B = { kind: "nozzle", symbolId: "v", anchorId: "a:b" };

/**
 * ChatGPT's executed public-path counterexample: two distinct vessel
 * instances ("v:a" with authored nozzle "b", "v" with authored nozzle
 * "a:b") whose faces coincide at (24, 0), elevation 74.4. A 6-in run
 * attaches to v:a/b and a 6->8 reducer is bound to that exact pair.
 */
function collisionDesign() {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v:a" });
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "v:a"
        ? { ...s, nozzles: [{ id: "b", fx: 1, fy: 0, sizeIn: 8 }] }
        : s.id === "v"
          ? { ...s, nozzles: [{ id: "a:b", fx: 1, fy: 0, sizeIn: 8 }] }
          : s,
    ),
  };
  design = addPipeRun(design, [{ x: 200, y: 0 }, { x: 24, y: 0 }], {
    id: "r",
    diameterIn: 6,
    elevationIn: 74.4,
  });
  design = {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "r"
        ? { ...p, attachments: { end: { symbolId: "v:a", anchorId: "b" } } }
        : p,
    ),
  };
  design = placeReducer(design, 24, 0, { id: "red", inletSizeIn: 8, outletSizeIn: 6 });
  return design;
}

function reattachToOtherNozzle(design) {
  return {
    ...design,
    pipes: design.pipes.map((p) =>
      p.id === "r"
        ? { ...p, attachments: { end: { symbolId: "v", anchorId: "a:b" } } }
        : p,
    ),
  };
}

describe("F1.1 owner identity is a structured reference, not a string", () => {
  it("the colliding tuples key differently and do not compare equal", () => {
    expect(reducerOwnerKey(NOZZLE_A)).not.toBe(reducerOwnerKey(NOZZLE_B));
    expect(reducerOwnersEqual(NOZZLE_A, NOZZLE_B)).toBe(false);
    expect(reducerOwnersEqual(NOZZLE_A, { ...NOZZLE_A })).toBe(true);
  });

  it("public path: re-attaching to the colliding nozzle defeats the persisted binding", () => {
    let design = collisionDesign();
    // Positive control: the bound pair validates clean.
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    // Re-attach the run to the OTHER instance's face without touching
    // the reducer's persisted owner. The stored reducer still names
    // v:a/b — the v/a:b face must NOT be accepted through it.
    design = reattachToOtherNozzle(design);
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => e.includes("r") && /reducer/i.test(e))).toBe(true);
    // The refusal survives a save/reload round trip.
    const reloaded = parseDesign(serializeDesign(design));
    expect(
      connectionCompatibilityErrors(reloaded).some((e) => /reducer/i.test(e)),
    ).toBe(true);
  });

  it("malformed references refuse: no key, no equality, no binding", () => {
    const malformed = [
      null,
      "nozzle:v:b",
      { kind: "bogus", symbolId: "v", anchorId: "b" },
      { kind: "nozzle", symbolId: 42, anchorId: "b" },
      { kind: "nozzle", symbolId: "v" },
      { kind: "nozzle", symbolId: "v", anchorId: "b", extra: 1 },
      { kind: "run-end", runId: "r", end: "middle" },
      { kind: "run-segment", runId: "h", segmentIndex: null },
      { kind: "run-segment", runId: "h", segmentIndex: -1 },
      { kind: "run-segment", runId: "h", segmentIndex: 0.5 },
    ];
    for (const ref of malformed) {
      expect(normalizeOwnerRef(ref)).toBeNull();
      expect(reducerOwnerKey(ref)).toBeNull();
      expect(reducerOwnersEqual(ref, ref)).toBe(false);
      expect(reducerOwnersEqual(ref, NOZZLE_A)).toBe(false);
    }
    // A malformed side owner binds nothing at a real transition.
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
      id: "h",
      diameterIn: 2,
      elevationIn: 150,
    });
    design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
      id: "b",
      diameterIn: 1,
      elevationIn: 150,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "b" ? { ...p, junctions: { start: { runId: "h" } } } : p,
      ),
    };
    design = placeReducer(design, 50, 0, {
      id: "red",
      inletSizeIn: 2,
      outletSizeIn: 1,
      rotationDeg: 90,
    });
    const sides = (owner) => [
      { sizeIn: 1, dirDeg: 90, owner },
      {
        sizeIn: 2,
        dirDeg: 270,
        owner: { kind: "run-segment", runId: "h", segmentIndex: 0 },
      },
    ];
    expect(
      boundReducerAt(design, {
        x: 50,
        y: 0,
        elevationIn: 150,
        sides: sides({ kind: "run-end", runId: "b", end: "middle" }),
      }),
    ).toBeNull();
    expect(
      boundReducerAt(design, {
        x: 50,
        y: 0,
        elevationIn: 150,
        sides: sides({ kind: "run-end", runId: "b", end: "start" }),
      })?.id,
    ).toBe("red");
  });

  it("reducerErrors reports a malformed persisted ownership reference", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
      id: "h",
      diameterIn: 2,
      elevationIn: 150,
    });
    design = placeSymbol(design, "piping", "reducer", 50, 0, { id: "red" });
    design = {
      ...design,
      symbols: design.symbols.map((s) =>
        s.id === "red"
          ? {
              ...s,
              inletSizeIn: 2,
              outletSizeIn: 1,
              elevationIn: 150,
              portOwners: {
                // Names a run but no interface on it — a weak,
                // malformed reference that must be reported, not
                // silently carried.
                inlet: { kind: "run-segment", runId: "h", segmentIndex: null },
                outlet: { kind: "nozzle", symbolId: 42, anchorId: "b" },
              },
            }
          : s,
      ),
    };
    const errors = reducerErrors(design);
    expect(errors.some((e) => e.includes("red") && /malformed/i.test(e))).toBe(true);
  });

  it("the unordered pair key is order-independent and collision-free", () => {
    const runEnd = { kind: "run-end", runId: "r", end: "end" };
    expect(ownerPairKey(NOZZLE_A, runEnd)).toBe(ownerPairKey(runEnd, NOZZLE_A));
    expect(ownerPairKey(NOZZLE_A, runEnd)).not.toBe(ownerPairKey(NOZZLE_B, runEnd));
    expect(ownerPairKey(NOZZLE_A, null)).toBeNull();
  });
});
