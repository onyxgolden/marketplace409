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
import {
  createHomeProject,
  renameLevel,
  resetHomeProjectIds,
  updateLevelDesign,
} from "./homeProject";

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

// Main process flow arrows (piping domain): [xFt, yFt, rotationDeg].
// rotationDeg 0 points +x (east); 270 points -y (north).
const FCCU_FLOW_ARROWS = [
  [283, 160, 0], // reactor -> fractionator
  [341, 205, 90], // fractionator -> exchanger train
  [200, 235, 270], // blower air -> regenerator
];

// Relief header: process area -> east -> south -> flare. Feet.
const RELIEF_HEADER_POINTS = [
  [380, 180],
  [520, 180],
  [520, 400],
  [566, 400],
];

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

function placeFlowArrows(design) {
  let next = design;
  for (const [xFt, yFt, rotationDeg] of FCCU_FLOW_ARROWS) {
    next = placeSymbol(next, "piping", "flow-arrow", xFt * FT, yFt * FT, { rotationDeg });
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

function addReliefHeader(design) {
  return addPipeRun(
    design,
    RELIEF_HEADER_POINTS.map(([xFt, yFt]) => ({ x: xFt * FT, y: yFt * FT })),
    {
      id: fccuId("relief-header"),
      diameterIn: 24,
      material: "Carbon steel",
      service: "Relief header to flare",
      layer: "piping",
    },
  );
}

function buildPlotDesign() {
  let design = createEmptyDesign("Plot Plan");
  design = placeEquipment(design);
  design = placeFlowArrows(design);
  design = labelAreas(design);
  design = labelPlot(design);
  design = addReliefHeader(design);
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
