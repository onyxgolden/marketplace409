// pipeSupports.test.js — D10-02 size/profile support library and spacing.
//
// Covers brief §D10-02 and the frozen acceptance vectors (O1/O2/O3/O4):
// the adopted span table at max and max+0.001, the 2-in/24-in boundary
// fixtures, reducer/profile splits, developed-distance bends, transition
// and concentrated-load supports, nozzle/riser rules, pair spacing at
// the 3-in / 4-in / 1-in boundaries, rack travel/approach classification,
// rack organization (overflow/reserve/loop/tier separation), structure
// clearance, ground handling, and the editable workflow (add/edit/delete,
// carrier/tier reassignment, preview + one-transaction apply, whole-run
// revalidation after an edit).

import { beforeEach, describe, expect, it } from "vitest";
import {
  FLANGE_GAP_IN,
  LOW_PIPE_ELEVATION_IN,
  MAX_RACK_TIERS,
  SPACING_GAP_IN,
  STRUCTURE_CLEARANCE_IN,
  SUPPORT_CODES,
  SUPPORT_SPAN_TABLE_IN,
  TRANSITION_ADJACENCY_IN,
  addPipeSupport,
  applySupportProposal,
  deletePipeSupport,
  maxSpanInFor,
  pipeSupportRuleErrors,
  previewSupportProposal,
  proposeTierOverflow,
  requiredPairCenters,
  resetSupportIds,
  resolveSpanProfile,
  revalidateSupportsAfterEdit,
  riserGuideIntervalInFor,
  routeStations,
  setPipeSupportData,
  setRackReserve,
  setRouteIntervals,
  setSupportCarrier,
  supportCheckStates,
  transitionVertices,
  updatePipeSupport,
  validateGroundHandling,
  validateNozzleSupports,
  validatePairSpacing,
  validateRackOrganization,
  validateRouteClassification,
  validateStructureClearance,
  validateSupportSpans,
  validateTransitionSupports,
  verticalLegs,
} from "./pipeSupports";
import { RACK_BEAM_DEPTH_IN } from "./rackGeometry";
import {
  addPipeRun,
  addWall,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
  setPipeFields,
} from "./designerDocument";
import { setRackParams } from "./rackGeometry";
import {
  anchorsOf,
  attachmentInterfaceErrors,
  connectionFaceForAnchor,
  detectRunAttachments,
} from "./pipeAttachments";
import { findSymbol } from "./symbolRegistry";
import { createInitialState, designerReducer } from "@/components/designer/designerReducer";

const D = "processEquipment";

beforeEach(() => {
  resetDesignerIds();
  resetSupportIds();
});

const codes = (findings) => findings.map((f) => f.code);

/** Eligible span profile: water-filled standard-weight steel. */
const water = (sizeIn) => ({ nominalSizeIn: sizeIn, fluid: "water", basis: "water-filled-standard-steel" });
/** One field support at a station (foundation carrier). */
const sup = (stationIn, id, extra = {}) => ({
  id,
  type: "stanchion",
  stationIn,
  carrier: { kind: "foundation" },
  ...extra,
});
/** Rack-bent carrier on a rack/tier. */
const rackCarrier = (rackId, tier) => ({ kind: "rack-bent", rackId, tier });
/** Complete spacing data for a bare 2-in line (OD 2.375). */
const spacing = (over = {}) => ({
  outsideDiameterIn: 2.375,
  insulationIn: 0,
  expansionAllowanceIn: 0,
  spacingProfile: "ordinary",
  ...over,
});

const flat = (points, id = "p1", extra = {}) => {
  let design = createEmptyDesign("Plan");
  design = addPipeRun(design, points, { id, diameterIn: 2, elevationIn: 30, ...extra });
  return { design, run: design.pipes.find((p) => p.id === id) };
};

// Direct literal run (bypasses addPipeRun's plan dedupe) for risers and
// stored-elevation cases, mirroring the D10-01 test helper.
const literal = (points, elevIn, id = "p1", extra = {}) => {
  const design = createEmptyDesign("Plan");
  design.pipes = [{ id, points, elevIn, diameterIn: 2, elevationIn: 30, ...extra }];
  return { design, run: design.pipes[0] };
};

const withRack = (design, id = "r1", x = 0, y = 0) =>
  placeSymbol(design, D, "pipe-rack", x, y, { id });
const withSleeper = (design, id = "s1", x = 0, y = 0) =>
  placeSymbol(design, D, "sleeper-rack", x, y, { id });

/** Centrifugal pump "pump1" at (200, 200); suction-in is (200, 191), 4 in. */
const withPump = (design, id = "pump1", x = 200, y = 200) =>
  placeSymbol(design, D, "centrifugal-pump", x, y, { id });
const suctionFace = (design, id = "pump1") => {
  const inst = design.symbols.find((s) => s.id === id);
  return connectionFaceForAnchor(findSymbol(D, inst.symbolId), inst, "suction-in");
};
const suctionAnchor = (design, id = "pump1") =>
  anchorsOf(design.symbols.find((s) => s.id === id)).find((a) => a.id === "suction-in");

describe("span table", () => {
  it("adopts the digest §3.4 table exactly (17 sizes, water-filled standard-weight steel)", () => {
    expect(SUPPORT_SPAN_TABLE_IN).toEqual({
      0.5: 84,
      0.75: 84,
      1: 84,
      1.5: 108,
      2: 120,
      2.5: 132,
      3: 144,
      3.5: 156,
      4: 168,
      5: 192,
      6: 204,
      8: 228,
      10: 264,
      12: 276,
      14: 300,
      16: 324,
      18: 336,
      20: 360,
      24: 384,
    });
    expect(RACK_BEAM_DEPTH_IN).toBe(12);
    expect(MAX_RACK_TIERS).toBe(5);
  });

  it("resolves the eligible profile; vapor needs the explicit conservative baseline", () => {
    expect(resolveSpanProfile({ diameterIn: 2, spanProfile: water(2) })).toEqual({
      ok: true,
      sizeIn: 2,
      maxIn: 120,
    });
    expect(
      resolveSpanProfile({
        diameterIn: 2,
        spanProfile: { nominalSizeIn: 2, fluid: "vapor", basis: "vapor-conservative-baseline" },
      }),
    ).toEqual({ ok: true, sizeIn: 2, maxIn: 120 });
    // Vapor on the water-filled basis is not an explicit selection.
    expect(
      resolveSpanProfile({
        diameterIn: 2,
        spanProfile: { nominalSizeIn: 2, fluid: "vapor", basis: "water-filled-standard-steel" },
      }).ok,
    ).toBe(false);
    // No profile, an unknown size, or a non-steel material: unverifiable.
    expect(resolveSpanProfile({ diameterIn: 2 }).ok).toBe(false);
    expect(resolveSpanProfile({ diameterIn: 2, spanProfile: water(7) }).ok).toBe(false);
    expect(
      resolveSpanProfile({ diameterIn: 2, spanProfile: { ...water(2), material: "PVC" } }).ok,
    ).toBe(false);
    expect(maxSpanInFor(2)).toBe(120);
    expect(maxSpanInFor(7)).toBeNull();
  });
});

describe("validateSupportSpans (O1)", () => {
  it("passes every table row at its maximum and flags max+0.001", () => {
    for (const [size, max] of Object.entries(SUPPORT_SPAN_TABLE_IN)) {
      const at = flat(
        [
          { x: 0, y: 0 },
          { x: max, y: 0 },
        ],
        "p1",
        {
          diameterIn: Number(size),
          spanProfile: water(Number(size)),
          supports: [sup(0, "s1"), sup(max, "s2")],
        },
      );
      expect(validateSupportSpans(at.design, at.run).state).toBe("PASS");
      const over = flat(
        [
          { x: 0, y: 0 },
          { x: max + 0.001, y: 0 },
        ],
        "p1",
        {
          diameterIn: Number(size),
          spanProfile: water(Number(size)),
          supports: [sup(0, "s1"), sup(max + 0.001, "s2")],
        },
      );
      const found = validateSupportSpans(over.design, over.run);
      expect(codes(found.findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
      expect(found.findings[0].actualIn).toBeCloseTo(max + 0.001, 9);
      expect(found.findings[0].maxIn).toBe(max);
    }
  });

  it("frozen vectors: 2-in at 119.999/120/120.001 and 24-in at 383.999/384/384.001", () => {
    const check = (sizeIn, lenIn) => {
      const { design, run } = flat(
        [
          { x: 0, y: 0 },
          { x: lenIn, y: 0 },
        ],
        "p1",
        {
          diameterIn: sizeIn,
          spanProfile: water(sizeIn),
          supports: [sup(0, "s1"), sup(lenIn, "s2")],
        },
      );
      return validateSupportSpans(design, run);
    };
    expect(check(2, 119.999).state).toBe("PASS");
    expect(check(2, 120).state).toBe("PASS");
    expect(codes(check(2, 120.001).findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
    expect(check(24, 383.999).state).toBe("PASS");
    expect(check(24, 384).state).toBe("PASS");
    expect(codes(check(24, 384.001).findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
  });

  it("a 2-in line spanning 20 ft flags; a qualifying 24-in line at 32 ft does not fail for exceeding 20 ft", () => {
    const two = flat([{ x: 0, y: 0 }, { x: 240, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(240, "s2")],
    });
    expect(codes(validateSupportSpans(two.design, two.run).findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
    const twentyFour = flat([{ x: 0, y: 0 }, { x: 384, y: 0 }], "p1", {
      diameterIn: 24,
      spanProfile: water(24),
      supports: [sup(0, "s1"), sup(384, "s2")],
    });
    expect(validateSupportSpans(twentyFour.design, twentyFour.run).state).toBe("PASS");
  });

  it("measures developed distance, not plan distance: a 70+70 bend spans 140 in, not ~99 in", () => {
    const { design, run } = flat(
      [
        { x: 0, y: 0 },
        { x: 70, y: 0 },
        { x: 70, y: 70 },
      ],
      "p1",
      {
        diameterIn: 2,
        spanProfile: water(2),
        supports: [sup(0, "s1"), sup(140, "s2")],
      },
    );
    expect(routeStations(design, run).totalIn).toBeCloseTo(140, 9);
    const found = validateSupportSpans(design, run);
    expect(codes(found.findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
    expect(found.findings[0].actualIn).toBeCloseTo(140, 9);
  });

  it("a reducer station splits profile applicability: each side uses its own maximum", () => {
    // 2-in side [0,150] with a 130-in gap flags; the 4-in side [150,300]
    // at 150 in passes (max 168) — without the split it would fail at 120.
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      sizeChanges: [{ stationIn: 150, nominalSizeIn: 4 }],
      supports: [sup(0, "s1"), sup(130, "s2"), sup(300, "s3")],
    });
    const found = validateSupportSpans(design, run);
    expect(codes(found.findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
    expect(found.findings[0].fromStationIn).toBe(0);
    expect(found.findings[0].sizeIn).toBe(2);
    // The same geometry with the first gap at the 2-in maximum passes.
    const ok = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      sizeChanges: [{ stationIn: 150, nominalSizeIn: 4 }],
      supports: [sup(0, "s1"), sup(120, "s2"), sup(300, "s3")],
    });
    expect(validateSupportSpans(ok.design, ok.run).state).toBe("PASS");
    // A size change to an unadopted size is invalid, not silently applied.
    const bad = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      sizeChanges: [{ stationIn: 150, nominalSizeIn: 7 }],
      supports: [sup(0, "s1"), sup(300, "s2")],
    });
    expect(codes(validateSupportSpans(bad.design, bad.run).findings)).toContain(
      "SPAN_SIZE_CHANGE_INVALID",
    );
  });

  it("end tails are spans too, and a run with no scheduled support at all is unsupported", () => {
    // Tails of 60 in each side of one mid support: passes.
    const tailed = flat([{ x: 0, y: 0 }, { x: 120, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(60, "s1")],
    });
    expect(validateSupportSpans(tailed.design, tailed.run).state).toBe("PASS");
    // Tails of 130 in each side: the tails themselves exceed the maximum.
    const long = flat([{ x: 0, y: 0 }, { x: 260, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(130, "s1")],
    });
    expect(codes(validateSupportSpans(long.design, long.run).findings)).toEqual([
      "SPAN_EXCEEDS_MAX",
      "SPAN_EXCEEDS_MAX",
    ]);
    // No supports at all: no run is self-supporting, however short.
    const none = flat([{ x: 0, y: 0 }, { x: 60, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
    });
    expect(codes(validateSupportSpans(none.design, none.run).findings)).toEqual([
      "SUPPORT_NONE_SCHEDULED",
    ]);
  });

  it("a missing or inapplicable profile is unverified, never silently passed", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 60, y: 0 }], "p1", {
      diameterIn: 2,
      supports: [sup(0, "s1"), sup(60, "s2")],
    });
    expect(validateSupportSpans(design, run).state).toBe("SPAN_PROFILE_UNVERIFIABLE");
  });

  it("a guide or anchor in the supports list never clears a span; an unknown type never counts", () => {
    const guided = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        { id: "g1", type: "guide", stationIn: 0, carrier: { kind: "foundation" } },
        { id: "g2", type: "guide", stationIn: 100, carrier: { kind: "foundation" } },
      ],
    });
    expect(codes(validateSupportSpans(guided.design, guided.run).findings)).toEqual([
      "SUPPORT_NOT_WEIGHT_CARRYING",
      "SUPPORT_NOT_WEIGHT_CARRYING",
      "SUPPORT_NONE_SCHEDULED",
    ]);
    const weird = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [{ id: "w1", type: "magic-beam", stationIn: 50, carrier: { kind: "foundation" } }],
    });
    expect(codes(validateSupportSpans(weird.design, weird.run).findings)).toContain(
      "SUPPORT_TYPE_UNKNOWN",
    );
  });

  it("a support outside the route, or with an unverified carrier, does not count as a contact", () => {
    const outside = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(500, "s2")],
    });
    expect(codes(validateSupportSpans(outside.design, outside.run).findings)).toContain(
      "SUPPORT_STATION_OUT_OF_RANGE",
    );
    const ghostRack = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        { id: "s2", type: "stanchion", stationIn: 100, carrier: { kind: "rack-bent", rackId: "ghost" } },
      ],
    });
    expect(codes(validateSupportSpans(ghostRack.design, ghostRack.run).findings)).toContain(
      "SUPPORT_CARRIER_UNVERIFIED",
    );
  });

  it("a spring hanger carries weight; a pick-up must lie on its carrier line", () => {
    const hanger = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        { id: "h1", type: "spring-hanger", stationIn: 0, carrier: { kind: "hanger-rod", reference: "rod-A" } },
        { id: "h2", type: "spring-hanger", stationIn: 100, carrier: { kind: "hanger-rod", reference: "rod-B" } },
      ],
    });
    expect(validateSupportSpans(hanger.design, hanger.run).state).toBe("PASS");
    // A pick-up off a larger line that the support point does not lie on.
    const pickup = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        { id: "p1x", type: "pick-up", stationIn: 100, carrier: { kind: "larger-line", lineId: "ghost" } },
      ],
    });
    expect(codes(validateSupportSpans(pickup.design, pickup.run).findings)).toContain(
      "SUPPORT_CARRIER_UNVERIFIED",
    );
  });
});

describe("validateTransitionSupports (O2)", () => {
  const lRoute = (extra = {}) =>
    flat(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 60 },
      ],
      "p1",
      { diameterIn: 2, spanProfile: water(2), ...extra },
    );

  it("a short direction change missing adjacent support flags even when all spans are below max", () => {
    const { design, run } = lRoute({ supports: [sup(0, "s1"), sup(120, "s2")] });
    expect(validateSupportSpans(design, run).state).toBe("PASS");
    const found = validateTransitionSupports(design, run);
    expect(codes(found.findings)).toEqual(["TRANSITION_SUPPORT_MISSING"]);
    expect(found.findings[0].vertexIndex).toBe(1);
    expect(found.findings[0].kind).toBe("direction");
    expect(transitionVertices(design, run)).toHaveLength(1);
  });

  it("a support bound by index but remote from the transition station does not clear it", () => {
    // The verdict's counterexample: a foundation support at station 0
    // — or anywhere far from the elbow — must not clear a transition
    // merely by carrying the right transitionIndex. Here the elbow is
    // at vertex 1 (station 60) and the bound trunnion sits at 100.
    const remote = lRoute({
      supports: [
        sup(0, "s1"),
        sup(120, "s2"),
        { id: "t1", type: "trunnion", stationIn: 100, transitionIndex: 1, carrier: { kind: "foundation" } },
      ],
    });
    expect(codes(validateTransitionSupports(remote.design, remote.run).findings)).toEqual([
      "TRANSITION_SUPPORT_MISSING",
    ]);
    expect(validateTransitionSupports(remote.design, remote.run).findings[0].message).toMatch(
      /outside the 0\.5-in transition-adjacency tolerance/,
    );
    // Boundary: exactly at the named tolerance passes, 0.001 past it fails.
    const atTolerance = lRoute({
      supports: [
        sup(0, "s1"),
        sup(120, "s2"),
        {
          id: "t1",
          type: "trunnion",
          stationIn: 60 + TRANSITION_ADJACENCY_IN,
          transitionIndex: 1,
          carrier: { kind: "foundation" },
        },
      ],
    });
    expect(validateTransitionSupports(atTolerance.design, atTolerance.run).state).toBe("PASS");
    const pastTolerance = lRoute({
      supports: [
        sup(0, "s1"),
        sup(120, "s2"),
        {
          id: "t1",
          type: "trunnion",
          stationIn: 60 + TRANSITION_ADJACENCY_IN + 0.001,
          transitionIndex: 1,
          carrier: { kind: "foundation" },
        },
      ],
    });
    expect(codes(validateTransitionSupports(pastTolerance.design, pastTolerance.run).findings)).toEqual([
      "TRANSITION_SUPPORT_MISSING",
    ]);
  });

  it("a verified trunnion bound to the transition passes; a nearby-only support does not", () => {
    const bound = lRoute({
      supports: [
        sup(0, "s1"),
        sup(120, "s2"),
        { id: "t1", type: "trunnion", stationIn: 60, transitionIndex: 1, carrier: { kind: "foundation" } },
      ],
    });
    expect(validateTransitionSupports(bound.design, bound.run).state).toBe("PASS");
    // A support one inch from the elbow, with no transition binding,
    // is a remote support: it never counts because it sits inside a
    // span maximum.
    const nearby = lRoute({
      supports: [sup(0, "s1"), sup(59, "s2"), sup(120, "s3")],
    });
    expect(codes(validateTransitionSupports(nearby.design, nearby.run).findings)).toEqual([
      "TRANSITION_SUPPORT_MISSING",
    ]);
  });

  it("both riser transitions need support; an up/down jog has four transition locations", () => {
    const riser = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 90, 90],
      "p1",
      { diameterIn: 2, spanProfile: water(2), supports: [sup(0, "s1"), sup(200, "s2")] },
    );
    expect(transitionVertices(riser.design, riser.run).map((t) => t.vertexIndex)).toEqual([1, 2]);
    expect(codes(validateTransitionSupports(riser.design, riser.run).findings)).toEqual([
      "TRANSITION_SUPPORT_MISSING",
      "TRANSITION_SUPPORT_MISSING",
    ]);
    const supported = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 90, 90],
      "p1",
      {
        diameterIn: 2,
        spanProfile: water(2),
        supports: [
          sup(0, "s1"),
          sup(200, "s2"),
          { id: "d1", type: "dummy-leg", stationIn: 100, transitionIndex: 1, carrier: { kind: "foundation" } },
          { id: "d2", type: "dummy-leg", stationIn: 160, transitionIndex: 2, carrier: { kind: "foundation" } },
        ],
      },
    );
    expect(validateTransitionSupports(supported.design, supported.run).state).toBe("PASS");
    // Up/down jog: four transitions.
    const jog = literal(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 150, y: 0 },
      ],
      [30, 30, 60, 60, 30, 30],
      "p1",
      { diameterIn: 2, spanProfile: water(2), supports: [sup(0, "s1"), sup(210, "s2")] },
    );
    expect(transitionVertices(jog.design, jog.run).map((t) => t.vertexIndex)).toEqual([1, 2, 3, 4]);
    expect(validateTransitionSupports(jog.design, jog.run).findings).toHaveLength(4);
  });

  it("heavy valves and flanged assemblies need an adjacent scheduled load support", () => {
    const valve = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2"), sup(200, "s3")],
      valveStations: [{ parallelTo: "rack", operatorSide: true, stationIn: 100 }],
    });
    expect(codes(validateTransitionSupports(valve.design, valve.run).findings)).toEqual([
      "CONCENTRATED_LOAD_UNSUPPORTED",
    ]);
    const valveSupported = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        sup(100, "s2"),
        sup(200, "s3"),
        {
          id: "v1",
          type: "bracket",
          stationIn: 100,
          loadRef: { kind: "valve", index: 0, stationIn: 100 },
          carrier: { kind: "foundation" },
        },
      ],
      valveStations: [{ parallelTo: "rack", operatorSide: true, stationIn: 100 }],
    });
    expect(validateTransitionSupports(valveSupported.design, valveSupported.run).state).toBe("PASS");
    // A mid-route flange without a load support; an end flange is the
    // nozzle rule's, not the load rule's.
    const flange = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2"), sup(200, "s3")],
      flangeStations: [
        { stationIn: 0, flangeRadiusIn: 3 },
        { stationIn: 100, flangeRadiusIn: 3 },
      ],
    });
    expect(codes(validateTransitionSupports(flange.design, flange.run).findings)).toEqual([
      "CONCENTRATED_LOAD_UNSUPPORTED",
    ]);
  });

  it("a valve station with no authored route station is unverified, never cleared by index alone", () => {
    // Valve stations carry no route station in the current schema, so
    // an index-matched load support cannot prove adjacency: the check
    // must say so explicitly instead of passing on the label.
    const indexMatched = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        sup(100, "s2"),
        sup(200, "s3"),
        { id: "v1", type: "bracket", stationIn: 100, loadRef: { kind: "valve", index: 0 }, carrier: { kind: "foundation" } },
      ],
      valveStations: [{ parallelTo: "rack", operatorSide: true }],
    });
    expect(codes(validateTransitionSupports(indexMatched.design, indexMatched.run).findings)).toEqual([
      "CONCENTRATED_LOAD_UNVERIFIED",
    ]);
    const noSupport = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2"), sup(200, "s3")],
      valveStations: [{ parallelTo: "rack", operatorSide: true }],
    });
    expect(codes(validateTransitionSupports(noSupport.design, noSupport.run).findings)).toEqual([
      "CONCENTRATED_LOAD_UNVERIFIED",
    ]);
  });

  it("a valve load support must match the valve station, not just the index", () => {
    const mismatched = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        sup(100, "s2"),
        sup(200, "s3"),
        {
          id: "v1",
          type: "bracket",
          stationIn: 150,
          loadRef: { kind: "valve", index: 0, stationIn: 150 },
          carrier: { kind: "foundation" },
        },
      ],
      valveStations: [{ parallelTo: "rack", operatorSide: true, stationIn: 100 }],
    });
    expect(codes(validateTransitionSupports(mismatched.design, mismatched.run).findings)).toEqual([
      "CONCENTRATED_LOAD_UNSUPPORTED",
    ]);
  });

  it("a straight run with no transitions, valves or flanges is not applicable", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2")],
    });
    expect(validateTransitionSupports(design, run).state).toBe("NOT_APPLICABLE");
  });
});

describe("validateNozzleSupports (nozzle ends and risers)", () => {
  /** Pump-attached 4-in run from the suction nozzle, heading -y. */
  const attached = (extra = {}) => {
    let design = withPump(createEmptyDesign("Plan"));
    const face = suctionFace(design);
    const len = extra.lengthIn ?? 100;
    design = addPipeRun(
      design,
      [
        { x: face.x, y: face.y },
        { x: face.x + face.normal.x * len, y: face.y + face.normal.y * len },
      ],
      {
        id: "p1",
        diameterIn: face.sizeIn,
        elevationIn: face.elevationIn,
        spanProfile: water(face.sizeIn),
        ...extra.run,
      },
    );
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    return { design, run, face };
  };

  it("the test fixture really attaches: the suction face resolves with no errors", () => {
    const { design, run } = attached();
    expect(run.attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
    expect(attachmentInterfaceErrors(design, run, "start")).toEqual([]);
  });

  it("a nozzle end with no authored last support is unverified; a nozzle never carries weight", () => {
    const { design, run } = attached({
      run: { supports: [sup(0, "s1"), sup(100, "s2")] },
    });
    expect(codes(validateNozzleSupports(design, run).findings)).toEqual([
      "NOZZLE_SUPPORT_UNVERIFIED",
    ]);
  });

  it("the schedule must name a real weight support, and the actual last one before the nozzle", () => {
    const named = attached({
      run: {
        supports: [sup(0, "s1"), sup(100, "s2")],
        nozzleSupports: { start: { supportId: "s1" } },
      },
    });
    expect(validateNozzleSupports(named.design, named.run).state).toBe("PASS");
    const ghost = attached({
      run: {
        supports: [sup(0, "s1"), sup(100, "s2")],
        nozzleSupports: { start: { supportId: "nope" } },
      },
    });
    expect(codes(validateNozzleSupports(ghost.design, ghost.run).findings)).toEqual([
      "NOZZLE_SUPPORT_UNRESOLVED",
    ]);
    // s2 is closer to the nozzle than s1, so naming s1 is not the last.
    const wrong = attached({
      run: {
        supports: [sup(0, "s1"), sup(50, "s2"), sup(100, "s3")],
        nozzleSupports: { start: { supportId: "s2" } },
      },
    });
    // The start end is station 0: the last support before it is s1 at 0.
    // Naming s2 (station 50) leaves s1 between it and the nozzle.
    expect(codes(validateNozzleSupports(wrong.design, wrong.run).findings)).toEqual([
      "NOZZLE_SUPPORT_NOT_LAST",
    ]);
  });

  it("vertical legs need independent riser supports plus guides at the digest §3.10 intervals", () => {
    expect(riserGuideIntervalInFor(2)).toBe(300);
    expect(riserGuideIntervalInFor(3)).toBe(300);
    expect(riserGuideIntervalInFor(4)).toBe(360);
    expect(riserGuideIntervalInFor(6)).toBe(480);
    expect(riserGuideIntervalInFor(8)).toBe(600);
    expect(riserGuideIntervalInFor(10)).toBe(660);
    expect(riserGuideIntervalInFor(12)).toBeNull();
    const riser = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 90, 90],
      "p1",
      { diameterIn: 2, spanProfile: water(2), supports: [sup(0, "s1"), sup(210, "s2")] },
    );
    expect(verticalLegs(riser.design, riser.run)).toHaveLength(1);
    expect(verticalLegs(riser.design, riser.run)[0].lengthIn).toBe(60);
    expect(codes(validateNozzleSupports(riser.design, riser.run).findings)).toEqual([
      "RISER_SUPPORT_UNVERIFIED",
      "GUIDE_NOT_SCHEDULED",
    ]);
    // A 400-in riser needs brackets rated for 400 in in total, and
    // guides no more than 300 in apart (2-in profile).
    const tall = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 430, 430],
      "p1",
      {
        diameterIn: 2,
        spanProfile: water(2),
        supports: [
          sup(0, "s1"),
          sup(550, "s2"),
          { id: "r1", type: "riser-support", stationIn: 200, verticalLegIndex: 1, maxSupportedLengthIn: 200, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
        ],
        restraints: [
          { id: "g1", type: "guide", stationIn: 100, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
          { id: "g2", type: "guide", stationIn: 500, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
        ],
      },
    );
    // Leg stations are 100–500; guides at 100 and 500 bound the leg
    // ends, so gaps are 0/400/0 — the 400-in middle gap exceeds 300.
    expect(codes(validateNozzleSupports(tall.design, tall.run).findings)).toEqual([
      "RISER_SUPPORT_INSUFFICIENT",
      "GUIDE_INTERVAL_EXCEEDED",
    ]);
    // Rated brackets totalling 400 in and a mid guide at 300: passes.
    const tallOk = literal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [30, 30, 430, 430],
      "p1",
      {
        diameterIn: 2,
        spanProfile: water(2),
        supports: [
          sup(0, "s1"),
          sup(550, "s2"),
          { id: "r1", type: "riser-support", stationIn: 200, verticalLegIndex: 1, maxSupportedLengthIn: 250, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
          { id: "r2", type: "riser-support", stationIn: 400, verticalLegIndex: 1, maxSupportedLengthIn: 150, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
        ],
        restraints: [
          { id: "g1", type: "guide", stationIn: 100, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
          { id: "g2", type: "guide", stationIn: 300, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
          { id: "g3", type: "guide", stationIn: 500, carrier: { kind: "shell-bracket", reference: "vessel-shell" } },
        ],
      },
    );
    expect(validateNozzleSupports(tallOk.design, tallOk.run).state).toBe("PASS");
  });

  it("a run with no attached ends and no vertical legs is not applicable", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2")],
    });
    expect(validateNozzleSupports(design, run).state).toBe("NOT_APPLICABLE");
  });
});

describe("validatePairSpacing (O3)", () => {
  /** Two parallel bare 2-in runs at a center distance, both fully spacing-modeled. */
  const pairAt = (distanceIn, overA = {}, overB = {}) => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(
      design,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      { id: "a", diameterIn: 2, elevationIn: 30, ...spacing(), ...overA },
    );
    design = addPipeRun(
      design,
      [
        { x: 0, y: distanceIn },
        { x: 200, y: distanceIn },
      ],
      { id: "b", diameterIn: 2, elevationIn: 30, ...spacing(), ...overB },
    );
    return { design, a: design.pipes[0], b: design.pipes[1] };
  };

  it("frozen vectors: ordinary gap 2.999/3/3.001 and largest-line 3.999/4/4.001", () => {
    // Bare 2-in pair: required centers = 1.1875 + 1.1875 + gap.
    const ordinary = (gapIn) => pairAt(2.375 + gapIn);
    expect(validatePairSpacing(ordinary(2.999).design, ordinary(2.999).a, ordinary(2.999).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(ordinary(3).design, ordinary(3).a, ordinary(3).b).state).toBe("PASS");
    expect(validatePairSpacing(ordinary(3.001).design, ordinary(3.001).a, ordinary(3.001).b).state).toBe(
      "PASS",
    );
    const largest = (gapIn) =>
      pairAt(2.375 + gapIn, { spacingProfile: "largest-line" }, { spacingProfile: "largest-line" });
    expect(validatePairSpacing(largest(3.999).design, largest(3.999).a, largest(3.999).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(largest(4).design, largest(4).a, largest(4).b).state).toBe("PASS");
    expect(validatePairSpacing(largest(4.001).design, largest(4.001).a, largest(4.001).b).state).toBe(
      "PASS",
    );
    // One largest-line assignment governs the pair: the other line's
    // ordinary profile does not shrink the gap.
    const mixed = pairAt(2.375 + 3.5, { spacingProfile: "largest-line" }, {});
    expect(validatePairSpacing(mixed.design, mixed.a, mixed.b).state).toBe("SPACING_TOO_CLOSE");
  });

  it("uses per-pair envelopes: unequal OD, insulation and expansion allowance", () => {
    // 2-in (OD 2.375) vs 6-in (OD 6.625): required = 1.1875+3.3125+3 = 7.5.
    const unequal = pairAt(7.5, {}, { outsideDiameterIn: 6.625, diameterIn: 6 });
    expect(validatePairSpacing(unequal.design, unequal.a, unequal.b).state).toBe("PASS");
    const unequalClose = pairAt(7.499, {}, { outsideDiameterIn: 6.625, diameterIn: 6 });
    expect(validatePairSpacing(unequalClose.design, unequalClose.a, unequalClose.b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    // 1 in of insulation on one line adds 1 in to the required centers.
    const insulated = pairAt(2.375 + 1 + 3, { insulationIn: 1 }, {});
    expect(validatePairSpacing(insulated.design, insulated.a, insulated.b).state).toBe("PASS");
    const insulatedClose = pairAt(2.375 + 1 + 3 - 0.001, { insulationIn: 1 }, {});
    expect(validatePairSpacing(insulatedClose.design, insulatedClose.a, insulatedClose.b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    // Expansion allowances add on both sides: 0.5 + 0.5 = 1 in.
    const expanding = pairAt(2.375 + 3 + 1, { expansionAllowanceIn: 0.5 }, { expansionAllowanceIn: 0.5 });
    expect(validatePairSpacing(expanding.design, expanding.a, expanding.b).state).toBe("PASS");
    const expandingClose = pairAt(2.375 + 3 + 1 - 0.001, { expansionAllowanceIn: 0.5 }, { expansionAllowanceIn: 0.5 });
    expect(validatePairSpacing(expandingClose.design, expandingClose.a, expandingClose.b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(requiredPairCenters(expanding.a, expanding.b)).toMatchObject({
      ok: true,
      requiredIn: 6.375,
      gapIn: 3,
    });
  });

  it("frozen vectors: flange gap 0.999/1/1.001, and the flange check governs over the pipe check", () => {
    // Runs 6 in apart: pipe check passes (5.375), but a 4-in flange
    // radius on A needs 4 + 1.1875 + 1 = 6.1875 — the flange governs.
    const flanged = (distanceIn, radiusIn = 4) =>
      pairAt(distanceIn, { flangeStations: [{ stationIn: 100, flangeRadiusIn: radiusIn }] }, {});
    expect(validatePairSpacing(flanged(6).design, flanged(6).a, flanged(6).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(flanged(6.1875).design, flanged(6.1875).a, flanged(6.1875).b).state).toBe(
      "PASS",
    );
    // Flange-gap boundary: distance = radius + effective radius + gap.
    // Radius 4 makes the flange check govern (6.1875 > pipe 5.375).
    const boundary = (gapIn) => pairAt(4 + 1.1875 + gapIn, { flangeStations: [{ stationIn: 100, flangeRadiusIn: 4 }] }, {});
    expect(validatePairSpacing(boundary(0.999).design, boundary(0.999).a, boundary(0.999).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(boundary(1).design, boundary(1).a, boundary(1).b).state).toBe("PASS");
    expect(validatePairSpacing(boundary(1.001).design, boundary(1.001).a, boundary(1.001).b).state).toBe(
      "PASS",
    );
  });

  it("flange envelopes include both lines' expansion allowances; the flange check governs with movement", () => {
    // Runs 7 in apart, flange radius 4 on A, expansion 1 in on A and
    // 0.5 in on B. Pipe check needs 1.1875 + 1.1875 + 3 + 1 + 0.5 =
    // 6.875 (passes at 7), but the flange check needs
    // 4 + 1.1875 + 1 + 1 + 0.5 = 7.6875 — the flange governs, and
    // without the allowances it would need only 6.1875 and pass.
    const moving = (distanceIn) =>
      pairAt(
        distanceIn,
        { flangeStations: [{ stationIn: 100, flangeRadiusIn: 4 }], expansionAllowanceIn: 1 },
        { expansionAllowanceIn: 0.5 },
      );
    expect(validatePairSpacing(moving(7).design, moving(7).a, moving(7).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(moving(7.687).design, moving(7.687).a, moving(7.687).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(moving(7.6875).design, moving(7.6875).a, moving(7.6875).b).state).toBe(
      "PASS",
    );
    // Overlapping flanges with movement: 3 + 3 + 1 + 0.5 + 0.5 = 8.
    const overlapMoving = (distanceIn) =>
      pairAt(
        distanceIn,
        { flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }], expansionAllowanceIn: 0.5 },
        { flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }], expansionAllowanceIn: 0.5 },
      );
    expect(
      validatePairSpacing(overlapMoving(7.999).design, overlapMoving(7.999).a, overlapMoving(7.999).b).state,
    ).toBe("SPACING_TOO_CLOSE");
    expect(
      validatePairSpacing(overlapMoving(8).design, overlapMoving(8).a, overlapMoving(8).b).state,
    ).toBe("PASS");
  });

  it("overlapping flange stations use flange/flange envelopes + 1 in", () => {
    const overlap = (distanceIn) =>
      pairAt(
        distanceIn,
        { flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }] },
        { flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }] },
      );
    // Flange/flange needs 3 + 3 + 1 = 7; the pipe check alone needs 5.375.
    expect(validatePairSpacing(overlap(6.999).design, overlap(6.999).a, overlap(6.999).b).state).toBe(
      "SPACING_TOO_CLOSE",
    );
    expect(validatePairSpacing(overlap(7).design, overlap(7).a, overlap(7).b).state).toBe("PASS");
  });

  it("unknown OD, insulation, expansion or profile is unverified; nominal bore is not OD", () => {
    const noOd = pairAt(10, { outsideDiameterIn: undefined }, {});
    // addPipeRun drops undefined fields, so the run has no OD at all.
    expect("outsideDiameterIn" in noOd.a).toBe(false);
    expect(validatePairSpacing(noOd.design, noOd.a, noOd.b).state).toBe("SPACING_PROFILE_UNVERIFIED");
    const noProfile = pairAt(10, { spacingProfile: undefined }, {});
    expect("spacingProfile" in noProfile.a).toBe(false);
    expect(validatePairSpacing(noProfile.design, noProfile.a, noProfile.b).state).toBe(
      "SPACING_PROFILE_UNVERIFIED",
    );
    // The largest-line cutoff is never invented: a run with no profile
    // is unverified even when its diameter looks "large".
    const bigNoProfile = pairAt(10, { diameterIn: 24, outsideDiameterIn: 24, spacingProfile: undefined }, {});
    expect(validatePairSpacing(bigNoProfile.design, bigNoProfile.a, bigNoProfile.b).state).toBe(
      "SPACING_PROFILE_UNVERIFIED",
    );
    const odBelowBore = pairAt(10, { outsideDiameterIn: 1.5 }, {});
    expect(validatePairSpacing(odBelowBore.design, odBelowBore.a, odBelowBore.b).state).toBe(
      "SPACING_DATA_INVALID",
    );
  });

  it("runs joined by a verified junction are not a spacing pair", () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
      id: "a",
      diameterIn: 2,
      elevationIn: 30,
      ...spacing(),
    });
    design = addPipeRun(design, [{ x: 100, y: 0 }, { x: 100, y: 100 }], {
      id: "b",
      diameterIn: 2,
      elevationIn: 30,
      ...spacing(),
    });
    // Branch end on the host route, same elevation, same size.
    design.pipes = design.pipes.map((p) =>
      p.id === "b" ? { ...p, junctions: { start: { runId: "a" } } } : p,
    );
    const a = design.pipes[0];
    const b = design.pipes[1];
    expect(validatePairSpacing(design, a, b).state).toBe("NOT_APPLICABLE");
  });
});

describe("validateRouteClassification (O4)", () => {
  /** Pump-attached approach + riser + rack travel, the O4 positive case. */
  const approachFixture = () => {
    let design = withPump(createEmptyDesign("Plan"));
    design = withRack(design, "r1", 0, 0);
    const face = suctionFace(design);
    const elev = face.elevationIn;
    // (200,191)@elev → (200,120)@elev → (200,120)@180 → (-200,120)@180.
    // Developed: 71 + (180 - elev) + 400.
    const rise = 180 - elev;
    const approachLen = 71 + rise;
    const total = approachLen + 400;
    design.pipes = [
      {
        id: "p1",
        points: [
          { x: 200, y: 191 },
          { x: 200, y: 120 },
          { x: 200, y: 120 },
          { x: -200, y: 120 },
        ],
        elevIn: [elev, elev, 180, 180],
        diameterIn: face.sizeIn,
        elevationIn: elev,
        spanProfile: water(face.sizeIn),
        routeIntervals: [
          { fromStationIn: 0, toStationIn: approachLen, role: "EQUIPMENT_APPROACH", equipmentId: "pump1", rackId: "r1" },
          { fromStationIn: approachLen, toStationIn: total, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 120 },
        ],
      },
    ];
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    return { design, run, face, approachLen, total };
  };

  it("a supported equipment approach outside the rack passes its classification", () => {
    const { design, run } = approachFixture();
    expect(run.attachments).toEqual({ start: { symbolId: "pump1", anchorId: "suction-in" } });
    expect(attachmentInterfaceErrors(design, run, "start")).toEqual([]);
    expect(validateRouteClassification(design, run).state).toBe("PASS");
  });

  it("an approach that does not reach its serving rack exit fails; renamed travel fails", () => {
    // Ghost serving rack.
    const ghost = approachFixture();
    ghost.run.routeIntervals = [
      { fromStationIn: 0, toStationIn: ghost.approachLen, role: "EQUIPMENT_APPROACH", equipmentId: "pump1", rackId: "ghost" },
      { fromStationIn: ghost.approachLen, toStationIn: ghost.total, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 120 },
    ];
    expect(codes(validateRouteClassification(ghost.design, ghost.run).findings)).toContain(
      "ROUTE_CLASSIFICATION_UNVERIFIED",
    );
    // A 600-in straight run renamed as one approach, with no rack
    // travel anywhere: the equipment end attaches, the far end is
    // nowhere near a rack.
    let design = withPump(createEmptyDesign("Plan"));
    design = withRack(design, "r1", 0, 0);
    const face = suctionFace(design);
    design = addPipeRun(
      design,
      [
        { x: face.x, y: face.y },
        { x: face.x, y: face.y - 600 },
      ],
      {
        id: "p1",
        diameterIn: face.sizeIn,
        elevationIn: face.elevationIn,
        spanProfile: water(face.sizeIn),
        routeIntervals: [
          { fromStationIn: 0, toStationIn: 600, role: "EQUIPMENT_APPROACH", equipmentId: "pump1", rackId: "r1" },
        ],
      },
    );
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    expect(validateRouteClassification(design, run).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
  });

  it("there is no arbitrary 100-ft approach cap: a 1331-in supported approach classifies", () => {
    // Pump far from the rack: (1500,191) → (1500,120) → (240,120).
    // Developed 71 + 1260 = 1331 in > 1200 in, and it still classifies.
    let design = withPump(createEmptyDesign("Plan"), "pump1", 1500, 200);
    design = withRack(design, "r1", 0, 0);
    const face = suctionFace(design);
    design = addPipeRun(
      design,
      [
        { x: 1500, y: 191 },
        { x: 1500, y: 120 },
        { x: 240, y: 120 },
      ],
      {
        id: "p1",
        diameterIn: face.sizeIn,
        elevationIn: face.elevationIn,
        spanProfile: water(face.sizeIn),
        routeIntervals: [
          { fromStationIn: 0, toStationIn: 1331, role: "EQUIPMENT_APPROACH", equipmentId: "pump1", rackId: "r1" },
        ],
      },
    );
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    expect(attachmentInterfaceErrors(design, run, "start")).toEqual([]);
    expect(validateRouteClassification(design, run).state).toBe("PASS");
  });

  it("rack travel needs a real rack, a tier inside it, and the authored offset the route sits at", () => {
    const travel = (interval) =>
      flat(
        [
          { x: -100, y: 0 },
          { x: 200, y: 0 },
        ],
        "p1",
        {
          diameterIn: 2,
          elevationIn: 180,
          spanProfile: water(2),
          routeIntervals: [interval],
        },
      );
    const base = { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 };
    const noRack = travel(base);
    expect(validateRouteClassification(noRack.design, noRack.run).state).toBe(
      "ROUTE_CLASSIFICATION_UNVERIFIED",
    );
    let design = withRack(createEmptyDesign("Plan"));
    // flat() builds its own design; rebuild on the rack design instead.
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      routeIntervals: [base],
    });
    const run = design.pipes.find((p) => p.id === "p1");
    expect(validateRouteClassification(design, run).state).toBe("PASS");
    // Invalid tier (the default pipe rack has 2), missing offset, and
    // a route that sits at y=50 while claiming offset 0.
    const badTier = { ...base, tier: 3 };
    design = addPipeRun(withRack(createEmptyDesign("Plan")), [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "p1", diameterIn: 2, elevationIn: 180, spanProfile: water(2), routeIntervals: [badTier],
    });
    expect(validateRouteClassification(design, design.pipes[0]).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
    const noOffset = { ...base };
    delete noOffset.rackOffsetIn;
    design = addPipeRun(withRack(createEmptyDesign("Plan")), [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "p1", diameterIn: 2, elevationIn: 180, spanProfile: water(2), routeIntervals: [noOffset],
    });
    expect(validateRouteClassification(design, design.pipes[0]).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
    design = addPipeRun(withRack(createEmptyDesign("Plan")), [{ x: -100, y: 50 }, { x: 200, y: 50 }], {
      id: "p1", diameterIn: 2, elevationIn: 180, spanProfile: water(2), routeIntervals: [base],
    });
    expect(validateRouteClassification(design, design.pipes[0]).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
  });

  it("intervals must cover the whole developed route, and a short interconnect needs two attached ends plus a basis", () => {
    const gap = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 100, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
        { fromStationIn: 200, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
    });
    expect(validateRouteClassification(gap.design, gap.run).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
    const none = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
    });
    expect(validateRouteClassification(none.design, none.run).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
    // A short interconnect with no attachments and no basis.
    const inter = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      routeIntervals: [{ fromStationIn: 0, toStationIn: 100, role: "SHORT_INTERCONNECT" }],
    });
    expect(validateRouteClassification(inter.design, inter.run).state).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
  });

  it("a small line on 25-ft bent rhythm needs intermediate support; bent spacing is not span authority", () => {
    let design = withRack(createEmptyDesign("Plan"));
    design = setRackParams(design, "r1", { bentSpacingIn: 300 });
    design = addPipeRun(design, [{ x: -150, y: 0 }, { x: 150, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
      supports: [
        { id: "s1", type: "bent", stationIn: 0, carrier: rackCarrier("r1", 1) },
        { id: "s2", type: "bent", stationIn: 300, carrier: rackCarrier("r1", 1) },
      ],
    });
    const run = design.pipes.find((p) => p.id === "p1");
    expect(validateRouteClassification(design, run).state).toBe("PASS");
    expect(codes(validateSupportSpans(design, run).findings)).toEqual(["SPAN_EXCEEDS_MAX"]);
    // Intermediate supports at 100 and 200 bring every interval to 100 in.
    const fixed = setPipeSupportData(design, "p1", {
      supports: [
        { id: "s1", type: "bent", stationIn: 0, carrier: rackCarrier("r1", 1) },
        { id: "s2", type: "bent", stationIn: 100, carrier: rackCarrier("r1", 1) },
        { id: "s3", type: "bent", stationIn: 200, carrier: rackCarrier("r1", 1) },
        { id: "s4", type: "bent", stationIn: 300, carrier: rackCarrier("r1", 1) },
      ],
    });
    expect(validateSupportSpans(fixed, fixed.pipes.find((p) => p.id === "p1")).state).toBe("PASS");
  });
});

describe("validateRackOrganization", () => {
  /** Rack r1 with two fully spacing-modeled lines on tier 1. */
  const twoLines = (offsetA = 0, offsetB = 10, extraA = {}, extraB = {}) => {
    let design = withRack(createEmptyDesign("Plan"));
    design = setRackReserve(design, "r1", { spareWidthIn: 60 });
    const line = (id, offset, extra) =>
      addPipeRun(design, [{ x: -100, y: offset }, { x: 200, y: offset }], {
        id,
        diameterIn: 2,
        elevationIn: 180,
        spanProfile: water(2),
        ...spacing(),
        routeIntervals: [
          { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: offset },
        ],
        restraints: [{ id: `${id}-g1`, type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
        ...extra,
      });
    design = line("a", offsetA, extraA);
    design = line("b", offsetB, extraB);
    return { design, a: design.pipes[0], b: design.pipes[1] };
  };

  it("passes a spaced tier with reserve and guides; overflow proposes another tier within five", () => {
    const { design } = twoLines(0, 10);
    expect(validateRackOrganization(design, "r1").state).toBe("PASS");
    // Offsets 5 in apart: required centers are 5.375 in → overflow.
    const crowded = twoLines(0, 5);
    const found = validateRackOrganization(crowded.design, "r1");
    expect(codes(found.findings)).toEqual(["RACK_TIER_OVERFLOW"]);
    expect(found.findings[0].proposal).toEqual({ tier: 2 });
    expect(proposeTierOverflow(crowded.design, "r1", "b")).toEqual({ tier: 2 });
  });

  it("no tier with room means explicit resize/add-rack review, never a sixth tier", () => {
    // One-tier rack, both tiers' worth of lines crowded onto tier 1.
    let design = withRack(createEmptyDesign("Plan"));
    design = setRackParams(design, "r1", { tiers: 1 });
    design = setRackReserve(design, "r1", { spareWidthIn: 60 });
    const line = (id, offset) =>
      addPipeRun(design, [{ x: -100, y: offset }, { x: 200, y: offset }], {
        id,
        diameterIn: 2,
        elevationIn: 180,
        spanProfile: water(2),
        ...spacing(),
        routeIntervals: [
          { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: offset },
        ],
        restraints: [{ id: `${id}-g1`, type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
      });
    design = line("a", 0);
    design = line("b", 5);
    const found = validateRackOrganization(design, "r1");
    expect(codes(found.findings)).toEqual(["RACK_TIER_OVERFLOW"]);
    expect(found.findings[0].proposal).toEqual({ review: "resize-or-add-rack" });
    expect(proposeTierOverflow(design, "r1", "b")).toEqual({ review: "resize-or-add-rack" });
  });

  it("a missing reserve is unverified, never an invented percentage; zero or un fitting reserve fails", () => {
    let design = withRack(createEmptyDesign("Plan"));
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "a",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      ...spacing(),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
      restraints: [{ id: "a-g1", type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
    });
    expect(codes(validateRackOrganization(design, "r1").findings)).toEqual([
      "RACK_RESERVE_UNVERIFIED",
    ]);
    design = setRackReserve(design, "r1", { spareWidthIn: 0 });
    expect(codes(validateRackOrganization(design, "r1").findings)).toEqual([
      "RACK_RESERVE_EXCEEDED",
    ]);
    // Used width 2.375 in + 300 in of reserve cannot fit a 240-in rack.
    design = setRackReserve(design, "r1", { spareWidthIn: 300 });
    expect(codes(validateRackOrganization(design, "r1").findings)).toEqual([
      "RACK_RESERVE_EXCEEDED",
    ]);
  });

  it("tier separation follows actual envelopes plus beam depth, not a 3-in shortcut", () => {
    // Default tier spacing 72 in; a 24-in line with 2-in insulation
    // needs 28 + 12 = 40 in — passes. Tighten the rack to 36 in and
    // it fails; a 24-in bare line at 36 in (24 + 12) passes exactly.
    let design = withRack(createEmptyDesign("Plan"));
    design = setRackReserve(design, "r1", { spareWidthIn: 60 });
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "a",
      diameterIn: 24,
      elevationIn: 180,
      spanProfile: water(24),
      outsideDiameterIn: 24,
      insulationIn: 2,
      expansionAllowanceIn: 0,
      spacingProfile: "ordinary",
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
      restraints: [{ id: "a-g1", type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
      supports: [{ id: "a-sh1", type: "shoe", stationIn: 150, heightIn: 3, carrier: rackCarrier("r1", 1) }],
    });
    expect(validateRackOrganization(design, "r1").state).toBe("PASS");
    design = setRackParams(design, "r1", { tierSpacingIn: 36 });
    expect(codes(validateRackOrganization(design, "r1").findings)).toEqual([
      "TIER_SEPARATION_INSUFFICIENT",
    ]);
  });

  it("guides and shoes are scheduled; loop envelopes are authored", () => {
    const { design } = twoLines(0, 10);
    const noGuide = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "a" ? { ...p, restraints: [] } : p)),
    };
    expect(codes(validateRackOrganization(noGuide, "r1").findings)).toContain("GUIDE_NOT_SCHEDULED");
    // Insulated 4-in line with no shoe.
    let insulated = withRack(createEmptyDesign("Plan"));
    insulated = setRackReserve(insulated, "r1", { spareWidthIn: 60 });
    insulated = addPipeRun(insulated, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "a",
      diameterIn: 4,
      elevationIn: 180,
      spanProfile: water(4),
      outsideDiameterIn: 4.5,
      insulationIn: 1,
      expansionAllowanceIn: 0,
      spacingProfile: "ordinary",
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
      restraints: [{ id: "a-g1", type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
    });
    expect(codes(validateRackOrganization(insulated, "r1").findings)).toContain("SHOE_NOT_SCHEDULED");
    const withShoe = setPipeSupportData(insulated, "a", {
      supports: [{ id: "sh1", type: "shoe", stationIn: 150, heightIn: 3, carrier: rackCarrier("r1", 1) }],
    });
    expect(validateRackOrganization(withShoe, "r1").state).toBe("PASS");
    // Flexibility loop with no loop envelope; then with one.
    const looped = twoLines(0, 10, { flexibility: { required: true, provision: "loop", loopPoints: [{ x: 0, y: 0, zIn: 180 }, { x: 0, y: 40, zIn: 180 }, { x: 60, y: 40, zIn: 180 }, { x: 60, y: 0, zIn: 180 }] } }, {});
    expect(codes(validateRackOrganization(looped.design, "r1").findings)).toContain(
      "LOOP_ENVELOPE_UNVERIFIED",
    );
    const loopedOk = setRackReserve(looped.design, "r1", {
      spareWidthIn: 60,
      loopEnvelopes: [{ tier: 1, widthIn: 48 }],
    });
    expect(validateRackOrganization(loopedOk, "r1").state).toBe("PASS");
  });

  it("an unknown rack is not found; a rack with no travel lines is not applicable", () => {
    const design = withRack(createEmptyDesign("Plan"));
    expect(validateRackOrganization(design, "ghost").state).toBe("RACK_NOT_FOUND");
    expect(validateRackOrganization(design, "r1").state).toBe("NOT_APPLICABLE");
  });
});

describe("validateStructureClearance", () => {
  const flanged = (wallX = 1000) => {
    let design = createEmptyDesign("Plan");
    design = addWall(design, { x: wallX, y: -100 }, { x: wallX, y: 100 }, { id: "w1" });
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
      spanProfile: water(2),
      flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }],
      structureClearance: { applies: true },
    });
    return { design, run: design.pipes.find((p) => p.id === "p1") };
  };

  it("2 ft from the flange outside diameter: 27 in from centerline for a 3-in flange radius", () => {
    // Flange at (100, 0); wall at x = 100 + 27 passes, x = 100 + 26.999 fails.
    expect(validateStructureClearance(flanged(127).design, flanged(127).run).state).toBe("PASS");
    const close = flanged(126.999);
    const found = validateStructureClearance(close.design, close.run);
    expect(codes(found.findings)).toEqual(["STRUCTURE_CLEARANCE_VIOLATION"]);
    expect(found.findings[0].requiredIn).toBeCloseTo(STRUCTURE_CLEARANCE_IN + 3, 9);
  });

  it("a rack column counts as structure; applicability unknown stays named", () => {
    let design = withRack(createEmptyDesign("Plan"));
    design = addPipeRun(design, [{ x: -100, y: 115 }, { x: 200, y: 115 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }],
      structureClearance: { applies: true },
    });
    const run = design.pipes.find((p) => p.id === "p1");
    // Flange at (0, 115): exactly on a rack column line (columns at
    // x = -240/0/240, z = ±115).
    expect(codes(validateStructureClearance(design, run).findings)).toEqual([
      "STRUCTURE_CLEARANCE_VIOLATION",
    ]);
    const { design: d2, run: r2 } = flanged();
    expect(validateStructureClearance({ ...d2, pipes: [{ ...r2, structureClearance: { applies: false } }] }, { ...r2, structureClearance: { applies: false } }).state).toBe("NOT_APPLICABLE");
    const noFlag = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      flangeStations: [{ stationIn: 100, flangeRadiusIn: 3 }],
    });
    expect(validateStructureClearance(noFlag.design, noFlag.run).state).toBe(
      "STRUCTURE_CLEARANCE_UNVERIFIED",
    );
    const noFlanges = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      structureClearance: { applies: true },
    });
    expect(validateStructureClearance(noFlanges.design, noFlanges.run).state).toBe(
      "STRUCTURE_CLEARANCE_UNVERIFIED",
    );
    const explicitNone = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      flangeStations: [],
      structureClearance: { applies: true },
    });
    expect(validateStructureClearance(explicitNone.design, explicitNone.run).state).toBe(
      "NOT_APPLICABLE",
    );
  });
});

describe("validateGroundHandling", () => {
  it("bare ground is not support evidence; a low run on foundations passes", () => {
    const ground = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      elevationIn: 12,
      spanProfile: water(2),
      supports: [
        sup(0, "s1"),
        { id: "s2", type: "stanchion", stationIn: 100, carrier: { kind: "ground" } },
      ],
    });
    expect(ground.run.elevationIn).toBe(12);
    expect(ground.run.elevationIn).toBeLessThanOrEqual(LOW_PIPE_ELEVATION_IN);
    expect(codes(validateGroundHandling(ground.design, ground.run).findings)).toEqual([
      "GROUND_NOT_SUPPORT",
    ]);
    const founded = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      elevationIn: 12,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2")],
    });
    expect(validateGroundHandling(founded.design, founded.run).state).toBe("PASS");
  });

  it("a high run and a fully buried run are not applicable (D9 governs burial)", () => {
    const high = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      elevationIn: 30,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2")],
    });
    expect(validateGroundHandling(high.design, high.run).state).toBe("NOT_APPLICABLE");
    const buried = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      elevationIn: -36,
      underground: true,
      spanProfile: water(2),
    });
    expect(validateGroundHandling(buried.design, buried.run).state).toBe("NOT_APPLICABLE");
  });
});

describe("editable workflow (brief item 10)", () => {
  const runWithSupports = () =>
    flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(200, "s2")],
    });

  it("add/edit/delete support, and reassign carrier/tier", () => {
    const { design, run } = runWithSupports();
    expect(validateSupportSpans(design, run).state).toBe("SPAN_EXCEEDS_MAX");
    let next = addPipeSupport(design, "p1", { type: "stanchion", stationIn: 100, carrier: { kind: "foundation" } });
    let edited = next.pipes.find((p) => p.id === "p1");
    expect(edited.supports).toHaveLength(3);
    expect(edited.supports[2].id).toMatch(/^support-/);
    expect(validateSupportSpans(next, edited).state).toBe("PASS");
    // The original design is untouched (pure functions, no mutation).
    expect(design.pipes.find((p) => p.id === "p1").supports).toHaveLength(2);
    // Reassign the new support to a rack bent on tier 2.
    next = withRack(next, "r1", 0, 0);
    next = setSupportCarrier(next, "p1", edited.supports[2].id, { kind: "rack-bent", rackId: "r1", tier: 2 });
    edited = next.pipes.find((p) => p.id === "p1");
    expect(edited.supports[2].carrier).toEqual({ kind: "rack-bent", rackId: "r1", tier: 2 });
    // Update by patch, then delete: the span fails again.
    next = updatePipeSupport(next, "p1", edited.supports[2].id, { stationIn: 150 });
    edited = next.pipes.find((p) => p.id === "p1");
    expect(edited.supports[2].stationIn).toBe(150);
    expect(validateSupportSpans(next, edited).state).toBe("SPAN_EXCEEDS_MAX");
    next = deletePipeSupport(next, "p1", edited.supports[2].id);
    expect(next.pipes.find((p) => p.id === "p1").supports).toHaveLength(2);
    expect(() => addPipeSupport(next, "ghost", sup(50, "x"))).toThrow(/Unknown pipe run/);
    expect(() => updatePipeSupport(next, "p1", "ghost", { stationIn: 50 })).toThrow(/Unknown support/);
    expect(() => deletePipeSupport(next, "p1", "ghost")).toThrow(/Unknown support/);
    expect(() => addPipeSupport(next, "p1", { type: "stanchion" })).toThrow(/finite station/);
  });

  it("setPipeSupportData patches D10-02 fields deep-detached, and rejects bad values", () => {
    const { design } = runWithSupports();
    const profile = water(4);
    let next = setPipeSupportData(design, "p1", { spanProfile: profile, spacingProfile: "largest-line" });
    const run = next.pipes.find((p) => p.id === "p1");
    expect(run.spanProfile).toEqual(water(4));
    expect(run.spacingProfile).toBe("largest-line");
    profile.nominalSizeIn = 99;
    expect(run.spanProfile.nominalSizeIn).toBe(4);
    next = setPipeSupportData(next, "p1", { spacingProfile: null });
    expect("spacingProfile" in next.pipes.find((p) => p.id === "p1")).toBe(false);
    expect(() => setPipeSupportData(next, "p1", { spacingProfile: "huge" })).toThrow(/spacing profile/);
    expect(() => setPipeSupportData(next, "p1", { outsideDiameterIn: "wide" })).toThrow(/finite number/);
    expect(() => setPipeSupportData(next, "ghost", {})).toThrow(/Unknown pipe run/);
  });

  it("setRouteIntervals replaces the classification; setRackReserve authors the reserve", () => {
    let design = withRack(createEmptyDesign("Plan"));
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
    });
    expect(validateRouteClassification(design, design.pipes[0]).state).toBe("PASS");
    design = setRouteIntervals(design, "p1", []);
    expect(validateRouteClassification(design, design.pipes[0]).state).toBe(
      "ROUTE_CLASSIFICATION_UNVERIFIED",
    );
    design = setRackReserve(design, "r1", { spareWidthIn: 60 });
    expect(design.symbols.find((s) => s.id === "r1").rack.reserve).toEqual({ spareWidthIn: 60 });
    expect(() => setRackReserve(design, "ghost", { spareWidthIn: 60 })).toThrow(/Unknown rack/);
    expect(() => setRackReserve(design, "r1", { spareWidthIn: "wide" })).toThrow(/finite number/);
  });

  it("preview proposes without mutating; apply is one transaction and refuses a bad proposal whole", () => {
    const { design, run } = flat(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 60 },
      ],
      "p1",
      { diameterIn: 2, spanProfile: water(2), supports: [sup(0, "s1")] },
    );
    // Developed 120 in; one contact at 0 leaves a 120-in span (at max)
    // plus an unbound transition at vertex 1 (station 60).
    const { proposal, findings, unresolved } = previewSupportProposal(design, run);
    expect(findings).toEqual([]);
    expect(unresolved).toEqual([]);
    expect(proposal.supports).toHaveLength(1);
    expect(proposal.supports[0]).toMatchObject({
      type: "dummy-leg",
      stationIn: 60,
      transitionIndex: 1,
    });
    // The preview did not touch the design.
    expect(design.pipes.find((p) => p.id === "p1").supports).toHaveLength(1);
    const applied = applySupportProposal(design, "p1", proposal);
    const appliedRun = applied.pipes.find((p) => p.id === "p1");
    expect(appliedRun.supports).toHaveLength(2);
    expect(validateTransitionSupports(applied, appliedRun).state).toBe("PASS");
    // A proposal with a ghost-rack carrier refuses whole: nothing applies.
    expect(() =>
      applySupportProposal(design, "p1", {
        supports: [
          { id: "x1", type: "stanchion", stationIn: 60, carrier: { kind: "foundation" } },
          { id: "x2", type: "stanchion", stationIn: 100, carrier: { kind: "rack-bent", rackId: "ghost" } },
        ],
      }),
    ).toThrow(/no verified carrier/);
    expect(design.pipes.find((p) => p.id === "p1").supports).toHaveLength(1);
    // A proposal whose ids collide is remapped, never duplicated.
    const again = applySupportProposal(applied, "p1", proposal);
    expect(again.pipes.find((p) => p.id === "p1").supports).toHaveLength(3);
    const ids = again.pipes.find((p) => p.id === "p1").supports.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("collision remapping loops until the fresh id is free, even right after a generator reset", () => {
    // The verdict's counterexample: after resetSupportIds, the first
    // generated id is support-1 — which already exists on this run.
    // A single generation would hand back the duplicate.
    const { design } = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "support-1")],
    });
    resetSupportIds();
    const applied = applySupportProposal(design, "p1", {
      supports: [{ id: "support-1", type: "stanchion", stationIn: 100, carrier: { kind: "foundation" } }],
      nozzleSupports: { start: { supportId: "support-1" } },
    });
    const appliedRun = applied.pipes.find((p) => p.id === "p1");
    const ids = appliedRun.supports.map((s) => s.id);
    expect(ids).toEqual(["support-1", "support-2"]);
    expect(new Set(ids).size).toBe(ids.length);
    // The nozzle schedule follows the fresh id, not the collided one.
    expect(appliedRun.nozzleSupports.start.supportId).toBe("support-2");
    // Two colliding proposals in one batch also land unique: the
    // second generation must skip both the existing id and the id
    // already prepared in this proposal.
    const { design: design2 } = flat([{ x: 0, y: 0 }, { x: 200, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "support-1")],
    });
    resetSupportIds();
    const applied2 = applySupportProposal(design2, "p1", {
      supports: [
        { id: "support-1", type: "stanchion", stationIn: 60, carrier: { kind: "foundation" } },
        { id: "support-1", type: "stanchion", stationIn: 140, carrier: { kind: "foundation" } },
      ],
    });
    const ids2 = applied2.pipes.find((p) => p.id === "p1").supports.map((s) => s.id);
    expect(ids2).toEqual(["support-1", "support-2", "support-3"]);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  it("preview subdivides overlong spans and names the last support before an attached nozzle", () => {
    let design = withPump(createEmptyDesign("Plan"));
    const face = suctionFace(design);
    design = addPipeRun(
      design,
      [
        { x: face.x, y: face.y },
        { x: face.x, y: face.y - 300 },
      ],
      {
        id: "p1",
        diameterIn: face.sizeIn,
        elevationIn: face.elevationIn,
        spanProfile: water(face.sizeIn),
      },
    );
    design = detectRunAttachments(design, "p1");
    const run = design.pipes.find((p) => p.id === "p1");
    const { proposal } = previewSupportProposal(design, run);
    // 4-in max is 168 in: one 300-in span subdivides into two <=168
    // intervals with a stanchion at 150.
    expect(proposal.supports).toHaveLength(1);
    expect(proposal.supports[0]).toMatchObject({ type: "stanchion", stationIn: 150 });
    expect(proposal.nozzleSupports.start.supportId).toBe(proposal.supports[0].id);
    const applied = applySupportProposal(design, "p1", proposal);
    const appliedRun = applied.pipes.find((p) => p.id === "p1");
    expect(validateSupportSpans(applied, appliedRun).state).toBe("PASS");
    expect(validateNozzleSupports(applied, appliedRun).state).toBe("PASS");
  });

  it("preview without an eligible profile proposes nothing", () => {
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      supports: [sup(0, "s1")],
    });
    const { proposal, findings } = previewSupportProposal(design, run);
    expect(proposal).toBeNull();
    expect(codes(findings)).toEqual(["SPAN_PROFILE_UNVERIFIABLE"]);
  });

  it("revalidateSupportsAfterEdit catches a size change that breaks spans, and a support delete", () => {
    const { design } = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 24,
      spanProfile: water(24),
      supports: [sup(0, "s1"), sup(300, "s2")],
      routeIntervals: [],
      structureClearance: { applies: false },
    });
    const before = revalidateSupportsAfterEdit(design, "p1");
    expect(before.run.checks.spans).toBe("PASS");
    // Shrink the line to 2 in: the 300-in span now exceeds 120 in.
    const shrunk = setPipeFields(design, "p1", { diameterIn: 2 });
    const after = revalidateSupportsAfterEdit(
      setPipeSupportData(shrunk, "p1", { spanProfile: water(2) }),
      "p1",
    );
    expect(after.run.checks.spans).toBe("SPAN_EXCEEDS_MAX");
    expect(after.run.allClear).toBe(false);
    // Deleting mid supports breaks spans the same way.
    const fine = flat([{ x: 0, y: 0 }, { x: 300, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(100, "s2"), sup(200, "s3"), sup(300, "s4")],
      structureClearance: { applies: false },
    });
    expect(revalidateSupportsAfterEdit(fine.design, "p1").run.checks.spans).toBe("PASS");
    const broken = deletePipeSupport(deletePipeSupport(fine.design, "p1", "s2"), "p1", "s3");
    expect(revalidateSupportsAfterEdit(broken, "p1").run.checks.spans).toBe("SPAN_EXCEEDS_MAX");
    expect(() => revalidateSupportsAfterEdit(design, "ghost")).toThrow(/Unknown pipe run/);
  });
});

describe("aggregate: supportCheckStates and pipeSupportRuleErrors", () => {
  /** One fully compliant rack-travel run: every check PASS or NOT_APPLICABLE. */
  const compliant = () => {
    let design = withRack(createEmptyDesign("Plan"));
    design = setRackReserve(design, "r1", { spareWidthIn: 60 });
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 200, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      ...spacing(),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 0 },
      ],
      supports: [
        { id: "s1", type: "bent", stationIn: 60, carrier: rackCarrier("r1", 1) },
        { id: "s2", type: "bent", stationIn: 150, carrier: rackCarrier("r1", 1) },
        { id: "s3", type: "bent", stationIn: 240, carrier: rackCarrier("r1", 1) },
      ],
      restraints: [{ id: "g1", type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
      structureClearance: { applies: false },
    });
    return { design, run: design.pipes.find((p) => p.id === "p1") };
  };

  it("a compliant run is all-clear; a run with no D10-02 data is not", () => {
    const { design, run } = compliant();
    const states = supportCheckStates(design, run);
    expect(states.checks).toEqual({
      classification: "PASS",
      spans: "PASS",
      transitions: "NOT_APPLICABLE",
      nozzle: "NOT_APPLICABLE",
      ground: "NOT_APPLICABLE",
      structure: "NOT_APPLICABLE",
    });
    expect(states.allClear).toBe(true);
    expect(states.findings).toEqual([]);
    expect(pipeSupportRuleErrors(design)).toEqual([]);
    const bare = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", { diameterIn: 2 });
    const bareStates = supportCheckStates(bare.design, bare.run);
    expect(bareStates.allClear).toBe(false);
    expect(bareStates.checks.classification).toBe("ROUTE_CLASSIFICATION_UNVERIFIED");
    expect(bareStates.checks.spans).toBe("SPAN_PROFILE_UNVERIFIABLE");
    expect(pipeSupportRuleErrors(bare.design).length).toBeGreaterThan(0);
  });

  it("the design roll-up includes pair spacing and rack organization findings", () => {
    const { design } = compliant();
    let two = addPipeRun(design, [{ x: -100, y: 5 }, { x: 200, y: 5 }], {
      id: "p2",
      diameterIn: 2,
      elevationIn: 180,
      spanProfile: water(2),
      ...spacing(),
      routeIntervals: [
        { fromStationIn: 0, toStationIn: 300, role: "RACK_TRAVEL", rackId: "r1", tier: 1, rackOffsetIn: 5 },
      ],
      supports: [
        { id: "s1", type: "bent", stationIn: 60, carrier: rackCarrier("r1", 1) },
        { id: "s2", type: "bent", stationIn: 150, carrier: rackCarrier("r1", 1) },
        { id: "s3", type: "bent", stationIn: 240, carrier: rackCarrier("r1", 1) },
      ],
      restraints: [{ id: "g1", type: "guide", stationIn: 150, carrier: rackCarrier("r1", 1) }],
      structureClearance: { applies: false },
    });
    const errors = pipeSupportRuleErrors(two);
    expect(errors.some((e) => e.startsWith("SPACING_TOO_CLOSE"))).toBe(true);
    expect(errors.some((e) => e.startsWith("RACK_TIER_OVERFLOW"))).toBe(true);
    // The same pair unmodeled for spacing stays out of the roll-up.
    two = {
      ...two,
      pipes: two.pipes.map((p) => {
        const next = { ...p };
        delete next.outsideDiameterIn;
        return next;
      }),
    };
    expect(pipeSupportRuleErrors(two).some((e) => e.startsWith("SPACING_"))).toBe(false);
  });

  it("addPipeRun admits D10-02 metadata deep-detached", () => {
    const profile = water(2);
    const { design, run } = flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", {
      diameterIn: 2,
      spanProfile: profile,
      supports: [sup(0, "s1")],
    });
    expect(run.spanProfile).toEqual(water(2));
    profile.nominalSizeIn = 24;
    expect(run.spanProfile.nominalSizeIn).toBe(2);
    expect(() => flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", { spacingProfile: "huge" })).toThrow(
      /spacing profile/,
    );
    expect(() =>
      flat([{ x: 0, y: 0 }, { x: 100, y: 0 }], "p1", { outsideDiameterIn: "wide" }),
    ).toThrow(/outside diameter/);
  });
});

describe("reducer: D10-02 actions are one undoable transaction each", () => {
  const start = () => {
    let design = createEmptyDesign("Plan");
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
      id: "p1",
      diameterIn: 2,
      elevationIn: 30,
      spanProfile: water(2),
      supports: [sup(0, "s1"), sup(200, "s2")],
    });
    return createInitialState(design);
  };

  it("ADD / UPDATE / DELETE pipe support, SET_PIPE_SUPPORT_DATA, APPLY_SUPPORT_PROPOSAL, SET_RACK_RESERVE", () => {
    let s = designerReducer(start(), {
      type: "ADD_PIPE_SUPPORT",
      pipeId: "p1",
      support: { id: "s3", type: "stanchion", stationIn: 100, carrier: { kind: "foundation" } },
    });
    expect(s.design.pipes[0].supports).toHaveLength(3);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.pipes[0].supports).toHaveLength(2);
    s = designerReducer(start(), {
      type: "UPDATE_PIPE_SUPPORT",
      pipeId: "p1",
      supportId: "s1",
      patch: { stationIn: 10 },
    });
    expect(s.design.pipes[0].supports[0].stationIn).toBe(10);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.pipes[0].supports[0].stationIn).toBe(0);
    s = designerReducer(start(), { type: "DELETE_PIPE_SUPPORT", pipeId: "p1", supportId: "s1" });
    expect(s.design.pipes[0].supports).toHaveLength(1);
    s = designerReducer(s, { type: "UNDO" });
    expect(s.design.pipes[0].supports).toHaveLength(2);
    s = designerReducer(start(), {
      type: "SET_PIPE_SUPPORT_DATA",
      pipeId: "p1",
      fields: { spacingProfile: "largest-line" },
    });
    expect(s.design.pipes[0].spacingProfile).toBe("largest-line");
    s = designerReducer(start(), {
      type: "APPLY_SUPPORT_PROPOSAL",
      pipeId: "p1",
      proposal: {
        supports: [{ id: "px", type: "stanchion", stationIn: 100, carrier: { kind: "foundation" } }],
      },
    });
    expect(s.design.pipes[0].supports).toHaveLength(3);
    // Bad actions soft-fail: the state object is unchanged.
    const before = start();
    expect(designerReducer(before, { type: "ADD_PIPE_SUPPORT", pipeId: "ghost", support: sup(50, "x") })).toBe(before);
    expect(
      designerReducer(before, { type: "ADD_PIPE_SUPPORT", pipeId: "p1", support: { type: "stanchion" } }),
    ).toBe(before);
    expect(
      designerReducer(before, { type: "SET_PIPE_SUPPORT_DATA", pipeId: "p1", fields: { spacingProfile: "huge" } }),
    ).toBe(before);
    let rackState = createInitialState(withRack(createEmptyDesign("Plan")));
    rackState = designerReducer(rackState, {
      type: "SET_RACK_RESERVE",
      rackId: "r1",
      reserve: { spareWidthIn: 60 },
    });
    expect(rackState.design.symbols[0].rack.reserve).toEqual({ spareWidthIn: 60 });
    rackState = designerReducer(rackState, { type: "UNDO" });
    expect(rackState.design.symbols[0].rack).toBeUndefined();
  });
});
