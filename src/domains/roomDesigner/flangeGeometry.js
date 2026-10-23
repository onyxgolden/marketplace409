// Flange and nozzle component model for the FORGE designer.
//
// A flange today exists only as a stroke style inside the TEMA draw
// routine; this module is the real component model every view renders
// from: a flange is a disc whose face sits at the connection plane, with
// outside diameter and thickness scaled to the nominal pipe size
// (standard raised-face flange proportions). A nozzle is a neck stub
// projecting from an equipment surface with a flange at its face.
//
// All values are nominal planning dimensions in inches. Pure and
// framework-free.

import { PIPE_DIAMETERS_IN } from "./pipingGeometry";

/** Standard flange OD / thickness (in) by nominal pipe size (in). */
const FLANGE_TABLE = Object.freeze({
  "0.5": { odIn: 3.5, thicknessIn: 0.44 },
  "0.75": { odIn: 3.88, thicknessIn: 0.5 },
  "1": { odIn: 4.25, thicknessIn: 0.56 },
  "1.25": { odIn: 4.62, thicknessIn: 0.62 },
  "1.5": { odIn: 5, thicknessIn: 0.69 },
  "2": { odIn: 6, thicknessIn: 0.75 },
  "2.5": { odIn: 7, thicknessIn: 0.88 },
  "3": { odIn: 7.5, thicknessIn: 0.94 },
  "4": { odIn: 9, thicknessIn: 1.19 },
  "6": { odIn: 11, thicknessIn: 1.44 },
  "8": { odIn: 13.5, thicknessIn: 1.62 },
  "10": { odIn: 16, thicknessIn: 1.81 },
  "12": { odIn: 19, thicknessIn: 2 },
  "16": { odIn: 23.5, thicknessIn: 2.19 },
});

/** Actual pipe outside diameter (in) by nominal pipe size (in). */
const PIPE_OD_TABLE = Object.freeze({
  "0.5": 0.84,
  "0.75": 1.05,
  "1": 1.315,
  "1.25": 1.66,
  "1.5": 1.9,
  "2": 2.375,
  "2.5": 2.875,
  "3": 3.5,
  "4": 4.5,
  "6": 6.625,
  "8": 8.625,
  "10": 10.75,
  "12": 12.75,
  "16": 16,
});

/** Nominal size a request snaps to: smallest listed size >= the request. */
export function flangeNominalSizeIn(sizeIn) {
  const s = Number(sizeIn);
  if (!(s > 0)) return 2;
  for (const nominal of PIPE_DIAMETERS_IN) {
    if (s <= nominal) return nominal;
  }
  return PIPE_DIAMETERS_IN[PIPE_DIAMETERS_IN.length - 1];
}

/** Flange dimensions for a nominal pipe size: { sizeIn, odIn, thicknessIn }. */
export function flangeDims(sizeIn) {
  const nominal = flangeNominalSizeIn(sizeIn);
  const row = FLANGE_TABLE[String(nominal)] || FLANGE_TABLE["2"];
  return { sizeIn: nominal, odIn: row.odIn, thicknessIn: row.thicknessIn };
}

/** Pipe outside diameter (in) for a nominal pipe size. */
export function pipeOdIn(sizeIn) {
  const nominal = flangeNominalSizeIn(sizeIn);
  return PIPE_OD_TABLE[String(nominal)] ?? nominal;
}

/**
 * The flange component: a disc with its face at the connection plane.
 * Renderers (plan, sheet/print, elevation, 3D) all draw from this one
 * descriptor — there is no per-view flange geometry.
 */
export function flangeComponent(sizeIn) {
  const dims = flangeDims(sizeIn);
  return { kind: "flange", ...dims };
}

/** Default nozzle neck projection from the equipment surface (in). */
export const NOZZLE_NECK_LENGTH_IN = 6;

/**
 * The nozzle component: a neck stub (outside diameter = the connecting
 * pipe's OD) projecting from the equipment surface, terminated by a
 * flange whose face is the connection plane (the anchor point pipes
 * attach to).
 */
export function nozzleComponent(sizeIn, neckLengthIn = NOZZLE_NECK_LENGTH_IN) {
  return {
    kind: "nozzle",
    sizeIn: flangeNominalSizeIn(sizeIn),
    neckOdIn: pipeOdIn(sizeIn),
    neckLengthIn,
    flange: flangeComponent(sizeIn),
  };
}
