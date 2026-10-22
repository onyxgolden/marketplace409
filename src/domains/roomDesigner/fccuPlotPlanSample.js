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
import { anchorsOf, detectRunAttachments } from "./pipeAttachments";
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
const FCCU_SYSTEMS = [
  ["Process feed", "#22c55e"],
  ["Reactor effluent", "#f97316"],
  ["Catalyst transfer", "#eab308"],
  ["Combustion air", "#14b8a6"],
  ["Overhead & reflux", "#3b82f6"],
  ["Wet gas", "#a855f7"],
  ["Product rundown", "#ec4899"],
  ["Cooling water", "#f59e0b"],
  ["Relief", "#ef4444"],
  ["Flue gas", "#94a3b8"],
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
 * record nozzle attachments for any end sitting exactly on an anchor.
 */
function addRun(design, systemIds, pointsInches, { diameterIn, service, systemName, id } = {}) {
  const runId = id || fccuId("pipe");
  let next = addPipeRun(design, pointsInches, {
    id: runId,
    diameterIn,
    material: "Carbon steel",
    service,
    layer: "piping",
  });
  next = setMemberSystem(next, { kind: "pipe", id: runId }, systemIds[systemName]);
  next = detectRunAttachments(next, runId);
  return next;
}

function addPiping(design, systemIds) {
  let next = design;
  const run = (points, opts) => {
    next = addRun(next, systemIds, points, opts);
  };
  const anchor = (tag, anchorId) => anchorOfTag(next, tag, anchorId);

  // F1 — process feed, threading the exchanger tube sides along y=235 ft.
  {
    const end = anchor("R-101", "feed-in");
    run(
      [pt(124, 320), pt(260, 320), pt(260, 235), pt(371, 235), pt(371, 190), pt(190, 190), anchorPt(end)],
      { diameterIn: 8, service: "Process feed to reactor", systemName: "Process feed" },
    );
  }
  // F2 — fractionator bottoms, threading the exchanger shell sides along y=233.75 ft.
  {
    const start = anchor("T-101", "bottoms-out");
    run(
      [anchorPt(start), { x: start.x, y: 205 * FT }, pt(368, 205), pt(368, 233.75), pt(266, 233.75), pt(266, 328)],
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
  // R4 — regenerator flue gas to the battery limit.
  {
    const start = anchor("R-102", "flue-gas-out");
    run(
      [anchorPt(start), pt(245, 36)],
      { diameterIn: 12, service: "Regenerator flue gas to battery limit", systemName: "Flue gas" },
    );
  }
  // G1 — fractionator overhead to the reflux drum.
  {
    const start = anchor("T-101", "overhead-out");
    const end = anchor("V-101", "inlet");
    run(
      [anchorPt(start), pt(320, 255), pt(330, 255), anchorPt(end)],
      { diameterIn: 10, service: "Fractionator overhead to reflux drum", systemName: "Overhead & reflux" },
    );
  }
  // G2 — reflux drum liquid to the suction header (end lands pipe-to-pipe).
  {
    const start = anchor("V-101", "liquid-out");
    run(
      [anchorPt(start), pt(315, 262), pt(315, 328), pt(330, 328)],
      { diameterIn: 6, service: "Reflux drum liquid to suction header", systemName: "Overhead & reflux" },
    );
  }
  // G3 — reflux return from the reflux pump discharge to the fractionator.
  {
    const start = anchor("P-101", "discharge-out");
    const end = anchor("T-101", "reflux-in");
    run(
      [anchorPt(start), pt(160, 367), pt(345, 367), { x: 345 * FT, y: end.y }, anchorPt(end)],
      { diameterIn: 6, service: "Reflux return to fractionator", systemName: "Overhead & reflux" },
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
  {
    const start = anchor("K-102", "discharge-out");
    const end = anchor("T-102", "gas-in");
    run(
      [anchorPt(start), pt(230, 364), pt(350, 364), { x: 350 * FT, y: end.y }, anchorPt(end)],
      { diameterIn: 6, service: "Compressor discharge to absorber", systemName: "Wet gas" },
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
  // discharge is run G3) up to the rack rundown header.
  for (const [tag, pxFt] of pumpRow.slice(1)) {
    const start = anchor(tag, "discharge-out");
    run([anchorPt(start), pt(pxFt, 373)], {
      diameterIn: 6,
      service: `Pump discharge — ${tag}`,
      systemName: "Product rundown",
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
  // U1 — cooling water supply, threading every exchanger along y=236.25 ft.
  {
    const end = anchor("E-101", "cooling-water-in");
    run(
      [pt(110, 376), pt(400, 376), pt(400, 236.25), anchorPt(end)],
      { diameterIn: 10, service: "Cooling water supply", systemName: "Cooling water" },
    );
  }
  // U2 — cooling water return.
  {
    const start = anchor("E-101", "cooling-water-out");
    run(
      [anchorPt(start), { x: start.x, y: 248 * FT }, pt(140, 248), pt(140, 379), pt(107, 379)],
      { diameterIn: 10, service: "Cooling water return", systemName: "Cooling water" },
    );
  }
  return next;
}

function buildPlotDesign() {
  const systemIds = {};
  let design = createEmptyDesign("Plot Plan");
  design = placeEquipment(design);
  design = placeRacks(design);
  design = createSystems(design, systemIds);
  design = labelAreas(design);
  design = labelPlot(design);
  design = addPiping(design, systemIds);
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
