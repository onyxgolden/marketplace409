// D10-04 (R4/O5): scheduled horizontal-vessel end-head nozzles.
//
// Fixture geometry (horizontal-drum: 120 wide x 42 deep x 54 high,
// base 0, rotation 0, at the origin):
//   radius 21, saddle 12, centerline 33, shell length 99,
//   tangent lines at ±49.5.
//   liquid-out (west end, 6 in, flange OD 11): top at 44 in
//     (radial 11 + flange radius 5.5 = 16.5 <= 21), projection 6
//     -> face at (-55.5, 0), neck base at (-49.5, 0).
//   vapor-out (east end, 8 in, flange OD 13.5): bottom at 22 in
//     (radial 11 + flange radius 6.75 = 17.75 <= 21), projection 6
//     -> face at (55.5, 0), neck base at (49.5, 0).

import { describe, it, expect } from "vitest";
import {
  HEAD_NOZZLE_SCHEDULE_VERSION,
  HEAD_NOZZLE_VESSEL_SYMBOL_IDS,
  endNozzleSide,
  endNozzleSpecs,
  headGeometry,
  headNozzleFace,
  headNozzleScheduleProblems,
  isScheduledHeadVessel,
  isUnscheduledHeadNozzle,
  vesselHeadNozzleErrors,
} from "./vesselHeadNozzles";
import {
  addPipeRun,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  previewHeadNozzleUpgrade,
  resetDesignerIds,
  setHeadNozzleSchedule,
  upgradeHeadNozzleSchedules,
  validateDesign,
} from "./designerDocument";
import {
  anchorAtPoint,
  anchorsOf,
  connectionCompatibilityErrors,
  connectionFaceForAnchor,
  detectRunAttachments,
} from "./pipeAttachments";
import { nozzleFlangeDescriptors } from "./designerThreeModel";
import { findSymbol } from "./symbolRegistry";

const DRUM = "horizontal-drum";

const LIQUID_TOP = Object.freeze({
  id: "liquid-out",
  sizeIn: 6,
  rating: { status: "unknown" },
  surface: "head-west",
  position: "top",
  orientationDeg: 180,
  elevationIn: 44,
  projectionIn: 6,
});

const VAPOR_BOTTOM = Object.freeze({
  id: "vapor-out",
  sizeIn: 8,
  rating: { status: "rated", value: "150" },
  surface: "head-east",
  position: "bottom",
  orientationDeg: 0,
  elevationIn: 22,
  projectionIn: 6,
});

function drumDesign({ schedule = null, patch = {}, entries = null, version = HEAD_NOZZLE_SCHEDULE_VERSION } = {}) {
  resetDesignerIds();
  let design = createEmptyDesign("head test");
  // Current by default (a new project/level design, which carries the
  // marker); pass version: null for a pre-schedule document, whose
  // vessels placeSymbol stamps legacy.
  if (version !== null && version !== undefined) {
    design = { ...design, headNozzleScheduleVersion: version };
  }
  design = placeSymbol(design, "processEquipment", DRUM, 0, 0, { id: "v1", tag: "V-101" });
  const useSchedule = entries !== null ? entries : schedule;
  const instPatch = { ...patch };
  if (useSchedule !== null) instPatch.headNozzleSchedule = useSchedule;
  design = {
    ...design,
    symbols: design.symbols.map((s) => (s.id === "v1" ? { ...s, ...instPatch } : s)),
  };
  return design;
}

function drumInstance(design) {
  return design.symbols.find((s) => s.id === "v1");
}

function drumSymbol() {
  return findSymbol("processEquipment", DRUM);
}

describe("D10-04 applicability", () => {
  it("selects exactly the four reviewed horizontal-vessel entries", () => {
    expect([...HEAD_NOZZLE_VESSEL_SYMBOL_IDS].sort()).toEqual([
      "horizontal-drum",
      "lpg-bullet",
      "reflux-accumulator",
      "three-phase-separator",
    ]);
    for (const id of ["horizontal-drum", "three-phase-separator", "reflux-accumulator", "lpg-bullet"]) {
      expect(isScheduledHeadVessel(findSymbol("processEquipment", id))).toBe(true);
    }
  });

  it("does not select every hcyl primitive: pumps, drivers, exchangers, TEMA excluded", () => {
    for (const id of [
      "screw-pump",
      "progressive-cavity-pump",
      "axial-compressor",
      "steam-ejector",
      "firetube-boiler",
      "shell-tube-exchanger",
      "kettle-reboiler",
      "surface-condenser",
      "coalescer",
      "desalter",
      "deaerator",
      "tema-exchanger",
      "column",
      "vertical-vessel",
    ]) {
      expect(isScheduledHeadVessel(findSymbol("processEquipment", id))).toBe(false);
    }
  });

  it("detects end-head nozzles only on the vertical center plane at an end", () => {
    expect(endNozzleSide({ fx: -1, fy: 0 })).toBe("west");
    expect(endNozzleSide({ fx: 1, fy: 0 })).toBe("east");
    expect(endNozzleSide({ fx: -1, fy: -0.5 })).toBe(null); // wet-gas-out: end plane, off center plane
    expect(endNozzleSide({ fx: 0, fy: -1 })).toBe(null);
    expect(endNozzleSide({ fx: 0.5, fy: 0 })).toBe(null);
    expect(endNozzleSide(null)).toBe(null);
  });

  it("lists the drum's two end nozzles and no shell nozzle as end nozzles", () => {
    const design = drumDesign();
    expect(endNozzleSpecs(drumSymbol(), drumInstance(design)).map((s) => s.id)).toEqual([
      "liquid-out",
      "vapor-out",
    ]);
  });
});

describe("D10-04 modeled head geometry", () => {
  it("derives radius, saddle, centerline and shell length from the modeled dimensions", () => {
    const geo = headGeometry(drumSymbol(), drumInstance(drumDesign()));
    expect(geo.radiusIn).toBe(21);
    expect(geo.saddleIn).toBe(12);
    expect(geo.centerlineIn).toBe(33);
    expect(geo.shellLengthIn).toBe(99);
  });

  it("follows instance overrides for width, depth, height and base elevation", () => {
    const design = drumDesign({ patch: { widthIn: 240, depthIn: 60, heightIn: 72, baseElevationIn: 10 } });
    const geo = headGeometry(drumSymbol(), drumInstance(design));
    expect(geo.radiusIn).toBe(30);
    expect(geo.saddleIn).toBe(12);
    expect(geo.centerlineIn).toBe(52);
    expect(geo.shellLengthIn).toBe(210);
  });
});

describe("D10-04 scheduled faces (positive)", () => {
  it("resolves a scheduled top head nozzle: tangent line + projection, scheduled elevation, axial normal", () => {
    const design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    const inst = drumInstance(design);
    const face = headNozzleFace(drumSymbol(), inst, "liquid-out");
    expect(face).toMatchObject({
      anchorId: "liquid-out",
      x: -55.5,
      y: 0,
      elevationIn: 44,
      normal: { x: -1, y: 0 },
      vertical: false,
      sizeIn: 6,
      kind: "head",
    });
    expect(face.neckBase).toMatchObject({ x: -49.5, y: 0, elevationIn: 44 });
  });

  it("resolves a scheduled bottom head nozzle on the opposite head", () => {
    const design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    const face = headNozzleFace(drumSymbol(), drumInstance(design), "vapor-out");
    expect(face).toMatchObject({
      anchorId: "vapor-out",
      x: 55.5,
      y: 0,
      elevationIn: 22,
      normal: { x: 1, y: 0 },
      vertical: false,
      sizeIn: 8,
      kind: "head",
    });
    expect(face.neckBase).toMatchObject({ x: 49.5, y: 0, elevationIn: 22 });
  });

  it("is the same face every consumer reads: connectionFaceForAnchor, anchors, 3D flanges", () => {
    const design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    const inst = drumInstance(design);
    const symbol = drumSymbol();
    const viaFace = connectionFaceForAnchor(symbol, inst, "liquid-out");
    expect(viaFace).toMatchObject({ kind: "head", x: -55.5, y: 0, elevationIn: 44 });
    const anchor = anchorsOf(inst).find((a) => a.id === "liquid-out");
    expect(anchor).toMatchObject({
      x: -55.5,
      y: 0,
      elevationIn: 44,
      headPosition: "top",
      surface: "head-west",
      kind: "head",
    });
    const flange = nozzleFlangeDescriptors(design, "v1").find((f) => f.anchorId === "liquid-out");
    expect(flange).toMatchObject({ kind: "head", x: -55.5, yIn: 44 });
    expect(flange.neckBase).toMatchObject({ x: -49.5, y: 0, elevationIn: 44 });
  });

  it("moves the face with the projection: tangent line + projection, nothing else", () => {
    const design = drumDesign({
      entries: [{ ...LIQUID_TOP, projectionIn: 12 }],
    });
    const face = headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out");
    expect(face.x).toBe(-61.5);
    expect(face.neckBase.x).toBe(-49.5);
    expect(face.elevationIn).toBe(44);
  });

  it("rotates the face and its normal with the instance", () => {
    const design = drumDesign({
      entries: [LIQUID_TOP, VAPOR_BOTTOM],
      patch: { rotationDeg: 90, x: 100, y: 200 },
    });
    const face = headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out");
    // Local (-55.5, 0) rotated 90° -> (0, -55.5); normal (-1, 0) -> (0, -1).
    expect(face.x).toBeCloseTo(100, 9);
    expect(face.y).toBeCloseTo(144.5, 9);
    expect(face.normal.x).toBeCloseTo(0, 9);
    expect(face.normal.y).toBeCloseTo(-1, 9);
  });

  it("follows a resize: shell length and centerline recompute, face follows the new tangent line", () => {
    const design = drumDesign({
      entries: [LIQUID_TOP, VAPOR_BOTTOM],
      patch: { widthIn: 240 },
    });
    const face = headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out");
    // shellL 219 -> tangent ±109.5 -> face at -(109.5 + 6).
    expect(face.x).toBe(-115.5);
    expect(face.neckBase.x).toBe(-109.5);
  });

  it("follows the base datum: raising the base moves the centerline, and a top entry can go invalid", () => {
    const raised = drumDesign({ entries: [LIQUID_TOP], patch: { baseElevationIn: 10 } });
    // centerline 43; elevation 44 still above it.
    expect(headNozzleFace(drumSymbol(), drumInstance(raised), "liquid-out")).not.toBe(null);
    const tooHigh = drumDesign({ entries: [LIQUID_TOP], patch: { baseElevationIn: 20 } });
    // centerline 53; elevation 44 is no longer above it.
    expect(headNozzleFace(drumSymbol(), drumInstance(tooHigh), "liquid-out")).toBe(null);
    expect(validateDesign(tooHigh).join("\n")).toMatch(/not above the vessel centerline 53 in/);
  });

  it("accepts a rated value and preserves an unknown rating", () => {
    const design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(design))).toEqual([]);
    // Targeted: the drum is a utility vessel, so full validateDesign
    // also carries its (unconnected) utility findings — those belong
    // to the utility system, not the head schedule.
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });
});

describe("D10-04 lateral end negative", () => {
  it("refuses a side position on an end head", () => {
    const design = drumDesign({ entries: [{ ...LIQUID_TOP, position: "side" }] });
    const problems = headNozzleScheduleProblems(drumSymbol(), drumInstance(design));
    expect(problems.join("\n")).toMatch(/never the sides/);
    expect(headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out")).toBe(null);
    expect(validateDesign(design).join("\n")).toMatch(/NOZZLE_SCHEDULE_UNRESOLVED/);
  });

  it("refuses a non-axial orientation for a head nozzle", () => {
    const design = drumDesign({ entries: [{ ...LIQUID_TOP, orientationDeg: 90 }] });
    const problems = headNozzleScheduleProblems(drumSymbol(), drumInstance(design));
    expect(problems.join("\n")).toMatch(/does not match the head-west head/);
    expect(headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out")).toBe(null);
  });

  it("refuses a surface that does not match the nozzle's end", () => {
    const design = drumDesign({ entries: [{ ...LIQUID_TOP, surface: "head-east" }] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(design)).join("\n")).toMatch(
      /sits on the west head but the schedule names head-east/,
    );
    expect(headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out")).toBe(null);
  });
});

describe("D10-04 schedule missing / invalid", () => {
  it("reports NOZZLE_SCHEDULE_UNRESOLVED per end nozzle when no schedule exists", () => {
    const design = drumDesign();
    const errors = vesselHeadNozzleErrors(design);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/nozzle liquid-out has no scheduled head position \(NOZZLE_SCHEDULE_UNRESOLVED\)/);
    expect(errors[1]).toMatch(/nozzle vapor-out has no scheduled head position \(NOZZLE_SCHEDULE_UNRESOLVED\)/);
    expect(headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out")).toBe(null);
    expect(isUnscheduledHeadNozzle(drumSymbol(), drumInstance(design), "liquid-out")).toBe(true);
  });

  it("reports only the uncovered nozzle when the schedule covers the other", () => {
    const design = drumDesign({ entries: [LIQUID_TOP] });
    const errors = vesselHeadNozzleErrors(design);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/nozzle vapor-out has no scheduled head position/);
  });

  it("flags each invalid field, and a valid schedule passes clean", () => {
    const cases = [
      [{ ...LIQUID_TOP, sizeIn: 8 }, /does not match the catalog nozzle \(6 in\)/],
      [{ ...LIQUID_TOP, sizeIn: 0 }, /size is missing or not a positive number/],
      [{ ...LIQUID_TOP, rating: undefined }, /rating is missing/],
      [{ ...LIQUID_TOP, rating: { status: "unknown", value: "150" } }, /must not carry a value/],
      [{ ...LIQUID_TOP, rating: { status: "rated" } }, /needs a rating value/],
      [{ ...LIQUID_TOP, rating: { status: "maybe" } }, /rating status "maybe" is unknown/],
      [{ ...LIQUID_TOP, surface: "shell" }, /is not a head surface/],
      [{ ...LIQUID_TOP, elevationIn: 33 }, /not above the vessel centerline 33 in/],
      [{ ...LIQUID_TOP, elevationIn: 20 }, /not above the vessel centerline 33 in/],
      [{ ...LIQUID_TOP, elevationIn: undefined }, /elevation is missing/],
      [{ ...LIQUID_TOP, projectionIn: 0 }, /must be positive/],
      [{ ...LIQUID_TOP, projectionIn: -2 }, /must be positive/],
      [{ ...LIQUID_TOP, projectionIn: undefined }, /projection is missing/],
      [{ ...LIQUID_TOP, unit: "mm" }, /unit "mm" is not supported/],
      [{ ...LIQUID_TOP, datum: "grade" }, /datum "grade" is not supported/],
      [{ id: "inlet", sizeIn: 10, rating: { status: "unknown" }, surface: "head-west", position: "top", orientationDeg: 180, elevationIn: 44, projectionIn: 6 }, /is not an end-head nozzle/],
      [{ id: "no-such-nozzle", sizeIn: 6, rating: { status: "unknown" }, surface: "head-west", position: "top", orientationDeg: 180, elevationIn: 44, projectionIn: 6 }, /is not a nozzle on this vessel/],
    ];
    for (const [entry, pattern] of cases) {
      const design = drumDesign({ entries: [entry] });
      const problems = headNozzleScheduleProblems(drumSymbol(), drumInstance(design));
      expect(problems.join("\n")).toMatch(pattern);
      expect(headNozzleFace(drumSymbol(), drumInstance(design), entry.id)).toBe(null);
    }
    // Bottom entries fail the mirrored way.
    const bottomBad = drumDesign({ entries: [{ ...VAPOR_BOTTOM, elevationIn: 33 }] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(bottomBad)).join("\n")).toMatch(
      /not below the vessel centerline 33 in/,
    );
  });

  it("enforces envelope fit: the flange must fit on the head face", () => {
    // 6-in flange radius 5.5; head radius 21 -> radial offset at most 15.5.
    const flush = drumDesign({ entries: [{ ...LIQUID_TOP, elevationIn: 48.5 }] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(flush))).toEqual([]);
    const over = drumDesign({ entries: [{ ...LIQUID_TOP, elevationIn: 48.6 }] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(over)).join("\n")).toMatch(
      /does not fit on the head face/,
    );
    expect(headNozzleFace(drumSymbol(), drumInstance(over), "liquid-out")).toBe(null);
  });

  it("flags duplicate schedule entries and a non-array schedule", () => {
    const dup = drumDesign({ entries: [LIQUID_TOP, { ...LIQUID_TOP, elevationIn: 40 }] });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(dup)).join("\n")).toMatch(
      /is scheduled twice/,
    );
    const notArray = drumDesign({ patch: { headNozzleSchedule: { id: "liquid-out" } } });
    expect(headNozzleScheduleProblems(drumSymbol(), drumInstance(notArray)).join("\n")).toMatch(
      /not an array/,
    );
    expect(vesselHeadNozzleErrors(notArray).join("\n")).toMatch(/not an array/);
  });

  it("refuses a schedule on a non-applicable vessel and on an unknown instance", () => {
    const design = drumDesign();
    expect(() => setHeadNozzleSchedule(design, "nope", [LIQUID_TOP])).toThrow(/Unknown symbol instance/);
    let column = createEmptyDesign("col");
    column = placeSymbol(column, "processEquipment", "column", 0, 0, { id: "c1", tag: "T-101" });
    expect(() => setHeadNozzleSchedule(column, "c1", [LIQUID_TOP])).toThrow(/not a scheduled-head vessel/);
    expect(() => setHeadNozzleSchedule(design, "v1", { id: "liquid-out" })).toThrow(/must be an array/);
  });
});

describe("D10-04 shell nozzles stay independent", () => {
  it("a shell nozzle resolves and connects clean with no head schedule at all", () => {
    let design = drumDesign();
    const inst = drumInstance(design);
    const face = connectionFaceForAnchor(drumSymbol(), inst, "inlet");
    expect(face).toMatchObject({ kind: "side", normal: { x: 0, y: -1 } });
    expect(face.elevationIn).toBeCloseTo(33.48, 9);
    // Attach a 10-in run to the shell inlet at the face elevation.
    design = addPipeRun(
      design,
      [{ x: 0, y: -21 }, { x: 0, y: -200 }],
      { id: "p1", diameterIn: 10, elevationIn: 33.48 },
    );
    design = detectRunAttachments(design, "p1");
    // The shell connection itself verifies; only the two end-nozzle
    // schedule findings name this vessel (utility findings aside).
    expect(connectionCompatibilityErrors(design)).toEqual([]);
    const errors = vesselHeadNozzleErrors(design);
    expect(errors).toHaveLength(2);
    expect(errors.join("\n")).toMatch(/NOZZLE_SCHEDULE_UNRESOLVED/);
    expect(errors.join("\n")).not.toMatch(/inlet/);
  });

  it("a run attached to an unscheduled end nozzle names the missing schedule, not a stale reference", () => {
    let design = drumDesign();
    design = addPipeRun(
      design,
      [{ x: -60, y: 0 }, { x: -200, y: 0 }],
      { id: "p1", diameterIn: 6 },
    );
    design = detectRunAttachments(design, "p1");
    const errors = validateDesign(design);
    expect(errors.join("\n")).toMatch(
      /claims nozzle liquid-out on V-101, which has no scheduled head position \(NOZZLE_SCHEDULE_UNRESOLVED\)/,
    );
    expect(errors.join("\n")).not.toMatch(/stale reference/);
  });

  it("a run attached to a scheduled end nozzle verifies at the scheduled face", () => {
    let design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    design = addPipeRun(
      design,
      [{ x: -55.5, y: 0 }, { x: -200, y: 0 }],
      { id: "p1", diameterIn: 6, elevationIn: 44 },
    );
    design = detectRunAttachments(design, "p1");
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });
});

describe("D10-04 overlapping plan selection", () => {
  it("tells coincident upper/lower ports apart by elevation, never first-wins", () => {
    const customNozzles = [
      { id: "liquid-out", fx: -1, fy: 0, sizeIn: 6 },
      { id: "drain-out", fx: -1, fy: 0, sizeIn: 4 },
      { id: "inlet", fx: 0, fy: -1, sizeIn: 10 },
      { id: "vapor-out", fx: 1, fy: 0, sizeIn: 8 },
    ];
    const drainBottom = {
      id: "drain-out",
      sizeIn: 4,
      rating: { status: "unknown" },
      surface: "head-west",
      position: "bottom",
      orientationDeg: 180,
      elevationIn: 22,
      projectionIn: 6,
    };
    const design = drumDesign({
      entries: [LIQUID_TOP, drainBottom, VAPOR_BOTTOM],
      patch: { nozzles: customNozzles },
    });
    // Both west ports share the plan point (-55.5, 0); only elevation differs.
    const topAnchor = anchorsOf(drumInstance(design)).find((a) => a.id === "liquid-out");
    const bottomAnchor = anchorsOf(drumInstance(design)).find((a) => a.id === "drain-out");
    expect(topAnchor.x).toBe(bottomAnchor.x);
    expect(topAnchor.y).toBe(bottomAnchor.y);
    expect(topAnchor.elevationIn).toBe(44);
    expect(bottomAnchor.elevationIn).toBe(22);
    expect(anchorAtPoint(design, { x: -55.5, y: 0 }, 44)).toMatchObject({ anchorId: "liquid-out" });
    expect(anchorAtPoint(design, { x: -55.5, y: 0 }, 22)).toMatchObject({ anchorId: "drain-out" });
    // No hint: deterministic lowest-elevation pick, not first-wins.
    expect(anchorAtPoint(design, { x: -55.5, y: 0 })).toMatchObject({ anchorId: "drain-out" });
  });
});

describe("D10-04 legacy versioning and upgrade", () => {
  it("placeSymbol copies the design's schedule version onto the vessel; unversioned designs place legacy vessels", () => {
    expect(drumInstance(drumDesign({ version: null })).headNozzleScheduleVersion).toBeUndefined();
    expect(drumInstance(drumDesign()).headNozzleScheduleVersion).toBe(HEAD_NOZZLE_SCHEDULE_VERSION);
  });

  it("a legacy instance resolves its prior side faces and validates clean (unchanged legacy)", () => {
    const design = drumDesign({ version: null });
    const inst = drumInstance(design);
    expect(inst.headNozzleScheduleVersion).toBeUndefined();
    const face = connectionFaceForAnchor(drumSymbol(), inst, "liquid-out");
    expect(face).toMatchObject({ kind: "side", x: -60, y: 0, normal: { x: -1, y: 0 } });
    expect(face.elevationIn).toBeCloseTo(33.48, 9);
    const anchor = anchorsOf(inst).find((a) => a.id === "liquid-out");
    expect(anchor).toMatchObject({ x: -60, y: 0 });
    expect(anchor.elevationIn).toBeUndefined();
    // No validation finding: legacy validates exactly as before. The
    // legacy state is shown in the inspector + upgrade preview.
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
    expect(validateDesign(design).join("\n")).not.toMatch(/NOZZLE_SCHEDULE_UNRESOLVED/);
    const preview = previewHeadNozzleUpgrade(design);
    expect(preview.instances).toHaveLength(1);
    expect(preview.instances[0].endNozzles).toHaveLength(2);
    expect(preview.instances[0].endNozzles[0].priorFace.kind).toBe("side");
    expect(preview.instances[0].endNozzles[0].scheduledFace).toBe(null);
  });

  it("a legacy vessel with an authored schedule resolves the scheduled face (schedule is authoritative)", () => {
    const design = drumDesign({ version: null, entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    expect(drumInstance(design).headNozzleScheduleVersion).toBeUndefined();
    const face = headNozzleFace(drumSymbol(), drumInstance(design), "liquid-out");
    expect(face).toMatchObject({ kind: "head", x: -55.5, y: 0, elevationIn: 44 });
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
  });

  it("parseDesign leaves documents byte-identical: pre-schedule stays legacy, current stays current", () => {
    const old = drumDesign();
    delete old.headNozzleScheduleVersion;
    delete old.symbols.find((s) => s.id === "v1").headNozzleScheduleVersion;
    const loaded = parseDesign(JSON.stringify(old));
    // Loading mutates nothing: the old document round-trips exactly.
    expect(loaded).toEqual(old);
    // ...and the old vessel still resolves its prior faces, validating clean.
    expect(vesselHeadNozzleErrors(loaded)).toEqual([]);
    const face = connectionFaceForAnchor(
      drumSymbol(),
      loaded.symbols.find((s) => s.id === "v1"),
      "liquid-out",
    );
    expect(face).toMatchObject({ kind: "side", x: -60, y: 0 });
    const current = parseDesign(JSON.stringify(drumDesign()));
    expect(current.headNozzleScheduleVersion).toBe(HEAD_NOZZLE_SCHEDULE_VERSION);
    expect(current.symbols.find((s) => s.id === "v1").headNozzleScheduleVersion).toBe(
      HEAD_NOZZLE_SCHEDULE_VERSION,
    );
  });

  it("the upgrade previews affected faces and runs, then switches to scheduled faces in one transaction", () => {
    let design = drumDesign({ version: null });
    design = addPipeRun(
      design,
      [{ x: -60, y: 0 }, { x: -200, y: 0 }],
      { id: "p1", diameterIn: 6 },
    );
    design = detectRunAttachments(design, "p1");
    const preview = previewHeadNozzleUpgrade(design);
    expect(preview.instances).toHaveLength(1);
    expect(preview.instances[0].tag).toBe("V-101");
    expect(preview.instances[0].endNozzles).toHaveLength(2);
    expect(preview.instances[0].endNozzles[0].priorFace.kind).toBe("side");
    expect(preview.instances[0].endNozzles[0].scheduledFace).toBe(null);
    expect(preview.instances[0].attachedRunIds).toEqual(["p1"]);
    const upgraded = upgradeHeadNozzleSchedules(design);
    expect(upgraded.symbols.find((s) => s.id === "v1").headNozzleScheduleVersion).toBe(
      HEAD_NOZZLE_SCHEDULE_VERSION,
    );
    expect(upgraded.headNozzleScheduleVersion).toBe(HEAD_NOZZLE_SCHEDULE_VERSION);
    // The attached end keeps its position and its link (the anchor
    // still resolves in plan) — but the face is now null, so the
    // connection cannot verify until a schedule is authored.
    const run = upgraded.pipes.find((p) => p.id === "p1");
    expect(run.points[0]).toEqual({ x: -60, y: 0 });
    expect(run.attachments.start).toMatchObject({ symbolId: "v1", anchorId: "liquid-out" });
    expect(vesselHeadNozzleErrors(upgraded).join("\n")).toMatch(/has no scheduled head position/);
    expect(validateDesign(upgraded).join("\n")).toMatch(
      /claims nozzle liquid-out on V-101, which has no scheduled head position \(NOZZLE_SCHEDULE_UNRESOLVED\)/,
    );
    // Nothing to upgrade: same design object back.
    expect(upgradeHeadNozzleSchedules(upgraded)).toBe(upgraded);
  });

  it("authoring a schedule is the per-instance upgrade: the stamp clears and ends follow the new faces", () => {
    let design = drumDesign({ version: null });
    design = addPipeRun(
      design,
      [{ x: -60, y: 0 }, { x: -200, y: 0 }],
      { id: "p1", diameterIn: 6 },
    );
    design = detectRunAttachments(design, "p1");
    design = setHeadNozzleSchedule(design, "v1", [LIQUID_TOP, VAPOR_BOTTOM]);
    expect(design.symbols.find((s) => s.id === "v1").headNozzleScheduleVersion).toBe(
      HEAD_NOZZLE_SCHEDULE_VERSION,
    );
    expect(design.headNozzleScheduleVersion).toBe(HEAD_NOZZLE_SCHEDULE_VERSION);
    const run = design.pipes.find((p) => p.id === "p1");
    expect(run.attachments.start).toMatchObject({ symbolId: "v1", anchorId: "liquid-out" });
    expect(run.points[0]).toEqual({ x: -55.5, y: 0 });
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
    expect(connectionCompatibilityErrors(design)).toEqual([]);
  });

  it("clearing a schedule returns the vessel to unscheduled, with findings", () => {
    let design = drumDesign({ entries: [LIQUID_TOP, VAPOR_BOTTOM] });
    design = setHeadNozzleSchedule(design, "v1", null);
    expect(design.symbols.find((s) => s.id === "v1").headNozzleSchedule).toBeUndefined();
    expect(vesselHeadNozzleErrors(design)).toHaveLength(2);
  });
});

describe("D10-04 TEMA stays byte-identical", () => {
  it("TEMA symbols are out of scope and their faces resolve exactly as before", () => {
    resetDesignerIds();
    let design = createEmptyDesign("tema");
    design = placeSymbol(design, "processEquipment", "tema-exchanger", 0, 0, { id: "e1", tag: "E-101" });
    const inst = design.symbols.find((s) => s.id === "e1");
    const symbol = findSymbol("processEquipment", "tema-exchanger");
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
    expect(validateDesign(design)).toEqual([]);
    const anchors = anchorsOf(inst);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const face = connectionFaceForAnchor(symbol, inst, anchor.id);
      expect(face).toMatchObject({ kind: "tema", elevationIn: null, normal: null });
    }
  });
});
