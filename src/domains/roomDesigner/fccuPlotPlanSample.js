// Fictional FCCU plot-plan sample for the FORGE designer sample gallery.
//
// An ORIGINAL, GENERIC layout exercise: a fluid catalytic cracking unit
// (FCCU) plot plan drawn from industry-standard arrangement principles
// only — reactor/regenerator pair, main fractionator, air blower, wet gas
// compressor, feed/effluent exchangers, pump rows under a pipe rack,
// control building at the plot edge, and a relief header routed to a
// remote flare. This is NOT a real facility: no real plot plan was traced
// or copied, and every tag is a generic industry code (R-101, T-101, ...).
//
// Like the Maplewood sample, this is a *seed definition*: buildFccuPlotPlan
// builds a complete, valid HomeProject envelope with the real domain
// functions (createEmptyDesign, placeSymbol, addPipeRun, ...). The document
// carries NO identity — no projectId, no owner/user fields, no timestamps.
// The UI forks it into the caller's own project via POST + PUT.
//
// Coordinates are plan inches (y grows downward, like the canvas). The
// layout below is authored in feet and converted with FT = 12.

import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
  setHeadNozzleSchedule,
} from "./designerDocument";
import { addSystem, setMemberSystem } from "./designSystems";
import {
  createHomeProject,
  renameLevel,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";
import {
  anchorsOf,
  connectionFaceForAnchor,
  detectRunAttachments,
  detectRunJunctions,
  reconcilePipeAttachments,
  reconcileRunJunctions,
} from "./pipeAttachments";
import {
  applyCrossingJogs,
  findPipeCrossings,
  physicalRouteIn,
  validatedJunctionEdge,
} from "./pipeCrossings";
import { findSymbol } from "./symbolRegistry";
import { placeReducer } from "./pipeReducerModel";
import { setDowncomerLevelProps } from "./downcomers";
import { UTILITY_HEADER_DIAMETER_IN, UTILITY_SERVICES } from "./utilityPiping";
import { FIREWATER_MAIN_DIAMETER_IN, HYDRANT_BRANCH_DIAMETER_IN } from "./firewater";
import { setRackParams } from "./rackGeometry";
import {
  barrierGeometry,
  CROSSOVER_GAP_MAX_IN,
  CROSSOVER_TAIL_MAX_IN,
  effectiveManwayPlatform,
  manwayReferencePlatform,
  previewCrossoverProposal,
  setAccessData,
} from "./pipeAccess";
import {
  maxSpanInFor,
  pointAtStation,
  pointInRackFootprint,
  rackColumnWorldPositions,
  rackFootprint,
  RISER_GUIDE_CAP_PROFILE,
  riserGuideIntervalInFor,
  routeStations,
  transitionVertices,
  verticalLegs,
} from "./pipeSupports";
import { deckCorners, gradeElevationIn, manwaySpec, manwayWorld } from "./vesselAccess";

export const FCCU_SAMPLE_SEED_ID = "fccu-plot-plan";
export const FCCU_SAMPLE_NAME = "FCCU Plot Plan (Fictional)";

const FT = 12;
const PROCESS_EQUIPMENT = "processEquipment";

let fccuSequence = 0;
function fccuId(prefix) {
  fccuSequence += 1;
  return `fccu_${prefix}_${fccuSequence}`;
}
/** Test hook: restart sample id generation so output stays deterministic. */
export function resetFccuSampleIds() {
  fccuSequence = 0;
}

// [symbolId, tag, xFt, yFt, options]
// options: { wFt, dFt, rotationDeg } — footprint overrides in feet.
const FCCU_EQUIPMENT = [
  // Reactor / regenerator pair — the heart of the unit, side by side.
  ["fluidized-bed-reactor", "R-101", 190, 170, {}],
  ["catalyst-regenerator", "R-102", 245, 170, {}],
  // Fractionation — east of the reactor, receives reactor effluent.
  ["column", "T-101", 320, 150, { wFt: 8, dFt: 8 }], // main fractionator
  ["absorber", "T-102", 362, 150, { wFt: 5, dFt: 5 }], // absorber
  // Feed/effluent heat-exchange train — row south of the fractionator.
  ["shell-tube-exchanger", "E-101", 275, 235, {}],
  ["shell-tube-exchanger", "E-102", 305, 235, {}],
  ["shell-tube-exchanger", "E-103", 335, 235, {}],
  ["shell-tube-exchanger", "E-104", 365, 235, {}],
  // Machinery area — air blower and wet gas compressor, separated from
  // the reactor by open plot for noise/vibration isolation.
  ["blower", "K-101", 150, 300, { wFt: 10, dFt: 5 }], // main air blower
  ["centrifugal-compressor", "K-102", 230, 300, { wFt: 10, dFt: 6 }], // wet gas compressor
  // Drums — reflux accumulator by the fractionator, KO drum at the
  // compressor suction.
  ["horizontal-drum", "V-101", 330, 262, { wFt: 15, dFt: 5 }], // reflux accumulator
  ["knockout-drum", "V-102", 270, 262, {}], // compressor KO drum
  // Pump row — under the pipe rack, 25 ft spacing.
  ["centrifugal-pump", "P-101", 160, 340, {}],
  ["centrifugal-pump", "P-102", 185, 340, {}],
  ["centrifugal-pump", "P-103", 210, 340, {}],
  ["centrifugal-pump", "P-104", 235, 340, {}],
  ["centrifugal-pump", "P-105", 260, 340, {}],
  ["centrifugal-pump", "P-106", 285, 340, {}],
  // Flare — remote, south-east, ~440 ft from the reactor for safe
  // separation of the ignition source from process equipment.
  ["flare-stack", "FL-101", 570, 400, {}],
];

// Labeled plan areas: [label, x1Ft, y1Ft, x2Ft, y2Ft].
const FCCU_AREAS = [
  ["Control building", 40, 40, 130, 90],
  ["Pipe rack", 120, 358, 420, 382],
  ["Flare area — restricted", 540, 370, 600, 430],
  ["Plant road", 0, 8, 640, 32],
];

// Named piping systems, created in this order: [name, color].
// Color note (firewater red reservation): red is reserved to firewater
// piping across the designer, so the Relief system was recolored from
// red (#ef4444) to dark amber (#b45309) when the Firewater system was
// added — see the before/after color map in the build report.
const FCCU_SYSTEMS = [
  ["Process feed", "#22c55e"],
  ["Reactor effluent", "#f97316"],
  ["Catalyst transfer", "#eab308"],
  ["Combustion air", "#14b8a6"],
  ["Overhead & reflux", "#3b82f6"],
  ["Wet gas", "#a855f7"],
  ["Product rundown", "#ec4899"],
  ["Cooling water", "#f59e0b"],
  ["Relief", "#b45309"],
  ["Flue gas", "#94a3b8"],
  ["Plant water", "#0891b2"],
  ["Plant air", "#65a30d"],
  ["Nitrogen", "#db2777"],
  ["Firewater", "#dc2626"],
];

const pt = (xFt, yFt) => ({ x: xFt * FT, y: yFt * FT });

function instanceByTag(design, tag) {
  const inst = (design.symbols || []).find((s) => s.tag === tag);
  if (!inst) throw new Error(`FCCU sample: no symbol tagged ${tag}.`);
  return inst;
}

/** The exact catalog anchor for a tagged instance (world inches). */
function anchorOfTag(design, tag, anchorId) {
  const inst = instanceByTag(design, tag);
  const anchor = anchorsOf(inst).find((a) => a.id === anchorId);
  if (!anchor) throw new Error(`FCCU sample: ${tag} has no anchor ${anchorId}.`);
  return anchor;
}

/** Endpoint point taken verbatim from an anchor, so attachment detection matches exactly. */
const anchorPt = (anchor) => ({ x: anchor.x, y: anchor.y });

/**
 * D10-05 — short approach into a diagonal-normal face (in). The
 * exchanger shell / cooling-water nozzles and the column downcomer
 * nozzles face diagonally by catalog definition (their (fx, fy)
 * normal is not axis-aligned), so no axis-aligned approach can sit
 * within the 20-degree approach-stub window — any long approach gets
 * a diagonal stub inserted. A straight shorter than the 12-in stub
 * threshold is left alone, so the approach is a short axis-aligned
 * leg into the face. 10 in is under the threshold with margin and
 * long enough for the corner support that doubles as the nozzle
 * support. Vertical legs go at corners, never at an attached end.
 */
const SHORT_APPROACH_IN = 10;
// D10-05: the exchanger-train legs ride 20 in off the exchanger
// faces (was the 10-in short approach). A 30-in walk spur stands
// 15.4 in off its face, so its swept envelope reaches 15 in past
// the spur line — a train leg 10 in off the face falls inside it
// (the bottoms leg at y=2795 blocked the tube-in spurs at
// y=2804.6; the cooling-water leg at y=2845 blocked the tube-out
// spurs at y=2835.4). Twenty inches clears the envelope by ~4.6 in.
const TRAIN_APPROACH_IN = 20;

/** The modeled face elevation for a tagged instance's anchor (in), or null. */
function faceElevationIn(design, tag, anchorId) {
  const inst = instanceByTag(design, tag);
  const face = connectionFaceForAnchor(findSymbol(inst.domain, inst.symbolId), inst, anchorId);
  return Number.isFinite(face?.elevationIn) ? face.elevationIn : null;
}

function placeEquipment(design) {
  let next = design;
  for (const [symbolId, tag, xFt, yFt, opts] of FCCU_EQUIPMENT) {
    const placement = { tag };
    if (opts.rotationDeg) placement.rotationDeg = opts.rotationDeg;
    if (opts.wFt) placement.widthIn = opts.wFt * FT;
    if (opts.dFt) placement.depthIn = opts.dFt * FT;
    next = placeSymbol(next, PROCESS_EQUIPMENT, symbolId, xFt * FT, yFt * FT, placement);
  }
  return next;
}

function placeRacks(design) {
  let next = placeSymbol(design, PROCESS_EQUIPMENT, "pipe-rack", 270 * FT, 370 * FT, {
    tag: "PR-101",
    widthIn: 300 * FT,
    depthIn: 24 * FT,
  });
  const rack = instanceByTag(next, "PR-101");
  next = setRackParams(next, rack.id, {
    tiers: 2,
    elevationIn: 180,
    tierSpacingIn: 72,
    bentSpacingIn: 240,
  });
  next = placeSymbol(next, PROCESS_EQUIPMENT, "sleeper-rack", 320 * FT, 245 * FT, {
    tag: "SL-101",
    widthIn: 110 * FT,
    depthIn: 10 * FT,
  });
  return next;
}

function createSystems(design, systemIds) {
  let next = design;
  for (const [name, color] of FCCU_SYSTEMS) {
    next = addSystem(next, { name, color });
    systemIds[name] = next.systems.find((s) => s.name === name).id;
  }
  return next;
}

function labelAreas(design) {
  let next = design;
  for (const [label, x1Ft, y1Ft, x2Ft, y2Ft] of FCCU_AREAS) {
    next = {
      ...next,
      rooms: [
        ...next.rooms,
        {
          id: fccuId("area"),
          label,
          polygon: [
            { x: x1Ft * FT, y: y1Ft * FT },
            { x: x2Ft * FT, y: y1Ft * FT },
            { x: x2Ft * FT, y: y2Ft * FT },
            { x: x1Ft * FT, y: y2Ft * FT },
          ],
        },
      ],
    };
  }
  return next;
}

function addAreaLabel(design, text, xFt, yFt) {
  return {
    ...design,
    annotations: [
      ...design.annotations,
      {
        id: fccuId("label"),
        kind: "label",
        points: [{ x: xFt * FT, y: yFt * FT }],
        text,
        source: FCCU_SAMPLE_SEED_ID,
      },
    ],
  };
}

function labelPlot(design) {
  let next = design;
  next = addAreaLabel(next, "FICTIONAL FCCU — GENERIC LAYOUT EXERCISE", 320, 60);
  next = addAreaLabel(next, "Reactor / regenerator", 217, 128);
  next = addAreaLabel(next, "Fractionation", 341, 108);
  next = addAreaLabel(next, "Machinery area", 190, 282);
  next = addAreaLabel(next, "Pump row", 222, 322);
  return next;
}

/**
 * Every pipe run goes through here: add the run, join its system, then
 * record nozzle attachments for any end sitting exactly on an anchor,
 * pipe-to-pipe junctions for any end landing on another run (both are
 * flanged connections), and a vertical jog wherever the new run crosses
 * an existing one — a pipe changes elevation to cross another pipe.
 */
function addRun(design, systemIds, pointsInches, { diameterIn, service, systemName, id, utility, elevationIn, elevIn, sourceOf, openEnds } = {}) {
  const runId = id || fccuId("pipe");
  let next = addPipeRun(design, pointsInches, {
    id: runId,
    diameterIn,
    material: "Carbon steel",
    service,
    layer: "piping",
    elevationIn,
    // D10-05: elevIn goes INTO addPipeRun so its elevation-aware
    // dedupe preserves vertical risers (duplicate plan points with
    // different elevations). Patching it on after the fact would
    // misalign it with any deduped point.
    elevIn,
    // D10-05: declared open ends (battery-limit / capped) — the
    // D10-02 openEnds declaration, so a run end that is open by
    // design is connected-by-declaration, not flagged.
    openEnds,
  });
  if (utility || sourceOf) {
    next = {
      ...next,
      pipes: next.pipes.map((r) =>
        r.id === runId
          ? {
              ...r,
              ...(utility ? { utility } : {}),
              ...(sourceOf ? { sourceOf } : {}),
            }
          : r,
      ),
    };
  }
  next = setMemberSystem(next, { kind: "pipe", id: runId }, systemIds[systemName]);
  next = detectRunAttachments(next, runId);
  next = reconcilePipeAttachments(next);
  next = detectRunJunctions(next, runId);
  next = reconcileRunJunctions(next);
  next = applyCrossingJogs(next, runId);
  return next;
}

function addPiping(design, systemIds) {
  let next = design;
  const run = (points, opts) => {
    next = addRun(next, systemIds, points, opts);
  };
  const anchor = (tag, anchorId) => anchorOfTag(next, tag, anchorId);

  // F1 — process feed through the exchanger tube sides along y=235 ft.
  // Each exchanger is genuinely connected: a run END lands on its tube-in /
  // tube-out nozzle (P663-001 — the train used to be one polyline crossing
  // the footprints with no attachments at E-102/103/104).
  {
    const end = anchor("E-101", "tube-in");
    // D10-05: the last leg into the tube-in face rode a slope
    // (30 in down to the face elevation). The drop is a vertical
    // leg at the (260, 235) corner instead; the approach then runs
    // flat at the face elevation along the face normal.
    const tubeElevIn = faceElevationIn(next, "E-101", "tube-in");
    run(
      [pt(124, 320), pt(260, 320), pt(260, 235), pt(260, 235), anchorPt(end)],
      {
        diameterIn: 8,
        service: "Process feed to exchanger train",
        systemName: "Process feed",
        elevIn: [30, 30, 30, tubeElevIn, null],
        // The feed enters at the plot boundary — a battery-limit
        // inlet, open by design.
        openEnds: { start: "battery-limit" },
      },
    );
  }
  for (const [from, to] of [["E-101", "E-102"], ["E-102", "E-103"], ["E-103", "E-104"]]) {
    const start = anchor(from, "tube-out");
    const end = anchor(to, "tube-in");
    run(
      [anchorPt(start), anchorPt(end)],
      { diameterIn: 8, service: `Process feed — ${from} to ${to}`, systemName: "Process feed" },
    );
  }
  {
    const start = anchor("E-104", "tube-out");
    const end = anchor("R-101", "feed-in");
    // D10-05: the approach leaves the tube-out face EAST along its
    // normal (2 ft, no stub), turns north at x=373 ft, then west —
    // the old corner at (371, 190) sat on the face's own row, so the
    // approach arrived 90 degrees off the normal and drew a diagonal
    // stub. Both elevation changes are vertical legs at corners
    // (the rise to the 30-in lane at x=373 ft, the climb to the
    // feed-in face at x=190 ft), never slopes into a nozzle. Every
    // riser pair carries BOTH elevations explicitly: a null on the
    // first point lets addPipeRun's dedupe collapse the riser.
    const tubeElevIn = faceElevationIn(next, "E-104", "tube-out");
    const feedElevIn = faceElevationIn(next, "R-101", "feed-in");
    run(
      [
        anchorPt(start),
        pt(373, 235),
        pt(373, 235),
        pt(373, 190),
        pt(190, 190),
        pt(190, 190),
        anchorPt(end),
      ],
      {
        diameterIn: 8,
        service: "Process feed to reactor",
        systemName: "Process feed",
        elevIn: [null, tubeElevIn, 30, 30, 30, feedElevIn, null],
      },
    );
  }
  // F2 — fractionator bottoms through the exchanger shell sides along
  // y=233.75 ft, entering at E-104 and leaving E-101 to rundown — again
  // with real nozzle endpoints on every exchanger (P663-001).
  {
    const start = anchor("T-101", "bottoms-out");
    const end = anchor("E-104", "shell-in");
    // D10-05: the bottoms-out nozzle faces 45 degrees (radial on a
    // vertical cylinder), so no axis-aligned approach can meet the
    // 20-degree approach window — the run drops vertically AT the
    // face (terminal riser, duplicate plan point). The riser's face
    // point carries its EXPLICIT face elevation: a null there would
    // let addPipeRun's dedupe collapse the riser. The riser stops
    // at 150 in — above the downcomer level-1 deck band (120 ± 12)
    // whose box covers the face — transits south at 150, and drops
    // to the 36-in grade lane at y=175 ft, south of the deck box
    // (south edge 1914 in), never through it. The 36-in lane (not
    // 30) clears the T-101 plant-water drop's riser (top 24 in):
    // the face's own meridian runs 5 in from it with only 6 in of
    // vertical separation at 30 in. The climb into the shell-in
    // face is a vertical leg at the (368, 205) corner, not a slope.
    const bottomsElevIn = faceElevationIn(next, "T-101", "bottoms-out");
    const shellElevIn = faceElevationIn(next, "E-104", "shell-in");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        { x: start.x, y: 175 * FT },
        { x: start.x, y: 175 * FT },
        { x: start.x, y: 205 * FT },
        pt(368, 205),
        pt(368, 205),
        anchorPt(end),
      ],
      {
        diameterIn: 12,
        service: "Slurry oil — fractionator bottoms to exchanger train",
        systemName: "Reactor effluent",
        elevIn: [bottomsElevIn, 150, 150, 36, 36, 36, shellElevIn, null],
      },
    );
  }
  // D10-05: the shell nozzles face diagonally (catalog 1:2 normal), so
  // a 2-point run gets a diagonal approach stub at each end. Each run
  // is a 4-point run instead: a short axis-aligned approach into each
  // face (under the 12-in stub threshold), joined by a horizontal leg
  // 20 in north of the exchanger faces (TRAIN_APPROACH_IN — the
  // 10-in leg sat inside the tube-in spurs' swept envelopes). The
  // whole run rides at the shell-face elevation (derived from the
  // face, never hardcoded).
  const shellElevIn = faceElevationIn(next, "E-104", "shell-out");
  for (const [from, to] of [["E-104", "E-103"], ["E-103", "E-102"], ["E-102", "E-101"]]) {
    const start = anchor(from, "shell-out");
    const end = anchor(to, "shell-in");
    run(
      [
        anchorPt(start),
        { x: start.x, y: start.y - TRAIN_APPROACH_IN },
        { x: end.x, y: end.y - TRAIN_APPROACH_IN },
        anchorPt(end),
      ],
      {
        diameterIn: 12,
        service: `Fractionator bottoms — ${from} to ${to}`,
        systemName: "Reactor effluent",
        elevationIn: shellElevIn,
      },
    );
  }
  {
    const start = anchor("E-101", "shell-out");
    // D10-05: the approach leaves the shell-out face NORTH along
    // its normal (24 in, no stub), turns west, then south to the
    // suction header — the old westward first leg ran 90 degrees
    // off the normal and drew a diagonal stub. The rise from the
    // face elevation to the 30-in rundown lane is a vertical leg at
    // the west corner. The approach is 24 in, not 10: the south leg
    // crosses the feed run at y=235 ft and the crossing jog's riser
    // must clear this corner's riser by the 12-in separation, which
    // a 10-in approach cannot give.
    const shellElevIn = faceElevationIn(next, "E-101", "shell-out");
    const approachIn = 2 * FT;
    // D10-05: the south leg rides at x=265 ft (was 266 ft). The
    // 266-ft lane sat 6 in past the E-101 tube-in spur's far end,
    // inside its swept envelope (the envelope reaches 15 in past
    // the spur); 265 ft clears the envelope by 3 in.
    run(
      [
        anchorPt(start),
        { x: start.x, y: start.y - approachIn },
        { x: 265 * FT, y: start.y - approachIn },
        { x: 265 * FT, y: start.y - approachIn },
        pt(265, 328),
      ],
      {
        diameterIn: 12,
        service: "Fractionator bottoms to rundown",
        systemName: "Reactor effluent",
        elevIn: [null, shellElevIn, shellElevIn, 30, 30],
      },
    );
  }
  // R1 — reactor effluent to the fractionator. The approach turns
  // north at x=310 ft and enters the west-face feed nozzle along its
  // normal at the nozzle's own row: routing the corner at the column
  // face (x=316 ft) threads the line through the bottoms draw's
  // descent corridor beside the level-1 platform.
  {
    const start = anchor("R-101", "effluent-out");
    const end = anchor("T-101", "feed-in");
    // D10-05: the approach leaves the effluent-out face EAST along
    // its normal (2 ft, no stub), turns north at x=198 ft — the old
    // corner at (196, 160) sat on the face's own row, so the
    // approach arrived 90 degrees off the normal and drew a diagonal
    // stub. Both elevation changes are vertical legs at corners
    // (the drop to the 30-in lane at x=198 ft, the climb to the
    // feed-in face at x=310 ft), never slopes into a nozzle.
    const effluentElevIn = faceElevationIn(next, "R-101", "effluent-out");
    const feedElevIn = faceElevationIn(next, "T-101", "feed-in");
    run(
      [
        anchorPt(start),
        pt(198, 170),
        pt(198, 170),
        pt(198, 1900 / 12),
        pt(310, 1900 / 12),
        { x: 310 * FT, y: end.y },
        { x: 310 * FT, y: end.y },
        anchorPt(end),
      ],
      {
        diameterIn: 16,
        service: "Reactor effluent to fractionator",
        systemName: "Reactor effluent",
        // D10-05: the east leg runs at y=1900 in (was y=160 ft).
        // The old lane sat on the R-102 flue-gas-out spur's far end
        // (the spur runs south from the face at y=1950 in to y=1920
        // in, envelope to y=1905 in); 1900 in clears the envelope
        // by 5 in and stays north of the T-101/T-102 spur envelopes.
        elevIn: [null, effluentElevIn, 30, 30, 30, 30, feedElevIn, null],
      },
    );
  }
  // R2 — spent catalyst to the regenerator. D10-05: both catalyst
  // nozzles face 45 degrees (radial on vertical cylinders), so no
  // axis-aligned approach can meet the 20-degree window — each end
  // drops vertically AT its face (terminal riser) from the face
  // elevation to the 30-in transfer lane. Both face points carry
  // explicit elevations so the dedupe keeps the risers.
  {
    const start = anchor("R-101", "spent-catalyst-out");
    const end = anchor("R-102", "spent-catalyst-in");
    const startElevIn = faceElevationIn(next, "R-101", "spent-catalyst-out");
    const endElevIn = faceElevationIn(next, "R-102", "spent-catalyst-in");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        { x: start.x, y: 2200 },
        { x: end.x, y: 2200 },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 10,
        service: "Spent catalyst to regenerator",
        systemName: "Catalyst transfer",
        elevIn: [startElevIn, 30, 30, 30, 30, endElevIn],
      },
    );
  }
  // R3 — regenerated catalyst back to the reactor. D10-05: same
  // terminal-riser rebuild as R2 (both nozzles face 45 degrees).
  {
    const start = anchor("R-102", "regen-catalyst-out");
    const end = anchor("R-101", "regen-catalyst-in");
    const startElevIn = faceElevationIn(next, "R-102", "regen-catalyst-out");
    const endElevIn = faceElevationIn(next, "R-101", "regen-catalyst-in");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        { x: start.x, y: 162 * FT },
        { x: end.x, y: 162 * FT },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 10,
        service: "Regenerated catalyst to reactor",
        systemName: "Catalyst transfer",
        elevIn: [startElevIn, 30, 30, 30, 30, endElevIn],
      },
    );
  }
  // D1 — heavy cycle oil draw: from the 10 ft downcomer assembly's draw
  // outlet (east side, at the level's 120 in elevation) east, then south
  // overhead to the battery limit. Its own circuit — it touches neither
  // the suction header nor the light cycle oil path.
  {
    const start = anchor("T-101", "downcomer-1-draw");
    run(
      [anchorPt(start), pt(348, 150), pt(348, 400)],
      {
        diameterIn: 6,
        service: "Heavy cycle oil draw to battery limit",
        systemName: "Product rundown",
        elevationIn: 120,
        // Leaves at the plot boundary — a battery-limit outlet.
        openEnds: { end: "battery-limit" },
      },
    );
  }
  // D2 — light cycle oil draw: from the 20 ft assembly's draw outlet
  // (west side, at 240 in) west, then north to the battery limit.
  {
    const start = anchor("T-101", "downcomer-2-draw");
    run(
      [anchorPt(start), pt(250, 150), pt(250, 36)],
      {
        diameterIn: 6,
        service: "Light cycle oil draw to battery limit",
        systemName: "Product rundown",
        elevationIn: 240,
        // Leaves at the plot boundary — a battery-limit outlet.
        openEnds: { end: "battery-limit" },
      },
    );
  }
  // R4 — regenerator flue gas to the battery limit.
  // D10-05: the 2-point run sloped from the face elevation to the
  // 30-in battery-limit lane. The drop is a terminal riser at the
  // face (duplicate plan point); the north leg then runs flat at
  // 30 in along the face normal.
  {
    const start = anchor("R-102", "flue-gas-out");
    const faceElevIn = faceElevationIn(next, "R-102", "flue-gas-out");
    run(
      [anchorPt(start), anchorPt(start), pt(245, 36)],
      {
        diameterIn: 12,
        service: "Regenerator flue gas to battery limit",
        systemName: "Flue gas",
        elevIn: [faceElevIn, 30, null],
        // Leaves at the plot boundary — a battery-limit outlet.
        openEnds: { end: "battery-limit" },
      },
    );
  }
  // G1 — fractionator overhead vapors to the reflux drum (the overhead
  // stream is wet gas / gasoline-range material, not yet a separated
  // gas product — downstream separation happens in V-101/V-102).
  // D10-05: the old first leg drew a diagonal stub off the face and
  // the descent sloped the whole east lane. The run leaves the face
  // SOUTH along its normal flat at the face elevation, turns east,
  // drops in a vertical leg at the (325, 155.2) corner to the 40-in
  // lane, runs south and east flat, and climbs to the V-101 inlet
  // face in a vertical leg at the (330, 255) corner. The 40-in lane
  // (not 30) clears the exchanger tube runs (26.04 in) the south
  // leg crosses by 14 in. The riser at (325, 155.2) sits east of
  // the downcomer deck box, clear of it.
  {
    const start = anchor("T-101", "overhead-out");
    const end = anchor("V-101", "inlet");
    const startElevIn = faceElevationIn(next, "T-101", "overhead-out");
    const endElevIn = faceElevationIn(next, "V-101", "inlet");
    run(
      [
        anchorPt(start),
        { x: start.x, y: start.y + SHORT_APPROACH_IN },
        { x: 3900, y: start.y + SHORT_APPROACH_IN },
        { x: 3900, y: start.y + SHORT_APPROACH_IN },
        pt(325, 255),
        pt(330, 255),
        pt(330, 255),
        anchorPt(end),
      ],
      {
        diameterIn: 10,
        service: "Overhead vapors — wet gas / gasoline-range material",
        systemName: "Overhead & reflux",
        elevIn: [null, startElevIn, startElevIn, 40, 40, 40, endElevIn, null],
      },
    );
  }
  // G2 — reflux drum liquid to the suction header (the end lands
  // pipe-to-pipe ON the header at x=315 ft: a junction-modeled mixing
  // point it shares with the slurry bottoms rundown — see the fixture
  // draw map on configureFractionator).
  // D10-05: the start is the SCHEDULED head-west bottom face
  // (3873, 3144) at 12 in (D10-04), not the legacy side face. The
  // west leg runs flat at 12 in along the face normal; the climb
  // to the 30-in header lane is a vertical leg at the (315, 262)
  // corner, not a slope.
  {
    const start = anchor("V-101", "liquid-out");
    run(
      [anchorPt(start), pt(315, 262), pt(315, 262), pt(315, 328)],
      {
        diameterIn: 6,
        service: "Reflux drum liquid to suction header",
        systemName: "Overhead & reflux",
        elevIn: [null, 12, 30, 30],
      },
    );
  }
  // G3 — reflux return from the reflux pump discharge to the fractionator.
  // The north-south segment at x=345 rides at 40 in to clear the
  // east-west process runs below (D668-002: explicit elevations beat
  // the default-30 fallback that caused same-elevation crossings).
  // D10-05: both elevation changes are terminal risers AT the faces
  // (the P-101 discharge face up to the 40-in lane; the T-101
  // reflux-in face, which faces 45 degrees, up from the 40-in
  // lane) — never slopes, never a diagonal stub into the nozzle.
  {
    const start = anchor("P-101", "discharge-out");
    const end = anchor("T-101", "reflux-in");
    const startElevIn = faceElevationIn(next, "P-101", "discharge-out");
    const endElevIn = faceElevationIn(next, "T-101", "reflux-in");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        pt(160, 367),
        pt(345, 367),
        { x: 345 * FT, y: end.y },
        { x: 345 * FT, y: end.y },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 6,
        service: "Reflux return to fractionator",
        systemName: "Overhead & reflux",
        // D10-05: the west leg rides at 90 in (riser at the x=345 ft
        // corner) — above the 84-in walkway headroom — so it clears
        // the T-101 nitrogen spur, whose envelope's south edge
        // (y=1833 in) sits 0.94 in below the leg's line. The leg
        // cannot move in plan: it is pinned by the reflux-in face.
        elevIn: [startElevIn, 40, 40, 40, 40, 90, 90, endElevIn],
      },
    );
  }
  // G4 — wet gas to the knockout drum.
  // D10-05: the west leg sloped off the V-101 face and the approach
  // to the V-102 gas-in face drew a diagonal stub (the face is met
  // from the north, 90 degrees off its east normal). The west leg
  // runs flat at the V-101 face elevation, drops at the (273, 260.8)
  // corner, and climbs to the gas-in face in a terminal riser AT
  // the face — never a slope, never a stub.
  {
    const start = anchor("V-101", "wet-gas-out");
    const end = anchor("V-102", "gas-in");
    const startElevIn = faceElevationIn(next, "V-101", "wet-gas-out");
    const endElevIn = faceElevationIn(next, "V-102", "gas-in");
    run(
      [
        anchorPt(start),
        { x: end.x, y: start.y },
        { x: end.x, y: start.y },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 8,
        service: "Wet gas to knockout drum",
        systemName: "Wet gas",
        elevIn: [null, startElevIn, 30, 30, endElevIn],
      },
    );
  }
  // G5 — knockout drum gas to the compressor suction.
  // D10-05: the south leg sloped off the V-102 gas-out face and
  // the last leg sloped into the K-102 suction face. Both are
  // vertical legs now — a terminal riser AT the gas-out face down
  // to the 30-in lane, and a riser at the (230, 293) corner up to
  // the suction face elevation.
  {
    const start = anchor("V-102", "gas-out");
    const end = anchor("K-102", "suction-in");
    const startElevIn = faceElevationIn(next, "V-102", "gas-out");
    const endElevIn = faceElevationIn(next, "K-102", "suction-in");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        pt(270, 293),
        pt(230, 293),
        pt(230, 293),
        anchorPt(end),
      ],
      {
        diameterIn: 8,
        service: "Knockout drum gas to compressor suction",
        systemName: "Wet gas",
        // D10-05: the south leg at x=270 ft used to run at the 30-in
        // transfer lane, 6 in above the plant-air branch's 24-in
        // approach (needs 7.970 in). It now rides at 34 in, 10 in
        // clear of the branch.
        elevIn: [startElevIn, 34, 34, 34, endElevIn, null],
      },
    );
  }
  // G6 — compressor discharge to the absorber.
  // The north-south segment at x=350 rides at 40 in to clear the
  // east-west process runs below (D668-002). The climb to the
  // absorber's high gas inlet is a terminal riser AT the gas-in
  // face: the grade leg runs east at 40 in under the deck
  // elevations and rises at the nozzle. D10-05: the climb is a
  // true vertical riser (the elevation-aware dedupe now preserves
  // it) and the first leg is a terminal riser at the K-102
  // discharge face — the old steep spool, the slope off the
  // discharge face, and the retracing eastward jog are gone.
  {
    const start = anchor("K-102", "discharge-out");
    const end = anchor("T-102", "gas-in");
    // The climb elevation is the gas-in FACE's elevation (the shared
    // face model — anchorsOf points carry no elevation).
    const endInst = instanceByTag(next, "T-102");
    const endFace = connectionFaceForAnchor(
      findSymbol(endInst.domain, endInst.symbolId),
      endInst,
      end.id,
    );
    const startElevIn = faceElevationIn(next, "K-102", "discharge-out");
    run(
      [
        anchorPt(start),
        anchorPt(start),
        pt(230, 364),
        pt(350, 364),
        { x: 350 * FT, y: 1830 },
        { x: 350 * FT, y: 1830 },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 6,
        service: "Compressor discharge to absorber",
        systemName: "Wet gas",
        // D10-05: the east leg used to run along the T-102 face line
        // (y=1830 in) at 40 in, blocking all three utility spurs at
        // their entries. It now runs east at y=1830 in but at 110 in
        // — above the 84-in walkway headroom, so it clears the spurs
        // (pipe bottom 107 in) — and south of the downcomer ladder
        // cage. The ladder stands at (4344, 1866) ON the gas-in
        // meridian and climbs every level (0-480 in), so NO south
        // leg on the meridian clears it at any elevation; the
        // branch must approach the port from the west along its
        // own row. The 110-in leg also clears the T-102 plant-air
        // branch, which shares the port row at 90 in: the two
        // terminal risers at the shared plan position (4344, 1830)
        // are disjoint (air 24-90 in, gas 110 in to the face).
        // The terminal riser at the port drops from 110 in to the
        // gas-in face elevation.
        elevIn: [startElevIn, 40, 40, 40, 40, 110, 110, endFace.elevationIn],
      },
    );
  }
  // G7 — absorber rich oil straight to the fractionator.
  // D10-05: the 2-point run sloped from the T-102 face elevation
  // to the T-101 face elevation. The drop is a terminal riser AT
  // the T-102 face (duplicate plan point); the west leg then runs
  // flat at the T-101 face elevation along both normals.
  {
    const start = anchor("T-102", "rich-oil-out");
    const end = anchor("T-101", "rich-oil-in");
    const startElevIn = faceElevationIn(next, "T-102", "rich-oil-out");
    const endElevIn = faceElevationIn(next, "T-101", "rich-oil-in");
    run(
      [anchorPt(start), anchorPt(start), anchorPt(end)],
      {
        diameterIn: 6,
        service: "Absorber rich oil to fractionator",
        systemName: "Overhead & reflux",
        elevIn: [startElevIn, endElevIn, null],
      },
    );
  }
  // M1 — air intake to the main air blower.
  // D10-05: the 2-point run sloped from the 30-in battery-limit
  // lane to the intake face. The drop is a terminal riser AT the
  // blower face (duplicate plan point); the east leg runs flat
  // at 30 in.
  {
    const end = anchor("K-101", "intake-in");
    const faceElevIn = faceElevationIn(next, "K-101", "intake-in");
    run(
      [pt(100, 300), anchorPt(end), anchorPt(end)],
      {
        diameterIn: 12,
        service: "Air intake",
        systemName: "Combustion air",
        elevIn: [30, 30, faceElevIn],
        // Enters at the plot boundary — a battery-limit inlet.
        openEnds: { start: "battery-limit" },
      },
    );
  }
  // M2 — combustion air from the blower discharge to the regenerator.
  // D10-05: the old run left the discharge face SOUTH, 90 degrees
  // off its east normal, and drew a diagonal stub; the last leg
  // sloped into the air-in face. The run leaves the face EAST along
  // its normal (1 ft), rises to the 30-in lane at that corner, runs
  // south and east flat, then north flat to the air-in face and
  // climbs to it in a terminal riser AT the face.
  {
    const start = anchor("K-101", "discharge-out");
    const end = anchor("R-102", "air-in");
    const startElevIn = faceElevationIn(next, "K-101", "discharge-out");
    const endElevIn = faceElevationIn(next, "R-102", "air-in");
    run(
      [
        anchorPt(start),
        { x: start.x + FT, y: start.y },
        { x: start.x + FT, y: start.y },
        { x: start.x + FT, y: 324 * FT },
        pt(245, 324),
        { x: 245 * FT, y: 2200 },
        { x: 245 * FT, y: 2200 },
        { x: 245 * FT, y: end.y },
        anchorPt(end),
        anchorPt(end),
      ],
      {
        diameterIn: 16,
        service: "Combustion air to regenerator",
        systemName: "Combustion air",
        // D10-05: the south leg at x=245 ft used to run at the 30-in
        // transfer lane all the way to the air-in face, 6 in above
        // the plant-air branch's 24-in approach (needs 11.658 in).
        // It now rises to the face elevation at y=2200 in, north of
        // the utility spur envelopes, so the leg beside the port
        // rides at the face elevation, clear of the branch.
        elevIn: [null, startElevIn, 30, 30, 30, 30, endElevIn, endElevIn, endElevIn, endElevIn],
      },
    );
  }
  // P0 — rack rundown header (battery-limit to battery-limit).
  run([pt(128, 373), pt(415, 373)], {
    diameterIn: 12,
    service: "Rack rundown header",
    systemName: "Product rundown",
    // A through-header: both ends leave at the plot boundary.
    openEnds: { start: "battery-limit", end: "battery-limit" },
  });
  // SH — pump suction header.
  run([pt(150, 328), pt(330, 328)], {
    diameterIn: 10,
    service: "Pump suction header",
    systemName: "Product rundown",
    // A capped header: both ends are blanked by design.
    openEnds: { start: "capped", end: "capped" },
  });
  // Suction stubs from the suction header down to each pump.
  // D10-05: the stub sloped from the header (30 in) to the pump
  // suction face. The drop is a terminal riser AT the pump face
  // (duplicate plan point); the stub then runs flat at 30 in.
  const pumpRow = [
    ["P-101", 160],
    ["P-102", 185],
    ["P-103", 210],
    ["P-104", 235],
    ["P-105", 260],
    ["P-106", 285],
  ];
  for (const [tag, pxFt] of pumpRow) {
    const end = anchor(tag, "suction-in");
    const faceElevIn = faceElevationIn(next, tag, "suction-in");
    run([pt(pxFt, 328), anchorPt(end), anchorPt(end)], {
      diameterIn: 4,
      service: `Pump suction — ${tag}`,
      systemName: "Product rundown",
      elevIn: [30, 30, faceElevIn],
    });
  }
  // Discharge jumpers from each pump (except the reflux pump P-101, whose
  // discharge is run G3) up to the rack rundown header. Each jogs up at
  // the rack edge (y=361 ft) so its last segment rides the rack and its
  // end actually meets the header's elevation (186 in — D668-004: the
  // junction faces must meet within tolerance).
  // D10-05: both climbs are vertical legs — a terminal riser at the
  // pump discharge face (to the 183-in rack lane) and a riser at the
  // (pxFt, 361) corner (to the 186-in header elevation) — never
  // slopes.
  for (const [tag, pxFt] of pumpRow.slice(1)) {
    const start = anchor(tag, "discharge-out");
    const faceElevIn = faceElevationIn(next, tag, "discharge-out");
    run(
      [anchorPt(start), anchorPt(start), pt(pxFt, 361), pt(pxFt, 361), pt(pxFt, 373)],
      {
        diameterIn: 6,
        service: `Pump discharge — ${tag}`,
        systemName: "Product rundown",
        elevIn: [faceElevIn, 183, 183, 186, 186],
      },
    );
  }
  // X0 — relief header: process area -> east -> south -> flare.
  // D10-05: the flare riser sloped from the 30-in header lane to
  // the 744-in relief-in face. The climb is a terminal riser AT
  // the flare (duplicate plan point); the first three points are
  // pinned and unchanged.
  {
    const end = anchor("FL-101", "relief-in");
    const faceElevIn = faceElevationIn(next, "FL-101", "relief-in");
    run([pt(380, 180), pt(520, 180), pt(520, 400), anchorPt(end), anchorPt(end)], {
      id: fccuId("relief-header"),
      diameterIn: 24,
      service: "Relief header to flare",
      systemName: "Relief",
      elevIn: [30, 30, 30, 30, faceElevIn],
    });
  }
  // X1 — fractionator relief branch into the header. The southward
  // leg runs at x=358.3 ft, west of the absorber's utility-fan port
  // zone: at x=366 ft its crossing jog over the fan lines landed the
  // jog's downcomer inside the water line's envelope.
  // D10-05: the relief-out nozzle faces 45 degrees, so the run
  // drops vertically AT the face (terminal riser) to the 30-in
  // header lane, then runs flat — the old first legs sloped off
  // the face and drew diagonal stubs. The north leg crosses the
  // absorber's north-face access spurs (gas-in, rich-oil-out,
  // plant-water) at 30 in, headroom-blocking all three; the
  // spur-crossing segment (y 1760-1885 in) rides at 90 in, above
  // the 84-in walkway headroom, with vertical risers at its ends
  // just outside the spur envelopes (rich-oil-out envelope south
  // edge 1769.6 in, plant-water envelope north edge 1875 in).
  // The leg stays on its x=358.3 ft lane — moving it in plan
  // severs the walk graph to the absorber downcomer nodes.
  {
    const start = anchor("T-101", "relief-out");
    const faceElevIn = faceElevationIn(next, "T-101", "relief-out");
    run(
      [anchorPt(start), anchorPt(start), { x: start.x, y: 146 * FT }, pt(358.3, 146), pt(358.3, 1760 / 12), pt(358.3, 1760 / 12), pt(358.3, 1885 / 12), pt(358.3, 1885 / 12), pt(358.3, 180), pt(380, 180)],
      {
        diameterIn: 12,
        service: "Fractionator relief branch",
        systemName: "Relief",
        elevIn: [faceElevIn, 30, 30, 30, 30, 90, 90, 30, 30, null],
      },
    );
  }
  // X2 — regenerator relief branch into the header.
  // D10-05: same terminal-riser rebuild as X1 (relief-out faces
  // 45 degrees). The branch taps the fractionator branch's final
  // leg at (375, 180) ft — a modeled junction on that leg — instead
  // of ending at the header's start corner (380, 180), which the
  // fractionator branch already claims: two branches ending at one
  // point share a zero-distance endpoint with no direct junction
  // edge between them (D10-06 Ruling 2 item 4), so the pair fails
  // spacing at 0.000 in against 15.750 in required.
  {
    const start = anchor("R-102", "relief-out");
    const faceElevIn = faceElevationIn(next, "R-102", "relief-out");
    run(
      [anchorPt(start), anchorPt(start), { x: start.x, y: 186 * FT }, pt(375, 186), pt(375, 180)],
      {
        diameterIn: 12,
        service: "Regenerator relief branch",
        systemName: "Relief",
        elevIn: [faceElevIn, 30, 30, 30, null],
      },
    );
  }
  // U1 — cooling water supply to E-101. It approaches the exchanger's
  // cooling-water-in nozzle from the south (perpendicular), rather than
  // running west along the nozzle line, so it never overlaps the
  // exchanger-to-exchanger chain runs that share that line.
  // D10-05: the south leg sloped from the 185-in supply lane to the
  // 30-in lane and into the face. Both drops are vertical legs at
  // corners (at (400, 376) and at (272, 252)); the east leg rides
  // at 185, the south/west legs at 30, the approach at the face
  // elevation. Dropping to 30 at (400, 376) also clears the P0
  // header (186 in) the old high leg crossed at near-equal height.
  {
    const end = anchor("E-101", "cooling-water-in");
    const faceElevIn = faceElevationIn(next, "E-101", "cooling-water-in");
    run(
      [
        pt(110, 376),
        pt(400, 376),
        pt(400, 376),
        pt(400, 252),
        { x: end.x, y: 252 * FT },
        { x: end.x, y: 252 * FT },
        anchorPt(end),
      ],
      {
        diameterIn: 10,
        service: "Cooling water supply",
        systemName: "Cooling water",
        elevIn: [185, 185, 30, 30, 30, faceElevIn, null],
        // Enters at the plot boundary — a battery-limit inlet.
        openEnds: { start: "battery-limit" },
      },
    );
  }
  // D10-05: same short-approach rebuild as the shell chain — the
  // cooling-water nozzles face diagonally too. Corners sit 20 in
  // south of the south-edge faces (TRAIN_APPROACH_IN — the 10-in leg
  // sat inside the tube-out spurs' swept envelopes); the run rides
  // at the face elevation.
  const cwElevIn = faceElevationIn(next, "E-101", "cooling-water-out");
  for (const [from, to] of [["E-101", "E-102"], ["E-102", "E-103"], ["E-103", "E-104"]]) {
    const start = anchor(from, "cooling-water-out");
    const end = anchor(to, "cooling-water-in");
    run(
      [
        anchorPt(start),
        { x: start.x, y: start.y + TRAIN_APPROACH_IN },
        { x: end.x, y: end.y + TRAIN_APPROACH_IN },
        anchorPt(end),
      ],
      {
        diameterIn: 10,
        service: `Cooling water — ${from} to ${to}`,
        systemName: "Cooling water",
        elevationIn: cwElevIn,
      },
    );
  }
  // U2 — cooling water return, from the last exchanger in the chain.
  // Its southward leg at x=140 ft is authored at 140 in so it passes
  // UNDER the utility headers' tier (185 in) and the utility drops
  // (150/162/174 in) with real separation — 160 in sat 2 in from
  // the plant-air transit (162 in), inside the clearance envelope
  // (R3: one shared physical profile).
  // D10-05: the approach leaves the CW-out face SOUTH along its
  // normal flat at the face elevation; the climb to the 140-in
  // lane is a vertical leg at the (368, 248) corner, not the old
  // slope off the face.
  {
    const start = anchor("E-104", "cooling-water-out");
    const faceElevIn = faceElevationIn(next, "E-104", "cooling-water-out");
    run(
      [
        anchorPt(start),
        { x: start.x, y: 248 * FT },
        { x: start.x, y: 248 * FT },
        pt(140, 248),
        pt(140, 379),
        pt(107, 379),
      ],
      {
        diameterIn: 10,
        service: "Cooling water return",
        systemName: "Cooling water",
        elevIn: [null, faceElevIn, 140, 140, 140, 140],
        // Leaves at the plot boundary — a battery-limit outlet.
        openEnds: { end: "battery-limit" },
      },
    );
  }
  return next;
}

/**
 * T-101, the main fractionator: a fictional FCCU-inspired arrangement
 * with authored product draws (an illustration, not a validated
 * operating design). The column keeps its catalog 30 ft height, so it
 * carries downcomer assemblies at 10/20/30 ft. Fixture draw map:
 *   30 ft assembly / top outlet — overhead gas (the overhead circuit
 *     runs from the column's overhead-out nozzle to the reflux drum;
 *     downstream, wet gas continues through the KO drum and compressor
 *     to the absorber)
 *   20 ft assembly draw outlet — light cycle oil (own circuit west,
 *     then north to the battery limit)
 *   10 ft assembly draw outlet — heavy cycle oil (own circuit east,
 *     then south to the battery limit)
 *   bottoms-out nozzle (below the lowest assembly) — slurry oil, via
 *     the existing bottoms circuit through the exchanger train; its
 *     rundown end joins the pump suction header at an explicit,
 *     junction-modeled mixing point shared with the reflux-drum liquid.
 * The light/heavy cycle oil paths stay separate from each other and
 * from the suction header. Products are editable level data;
 * temperatures stay blank for the operator to enter — never invented.
 */
function configureFractionator(design) {
  const t101 = instanceByTag(design, "T-101");
  let next = design;
  const draws = [
    [1, "Heavy cycle oil"],
    [2, "Light cycle oil"],
    [3, "Overhead gas"],
  ];
  for (const [index, product] of draws) {
    next = setDowncomerLevelProps(next, t101.id, index, { product });
  }
  return next;
}

/**
 * Utility piping (plant water, plant air, nitrogen): a header for each
 * service runs through the pipe rack (riding the rack's elevation like
 * any rack run), and a branch runs from each header to the BASE of
 * every vessel, junctioned (flanged) at the header and attached
 * (flanged) at the vessel's utility connection. Branch routes step off
 * the rack at its north edge (y=362 ft) so the derived elevations meet
 * the header's at the junction.
 */
// D8: utility headers for the three services run through the rack on
// DELIBERATE TIERS (authored elevations, not the rack's single
// fallback line), each fed by its own designated source / battery-
// limit inlet at the west end. Branches drop from each header to the
// base utility ports of every in-scope vessel (reactors, columns,
// drums): tap on the header at tier elevation, a 1-ft drop leg to the
// port elevation (24 in), then the run to the port — flanged at both
// ends. Connectivity is modeled (junctions + attachments), so the
// supply graph — branch -> header -> source — is real, not proximity.
const UTILITY_HEADER_TIER_IN = { "plant-water": 150, "plant-air": 162, nitrogen: 174 };

function addUtilities(design, systemIds) {
  let next = design;
  const headerYFt = { "plant-water": 369, "plant-air": 371, nitrogen: 375 };
  // Sizing per Jason's pin: headers (and their source inlets) are
  // 2-inch pipe; the drops to each vessel base are 1-inch.
  for (const service of UTILITY_SERVICES) {
    const yFt = headerYFt[service.id];
    const tier = UTILITY_HEADER_TIER_IN[service.id];
    // Source / battery-limit inlet for this service, west of the rack.
    next = addRun(next, systemIds, [pt(118, yFt), pt(130, yFt)], {
      diameterIn: UTILITY_HEADER_DIAMETER_IN,
      service: `${service.label} source`,
      systemName: service.label,
      utility: service.id,
      elevationIn: tier,
      sourceOf: service.id,
      // Enters at the plot boundary — a battery-limit inlet.
      openEnds: { start: "battery-limit" },
    });
    next = addRun(next, systemIds, [pt(130, yFt), pt(405, yFt)], {
      diameterIn: UTILITY_HEADER_DIAMETER_IN,
      service: `${service.label} header`,
      systemName: service.label,
      utility: service.id,
      elevationIn: tier,
      // The header's east end is blanked by design.
      openEnds: { end: "capped" },
    });
  }
  // Branch routes are authored per vessel. Straight lanes drop from
  // the header tier to the port elevation (24 in) on a 1-ft drop leg
  // just south of the tap. Two routings need care:
  //  - R-101's plant-water lane would clip pump P-102's east edge, so
  //    it jogs east around the pump row and comes back west into the
  //    base;
  //  - T-102 sits behind the exchanger row, so its three services use
  //    three offset eastern lanes (395/398/401 ft) and fan into the
  //    base along staggered approach lines (152.5/158/164 ft) at
  //    staggered elevations (24/36/48 in), dropping to the port
  //    elevation at each anchor — no two runs ever share a line at
  //    the same elevation.
  const T102_LANE_FT = { "plant-water": 395, "plant-air": 398, nitrogen: 401 };
  // Fan shaping (see the T-102 branch below): nitrogen (easternmost
  // port) takes the NEAREST row and a shallow line; plant-air takes
  // the far row; plant-water runs a long diagonal at port elevation.
  const T102_APPROACH_FT = { "plant-water": 159.9, "plant-air": 157.5, nitrogen: 1880 / 12 };
  // Approach (west-leg) elevations: nitrogen 48, plant-air 36,
  // plant-water 36 — staggered so the west legs clear the other
  // services' north legs (which climb to the 24-in port elevation)
  // where they cross. Plant-water rides at 36, not 24: its west
  // leg crosses plant-air's north leg, which is at 24.
  const T102_APPROACH_ELEV_IN = { "plant-water": 36, "plant-air": 36, nitrogen: 48 };
  for (const tag of ["R-101", "R-102", "T-101", "T-102", "V-101", "V-102"]) {
    for (const service of UTILITY_SERVICES) {
      const end = anchorOfTag(next, tag, service.anchorId);
      const yFt = headerYFt[service.id];
      const tier = UTILITY_HEADER_TIER_IN[service.id];
      const anchorFt = { x: end.x / FT, y: end.y / FT };
      let points;
      let elevIn;
      let tapXFt = null;
      if (tag === "T-102" && service.id === "plant-air") {
        // D10-05: the plant-air port sits ON the gas-in meridian
        // (x=4344 in), which is also the downcomer ladder's
        // meridian — the ladder stands at (4344, 1866) and climbs
        // every level, so NO south leg on x=4344 clears it at any
        // elevation. The branch fans west at y=1900 in (48 in —
        // clear of the water leg at y=1890/36 in by 15.6 in 3D and
        // of the nitrogen leg at y=1880/48 in by 20 in), drops
        // south at x=4410 in (east of the nitrogen spur envelope
        // 4401 in and of the ladder box, clear of the nitrogen
        // south leg by 45.8 in 3D), then runs WEST along the port
        // row y=1830 in at 90 in — above the 84-in walkway
        // headroom, 20 in below the compressor-discharge leg at
        // 110 in (needs 6.97 in), south of the ladder box — to
        // the port. Approaching from the east keeps it off the
        // discharge corner riser at (4200, 1830), which spans
        // z 40-110 in; the terminal risers at the shared plan
        // position (4344, 1830) are disjoint (air 24-90 in, gas
        // 110-297.6 in). Terminal riser at the port drops 90 in
        // to the 24-in port elevation.
        const lane = T102_LANE_FT[service.id];
        points = [
          pt(lane, yFt),
          pt(lane, yFt - 1),
          pt(lane, 1900 / 12),
          pt(lane, 1900 / 12),
          pt(4410 / 12, 1900 / 12),
          pt(4410 / 12, 1830 / 12),
          pt(4410 / 12, 1830 / 12),
          anchorPt(end),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 48, 48, 48, 90, 90, 24];
      } else if (tag === "T-102") {
        const lane = T102_LANE_FT[service.id];
        const approachY = T102_APPROACH_FT[service.id];
        const approachElev = T102_APPROACH_ELEV_IN[service.id];
        // D10-05: orthogonal fan (R1). Each service transits south
        // at its own eastern lane at the header tier, drops in a
        // vertical leg at the lane corner to its approach elevation,
        // runs WEST along its own approach row to its port's
        // meridian, drops to the 24-in port elevation in a vertical
        // leg at that corner, and runs NORTH into the port along
        // the face normal. Approach rows (156/159.9/164 ft) and
        // elevations (48/36/36 in) are staggered so no two runs
        // share a line at the same elevation where they cross.
        points = [
          pt(lane, yFt),
          pt(lane, yFt - 1),
          pt(lane, approachY),
          pt(lane, approachY),
          pt(anchorFt.x, approachY),
          pt(anchorFt.x, approachY),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, approachElev, approachElev, 24, 24];
      } else if (tag === "R-101" && service.id === "plant-water") {
        // Detour east around P-102, returning west at y=182 — clear of
        // the pump row and of the reactor feed line's own approach
        // along the vessel centerline (crossed, with a jog, at y=182).
        // Transit at header tier to clear process runs below.
        // D10-05: the drop from header tier to the 24-in port
        // elevation is a vertical leg at the (196, 182) corner
        // (duplicate plan point), not a slope along the y=182 lane.
        points = [
          pt(anchorFt.x, yFt),
          pt(anchorFt.x, yFt - 1),
          pt(anchorFt.x, 345),
          pt(196, 345),
          pt(196, 182),
          pt(196, 182),
          pt(anchorFt.x, 182),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, tier, tier, 24, 24, 24];
      } else if (tag === "T-101" && service.id === "plant-air") {
        // The plant-air port sits 10 in east of the column centerline —
        // its meridian passes through the downcomer ladder cage south
        // of the face, and every south approach to it threads the
        // cage's clearance box. The drop transits on a WEST lane and
        // runs east along y=155 ft, north of the cage, then turns
        // NORTH into the face along the port's own meridian — an
        // orthogonal approach along the face normal (R1), not the
        // diagonal stub the old route drew.
        // D10-05: the transit lane is x=264.17 ft (was 315.83 ft).
        // The old lane passed through the E-102 tube-out spur's swept
        // envelope (the spur runs east at y=2835.4 to x=3762, envelope
        // to x=3777); 315.83 ft cleared the envelope by 13 in but
        // landed on the T-101 bottoms-out spur (x=3790.66 in) and
        // crossed the bottoms/CW train legs at 8.04 in (needs 10.03
        // in). The lane at 3170 in runs west of the whole exchanger
        // train row and west of the V-102 liquid-out spur's envelope
        // (west edge 3199.54 in) and of the E-101 tube-in spur's
        // envelope (west edge 3183 in), clear of the tube-out
        // envelope, both bottoms-out spur envelopes, and the train
        // legs; the approach row moves north to y=1915 in, clear of
        // the plant-water spur's envelope top (1893 in) and of the
        // reactor-effluent leg at y=1900 in. The south approach to
        // the port does NOT run on the meridian from the approach
        // row: the downcomer ladder stands at (3840, 1884) ON the
        // meridian, its clearance box y 1868.5-1899.5, so a south
        // leg at x=3840 from y=1915 threads the cage and the build
        // throws ("downcomer level 1 access ladder is obstructed").
        // Instead the branch jogs south at x=3820 in (west of the
        // cage box, east of the water spur) to y=155 ft, runs east
        // at y=155 ft to the meridian — south of the cage box and
        // east of the water spur, so it blocks neither — then
        // south on the meridian to the port. The final south leg
        // (y 1848-1860) clears the cage box by 8.5 in.
        const laneFt = 3170 / 12;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, yFt - 1),
          pt(laneFt, 1915 / 12),
          pt(laneFt, 1915 / 12),
          pt(3820 / 12, 1915 / 12),
          pt(3820 / 12, 155),
          pt(anchorFt.x, 155),
          anchorPt(end),
        ];
        elevIn = [tier, tier, 18, 18, 24, 24, 24, 24, 24];
        tapXFt = laneFt;
      } else if (tag === "R-101" && service.id === "plant-air") {
        // D10-05: the plant-air port meridian (x=190 ft) is the
        // reactor feed line's own lane — the branch ran directly
        // under its 297.6-in leg for 120 in (0.000 in plan centers).
        // Transit 12 in east of the meridian at the header tier,
        // drop at y=port+36 in, run west at 24 in to the meridian,
        // then south into the port. The west leg sits 6 in north of
        // the spur's far end, so it blocks neither spur; the drop
        // riser blocks the east spur only, and the scorer takes the
        // clear west spur.
        const laneFt = anchorFt.x + 1;
        const turnYFt = anchorFt.y + 3;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, turnYFt),
          pt(laneFt, turnYFt),
          pt(anchorFt.x, turnYFt),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 24, 24, 24];
        tapXFt = laneFt;
      } else if (tag === "R-102" && service.id === "plant-water") {
        // D10-05: the plant-water port meridian (x=238.25 ft) crosses
        // the spent-catalyst east leg (y=2200 in, 10-in, z=30), and the
        // crossing jog's riser landed 7.81 in from the catalyst north
        // leg (needs 9.03 in). Transit 12 in west of the meridian at
        // the header tier — the crossing moves west, clear of the
        // north leg — drop at y=2185 in (10 in south of the catalyst
        // leg, 10 in north of the spur envelope top), run east at 24
        // in to the meridian, then south into the port. The approach
        // row sits north of both spur envelopes, so it blocks neither
        // spur; the drop riser stands north of the envelope too.
        const laneFt = anchorFt.x - 1;
        const approachYFt = 2185 / 12;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, approachYFt),
          pt(laneFt, approachYFt),
          pt(anchorFt.x, approachYFt),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 24, 24, 24];
        tapXFt = laneFt;
      } else if (tag === "R-102" && service.id === "plant-air") {
        // D10-05: the plant-air port meridian (x=245 ft) is the
        // combustion-air line's own lane — the branch ran directly
        // under its 30-in leg for 120 in (0.000 in plan centers).
        // Transit 12 in east of the meridian at the header tier,
        // drop at y=port+36 in, run west at 24 in to the meridian,
        // then south into the port. The west leg sits 6 in north of
        // the spur's far end, so it blocks neither spur; the drop
        // riser blocks the east spur only, and the scorer takes the
        // clear west spur.
        const laneFt = anchorFt.x + 1;
        const turnYFt = anchorFt.y + 3;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, turnYFt),
          pt(laneFt, turnYFt),
          pt(anchorFt.x, turnYFt),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 24, 24, 24];
        tapXFt = laneFt;
      } else if (tag === "V-101" && service.id === "plant-air") {
        // D10-05: the plant-air port meridian (x=330 ft) meets the
        // suction header's east end exactly — the branch crossed the
        // header end point and the junction logic read it as a tee
        // between different services. Transit 12 in east of the
        // meridian at the header tier, drop at y=port+36 in, run
        // west at 24 in to the meridian, then south into the port.
        // The west leg sits 6 in north of the spur's far end; the
        // drop riser blocks the east spur only, and the scorer takes
        // the clear west spur.
        const laneFt = anchorFt.x + 1;
        const turnYFt = anchorFt.y + 3;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, turnYFt),
          pt(laneFt, turnYFt),
          pt(anchorFt.x, turnYFt),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 24, 24, 24];
        tapXFt = laneFt;
      } else if (tag === "T-101" && service.id === "nitrogen") {
        // D10-05: the nitrogen port meridian (x=323.6 ft) runs through
        // the V-101 drum — the branch passed through its footprint
        // without connecting. Jog west around the drum at the 18-in
        // transit elevation (north leg at y=268.75 ft, west of the
        // drum's west edge; south leg at x=318.33 ft, west of the
        // drum and of the liquid-out / wet-gas-out spur envelopes),
        // then east at y=164 ft — south of the rack — and south to
        // the port. The south leg at x=3820 in clears the liquid-out
        // and wet-gas-out spur envelopes (west edges 3828/3825 in);
        // the north leg at y=3225 in clears the plant-water spur's
        // envelope top (3219 in). No leg runs along the rack.
        points = [
          pt(anchorFt.x, yFt),
          pt(anchorFt.x, yFt - 1),
          pt(anchorFt.x, yFt - 1),
          pt(anchorFt.x, 268.75),
          pt(3820 / 12, 268.75),
          pt(3820 / 12, 164),
          pt(anchorFt.x, 164),
          pt(anchorFt.x, 164),
          anchorPt(end),
        ];
        elevIn = [tier, tier, 18, 18, 18, 18, 18, 24, 24];
      } else if (tag === "V-102" && service.id === "plant-air") {
        // D10-05: the plant-air port meridian (x=270 ft) IS the
        // knockout-drum gas lane (8-in, z=30) — the branch's final
        // south leg ran on it for 120 in (6.000/4.800 in centers).
        // Transit 12 in east of the meridian at the header tier,
        // drop at y=port+36 in, run west at 24 in to the meridian,
        // then south into the port. The west leg sits 6 in north of
        // the spur's far end, so it blocks neither spur; the drop
        // riser blocks the east spur only, and the scorer takes the
        // clear west spur.
        const laneFt = anchorFt.x + 1;
        const turnYFt = anchorFt.y + 3;
        points = [
          pt(laneFt, yFt),
          pt(laneFt, yFt - 1),
          pt(laneFt, turnYFt),
          pt(laneFt, turnYFt),
          pt(anchorFt.x, turnYFt),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, 24, 24, 24];
        tapXFt = laneFt;
      } else {
        // T-101's utilities transit south at 18 in elevation — below the
        // process pipe rack (±26 in and up) — then rise to the port
        // elevation at the vessel (D668-003: vertical separation clears
        // the envelope where plan separation cannot).
        // Other vessels transit at header tier.
        // D10-05: every elevation change is a vertical leg at a
        // corner (duplicate plan point), never a slope along a plan
        // leg — the drop from the header tier (or from 18 in, for
        // T-101) to the 24-in port elevation happens at the corner
        // just before the port.
        const dropYFt = anchorFt.y + 10;
        if (tag === "T-101") {
          points = [
            pt(anchorFt.x, yFt),
            pt(anchorFt.x, yFt - 1),
            pt(anchorFt.x, yFt - 1),
            pt(anchorFt.x, dropYFt),
            pt(anchorFt.x, dropYFt),
            anchorPt(end),
          ];
          elevIn = [tier, tier, 18, 18, 24, 24];
        } else {
          points = [
            pt(anchorFt.x, yFt),
            pt(anchorFt.x, dropYFt),
            pt(anchorFt.x, dropYFt),
            anchorPt(end),
          ];
          elevIn = [tier, tier, 24, 24];
        }
      }
      next = addRun(next, systemIds, points, {
        diameterIn: service.sizeIn,
        service: `${service.label} to ${tag}`,
        systemName: service.label,
        utility: service.id,
        elevIn,
      });
      // PR668-001: the 2-in header to 1-in drop transition at the tap
      // gets its modeled reducer — a connected component with declared
      // sizes, in the catalog and every view.
      const tapXft = tag === "T-102" ? T102_LANE_FT[service.id] : (tapXFt ?? anchorFt.x);
      next = placeReducer(next, tapXft * FT, yFt * FT, {
        id: fccuId("reducer"),
        inletSizeIn: UTILITY_HEADER_DIAMETER_IN,
        outletSizeIn: service.sizeIn,
      });
    }
  }
  return next;
}

/** The firewater loop: corners of the underground main rectangle (ft). */
const FIREWATER_LOOP_FT = [
  [90, 90],
  [460, 90],
  [460, 410],
  [90, 410],
];

/** Point + outward unit normal (feet) at arc distance sFt along the loop. */
function firewaterLoopFrameAt(sFt) {
  const corners = FIREWATER_LOOP_FT.map(([x, y]) => ({ x, y }));
  const centroid = {
    x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
    y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
  };
  const edges = corners.map((c, i) => {
    const n = corners[(i + 1) % corners.length];
    return { from: c, to: n, len: Math.hypot(n.x - c.x, n.y - c.y) };
  });
  const total = edges.reduce((sum, e) => sum + e.len, 0);
  let s = ((sFt % total) + total) % total;
  for (const e of edges) {
    if (s <= e.len) {
      const t = e.len === 0 ? 0 : s / e.len;
      const x = e.from.x + (e.to.x - e.from.x) * t;
      const y = e.from.y + (e.to.y - e.from.y) * t;
      const dx = e.len === 0 ? 0 : (e.to.x - e.from.x) / e.len;
      const dy = e.len === 0 ? 0 : (e.to.y - e.from.y) / e.len;
      let nx = -dy;
      let ny = dx;
      if (nx * (x - centroid.x) + ny * (y - centroid.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      return { x, y, nx, ny };
    }
    s -= e.len;
  }
  return { x: corners[0].x, y: corners[0].y, nx: 0, ny: -1 };
}

/**
 * Firewater: an underground main looped around the unit (buried
 * centerline at −36 in, so it passes UNDER grade piping without
 * jogging), hydrants along it every 92 ft (inside the 100 ft maximum),
 * and fixed spray nozzles outside the unit boundary covering the
 * flammable vessels from at least 50 ft away.
 */
function addFirewater(design, systemIds) {
  // Sizing per Jason's pins: the loop main is 12-inch (header class);
  // hydrant branches are 6-inch; monitor take-offs step down to
  // 6-inch / 4-inch.
  let next = addRun(
    design,
    systemIds,
    [...FIREWATER_LOOP_FT.map(([x, y]) => pt(x, y)), pt(FIREWATER_LOOP_FT[0][0], FIREWATER_LOOP_FT[0][1])],
    {
      diameterIn: FIREWATER_MAIN_DIAMETER_IN,
      service: "Firewater main (underground)",
      systemName: "Firewater",
      utility: "firewater",
      elevationIn: -36,
    },
  );
  // The main is buried: mark it underground for the renderers.
  const mainId = next.pipes[next.pipes.length - 1].id;
  next = {
    ...next,
    pipes: next.pipes.map((r) => (r.id === mainId ? { ...r, underground: true } : r)),
  };
  // The network's designated source / boundary inlet: a short buried
  // stub west of the loop corner, junctioned onto the main — the
  // supply connection is modeled, not proximity.
  next = addRun(next, systemIds, [pt(82, 90), pt(90, 90)], {
    diameterIn: FIREWATER_MAIN_DIAMETER_IN,
    service: "Firewater source",
    systemName: "Firewater",
    utility: "firewater",
    elevationIn: -36,
    sourceOf: "firewater",
    // Enters at the plot boundary — a battery-limit inlet.
    openEnds: { start: "battery-limit" },
  });
  const sourceId = next.pipes[next.pipes.length - 1].id;
  next = {
    ...next,
    pipes: next.pipes.map((r) => (r.id === sourceId ? { ...r, underground: true } : r)),
  };
  // Hydrants every 92 ft of developed loop stationing (15 around the
  // 1380-ft loop, none on a corner), each body offset 6 ft outside
  // the main on its own 6-inch branch off the main, junctioned at the
  // tap — the standard hydrant connection.
  for (let i = 0; i < 15; i += 1) {
    const frame = firewaterLoopFrameAt(30 + i * 92);
    const tap = { x: frame.x * FT, y: frame.y * FT };
    const hydrantAt = {
      x: (frame.x + frame.nx * 6) * FT,
      y: (frame.y + frame.ny * 6) * FT,
    };
    // D10-05: the branch runs buried (-36 in) from the main to the
    // hydrant, then rises vertically AT the hydrant to its inlet at
    // grade (0 in) — a terminal riser (duplicate plan points, kept
    // by addPipeRun's elevation-aware dedupe), not a slope along the
    // 6-ft branch. The hydrant carries no anchor; the end connects
    // by the inlet reference the sample authors below.
    next = addRun(next, systemIds, [tap, hydrantAt, hydrantAt], {
      diameterIn: HYDRANT_BRANCH_DIAMETER_IN,
      service: `Fire hydrant FH-${i + 1} branch`,
      systemName: "Firewater",
      utility: "firewater",
      elevIn: [-36, -36, 0],
    });
    const branchId = next.pipes[next.pipes.length - 1].id;
    // PR668-001: the 12-in main to 6-in hydrant branch transition at
    // the tap gets its modeled reducer (Jason's planning default: 6
    // in on the hydrant connection — a planning default, not a code
    // citation).
    next = placeReducer(next, tap.x, tap.y, {
      id: fccuId("reducer"),
      inletSizeIn: FIREWATER_MAIN_DIAMETER_IN,
      outletSizeIn: HYDRANT_BRANCH_DIAMETER_IN,
    });
    next = placeSymbol(next, "piping", "fire-hydrant", hydrantAt.x, hydrantAt.y, { tag: `FH-${i + 1}` });
    const hydrant = instanceByTag(next, `FH-${i + 1}`);
    next = {
      ...next,
      symbols: next.symbols.map((s) =>
        s.id === hydrant.id
          ? {
              ...s,
              stationRunId: mainId,
              // D10-05: the hydrant carries no anchor, so the branch
              // end is AUTHORED as its inlet connection (same F3
              // pattern as the spray assemblies) — the end connects
              // by this reference, never proximity.
              inletRunId: branchId,
              inletEnd: "end",
              inletSizeIn: HYDRANT_BRANCH_DIAMETER_IN,
            }
          : s,
      ),
    };
  }
  const sprays = [
    ["FA-101", "R-101", 190, 55],
    ["FA-102", "T-101", 455, 150],
    ["FA-103", "V-101", 330, 405],
    ["FA-104", "V-102", 270, 405],
  ];
  for (const [tag, targetTag, xFt, yFt] of sprays) {
    next = placeSymbol(next, "piping", "spray-nozzle", xFt * FT, yFt * FT, { tag });
    const spray = instanceByTag(next, tag);
    const target = instanceByTag(next, targetTag);
    next = {
      ...next,
      symbols: next.symbols.map((s) =>
        s.id === spray.id
          ? { ...s, protects: target.id, aimAt: { x: target.x, y: target.y } }
          : s,
      ),
    };
  }
  // Monitor take-offs: a stepped-down branch off the main to each
  // directed-spray assembly — 6-inch to FA-101/FA-102, 4-inch to
  // FA-103/FA-104 — junctioned onto the main at the tap.
  const takeoffs = [
    ["FA-101", { x: 190, y: 90 }, 6],
    ["FA-102", { x: 460, y: 150 }, 6],
    ["FA-103", { x: 330, y: 410 }, 4],
    ["FA-104", { x: 270, y: 410 }, 4],
  ];
  for (const [tag, tapFt, diameterIn] of takeoffs) {
    const spray = instanceByTag(next, tag);
    next = addRun(next, systemIds, [pt(tapFt.x, tapFt.y), { x: spray.x, y: spray.y }], {
      diameterIn,
      service: `Firewater take-off to ${tag}`,
      systemName: "Firewater",
      utility: "firewater",
    });
    const takeoffId = next.pipes[next.pipes.length - 1].id;
    // Buried at the tap and along the leg to the assembly's plan
    // position, then a zero-plan-length vertical riser vertex
    // (duplicate plan point, per-vertex elevation) up to the
    // assembly's inlet elevation (0 in) — the modeled riser R6
    // requires, with the terminal segment itself vertical (F4.1: a
    // single segment rising over the whole plan run is a sloped
    // terminal, not a riser).
    next = {
      ...next,
      pipes: next.pipes.map((r) =>
        r.id === takeoffId
          ? {
              ...r,
              points: [
                pt(tapFt.x, tapFt.y),
                { x: spray.x, y: spray.y },
                { x: spray.x, y: spray.y },
              ],
              elevIn: [-36, -36, 0],
            }
          : r,
      ),
    };
    // F3: the take-off end is AUTHORED as the assembly's inlet
    // connection (inletRunId/inletEnd + the assembly's inlet size) —
    // supply is verified against that reference, never proximity.
    next = {
      ...next,
      symbols: next.symbols.map((s) =>
        s.id === spray.id
          ? { ...s, inletRunId: takeoffId, inletEnd: "end", inletSizeIn: diameterIn }
          : s,
      ),
    };
    // PR668-001: the 12-in main to 6/4-in monitor take-off transition
    // at the tap gets its modeled reducer.
    next = placeReducer(next, tapFt.x * FT, tapFt.y * FT, {
      id: fccuId("reducer"),
      inletSizeIn: FIREWATER_MAIN_DIAMETER_IN,
      outletSizeIn: diameterIn,
    });
  }
  return next;
}

/** Highly flammable designations for the fire-protection fixture. */
function configureFireProtection(design) {
  const flammable = new Set(["R-101", "T-101", "V-101", "V-102"]);
  return {
    ...design,
    symbols: design.symbols.map((s) =>
      flammable.has(s.tag) ? { ...s, flammable: true } : s,
    ),
  };
}

/**
 * R2 approach alignment for the fixture: a run end attached to a
 * non-vertical equipment face must travel along the face normal for
 * its final approach (the compatibility check enforces a 20 deg
 * cone). The fixture's grid routing turns corners at right angles,
 * which leaves many ends entering their faces diagonally; this pass
 * inserts a short stub point on the normal ray just outside the face
 * so the final segment IS the normal approach. The endpoint itself
 * never moves. When the run carries per-vertex elevations, the stub
 * vertex is pinned to the elevation the original segment has at the
 * stub's plan position (interpolated on the shared physical route) —
 * an unpinned stub vertex would read the far segment's elevation and
 * drop the approach from nozzle elevation to grade across the stub.
 */
const APPROACH_STUB_MAX_IN = 14;
function alignApproachStubs(design) {
  let next = design;
  const changedIds = [];
  const cosTol = Math.cos((20 * Math.PI) / 180);
  for (const run of [...(next.pipes || [])]) {
    for (const endName of ["start", "end"]) {
      const att = run.attachments?.[endName];
      if (!att) continue;
      const current = (next.pipes || []).find((r) => r.id === run.id);
      if (!current) continue;
      const inst = (next.symbols || []).find((s) => s.id === att.symbolId);
      if (!inst) continue;
      const symbol = findSymbol(inst.domain, inst.symbolId);
      if (!symbol) continue;
      const face = connectionFaceForAnchor(symbol, inst, att.anchorId);
      if (!face || !face.normal || face.vertical) continue;
      const pts = current.points || [];
      if (pts.length < 2) continue;
      const idx = endName === "start" ? 0 : pts.length - 1;
      const endPt = pts[idx];
      const neighbor = pts[endName === "start" ? 1 : pts.length - 2];
      const segLen = Math.hypot(neighbor.x - endPt.x, neighbor.y - endPt.y);
      if (!(segLen >= 12)) continue;
      const travelDot =
        ((endPt.x - neighbor.x) / segLen) * face.normal.x +
        ((endPt.y - neighbor.y) / segLen) * face.normal.y;
      if (travelDot <= -cosTol) continue; // already a normal approach
      const stubLen = Math.min(APPROACH_STUB_MAX_IN, segLen * 0.5);
      if (stubLen < 6) continue;
      const stub = {
        x: face.x + face.normal.x * stubLen,
        y: face.y + face.normal.y * stubLen,
      };
      const insertAt = endName === "start" ? 1 : pts.length - 1;
      const points = [...pts.slice(0, insertAt), stub, ...pts.slice(insertAt)];
      let elevIn = current.elevIn;
      if (Array.isArray(elevIn)) {
        const route = physicalRouteIn(next, current);
        const zA = route[idx]?.zIn;
        const zB = route[endName === "start" ? 1 : route.length - 2]?.zIn;
        const zStub =
          Number.isFinite(zA) && Number.isFinite(zB)
            ? zA + (zB - zA) * (stubLen / segLen)
            : null;
        elevIn = [...elevIn.slice(0, insertAt), zStub, ...elevIn.slice(insertAt)];
      }
      next = {
        ...next,
        pipes: next.pipes.map((r) => (r.id === current.id ? { ...r, points, elevIn } : r)),
      };
      if (!changedIds.includes(current.id)) changedIds.push(current.id);
    }
  }
  return { design: next, changedIds };
}

// ---- D10-05 programmatic authoring pass -----------------------------------
//
// applyD10SampleData authors the D10-01/02/03 evidence on the built
// sample (route classification, support schedule, access) and switches
// the sample to industrial mode so validateDesign enforces it. It runs
// at the END of buildPlotDesign, after the stub/jog/junction/reducer
// passes, so the authored stations sit on final geometry. It changes
// no geometry, no pipe ids, and no V-101 head-nozzle schedule.
//
// Adopted numbers (module tables / the D10-05 brief — nothing invented):
// - span maxima: SUPPORT_SPAN_TABLE_IN via maxSpanInFor.
// - riser guide intervals: RISER_GUIDE_PROFILE_IN via
//   riserGuideIntervalInFor. Sizes above 10 in use the D10-06
//   Ruling 1 named cap profile (conservative-10in-guide-cap-v1,
//   660 in), explicitly selected and persisted on the run, so legs
//   on >10-in runs get guides at the cap interval instead of the
//   pre-D10-06 GUIDE_NOT_SCHEDULED findings (39 legs).
// - pipe ODs: the standard table below. pipeOdIn(24) snaps to 16 (its
//   table ends at 16), so the 24-in OD is authored as 24 — the
//   standard OD for 24-in pipe — never the snapped 16, which the
//   spacing rule would reject as below nominal bore.
// - rack reserve on PR-101: 24 in of spare width (travel lines use
//   188.6875 in of the 288-in rack; 24 in fits with room to spare).
// - crossover clearance above pipes: 6 in.
// - walkway profile: the module baseline (30 in wide, 84 in headroom).
//   Access nodes stand 15.4 in from their face/pipe, so a 30-in spur
//   envelope clears the pipe by 0.4 in; spur sides are chosen by
//   scoring candidates against the real pipe/footprint/barrier
//   geometry (d10BestSpur), never by hand placement.

const D10_OD_IN = Object.freeze({
  1: 1.315,
  2: 2.375,
  4: 4.5,
  6: 6.625,
  8: 8.625,
  10: 10.75,
  12: 12.75,
  16: 16,
  24: 24,
});
const D10_VAPOR_SYSTEMS = new Set(["Wet gas", "Flue gas", "Relief", "Combustion air"]);
const D10_VAPOR_SERVICE_RE = /vapor|gas|air|relief|flare/i;
const D10_NODE_OFFSET_IN = 15.4;
const D10_SPUR_LEN_IN = 30;
/** Entry isolation: attachPoint takes the FIRST path within 15.5 in,
 *  so a spur entry must sit a margin clear of every other path. */
const D10_ENTRY_ISOLATION_IN = 15.75;
const D10_LADDER_MAX_IN = 360;
const D10_RACK_RESERVE_IN = 24;
const D10_CROSSOVER_CLEARANCE_IN = 6;
const D10_EPS = 1e-6;

function d10IsVapor(design, run) {
  const system = (design?.systems || []).find((s) => s.id === run?.systemId);
  if (system && D10_VAPOR_SYSTEMS.has(system.name)) return true;
  return D10_VAPOR_SERVICE_RE.test(run?.service || "");
}

function d10CarrierAt(prFoot, slFoot, prId, slId, point) {
  if (prFoot && pointInRackFootprint(prFoot, point)) {
    return { kind: "rack-bent", rackId: prId, tier: 1 };
  }
  if (slFoot && pointInRackFootprint(slFoot, point)) {
    return { kind: "sleeper", rackId: slId, tier: 1 };
  }
  return { kind: "foundation" };
}

/**
 * Route-interval classification for one run. Travel is every
 * along-rack leg portion inside the PR-101 footprint (merged across
 * crossing-jog risers on the same lane); buried is every fully-buried
 * leg; a short run between two different equipment faces with no
 * travel/buried leg and at most 6 authored points is one
 * SHORT_INTERCONNECT; an open stretch from a rack exit to an attached
 * equipment end is EQUIPMENT_APPROACH; everything else is
 * PLOT_CONNECTION on the run's service string.
 */
function d10RouteIntervals(design, run, ctx) {
  const { stations, totalIn, route } = routeStations(design, run);
  const { prId, prFoot } = ctx;
  // Travel portions: E-W legs whose midpoint sits inside the PR
  // footprint, clipped to the footprint's along-range.
  const travelParts = [];
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    if (Math.abs(a.y - b.y) > D10_EPS) continue;
    const mid = { x: (a.x + b.x) / 2, y: a.y };
    if (!pointInRackFootprint(prFoot, mid)) continue;
    const lo = Math.max(Math.min(a.x, b.x), prFoot.cx - prFoot.halfL);
    const hi = Math.min(Math.max(a.x, b.x), prFoot.cx + prFoot.halfL);
    if (hi - lo <= D10_EPS) continue;
    const sAt = (x) =>
      stations[i].stationIn +
      ((x - a.x) / (b.x - a.x)) * (stations[i + 1].stationIn - stations[i].stationIn);
    const s0 = sAt(lo);
    const s1 = sAt(hi);
    travelParts.push({
      from: Math.min(s0, s1),
      to: Math.max(s0, s1),
      offset: a.y - prFoot.cy,
    });
  }
  // Merge contiguous travel portions, including across crossing-jog
  // risers on the same lane (the jog vertices sit at the lane offset
  // inside the footprint, so the merged interval still samples
  // on-lane). A gap whose boundary vertices leave the lane does not
  // merge — the stretch between is a real open run.
  travelParts.sort((p, q) => p.from - q.from);
  const travel = [];
  for (const part of travelParts) {
    const last = travel[travel.length - 1];
    if (last && Math.abs(last.offset - part.offset) <= D10_EPS) {
      const gapVerts = stations.filter(
        (s) => s.stationIn >= last.to - D10_EPS && s.stationIn <= part.from + D10_EPS,
      );
      const gapOk =
        part.from - last.to <= D10_EPS ||
        gapVerts.every(
          (s) =>
            pointInRackFootprint(prFoot, s.point) &&
            Math.abs(s.point.y - prFoot.cy - part.offset) <= 0.5,
        );
      if (gapOk && (part.from - last.to <= 1e-9 || gapVerts.length > 0)) {
        last.to = Math.max(last.to, part.to);
        continue;
      }
    }
    travel.push({ ...part });
  }
  // Buried portions: fully-buried legs, merged when contiguous.
  const buriedParts = [];
  for (let i = 0; i + 1 < route.length; i += 1) {
    if (route[i].zIn < 0 && route[i + 1].zIn < 0) {
      buriedParts.push({ from: stations[i].stationIn, to: stations[i + 1].stationIn });
    }
  }
  const buried = [];
  for (const part of buriedParts.sort((a, b) => a.from - b.from)) {
    const last = buried[buried.length - 1];
    if (last && part.from - last.to <= D10_EPS) last.to = part.to;
    else buried.push({ ...part });
  }
  // Short interconnect: both ends on different equipment, no travel
  // or buried leg, at most 6 authored points.
  const att = run.attachments || {};
  const bothAttachedDifferent =
    att.start?.symbolId && att.end?.symbolId && att.start.symbolId !== att.end.symbolId;
  const pointCount = Array.isArray(run.points) ? run.points.length : 0;
  if (travel.length === 0 && buried.length === 0 && bothAttachedDifferent && pointCount <= 6) {
    return [
      {
        role: "SHORT_INTERCONNECT",
        fromStationIn: 0,
        toStationIn: totalIn,
        basis: run.service || "short interconnect",
      },
    ];
  }
  const cuts = new Set([0, totalIn]);
  for (const t of travel) {
    cuts.add(t.from);
    cuts.add(t.to);
  }
  for (const b of buried) {
    cuts.add(b.from);
    cuts.add(b.to);
  }
  const bounds = [...cuts].sort((a, b) => a - b);
  const intervals = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (to - from <= D10_EPS) continue;
    const mid = (from + to) / 2;
    const trav = travel.find((t) => mid > t.from - D10_EPS && mid < t.to + D10_EPS);
    if (trav) {
      intervals.push({
        role: "RACK_TRAVEL",
        fromStationIn: from,
        toStationIn: to,
        rackId: prId,
        tier: 1,
        rackOffsetIn: trav.offset,
      });
      continue;
    }
    const bur = buried.find((b) => mid > b.from - D10_EPS && mid < b.to + D10_EPS);
    if (bur) {
      intervals.push({ role: "BURIED_FIREWATER", fromStationIn: from, toStationIn: to });
      continue;
    }
    const atStart = Math.abs(from) <= D10_EPS;
    const atEnd = Math.abs(to - totalIn) <= D10_EPS;
    const touchesTravel = travel.some(
      (t) => Math.abs(t.from - to) <= D10_EPS || Math.abs(t.to - from) <= D10_EPS,
    );
    let equipId = null;
    if (touchesTravel) {
      if (atStart && att.start?.symbolId) equipId = att.start.symbolId;
      else if (atEnd && att.end?.symbolId) equipId = att.end.symbolId;
    }
    if (equipId) {
      intervals.push({
        role: "EQUIPMENT_APPROACH",
        fromStationIn: from,
        toStationIn: to,
        rackId: prId,
        equipmentId: equipId,
      });
    } else {
      intervals.push({
        role: "PLOT_CONNECTION",
        fromStationIn: from,
        toStationIn: to,
        basis: run.service || "plot connection",
      });
    }
  }
  return intervals;
}

/**
 * Full D10-02 authoring for one run: flexibility, span profile,
 * route intervals, transition + riser + intermediate supports,
 * nozzle supports, riser guides (+ one travel guide per rack-travel
 * run), spacing data, structure clearance.
 */
function d10AuthorRun(design, run, ctx) {
  const { stations, totalIn, route } = routeStations(design, run);
  const sizeIn = run.diameterIn;
  const vapor = d10IsVapor(design, run);
  // D10-06 Ruling 1: >10-in runs (through 24 in) select the named
  // conservative cap profile, persisted on the run so the validator
  // resolves the 660-in guide interval with cap provenance.
  const guideProfile = sizeIn > 10 ? RISER_GUIDE_CAP_PROFILE : undefined;
  const maxSpan = maxSpanInFor(sizeIn);
  const transitions = transitionVertices(design, run);
  const vlegs = verticalLegs(design, run);
  const { prId, slId, prFoot, slFoot } = ctx;
  const carrierAt = (pt) => d10CarrierAt(prFoot, slFoot, prId, slId, pt);
  let seq = 0;
  const supports = [];
  const addSupport = (s) => {
    seq += 1;
    const record = { id: `${run.id}-sup-${seq}`, ...s };
    supports.push(record);
    return record;
  };
  const riserByFromVertex = new Map(vlegs.map((l) => [l.fromVertex, l]));
  // Transition supports; where a riser starts at the transition
  // vertex the one support carries both bindings.
  for (const t of transitions) {
    const station = stations[t.vertexIndex].stationIn;
    const point = route[t.vertexIndex];
    const leg = riserByFromVertex.get(t.vertexIndex);
    if (leg) {
      addSupport({
        type: "riser-support",
        stationIn: station,
        transitionIndex: t.vertexIndex,
        verticalLegIndex: leg.legIndex,
        maxSupportedLengthIn: leg.lengthIn,
        carrier: carrierAt(point),
      });
    } else {
      addSupport({
        type: "dummy-leg",
        stationIn: station,
        transitionIndex: t.vertexIndex,
        carrier: carrierAt(point),
      });
    }
  }
  // Riser supports for legs starting at a vertex with no transition
  // support (the run-start riser at vertex 0).
  const coveredFrom = new Set(supports.filter((s) => s.transitionIndex !== undefined).map((s) => s.transitionIndex));
  for (const leg of vlegs) {
    if (coveredFrom.has(leg.fromVertex)) continue;
    addSupport({
      type: "riser-support",
      stationIn: leg.fromStationIn,
      verticalLegIndex: leg.legIndex,
      maxSupportedLengthIn: leg.lengthIn,
      carrier: carrierAt(route[leg.fromVertex]),
    });
  }
  // Intermediate span supports subdividing every gap over the size
  // maximum into equal parts. A subdivision point on a vertical leg
  // is a riser support for that leg; elsewhere a stanchion.
  const breaks = [0, ...supports.map((s) => s.stationIn), totalIn].sort((a, b) => a - b);
  const extras = [];
  for (let i = 0; i + 1 < breaks.length; i += 1) {
    const from = breaks[i];
    const to = breaks[i + 1];
    const gap = to - from;
    if (gap <= maxSpan + 1e-9) continue;
    const n = Math.ceil(gap / maxSpan);
    for (let k = 1; k < n; k += 1) extras.push(from + (gap * k) / n);
  }
  for (const st of extras) {
    const point = pointAtStation(route, st);
    const leg = vlegs.find((l) => st > l.fromStationIn + D10_EPS && st < l.toStationIn - D10_EPS);
    if (leg) {
      addSupport({
        type: "riser-support",
        stationIn: st,
        verticalLegIndex: leg.legIndex,
        maxSupportedLengthIn: leg.lengthIn,
        carrier: carrierAt(point),
      });
    } else {
      addSupport({ type: "stanchion", stationIn: st, carrier: carrierAt(point) });
    }
  }
  // No run is self-supporting: a run with no scheduled support yet
  // (short straight runs) gets one at mid-station.
  if (supports.length === 0) {
    const st = totalIn / 2;
    addSupport({ type: "stanchion", stationIn: st, carrier: carrierAt(pointAtStation(route, st)) });
  }
  // Nozzle supports: the actual first / last weight contacts.
  const ordered = [...supports].sort((a, b) => a.stationIn - b.stationIn);
  const nozzleSupports = {};
  if (run.attachments?.start) nozzleSupports.start = { supportId: ordered[0].id };
  if (run.attachments?.end) nozzleSupports.end = { supportId: ordered[ordered.length - 1].id };
  // Guides: one or more per vertical leg at the adopted interval
  // (>10-in runs resolve the interval through the named cap profile
  // selected above, so every vertical leg gets its guide).
  const restraints = [];
  const guideInterval = riserGuideIntervalInFor(sizeIn, { guideProfile });
  if (guideInterval !== null) {
    for (const leg of vlegs) {
      const count = Math.max(1, Math.ceil(leg.lengthIn / guideInterval) - 1);
      for (let k = 1; k <= count; k += 1) {
        const st = leg.fromStationIn + (leg.lengthIn * k) / (count + 1);
        restraints.push({ type: "guide", stationIn: st, carrier: carrierAt(pointAtStation(route, st)) });
      }
    }
  }
  // One guide per rack-travel run, on the travel leg.
  const intervals = d10RouteIntervals(design, run, ctx);
  const travelIv = intervals.find((iv) => iv.role === "RACK_TRAVEL");
  if (travelIv) {
    let st = (travelIv.fromStationIn + travelIv.toStationIn) / 2;
    // Keep the travel guide off any vertical leg (crossing jogs),
    // staying inside the travel interval when a jog sits at its edge.
    for (const leg of vlegs) {
      if (st > leg.fromStationIn - D10_EPS && st < leg.toStationIn + D10_EPS) {
        const before = leg.fromStationIn - 1;
        const after = leg.toStationIn + 1;
        if (before >= travelIv.fromStationIn) st = before;
        else if (after <= travelIv.toStationIn) st = after;
      }
    }
    restraints.push({
      type: "guide",
      stationIn: st,
      carrier: { kind: "rack-bent", rackId: prId, tier: 1 },
    });
  }
  return {
    ...run,
    flexibility: { required: false },
    spanProfile: {
      nominalSizeIn: sizeIn,
      material: "carbon-steel",
      fluid: vapor ? "vapor" : "water",
      basis: vapor ? "vapor-conservative-baseline" : "water-filled-standard-steel",
    },
    routeIntervals: intervals,
    supports,
    restraints,
    nozzleSupports,
    spacingProfile: "ordinary",
    ...(guideProfile ? { guideProfile } : {}),
    outsideDiameterIn: D10_OD_IN[sizeIn] ?? sizeIn,
    insulationIn: 0,
    expansionAllowanceIn: 0,
    structureClearance: { applies: false },
  };
}

// ---- access authoring ------------------------------------------------------
//
// The walk checks in pipeAccess are plan-geometry checks: a pipe leg
// obstructs a path when its centreline enters the path's swept
// envelope with z in [0, 84]; a footprint obstructs when the envelope
// overlaps it; a rack column obstructs within half-width + half its
// size; a barrier obstructs unless a usable crossover covers the
// crossing. The scorer below (d10SegmentClearance) mirrors those
// checks exactly, so spur and landing-path placement is decided by
// the same geometry the validator reads — nothing is placed by eye.
//
// A nozzle node stands 15.4 in from its face, beside the pipe's exit
// leg, on a 30-in spur running alongside that leg: the 30-in envelope
// (half-width 15) then clears the exit leg by 0.4 in. The spur side
// is chosen by scoring both sides against the real geometry. Faces
// over 360 in get staged climbs: climb nodes at each 360-in stage
// (standing on the platform at that stage, ladder to the next) plus
// the subject node standing at the top stage with a ladder to the
// face. Platforms are unnamed records ({elevationIn} only), so they
// apply to any node.

function d10DistPointSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function d10Orient(p, q, r) {
  const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(v) <= 1e-12) return 0;
  return v > 0 ? 1 : -1;
}

function d10OnSeg(p, q, r) {
  return (
    q.x >= Math.min(p.x, r.x) - 1e-9 &&
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    q.y >= Math.min(p.y, r.y) - 1e-9 &&
    q.y <= Math.max(p.y, r.y) + 1e-9
  );
}

function d10SegsIntersect(a, b, c, d) {
  const o1 = d10Orient(a, b, c);
  const o2 = d10Orient(a, b, d);
  const o3 = d10Orient(c, d, a);
  const o4 = d10Orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && d10OnSeg(a, c, b)) return true;
  if (o2 === 0 && d10OnSeg(a, d, b)) return true;
  if (o3 === 0 && d10OnSeg(c, a, d)) return true;
  if (o4 === 0 && d10OnSeg(c, b, d)) return true;
  return false;
}

function d10SegSegDist(a, b, c, d) {
  if (d10SegsIntersect(a, b, c, d)) return 0;
  return Math.min(
    d10DistPointSeg(a, c, d),
    d10DistPointSeg(b, c, d),
    d10DistPointSeg(c, a, b),
    d10DistPointSeg(d, a, b),
  );
}

/** Largest interval gap between a segment's AABB and a rect's AABB. */
function d10SegAabbGap(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return Math.max(
    rect.minX - maxX,
    minX - rect.maxX,
    rect.minY - maxY,
    minY - rect.maxY,
  );
}

function d10AabbOf(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function d10Centroid(points) {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

/** Liang-Barsky clip of segment a-b against an AABB; [t0, t1] or null. */
function d10ClipSegToRect(a, b, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ps = [-dx, dx, -dy, dy];
  const qs = [a.x - rect.minX, rect.maxX - a.x, a.y - rect.minY, rect.maxY - a.y];
  for (let i = 0; i < 4; i += 1) {
    const p = ps[i];
    const q = qs[i];
    if (Math.abs(p) <= D10_EPS) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

const D10_CARDINALS = Object.freeze([
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]);

/**
 * Uniform-grid index over the pipe legs that can obstruct a walkway
 * (z-range overlapping [0, 84]). A candidate segment only ever
 * interacts with legs whose AABB sits within 15 in of its own, so
 * each clearance check tests dozens of legs instead of ~1000. Legs
 * are registered in the cells their AABB (expanded by 17 in) touches
 * — the extra inch over the 15-in envelope keeps a leg whose gap is
 * exactly 15 in (obstructed, boundary-inclusive) from falling
 * through a cell boundary.
 */
const D10_LEG_CELL_IN = 256;

function d10LegGrid(legs) {
  const grid = new Map();
  for (let idx = 0; idx < legs.length; idx += 1) {
    const leg = legs[idx];
    if (leg.zMax < -1e-9 || leg.zMin > 84 + 1e-9) continue;
    const minX = Math.min(leg.a.x, leg.b.x) - 17;
    const maxX = Math.max(leg.a.x, leg.b.x) + 17;
    const minY = Math.min(leg.a.y, leg.b.y) - 17;
    const maxY = Math.max(leg.a.y, leg.b.y) + 17;
    for (let cx = Math.floor(minX / D10_LEG_CELL_IN); cx <= Math.floor(maxX / D10_LEG_CELL_IN); cx += 1) {
      for (let cy = Math.floor(minY / D10_LEG_CELL_IN); cy <= Math.floor(maxY / D10_LEG_CELL_IN); cy += 1) {
        const key = `${cx},${cy}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(idx);
      }
    }
  }
  return grid;
}

function d10LegsNear(ctx, env) {
  ctx.legQuery += 1;
  const out = [];
  const { legGrid } = ctx;
  for (let cx = Math.floor(env.minX / D10_LEG_CELL_IN); cx <= Math.floor(env.maxX / D10_LEG_CELL_IN); cx += 1) {
    for (let cy = Math.floor(env.minY / D10_LEG_CELL_IN); cy <= Math.floor(env.maxY / D10_LEG_CELL_IN); cy += 1) {
      const bucket = legGrid.get(`${cx},${cy}`);
      if (!bucket) continue;
      for (const idx of bucket) {
        if (ctx.legMark[idx] !== ctx.legQuery) {
          ctx.legMark[idx] = ctx.legQuery;
          out.push(ctx.legs[idx]);
        }
      }
    }
  }
  return out;
}

/**
 * Obstruction context for the scorer: pipe legs (3D), equipment
 * footprints (AABBs; the barrier rack is owned by the barrier check,
 * not the footprint check), pipe-rack columns, barrier rects with
 * their planned crossover coverage, and the barrier source runs
 * (their legs are checked as barrier rects, never as pipes).
 */
function d10AccessContext(design, slId) {
  const legs = [];
  for (const run of design.pipes || []) {
    const route = physicalRouteIn(design, run);
    for (let i = 0; i + 1 < route.length; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      legs.push({
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        za: a.zIn,
        zb: b.zIn,
        zMin: Math.min(a.zIn, b.zIn),
        zMax: Math.max(a.zIn, b.zIn),
        runId: run.id,
      });
    }
  }
  const footprints = [];
  for (const inst of design.symbols || []) {
    if (inst.id === slId) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) continue;
    const corners = deckCorners({
      cx: inst.x,
      cy: inst.y,
      angleDeg: inst.rotationDeg || 0,
      widthIn: inst.depthIn ?? symbol.depthIn ?? 0,
      depthIn: inst.widthIn ?? symbol.widthIn ?? 0,
    });
    footprints.push({ id: inst.id, ...d10AabbOf(corners) });
  }
  const columns = [];
  for (const inst of design.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.rack || symbol.rack.kind !== "pipe") continue;
    columns.push(...rackColumnWorldPositions(design, inst.id));
  }
  return {
    legs,
    footprints,
    columns,
    barriers: [],
    sourceRuns: new Set(),
    legGrid: d10LegGrid(legs),
    legMark: new Uint32Array(legs.length),
    legQuery: 0,
  };
}

/**
 * Whether a usable planned crossover covers a segment's crossing of
 * a barrier — the module's crossoverCoversPoint, against planned
 * (preview) stations instead of authored crossovers.
 */
function d10BarrierCovered(barrier, a, b) {
  const clipped = d10ClipSegToRect(a, b, barrier.rect);
  let cross;
  if (clipped) {
    const t = clipped[0];
    cross = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  } else {
    const c = barrier.center;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    cross = { x: a.x + t * dx, y: a.y + t * dy };
  }
  const station =
    (cross.x - barrier.origin.x) * barrier.axis.x +
    (cross.y - barrier.origin.y) * barrier.axis.y;
  return barrier.stations.some((s) => Math.abs(station - s) <= barrier.halfCover);
}

/**
 * Minimum clearance (in) of a candidate walk segment against every
 * obstruction the module checks. Positive clears; zero or negative
 * obstructs. The 15 in is the walkway half-width — the swept
 * envelope. Barrier crossings covered by a planned crossover do
 * not obstruct.
 */
function d10SegmentClearance(ctx, a, b, ownSymbolId, skipOwnFootprint = true) {
  let clear = Infinity;
  const segBox = d10AabbOf([a, b]);
  const env = {
    minX: segBox.minX - 15,
    maxX: segBox.maxX + 15,
    minY: segBox.minY - 15,
    maxY: segBox.maxY + 15,
  };
  for (const leg of d10LegsNear(ctx, env)) {
    if (ctx.sourceRuns.has(leg.runId)) continue;
    if (leg.zMax < -1e-9 || leg.zMin > 84 + 1e-9) continue;
    const clipped = d10ClipSegToRect(leg.a, leg.b, env);
    if (clipped) {
      const zA = leg.za + (leg.zb - leg.za) * clipped[0];
      const zB = leg.za + (leg.zb - leg.za) * clipped[1];
      if (Math.max(zA, zB) >= -1e-9 && Math.min(zA, zB) <= 84 + 1e-9) {
        clear = Math.min(clear, -0.5);
        continue;
      }
    }
    const margin = Math.min(
      d10SegSegDist(a, b, leg.a, leg.b) - 15,
      d10SegAabbGap(leg.a, leg.b, segBox) - 15,
    );
    if (margin < clear) clear = margin;
  }
  for (const fp of ctx.footprints) {
    // The module exempts a node's own footprint only on a segment
    // that has the node at an endpoint — a dogleg segment past the
    // far end gets no exemption, so it must clear the own footprint
    // too (skipOwnFootprint=false for those segments).
    if (skipOwnFootprint && fp.id === ownSymbolId) continue;
    const margin = d10SegAabbGap(a, b, fp) - 15;
    if (margin < clear) clear = margin;
  }
  for (const bar of ctx.barriers) {
    if (d10BarrierCovered(bar, a, b)) continue;
    const margin = d10SegAabbGap(a, b, bar.rect) - 15;
    if (margin < clear) clear = margin;
  }
  for (const col of ctx.columns) {
    const margin = d10DistPointSeg(col, a, b) - (15 + col.size / 2);
    if (margin < clear) clear = margin;
  }
  return clear;
}

/** First axis-aligned horizontal leg leaving an attached end. */
function d10ExitDirection(design, run, endName) {
  const route = physicalRouteIn(design, run);
  const n = route.length;
  const step = endName === "start" ? 1 : -1;
  let i = endName === "start" ? 0 : n - 1;
  for (;;) {
    const j = i + step;
    if (j < 0 || j >= n) return null;
    const a = route[i];
    const b = route[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = (b.zIn ?? 0) - (a.zIn ?? 0);
    if (Math.abs(dz) > D10_EPS || (Math.abs(dx) <= D10_EPS && Math.abs(dy) <= D10_EPS)) {
      i = j;
      continue;
    }
    if (Math.abs(dx) > D10_EPS && Math.abs(dy) > D10_EPS) {
      i = j; // diagonal approach stub: the next leg is the exit
      continue;
    }
    // One component is at most EPS (a floating-point residue on an
    // otherwise cardinal leg) — the exit axis is the dominant one.
    // A raw Math.sign here would return a diagonal for a leg like
    // dx=5e-7, dy=100, and the spur would run diagonally.
    if (Math.abs(dx) > Math.abs(dy)) return { x: Math.sign(dx), y: 0 };
    return { x: 0, y: Math.sign(dy) };
  }
}

/**
 * Best spur for a face point: the node stands 15.4 in from the face,
 * the spur runs 30 in OUTWARD alongside the pipe's exit leg to an
 * entry out in the plot. (The spur must run outward: a spur running
 * back from the node crosses the equipment's own pipe forest, and
 * the walk check only exempts the node's own footprint on a segment
 * the node itself touches.) With an exit direction only the two
 * sides are tried; without one (spare nozzle, manway) all four
 * directions are scored and the clearest wins.
 */
function d10BestSpur(ctx, face, exitDir, ownSymbolId) {
  const dirs = exitDir ? [exitDir] : D10_CARDINALS;
  let best = null;
  for (const dir of dirs) {
    const perp = { x: -dir.y, y: dir.x };
    for (const side of [1, -1]) {
      const node = {
        x: face.x + perp.x * side * D10_NODE_OFFSET_IN,
        y: face.y + perp.y * side * D10_NODE_OFFSET_IN,
      };
      const far = {
        x: node.x + dir.x * D10_SPUR_LEN_IN,
        y: node.y + dir.y * D10_SPUR_LEN_IN,
      };
      const clearance = d10SegmentClearance(ctx, node, far, ownSymbolId);
      if (!best || clearance > best.clearance) {
        best = { node, far, clearance, dir };
      }
    }
  }
  return best;
}

/** Best spur direction from a fixed standing point (removal nodes). */
function d10BestSpurFromPoint(ctx, point, ownSymbolId) {
  let best = null;
  for (const dir of D10_CARDINALS) {
    const far = {
      x: point.x + dir.x * D10_SPUR_LEN_IN,
      y: point.y + dir.y * D10_SPUR_LEN_IN,
    };
    const clearance = d10SegmentClearance(ctx, point, far, ownSymbolId);
    if (!best || clearance > best.clearance) {
      best = { node: point, far, clearance, dir };
    }
  }
  return best;
}

/**
 * Spur path for a face: reuse an existing spur when another face
 * already produced the same standing point in the same direction
 * (spare / downcomer faces share a face plane, so their spurs
 * coincide). Two identical spurs would steal each other's entries
 * (first-in-tolerance) and split the shared spur, breaking the
 * footprint exemption on its far half — one path, one entry, both
 * nodes on it. Returns the path id the node's pathId must name.
 */
function d10SpurPathFor(spurSpecs, paths, entries, best, ownSymbolId, base) {
  for (const spec of spurSpecs) {
    if (
      Math.abs(spec.node.x - best.node.x) < D10_EPS &&
      Math.abs(spec.node.y - best.node.y) < D10_EPS &&
      spec.dir.x === best.dir.x &&
      spec.dir.y === best.dir.y
    ) {
      return spec.pathId;
    }
  }
  const pathId = `path-${base}`;
  paths.push({ id: pathId, kind: "walk", points: [best.node, best.far] });
  entries.push({ id: `entry-${base}`, x: best.far.x, y: best.far.y });
  spurSpecs.push({
    pathId,
    entryId: `entry-${base}`,
    node: best.node,
    dir: best.dir,
    ownSymbolId,
  });
  return pathId;
}

/** Point-to-segment distance (plan, inches). */
function d10PointSegDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from a point to any segment of a path. */
function d10PointPathDist(p, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    best = Math.min(best, d10PointSegDist(p, points[i], points[i + 1]));
  }
  return best;
}

/** True when no path but the spur's own passes within attach
 *  tolerance of the entry — i.e. the entry attaches to its own spur. */
function d10EntryIsolated(entry, ownPathId, paths) {
  for (const path of paths) {
    if (path.id === ownPathId) continue;
    if (!Array.isArray(path.points) || path.points.length < 2) continue;
    if (d10PointPathDist(entry, path.points) <= D10_ENTRY_ISOLATION_IN) return false;
  }
  return true;
}

/**
 * Move a spur entry to a point clear of pipes/footprints and isolated
 * from every other path. Candidates, in order: the plain far end, a
 * dogleg either way at the far end (steps the entry sideways off a
 * parallel neighbour spur), a shorter spur (stops short of a crossing
 * landing path), a longer spur (runs past a neighbour spur's end),
 * and wider doglegs. Applies the first candidate whose segments are
 * scorer-clear and whose entry is isolated. Returns true on a move.
 */
function d10PlaceSpurEntry(actx, spec, path, entry, paths) {
  const { node, dir, ownSymbolId } = spec;
  const far = {
    x: node.x + dir.x * D10_SPUR_LEN_IN,
    y: node.y + dir.y * D10_SPUR_LEN_IN,
  };
  const perp = { x: -dir.y, y: dir.x };
  const at = (len) => ({ x: node.x + dir.x * len, y: node.y + dir.y * len });
  const dog = (d) => ({ x: far.x + perp.x * d, y: far.y + perp.y * d });
  const candidates = [
    { points: [node, far], entry: far },
    { points: [node, far, dog(20)], entry: dog(20) },
    { points: [node, far, dog(-20)], entry: dog(-20) },
    { points: [node, at(13)], entry: at(13) },
    { points: [node, at(45)], entry: at(45) },
    { points: [node, at(60)], entry: at(60) },
    { points: [node, at(20)], entry: at(20) },
    { points: [node, far, dog(40)], entry: dog(40) },
    { points: [node, far, dog(-40)], entry: dog(-40) },
  ];
  for (const cand of candidates) {
    if (
      cand.points.length === path.points.length &&
      cand.points.every(
        (pt, i) =>
          Math.abs(pt.x - path.points[i].x) < D10_EPS &&
          Math.abs(pt.y - path.points[i].y) < D10_EPS,
      )
    ) {
      continue;
    }
    let clear = true;
    for (let i = 0; i + 1 < cand.points.length; i += 1) {
      // Only the first segment has the node at an endpoint, so only
      // it gets the own-footprint exemption; a dogleg segment past
      // the far end must clear the node's own equipment too.
      const c = d10SegmentClearance(
        actx,
        cand.points[i],
        cand.points[i + 1],
        ownSymbolId,
        i === 0,
      );
      if (c <= 0.05) {
        clear = false;
        break;
      }
    }
    if (!clear) {
      continue;
    }
    let nearestDist = Infinity;
    for (const p of paths) {
      if (p.id === spec.pathId) continue;
      if (!Array.isArray(p.points) || p.points.length < 2) continue;
      nearestDist = Math.min(nearestDist, d10PointPathDist(cand.entry, p.points));
    }
    if (nearestDist <= D10_ENTRY_ISOLATION_IN) {
      continue;
    }
    path.points = cand.points;
    entry.x = cand.entry.x;
    entry.y = cand.entry.y;
    return true;
  }
  return false;
}

/**
 * Maximal clear interval around a centre station on the line
 * pointAt(s), extended 1 in at a time while the segment clears.
 * The seed is a 2-in interval: a clear stretch narrower than 30 in
 * (the SL-101 north landing at station 990 sits between two legs
 * 60 in apart) still has a usable path. Null when even the 2-in
 * seed around the centre is obstructed.
 */
function d10ExtendAlong(ctx, pointAt, centerStation, ownSymbolId) {
  const clear = (lo, hi) => d10SegmentClearance(ctx, pointAt(lo), pointAt(hi), ownSymbolId);
  let lo = centerStation - 1;
  let hi = centerStation + 1;
  if (!(clear(lo, hi) > 0.05)) return null;
  while (clear(lo - 1, hi) > 0.05) lo -= 1;
  while (clear(lo, hi + 1) > 0.05) hi += 1;
  return { lo, hi, a: pointAt(lo), b: pointAt(hi) };
}

/** One-sided extension from t = 0 outward; null below minLen. */
function d10ExtendOutward(ctx, pointAt, minLen, ownSymbolId) {
  const clearLen = (len) => d10SegmentClearance(ctx, pointAt(0), pointAt(len), ownSymbolId);
  if (!(clearLen(minLen) > 0.05)) return null;
  let len = minLen;
  while (clearLen(len + 1) > 0.05) len += 1;
  return { a: pointAt(0), b: pointAt(len), len };
}

/**
 * Landing paths for one crossover: a walk path parallel to the
 * barrier, 15 in across from the (patched) landing, extended to the
 * maximal clear interval around the crossover station. When the
 * parallel path cannot cover the landing (an obstruction sits on
 * the path line at the landing), fall back to a path perpendicular
 * to the barrier, offset 15.4 in along the barrier from the landing
 * and running away from it. Each landing path gets its own entry.
 * The crossover's landings are patched in place: 1 in outside the
 * barrier footprint, naming the landing path.
 */
function d10AuthorLandingPaths(actx, bc, crossover, paths, entries) {
  const { geometry } = bc;
  const axis = geometry.axis;
  const cross = { x: -axis.y, y: axis.x };
  for (const landing of crossover.landings) {
    const centerAt = {
      x: geometry.origin.x + axis.x * crossover.stationIn,
      y: geometry.origin.y + axis.y * crossover.stationIn,
    };
    const dir = {
      x: Math.sign(landing.x - centerAt.x),
      y: Math.sign(landing.y - centerAt.y),
    };
    const patched = { x: landing.x + dir.x, y: landing.y + dir.y };
    const sideSign =
      Math.sign((patched.x - centerAt.x) * cross.x + (patched.y - centerAt.y) * cross.y) || 1;
    const id = `path-land-${bc.short}-${Math.round(crossover.stationIn)}-${landing.side}`;
    const entryId = `entry-land-${bc.short}-${Math.round(crossover.stationIn)}-${landing.side}`;
    // Try the path 15 in across from the landing first, then closer
    // offsets — the landing attaches within 15.5 in, so any offset up
    // to 15 in works. A nearer offset clears a pipe leg running just
    // beyond the landing (the cooling-water leg 8 in south of the
    // SL-101 south landing at station 330).
    let ext = null;
    for (let d = 15; d >= 1; d -= 1) {
      const pathAcross = sideSign * (geometry.widthIn / 2 + 1 + d);
      const pointAt = (s) => ({
        x: geometry.origin.x + axis.x * s + cross.x * pathAcross,
        y: geometry.origin.y + axis.y * s + cross.y * pathAcross,
      });
      const tried = d10ExtendAlong(actx, pointAt, crossover.stationIn, null);
      if (tried) {
        ext = tried;
        break;
      }
    }
    if (ext) {
      paths.push({ id, kind: "walk", points: [ext.a, ext.b] });
      entries.push({ id: entryId, x: ext.a.x, y: ext.a.y });
    } else {
      let bestFb = null;
      for (const alongSign of [1, -1]) {
        const base = {
          x: patched.x + axis.x * alongSign * D10_NODE_OFFSET_IN,
          y: patched.y + axis.y * alongSign * D10_NODE_OFFSET_IN,
        };
        const pointAtFb = (t) => ({
          x: base.x + cross.x * sideSign * t,
          y: base.y + cross.y * sideSign * t,
        });
        const fb = d10ExtendOutward(actx, pointAtFb, 2, null);
        if (fb && (!bestFb || fb.len > bestFb.len)) bestFb = fb;
      }
      if (!bestFb) {
        throw new Error(
          `FCCU sample: no clear landing path for ${crossover.id} side ${landing.side}.`,
        );
      }
      paths.push({ id, kind: "walk", points: [bestFb.a, bestFb.b] });
      entries.push({ id: entryId, x: bestFb.a.x, y: bestFb.a.y });
    }
    landing.x = patched.x;
    landing.y = patched.y;
    landing.pathId = id;
  }
}

// Removal volumes: authored pull envelopes in verified-clear space.
// P-101 pump pull sits between the pump suction stubs, south of the
// suction header; the E-101 bundle pull sits north of the exchanger
// row, clear of the feed and effluent legs.
const D10_REMOVAL_VOLUMES = Object.freeze([
  { tag: "P-101", cx: 2070, cy: 4080, halfLIn: 60, halfWIn: 30, zMinIn: 0, zMaxIn: 60 },
  { tag: "E-101", cx: 3300, cy: 2700, halfLIn: 60, halfWIn: 50, zMinIn: 0, zMaxIn: 60 },
]);

function applyD10SampleData(design) {
  const prInst = instanceByTag(design, "PR-101");
  const slInst = instanceByTag(design, "SL-101");
  const prId = prInst.id;
  const slId = slInst.id;
  const prFoot = rackFootprint(design, prId);
  const slFoot = rackFootprint(design, slId);
  const ctx = { prId, slId, prFoot, slFoot };

  // 1. Route classification + support schedule on every run.
  let next = {
    ...design,
    pipes: (design.pipes || []).map((run) => d10AuthorRun(design, run, ctx)),
  };
  // 1b. Tier overflow: two travel lines sharing one lane offset on
  //     tier 1 collide — the module compares offsets, not along
  //     positions, so an end-to-end source + header share the lane
  //     (the three utility sources + headers). Keep the shortest
  //     line on tier 1; move the rest to tier 2, which the module's
  //     own overflow proposal names. Guides on a moved line ride on
  //     the line's tier.
  const travelByOffset = new Map();
  for (const run of next.pipes || []) {
    for (const iv of run.routeIntervals || []) {
      if (iv.role !== "RACK_TRAVEL" || iv.tier !== 1) continue;
      const list = travelByOffset.get(iv.rackOffsetIn) || [];
      list.push({ run, interval: iv });
      travelByOffset.set(iv.rackOffsetIn, list);
    }
  }
  for (const list of travelByOffset.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) =>
        a.interval.toStationIn - a.interval.fromStationIn - (b.interval.toStationIn - b.interval.fromStationIn),
    );
    for (const { run, interval } of sorted.slice(1)) {
      interval.tier = 2;
      for (const r of run.restraints || []) {
        if (
          r.type === "guide" &&
          r.carrier?.rackId === prId &&
          r.stationIn >= interval.fromStationIn - D10_EPS &&
          r.stationIn <= interval.toStationIn + D10_EPS
        ) {
          r.carrier = { ...r.carrier, tier: 2 };
        }
      }
    }
  }
  // 2. Rack reserve on PR-101: 24 in of authored spare width. Travel
  //    lines use 188.6875 in of the 288-in rack, so 24 in fits.
  next = {
    ...next,
    symbols: (next.symbols || []).map((inst) =>
      inst.id === prId
        ? { ...inst, rack: { ...(inst.rack || {}), reserve: { spareWidthIn: D10_RACK_RESERVE_IN } } }
        : inst,
    ),
  };
  // 3. Barriers: the sleeper rack and the suction header as a
  //    ground-pipe barrier (top = run elevation 30 + OD/2 5.375).
  const barriers = [
    { id: "barrier-sl-101", kind: "sleeper-rack", rackId: slId, topElevationIn: 18 },
    { id: "barrier-sh-header", kind: "ground-pipe", runId: "fccu_pipe_36", topElevationIn: 35.375 },
  ];
  next = setAccessData(next, { barriers });
  // 4. Crossover previews (6 in clearance above the pipes), renamed
  //    per barrier so ids never collide across barriers.
  const barrierCtx = [];
  const crossovers = [];
  for (const barrier of barriers) {
    const { geometry } = barrierGeometry(next, barrier);
    if (!geometry) throw new Error(`FCCU sample: no geometry for barrier ${barrier.id}.`);
    const { proposal } = previewCrossoverProposal(next, barrier.id, {
      clearanceAbovePipeIn: D10_CROSSOVER_CLEARANCE_IN,
    });
    const short = barrier.id === "barrier-sl-101" ? "sl" : "sh";
    const list = (proposal?.crossovers || []).map((c) => ({
      ...c,
      id: `xover-${short}-${Math.round(c.stationIn)}`,
      supports: (c.supports || []).map((s) => ({
        ...s,
        id: `xover-${short}-${Math.round(c.stationIn)}-support`,
      })),
    }));
    crossovers.push(...list);
    barrierCtx.push({
      barrier,
      geometry,
      short,
      stations: list.map((c) => c.stationIn),
      halfCover: (list[0]?.deck?.widthIn ?? 36) / 2 + 0.5,
      rect: d10AabbOf(geometry.corners),
      center: d10Centroid(geometry.corners),
      origin: geometry.origin,
      axis: geometry.axis,
    });
  }
  // 5. Scorer context (legs, footprints, columns).
  const actx = d10AccessContext(next, slId);
  // 5b. A preview station can land on equipment the preview does not
  //      see — the SH station 1620 sits on the P-106 tap reducer, and
  //      its landing falls inside that reducer's footprint, which
  //      leaves no clear landing path. Shift a station along the
  //      barrier until both its landings sit outside every equipment
  //      footprint, keeping the module's spacing limits (tails and
  //      gaps — balance is a preview convenience, not a rule).
  for (const bc of barrierCtx) {
    const list = crossovers.filter((c) => c.barrierId === bc.barrier.id);
    const cross = { x: -bc.geometry.axis.y, y: bc.geometry.axis.x };
    const landingsAt = (station) => {
      const centerAt = {
        x: bc.geometry.origin.x + bc.geometry.axis.x * station,
        y: bc.geometry.origin.y + bc.geometry.axis.y * station,
      };
      return [-1, 1].map((sign) => ({
        x: centerAt.x + cross.x * sign * (bc.geometry.widthIn / 2 + 1),
        y: centerAt.y + cross.y * sign * (bc.geometry.widthIn / 2 + 1),
      }));
    };
    const pointRectDist = (p, r) => {
      const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
      const dy = Math.max(r.minY - p.y, 0, p.y - r.maxY);
      return Math.hypot(dx, dy);
    };
    const landingsClear = (station) =>
      landingsAt(station).every((lp) =>
        actx.footprints.every((fp) => pointRectDist(lp, fp) > 0),
      );
    const spacingOk = (station, self) => {
      const stations = list
        .map((c) => (c === self ? station : c.stationIn))
        .sort((a, b) => a - b);
      if (stations[0] > CROSSOVER_TAIL_MAX_IN + 1e-9) return false;
      if (bc.geometry.lengthIn - stations[stations.length - 1] > CROSSOVER_TAIL_MAX_IN + 1e-9) return false;
      for (let i = 0; i + 1 < stations.length; i += 1) {
        if (stations[i + 1] - stations[i] > CROSSOVER_GAP_MAX_IN + 1e-9) return false;
      }
      return true;
    };
    for (const crossover of list) {
      if (landingsClear(crossover.stationIn)) continue;
      let shifted = null;
      for (const step of [20, -20, 40, -40, 60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180, -180, 200, -200]) {
        const candidate = crossover.stationIn + step;
        if (landingsClear(candidate) && spacingOk(candidate, crossover)) {
          shifted = candidate;
          break;
        }
      }
      if (shifted === null) {
        throw new Error(
          `FCCU sample: no usable station for ${crossover.id} — its preview station lands on equipment.`,
        );
      }
      const centerAt = {
        x: bc.geometry.origin.x + bc.geometry.axis.x * shifted,
        y: bc.geometry.origin.y + bc.geometry.axis.y * shifted,
      };
      crossover.stationIn = shifted;
      crossover.id = `xover-${bc.short}-${Math.round(shifted)}`;
      crossover.landings = crossover.landings.map((landing) => {
        const sign = landing.side === "a" ? -1 : 1;
        return {
          ...landing,
          x: centerAt.x + cross.x * sign * (bc.geometry.widthIn / 2),
          y: centerAt.y + cross.y * sign * (bc.geometry.widthIn / 2),
        };
      });
      crossover.supports = (crossover.supports || []).map((s) => ({
        ...s,
        id: `xover-${bc.short}-${Math.round(shifted)}-support`,
        x: centerAt.x,
        y: centerAt.y,
      }));
      bc.stations = list.map((c) => c.stationIn);
    }
  }
  // 5c. Barrier rects + planned crossover coverage (after any station
  //      shift) + barrier source runs for the scorer.
  actx.barriers = barrierCtx.map((b) => ({
    rect: b.rect,
    center: b.center,
    origin: b.origin,
    axis: b.axis,
    stations: b.stations,
    halfCover: b.halfCover,
  }));
  actx.sourceRuns = new Set(
    barrierCtx.filter((b) => b.barrier.runId).map((b) => b.barrier.runId),
  );
  const nodes = [];
  const paths = [];
  const entries = [];
  // 6. Crossover landing paths (patches the landings in place).
  for (const bc of barrierCtx) {
    for (const crossover of crossovers.filter((c) => c.barrierId === bc.barrier.id)) {
      d10AuthorLandingPaths(actx, bc, crossover, paths, entries);
    }
  }
  // 7. Nozzle nodes: one per anchor, standing at the face point with
  //    a ladder to the face elevation (staged climbs over 360 in).
  //    Spur entries are placed in step 10 (first-in-tolerance rule).
  const spurSpecs = [];
  for (const inst of next.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) continue;
    for (const anchor of anchorsOf(inst)) {
      const face = connectionFaceForAnchor(symbol, inst, anchor.id);
      if (!face || !Number.isFinite(face.elevationIn)) continue;
      const facePt = { x: face.x, y: face.y };
      let exitDir = null;
      for (const run of next.pipes || []) {
        for (const endName of ["start", "end"]) {
          const att = run.attachments?.[endName];
          if (att && att.symbolId === inst.id && att.anchorId === anchor.id) {
            exitDir = d10ExitDirection(next, run, endName);
          }
        }
      }
      const best = d10BestSpur(actx, facePt, exitDir, inst.id);
      const base = `acc-${inst.id}-${anchor.id}`;
      const pathId = d10SpurPathFor(spurSpecs, paths, entries, best, inst.id, base);
      const faceElev = face.elevationIn;
      if (faceElev <= D10_LADDER_MAX_IN) {
        const node = {
          id: `node-${base}`,
          kind: "nozzle",
          symbolId: inst.id,
          anchorId: anchor.id,
          pathId,
          x: best.node.x,
          y: best.node.y,
          elevationIn: 0,
        };
        if (faceElev > 0) node.verticalAccess = { kind: "ladder", topElevationIn: faceElev };
        nodes.push(node);
      } else {
        const standing =
          D10_LADDER_MAX_IN * Math.floor((faceElev - 1) / D10_LADDER_MAX_IN);
        for (let s = 0; s < standing; s += D10_LADDER_MAX_IN) {
          nodes.push({
            id: `node-${base}-climb-${s}`,
            kind: "nozzle",
            symbolId: inst.id,
            anchorId: anchor.id,
            pathId,
            x: best.node.x,
            y: best.node.y,
            elevationIn: s,
            verticalAccess: { kind: "ladder", topElevationIn: s + D10_LADDER_MAX_IN },
          });
        }
        nodes.push({
          id: `node-${base}`,
          kind: "nozzle",
          symbolId: inst.id,
          anchorId: anchor.id,
          pathId,
          x: best.node.x,
          y: best.node.y,
          elevationIn: standing,
          verticalAccess: { kind: "ladder", topElevationIn: faceElev },
        });
      }
    }
  }
  // 8. Manway nodes: standing follows the module's own reference
  //    platform (effective platform else max(grade, centerline - 30)).
  for (const inst of next.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol || manwaySpec(symbol, inst) === null) continue;
    const world = manwayWorld(symbol, inst);
    if (!world) continue;
    const effective = effectiveManwayPlatform(next, inst);
    const ref = manwayReferencePlatform(next, inst);
    const grade = gradeElevationIn(next);
    const required = effective
      ? effective.elevationIn
      : Math.max(grade, ref ? ref.platformElevationIn : grade);
    const best = d10BestSpur(actx, { x: world.x, y: world.y }, null, inst.id);
    const base = `manway-${inst.id}`;
    const pathId = d10SpurPathFor(spurSpecs, paths, entries, best, inst.id, base);
    const node = {
      id: `node-${base}`,
      kind: "manway",
      symbolId: inst.id,
      pathId,
      x: best.node.x,
      y: best.node.y,
      elevationIn: 0,
    };
    if (required > 0) node.verticalAccess = { kind: "ladder", topElevationIn: required };
    nodes.push(node);
  }
  // 9. Removal: a node + volume per pull, node at the volume centre.
  const removalVolumes = [];
  for (const spec of D10_REMOVAL_VOLUMES) {
    const inst = instanceByTag(next, spec.tag);
    const centre = { x: spec.cx, y: spec.cy };
    const best = d10BestSpurFromPoint(actx, centre, inst.id);
    const base = `removal-${inst.id}`;
    const pathId = d10SpurPathFor(spurSpecs, paths, entries, best, inst.id, base);
    nodes.push({
      id: `node-${base}`,
      kind: "removal",
      symbolId: inst.id,
      pathId,
      x: best.node.x,
      y: best.node.y,
      elevationIn: 0,
    });
    removalVolumes.push({
      id: `volume-${inst.id}`,
      symbolId: inst.id,
      cx: spec.cx,
      cy: spec.cy,
      zMinIn: spec.zMinIn,
      zMaxIn: spec.zMaxIn,
      halfLIn: spec.halfLIn,
      halfWIn: spec.halfWIn,
    });
  }
  // 10. Entry placement: attachPoint takes the FIRST path within
  //     15.5 in, not the nearest — a spur entry at the far end is
  //     captured by any parallel neighbour spur or crossing landing
  //     path within 15.5 in, and its own spur then has no entry.
  //     Move each captured entry (dogleg, shorter or longer spur)
  //     until it is isolated from every other path. Re-run: moving
  //     one entry can put a new path near another entry.
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const spec of spurSpecs) {
      const path = paths.find((p) => p.id === spec.pathId);
      const entry = entries.find((e) => e.id === spec.entryId);
      if (!path || !entry) continue;
      if (d10EntryIsolated({ x: entry.x, y: entry.y }, spec.pathId, paths)) continue;
      if (d10PlaceSpurEntry(actx, spec, path, entry, paths)) moved = true;
    }
    if (!moved) break;
  }
  // 11. Platforms for the staged climbs + the full access record,
  //     and industrial mode so validateDesign enforces the D10
  //     aggregates.
  next = setAccessData(next, {
    entries,
    nodes,
    paths,
    barriers,
    crossovers,
    removalVolumes,
    platforms: [{ elevationIn: 360 }, { elevationIn: 720 }],
  });
  return { ...next, mode: "industrial" };
}

function buildPlotDesign() {
  const systemIds = {};
  let design = createEmptyDesign("Plot Plan");
  design = placeEquipment(design);
  // V-102 (knockout drum): its catalog manway sill (30 in) would require
  // an access deck, and the congested plot has no feasible placement
  // (PR668-003). Override the sill to 24 in (at-grade access, no deck
  // required) — an explicit editable choice, not a deletion.
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.tag === "V-102" ? { ...s, manway: { fx: 0, fy: 1, diameterIn: 24, sillIn: 24 } } : s,
    ),
  };
  // V-101 (reflux accumulator, D10-04): author its head-nozzle
  // schedule (version 1) so the end nozzles resolve to authored
  // top/bottom-of-head faces (R4) instead of the legacy side rule.
  // West head, bottom: liquid-out, 6 in, face (3873, 3144) at 12 in.
  // East head, top: vapor-out, 8 in, face (4047, 3144) at 48 in.
  // Ratings are unknown — preserved, never invented. G2 (reflux drum
  // liquid) and G4 (wet gas) land on these scheduled faces.
  design = setHeadNozzleSchedule(design, instanceByTag(design, "V-101").id, [
    {
      id: "liquid-out",
      sizeIn: 6,
      rating: { status: "unknown" },
      surface: "head-west",
      position: "bottom",
      orientationDeg: 180,
      elevationIn: 12,
      projectionIn: 12,
    },
    {
      id: "vapor-out",
      sizeIn: 8,
      rating: { status: "unknown" },
      surface: "head-east",
      position: "top",
      orientationDeg: 0,
      elevationIn: 48,
      projectionIn: 12,
    },
  ]);
  // T-102 (absorber): authored 30 in head so its terminal downcomer
  // assembly (top level at the shell top + the 24 in manway) fits
  // inside the MODELED head (R4) — the h/(2r) dish estimate for the
  // placed 60 in shell is only ~16.5 in.
  design = {
    ...design,
    symbols: design.symbols.map((s) => (s.tag === "T-102" ? { ...s, headIn: 30 } : s)),
  };
  design = configureFractionator(design);
  design = configureFireProtection(design);
  design = placeRacks(design);
  design = createSystems(design, systemIds);
  design = labelAreas(design);
  design = labelPlot(design);
  // The unit boundary the spray assemblies must stay outside of.
  design = {
    ...design,
    unitBoundary: [pt(100, 100), pt(440, 100), pt(440, 395), pt(100, 395)],
  };
  design = addPiping(design, systemIds);
  design = addUtilities(design, systemIds);
  design = addFirewater(design, systemIds);
  // The stub pass re-routes final approaches; re-run the crossing-jog
  // pass for the stubbed runs that actually have open crossings so
  // any stub crossing another run gets its elevation jog, exactly as
  // construction-time runs did. (Jogging every stubbed run would
  // re-scan the whole design per run — the crossing set is computed
  // once instead.)
  const stubbed = alignApproachStubs(design);
  design = stubbed.design;
  if (stubbed.changedIds.length > 0) {
    const stubbedIds = new Set(stubbed.changedIds);
    const openIds = new Set();
    for (const c of findPipeCrossings(design)) {
      if (c.resolved) continue;
      if (stubbedIds.has(c.aRunId)) openIds.add(c.aRunId);
      if (stubbedIds.has(c.bRunId)) openIds.add(c.bRunId);
    }
    for (const runId of openIds) {
      design = applyCrossingJogs(design, runId);
    }
  }
  // Final junction pass: runs added early never saw runs added later —
  // re-detect junctions for every run so endpoint-T contacts (e.g. a
  // rundown landing on the pump suction header) are modeled, not
  // flagged as unmodeled contacts (D668-003/D668-004). Skip runs that
  // already have both ends junctioned (no new junctions possible).
  for (const pipe of design.pipes || []) {
    if (pipe.junctions?.start?.runId && pipe.junctions?.end?.runId) continue;
    design = detectRunJunctions(design, pipe.id);
  }
  design = reconcileRunJunctions(design);
  // Place reducers at size-mismatched junctions discovered by the final
  // pass (PR668-001 + R1/F1: every transition gets its modeled reducer,
  // oriented so its owned interfaces bind the tap — the branch-facing
  // port carries the branch's size, at the tap's elevation, and both
  // ports persist ownership of THIS tap's pair). A tap is skipped only
  // when its junction edge already validates (validatedJunctionEdge —
  // the owner-aware check), never merely because a reducer sits nearby.
  const byId = new Map((design.pipes || []).map((p) => [p.id, p]));
  for (const pipe of design.pipes || []) {
    for (const end of ["start", "end"]) {
      const hostId = pipe.junctions?.[end]?.runId;
      if (!hostId) continue;
      const host = byId.get(hostId);
      if (!host) continue;
      const d1 = pipe.diameterIn ?? 2;
      const d2 = host.diameterIn ?? 2;
      if (d1 === d2) continue;
      if (validatedJunctionEdge(design, pipe, end).status === "ok") continue;
      const idx = end === "start" ? 0 : pipe.points.length - 1;
      const pt = pipe.points[idx];
      const neighbor = pipe.points[end === "start" ? 1 : pipe.points.length - 2];
      if (!neighbor) continue;
      const branchAxisDeg =
        (Math.atan2(neighbor.y - pt.y, neighbor.x - pt.x) * 180) / Math.PI;
      const inletSizeIn = Math.max(d1, d2);
      const outletSizeIn = Math.min(d1, d2);
      // The outlet (smaller side) faces the branch when the branch is
      // the smaller side; otherwise it faces the host.
      const rotationDeg = d1 === outletSizeIn ? branchAxisDeg : branchAxisDeg + 180;
      design = placeReducer(design, pt.x, pt.y, {
        id: fccuId("reducer"),
        inletSizeIn,
        outletSizeIn,
        rotationDeg,
        // F1: this pass serves THIS pipe's end — name it, since other
        // transitions may share the tap point.
        forRun: { runId: pipe.id, end },
      });
    }
  }
  // D10-05: author the route classification, support schedule and
  // access evidence on the final geometry, and switch the sample to
  // industrial mode so validateDesign enforces the D10 aggregates.
  return applyD10SampleData(design);
}

/**
 * Build the "FCCU Plot Plan (Fictional)" seed document: a complete, valid
 * single-level HomeProject envelope — and deliberately NO identity: no
 * projectId, no owner/user fields, no createdAt/updatedAt, no draft
 * metadata. The fork handler POSTs a fresh project and PUTs this document;
 * the server assigns identity at that point.
 */
export function buildFccuPlotPlan() {
  resetDesignerIds();
  resetHomeProjectIds();
  resetFccuSampleIds();

  let project = createHomeProject(FCCU_SAMPLE_NAME);
  const levelId = project.levels[0].id;
  project = updateLevelDesign(project, levelId, () => buildPlotDesign());
  project = renameLevel(project, levelId, "Plot Plan");

  // Strip the envelope timestamps the domain functions stamp: a seed has
  // no history. (The PUT fork handler's parseHomeProject re-normalizes
  // them server-side at fork time.)
  const seed = { ...project };
  delete seed.createdAt;
  delete seed.updatedAt;
  return seed;
}
