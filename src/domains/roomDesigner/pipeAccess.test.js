// pipeAccess.test.js — D10-03 access: walkways, crossovers, manways,
// the walk graph, operator access and removal volumes.
//
// Covers brief §D10-03 and the frozen acceptance vectors (O6):
// the 1200/600 crossover gap and tail boundaries at exact,
// 0.001-under and 0.001-over; loop wrap and rack-ID splitting;
// walkway headroom 84 / width 30 and secondary-road 120/120 at
// exact, under and over; the manway 180-in centerline trigger and
// its explicit D5 conflict; ladder/headroom/removal-path and
// unusable-bridge negatives. The module is pure and is NOT wired
// into validateDesign — PR E wires it when the sample is revised.

import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_CODES,
  CROSSOVER_GAP_MAX_IN,
  CROSSOVER_TAIL_MAX_IN,
  MANWAY_PLATFORM_TRIGGER_IN,
  PLATFORM_PROFILE_IN,
  SECONDARY_ROAD_PROFILE_IN,
  WALKWAY_PROFILE_IN,
  accessCheckStates,
  addCrossover,
  applyCrossoverProposal,
  barrierGeometry,
  barrierStation,
  buildWalkGraph,
  corridorStationLine,
  deleteCrossover,
  effectiveManwayPlatform,
  expectedAccessSubjects,
  manwayCenterlineAbovePavingIn,
  manwayProfileCompatibility,
  manwayReferencePlatform,
  nodeStandingElevationIn,
  pipeAccessRuleErrors,
  previewCrossoverProposal,
  reachableElevationsIn,
  resetAccessIds,
  resolvePathProfile,
  setAccessData,
  standingReachableDetail,
  subjectStandingElevationIn,
  suggestCrossoverStations,
  updateCrossover,
  validateClearanceEnvelope,
  validateCrossover,
  validateCrossoverSpacing,
  validateCorridorSpacing,
  validateOperatorAccess,
  validateRemovalVolumes,
  validateWalkGraph,
} from "./pipeAccess";
import { createEmptyDesign, placeSymbol, addPipeRun, resetDesignerIds } from "./designerDocument";
import { setRackParams } from "./rackGeometry";
import { createInitialState, designerReducer } from "@/components/designer/designerReducer";

const D = "processEquipment";

beforeEach(() => {
  resetDesignerIds();
  resetAccessIds();
});

const codes = (findings) => findings.map((f) => f.code);
const hasCode = (findings, code) => findings.some((f) => f.code === code);

// ---- fixtures ---------------------------------------------------------------

/** Walk path along y = 0 from (-500, 0) to (500, 0). */
const walkPath = (id = "w1", points = [{ x: -500, y: 0 }, { x: 500, y: 0 }], extra = {}) => ({
  id,
  kind: "walk",
  points,
  ...extra,
});
const drivePath = (id = "d1", points = [{ x: -500, y: 0 }, { x: 500, y: 0 }], extra = {}) => ({
  id,
  kind: "drive",
  points,
  ...extra,
});
const entryAt = (x, y, id = "e1") => ({ id, x, y });
const nodeAt = (x, y, id = "n1", extra = {}) => ({ id, kind: "manway", x, y, ...extra });

/** The vertical vessel's nozzle anchors: 4 catalog nozzles + 3 base utility ports. */
const VESSEL_ANCHORS = [
  "top-out",
  "side-in",
  "side-out",
  "bottom-out",
  "utility-plant-water",
  "utility-plant-air",
  "utility-nitrogen",
];
/**
 * Face geometry of the vertical vessel (48 x 48 x 120, base 0,
 * grade 0) — pinned literally, not computed from
 * connectionFaceForAnchor, so the binding is tested rather than
 * re-derived. Top nozzle face at the center in plan, 126 in
 * (120 + 6 neck); side nozzles at 74.4 in (120 x 0.62); utility
 * ports at 24 in; the manway face (center of the opening on the
 * shell) at (cx, cy + 24), served by the legacy D5 deck at 30 in.
 */
const VESSEL_FACES = {
  manway: { dx: 0, dy: 24, elevationIn: 30 },
  "top-out": { dx: 0, dy: 0, elevationIn: 126 },
  "side-in": { dx: -24, dy: 0, elevationIn: 74.4 },
  "side-out": { dx: 24, dy: 0, elevationIn: 74.4 },
  "bottom-out": { dx: 10.8, dy: 10.8, elevationIn: 74.4 },
  "utility-plant-water": { dx: -14.4, dy: 24, elevationIn: 24 },
  "utility-plant-air": { dx: 4.8, dy: 24, elevationIn: 24 },
  "utility-nitrogen": { dx: 14.4, dy: 24, elevationIn: 24 },
};
/** One required nozzle node per vessel anchor, standing at grade
 * with a modeled ladder up to that anchor's face — a node may not
 * merely author the face elevation (fix round 4): the climb from
 * grade is the evidence. */
const vesselFaceNodes = (cx, cy, anchorIds = VESSEL_ANCHORS, first = 2) =>
  anchorIds.map((anchorId, i) => {
    const f = VESSEL_FACES[anchorId];
    return nodeAt(cx + f.dx, cy + f.dy, `n${first + i}`, {
      kind: "nozzle",
      symbolId: "v1",
      anchorId,
      verticalAccess: { kind: "ladder", topElevationIn: f.elevationIn },
    });
  });
/** The manway node, standing at grade with a modeled ladder up to
 * the manway's platform elevation on the legacy D5 deck. */
const vesselManwayFaceNode = (cx, cy, id = "n1", extra = {}) =>
  nodeAt(cx + VESSEL_FACES.manway.dx, cy + VESSEL_FACES.manway.dy, id, {
    kind: "manway",
    symbolId: "v1",
    verticalAccess: { kind: "ladder", topElevationIn: VESSEL_FACES.manway.elevationIn },
    ...extra,
  });
/**
 * Walk path that visits every face of a vertical vessel at (cx, 0):
 * along y = 0 past both side faces, then up the east side and back
 * west along y = 24 past the manway and utility faces. Every face
 * node attaches to it, and every sub-segment that touches the
 * vessel footprint or the manway deck ends at a vessel node, so
 * the footprint exemption holds for the whole path.
 */
const vesselFacePath = (cx, id = "w1") =>
  walkPath(id, [
    { x: cx - 1000, y: 0 },
    { x: cx + 100, y: 0 },
    { x: cx, y: 24 },
    { x: cx - 1000, y: 24 },
  ]);

/** Sleeper rack at (0, 0): 480 long (x -240..240), 120 wide, top 18 in. */
const withSleeper = (design, id = "r1", x = 0, y = 0) =>
  placeSymbol(design, D, "sleeper-rack", x, y, { id });
const rackBarrier = (id = "b1", rackId = "r1", extra = {}) => ({
  id,
  kind: "sleeper-rack",
  rackId,
  ...extra,
});
const pipeBarrier = (id, runId, extra = {}) => ({ id, kind: "ground-pipe", runId, ...extra });

/** A usable crossover over the sleeper rack at station 0 (deck 120 x 36 @ 24 in). */
const usableCrossover = (id = "x1", barrierId = "b1", stationIn = 240) => ({
  id,
  barrierId,
  stationIn,
  deck: { lengthIn: 120, widthIn: 36, elevationIn: 24 },
  stairs: [
    { side: "a", fromIn: 0, toIn: 24 },
    { side: "b", fromIn: 0, toIn: 24 },
  ],
  supports: [{ x: 0, y: 0 }],
  guards: true,
  clearanceAbovePipeIn: 6,
  landings: [
    { side: "a", x: 0, y: -80, pathId: "pa" },
    { side: "b", x: 0, y: 80, pathId: "pb" },
  ],
});

/** Design with the sleeper rack + barrier + two walk paths either side (y = -80 / +80). */
const bridgedDesign = () => {
  let design = createEmptyDesign("Plan");
  design = withSleeper(design);
  design = setAccessData(design, { barriers: [rackBarrier()] });
  design = setAccessData(design, { paths: [
    walkPath("pa", [{ x: -500, y: -80 }, { x: 500, y: -80 }]),
    walkPath("pb", [{ x: -500, y: 80 }, { x: 500, y: 80 }]),
  ]});
  design = setAccessData(design, { crossovers: [usableCrossover()] });
  return design;
};

/** Vertical vessel at (500, 500) with a manway sill override (diameter stays 24). */
const vesselWithSill = (sillIn, extra = {}) => {
  let design = createEmptyDesign("Plan");
  design = placeSymbol(design, D, "vertical-vessel", 500, 500, { id: "v1" });
  const inst = design.symbols.find((s) => s.id === "v1");
  inst.manway = { sillIn };
  if (extra.noAccess) inst.noAccess = true;
  return design;
};

// ---- §5.2 clearance profiles ------------------------------------------------

describe("clearance profiles (§5.2)", () => {
  it("adopts the 84-in / 30-in walkway and 120-in / 120-in secondary-road profiles", () => {
    expect(WALKWAY_PROFILE_IN).toEqual({ headroomIn: 84, widthIn: 30 });
    expect(SECONDARY_ROAD_PROFILE_IN).toEqual({ headroomIn: 120, widthIn: 120 });
    expect(PLATFORM_PROFILE_IN.widthMinIn).toBe(30);
    expect(PLATFORM_PROFILE_IN.defaultWidthIn).toBe(36);
  });

  it("boundary fixtures: 83.999/84 headroom and 29.999/30 width", () => {
    expect(validateClearanceEnvelope("walk", { headroomIn: 84, widthIn: 30 }).state).toBe("PASS");
    expect(validateClearanceEnvelope("walk", { headroomIn: 83.999, widthIn: 30 }).state).toBe(
      ACCESS_CODES.CLEARANCE_HEADROOM_INSUFFICIENT,
    );
    expect(validateClearanceEnvelope("walk", { headroomIn: 84, widthIn: 29.999 }).state).toBe(
      ACCESS_CODES.CLEARANCE_WIDTH_INSUFFICIENT,
    );
    expect(validateClearanceEnvelope("drive", { headroomIn: 120, widthIn: 120 }).state).toBe("PASS");
    expect(validateClearanceEnvelope("drive", { headroomIn: 119.999, widthIn: 120 }).state).toBe(
      ACCESS_CODES.CLEARANCE_HEADROOM_INSUFFICIENT,
    );
    expect(validateClearanceEnvelope("drive", { headroomIn: 120, widthIn: 119.999 }).state).toBe(
      ACCESS_CODES.CLEARANCE_WIDTH_INSUFFICIENT,
    );
  });

  it("an authored larger envelope stands; an authored smaller one is flagged and the baseline governs", () => {
    const larger = resolvePathProfile({ kind: "walk", profile: { headroomIn: 96, widthIn: 48 } });
    expect(larger).toEqual({ headroomIn: 96, widthIn: 48, source: "authored" });
    const smaller = resolvePathProfile({ kind: "walk", profile: { headroomIn: 60, widthIn: 24 } });
    expect(smaller).toEqual({ headroomIn: 84, widthIn: 30, source: "baseline" });
    expect(
      validateClearanceEnvelope("walk", { headroomIn: 60, widthIn: 24 }).findings,
    ).toHaveLength(2);
  });

  it("platform width is a minimum only: the legacy D5 48-in catwalk does not fail", () => {
    expect(validateClearanceEnvelope("platform", { headroomIn: 84, widthIn: 48 }).state).toBe("PASS");
    expect(validateClearanceEnvelope("platform", { headroomIn: 84, widthIn: 29.999 }).state).toBe(
      ACCESS_CODES.CLEARANCE_WIDTH_INSUFFICIENT,
    );
  });

  it("a path with an authored smaller profile is flagged by the aggregate", () => {
    let design = createEmptyDesign("Plan");
    design = setAccessData(design, { paths: [walkPath("w1", undefined, { profile: { headroomIn: 60 } })] });
    const { findings } = accessCheckStates(design);
    expect(hasCode(findings, ACCESS_CODES.CLEARANCE_HEADROOM_INSUFFICIENT)).toBe(true);
  });
});

// ---- §5.3 manway profile -----------------------------------------------------

describe("manway profile (§5.3)", () => {
  it("centerline is base + sill + diameter/2 above paving", () => {
    const design = vesselWithSill(30);
    const inst = design.symbols.find((s) => s.id === "v1");
    expect(manwayCenterlineAbovePavingIn(design, inst)).toBe(42); // 0 + 30 + 12
  });

  it("boundary fixtures: 179.999 does not trigger, 180 does, 180.001 does", () => {
    for (const [sillIn, required] of [
      [167.999, false],
      [168, true],
      [168.001, true],
    ]) {
      const design = vesselWithSill(sillIn);
      const inst = design.symbols.find((s) => s.id === "v1");
      expect(manwayReferencePlatform(design, inst).required, `sill ${sillIn}`).toBe(required);
      expect(manwayReferencePlatform(design, inst).centerlineIn, `sill ${sillIn}`).toBeCloseTo(
        sillIn + 12,
        6,
      );
    }
    expect(MANWAY_PLATFORM_TRIGGER_IN).toBe(180);
  });

  it("reference platform rides 30 in below the centerline; ladder runs split at 360 in", () => {
    const design = vesselWithSill(168); // centerline 180
    const inst = design.symbols.find((s) => s.id === "v1");
    const ref = manwayReferencePlatform(design, inst);
    expect(ref.platformElevationIn).toBe(150);
    expect(ref.ladderRuns).toBe(1);
    const tall = vesselWithSill(378.001); // centerline 390.001, platform 360.001
    const tallInst = tall.symbols.find((s) => s.id === "v1");
    expect(manwayReferencePlatform(tall, tallInst).ladderRuns).toBe(2);
  });

  it("below the trigger the D5 legacy catwalk stands and no finding is raised", () => {
    const design = vesselWithSill(30); // centerline 42
    const { state, findings } = manwayProfileCompatibility(design);
    expect(state).toBe("NOT_APPLICABLE");
    expect(findings).toHaveLength(0);
  });

  it("no platform at all with the reference applying is MANWAY_PLATFORM_MISSING", () => {
    const design = vesselWithSill(168, { noAccess: true });
    const { state, findings } = manwayProfileCompatibility(design);
    expect(state).toBe(ACCESS_CODES.MANWAY_PLATFORM_MISSING);
    expect(findings[0].message).toContain("150");
  });

  it("the D5 deck at the sill conflicts with the reference platform 30 in below the centerline", () => {
    const design = vesselWithSill(168); // legacy deck at 168, reference at 150
    const { state, findings } = manwayProfileCompatibility(design);
    expect(state).toBe(ACCESS_CODES.MANWAY_PROFILE_CONFLICT);
    expect(findings[0].message).toContain("168");
    expect(findings[0].message).toContain("150");
    expect(findings[0].message).toContain("18");
  });

  it("an authored platform at the reference elevation resolves the conflict", () => {
    let design = vesselWithSill(168);
    design = setAccessData(design, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 150 }] });
    // The resolution is real: the reference platform is computed at
    // 150 in (centerline 180 minus the 30-in drop), not assumed.
    const inst = design.symbols.find((s) => s.id === "v1");
    expect(manwayReferencePlatform(design, inst).platformElevationIn).toBe(150);
    const { state, findings } = manwayProfileCompatibility(design);
    expect(state).toBe("PASS");
    expect(findings).toHaveLength(0);
  });

  it("a climb over 360 in is MANWAY_LADDER_RUN_EXCEEDED", () => {
    let design = vesselWithSill(378.001); // centerline 390.001, reference 360.001
    design = setAccessData(design, { platforms: [
      { id: "pf1", symbolId: "v1", elevationIn: 360.001 },
    ] });
    const { findings } = manwayProfileCompatibility(design);
    expect(hasCode(findings, ACCESS_CODES.MANWAY_LADDER_RUN_EXCEEDED)).toBe(true);
  });

  it("two authored platforms closer than 96 in apart is MANWAY_PLATFORM_SEPARATION", () => {
    let design = vesselWithSill(168);
    design = setAccessData(design, { platforms: [
      { id: "pf1", symbolId: "v1", elevationIn: 150 },
      { id: "pf2", symbolId: "v1", elevationIn: 200 }, // 50 apart
    ] });
    const { findings } = manwayProfileCompatibility(design);
    expect(hasCode(findings, ACCESS_CODES.MANWAY_PLATFORM_SEPARATION)).toBe(true);
    let ok = vesselWithSill(168);
    ok = setAccessData(ok, { platforms: [
      { id: "pf1", symbolId: "v1", elevationIn: 150 },
      { id: "pf2", symbolId: "v1", elevationIn: 246 }, // exactly 96 apart
    ] });
    expect(hasCode(manwayProfileCompatibility(ok).findings, ACCESS_CODES.MANWAY_PLATFORM_SEPARATION)).toBe(
      false,
    );
  });

  it("effectiveManwayPlatform prefers the authored platform over the legacy deck", () => {
    let design = vesselWithSill(168);
    design = setAccessData(design, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 150 }] });
    const inst = design.symbols.find((s) => s.id === "v1");
    expect(effectiveManwayPlatform(design, inst)).toEqual({
      elevationIn: 150,
      source: "authored",
      id: "pf1",
    });
    const bare = vesselWithSill(168);
    const bareInst = bare.symbols.find((s) => s.id === "v1");
    expect(effectiveManwayPlatform(bare, bareInst).source).toBe("legacy-d5");
    expect(effectiveManwayPlatform(bare, bareInst).elevationIn).toBe(168);
  });
});

// ---- Manway reference frame with nonzero grade --------------------------------
// The reference platform elevation is ABSOLUTE (grade + centerline − 30);
// the centerline and the platform height above paving are the relative
// values. With grade 0 the two frames coincide and the mix is invisible
// — these fixtures use grade 24 in so a frame error shows up as a
// 24-in delta. (vessel base 0, sill S, diameter 24: centerline above
// paving = S + 12 − 24.)

describe("manway reference frame (nonzero grade)", () => {
  const graded = (sillIn, gradeIn = 24) => {
    const design = vesselWithSill(sillIn);
    design.gradeElevationIn = gradeIn;
    return design;
  };

  it("reference keeps the above-paving height and the absolute elevation distinct", () => {
    const design = graded(192); // centerline 180 above paving
    const inst = design.symbols.find((s) => s.id === "v1");
    expect(manwayCenterlineAbovePavingIn(design, inst)).toBe(180);
    const ref = manwayReferencePlatform(design, inst);
    expect(ref.required).toBe(true);
    expect(ref.centerlineIn).toBe(180);
    expect(ref.centerlineAbovePavingIn).toBe(180);
    expect(ref.centerlineElevationIn).toBe(204); // grade 24 + 180
    expect(ref.platformAbovePavingIn).toBe(150);
    expect(ref.platformElevationIn).toBe(174); // grade 24 + 150, NOT 150
    expect(ref.ladderRuns).toBe(1);
    // The trigger boundary is on the above-paving centerline, not the
    // absolute elevation: 179.999 above paving does not trigger even
    // though its absolute elevation (203.999) is well past 180.
    const below = graded(191.999);
    const belowInst = below.symbols.find((s) => s.id === "v1");
    expect(manwayReferencePlatform(below, belowInst).required).toBe(false);
  });

  it("a platform at the absolute reference elevation resolves; the old relative number conflicts by the grade", () => {
    let repaired = graded(192);
    repaired = setAccessData(repaired, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 174 }] });
    expect(manwayProfileCompatibility(repaired).state).toBe("PASS");
    let wrong = graded(192);
    wrong = setAccessData(wrong, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 150 }] });
    const { state, findings } = manwayProfileCompatibility(wrong);
    expect(state).toBe(ACCESS_CODES.MANWAY_PROFILE_CONFLICT);
    expect(findings[0].message).toContain("24");
    expect(findings[0].referenceElevationIn).toBe(174);
    expect(findings[0].platformElevationIn).toBe(150);
  });

  it("ladder runs count the climb from paving, and a 360.001-in climb exceeds one run", () => {
    const tall = graded(402.001); // centerline 390.001 above paving, platform 360.001
    const tallInst = tall.symbols.find((s) => s.id === "v1");
    const ref = manwayReferencePlatform(tall, tallInst);
    expect(ref.platformAbovePavingIn).toBeCloseTo(360.001, 6);
    expect(ref.platformElevationIn).toBeCloseTo(384.001, 6);
    expect(ref.ladderRuns).toBe(2); // old code subtracted grade again and said 1
    let climbed = graded(402.001);
    climbed = setAccessData(climbed, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 384.001 }] });
    const { findings } = manwayProfileCompatibility(climbed);
    expect(hasCode(findings, ACCESS_CODES.MANWAY_LADDER_RUN_EXCEEDED)).toBe(true);
    // A climb of exactly 360 in is a legal single run.
    let ok = graded(402.001);
    ok = setAccessData(ok, { platforms: [{ id: "pf1", symbolId: "v1", elevationIn: 384 }] });
    const okResult = manwayProfileCompatibility(ok);
    expect(hasCode(okResult.findings, ACCESS_CODES.MANWAY_LADDER_RUN_EXCEEDED)).toBe(false);
  });

  it("missing-platform message names the absolute reference elevation", () => {
    const design = graded(192, 24);
    const inst = design.symbols.find((s) => s.id === "v1");
    inst.noAccess = true; // no platform at all
    const { state, findings } = manwayProfileCompatibility(design);
    expect(state).toBe(ACCESS_CODES.MANWAY_PLATFORM_MISSING);
    expect(findings[0].message).toContain("174");
  });
});

// ---- O6 crossover spacing ----------------------------------------------------

describe("crossover spacing (O6)", () => {
  it("suggests balanced stations: N = ceil(L / 1200), open (i + 0.5) * L / N", () => {
    expect(suggestCrossoverStations(2400)).toEqual([600, 1800]);
    expect(suggestCrossoverStations(1200)).toEqual([600]);
    const over = suggestCrossoverStations(1200.001);
    expect(over).toHaveLength(2);
    expect(over[0]).toBeCloseTo(300.00025, 6);
    expect(over[1]).toBeCloseTo(900.00075, 6);
    expect(suggestCrossoverStations(100)).toEqual([50]);
    expect(suggestCrossoverStations(2400, { loop: true })).toEqual([0, 1200]);
    expect(suggestCrossoverStations(0)).toEqual([]);
    expect(suggestCrossoverStations(-5)).toEqual([]);
  });

  it("gap boundary fixtures: 1199.999 and 1200 pass, 1200.001 fails", () => {
    expect(validateCrossoverSpacing(2399.999, [600, 1799.999]).state).toBe("PASS");
    expect(validateCrossoverSpacing(2400, [600, 1800]).state).toBe("PASS");
    expect(validateCrossoverSpacing(2400.001, [600, 1800.001]).state).toBe(
      ACCESS_CODES.CROSSOVER_GAP_EXCEEDED,
    );
    expect(validateCrossoverSpacing(2400.001, [600, 1800.001]).findings[0].message).toContain(
      "1200",
    );
  });

  it("tail boundary fixtures: 599.999 and 600 pass, 600.001 fails", () => {
    expect(validateCrossoverSpacing(1800, [600.001, 1200]).state).toBe(
      ACCESS_CODES.CROSSOVER_TAIL_EXCEEDED,
    );
    expect(validateCrossoverSpacing(1800, [600, 1199.999]).state).toBe(
      ACCESS_CODES.CROSSOVER_TAIL_EXCEEDED,
    );
    expect(validateCrossoverSpacing(1800, [599.999, 1200]).state).toBe("PASS");
    expect(validateCrossoverSpacing(1800, [600, 1200]).state).toBe("PASS");
  });

  it("no stations on an applicable barrier is CROSSOVER_MISSING", () => {
    expect(validateCrossoverSpacing(2400, []).state).toBe(ACCESS_CODES.CROSSOVER_MISSING);
    expect(validateCrossoverSpacing(0, []).state).toBe(ACCESS_CODES.CROSSOVER_SPACING_UNVERIFIED);
  });

  it("loop spacing checks the cyclic wrap gap and has no tails", () => {
    expect(validateCrossoverSpacing(2400, [0, 1200], { loop: true }).state).toBe("PASS");
    // Wrap gap 1200.001 with the interior gap in bounds: the loop check fires.
    expect(validateCrossoverSpacing(2400, [0, 1199.999], { loop: true }).state).toBe(
      ACCESS_CODES.CROSSOVER_LOOP_GAP_EXCEEDED,
    );
    // A station at the far end of a loop is the same point as station 0.
    expect(validateCrossoverSpacing(2400, [0, 2400], { loop: true }).state).toBe(
      ACCESS_CODES.CROSSOVER_GAP_EXCEEDED,
    );
  });

  it("rack-ID splitting: the group line is stationed across the rack-ID boundary", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design, "r1", 0, 0);
    design = addPipeRun(design, [{ x: 240, y: 0 }, { x: 720, y: 0 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 12,
    });
    design = addPipeRun(design, [{ x: 720, y: 0 }, { x: 1200, y: 0 }], {
      id: "p3",
      diameterIn: 2,
      elevationIn: 12,
    });
    design = setAccessData(design, { barriers: [
      { ...rackBarrier("b1", "r1"), groupId: "g1" },
      { ...pipeBarrier("b2", "p2"), groupId: "g1" },
      { ...pipeBarrier("b3", "p3"), groupId: "g1" },
    ] });
    const line = corridorStationLine(design, { groupId: "g1" });
    expect(line.lengthIn).toBe(1440);
    expect(line.segments).toEqual([
      { barrierId: "b1", offsetIn: 0, lengthIn: 480 },
      { barrierId: "b2", offsetIn: 480, lengthIn: 480 },
      { barrierId: "b3", offsetIn: 960, lengthIn: 480 },
    ]);
    // Stations at the group ends pass per-barrier but the 1440-in
    // group gap fails: the gap is measured on the group line.
    design = setAccessData(design, {
      crossovers: [
        { ...usableCrossover("x1", "b1", 0), landings: [] },
        { ...usableCrossover("x2", "b3", 480), landings: [] },
      ],
    });
    const { state } = validateCorridorSpacing(design, "b1");
    expect(state).toBe(ACCESS_CODES.CROSSOVER_GAP_EXCEEDED);
  });

  it("a group with a gap between barriers is BARRIER_GROUP_UNVERIFIED", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design, "r1", 0, 0);
    design = addPipeRun(design, [{ x: 300, y: 0 }, { x: 780, y: 0 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 12,
    });
    design = setAccessData(design, { barriers: [
      { ...rackBarrier("b1", "r1"), groupId: "g1" },
      { ...pipeBarrier("b2", "p2"), groupId: "g1" },
    ] });
    const line = corridorStationLine(design, { groupId: "g1" });
    expect(hasCode(line.findings, ACCESS_CODES.BARRIER_GROUP_UNVERIFIED)).toBe(true);
    expect(line.lengthIn).toBe(0);
  });
});

// ---- Crossover usability -----------------------------------------------------

describe("crossover usability", () => {
  it("a complete crossover over the sleeper rack passes", () => {
    const design = bridgedDesign();
    const barrier = design.access.barriers[0];
    const { state, findings } = validateCrossover(design, barrier, design.access.crossovers[0]);
    expect(state).toBe("PASS");
    expect(findings).toHaveLength(0);
  });

  it("deck shorter than the barrier width is CROSSOVER_DECK_SHORT", () => {
    const design = bridgedDesign();
    const bad = { ...usableCrossover(), deck: { lengthIn: 119, widthIn: 36, elevationIn: 24 } };
    expect(validateCrossover(design, design.access.barriers[0], bad).state).toBe(
      ACCESS_CODES.CROSSOVER_DECK_SHORT,
    );
  });

  it("deck narrower than 30 in is CROSSOVER_TOO_NARROW; 30 in passes", () => {
    const design = bridgedDesign();
    const narrow = { ...usableCrossover(), deck: { lengthIn: 120, widthIn: 29.999, elevationIn: 24 } };
    expect(validateCrossover(design, design.access.barriers[0], narrow).state).toBe(
      ACCESS_CODES.CROSSOVER_TOO_NARROW,
    );
    const ok = { ...usableCrossover(), deck: { lengthIn: 120, widthIn: 30, elevationIn: 24 } };
    expect(validateCrossover(design, design.access.barriers[0], ok).state).toBe("PASS");
  });

  it("stairs missing on a side, or not climbing to the deck, is CROSSOVER_STAIRS_MISSING", () => {
    const design = bridgedDesign();
    const oneSide = { ...usableCrossover(), stairs: [{ side: "a", fromIn: 0, toIn: 24 }] };
    expect(validateCrossover(design, design.access.barriers[0], oneSide).state).toBe(
      ACCESS_CODES.CROSSOVER_STAIRS_MISSING,
    );
    const short = {
      ...usableCrossover(),
      stairs: [
        { side: "a", fromIn: 0, toIn: 24 },
        { side: "b", fromIn: 0, toIn: 23 },
      ],
    };
    expect(validateCrossover(design, design.access.barriers[0], short).state).toBe(
      ACCESS_CODES.CROSSOVER_STAIRS_MISSING,
    );
  });

  it("no support is CROSSOVER_SUPPORTS_MISSING", () => {
    const design = bridgedDesign();
    const bad = { ...usableCrossover(), supports: [] };
    expect(validateCrossover(design, design.access.barriers[0], bad).state).toBe(
      ACCESS_CODES.CROSSOVER_SUPPORTS_MISSING,
    );
  });

  it("guards false is CROSSOVER_GUARDS_MISSING", () => {
    const design = bridgedDesign();
    const bad = { ...usableCrossover(), guards: false };
    expect(validateCrossover(design, design.access.barriers[0], bad).state).toBe(
      ACCESS_CODES.CROSSOVER_GUARDS_MISSING,
    );
  });

  it("clearance below the authored value is CROSSOVER_CLEARANCE_LOW; unauthored is unverified", () => {
    const design = bridgedDesign();
    const low = {
      ...usableCrossover(),
      deck: { lengthIn: 120, widthIn: 36, elevationIn: 23 },
      stairs: [
        { side: "a", fromIn: 0, toIn: 23 },
        { side: "b", fromIn: 0, toIn: 23 },
      ],
    };
    expect(validateCrossover(design, design.access.barriers[0], low).state).toBe(
      ACCESS_CODES.CROSSOVER_CLEARANCE_LOW,
    );
    const { clearanceAbovePipeIn, ...rest } = usableCrossover();
    expect(validateCrossover(design, design.access.barriers[0], rest).state).toBe(
      ACCESS_CODES.CROSSOVER_CLEARANCE_UNVERIFIED,
    );
  });

  it("a pipe through the deck footprint below deck + 84 in is CROSSOVER_HEADROOM_BLOCKED", () => {
    let design = bridgedDesign();
    design = addPipeRun(design, [{ x: -500, y: 0 }, { x: 500, y: 0 }], {
      id: "p9",
      diameterIn: 2,
      elevationIn: 60,
    });
    const { state } = validateCrossover(
      design,
      design.access.barriers[0],
      design.access.crossovers[0],
    );
    expect(state).toBe(ACCESS_CODES.CROSSOVER_HEADROOM_BLOCKED);
    // A pipe above deck + 84 in does not block.
    let high = bridgedDesign();
    high = addPipeRun(high, [{ x: -500, y: 0 }, { x: 500, y: 0 }], {
      id: "p9",
      diameterIn: 2,
      elevationIn: 200,
    });
    expect(
      validateCrossover(high, high.access.barriers[0], high.access.crossovers[0]).state,
    ).toBe("PASS");
  });

  it("a landing inside the barrier footprint or on no path is CROSSOVER_NOT_CONNECTED", () => {
    const design = bridgedDesign();
    const inside = {
      ...usableCrossover(),
      landings: [
        { side: "a", x: 0, y: -40, pathId: "pa" },
        { side: "b", x: 0, y: 80, pathId: "pb" },
      ],
    };
    expect(validateCrossover(design, design.access.barriers[0], inside).state).toBe(
      ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
    );
    const noPath = {
      ...usableCrossover(),
      landings: [
        { side: "a", x: 0, y: -80, pathId: "nope" },
        { side: "b", x: 0, y: 80, pathId: "pb" },
      ],
    };
    expect(validateCrossover(design, design.access.barriers[0], noPath).state).toBe(
      ACCESS_CODES.CROSSOVER_NOT_CONNECTED,
    );
  });

  it("preview builds a complete crossover record; apply is one transaction", () => {
    // No crossover yet: the suggested station (240, the middle) is free.
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, {
      barriers: [rackBarrier()],
      paths: [
        walkPath("pa", [{ x: -500, y: -80 }, { x: 500, y: -80 }]),
        walkPath("pb", [{ x: -500, y: 80 }, { x: 500, y: 80 }]),
      ],
    });
    const { proposal, unresolved } = previewCrossoverProposal(design, "b1", {
      clearanceAbovePipeIn: 6,
    });
    expect(unresolved).toHaveLength(0);
    expect(proposal.crossovers).toHaveLength(1);
    expect(proposal.crossovers[0].stationIn).toBe(240);
    expect(proposal.crossovers[0].deck.lengthIn).toBe(120); // barrier width
    expect(proposal.crossovers[0].deck.widthIn).toBe(36);
    expect(proposal.crossovers[0].deck.elevationIn).toBe(24); // top 18 + clearance 6
    expect(proposal.crossovers[0].stairs).toHaveLength(2);
    expect(proposal.crossovers[0].supports).toHaveLength(1);
    expect(proposal.crossovers[0].guards).toBe(true);
    expect(proposal.crossovers[0].landings[0].pathId).toBeNull(); // designer authors the path link
    const applied = applyCrossoverProposal(design, "b1", proposal);
    expect(applied.access.crossovers).toHaveLength(1);
    expect(applied.access.crossovers[0].stationIn).toBe(240);
    // Whole-apply refusal: one invalid entry refuses the entire apply.
    expect(() =>
      applyCrossoverProposal(design, "b1", {
        crossovers: [{ ...proposal.crossovers[0], deck: { lengthIn: -1 } }],
      }),
    ).toThrow();
    expect(design.access.crossovers).toEqual([]); // nothing applied
  });

  it("preview notes an unauthored clearance instead of inventing one", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [rackBarrier()] });
    const { proposal, unresolved } = previewCrossoverProposal(design, "b1");
    expect(proposal.crossovers).toHaveLength(1);
    expect(proposal.crossovers[0].deck.elevationIn).toBeNull();
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved[0]).toContain("clearance");
  });
});

// ---- Walk graph (brief item 7) ------------------------------------------------

describe("walk graph", () => {
  it("no access data at all is ACCESS_NOT_MODELED", () => {
    const design = createEmptyDesign("Plan");
    const { state, findings } = validateWalkGraph(design);
    expect(state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(findings.length).toBeGreaterThan(0);
    expect(pipeAccessRuleErrors(design)[0]).toMatch(/^ACCESS_NOT_MODELED: /);
  });

  it("an entry connected by a path to a node is reachable", () => {
    let design = createEmptyDesign("Plan");
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      nodes: [nodeAt(500, 0)],
    });
    expect(validateWalkGraph(design).state).toBe("PASS");
    const graph = buildWalkGraph(design);
    expect(graph.reachable.has(graph.attached.nodes.n1)).toBe(true);
    expect(validateOperatorAccess(design).state).toBe("PASS");
  });

  it("a node with no path near it is ACCESS_NOT_MODELED; with an authored pathId it is UNREACHABLE", () => {
    let design = createEmptyDesign("Plan");
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      nodes: [nodeAt(0, 500)],
    });
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    let named = createEmptyDesign("Plan");
    named = setAccessData(named, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      nodes: [nodeAt(0, 500, "n1", { pathId: "w1" })],
    });
    expect(validateWalkGraph(named).state).toBe(ACCESS_CODES.ACCESS_NODE_UNREACHABLE);
  });

  it("a node on a path disconnected from every entry is ACCESS_NODE_UNREACHABLE", () => {
    let design = createEmptyDesign("Plan");
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [
        walkPath("w1"),
        walkPath("w2", [{ x: 0, y: 500 }, { x: 500, y: 500 }]),
      ],
      nodes: [nodeAt(500, 500, "n1", { pathId: "w2" })],
    });
    const { state } = validateWalkGraph(design);
    expect(state).toBe(ACCESS_CODES.ACCESS_NODE_UNREACHABLE);
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.OPERATOR_ACCESS_UNREACHABLE);
  });

  it("a path crossing a barrier with no crossover is WALKWAY_OBSTRUCTED", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      barriers: [rackBarrier()],
    });
    const { state, findings } = validateWalkGraph(design);
    expect(state).toBe(ACCESS_CODES.WALKWAY_OBSTRUCTED);
    expect(findings[0].message).toContain("b1");
  });

  it("a usable crossover clears the crossing; an unusable one does not", () => {
    let design = bridgedDesign();
    design = setAccessData(design, {
      entries: [entryAt(-500, -80)],
      nodes: [nodeAt(500, 80, "n1", { pathId: "pb" })],
    });
    expect(validateWalkGraph(design).state).toBe("PASS");
    const graph = buildWalkGraph(design);
    expect(graph.reachable.has(graph.attached.nodes.n1)).toBe(true);
    // The same crossing with the guards removed is no longer usable:
    // the bridge contributes no edge and the crossing obstructs.
    let broken = bridgedDesign();
    broken = setAccessData(broken, {
      entries: [entryAt(-500, -80)],
      paths: [
        walkPath("pa", [{ x: -500, y: -80 }, { x: 500, y: -80 }]),
        walkPath("pb", [{ x: -500, y: 80 }, { x: 500, y: 80 }]),
        walkPath("w1", [{ x: -500, y: 0 }, { x: 500, y: 0 }]),
      ],
      nodes: [nodeAt(500, 80, "n1", { pathId: "pb" })],
      crossovers: [{ ...usableCrossover(), guards: false }],
    });
    const brokenResult = validateWalkGraph(broken);
    expect(brokenResult.state).toBe(ACCESS_CODES.ACCESS_NODE_UNREACHABLE);
    expect(hasCode(brokenResult.findings, ACCESS_CODES.WALKWAY_OBSTRUCTED)).toBe(true);
    const brokenGraph = buildWalkGraph(broken);
    expect(brokenGraph.reachable.has(brokenGraph.attached.nodes.n1)).toBe(false);
  });

  it("a pedestrian crossover never clears a vehicle obstruction", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [drivePath()],
      barriers: [rackBarrier()],
      crossovers: [usableCrossover()],
    });
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.DRIVE_OBSTRUCTED);
  });

  it("a low pipe crossing a walk path obstructs; a covering crossover clears it", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 12,
    });
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
    });
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.WALKWAY_OBSTRUCTED);
    // Author the pipe as a ground-pipe barrier and bridge it.
    let bridged = createEmptyDesign("Plan");
    bridged = addPipeRun(bridged, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 12,
    });
    bridged = setAccessData(bridged, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      barriers: [pipeBarrier("b1", "p1")],
      crossovers: [
        {
          id: "x1",
          barrierId: "b1",
          stationIn: 500,
          deck: { lengthIn: 3, widthIn: 36, elevationIn: 24 },
          stairs: [
            { side: "a", fromIn: 0, toIn: 24 },
            { side: "b", fromIn: 0, toIn: 24 },
          ],
          supports: [{ x: 0, y: 0 }],
          guards: true,
          clearanceAbovePipeIn: 6,
          landings: [
            { side: "a", x: 3, y: 0, pathId: "w1" },
            { side: "b", x: -3, y: 0, pathId: "w1" },
          ],
        },
      ],
    });
    expect(validateWalkGraph(bridged).state).toBe("PASS");
  });

  it("a pipe at 60 in over a walk path is WALKWAY_HEADROOM_BLOCKED", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 60,
    });
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
    });
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.WALKWAY_HEADROOM_BLOCKED);
    // Above the 84-in headroom it clears.
    let high = createEmptyDesign("Plan");
    high = addPipeRun(high, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 100,
    });
    high = setAccessData(high, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
    });
    expect(validateWalkGraph(high).state).toBe("PASS");
  });

  it("a path through an equipment footprint obstructs, except the destination's own approach", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "vertical-vessel", 0, 0, { id: "v1" });
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [vesselFacePath(0)],
      // The vessel's manway and nozzle subjects are modeled at their
      // faces, so the completeness gate passes and this tests the
      // footprint exemption.
      nodes: [vesselManwayFaceNode(0, 0), ...vesselFaceNodes(0, 0)],
    });
    // The nodes sit at the vessel faces: the final approach is exempt.
    expect(validateWalkGraph(design).state).toBe("PASS");
    let blocked = createEmptyDesign("Plan");
    blocked = placeSymbol(blocked, D, "vertical-vessel", 0, 0, { id: "v1" });
    blocked = setAccessData(blocked, {
      entries: [entryAt(-500, 0), entryAt(0, 300, "e2")],
      paths: [
        walkPath(),
        // A spur path approaches the vessel from the north and
        // visits every face, so its subjects are modeled there;
        // the through-path's destination is not the vessel, so its
        // footprint is not exempt.
        walkPath("w2", [
          { x: 0, y: 300 },
          { x: 0, y: 24 },
          { x: 0, y: 0 },
          { x: 24, y: 0 },
          { x: 24, y: 24 },
          { x: -24, y: 24 },
          { x: -24, y: 0 },
        ]),
      ],
      // All vessel nodes ride the spur (pathId "w2") so the
      // through-path keeps no vessel attachment.
      nodes: [
        nodeAt(500, 0, "n1"),
        vesselManwayFaceNode(0, 0, "n2", { pathId: "w2" }),
        ...vesselFaceNodes(0, 0, VESSEL_ANCHORS, 3).map((n) => ({ ...n, pathId: "w2" })),
      ],
    });
    expect(validateWalkGraph(blocked).state).toBe(ACCESS_CODES.WALKWAY_OBSTRUCTED);
  });

  it("a path through a pipe-rack column obstructs", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "pipe-rack", 0, 0, { id: "r1" });
    // Pipe rack: 480 long, bent spacing 240 -> columns at x = -240, 0, 240
    // on both column lines (z = +/-115). The y = 115 line runs through them.
    design = setAccessData(design, {
      entries: [entryAt(-500, 115)],
      paths: [walkPath("w1", [{ x: -500, y: 115 }, { x: 500, y: 115 }])],
    });
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.WALKWAY_OBSTRUCTED);
  });
});

// ---- Operator access + removal volumes ---------------------------------------

describe("operator access and removal volumes", () => {
  it("operator access is independent of pipe routing: a valid route can still fail access", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: -500, y: 0 }, { x: 500, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
      nodes: [nodeAt(0, 500, "n1", { kind: "valve" })],
    });
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("a removal node with no volume is REMOVAL_PATH_UNVERIFIED", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "vertical-vessel", 0, 0, { id: "v1" });
    design = setAccessData(design, {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
    });
    expect(validateRemovalVolumes(design).state).toBe(ACCESS_CODES.REMOVAL_PATH_UNVERIFIED);
  });

  it("a pipe run through a removal volume is REMOVAL_PATH_OBSTRUCTED; a clear volume passes", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "vertical-vessel", 0, 0, { id: "v1" });
    design = addPipeRun(design, [{ x: -500, y: 0 }, { x: 500, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = setAccessData(design, {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: 60 },
      ],
    });
    expect(validateRemovalVolumes(design).state).toBe(ACCESS_CODES.REMOVAL_PATH_OBSTRUCTED);
    let clear = createEmptyDesign("Plan");
    clear = placeSymbol(clear, D, "vertical-vessel", 0, 0, { id: "v1" });
    clear = addPipeRun(clear, [{ x: -500, y: 0 }, { x: 500, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
    });
    clear = setAccessData(clear, {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: 60 },
      ],
    });
    expect(validateRemovalVolumes(clear).state).toBe("PASS");
  });

  it("another equipment footprint inside a removal volume obstructs it", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "vertical-vessel", 0, 0, { id: "v1" });
    design = placeSymbol(design, D, "vertical-vessel", 100, 0, { id: "v2" });
    design = setAccessData(design, {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 120, halfWIn: 60 },
      ],
    });
    expect(validateRemovalVolumes(design).state).toBe(ACCESS_CODES.REMOVAL_PATH_OBSTRUCTED);
  });

  it("a zero or negative half-extent is not a usable removal volume", () => {
    let design = createEmptyDesign("Plan");
    design = placeSymbol(design, D, "vertical-vessel", 0, 0, { id: "v1" });
    // Authoring-time: setAccessData refuses degenerate volumes.
    expect(() =>
      setAccessData(design, {
        nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
        removalVolumes: [
          { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 0, halfWIn: 60 },
        ],
      }),
    ).toThrow(/halfLIn must be positive/);
    expect(() =>
      setAccessData(design, {
        nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
        removalVolumes: [
          { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: -5 },
        ],
      }),
    ).toThrow(/halfWIn must be positive/);
    expect(() =>
      setAccessData(design, {
        nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
        removalVolumes: [
          { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: 60, rotationDeg: NaN },
        ],
      }),
    ).toThrow(/rotationDeg must be a finite number/);
    // Runtime: a degenerate volume that arrived outside setAccessData
    // (hand-built or legacy data) is unverified, never "clear."
    let degenerate = createEmptyDesign("Plan");
    degenerate = placeSymbol(degenerate, D, "vertical-vessel", 0, 0, { id: "v1" });
    degenerate.access = {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 0, halfWIn: 60 },
      ],
    };
    expect(validateRemovalVolumes(degenerate).state).toBe(ACCESS_CODES.REMOVAL_PATH_UNVERIFIED);
    let inverted = createEmptyDesign("Plan");
    inverted = placeSymbol(inverted, D, "vertical-vessel", 0, 0, { id: "v1" });
    inverted.access = {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: -60 },
      ],
    };
    expect(validateRemovalVolumes(inverted).state).toBe(ACCESS_CODES.REMOVAL_PATH_UNVERIFIED);
    let badRotation = createEmptyDesign("Plan");
    badRotation = placeSymbol(badRotation, D, "vertical-vessel", 0, 0, { id: "v1" });
    badRotation.access = {
      nodes: [nodeAt(0, 0, "n1", { kind: "removal", symbolId: "v1" })],
      removalVolumes: [
        { id: "rv1", symbolId: "v1", cx: 0, cy: 0, zMinIn: 0, zMaxIn: 60, halfLIn: 60, halfWIn: 60, rotationDeg: Infinity },
      ],
    };
    expect(validateRemovalVolumes(badRotation).state).toBe(ACCESS_CODES.REMOVAL_PATH_UNVERIFIED);
  });
});

// ---- Access completeness: the applicability contract ---------------------------
// Derived subjects (manway, valve/instrument symbol, valve station,
// nozzle-bearing instance) each need a modeled access node. A design
// with an entry and a clear path but no nodes must NOT pass while a
// subject is unmodeled — that is the vacuous all-clear this suite
// closes. A design with genuinely no applicable subjects passes.

describe("access completeness", () => {
  /** Entry + walk path, no nodes, no equipment: the explicit control. */
  const entryAndPathOnly = () => {
    let design = createEmptyDesign("Plan");
    design = setAccessData(design, {
      entries: [entryAt(-500, 0)],
      paths: [walkPath()],
    });
    return design;
  };

  it("no applicable subjects is an explicit control: operator and walk graph PASS", () => {
    const design = entryAndPathOnly();
    expect(expectedAccessSubjects(design)).toEqual([]);
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
    expect(accessCheckStates(design).allClear).toBe(true);
  });

  it("a placed control valve with no node is ACCESS_NOT_MODELED, not PASS", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "control-valve", 500, 0, { id: "v1" });
    expect(expectedAccessSubjects(design)).toHaveLength(1);
    expect(expectedAccessSubjects(design)[0].kind).toBe("valve");
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(operator.findings[0].message).toContain("v1");
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    const aggregate = accessCheckStates(design);
    expect(aggregate.checks.operator).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(aggregate.checks.walkGraph).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(aggregate.allClear).toBe(false);
    // One finding, not two: operator and walk graph emit the same
    // completeness finding and the aggregate dedupes it.
    expect(
      aggregate.findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED),
    ).toHaveLength(1);
  });

  it("a placed pressure gauge with no node is ACCESS_NOT_MODELED", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "pressure-gauge", 500, 0, { id: "pi1" });
    expect(expectedAccessSubjects(design)).toHaveLength(1);
    expect(expectedAccessSubjects(design)[0].kind).toBe("instrument");
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("a pump's nozzles with no node are ACCESS_NOT_MODELED", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "centrifugal-pump", 500, 0, { id: "p1" });
    const subjects = expectedAccessSubjects(design);
    // One subject per anchor (suction + discharge), not one per pump.
    expect(subjects).toHaveLength(2);
    expect(subjects.map((s) => s.kind)).toEqual(["nozzle", "nozzle"]);
    expect(subjects.map((s) => s.anchorId)).toEqual(["suction-in", "discharge-out"]);
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("a vessel's manway and nozzles are separate subjects, both unmodeled without nodes", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    const subjects = expectedAccessSubjects(design);
    // One manway subject plus one subject per nozzle anchor: 4 catalog
    // nozzles + 3 base utility ports.
    expect(subjects.map((s) => s.kind).sort()).toEqual([
      "manway",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
    ]);
    expect(subjects.filter((s) => s.kind === "nozzle").map((s) => s.anchorId)).toEqual(
      VESSEL_ANCHORS,
    );
    const { findings } = validateOperatorAccess(design);
    expect(findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED)).toHaveLength(8);
  });

  it("a valve station on a pipe run with no node is ACCESS_NOT_MODELED", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200, // above the walkway headroom band: no obstruction
      valveStations: [{ stationIn: 500 }],
    });
    const subjects = expectedAccessSubjects(design);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ kind: "valve", runId: "p1", valveIndex: 0, stationIn: 500 });
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("a station-less valve station cannot be modeled at all", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{}],
    });
    const { state, findings } = validateOperatorAccess(design);
    expect(state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(findings[0].message).toContain("no authored route station");
  });

  it("a node of the wrong kind does not satisfy a subject", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "pressure-gauge", 500, 0, { id: "pi1" });
    design = setAccessData(design, {
      nodes: [nodeAt(500, 0, "n1", { kind: "valve", symbolId: "pi1" })],
    });
    expect(validateOperatorAccess(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("modeled subjects pass: valve, instrument, manway, nozzle and valve station nodes", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "control-valve", 500, 0, { id: "v1" });
    design = placeSymbol(design, D, "pressure-gauge", 500, 0, { id: "pi1" });
    expect(expectedAccessSubjects(design).map((s) => s.kind).sort()).toEqual([
      "instrument",
      "valve",
    ]);
    design = setAccessData(design, {
      nodes: [
        nodeAt(500, 0, "n1", { kind: "valve", symbolId: "v1" }),
        nodeAt(500, 0, "n2", { kind: "instrument", symbolId: "pi1" }),
      ],
    });
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");

    let vessel = entryAndPathOnly();
    vessel = placeSymbol(vessel, D, "vertical-vessel", 500, 0, { id: "v1" });
    expect(expectedAccessSubjects(vessel).map((s) => s.kind).sort()).toEqual([
      "manway",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
      "nozzle",
    ]);
    // Every node stands at grade with a modeled ladder up to its
    // face — the manway to the legacy D5 deck at 30 in, the top
    // nozzle to 126 in, the side nozzles to 74.4 in, the utility
    // ports to 24 in — and the walk path threads past every face.
    // Merely authoring the face elevation is not evidence (fix
    // round 4): the climb from grade is.
    vessel = setAccessData(vessel, {
      paths: [vesselFacePath(500)],
      nodes: [vesselManwayFaceNode(500, 0), ...vesselFaceNodes(500, 0)],
    });
    expect(validateOperatorAccess(vessel).state).toBe("PASS");
    expect(validateWalkGraph(vessel).state).toBe("PASS");

    let stationed = entryAndPathOnly();
    stationed = addPipeRun(stationed, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    // The valve station sits 200 in above grade, but its node
    // carries no elevation, platform or vertical connection — a
    // grade walk reaching the same plan coordinate is not proof
    // an operator can reach the valve, so both validators fail.
    stationed = setAccessData(stationed, {
      nodes: [nodeAt(0, 0, "n1", { kind: "valve", runId: "p1", valveIndex: 0 })],
    });
    expect(expectedAccessSubjects(stationed)).toHaveLength(1);
    expect(validateOperatorAccess(stationed).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(validateWalkGraph(stationed).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    const stationMissing = validateOperatorAccess(stationed).findings.filter(
      (f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED,
    );
    expect(stationMissing).toHaveLength(1);
    expect(stationMissing[0].message).toContain("stands at 0 in but the access point is at 200 in");
  });

  it("a required subject is not satisfied by an optional node", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    // Every subject is modeled at its face, but the manway node is optional —
    // optional nodes are never attached or reached.
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0, "n1", { required: false }),
        ...vesselFaceNodes(500, 0),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("optional");
    expect(missing[0].message).toContain("n1");
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    // The same node as required satisfies the manway.
    let required = entryAndPathOnly();
    required = placeSymbol(required, D, "vertical-vessel", 500, 0, { id: "v1" });
    required = setAccessData(required, {
      paths: [vesselFacePath(500)],
      nodes: [vesselManwayFaceNode(500, 0), ...vesselFaceNodes(500, 0)],
    });
    expect(validateOperatorAccess(required).state).toBe("PASS");
    expect(validateWalkGraph(required).state).toBe("PASS");
  });

  it("a matching node placed remotely does not satisfy its subject", () => {
    // Instrument: the node sits on the walk path but 900 in from the gauge.
    let gauge = entryAndPathOnly();
    gauge = placeSymbol(gauge, D, "pressure-gauge", 500, 0, { id: "pi1" });
    gauge = setAccessData(gauge, {
      nodes: [nodeAt(-400, 0, "n1", { kind: "instrument", symbolId: "pi1" })],
    });
    const gaugeMissing = validateOperatorAccess(gauge).findings.filter(
      (f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED,
    );
    expect(gaugeMissing).toHaveLength(1);
    expect(gaugeMissing[0].message).toContain("standing point (-400, 0) is not at");

    // Valve station: the node sits on the walk path 400 in from the station point.
    let stationed = entryAndPathOnly();
    stationed = addPipeRun(stationed, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    stationed = setAccessData(stationed, {
      nodes: [nodeAt(400, 0, "n1", { kind: "valve", runId: "p1", valveIndex: 0 })],
    });
    const stationMissing = validateOperatorAccess(stationed).findings.filter(
      (f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED,
    );
    expect(stationMissing).toHaveLength(1);
    expect(stationMissing[0].message).toContain("standing point (400, 0) is not at");

    // Nozzle: the node sits on the walk path but outside the vessel footprint.
    let vessel = entryAndPathOnly();
    vessel = placeSymbol(vessel, D, "vertical-vessel", 500, 0, { id: "v1" });
    vessel = setAccessData(vessel, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(0, 0, "n2", { kind: "nozzle", symbolId: "v1", anchorId: "side-out" }),
        ...vesselFaceNodes(500, 0, VESSEL_ANCHORS.filter((a) => a !== "side-out"), 3),
      ],
    });
    const vesselMissing = validateOperatorAccess(vessel).findings.filter(
      (f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED,
    );
    expect(vesselMissing).toHaveLength(1);
    expect(vesselMissing[0].message).toContain("Nozzle side-out on");
    expect(vesselMissing[0].message).toContain("standing point (0, 0) is not at");
  });

  it("multi-nozzle equipment: one modeled anchor leaves the rest unmodeled", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(524, 0, "n2", {
          kind: "nozzle",
          symbolId: "v1",
          anchorId: "side-out",
          verticalAccess: { kind: "ladder", topElevationIn: 74.4 },
        }),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(6);
    for (const anchorId of VESSEL_ANCHORS.filter((a) => a !== "side-out")) {
      expect(missing.some((f) => f.message.includes(`Nozzle ${anchorId} on`))).toBe(true);
    }
    expect(missing.some((f) => f.message.includes("Nozzle side-out on"))).toBe(false);
  });

  it("a node not at the face does not satisfy its nozzle or manway", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    // side-out faces east (+x), side-in faces west (-x), the manway faces south (+y).
    // All three nodes sit inside the footprint and on the walk path, but the
    // manway node stands 34 in from its face and the side-out node 34 in west
    // of its face — both beyond the 15.5-in standing tolerance — while the
    // side-in node stands 14 in from its face, inside the tolerance.
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        nodeAt(500, -10, "n1", { kind: "manway", symbolId: "v1" }),
        nodeAt(490, 0, "n2", { kind: "nozzle", symbolId: "v1", anchorId: "side-out" }),
        nodeAt(490, 0, "n3", {
          kind: "nozzle",
          symbolId: "v1",
          anchorId: "side-in",
          verticalAccess: { kind: "ladder", topElevationIn: 74.4 },
        }),
        ...vesselFaceNodes(
          500,
          0,
          VESSEL_ANCHORS.filter((a) => a !== "side-out" && a !== "side-in"),
          4,
        ),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(2);
    expect(missing.some((f) => f.message.includes("Manway on"))).toBe(true);
    expect(missing.some((f) => f.message.includes("Nozzle side-out on"))).toBe(true);
    // side-in IS satisfied by the node 14 in from its face; the rest by face nodes.
    expect(missing.some((f) => f.message.includes("Nozzle side-in on"))).toBe(false);
  });

  it("a nozzle node with no anchorId satisfies no nozzle", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(500, 0, "n2", { kind: "nozzle", symbolId: "v1" }),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(7);
    expect(missing.every((f) => f.message.includes("names no anchor"))).toBe(true);
    // A node naming another anchor is equally unlinked for this one.
    let wrong = entryAndPathOnly();
    wrong = placeSymbol(wrong, D, "vertical-vessel", 500, 0, { id: "v1" });
    wrong = setAccessData(wrong, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(476, 0, "n2", {
          kind: "nozzle",
          symbolId: "v1",
          anchorId: "side-in",
          verticalAccess: { kind: "ladder", topElevationIn: 74.4 },
        }),
      ],
    });
    const wrongMissing = validateOperatorAccess(wrong).findings.filter(
      (f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED,
    );
    expect(wrongMissing).toHaveLength(6);
    expect(
      wrongMissing.some((f) => f.message.includes('names anchor "side-in", not "side-out"')),
    ).toBe(true);
  });

  // ---- Vertical access datum (fix round 3) ---------------------------------
  // Binding is three-dimensional: a node satisfies a subject only
  // when its standing point is AT the face in plan AND its standing
  // elevation reaches the face elevation — or it declares an
  // explicit ladder/stairs connection up to it. Plan coincidence
  // alone never clears an elevated face.

  /** A valve station on a vertical run at x = 0, station at (0, 0, elevation). */
  const stationedAt = (elevationIn, nodeExtra = {}) => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn,
      valveStations: [{ stationIn: 500 }],
    });
    return setAccessData(design, {
      nodes: [nodeAt(0, 0, "n1", { kind: "valve", runId: "p1", valveIndex: 0, ...nodeExtra })],
    });
  };

  // Fix round 4: an authored standing elevation is not evidence.
  // A node that merely sets elevationIn to the subject elevation,
  // with no platform and no climb from grade, does not satisfy
  // the subject — and does not attach to the walk graph, so both
  // validators fail. The finding names the missing climb, and the
  // unattached node draws its own "no walk route" finding, so
  // these tests assert the subject message, not an exact count.
  it("a node whose elevationIn is set directly to the 200-in station, with no platform or climb, does not satisfy it", () => {
    const design = stationedAt(200, { elevationIn: 200 });
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(
      operator.findings.some((f) => f.message.includes("not reachable from grade")),
    ).toBe(true);
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(walk.findings.some((f) => f.message.includes("not reachable from grade"))).toBe(true);
    // The graph itself refuses the attachment: no vertex, no
    // provenance for the unreachable stand.
    const graph = buildWalkGraph(design);
    expect(graph.attached.nodes.n1).toBeUndefined();
    expect(graph.attached.nodeStandingElevationIn).toEqual({});
  });

  it("an invented intermediate elevation with only the final ladder leg does not reach a 400-in station", () => {
    const design = stationedAt(400, {
      elevationIn: 100,
      verticalAccess: { kind: "ladder", topElevationIn: 400 },
    });
    // The declared 300-in leg is within the 360-in cap, but the
    // 100-in stand it starts from is itself unreached: no
    // platform at 100 in and no climb to 100 in is modeled, so
    // the lower climb disappears and the chain fails.
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(
      operator.findings.some((f) => f.message.includes("not reachable from grade")),
    ).toBe(true);
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(walk.findings.some((f) => f.message.includes("not reachable from grade"))).toBe(true);
    expect(buildWalkGraph(design).attached.nodes.n1).toBeUndefined();
  });

  it("a complete platform and ladder chain reaches a 400-in station through a 200-in platform", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    // n1 climbs a 200-in ladder from grade to the 200-in station;
    // its ladder also proves 200 in is reachable, so the modeled
    // platform at 200 in is a standable datum, and n2 stands on
    // it with a second 200-in ladder up to the 400-in station.
    // Every ladder edge in the chain is within the 360-in cap.
    design = setAccessData(design, {
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(300, 0, "n2", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
      ],
    });
    expect(expectedAccessSubjects(design)).toHaveLength(2);
    expect(reachableElevationsIn(design)).toEqual([0, 200, 400]);
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
  });

  // Fix round 5: the intermediate landing is a required condition,
  // not an optional detail. This is the same 200→400 two-leg
  // geometry as the passing test above, but with ONLY the final
  // 400-in platform modeled — no platform at the 200-in datum
  // where the second leg begins. The chain must stop at 200 in:
  // both validators fail, and the 400-in node does not attach.
  it("a two-leg chain with only the final platform does not reach a 400-in station", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    design = setAccessData(design, {
      // Only the final platform: the 200-in transfer datum has no
      // modeled landing, so the second leg contributes nothing.
      platforms: [{ id: "pf1", elevationIn: 400 }],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(300, 0, "n2", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
      ],
    });
    expect(expectedAccessSubjects(design)).toHaveLength(2);
    expect(reachableElevationsIn(design)).toEqual([0, 200]);
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(
      operator.findings.some((f) => f.message.includes("not reachable from grade")),
    ).toBe(true);
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(walk.findings.some((f) => f.message.includes("not reachable from grade"))).toBe(true);
    // The graph refuses the attachment: no vertex, no provenance
    // for the unreachable stand.
    const graph = buildWalkGraph(design);
    expect(graph.attached.nodes.n2).toBeUndefined();
    expect(graph.attached.nodeStandingElevationIn.n2).toBeUndefined();
  });

  // Fix round 5: the landing rule applies at EVERY elevated
  // datum in a chain, not just the final one. Three 200-in legs
  // (each within the 360-in cap) reach a 600-in station only
  // when a modeled platform stands at both the 200-in and the
  // 400-in transfer datums.
  it("a three-leg chain reaches a 600-in station through modeled platforms at 200 and 400 in", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 600, y: -500 }, { x: 600, y: 500 }], {
      id: "p3",
      diameterIn: 2,
      elevationIn: 600,
      valveStations: [{ stationIn: 500 }],
    });
    design = setAccessData(design, {
      // The walk path is lengthened so the 600-in station at
      // (600, 0) stands on it.
      paths: [walkPath("w1", [{ x: -500, y: 0 }, { x: 1000, y: 0 }])],
      platforms: [
        { id: "pf1", elevationIn: 200 },
        { id: "pf2", elevationIn: 400 },
      ],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(300, 0, "n2", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(600, 0, "n3", {
          kind: "valve",
          runId: "p3",
          valveIndex: 0,
          elevationIn: 400,
          verticalAccess: { kind: "ladder", topElevationIn: 600 },
        }),
      ],
    });
    expect(expectedAccessSubjects(design)).toHaveLength(3);
    expect(reachableElevationsIn(design)).toEqual([0, 200, 400, 600]);
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
  });

  it("a three-leg chain missing the 400-in platform does not reach a 600-in station", () => {
    let design = entryAndPathOnly();
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 600, y: -500 }, { x: 600, y: 500 }], {
      id: "p3",
      diameterIn: 2,
      elevationIn: 600,
      valveStations: [{ stationIn: 500 }],
    });
    design = setAccessData(design, {
      paths: [walkPath("w1", [{ x: -500, y: 0 }, { x: 1000, y: 0 }])],
      // Only the 200-in landing: the 400-in transfer datum has no
      // modeled platform, so the third leg contributes nothing.
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(300, 0, "n2", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(600, 0, "n3", {
          kind: "valve",
          runId: "p3",
          valveIndex: 0,
          elevationIn: 400,
          verticalAccess: { kind: "ladder", topElevationIn: 600 },
        }),
      ],
    });
    expect(expectedAccessSubjects(design)).toHaveLength(3);
    expect(reachableElevationsIn(design)).toEqual([0, 200, 400]);
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(
      operator.findings.some((f) => f.message.includes("not reachable from grade")),
    ).toBe(true);
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(walk.findings.some((f) => f.message.includes("not reachable from grade"))).toBe(true);
    expect(buildWalkGraph(design).attached.nodes.n3).toBeUndefined();
  });

  // Fix round 5: the legacy D5 deck counts as an intermediate
  // landing — platformAtElevationIn's effective-manway-platform
  // branch, not just authored platform records. The vessel's
  // manway sill is set to 200 in, so its D5 deck rides at 200 in
  // and the manway node's 200→400 ladder extends the chain to
  // the 400-in station. The negative moves the sill (and the
  // deck) to 100 in, leaving the 200-in datum with no landing.
  it("a legacy D5 deck at the intermediate datum lets a chain reach a 400-in station", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    design.symbols.find((s) => s.id === "v1").manway = { sillIn: 200 };
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      // Only the final 400-in platform is an authored record: the
      // 200-in landing is the vessel's legacy D5 deck, not a record.
      platforms: [{ id: "pf2", elevationIn: 400 }],
      nodes: [
        nodeAt(0, 0, "na", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        vesselManwayFaceNode(500, 0, "nb", {
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(300, 0, "nc", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 400,
        }),
        ...vesselFaceNodes(500, 0, VESSEL_ANCHORS, 10),
      ],
    });
    // 2 valve stations + manway + 7 vessel nozzles.
    expect(expectedAccessSubjects(design)).toHaveLength(10);
    const reached = reachableElevationsIn(design);
    expect(reached).toEqual(expect.arrayContaining([0, 200, 400]));
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
  });

  it("a legacy D5 deck below the intermediate datum does not land a chain at a 400-in station", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    design.symbols.find((s) => s.id === "v1").manway = { sillIn: 100 };
    design = addPipeRun(design, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    design = addPipeRun(design, [{ x: 300, y: -500 }, { x: 300, y: 500 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 400,
      valveStations: [{ stationIn: 500 }],
    });
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      platforms: [{ id: "pf2", elevationIn: 400 }],
      nodes: [
        nodeAt(0, 0, "na", {
          kind: "valve",
          runId: "p1",
          valveIndex: 0,
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        vesselManwayFaceNode(500, 0, "nb", {
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(300, 0, "nc", {
          kind: "valve",
          runId: "p2",
          valveIndex: 0,
          elevationIn: 400,
        }),
        ...vesselFaceNodes(500, 0, VESSEL_ANCHORS, 10),
      ],
    });
    expect(expectedAccessSubjects(design)).toHaveLength(10);
    const reached = reachableElevationsIn(design);
    expect(reached).toContain(200);
    expect(reached).not.toContain(400);
    const operator = validateOperatorAccess(design);
    expect(operator.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(
      operator.findings.some((f) => f.message.includes("not reachable from grade")),
    ).toBe(true);
    const walk = validateWalkGraph(design);
    expect(walk.state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(walk.findings.some((f) => f.message.includes("not reachable from grade"))).toBe(true);
    const graph = buildWalkGraph(design);
    expect(graph.attached.nodes.nb).toBeUndefined();
    expect(graph.attached.nodes.nc).toBeUndefined();
  });

  it("a ladder from grade up to the station elevation satisfies an elevated valve station", () => {
    const design = stationedAt(200, {
      verticalAccess: { kind: "ladder", topElevationIn: 200 },
    });
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
  });

  it("stairs from grade up to a 400-in station satisfy it: stairs carry no adopted cap", () => {
    const design = stationedAt(400, {
      verticalAccess: { kind: "stairs", topElevationIn: 400 },
    });
    expect(validateOperatorAccess(design).state).toBe("PASS");
    expect(validateWalkGraph(design).state).toBe("PASS");
  });

  it("a ladder run over the adopted 360-in maximum does not reach the station", () => {
    const design = stationedAt(400, {
      verticalAccess: { kind: "ladder", topElevationIn: 400 },
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("exceeds the adopted 360-in ladder-run maximum");
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("an elevated top nozzle with no platform or vertical connection fails", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    // Every subject is modeled at its face — except the top nozzle,
    // whose node stands at the face in plan but at grade, with no
    // ladder or stairs up to the 126-in face.
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(500, 0, "n2", { kind: "nozzle", symbolId: "v1", anchorId: "top-out" }),
        ...vesselFaceNodes(500, 0, VESSEL_ANCHORS.filter((a) => a !== "top-out"), 3),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("Nozzle top-out on");
    expect(missing[0].message).toContain("stands at 0 in but the access point is at 126 in");
    expect(validateWalkGraph(design).state).toBe(ACCESS_CODES.ACCESS_NOT_MODELED);
  });

  it("a center point inside the footprint does not satisfy a side nozzle", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "vertical-vessel", 500, 0, { id: "v1" });
    // The side-out node stands at the vessel center — inside the
    // footprint, on the right side — but 24 in from the actual
    // face, beyond the 15.5-in tolerance. It stands at grade, so
    // the failure reported is the plan distance (plan is checked
    // before vertical).
    design = setAccessData(design, {
      paths: [vesselFacePath(500)],
      nodes: [
        vesselManwayFaceNode(500, 0),
        nodeAt(500, 0, "n2", {
          kind: "nozzle",
          symbolId: "v1",
          anchorId: "side-out",
        }),
        ...vesselFaceNodes(500, 0, VESSEL_ANCHORS.filter((a) => a !== "side-out"), 3),
      ],
    });
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("Nozzle side-out on");
    expect(missing[0].message).toContain("standing point (500, 0) is not at");
  });

  it("a TEMA nozzle's face elevation is not modeled, so no node can prove it reached", () => {
    let design = entryAndPathOnly();
    design = placeSymbol(design, D, "tema-exchanger", 500, 0, { id: "hx" });
    // Nodes stand AT each TEMA face in plan (faces pinned from the
    // catalog geometry: tube anchors at x 414.29, shell anchors at
    // 446.99 / 551.54, all at y ±21) — but the faces carry no
    // elevation, so the binding fails closed.
    design = setAccessData(design, {
      entries: [entryAt(400, -21)],
      paths: [
        walkPath("w1", [
          { x: 400, y: -21 },
          { x: 560, y: -21 },
          { x: 560, y: 21 },
          { x: 400, y: 21 },
        ]),
      ],
      nodes: [
        nodeAt(414.29, -21, "n1", {
          kind: "nozzle",
          symbolId: "hx",
          anchorId: "tube-in",
          elevationIn: 0,
        }),
        nodeAt(414.29, 21, "n2", {
          kind: "nozzle",
          symbolId: "hx",
          anchorId: "tube-out",
          elevationIn: 0,
        }),
        nodeAt(446.99, -21, "n3", {
          kind: "nozzle",
          symbolId: "hx",
          anchorId: "shell-in",
          elevationIn: 0,
        }),
        nodeAt(551.54, 21, "n4", {
          kind: "nozzle",
          symbolId: "hx",
          anchorId: "shell-out",
          elevationIn: 0,
        }),
      ],
    });
    const subjects = expectedAccessSubjects(design);
    expect(subjects).toHaveLength(4);
    expect(subjects.every((s) => subjectStandingElevationIn(design, s) === null)).toBe(true);
    const { findings } = validateOperatorAccess(design);
    const missing = findings.filter((f) => f.code === ACCESS_CODES.ACCESS_NOT_MODELED);
    expect(missing).toHaveLength(4);
    expect(missing.every((f) => f.message.includes("face elevation is not modeled"))).toBe(true);
  });

  it("subjectStandingElevationIn: manway platform, nozzle face, station, base", () => {
    let vessel = createEmptyDesign("Plan");
    vessel = placeSymbol(vessel, D, "vertical-vessel", 500, 0, { id: "v1" });
    const subjects = expectedAccessSubjects(vessel);
    const byId = Object.fromEntries(subjects.map((s) => [s.subjectId, s]));
    expect(subjectStandingElevationIn(vessel, byId["v1"])).toBe(30); // the manway subject
    expect(subjectStandingElevationIn(vessel, byId["v1/nozzle-top-out"])).toBe(126);
    expect(subjectStandingElevationIn(vessel, byId["v1/nozzle-side-in"])).toBeCloseTo(74.4, 6);
    let stationed = createEmptyDesign("Plan");
    stationed = addPipeRun(stationed, [{ x: 0, y: -500 }, { x: 0, y: 500 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 200,
      valveStations: [{ stationIn: 500 }],
    });
    expect(subjectStandingElevationIn(stationed, expectedAccessSubjects(stationed)[0])).toBe(200);
    let valve = createEmptyDesign("Plan");
    valve = placeSymbol(valve, D, "control-valve", 500, 0, { id: "v1" });
    expect(subjectStandingElevationIn(valve, expectedAccessSubjects(valve)[0])).toBe(0);
  });

  it("nodeStandingElevationIn: authored elevation, else grade", () => {
    const design = createEmptyDesign("Plan");
    expect(nodeStandingElevationIn(design, { elevationIn: 200 })).toBe(200);
    expect(nodeStandingElevationIn(design, {})).toBe(0);
  });

  it("buildWalkGraph records each attached node's standing elevation as provenance", () => {
    let design = entryAndPathOnly();
    // n2 stands at 200 in on a modeled platform reached by n0's
    // ladder from grade — an authored elevation alone is never
    // attached (fix round 4), so the platform and the ladder are
    // part of the fixture, not the assertion.
    design = setAccessData(design, {
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [
        nodeAt(0, 0, "n1", { kind: "valve", symbolId: "v1" }),
        nodeAt(100, 0, "n2", { kind: "valve", symbolId: "v1", elevationIn: 200 }),
        nodeAt(-100, 0, "n0", {
          kind: "valve",
          symbolId: "v1",
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
      ],
    });
    const graph = buildWalkGraph(design);
    expect(graph.attached.nodeStandingElevationIn).toEqual({ n1: 0, n2: 200, n0: 0 });
  });

  it("buildWalkGraph does not attach a node standing at an unreachable elevation", () => {
    let design = entryAndPathOnly();
    design = setAccessData(design, {
      nodes: [nodeAt(0, 0, "n1", { kind: "valve", symbolId: "v1", elevationIn: 200 })],
    });
    const graph = buildWalkGraph(design);
    expect(graph.attached.nodes.n1).toBeUndefined();
    expect(graph.attached.nodeStandingElevationIn).toEqual({});
  });

  it("reachableElevationsIn stops a chain at an elevated bottom with no modeled landing platform", () => {
    let design = entryAndPathOnly();
    design = setAccessData(design, {
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          symbolId: "v1",
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(100, 0, "n2", {
          kind: "valve",
          symbolId: "v1",
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(200, 0, "n3", {
          kind: "valve",
          symbolId: "v1",
          elevationIn: 400,
          verticalAccess: { kind: "ladder", topElevationIn: 800 },
        }),
      ],
    });
    // 200 in from grade; 400 in is NOT reached — the 200-in
    // bottom of the second leg has no modeled landing platform,
    // so there is no place to transfer from the first run to the
    // next (fix round 5). The 800-in run is doubly out: its
    // 400-in bottom is unreached, and the 400-in leg exceeds the
    // 360-in cap.
    expect(reachableElevationsIn(design)).toEqual([0, 200]);
  });

  it("reachableElevationsIn follows a complete ladder chain through a modeled intermediate platform", () => {
    let design = entryAndPathOnly();
    design = setAccessData(design, {
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          symbolId: "v1",
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(100, 0, "n2", {
          kind: "valve",
          symbolId: "v1",
          elevationIn: 200,
          verticalAccess: { kind: "ladder", topElevationIn: 400 },
        }),
        nodeAt(200, 0, "n3", {
          kind: "valve",
          symbolId: "v1",
          elevationIn: 400,
          verticalAccess: { kind: "ladder", topElevationIn: 800 },
        }),
      ],
    });
    // 200 in from grade, then 400 in from the modeled 200-in
    // platform; 800 in is not reached — the 400-in run from 400
    // in exceeds the 360-in cap.
    expect(reachableElevationsIn(design)).toEqual([0, 200, 400]);
  });

  it("standingReachableDetail: grade is reachable; an elevated stand needs both a platform and a chain", () => {
    let design = entryAndPathOnly();
    design = setAccessData(design, {
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          symbolId: "v1",
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(100, 0, "n2", { kind: "valve", symbolId: "v1", elevationIn: 200 }),
      ],
    });
    const [n1, n2] = design.access.nodes;
    expect(standingReachableDetail(design, n1).reachable).toBe(true); // grade
    expect(standingReachableDetail(design, n2)).toMatchObject({
      reachable: true,
      standing: 200,
    });
    // Platform alone, no chain: the stand is unproven.
    let platformOnly = entryAndPathOnly();
    platformOnly = setAccessData(platformOnly, {
      platforms: [{ id: "pf1", elevationIn: 200 }],
      nodes: [nodeAt(100, 0, "n2", { kind: "valve", symbolId: "v1", elevationIn: 200 })],
    });
    const lone = standingReachableDetail(platformOnly, platformOnly.access.nodes[0]);
    expect(lone.reachable).toBe(false);
    expect(lone.platformAtStanding).toBe(true);
    expect(lone.chainReachesStanding).toBe(false);
    // Chain alone, no platform: the climb exists but there is no
    // modeled place to stand at its top.
    let chainOnly = entryAndPathOnly();
    chainOnly = setAccessData(chainOnly, {
      nodes: [
        nodeAt(0, 0, "n1", {
          kind: "valve",
          symbolId: "v1",
          verticalAccess: { kind: "ladder", topElevationIn: 200 },
        }),
        nodeAt(100, 0, "n2", { kind: "valve", symbolId: "v1", elevationIn: 200 }),
      ],
    });
    const climbed = standingReachableDetail(chainOnly, chainOnly.access.nodes[1]);
    expect(climbed.reachable).toBe(false);
    expect(climbed.platformAtStanding).toBe(false);
    expect(climbed.chainReachesStanding).toBe(true);
  });
});

// ---- Editable workflow ---------------------------------------------------------

describe("editable workflow", () => {
  it("setAccessData validates kinds and finite numbers, detaches, and clears on null", () => {
    let design = createEmptyDesign("Plan");
    expect(() => setAccessData(design, { paths: [{ id: "w1", kind: "fly", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] })).toThrow();
    expect(() => setAccessData(design, { paths: [{ id: "w1", kind: "walk", points: [{ x: 0, y: 0 }, { x: NaN, y: 0 }] }] })).toThrow();
    const paths = [walkPath()];
    design = setAccessData(design, { paths });
    paths[0].points[0].x = 999;
    expect(design.access.paths[0].points[0].x).toBe(-500); // detached
    design = setAccessData(design, { paths: null });
    expect(design.access.paths).toEqual([]);
    expect(() => setAccessData(design, { paths: "nope" })).toThrow();
  });

  it("setAccessData validates verticalAccess shape", () => {
    let design = createEmptyDesign("Plan");
    expect(() =>
      setAccessData(design, {
        nodes: [
          nodeAt(0, 0, "n1", { verticalAccess: { kind: "elevator", topElevationIn: 200 } }),
        ],
      }),
    ).toThrow();
    expect(() =>
      setAccessData(design, {
        nodes: [nodeAt(0, 0, "n1", { verticalAccess: { kind: "ladder", topElevationIn: NaN } })],
      }),
    ).toThrow();
    expect(() =>
      setAccessData(design, {
        nodes: [nodeAt(0, 0, "n1", { verticalAccess: "ladder" })],
      }),
    ).toThrow();
    design = setAccessData(design, {
      nodes: [
        nodeAt(0, 0, "n1", { verticalAccess: { kind: "stairs", topElevationIn: 200 } }),
      ],
    });
    expect(design.access.nodes[0].verticalAccess).toEqual({
      kind: "stairs",
      topElevationIn: 200,
    });
  });

  it("add / update / delete crossover round-trips, with generated ids", () => {
    let design = bridgedDesign();
    design = deleteCrossover(design, "x1");
    expect(design.access.crossovers).toHaveLength(0);
    design = addCrossover(design, "b1", usableCrossover());
    expect(design.access.crossovers).toHaveLength(1);
    expect(design.access.crossovers[0].id).toBe("x1");
    const added = addCrossover(design, "b1", { ...usableCrossover(), id: undefined, stationIn: 240 });
    expect(added.access.crossovers).toHaveLength(2);
    expect(added.access.crossovers[1].id).toMatch(/^crossover-/);
    const updated = updateCrossover(added, "x1", { stationIn: 100 });
    expect(updated.access.crossovers.find((c) => c.id === "x1").stationIn).toBe(100);
    expect(() => updateCrossover(design, "nope", { stationIn: 1 })).toThrow();
    expect(() => addCrossover(design, "nope", usableCrossover())).toThrow();
  });

  it("applying a proposal remaps ids on collision", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [rackBarrier()] });
    design = setAccessData(design, { crossovers: [usableCrossover("x1", "b1", 100)] });
    const { proposal } = previewCrossoverProposal(design, "b1", { clearanceAbovePipeIn: 6 });
    proposal.crossovers[0].id = "x1"; // collides with the existing crossover
    const applied = applyCrossoverProposal(design, "b1", proposal);
    expect(applied.access.crossovers).toHaveLength(2);
    expect(applied.access.crossovers[1].id).not.toBe("x1");
    expect(applied.access.crossovers[1].id).toMatch(/^crossover-/);
  });

  it("applying after an id reset never duplicates crossover-1, even twice in one proposal", () => {
    // The reviewed bug: a single regeneration after resetAccessIds()
    // lands on `crossover-1` again when the design already holds it.
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [rackBarrier()] });
    design = setAccessData(design, { crossovers: [usableCrossover("crossover-1", "b1", 100)] });
    resetAccessIds();
    const { proposal } = previewCrossoverProposal(design, "b1", { clearanceAbovePipeIn: 6 });
    proposal.crossovers[0].id = "crossover-1"; // collides with the existing one
    const applied = applyCrossoverProposal(design, "b1", proposal);
    const ids = applied.access.crossovers.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(applied.access.crossovers[1].id).toBe("crossover-2");

    // Two colliding records in one proposal each get a fresh id.
    let two = createEmptyDesign("Plan");
    two = withSleeper(two);
    two = setAccessData(two, { barriers: [rackBarrier()] });
    two = setAccessData(two, {
      crossovers: [
        usableCrossover("crossover-1", "b1", 100),
        usableCrossover("crossover-2", "b1", 300),
      ],
    });
    resetAccessIds();
    const { proposal: twoProposal } = previewCrossoverProposal(two, "b1", {
      clearanceAbovePipeIn: 6,
    });
    const second = { ...usableCrossover(), id: "crossover-2", stationIn: 300 };
    const appliedTwo = applyCrossoverProposal(two, "b1", {
      crossovers: [
        { ...twoProposal.crossovers[0], id: "crossover-1" },
        second,
      ],
    });
    const twoIds = appliedTwo.access.crossovers.map((c) => c.id);
    expect(new Set(twoIds).size).toBe(twoIds.length);
    expect(appliedTwo.access.crossovers.slice(2).map((c) => c.id)).toEqual([
      "crossover-3",
      "crossover-4",
    ]);
  });

  it("addCrossover generates past an existing id after a counter reset", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [rackBarrier()] });
    design = setAccessData(design, { crossovers: [usableCrossover("crossover-1", "b1", 100)] });
    resetAccessIds();
    const added = addCrossover(design, "b1", { ...usableCrossover(), id: undefined, stationIn: 240 });
    const ids = added.access.crossovers.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(added.access.crossovers[1].id).toBe("crossover-2");
  });

  it("barrier geometry is derived from the source, never a label", () => {
    const design = bridgedDesign();
    const { geometry, findings } = barrierGeometry(design, design.access.barriers[0]);
    expect(findings).toHaveLength(0);
    expect(geometry.lengthIn).toBe(480);
    expect(geometry.widthIn).toBe(120);
    expect(geometry.topElevationIn).toBe(18); // rack top of steel
    expect(barrierStation(geometry, { x: 0, y: 0 })).toBe(240);
    const bad = barrierGeometry(design, { id: "bx", kind: "sleeper-rack", rackId: "nope" });
    expect(bad.geometry).toBeNull();
    expect(hasCode(bad.findings, ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED)).toBe(true);
  });

  it("an authored barrier top below the rack top is BARRIER_SOURCE_UNVERIFIED", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [{ ...rackBarrier(), topElevationIn: 12 }] });
    const { findings } = barrierGeometry(design, design.access.barriers[0]);
    expect(hasCode(findings, ACCESS_CODES.BARRIER_SOURCE_UNVERIFIED)).toBe(true);
  });
});

// ---- Aggregate -----------------------------------------------------------------

describe("aggregate access checks", () => {
  it("a clean design is all-clear; findings are deduplicated CODE: message strings", () => {
    let design = bridgedDesign();
    design = setAccessData(design, {
      entries: [entryAt(-500, -80)],
      nodes: [nodeAt(500, 80, "n1", { pathId: "pb" })],
    });
    const { checks, findings, allClear } = accessCheckStates(design);
    expect(checks).toEqual({
      profiles: "PASS",
      manway: "NOT_APPLICABLE",
      operator: "PASS",
      removal: "PASS",
      crossoverSpacing: "PASS",
      crossoverUsability: "PASS",
      walkGraph: "PASS",
    });
    expect(findings).toHaveLength(0);
    expect(allClear).toBe(true);
    expect(pipeAccessRuleErrors(design)).toEqual([]);
    // And the all-clear is real: the walk graph actually connects
    // the entry to the node across the bridge (a stub that always
    // reports PASS cannot produce this).
    const graph = buildWalkGraph(design);
    expect(graph.reachable.has(graph.attached.nodes.n1)).toBe(true);
  });

  it("an empty design is not all-clear and every finding is a CODE: message string", () => {
    const design = createEmptyDesign("Plan");
    const { allClear } = accessCheckStates(design);
    expect(allClear).toBe(false);
    const errors = pipeAccessRuleErrors(design);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toMatch(/^[A-Z_]+: .+/);
    }
    expect(new Set(errors).size).toBe(errors.length); // deduplicated
  });

  it("rack params are reachable from the module (smoke: setRackParams still works)", () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setRackParams(design, "r1", { elevationIn: 24 });
    const { geometry } = barrierGeometry(
      setAccessData(design, { barriers: [rackBarrier()] }),
      rackBarrier(),
    );
    expect(geometry.topElevationIn).toBe(24);
  });
});

// ---- Reducer wiring -------------------------------------------------------------

describe("reducer: D10-03 actions are one undoable transaction each", () => {
  const start = () => {
    let design = createEmptyDesign("Plan");
    design = withSleeper(design);
    design = setAccessData(design, { barriers: [rackBarrier()] });
    return createInitialState(design);
  };

  it("SET_ACCESS_DATA / ADD / UPDATE / DELETE crossover / APPLY_CROSSOVER_PROPOSAL", () => {
    let s = designerReducer(start(), {
      type: "SET_ACCESS_DATA",
      fields: { paths: [walkPath("pa", [{ x: -500, y: -80 }, { x: 500, y: -80 }])] },
    });
    expect(s.design.access.paths).toHaveLength(1);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.access.paths ?? []).toHaveLength(0);

    s = designerReducer(start(), {
      type: "ADD_CROSSOVER",
      barrierId: "b1",
      crossover: usableCrossover(),
    });
    expect(s.design.access.crossovers).toHaveLength(1);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.access.crossovers).toHaveLength(0);

    s = designerReducer(start(), {
      type: "ADD_CROSSOVER",
      barrierId: "b1",
      crossover: usableCrossover(),
    });
    s = designerReducer(s, { type: "UPDATE_CROSSOVER", crossoverId: "x1", patch: { stationIn: 100 } });
    expect(s.design.access.crossovers[0].stationIn).toBe(100);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.access.crossovers[0].stationIn).toBe(240);
    s = designerReducer(s, { type: "DELETE_CROSSOVER", crossoverId: "x1" });
    expect(s.design.access.crossovers).toHaveLength(0);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.access.crossovers).toHaveLength(1);

    // A rejected edit soft-fails: the state is returned unchanged.
    const bad = designerReducer(s, {
      type: "ADD_CROSSOVER",
      barrierId: "nope",
      crossover: usableCrossover(),
    });
    expect(bad).toBe(s);
    const badPatch = designerReducer(s, {
      type: "UPDATE_CROSSOVER",
      crossoverId: "x1",
      patch: { stationIn: NaN },
    });
    expect(badPatch).toBe(s);

    // Apply a previewed proposal in one transaction (fresh design:
    // no crossover yet, so the suggested middle station is free).
    const fresh = start();
    const { proposal } = previewCrossoverProposal(fresh.design, "b1", { clearanceAbovePipeIn: 6 });
    expect(proposal.crossovers).toHaveLength(1);
    const applied = designerReducer(fresh, {
      type: "APPLY_CROSSOVER_PROPOSAL",
      barrierId: "b1",
      proposal,
    });
    expect(applied.design.access.crossovers).toHaveLength(1);
    expect(applied.design.access.crossovers[0].stationIn).toBe(240);
    const undone = designerReducer(applied, { type: "UNDO" });
    expect(undone.design.access.crossovers).toHaveLength(0);
  });
});
