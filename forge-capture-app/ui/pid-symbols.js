// FORGE Capture — PT-5 P&ID symbol registry for workflow markup
// (ui/pid-symbols.js).
//
// Pure, DOM-free, parallel to ui/workflow-symbols.js (PT-4) -- same
// contract, a separate namespace. See
// commands/muse/capture-pt5-pid-symbols-brief-for-claude.md for the full
// product/legal reasoning this follows.
//
// Product contract (brief, restated for anyone reading only this file):
// these are ORIGINAL, schematic P&ID-INSPIRED glyphs an author places on
// a fixture-only guide-step placeholder to illustrate an SOP/workflow
// concept. They are NOT evidence, do not depict any actual captured
// plant equipment, and do NOT constitute a standards-compliant
// engineering P&ID -- no piping network, connected ports, line
// numbering, tag databases, loop sheets, specification checks, or
// engineering calculations. The UI must label this palette category
// "P&ID symbols (workflow markup)", visually separate from "Workflow
// symbols" and legacy basic markup. ISA-5.1 and ISO 10628 are consulted
// only at a conceptual level for naming/drawing-convention ideas; no
// standard's figures, vendor Visio stencils, or branded icon packs are
// reproduced -- every shape below is original geometry authored here.
//
// Renderer-compatibility: identical audit to workflow-symbols.js --
// `annotations-render.js`'s `drawOpsToCanvas` supports exactly `rect`,
// `fillRect`, `line`, `filledTriangle`, `text`, `blurRect`,
// `redactPlaceholder`, `callout`. Every symbol here is therefore built
// from straight `line` segments (open or closed polylines) and `rect`
// only, plus one bounded `text` op for an optional label -- same
// vocabulary subset workflow-symbols.js uses, deliberately, so this
// module needs no renderer change and inherits its already-reviewed
// maxWidth-bounding behavior as-is.
//
// Duplication note: `arcPoints`, `countSegments`, and the label-trim /
// length-cap logic below are small, pure re-implementations of the
// equivalent private helpers in workflow-symbols.js, not imports from
// it. workflow-symbols.js exports no such helpers (by design -- see its
// own module doc), and this module deliberately makes zero edits to
// that already-reviewed, merged PT-4 file to carry zero regression risk
// into it. Only the two genuinely shared, already-exported constants
// (`MAX_SEGMENTS_PER_SYMBOL`, `MAX_SYMBOL_LABEL_LENGTH`) are imported
// rather than redefined, so the two registries can never silently drift
// on those caps.

import { MAX_SEGMENTS_PER_SYMBOL, MAX_SYMBOL_LABEL_LENGTH } from "./workflow-symbols.js";

export { MAX_SEGMENTS_PER_SYMBOL, MAX_SYMBOL_LABEL_LENGTH };

/** Approximates an elliptical arc as a bounded polyline (parametric, not a canvas curve call). Same shape as workflow-symbols.js's own private helper -- see the module doc above for why it's duplicated, not imported. */
function arcPoints(cx, cy, rx, ry, startDeg, endDeg, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = startDeg + ((endDeg - startDeg) * i) / segments;
    const rad = (t * Math.PI) / 180;
    pts.push({ x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) });
  }
  return pts;
}

function closedPoly(points) {
  return { type: "polyline", closed: true, points };
}
function openPoly(points) {
  return { type: "polyline", closed: false, points };
}
function rectPart(x, y, w, h) {
  return { type: "rect", x, y, w, h };
}

// --- Per-symbol local-coordinate geometry builders --------------------
// Each returns an array of "parts" (same shape as workflow-symbols.js's
// own convention) in the local box [0,w] x [0,h]. Pure: same (w, h) in,
// same parts out, every time. Deliberately simple, schematic marks --
// not engineering-grade drafting -- distinguishable at a glance, never
// claiming standards fidelity (see the module doc above).

// -- Rotating equipment (7) --

function centrifugalPumpParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [
    closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)),
    // A small triangle inside pointing right -- the conventional
    // "impeller / flow direction" mark distinguishing a centrifugal
    // pump from the plain generic driver circle.
    closedPoly([
      { x: cx - r * 0.4, y: cy - r * 0.4 },
      { x: cx + r * 0.5, y: cy },
      { x: cx - r * 0.4, y: cy + r * 0.4 },
    ]),
  ];
}

function positiveDisplacementPumpParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [
    closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)),
    // Two short radial ticks (12 and 6 o'clock) -- distinct from the
    // centrifugal pump's triangle, suggesting metered/positive-
    // displacement motion rather than rotodynamic flow.
    openPoly([{ x: cx, y: cy - r }, { x: cx, y: cy - r * 0.4 }]),
    openPoly([{ x: cx, y: cy + r * 0.4 }, { x: cx, y: cy + r }]),
  ];
}

function electricMotorParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [
    closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)),
    // Two parallel vertical lines inside -- a plain abstract "driver"
    // mark, visually distinct from either pump's radial marks.
    openPoly([{ x: cx - r * 0.3, y: cy - r * 0.5 }, { x: cx - r * 0.3, y: cy + r * 0.5 }]),
    openPoly([{ x: cx + r * 0.3, y: cy - r * 0.5 }, { x: cx + r * 0.3, y: cy + r * 0.5 }]),
  ];
}

function centrifugalCompressorParts(w, h) {
  // An asymmetric rounded scroll silhouette -- wider at one end,
  // narrowing at the other -- approximated as a single closed hexagon.
  return [
    closedPoly([
      { x: 0, y: h * 0.25 },
      { x: w * 0.6, y: 0 },
      { x: w, y: h * 0.3 },
      { x: w, y: h * 0.7 },
      { x: w * 0.6, y: h },
      { x: 0, y: h * 0.75 },
    ]),
  ];
}

function reciprocatingCompressorParts(w, h) {
  // A cylinder body plus a small piston-rod stub on one side.
  const bodyW = w * 0.7;
  return [
    rectPart(0, 0, bodyW, h),
    rectPart(bodyW, h * 0.4, w - bodyW, h * 0.2),
  ];
}

function steamTurbineParts(w, h) {
  // A tapering trapezoid -- wide inlet end narrowing toward the outlet,
  // suggesting multi-stage expansion.
  return [
    closedPoly([
      { x: 0, y: 0 },
      { x: w, y: h * 0.3 },
      { x: w, y: h * 0.7 },
      { x: 0, y: h },
    ]),
  ];
}

function genericRotatingDriverParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16))];
}

// -- Vessels / drums / towers (5) --

function verticalVesselOutline(w, h, archDepthRatio) {
  const archDepth = h * archDepthRatio;
  return closedPoly([
    ...arcPoints(w / 2, archDepth, w / 2, archDepth, 180, 360, 8),
    { x: w, y: h - archDepth },
    ...arcPoints(w / 2, h - archDepth, w / 2, archDepth, 0, 180, 8),
    { x: 0, y: archDepth },
  ]);
}

function verticalVesselParts(w, h) {
  return [verticalVesselOutline(w, h, 0.12)];
}

function horizontalDrumOutline(w, h, archDepthRatio) {
  const archDepth = w * archDepthRatio;
  return closedPoly([
    ...arcPoints(archDepth, h / 2, archDepth, h / 2, 90, 270, 8),
    { x: w - archDepth, y: 0 },
    ...arcPoints(w - archDepth, h / 2, archDepth, h / 2, -90, 90, 8),
    { x: archDepth, y: h },
  ]);
}

function horizontalDrumParts(w, h) {
  return [horizontalDrumOutline(w, h, 0.18)];
}

function towerParts(w, h) {
  // Same vertical-vessel outline, plus a couple of internal tray lines
  // (inset from the outline) -- the only thing distinguishing a
  // distillation/absorption tower sketch from a plain vertical vessel.
  const inset = w * 0.15;
  return [
    verticalVesselOutline(w, h, 0.1),
    openPoly([{ x: inset, y: h * 0.4 }, { x: w - inset, y: h * 0.4 }]),
    openPoly([{ x: inset, y: h * 0.65 }, { x: w - inset, y: h * 0.65 }]),
  ];
}

function storageTankParts(w, h) {
  // A shallow-dome roof over a flat-bottomed cylinder -- the
  // conventional atmospheric-tank silhouette, distinct from a
  // pressure-vessel's deeper rounded caps.
  const archDepth = h * 0.08;
  return [
    closedPoly([
      ...arcPoints(w / 2, archDepth, w / 2, archDepth, 180, 360, 6),
      { x: w, y: h },
      { x: 0, y: h },
    ]),
  ];
}

function condenserReceiverParts(w, h) {
  // A squat horizontal-drum outline with one internal baffle line --
  // explicitly a vessel-class icon (see module doc), never implying a
  // heat-transfer performance model.
  return [horizontalDrumOutline(w, h, 0.22), openPoly([{ x: w * 0.5, y: 0 }, { x: w * 0.5, y: h }])];
}

// -- Exchangers, standalone (4) --

function shellAndTubeParts(w, h) {
  const stubW = w * 0.08;
  const parts = [rectPart(stubW, 0, w - stubW * 2, h), rectPart(0, h * 0.3, stubW, h * 0.4), rectPart(w - stubW, h * 0.3, stubW, h * 0.4)];
  const tubeCount = 3;
  for (let i = 1; i <= tubeCount; i++) {
    const y = (h * i) / (tubeCount + 1);
    parts.push(openPoly([{ x: stubW, y }, { x: w - stubW, y }]));
  }
  return parts;
}

function plateExchangerParts(w, h) {
  const n = 4;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: (w * i) / n, y: i % 2 === 0 ? h * 0.25 : h * 0.75 });
  }
  return [rectPart(0, 0, w, h), openPoly(pts)];
}

function airCooledExchangerParts(w, h) {
  const bundleH = h * 0.55;
  return [
    rectPart(0, 0, w, bundleH),
    closedPoly([{ x: w * 0.2, y: bundleH }, { x: w * 0.35, y: h }, { x: w * 0.05, y: h }]),
    closedPoly([{ x: w * 0.65, y: bundleH }, { x: w * 0.8, y: h }, { x: w * 0.5, y: h }]),
  ];
}

function genericExchangerParts(w, h) {
  return [rectPart(0, 0, w, h), openPoly([{ x: 0, y: 0 }, { x: w, y: h }])];
}

// -- Piping & valves, incl. heaters/furnaces (7) --

function flowLineParts(w, h) {
  const midY = h / 2;
  return [
    openPoly([{ x: 0, y: midY }, { x: w * 0.85, y: midY }]),
    // A small chevron arrowhead near the right end -- a short isolated
    // illustrative stroke, never a connectable pipe network (brief).
    openPoly([{ x: w * 0.7, y: midY - h * 0.2 }, { x: w * 0.85, y: midY }, { x: w * 0.7, y: midY + h * 0.2 }]),
  ];
}

function bowtieValveParts(w, h, bottomRatio) {
  const top = h * (1 - bottomRatio);
  return closedPoly([
    { x: 0, y: top },
    { x: w / 2, y: (top + h) / 2 },
    { x: 0, y: h },
    { x: w, y: h },
    { x: w / 2, y: (top + h) / 2 },
    { x: w, y: top },
  ]);
}

function manualValveParts(w, h) {
  return [bowtieValveParts(w, h, 1)];
}

function controlValveParts(w, h) {
  const stemTopY = 0;
  const bowtie = bowtieValveParts(w, h, 0.65);
  const bowtieTopY = h * 0.35;
  return [
    bowtie,
    openPoly([{ x: w / 2, y: bowtieTopY }, { x: w / 2, y: stemTopY }]),
    openPoly([{ x: w * 0.3, y: stemTopY }, { x: w * 0.7, y: stemTopY }]),
  ];
}

function checkValveParts(w, h) {
  const bowtie = bowtieValveParts(w, h, 1);
  const cx = w / 2;
  const cy = h / 2;
  return [bowtie, openPoly([{ x: cx - w * 0.15, y: cy + h * 0.15 }, { x: cx + w * 0.15, y: cy - h * 0.15 }])];
}

function reliefValveParts(w, h) {
  const bowtie = bowtieValveParts(w, h, 0.65);
  const bowtieTopY = h * 0.35;
  return [
    bowtie,
    openPoly([
      { x: w / 2, y: bowtieTopY },
      { x: w / 2, y: 0 },
      { x: w * 0.8, y: 0 },
    ]),
  ];
}

function firedHeaterParts(w, h) {
  const n = 3;
  const pts = [];
  for (let i = 0; i <= n * 2; i++) {
    pts.push({ x: (w * (i + 1)) / (n * 2 + 2), y: i % 2 === 0 ? h * 0.25 : h * 0.75 });
  }
  return [rectPart(0, 0, w, h), openPoly(pts)];
}

function strainerParts(w, h) {
  const parts = [rectPart(0, 0, w, h)];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const offset = (w * i) / n;
    parts.push(openPoly([{ x: offset, y: h }, { x: offset + w / n, y: 0 }]));
  }
  return parts;
}

// -- E&I (6) --

function instrumentBubbleParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16))];
}

function pressureIndicatorParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)), openPoly([{ x: cx, y: cy }, { x: cx + r * 0.6, y: cy - r * 0.6 }])];
}

function temperatureIndicatorParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [
    closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)),
    openPoly([
      { x: cx, y: cy - r * 0.6 },
      { x: cx - r * 0.2, y: cy - r * 0.2 },
      { x: cx + r * 0.2, y: cy + r * 0.2 },
      { x: cx, y: cy + r * 0.6 },
    ]),
  ];
}

function flowIndicatorParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [
    closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)),
    openPoly([{ x: cx - r * 0.3, y: cy - r * 0.3 }, { x: cx + r * 0.3, y: cy }, { x: cx - r * 0.3, y: cy + r * 0.3 }]),
  ];
}

function levelIndicatorParts(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.85;
  return [closedPoly(arcPoints(cx, cy, r, r, 0, 360, 16)), openPoly([{ x: cx - r * 0.5, y: cy + r * 0.4 }, { x: cx + r * 0.5, y: cy + r * 0.4 }])];
}

function controlPanelParts(w, h) {
  return [
    rectPart(0, 0, w, h),
    openPoly([{ x: w * 0.35, y: h * 0.2 }, { x: w * 0.35, y: h * 0.8 }]),
    openPoly([{ x: w * 0.65, y: h * 0.2 }, { x: w * 0.65, y: h * 0.8 }]),
  ];
}

// -- Fin fans / cooling towers (2) --

function finFanCoolerParts(w, h) {
  const bundleH = h * 0.4;
  const cx = w / 2;
  const cy = bundleH + (h - bundleH) / 2;
  const r = Math.min(w, h - bundleH) / 2 * 0.8;
  const parts = [rectPart(0, 0, w, bundleH), closedPoly(arcPoints(cx, cy, r, r, 0, 360, 12))];
  for (let i = 0; i < 4; i++) {
    const deg = i * 90;
    const rad = (deg * Math.PI) / 180;
    parts.push(openPoly([{ x: cx, y: cy }, { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }]));
  }
  return parts;
}

function coolingTowerParts(w, h) {
  // A hyperbolic-silhouette approximation: wide base, waisted middle,
  // slightly flared top -- the conventional cooling-tower outline.
  return [
    closedPoly([
      { x: 0, y: h },
      { x: w, y: h },
      { x: w * 0.65, y: h * 0.4 },
      { x: w * 0.75, y: 0 },
      { x: w * 0.25, y: 0 },
      { x: w * 0.35, y: h * 0.4 },
    ]),
  ];
}

// -- Flare (1) --

function flareStackParts(w, h) {
  const stackW = w * 0.3;
  const stackX = (w - stackW) / 2;
  return [
    rectPart(stackX, h * 0.2, stackW, h * 0.8),
    closedPoly([
      { x: stackX, y: h * 0.2 },
      { x: w / 2, y: 0 },
      { x: stackX + stackW, y: h * 0.2 },
    ]),
  ];
}

// -- Support crafts (3, activity pictograms -- not engineering symbols) --

function scaffoldParts(w, h) {
  return [
    rectPart(0, 0, w, h),
    openPoly([{ x: 0, y: h * 0.35 }, { x: w, y: h * 0.35 }]),
    openPoly([{ x: 0, y: h * 0.7 }, { x: w, y: h * 0.7 }]),
  ];
}

function paintCoatingParts(w, h) {
  return [
    rectPart(0, 0, w, h),
    openPoly([
      { x: 0, y: h * 0.5 },
      { x: w * 0.25, y: h * 0.3 },
      { x: w * 0.5, y: h * 0.5 },
      { x: w * 0.75, y: h * 0.3 },
      { x: w, y: h * 0.5 },
    ]),
  ];
}

function insulationWrapParts(w, h) {
  const band = (y) => {
    const pts = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      pts.push({ x: (w * i) / n, y: y + (i % 2 === 0 ? -h * 0.05 : h * 0.05) });
    }
    return openPoly(pts);
  };
  return [rectPart(0, 0, w, h), band(h * 0.35), band(h * 0.65)];
}

/**
 * The 35-symbol v1 P&ID registry. `id` is namespaced `pid.<family>.<name>`
 * -- never collides with workflow-symbols.js's plain snake_case ids.
 * `category` holds the exact subgroup header text the brief names
 * (Rotating / Vessels / Exchangers / Piping & Valves / E&I / Cooling /
 * Flare / Support Crafts), used by the UI palette to render the P&ID
 * subgroup fieldsets.
 */
export const PID_SYMBOLS = Object.freeze([
  // Rotating equipment (7)
  { id: "pid.rotating.centrifugal_pump", name: "Centrifugal pump", category: "Rotating", description: "A rotodynamic pump driven by a rotating impeller.", minWidth: 30, minHeight: 30, defaultWidth: 70, defaultHeight: 70, buildParts: centrifugalPumpParts },
  { id: "pid.rotating.positive_displacement_pump", name: "Positive-displacement pump", category: "Rotating", description: "A pump that moves a fixed fluid volume per cycle, e.g. gear or piston.", minWidth: 30, minHeight: 30, defaultWidth: 70, defaultHeight: 70, buildParts: positiveDisplacementPumpParts },
  { id: "pid.rotating.electric_motor", name: "Electric motor", category: "Rotating", description: "A generic electric driver for rotating equipment.", minWidth: 30, minHeight: 30, defaultWidth: 70, defaultHeight: 70, buildParts: electricMotorParts },
  { id: "pid.rotating.centrifugal_compressor", name: "Centrifugal compressor", category: "Rotating", description: "A rotodynamic compressor for continuous gas compression.", minWidth: 40, minHeight: 30, defaultWidth: 100, defaultHeight: 60, buildParts: centrifugalCompressorParts },
  { id: "pid.rotating.reciprocating_compressor", name: "Reciprocating compressor", category: "Rotating", description: "A piston-driven positive-displacement gas compressor.", minWidth: 40, minHeight: 24, defaultWidth: 100, defaultHeight: 50, buildParts: reciprocatingCompressorParts },
  { id: "pid.rotating.steam_turbine", name: "Steam turbine", category: "Rotating", description: "A multi-stage expansion driver powered by steam.", minWidth: 40, minHeight: 30, defaultWidth: 100, defaultHeight: 60, buildParts: steamTurbineParts },
  { id: "pid.rotating.generic_driver", name: "Generic rotating driver", category: "Rotating", description: "An unspecified rotating driver, used when the specific type is not relevant.", minWidth: 30, minHeight: 30, defaultWidth: 70, defaultHeight: 70, buildParts: genericRotatingDriverParts },

  // Vessels / drums / towers (5)
  { id: "pid.vessel.vertical_vessel", name: "Vertical vessel", category: "Vessels", description: "A generic vertical pressure vessel.", minWidth: 30, minHeight: 50, defaultWidth: 70, defaultHeight: 110, buildParts: verticalVesselParts },
  { id: "pid.vessel.horizontal_drum", name: "Horizontal drum", category: "Vessels", description: "A generic horizontal pressure drum.", minWidth: 50, minHeight: 30, defaultWidth: 120, defaultHeight: 60, buildParts: horizontalDrumParts },
  { id: "pid.vessel.tower", name: "Distillation / absorption tower", category: "Vessels", description: "A tall vessel with internal trays or packing for separation.", minWidth: 30, minHeight: 60, defaultWidth: 80, defaultHeight: 130, buildParts: towerParts },
  { id: "pid.vessel.storage_tank", name: "Storage tank (atmospheric)", category: "Vessels", description: "An atmospheric-pressure storage tank with a shallow roof.", minWidth: 50, minHeight: 30, defaultWidth: 110, defaultHeight: 60, buildParts: storageTankParts },
  { id: "pid.vessel.condenser_receiver", name: "Condenser vessel / receiver", category: "Vessels", description: "A vessel-class icon for a condenser drum or receiver -- not a heat-transfer performance model.", minWidth: 40, minHeight: 24, defaultWidth: 90, defaultHeight: 50, buildParts: condenserReceiverParts },

  // Exchangers -- standalone (4)
  { id: "pid.exchanger.shell_and_tube", name: "Shell-and-tube exchanger", category: "Exchangers", description: "A shell-and-tube heat exchanger, shown generically.", minWidth: 50, minHeight: 24, defaultWidth: 110, defaultHeight: 50, buildParts: shellAndTubeParts },
  { id: "pid.exchanger.plate", name: "Plate exchanger", category: "Exchangers", description: "A plate-type heat exchanger.", minWidth: 40, minHeight: 30, defaultWidth: 90, defaultHeight: 60, buildParts: plateExchangerParts },
  { id: "pid.exchanger.air_cooled", name: "Air-cooled exchanger", category: "Exchangers", description: "An air-cooled (fin-fan-style) exchanger, shown as a standalone exchanger.", minWidth: 50, minHeight: 30, defaultWidth: 100, defaultHeight: 60, buildParts: airCooledExchangerParts },
  { id: "pid.exchanger.generic", name: "Generic exchanger", category: "Exchangers", description: "An unspecified heat exchanger, used when the type is not relevant.", minWidth: 30, minHeight: 24, defaultWidth: 80, defaultHeight: 50, buildParts: genericExchangerParts },

  // Piping & valves, incl. heaters/furnaces (7)
  { id: "pid.piping.flow_line", name: "Process pipe / flow line", category: "Piping & Valves", description: "A short illustrative pipe segment -- not a connectable pipe network.", minWidth: 40, minHeight: 16, defaultWidth: 100, defaultHeight: 30, buildParts: flowLineParts },
  { id: "pid.piping.manual_valve", name: "Manual isolation valve", category: "Piping & Valves", description: "A manually-operated isolation valve.", minWidth: 24, minHeight: 20, defaultWidth: 50, defaultHeight: 40, buildParts: manualValveParts },
  { id: "pid.piping.control_valve", name: "Control valve", category: "Piping & Valves", description: "An automatically-actuated control valve.", minWidth: 24, minHeight: 30, defaultWidth: 50, defaultHeight: 60, buildParts: controlValveParts },
  { id: "pid.piping.check_valve", name: "Check valve", category: "Piping & Valves", description: "A one-way (non-return) valve.", minWidth: 24, minHeight: 20, defaultWidth: 50, defaultHeight: 40, buildParts: checkValveParts },
  { id: "pid.piping.relief_valve", name: "Relief / safety valve", category: "Piping & Valves", description: "A pressure relief or safety valve with a discharge vent.", minWidth: 24, minHeight: 30, defaultWidth: 50, defaultHeight: 60, buildParts: reliefValveParts },
  { id: "pid.piping.fired_heater", name: "Fired heater / furnace", category: "Piping & Valves", description: "A fired process heater or furnace.", minWidth: 40, minHeight: 30, defaultWidth: 100, defaultHeight: 60, buildParts: firedHeaterParts },
  { id: "pid.piping.strainer", name: "Inline strainer / filter", category: "Piping & Valves", description: "An inline strainer or filter element.", minWidth: 30, minHeight: 24, defaultWidth: 60, defaultHeight: 50, buildParts: strainerParts },

  // E&I (6)
  { id: "pid.ei.instrument_bubble", name: "Instrument bubble", category: "E&I", description: "A generic field or panel instrument, with no implied live reading or tag.", minWidth: 24, minHeight: 24, defaultWidth: 50, defaultHeight: 50, buildParts: instrumentBubbleParts },
  { id: "pid.ei.pressure_indicator", name: "Pressure indicator", category: "E&I", description: "A pressure-indicating instrument, shown schematically.", minWidth: 24, minHeight: 24, defaultWidth: 50, defaultHeight: 50, buildParts: pressureIndicatorParts },
  { id: "pid.ei.temperature_indicator", name: "Temperature indicator", category: "E&I", description: "A temperature-indicating instrument, shown schematically.", minWidth: 24, minHeight: 24, defaultWidth: 50, defaultHeight: 50, buildParts: temperatureIndicatorParts },
  { id: "pid.ei.flow_indicator", name: "Flow indicator", category: "E&I", description: "A flow-indicating instrument, shown schematically.", minWidth: 24, minHeight: 24, defaultWidth: 50, defaultHeight: 50, buildParts: flowIndicatorParts },
  { id: "pid.ei.level_indicator", name: "Level indicator", category: "E&I", description: "A level-indicating instrument, shown schematically.", minWidth: 24, minHeight: 24, defaultWidth: 50, defaultHeight: 50, buildParts: levelIndicatorParts },
  { id: "pid.ei.control_panel", name: "Electrical control panel", category: "E&I", description: "A generic electrical or instrument control panel face.", minWidth: 40, minHeight: 30, defaultWidth: 90, defaultHeight: 60, buildParts: controlPanelParts },

  // Fin fans / cooling towers (2)
  { id: "pid.cooling.fin_fan_cooler", name: "Fin-fan cooler", category: "Cooling", description: "A fan-driven air-cooled bundle, shown as a cooling-family icon.", minWidth: 50, minHeight: 40, defaultWidth: 100, defaultHeight: 80, buildParts: finFanCoolerParts },
  { id: "pid.cooling.cooling_tower", name: "Cooling tower", category: "Cooling", description: "An evaporative cooling tower.", minWidth: 30, minHeight: 40, defaultWidth: 80, defaultHeight: 90, buildParts: coolingTowerParts },

  // Flare (1)
  { id: "pid.flare.flare_stack", name: "Flare stack", category: "Flare", description: "A flare stack for controlled combustion of relieved gas.", minWidth: 20, minHeight: 50, defaultWidth: 40, defaultHeight: 110, buildParts: flareStackParts },

  // Support crafts (3) -- workflow activity pictograms, not engineering symbols
  { id: "pid.support.scaffold", name: "Scaffold / work platform", category: "Support Crafts", description: "Workflow activity pictogram for scaffold or platform work -- not a canonical P&ID engineering symbol.", minWidth: 30, minHeight: 30, defaultWidth: 70, defaultHeight: 70, buildParts: scaffoldParts },
  { id: "pid.support.paint_coating", name: "Paint / coating", category: "Support Crafts", description: "Workflow activity pictogram for paint or coating application -- not a canonical P&ID engineering symbol.", minWidth: 30, minHeight: 24, defaultWidth: 70, defaultHeight: 50, buildParts: paintCoatingParts },
  { id: "pid.support.insulation_wrap", name: "Insulation wrap", category: "Support Crafts", description: "Workflow activity pictogram for insulation wrapping -- not a canonical P&ID engineering symbol.", minWidth: 30, minHeight: 24, defaultWidth: 70, defaultHeight: 50, buildParts: insulationWrapParts },
]);

/** The exact allowlisted registry size -- enforced by this module's own tests, not just asserted in a comment. */
export const PID_SYMBOL_COUNT = 35;

const PID_SYMBOLS_BY_ID = new Map(PID_SYMBOLS.map((s) => [s.id, s]));

export class PidSymbolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PidSymbolError";
    this.code = code;
  }
}

export function symbolDefinition(symbolType) {
  const def = PID_SYMBOLS_BY_ID.get(symbolType);
  if (!def) {
    throw new PidSymbolError("unknown-symbol", `unknown P&ID symbol type: ${symbolType}`);
  }
  return def;
}

/** Total straight-segment count a symbol's parts would emit -- enforced against MAX_SEGMENTS_PER_SYMBOL, same accounting convention as workflow-symbols.js. */
function countSegments(parts) {
  let n = 0;
  for (const part of parts) {
    if (part.type === "rect") n += 4;
    else if (part.type === "polyline") n += Math.max(0, part.points.length - 1) + (part.closed ? 1 : 0);
  }
  return n;
}

/**
 * Validates placement (`w`/`h` against the symbol's own minimums) and an
 * optional label, returning the normalized, stored shape of a `symbol`
 * markup item: `{ symbolType, w, h, label }`. Identical contract to
 * workflow-symbols.js's own `validateSymbolPlacement` -- bounds against
 * the overall markup canvas (`x`, `y` too) are the caller's job
 * (process-guide-markup.js, via the shared symbol-registry.js adapter).
 * Fails closed (never clamps/shrinks) on anything invalid.
 */
export function validateSymbolPlacement(symbolType, { w, h, label }) {
  const def = symbolDefinition(symbolType);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < def.minWidth || h < def.minHeight) {
    throw new PidSymbolError(
      "invalid-size",
      `${symbolType} requires w >= ${def.minWidth} and h >= ${def.minHeight}`
    );
  }
  let normalizedLabel;
  if (label === undefined || label === null || label === "") {
    normalizedLabel = null;
  } else {
    const trimmed = String(label).trim();
    if (trimmed.length === 0) {
      normalizedLabel = null;
    } else if (trimmed.length > MAX_SYMBOL_LABEL_LENGTH) {
      throw new PidSymbolError(
        "invalid-label",
        `symbol label exceeds ${MAX_SYMBOL_LABEL_LENGTH} characters`
      );
    } else {
      normalizedLabel = trimmed;
    }
  }
  const parts = def.buildParts(w, h);
  const segments = countSegments(parts);
  if (segments > MAX_SEGMENTS_PER_SYMBOL) {
    // Unreachable with this fixed registry's own geometry functions
    // (none come close to the cap), kept as a real, enforced invariant
    // rather than an assumption -- same stance as workflow-symbols.js.
    throw new PidSymbolError(
      "too-complex",
      `${symbolType} geometry exceeds ${MAX_SEGMENTS_PER_SYMBOL} segments`
    );
  }
  return { symbolType, w, h, label: normalizedLabel };
}

const SYMBOL_COLOR = Object.freeze({ r: 61, g: 118, b: 217, a: 255 });
const SYMBOL_STROKE_WIDTH = 2;
/** Same inset convention as workflow-symbols.js's LABEL_INSET -- safely below every registry symbol's minWidth/minHeight (smallest is 16px, for flow_line's minHeight). */
const LABEL_INSET = 4;

function partsToDrawOps(parts, id, color, strokeWidth) {
  const ops = [];
  for (const part of parts) {
    if (part.type === "rect") {
      ops.push({ op: "rect", id, x: part.x, y: part.y, w: part.w, h: part.h, color, strokeWidth });
    } else if (part.type === "polyline") {
      const pts = part.points;
      for (let i = 0; i < pts.length - 1; i++) {
        ops.push({ op: "line", id, x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, color, strokeWidth });
      }
      if (part.closed && pts.length > 1) {
        const a = pts[pts.length - 1];
        const b = pts[0];
        ops.push({ op: "line", id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, strokeWidth });
      }
    }
  }
  return ops;
}

/**
 * Turns a validated `{ id, symbolType, x, y, w, h, label }` shape into
 * draw ops in `drawOpsToCanvas`'s own vocabulary (`rect`/`line`/`text`
 * only), translated into the caller's placement (`x`, `y`). Pure: no
 * canvas calls here. Identical label-bounding contract to
 * workflow-symbols.js's own `symbolToDrawOps` (inset inside the box,
 * `maxWidth` constrained to the box's own usable interior width) --
 * both registries lean on the same already-reviewed renderer fix in
 * annotations-render.js, not a per-registry reimplementation of it.
 */
export function symbolToDrawOps(shape) {
  const def = symbolDefinition(shape.symbolType);
  const localParts = def.buildParts(shape.w, shape.h);
  const translated = localParts.map((part) =>
    part.type === "rect"
      ? { ...part, x: part.x + shape.x, y: part.y + shape.y }
      : { ...part, points: part.points.map((p) => ({ x: p.x + shape.x, y: p.y + shape.y })) }
  );
  const ops = partsToDrawOps(translated, shape.id, SYMBOL_COLOR, SYMBOL_STROKE_WIDTH);
  if (shape.label) {
    ops.push({
      op: "text",
      id: shape.id,
      x: shape.x + LABEL_INSET,
      y: shape.y + shape.h - LABEL_INSET,
      maxWidth: Math.max(shape.w - LABEL_INSET * 2, 1),
      color: SYMBOL_COLOR,
      text: shape.label,
    });
  }
  return ops;
}
