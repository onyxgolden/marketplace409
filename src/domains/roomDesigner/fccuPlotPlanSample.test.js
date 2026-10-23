import { describe, expect, it, vi } from "vitest";

// Each test rebuilds and fully validates the 91-run FCCU acceptance
// design (~4-5 s of CPU on an idle core). The 5 s default test
// timeout leaves no headroom under full-suite parallel load, where
// these tests time out without any assertion failing — the timeout
// is raised for this file only; assertions are unchanged.
vi.setConfig({ testTimeout: 30000 });
import { validateHomeProject } from "./homeProject";
import { anchorAtPoint, anchorsOf, reconcilePipeAttachments } from "./pipeAttachments";
import { moveSymbol } from "./designerDocument";
import { rackParams } from "./rackGeometry";
import { findSymbol } from "./symbolRegistry";
import {
  buildFccuPlotPlan,
  FCCU_SAMPLE_NAME,
  FCCU_SAMPLE_SEED_ID,
  resetFccuSampleIds,
} from "./fccuPlotPlanSample";
import { SAMPLE_PROJECTS } from "./sampleProjects";

const EXPECTED_TAGS = [
  "R-101", "R-102",
  "T-101", "T-102",
  "K-101", "K-102",
  "E-101", "E-102", "E-103", "E-104",
  "P-101", "P-102", "P-103", "P-104", "P-105", "P-106",
  "V-101", "V-102",
  "FL-101",
];

function build() {
  resetFccuSampleIds();
  return buildFccuPlotPlan();
}

function designOf(project) {
  expect(project.levels).toHaveLength(1);
  return project.levels[0].design;
}

function distanceFt(a, b) {
  const dx = (a.x - b.x) / 12;
  const dy = (a.y - b.y) / 12;
  return Math.hypot(dx, dy);
}

// --- segment <-> rect distance helpers (feet), for the coverage test ---
const toFt = (p) => ({ x: p.x / 12, y: p.y / 12 });

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segmentSegmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function segmentRectDistance(a, b, rect) {
  const inside = (p) => p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;
  if (inside(a) || inside(b)) return 0;
  const corners = [
    { x: rect.x1, y: rect.y1 },
    { x: rect.x2, y: rect.y1 },
    { x: rect.x2, y: rect.y2 },
    { x: rect.x1, y: rect.y2 },
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    best = Math.min(best, segmentSegmentDistance(a, b, corners[i], corners[(i + 1) % 4]));
  }
  return best;
}

describe("fccuPlotPlanSample: fictional FCCU plot plan seed", () => {
  it("builds a valid single-level project", { timeout: 30000 }, () => {
    const project = build();
    expect(validateHomeProject(project)).toEqual([]);
    expect(project.name).toBe(FCCU_SAMPLE_NAME);
    expect(project.levels.map((l) => l.name)).toEqual(["Plot Plan"]);
    // A seed carries no identity or history.
    expect(project.createdAt).toBeUndefined();
    expect(project.updatedAt).toBeUndefined();
  });

  it("exposes the sample in the gallery list", () => {
    const sample = SAMPLE_PROJECTS.find((s) => s.seedId === FCCU_SAMPLE_SEED_ID);
    expect(sample).toBeTruthy();
    expect(sample.name).toBe(FCCU_SAMPLE_NAME);
    expect(sample.levels).toEqual(["Plot Plan"]);
    expect(typeof sample.build).toBe("function");
  });

  it("places every expected tagged equipment symbol", () => {
    const design = designOf(build());
    const tags = (design.symbols || []).map((s) => s.tag).filter(Boolean);
    for (const tag of EXPECTED_TAGS) {
      expect(tags).toContain(tag);
    }
    // Tags are unique.
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("resolves every placed symbol against the registered catalogs", () => {
    const design = designOf(build());
    for (const inst of design.symbols || []) {
      expect(
        findSymbol(inst.domain, inst.symbolId),
        `${inst.domain}/${inst.symbolId} should be registered`,
      ).toBeTruthy();
    }
  });

  it("keeps the flare at a safe distance from the reactor", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries(
      (design.symbols || []).map((s) => [s.tag, s]),
    );
    const flare = byTag["FL-101"];
    const reactor = byTag["R-101"];
    expect(flare).toBeTruthy();
    expect(reactor).toBeTruthy();
    // Ignition source well clear of process equipment.
    expect(distanceFt(flare, reactor)).toBeGreaterThan(300);
  });

  it("routes a relief header pipe run to the flare", () => {
    const design = designOf(build());
    const header = (design.pipes || []).find((r) => /relief header/i.test(r.service || ""));
    expect(header).toBeTruthy();
    expect(header.points.length).toBeGreaterThanOrEqual(2);
    const flare = (design.symbols || []).find((s) => s.tag === "FL-101");
    const last = header.points[header.points.length - 1];
    // Header terminates at the flare footprint.
    expect(distanceFt(last, flare)).toBeLessThan(10);
  });

  it("labels the control building and pipe rack areas", () => {
    const design = designOf(build());
    const labels = (design.rooms || []).map((r) => r.label);
    expect(labels).toContain("Control building");
    expect(labels).toContain("Pipe rack");
  });

  // The full fixture build validates 100+ pipes against the strict
  // D668-002/003/004 geometry rules; two builds exceed the 5 s default
  // timeout on CI runners (PR668 fixround).
  it("is deterministic across builds", { timeout: 30000 }, () => {
    const a = JSON.stringify(build());
    const b = JSON.stringify(build());
    expect(a).toBe(b);
  });

  it("routes exactly 91 pipe runs, each in one of the 14 named systems", () => {
    const design = designOf(build());
    // 44 runs originally; D7/D8/D9 added 12 (2 fractionator draw
    // circuits, 3 utility headers + 6 vessel utility branches, the
    // underground firewater main). The D8 scope-review fold-in added
    // 16 more: 3 utility source inlets + 12 utility branches for the
    // reactor/column vessels (R-101, R-102, T-101, T-102) + the
    // firewater source inlet — every in-scope vessel's supply path is
    // modeled branch -> header -> source. The D9 sizing fold-in added
    // 19 firewater runs: 15 hydrant branches (6-inch, one per hydrant)
    // and 4 monitor take-offs (6-inch / 4-inch) off the 12-inch loop.
    expect(design.pipes).toHaveLength(91);
    const expectedSystems = {
      "Process feed": "#22c55e",
      "Reactor effluent": "#f97316",
      "Catalyst transfer": "#eab308",
      "Combustion air": "#14b8a6",
      "Overhead & reflux": "#3b82f6",
      "Wet gas": "#a855f7",
      "Product rundown": "#ec4899",
      "Cooling water": "#f59e0b",
      // Relief was #ef4444 (red) until the firewater red reservation
      // recolored it to dark amber — red belongs to firewater alone.
      Relief: "#b45309",
      "Flue gas": "#94a3b8",
      "Plant water": "#0891b2",
      "Plant air": "#65a30d",
      Nitrogen: "#db2777",
      Firewater: "#dc2626",
    };
    expect(design.systems).toHaveLength(14);
    expect(Object.fromEntries((design.systems || []).map((s) => [s.name, s.color]))).toEqual(expectedSystems);
    const systemIds = new Set((design.systems || []).map((s) => s.id));
    for (const run of design.pipes) {
      expect(run.systemId, `${run.service} should carry a systemId`).toBeTruthy();
      expect(systemIds.has(run.systemId)).toBe(true);
    }
  });

  it("places the pipe rack with its parameters and the sleeper rack", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries((design.symbols || []).map((s) => [s.tag, s]));
    const rack = byTag["PR-101"];
    expect(rack).toBeTruthy();
    expect(rack.symbolId).toBe("pipe-rack");
    const params = rackParams(findSymbol(rack.domain, rack.symbolId), rack);
    expect(params).toMatchObject({ tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 });
    const sleeper = byTag["SL-101"];
    expect(sleeper).toBeTruthy();
    expect(sleeper.symbolId).toBe("sleeper-rack");
  });

  it("places no decorative piping-domain symbols — only functional firewater components", () => {
    const design = designOf(build());
    const pipingSymbols = (design.symbols || []).filter((s) => s.domain === "piping");
    // Flow arrows and tags stay out; the piping-domain placements are the
    // D9 fire hydrants and fixed spray nozzles, which are functional
    // components with validation rules, not decoration. PR668-001 adds
    // the modeled reducers — 37 placed explicitly (18 D8 2->1 taps,
    // 15 hydrant 12->6 taps, 4 monitor 12->6/12->4 take-offs) plus 15
    // more for size-mismatched junctions discovered by the final
    // junction pass (e.g. 12" rundowns landing on the 10" pump suction
    // header) — every size transition gets its modeled reducer. (The
    // 15th junction reducer is the relief branch onto the 24" relief
    // header: round 1's proximity cover-check counted a neighboring
    // reducer as covering that tap; R1 requires the tap's own bound
    // reducer.)
    expect(pipingSymbols.map((s) => s.symbolId).sort()).toEqual([
      ...Array(15).fill("fire-hydrant"),
      ...Array(52).fill("reducer"),
      ...Array(4).fill("spray-nozzle"),
    ]);
  });

  it("records attachments exactly where a run end sits on a nozzle", () => {
    const design = designOf(build());
    for (const run of design.pipes || []) {
      const start = run.points[0];
      const end = run.points[run.points.length - 1];
      // Coincident anchors (a column's level outlets stack in plan) are
      // chosen by the run end's own elevation — the selection contract.
      const hint = (i) =>
        (Array.isArray(run.elevIn) ? run.elevIn[i] : undefined) ?? run.elevationIn ?? null;
      expect(anchorAtPoint(design, start, hint(0)), `${run.service} start`).toEqual(run.attachments?.start ?? null);
      expect(anchorAtPoint(design, end, hint(run.points.length - 1)), `${run.service} end`).toEqual(run.attachments?.end ?? null);
    }
  });

  it("attaches the spot-checked run ends to their equipment nozzles", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries((design.symbols || []).map((s) => [s.tag, s]));
    const byService = Object.fromEntries((design.pipes || []).map((r) => [r.service, r]));
    const ref = (tag, anchorId) => ({ symbolId: byTag[tag].id, anchorId });

    expect(byService["Process feed to reactor"].attachments?.end).toEqual(ref("R-101", "feed-in"));
    expect(byService["Reactor effluent to fractionator"].attachments?.start).toEqual(ref("R-101", "effluent-out"));
    expect(byService["Reactor effluent to fractionator"].attachments?.end).toEqual(ref("T-101", "feed-in"));
    expect(byService["Reflux return to fractionator"].attachments?.start).toEqual(ref("P-101", "discharge-out"));
    expect(byService["Reflux return to fractionator"].attachments?.end).toEqual(ref("T-101", "reflux-in"));
    expect(byService["Relief header to flare"].attachments?.end).toEqual(ref("FL-101", "relief-in"));
    expect(byService["Cooling water supply"].attachments?.end).toEqual(ref("E-101", "cooling-water-in"));
  });

  it("connects every exchanger through all six of its nozzles (P663-001)", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries((design.symbols || []).map((s) => [s.tag, s]));
    const tagById = Object.fromEntries((design.symbols || []).map((s) => [s.id, s.tag]));
    const attachedByTag = {};
    let totalAttached = 0;
    for (const run of design.pipes || []) {
      for (const end of ["start", "end"]) {
        const att = run.attachments?.[end];
        if (!att) continue;
        totalAttached += 1;
        const tag = tagById[att.symbolId];
        (attachedByTag[tag] ||= []).push(att.anchorId);
      }
    }
    const sixNozzles = [
      "cooling-water-in", "cooling-water-out", "shell-in", "shell-out", "tube-in", "tube-out",
    ];
    for (const tag of ["E-101", "E-102", "E-103", "E-104"]) {
      expect(byTag[tag], tag).toBeTruthy();
      expect([...(attachedByTag[tag] || [])].sort(), `${tag} attached anchors`).toEqual(sixNozzles);
    }
    // 63 attached ends through the exchanger rework; D7/D8 add 8 more:
    // 2 fractionator draw outlets + 6 vessel utility connections. The
    // D8 scope-review fold-in adds 12 utility connections for the
    // reactor/column vessels (R-101, R-102, T-101, T-102 × 3 services).
    expect(totalAttached).toBe(83);
  });

  it("moving a middle exchanger drags its connected pipe ends along (P663-001)", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries((design.symbols || []).map((s) => [s.tag, s]));
    const e102 = byTag["E-102"];
    const endsBefore = [];
    for (const run of design.pipes || []) {
      for (const end of ["start", "end"]) {
        if (run.attachments?.[end]?.symbolId === e102.id) {
          const point = end === "start" ? run.points[0] : run.points[run.points.length - 1];
          endsBefore.push({ service: run.service, end, point: { ...point }, anchorId: run.attachments[end].anchorId });
        }
      }
    }
    expect(endsBefore).toHaveLength(6);

    const moved = reconcilePipeAttachments(moveSymbol(design, e102.id, e102.x + 600, e102.y + 600));
    const movedE102 = (moved.symbols || []).find((s) => s.tag === "E-102");
    const newAnchors = Object.fromEntries(anchorsOf(movedE102).map((a) => [a.id, a]));
    const byService = Object.fromEntries((moved.pipes || []).map((r) => [r.service, r]));
    for (const before of endsBefore) {
      const run = byService[before.service];
      const point = before.end === "start" ? run.points[0] : run.points[run.points.length - 1];
      // The end followed the exchanger by exactly the move delta and still
      // sits on the same named nozzle of the moved instance.
      expect(point, `${before.service} ${before.end}`).toEqual({
        x: before.point.x + 600,
        y: before.point.y + 600,
      });
      expect(point).toEqual({ x: newAnchors[before.anchorId].x, y: newAnchors[before.anchorId].y });
      expect(run.attachments?.[before.end]).toEqual({ symbolId: e102.id, anchorId: before.anchorId });
    }
    // Battery-limit / junction ends stay intentionally unbound and unmoved.
    const feed = byService["Process feed to exchanger train"];
    expect(feed.points[0]).toEqual({ x: 124 * 12, y: 320 * 12 });
    expect(feed.attachments?.start ?? null).toBeNull();
    const cwReturn = byService["Cooling water return"];
    expect(cwReturn.points[cwReturn.points.length - 1]).toEqual({ x: 107 * 12, y: 379 * 12 });
    expect(cwReturn.attachments?.end ?? null).toBeNull();
  });

  it("brings a pipe run within 2 ft of every expected equipment footprint", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries((design.symbols || []).map((s) => [s.tag, s]));
    const polylines = (design.pipes || []).map((r) => r.points.map(toFt));
    for (const tag of EXPECTED_TAGS) {
      const inst = byTag[tag];
      expect(inst, tag).toBeTruthy();
      const symbol = findSymbol(inst.domain, inst.symbolId);
      const halfWFt = ((inst.widthIn ?? symbol.widthIn) / 12) / 2;
      const halfDFt = ((inst.depthIn ?? symbol.depthIn) / 12) / 2;
      const center = toFt(inst);
      const rect = {
        x1: center.x - halfWFt,
        x2: center.x + halfWFt,
        y1: center.y - halfDFt,
        y2: center.y + halfDFt,
      };
      let best = Infinity;
      for (const line of polylines) {
        for (let i = 0; i + 1 < line.length; i += 1) {
          best = Math.min(best, segmentRectDistance(line[i], line[i + 1], rect));
        }
      }
      expect(best, `${tag} should be within 2 ft of a pipe run (got ${best})`).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the relief header's first three points and size", () => {
    const design = designOf(build());
    const header = (design.pipes || []).find((r) => r.service === "Relief header to flare");
    expect(header).toBeTruthy();
    expect(header.diameterIn).toBe(24);
    expect(header.points.slice(0, 3).map(toFt)).toEqual([
      { x: 380, y: 180 },
      { x: 520, y: 180 },
      { x: 520, y: 400 },
    ]);
  });
});
