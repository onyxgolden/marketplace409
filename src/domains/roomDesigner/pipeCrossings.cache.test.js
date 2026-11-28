import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetElevationCache,
  connectionFlanges,
  connectionFlangesByRun,
  derivedSegmentElevations,
  elevationCacheStats,
  segmentElevationsForDesign,
  vertexElevationsForDesign,
} from "./pipeCrossings";
import {
  __resetSymbolRegistry,
  registerSymbolSet,
} from "./symbolRegistry";
import {
  addPipeRun,
  createEmptyDesign,
  deleteSymbol,
  moveSymbol,
  placeSymbol,
} from "./designerDocument";
import {
  detectRunAttachments,
  detectRunJunctions,
} from "./pipeAttachments";

const runOf = (design, id) => design.pipes.find((p) => p.id === id);

// Pipe-rack (480x240, top of steel 180 in) centred at (500, 500): run "a"
// crosses it at its midpoint and rides at 181 in (180 + 2-in radius 1);
// run "b" at x=900 stays at grade (30 in).
function rackDesign() {
  let design = placeSymbol(createEmptyDesign(), "processEquipment", "pipe-rack", 500, 500, { id: "r1" });
  design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
  design = addPipeRun(design, [{ x: 900, y: 100 }, { x: 900, y: 900 }], { id: "b", diameterIn: 2 });
  return design;
}

// Same content as rackDesign(), built from scratch — distinct objects.
function rackDesignTwin() {
  return rackDesign();
}

describe("D2 elevation memoization — parity, reuse, invalidation", () => {
  beforeEach(() => {
    __resetElevationCache();
  });

  it("reuses derived elevations on repeat calls with the same design+run", () => {
    const design = rackDesign();
    const runA = runOf(design, "a");
    const first = derivedSegmentElevations(design, runA);
    expect(first).toEqual([181]);
    const second = derivedSegmentElevations(design, runA);
    expect(second).toBe(first);
    expect(elevationCacheStats()).toMatchObject({
      derivedComputations: 1,
      derivedCacheHits: 1,
    });
  });

  it("cached values equal a fresh recomputation on an equal-content design", () => {
    const d1 = rackDesign();
    const d2 = rackDesignTwin();
    expect(d1).not.toBe(d2);
    expect(runOf(d1, "a")).not.toBe(runOf(d2, "a"));
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual(
      derivedSegmentElevations(d2, runOf(d2, "a")),
    );
    expect(derivedSegmentElevations(d1, runOf(d1, "b"))).toEqual(
      derivedSegmentElevations(d2, runOf(d2, "b")),
    );
    expect(vertexElevationsForDesign(d1, runOf(d1, "a"))).toEqual(
      vertexElevationsForDesign(d2, runOf(d2, "a")),
    );
    expect(vertexElevationsForDesign(d1, runOf(d1, "b"))).toEqual([30, 30]);
    expect(vertexElevationsForDesign(d1, runOf(d1, "a"))).toEqual([181, 181]);
    expect(segmentElevationsForDesign(d1, runOf(d1, "a"))).toBe(
      derivedSegmentElevations(d1, runOf(d1, "a")),
    );
  });

  it("rack edit invalidates: moving the rack off the midpoint recomputes to grade", () => {
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    const d2 = moveSymbol(d1, "r1", 100, 100);
    expect(d2).not.toBe(d1);
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([30]);
    // The old design still answers from its own cache, uncontaminated.
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    expect(elevationCacheStats().derivedComputations).toBe(2);
  });

  it("run edit invalidates: a replaced run recomputes with its own diameter", () => {
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    const d2 = {
      ...d1,
      pipes: d1.pipes.map((p) => (p.id === "a" ? { ...p, diameterIn: 12 } : p)),
    };
    // 12-in pipe: radius 6 over the same 180-in rack top.
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([186]);
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
  });

  it("cross-design isolation: same run id, different racks, each keeps its own elevations", () => {
    const withRack = rackDesign();
    let noRack = createEmptyDesign();
    noRack = addPipeRun(noRack, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    expect(derivedSegmentElevations(withRack, runOf(withRack, "a"))).toEqual([181]);
    expect(derivedSegmentElevations(noRack, runOf(noRack, "a"))).toEqual([30]);
    expect(derivedSegmentElevations(withRack, runOf(withRack, "a"))).toEqual([181]);
    expect(derivedSegmentElevations(noRack, runOf(noRack, "a"))).toEqual([30]);
  });

  it("vertex elevations are memoized and agree with derived (incl. stored profile)", () => {
    const design = rackDesign();
    const runA = runOf(design, "a");
    const first = vertexElevationsForDesign(design, runA);
    expect(first).toEqual([181, 181]);
    expect(vertexElevationsForDesign(design, runA)).toBe(first);
    // One vertex computation drove exactly one derived computation.
    expect(elevationCacheStats()).toMatchObject({
      derivedComputations: 1,
      derivedCacheHits: 0,
      vertexComputations: 1,
      vertexCacheHits: 1,
    });
    // A stored profile wins over the derivation, cached or not.
    let stored = createEmptyDesign();
    stored = addPipeRun(stored, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "s", diameterIn: 2, elevationIn: 90 });
    expect(vertexElevationsForDesign(stored, runOf(stored, "s"))).toEqual([90, 90]);
    expect(segmentElevationsForDesign(stored, runOf(stored, "s"))).toEqual([90]);
  });

  it("connectionFlangesByRun groups exactly what connectionFlanges returns", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
    design = addPipeRun(design, [{ x: 200, y: 191 }, { x: 200, y: 40 }], { id: "s", diameterIn: 4 });
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "header", diameterIn: 6 });
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "branch", diameterIn: 4 });
    design = detectRunAttachments(design, "s");
    design = detectRunJunctions(design, "branch");
    const flat = connectionFlanges(design);
    expect(flat).toHaveLength(2);
    __resetElevationCache();
    const byRun = connectionFlangesByRun(design);
    expect(connectionFlangesByRun(design)).toBe(byRun);
    expect([...byRun.entries()]).toEqual([
      ["s", [flat.find((f) => f.runId === "s")]],
      ["branch", [flat.find((f) => f.runId === "branch")]],
    ]);
    // Same flange objects across repeat calls — grouping only, no rebuild.
    const byRunAgain = connectionFlangesByRun(design);
    expect(byRunAgain).toBe(byRun);
    expect(byRunAgain.get("s")[0]).toBe(byRun.get("s")[0]);
    expect(byRunAgain.get("branch")[0]).toBe(byRun.get("branch")[0]);
    expect(byRun.get("header")).toBeUndefined();
    expect(elevationCacheStats()).toMatchObject({ flangeComputations: 1, flangeCacheHits: 2 });
    // Detach the pump and the flange disappears on the new design object.
    const detached = detectRunAttachments(deleteSymbol(design, "p1"), "s");
    expect(connectionFlangesByRun(detached).get("s")).toBeUndefined();
  });

  it("missing/malformed inputs match uncached behavior and never poison the cache", () => {
    const design = rackDesign();
    const runA = runOf(design, "a");
    expect(derivedSegmentElevations(null, runA)).toEqual([30]);
    expect(derivedSegmentElevations(design, null)).toEqual([]);
    expect(vertexElevationsForDesign(null, runA)).toEqual([30, 30]);
    expect(vertexElevationsForDesign(design, null)).toEqual([]);
    expect(connectionFlangesByRun(null)).toEqual(new Map());
    expect(connectionFlangesByRun(undefined)).toEqual(new Map());
    // The malformed run IS an object, so it computes (once) and caches like
    // any other run — but the null/non-object calls never touch the cache.
    const malformed = { points: [{ x: 0, y: 0 }] };
    expect(derivedSegmentElevations(design, malformed)).toEqual([]);
    expect(derivedSegmentElevations(design, malformed)).toEqual([]);
    expect(elevationCacheStats()).toMatchObject({
      derivedComputations: 1,
      derivedCacheHits: 1,
      vertexComputations: 0,
      flangeComputations: 0,
    });
    // The cache still works normally afterwards.
    expect(derivedSegmentElevations(design, runA)).toEqual([181]);
    expect(elevationCacheStats().derivedComputations).toBe(2);
  });
});

describe("D2 fix-round Gate 2 — frozen cached results + immutable update paths", () => {
  beforeEach(() => {
    __resetElevationCache();
  });

  it("cached results are frozen: a consumer mutation fails loudly instead of corrupting the cache", () => {
    const design = rackDesign();
    const runA = runOf(design, "a");
    const derived = derivedSegmentElevations(design, runA);
    const vertex = vertexElevationsForDesign(design, runA);
    expect(Object.isFrozen(derived)).toBe(true);
    expect(Object.isFrozen(vertex)).toBe(true);
    expect(() => {
      derived[0] = 999;
    }).toThrow();
    expect(() => {
      vertex.push(999);
    }).toThrow();
    // The cache still answers the true value afterwards.
    expect(derivedSegmentElevations(design, runA)).toEqual([181]);
    expect(vertexElevationsForDesign(design, runA)).toEqual([181, 181]);
    // Flange groupings and flange objects are frozen the same way.
    let flanged = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
    flanged = addPipeRun(flanged, [{ x: 200, y: 191 }, { x: 200, y: 40 }], { id: "s", diameterIn: 4 });
    flanged = detectRunAttachments(flanged, "s");
    const byRun = connectionFlangesByRun(flanged);
    const list = byRun.get("s");
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(() => {
      list[0].elevationIn = 999;
    }).toThrow();
    expect(connectionFlangesByRun(flanged).get("s")[0].elevationIn).toBe(30);
  });

  it("rack params path: setRackParams (the real edit helper) invalidates and recomputes", async () => {
    const { setRackParams } = await import("./rackGeometry");
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    const d2 = setRackParams(d1, "r1", { elevationIn: 120 });
    expect(d2).not.toBe(d1);
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([121]);
    expect(elevationCacheStats().derivedComputations).toBe(2);
    // The old design is uncontaminated.
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
  });

  it("pipe + junction + stored-profile paths: each real edit invalidates its own derivation", () => {
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    // Pipe geometry edit: move the run off the rack (immutable spread,
    // the same shape the reducer produces).
    const moved = {
      ...d1,
      pipes: d1.pipes.map((p) =>
        p.id === "a" ? { ...p, points: [{ x: 100, y: 100 }, { x: 900, y: 100 }] } : p,
      ),
    };
    expect(derivedSegmentElevations(moved, runOf(moved, "a"))).toEqual([30]);
    // Stored profile edit: pinning a base elevation wins over derivation.
    const pinned = {
      ...d1,
      pipes: d1.pipes.map((p) => (p.id === "a" ? { ...p, elevationIn: 90 } : p)),
    };
    expect(segmentElevationsForDesign(pinned, runOf(pinned, "a"))).toEqual([90]);
    expect(vertexElevationsForDesign(pinned, runOf(pinned, "a"))).toEqual([90, 90]);
    // Junction edit: attaching a branch changes the flange set on the
    // new design only.
    let j1 = rackDesign();
    j1 = addPipeRun(j1, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "branch", diameterIn: 2 });
    expect(connectionFlangesByRun(j1).get("branch")).toBeUndefined();
    const j2 = detectRunJunctions(j1, "branch");
    expect(j2).not.toBe(j1);
    expect(connectionFlangesByRun(j2).get("branch")).toHaveLength(1);
    expect(connectionFlangesByRun(j1).get("branch")).toBeUndefined();
  });

  it("undo/redo path: restoring a previous design object restores its own cache, uncontaminated", () => {
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    const d2 = moveSymbol(d1, "r1", 100, 100);
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([30]);
    // Undo = the app hands back the exact previous design object; its
    // cache entry is still there and still true — no recompute needed.
    const computationsAfterEdit = elevationCacheStats().derivedComputations;
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    expect(elevationCacheStats().derivedComputations).toBe(computationsAfterEdit);
    expect(elevationCacheStats().derivedCacheHits).toBeGreaterThanOrEqual(1);
    // Redo = the edited object again: its own entry, still 30.
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([30]);
  });

  it("import path: a JSON round-trip (new objects, same content) recomputes identically", () => {
    const d1 = rackDesign();
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    const imported = JSON.parse(JSON.stringify(d1));
    expect(imported).not.toBe(d1);
    expect(runOf(imported, "a")).not.toBe(runOf(d1, "a"));
    expect(derivedSegmentElevations(imported, runOf(imported, "a"))).toEqual([181]);
    expect(vertexElevationsForDesign(imported, runOf(imported, "a"))).toEqual([181, 181]);
    // New objects miss the old cache (recompute), then hit their own.
    expect(elevationCacheStats().derivedComputations).toBe(2);
    expect(derivedSegmentElevations(imported, runOf(imported, "a"))).toEqual([181]);
    expect(elevationCacheStats().derivedCacheHits).toBeGreaterThanOrEqual(1);
  });

  it("level/project switch path: two designs keep independent caches; switching back hits", () => {
    const levelA = rackDesign();
    let levelB = createEmptyDesign();
    levelB = addPipeRun(levelB, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    expect(derivedSegmentElevations(levelA, runOf(levelA, "a"))).toEqual([181]);
    expect(derivedSegmentElevations(levelB, runOf(levelB, "a"))).toEqual([30]);
    // Switch back to level A: its entry survived, no recompute.
    const computations = elevationCacheStats().derivedComputations;
    expect(derivedSegmentElevations(levelA, runOf(levelA, "a"))).toEqual([181]);
    expect(elevationCacheStats().derivedComputations).toBe(computations);
  });
});

// Registry re-registration test — MUST stay last in this file: it resets
// the global symbol registry (clearing the catalogs too), and later tests
// in this file use catalog symbols via placeSymbol.
describe("D2 registry-generation guard", () => {
  it("re-registration invalidates cached elevations, even for the old design object", () => {
    __resetElevationCache();
    registerSymbolSet({
      domain: "test-rack",
      title: "Test racks v1",
      symbols: [
        {
          id: "rack-a",
          label: "Rack A",
          widthIn: 480,
          depthIn: 240,
          rack: { kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 },
        },
      ],
    });
    let d1 = placeSymbol(createEmptyDesign(), "test-rack", "rack-a", 500, 500, { id: "tr1" });
    d1 = addPipeRun(d1, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);

    __resetSymbolRegistry();
    registerSymbolSet({
      domain: "test-rack",
      title: "Test racks v2",
      symbols: [
        {
          id: "rack-a",
          label: "Rack A",
          widthIn: 480,
          depthIn: 240,
          rack: { kind: "pipe", tiers: 2, elevationIn: 120, tierSpacingIn: 72, bentSpacingIn: 240 },
        },
      ],
    });
    // Same content, new objects, new registry generation: recomputed.
    let d2 = placeSymbol(createEmptyDesign(), "test-rack", "rack-a", 500, 500, { id: "tr1" });
    d2 = addPipeRun(d2, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    expect(derivedSegmentElevations(d2, runOf(d2, "a"))).toEqual([121]);
    // And the OLD design object is not stuck on the stale elevation.
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([121]);
    expect(elevationCacheStats().derivedComputations).toBe(3);
  });

  it("Gate 1 end-to-end: mutating a caller's rack object after registration cannot stale a derivation", () => {
    __resetElevationCache();
    __resetSymbolRegistry();
    const rack = { kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 };
    registerSymbolSet({
      domain: "test-rack-g1",
      title: "Test racks",
      symbols: [{ id: "rack-a", label: "Rack A", widthIn: 480, depthIn: 240, rack }],
    });
    let d1 = placeSymbol(createEmptyDesign(), "test-rack-g1", "rack-a", 500, 500, { id: "tr1" });
    d1 = addPipeRun(d1, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    // The verdict's example: change the mutable rack object to 120.
    rack.elevationIn = 120;
    // The registry holds its own frozen snapshot, so the derivation still
    // answers the registered 181 — it cannot go stale, and it does not
    // silently follow the caller's mutation to 121 either.
    expect(derivedSegmentElevations(d1, runOf(d1, "a"))).toEqual([181]);
    expect(elevationCacheStats().derivedCacheHits).toBe(1);
  });
});
