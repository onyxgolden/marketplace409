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
  detectRunAttachments,
  detectRunJunctions,
  reconcilePipeAttachments,
  reconcileRunJunctions,
} from "./pipeAttachments";
import { applyCrossingJogs } from "./pipeCrossings";
import { placeReducer } from "./pipeReducerModel";
import { setDowncomerLevelProps } from "./downcomers";
import { UTILITY_HEADER_DIAMETER_IN, UTILITY_SERVICES } from "./utilityPiping";
import { FIREWATER_MAIN_DIAMETER_IN, HYDRANT_BRANCH_DIAMETER_IN } from "./firewater";
import { setRackParams } from "./rackGeometry";

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
function addRun(design, systemIds, pointsInches, { diameterIn, service, systemName, id, utility, elevationIn, elevIn, sourceOf } = {}) {
  const runId = id || fccuId("pipe");
  let next = addPipeRun(design, pointsInches, {
    id: runId,
    diameterIn,
    material: "Carbon steel",
    service,
    layer: "piping",
    elevationIn,
  });
  if (utility || elevIn || sourceOf) {
    next = {
      ...next,
      pipes: next.pipes.map((r) =>
        r.id === runId
          ? {
              ...r,
              ...(utility ? { utility } : {}),
              ...(elevIn ? { elevIn } : {}),
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
    run(
      [pt(124, 320), pt(260, 320), pt(260, 235), anchorPt(end)],
      { diameterIn: 8, service: "Process feed to exchanger train", systemName: "Process feed" },
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
    run(
      [anchorPt(start), pt(371, 190), pt(190, 190), anchorPt(end)],
      { diameterIn: 8, service: "Process feed to reactor", systemName: "Process feed" },
    );
  }
  // F2 — fractionator bottoms through the exchanger shell sides along
  // y=233.75 ft, entering at E-104 and leaving E-101 to rundown — again
  // with real nozzle endpoints on every exchanger (P663-001).
  {
    const start = anchor("T-101", "bottoms-out");
    const end = anchor("E-104", "shell-in");
    run(
      [anchorPt(start), { x: start.x, y: 205 * FT }, pt(368, 205), anchorPt(end)],
      { diameterIn: 12, service: "Slurry oil — fractionator bottoms to exchanger train", systemName: "Reactor effluent" },
    );
  }
  for (const [from, to] of [["E-104", "E-103"], ["E-103", "E-102"], ["E-102", "E-101"]]) {
    const start = anchor(from, "shell-out");
    const end = anchor(to, "shell-in");
    run(
      [anchorPt(start), anchorPt(end)],
      { diameterIn: 12, service: `Fractionator bottoms — ${from} to ${to}`, systemName: "Reactor effluent" },
    );
  }
  {
    const start = anchor("E-101", "shell-out");
    run(
      [anchorPt(start), pt(266, 233.75), pt(266, 328)],
      { diameterIn: 12, service: "Fractionator bottoms to rundown", systemName: "Reactor effluent" },
    );
  }
  // R1 — reactor effluent to the fractionator.
  {
    const start = anchor("R-101", "effluent-out");
    const end = anchor("T-101", "feed-in");
    run(
      [anchorPt(start), pt(196, 160), pt(316, 160), anchorPt(end)],
      { diameterIn: 16, service: "Reactor effluent to fractionator", systemName: "Reactor effluent" },
    );
  }
  // R2 — spent catalyst to the regenerator.
  {
    const start = anchor("R-101", "spent-catalyst-out");
    const end = anchor("R-102", "spent-catalyst-in");
    run(
      [anchorPt(start), { x: start.x, y: 178 * FT }, { x: end.x, y: 178 * FT }, anchorPt(end)],
      { diameterIn: 10, service: "Spent catalyst to regenerator", systemName: "Catalyst transfer" },
    );
  }
  // R3 — regenerated catalyst back to the reactor.
  {
    const start = anchor("R-102", "regen-catalyst-out");
    const end = anchor("R-101", "regen-catalyst-in");
    run(
      [anchorPt(start), { x: start.x, y: 162 * FT }, { x: end.x, y: 162 * FT }, anchorPt(end)],
      { diameterIn: 10, service: "Regenerated catalyst to reactor", systemName: "Catalyst transfer" },
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
      },
    );
  }
  // R4 — regenerator flue gas to the battery limit.
  {
    const start = anchor("R-102", "flue-gas-out");
    run(
      [anchorPt(start), pt(245, 36)],
      { diameterIn: 12, service: "Regenerator flue gas to battery limit", systemName: "Flue gas" },
    );
  }
  // G1 — fractionator overhead vapors to the reflux drum (the overhead
  // stream is wet gas / gasoline-range material, not yet a separated
  // gas product — downstream separation happens in V-101/V-102).
  {
    const start = anchor("T-101", "overhead-out");
    const end = anchor("V-101", "inlet");
    run(
      [anchorPt(start), pt(320, 255), pt(330, 255), anchorPt(end)],
      { diameterIn: 10, service: "Overhead vapors — wet gas / gasoline-range material", systemName: "Overhead & reflux" },
    );
  }
  // G2 — reflux drum liquid to the suction header (the end lands
  // pipe-to-pipe ON the header at x=315 ft: a junction-modeled mixing
  // point it shares with the slurry bottoms rundown — see the fixture
  // draw map on configureFractionator).
  {
    const start = anchor("V-101", "liquid-out");
    run(
      [anchorPt(start), pt(315, 262), pt(315, 328)],
      { diameterIn: 6, service: "Reflux drum liquid to suction header", systemName: "Overhead & reflux" },
    );
  }
  // G3 — reflux return from the reflux pump discharge to the fractionator.
  // The north-south segment at x=345 rides at 40 in to clear the
  // east-west process runs below (D668-002: explicit elevations beat
  // the default-30 fallback that caused same-elevation crossings).
  {
    const start = anchor("P-101", "discharge-out");
    const end = anchor("T-101", "reflux-in");
    run(
      [anchorPt(start), pt(160, 367), pt(345, 367), { x: 345 * FT, y: end.y }, anchorPt(end)],
      {
        diameterIn: 6,
        service: "Reflux return to fractionator",
        systemName: "Overhead & reflux",
        elevIn: [null, 40, 40, 40, null],
      },
    );
  }
  // G4 — wet gas to the knockout drum.
  {
    const start = anchor("V-101", "wet-gas-out");
    const end = anchor("V-102", "gas-in");
    run(
      [anchorPt(start), { x: end.x, y: start.y }, anchorPt(end)],
      { diameterIn: 8, service: "Wet gas to knockout drum", systemName: "Wet gas" },
    );
  }
  // G5 — knockout drum gas to the compressor suction.
  {
    const start = anchor("V-102", "gas-out");
    const end = anchor("K-102", "suction-in");
    run(
      [anchorPt(start), pt(270, 293), pt(230, 293), anchorPt(end)],
      { diameterIn: 8, service: "Knockout drum gas to compressor suction", systemName: "Wet gas" },
    );
  }
  // G6 — compressor discharge to the absorber.
  // The north-south segment at x=350 rides at 40 in to clear the
  // east-west process runs below (D668-002).
  {
    const start = anchor("K-102", "discharge-out");
    const end = anchor("T-102", "gas-in");
    run(
      [anchorPt(start), pt(230, 364), pt(350, 364), { x: 350 * FT, y: end.y }, anchorPt(end)],
      {
        diameterIn: 6,
        service: "Compressor discharge to absorber",
        systemName: "Wet gas",
        elevIn: [null, 40, 40, 40, null],
      },
    );
  }
  // G7 — absorber rich oil straight to the fractionator.
  {
    const start = anchor("T-102", "rich-oil-out");
    const end = anchor("T-101", "rich-oil-in");
    run(
      [anchorPt(start), anchorPt(end)],
      { diameterIn: 6, service: "Absorber rich oil to fractionator", systemName: "Overhead & reflux" },
    );
  }
  // M1 — air intake to the main air blower.
  {
    const end = anchor("K-101", "intake-in");
    run(
      [pt(100, 300), anchorPt(end)],
      { diameterIn: 12, service: "Air intake", systemName: "Combustion air" },
    );
  }
  // M2 — combustion air from the blower discharge to the regenerator.
  {
    const start = anchor("K-101", "discharge-out");
    const end = anchor("R-102", "air-in");
    run(
      [anchorPt(start), pt(155, 324), pt(245, 324), anchorPt(end)],
      { diameterIn: 16, service: "Combustion air to regenerator", systemName: "Combustion air" },
    );
  }
  // P0 — rack rundown header (battery-limit to battery-limit).
  run([pt(128, 373), pt(415, 373)], {
    diameterIn: 12,
    service: "Rack rundown header",
    systemName: "Product rundown",
  });
  // SH — pump suction header.
  run([pt(150, 328), pt(330, 328)], {
    diameterIn: 10,
    service: "Pump suction header",
    systemName: "Product rundown",
  });
  // Suction stubs from the suction header down to each pump.
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
    run([pt(pxFt, 328), anchorPt(end)], {
      diameterIn: 4,
      service: `Pump suction — ${tag}`,
      systemName: "Product rundown",
    });
  }
  // Discharge jumpers from each pump (except the reflux pump P-101, whose
  // discharge is run G3) up to the rack rundown header. Each jogs up at
  // the rack edge (y=361 ft) so its last segment rides the rack and its
  // end actually meets the header's elevation (186 in — D668-004: the
  // junction faces must meet within tolerance).
  for (const [tag, pxFt] of pumpRow.slice(1)) {
    const start = anchor(tag, "discharge-out");
    run([anchorPt(start), pt(pxFt, 361), pt(pxFt, 373)], {
      diameterIn: 6,
      service: `Pump discharge — ${tag}`,
      systemName: "Product rundown",
      elevIn: [null, null, 186],
    });
  }
  // X0 — relief header: process area -> east -> south -> flare.
  {
    const end = anchor("FL-101", "relief-in");
    run([pt(380, 180), pt(520, 180), pt(520, 400), anchorPt(end)], {
      id: fccuId("relief-header"),
      diameterIn: 24,
      service: "Relief header to flare",
      systemName: "Relief",
    });
  }
  // X1 — fractionator relief branch into the header.
  {
    const start = anchor("T-101", "relief-out");
    run(
      [anchorPt(start), { x: start.x, y: 146 * FT }, pt(366, 146), pt(366, 180), pt(380, 180)],
      { diameterIn: 12, service: "Fractionator relief branch", systemName: "Relief" },
    );
  }
  // X2 — regenerator relief branch into the header.
  {
    const start = anchor("R-102", "relief-out");
    run(
      [anchorPt(start), { x: start.x, y: 186 * FT }, pt(380, 186), pt(380, 180)],
      { diameterIn: 12, service: "Regenerator relief branch", systemName: "Relief" },
    );
  }
  // U1 — cooling water supply to E-101. It approaches the exchanger's
  // cooling-water-in nozzle from the south (perpendicular), rather than
  // running west along the nozzle line, so it never overlaps the
  // exchanger-to-exchanger chain runs that share that line.
  {
    const end = anchor("E-101", "cooling-water-in");
    run(
      [pt(110, 376), pt(400, 376), pt(400, 252), { x: end.x, y: 252 * FT }, anchorPt(end)],
      { diameterIn: 10, service: "Cooling water supply", systemName: "Cooling water" },
    );
  }
  for (const [from, to] of [["E-101", "E-102"], ["E-102", "E-103"], ["E-103", "E-104"]]) {
    const start = anchor(from, "cooling-water-out");
    const end = anchor(to, "cooling-water-in");
    run(
      [anchorPt(start), anchorPt(end)],
      { diameterIn: 10, service: `Cooling water — ${from} to ${to}`, systemName: "Cooling water" },
    );
  }
  // U2 — cooling water return, from the last exchanger in the chain.
  {
    const start = anchor("E-104", "cooling-water-out");
    run(
      [anchorPt(start), { x: start.x, y: 248 * FT }, pt(140, 248), pt(140, 379), pt(107, 379)],
      { diameterIn: 10, service: "Cooling water return", systemName: "Cooling water" },
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
    });
    next = addRun(next, systemIds, [pt(130, yFt), pt(405, yFt)], {
      diameterIn: UTILITY_HEADER_DIAMETER_IN,
      service: `${service.label} header`,
      systemName: service.label,
      utility: service.id,
      elevationIn: tier,
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
  const T102_APPROACH_FT = { "plant-water": 152.5, "plant-air": 158, nitrogen: 164 };
  const T102_APPROACH_ELEV_IN = { "plant-water": 24, "plant-air": 36, nitrogen: 48 };
  for (const tag of ["R-101", "R-102", "T-101", "T-102", "V-101", "V-102"]) {
    for (const service of UTILITY_SERVICES) {
      const end = anchorOfTag(next, tag, service.anchorId);
      const yFt = headerYFt[service.id];
      const tier = UTILITY_HEADER_TIER_IN[service.id];
      const anchorFt = { x: end.x / FT, y: end.y / FT };
      let points;
      let elevIn;
      if (tag === "T-102") {
        const lane = T102_LANE_FT[service.id];
        const approachY = T102_APPROACH_FT[service.id];
        const approachElev = T102_APPROACH_ELEV_IN[service.id];
        // Transit at header tier to clear process runs below; drop to
        // the approach elevation at the fan corner near the vessel.
        points = [pt(lane, yFt), pt(lane, yFt - 1), pt(lane, approachY)];
        elevIn = [tier, tier, tier];
        if (approachY !== anchorFt.y) {
          // Fan corner: the drop to port elevation happens HERE, so
          // the final stub reaches the flange at exactly 24 in.
          points.push(pt(anchorFt.x, approachY));
          elevIn.push(24);
        }
        points.push(anchorPt(end));
        elevIn.push(24);
      } else if (tag === "R-101" && service.id === "plant-water") {
        // Detour east around P-102, returning west at y=182 — clear of
        // the pump row and of the reactor feed line's own approach
        // along the vessel centerline (crossed, with a jog, at y=182).
        // Transit at header tier to clear process runs below.
        points = [
          pt(anchorFt.x, yFt),
          pt(anchorFt.x, yFt - 1),
          pt(anchorFt.x, 345),
          pt(196, 345),
          pt(196, 182),
          pt(anchorFt.x, 182),
          anchorPt(end),
        ];
        elevIn = [tier, tier, tier, tier, tier, 24, 24];
      } else {
        // T-101's utilities transit south at 18 in elevation — below the
        // process pipe rack (±26 in and up) — then rise to the port
        // elevation at the vessel (D668-003: vertical separation clears
        // the envelope where plan separation cannot).
        // Other vessels transit at header tier.
        const dropYFt = anchorFt.y + 10;
        if (tag === "T-101") {
          points = [
            pt(anchorFt.x, yFt),
            pt(anchorFt.x, yFt - 1),
            pt(anchorFt.x, dropYFt),
            anchorPt(end),
          ];
          elevIn = [tier, 18, 18, 24];
        } else {
          points = [
            pt(anchorFt.x, yFt),
            pt(anchorFt.x, dropYFt),
            anchorPt(end),
          ];
          elevIn = [tier, tier, 24];
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
      const tapXft = tag === "T-102" ? T102_LANE_FT[service.id] : anchorFt.x;
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
    next = addRun(next, systemIds, [tap, hydrantAt], {
      diameterIn: HYDRANT_BRANCH_DIAMETER_IN,
      service: `Fire hydrant FH-${i + 1} branch`,
      systemName: "Firewater",
      utility: "firewater",
      elevationIn: -36,
    });
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
      symbols: next.symbols.map((s) => (s.id === hydrant.id ? { ...s, stationRunId: mainId } : s)),
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
      elevationIn: -36,
    });
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
  // pass (PR668-001: every transition gets its modeled reducer).
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
      const pt = end === "start" ? pipe.points[0] : pipe.points[pipe.points.length - 1];
      // Skip if a reducer already covers this tap.
      const covered = (design.symbols || []).some(
        (s) =>
          s.symbolId === "reducer" &&
          Math.hypot(s.x - pt.x, s.y - pt.y) <= 1,
      );
      if (covered) continue;
      design = placeReducer(design, pt.x, pt.y, {
        id: fccuId("reducer"),
        inletSizeIn: Math.max(d1, d2),
        outletSizeIn: Math.min(d1, d2),
      });
    }
  }
  return design;
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
