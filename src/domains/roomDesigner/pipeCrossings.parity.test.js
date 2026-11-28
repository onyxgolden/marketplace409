// FCCU freeze D2 — deterministic before/after parity on the pinned FCCU
// fixture (D2 fix-round Gate 4).
//
// The reference implementations below are literal copies of the PRE-D2
// code at base 7e1fcf8f (marketplace409 main before the D2 branch), with
// exactly one substitution: the linear `findSymbol` scan
// (`getSymbolSet(domain)?.symbols.find(...)`) in place of the D2 index.
// The D2 diff touched only the memoization wrappers and the registry
// index — the compute bodies are byte-identical to base — so a fresh
// recomputation of the same patched function would NOT be an
// independent base comparison (the verdict's Gate 2 warning). These
// reference copies ARE the independent base: they share no code with
// the memoized path except the unchanged pure helpers (rackParams,
// properIntersection, requiredSeparationIn, storedSegmentElevations).
//
// Fixture: public/phone-fixture/fccu-design-snapshot.json, 91 pipes /
// 91 symbols, snapshot SHA-256
// 94b37f104a5cc02cfb2e69549d5703de29844274a12cb7019cfba7fce190d9cd.
//
// Validation parity argument: pipeCrossingErrors /
// envelopeConflictErrors / crossServiceErrors are UNCHANGED by D2
// (zero diff hunks in those functions between 7e1fcf8f and the D2 head)
// and every elevation/flange/route input they read is proven equal to
// the reference below, so their outputs are necessarily equal. The
// test pins their exact values on the fixture (warm vs recomputed)
// as the regression tripwire.

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PIPE_ELEVATION_IN,
  __resetElevationCache,
  connectionFlanges,
  connectionFlangesByRun,
  crossServiceErrors,
  derivedSegmentElevations,
  developedRunLengthIn,
  elevationCacheStats,
  envelopeConflictErrors,
  findPipeCrossings,
  physicalRouteIn,
  pipeCrossingErrors,
  properIntersection,
  requiredSeparationIn,
  runHasStoredElevation,
  segmentElevationsForDesign,
  storedSegmentElevations,
  vertexElevationIn,
  vertexElevationsForDesign,
} from "./pipeCrossings";
import { findSymbol, getSymbolSet } from "./symbolRegistry";
import { rackParams } from "./rackGeometry";
// Side-effect imports: register the piping + processEquipment catalogs
// the fixture's symbol instances resolve against.
import "./pipingCatalog";
import "./processEquipmentCatalog";
import { moveSymbol } from "./designerDocument";

const fixtureDesign = JSON.parse(
  readFileSync(new URL("../../../public/phone-fixture/fccu-design-snapshot.json", import.meta.url), "utf8"),
);

// --- Reference implementations: pre-D2 base 7e1fcf8f, verbatim. ---

function refFindSymbol(domain, id) {
  return getSymbolSet(domain)?.symbols.find((s) => s.id === id);
}

function refDerivedSegmentElevations(design, run) {
  const racks = [];
  for (const inst of design?.symbols || []) {
    const symbol = refFindSymbol(inst.domain, inst.symbolId);
    if (!symbol?.rack) continue;
    const widthIn = inst.widthIn ?? symbol.widthIn;
    const depthIn = inst.depthIn ?? symbol.depthIn;
    if (!widthIn || !depthIn) continue;
    racks.push({ inst, widthIn, depthIn, elevationIn: rackParams(symbol, inst).elevationIn });
  }
  const diameterIn = run?.diameterIn ?? 2;
  const radiusIn = diameterIn / 2;
  const pts = run?.points || [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    let supportIn = null;
    for (const rack of racks) {
      const dx = midX - rack.inst.x;
      const dy = midY - rack.inst.y;
      const angle = (-(rack.inst.rotationDeg || 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= rack.widthIn / 2 && Math.abs(ly) <= rack.depthIn / 2) {
        const candidateIn = rack.elevationIn + radiusIn;
        supportIn = supportIn === null ? candidateIn : Math.max(supportIn, candidateIn);
      }
    }
    out.push(supportIn ?? DEFAULT_PIPE_ELEVATION_IN);
  }
  return out;
}

function refSegmentElevationsForDesign(design, run) {
  return runHasStoredElevation(run)
    ? storedSegmentElevations(run)
    : refDerivedSegmentElevations(design, run);
}

function refVertexElevationsForDesign(design, run) {
  const pts = run?.points || [];
  if (pts.length === 0) return [];
  const derived = refDerivedSegmentElevations(design, run);
  const at = (i) => {
    if (i === 0) return derived[0];
    if (i === pts.length - 1) return derived[derived.length - 1];
    return Math.max(derived[i - 1], derived[i]);
  };
  if (!runHasStoredElevation(run)) return pts.map((_, i) => at(i));
  return pts.map((_, i) => {
    const v = vertexElevationIn(run, i);
    return v != null ? v : at(i);
  });
}

function refPhysicalRouteIn(design, run) {
  const pts = run?.points || [];
  const elevs = refVertexElevationsForDesign(design, run);
  return pts.map((p, i) => ({ x: p.x, y: p.y, zIn: elevs[i] ?? DEFAULT_PIPE_ELEVATION_IN }));
}

function refConnectionFlanges(design) {
  const out = [];
  for (const run of design?.pipes || []) {
    if (!Array.isArray(run.points) || run.points.length < 2) continue;
    const vertexElevs = refVertexElevationsForDesign(design, run);
    for (const end of ["start", "end"]) {
      const kind = run.attachments?.[end]
        ? "nozzle"
        : run.junctions?.[end]
          ? "junction"
          : null;
      if (!kind) continue;
      const idx = end === "start" ? 0 : run.points.length - 1;
      const neighbor = run.points[end === "start" ? 1 : run.points.length - 2];
      const point = run.points[idx];
      const axisDeg = (Math.atan2(neighbor.y - point.y, neighbor.x - point.x) * 180) / Math.PI;
      out.push({
        runId: run.id,
        end,
        kind,
        x: point.x,
        y: point.y,
        axisDeg,
        sizeIn: run.diameterIn ?? 2,
        elevationIn: vertexElevs[idx],
      });
    }
  }
  return out;
}

const EPS = 1e-9;

function refFindPipeCrossings(design) {
  const runs = (design?.pipes || []).filter(
    (r) => Array.isArray(r.points) && r.points.length >= 2,
  );
  const routes = new Map(runs.map((r) => [r.id, refPhysicalRouteIn(design, r)]));
  const out = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i];
      const b = runs[j];
      const routeA = routes.get(a.id);
      const routeB = routes.get(b.id);
      for (let sa = 0; sa + 1 < routeA.length; sa += 1) {
        for (let sb = 0; sb + 1 < routeB.length; sb += 1) {
          const hit = properIntersection(routeA[sa], routeA[sa + 1], routeB[sb], routeB[sb + 1]);
          if (!hit) continue;
          const elevA = routeA[sa].zIn + hit.t * (routeA[sa + 1].zIn - routeA[sa].zIn);
          const elevB = routeB[sb].zIn + hit.u * (routeB[sb + 1].zIn - routeB[sb].zIn);
          const sep = Math.abs(elevA - elevB);
          out.push({
            aRunId: a.id,
            bRunId: b.id,
            x: hit.x,
            y: hit.y,
            segA: sa,
            segB: sb,
            tA: hit.t,
            tB: hit.u,
            elevAIn: elevA,
            elevBIn: elevB,
            resolved: sep >= requiredSeparationIn(a.diameterIn ?? 2, b.diameterIn ?? 2) - EPS,
          });
        }
      }
    }
  }
  return out;
}

function refDevelopedRunLengthIn(design, run) {
  if (!Array.isArray(run?.points) || run.points.length < 2) return 0;
  const route = refPhysicalRouteIn(design, run);
  let total = 0;
  for (let i = 0; i + 1 < route.length; i += 1) {
    total += Math.hypot(
      route[i + 1].x - route[i].x,
      route[i + 1].y - route[i].y,
      route[i + 1].zIn - route[i].zIn,
    );
  }
  return total;
}

// --- Parity tests. ---

describe("D2 FCCU fixture parity — memoized path vs pre-D2 reference", () => {
  beforeEach(() => {
    __resetElevationCache();
  });

  it("fixture shape is the pinned D0 snapshot", () => {
    expect(fixtureDesign.pipes).toHaveLength(91);
    expect(fixtureDesign.symbols).toHaveLength(91);
  });

  it("indexed findSymbol agrees with the linear scan for every fixture instance", () => {
    for (const inst of fixtureDesign.symbols) {
      expect(findSymbol(inst.domain, inst.symbolId)).toBe(refFindSymbol(inst.domain, inst.symbolId));
    }
    expect(findSymbol("piping", "no-such-symbol")).toBeUndefined();
    expect(findSymbol("no-such-domain", "x")).toBeUndefined();
  });

  it("per-run derived + vertex elevations match the reference on all 91 runs", () => {
    for (const run of fixtureDesign.pipes) {
      expect(derivedSegmentElevations(fixtureDesign, run)).toEqual(
        refDerivedSegmentElevations(fixtureDesign, run),
      );
      expect(vertexElevationsForDesign(fixtureDesign, run)).toEqual(
        refVertexElevationsForDesign(fixtureDesign, run),
      );
      expect(segmentElevationsForDesign(fixtureDesign, run)).toEqual(
        refSegmentElevationsForDesign(fixtureDesign, run),
      );
    }
    // And the memoized path actually reused (not recomputed per run).
    expect(elevationCacheStats().derivedComputations).toBeGreaterThan(0);
    const computations = elevationCacheStats().derivedComputations;
    for (const run of fixtureDesign.pipes) {
      derivedSegmentElevations(fixtureDesign, run);
      vertexElevationsForDesign(fixtureDesign, run);
    }
    expect(elevationCacheStats().derivedComputations).toBe(computations);
  });

  it("physical routes match the reference on all 91 runs", () => {
    for (const run of fixtureDesign.pipes) {
      expect(physicalRouteIn(fixtureDesign, run)).toEqual(refPhysicalRouteIn(fixtureDesign, run));
    }
  });

  it("flanges match the reference exactly (order, geometry, z)", () => {
    expect(connectionFlanges(fixtureDesign)).toEqual(refConnectionFlanges(fixtureDesign));
    const byRun = connectionFlangesByRun(fixtureDesign);
    const regrouped = new Map();
    for (const f of refConnectionFlanges(fixtureDesign)) {
      const list = regrouped.get(f.runId);
      if (list) list.push(f);
      else regrouped.set(f.runId, [f]);
    }
    expect([...byRun.keys()].sort()).toEqual([...regrouped.keys()].sort());
    for (const [runId, list] of regrouped) {
      expect(byRun.get(runId)).toEqual(list);
    }
  });

  it("crossings match the reference exactly", () => {
    expect(findPipeCrossings(fixtureDesign)).toEqual(refFindPipeCrossings(fixtureDesign));
  });

  it("quantities (developed lengths) match the reference on all 91 runs", () => {
    let total = 0;
    let refTotal = 0;
    for (const run of fixtureDesign.pipes) {
      const len = developedRunLengthIn(fixtureDesign, run);
      expect(len).toBe(refDevelopedRunLengthIn(fixtureDesign, run));
      total += len;
      refTotal += refDevelopedRunLengthIn(fixtureDesign, run);
    }
    expect(total).toBe(refTotal);
    expect(total).toBeGreaterThan(0);
  });

  it("validation outputs are deterministic and identical warm vs recomputed", () => {
    const warm = {
      crossings: pipeCrossingErrors(fixtureDesign),
      envelope: envelopeConflictErrors(fixtureDesign),
      crossService: crossServiceErrors(fixtureDesign),
    };
    // Recompute from scratch: fresh cache + fresh design object forces
    // every derivation through the compute bodies again.
    __resetElevationCache();
    const fresh = JSON.parse(JSON.stringify(fixtureDesign));
    const recomputed = {
      crossings: pipeCrossingErrors(fresh),
      envelope: envelopeConflictErrors(fresh),
      crossService: crossServiceErrors(fresh),
    };
    expect(recomputed).toEqual(warm);
    // Pinned regression values on this fixture (deterministic; any drift
    // means the memoized path changed what validation sees). The fixture
    // is fully resolved: zero errors, all 225 crossings resolved.
    expect(warm.crossings).toEqual([]);
    expect(warm.envelope).toEqual([]);
    expect(warm.crossService).toEqual([]);
    expect(connectionFlanges(fixtureDesign)).toHaveLength(145);
    expect(findPipeCrossings(fixtureDesign)).toHaveLength(225);
    expect(findPipeCrossings(fixtureDesign).every((c) => c.resolved)).toBe(true);
  });

  it("edit invalidation on the fixture: moving a rack moves elevations, undo restores them", () => {
    const rackInst = fixtureDesign.symbols.find((s) => findSymbol(s.domain, s.symbolId)?.rack);
    expect(rackInst).toBeDefined();
    const before = new Map(
      fixtureDesign.pipes.map((r) => [r.id, [...derivedSegmentElevations(fixtureDesign, r)]]),
    );
    const moved = moveSymbol(fixtureDesign, rackInst.id, rackInst.x + 5000, rackInst.y + 5000);
    expect(moved).not.toBe(fixtureDesign);
    const after = new Map(
      fixtureDesign.pipes.map((r) => [r.id, [...derivedSegmentElevations(moved, r)]]),
    );
    // At least one run's elevation changed (the rack moved far away).
    expect([...after.entries()].some(([id, v]) => JSON.stringify(v) !== JSON.stringify(before.get(id)))).toBe(
      true,
    );
    // Undo = the original design object again: its cached values return.
    for (const run of fixtureDesign.pipes) {
      expect(derivedSegmentElevations(fixtureDesign, run)).toEqual(before.get(run.id));
    }
  });
});
