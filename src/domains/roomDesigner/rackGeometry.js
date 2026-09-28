// rackGeometry.js — parametric pipe racks and sleeper racks (pure).
//
// A rack is a process-equipment symbol whose catalog entry carries
// `rack: { kind: "pipe" | "sleeper", ...defaults }`. The instance's
// widthIn/depthIn are the rack's length/width on the plan; an optional
// instance `rack` object overrides tiers, top-of-steel elevation of the
// first tier, spacing between tiers, and bent (or sleeper) spacing. From
// those, rackMembers3D() yields structural members for the 3D view and
// rackBentOffsets() the column lines for the plan and print — so a rack of
// any length, height or tier count stays true steel, with no model file.
//
// Local frame: x along the rack (-L/2..L/2), z across (-W/2..W/2), y up.

import { feetInchesLabel } from "./designerGeometry";
import { findSymbol } from "./symbolRegistry";

/** Allowed ranges [min, max] (inches / count) per rack kind. */
export const RACK_LIMITS = Object.freeze({
  pipe: Object.freeze({ tiers: [1, 5], elevationIn: [84, 720], tierSpacingIn: [36, 180], bentSpacingIn: [96, 480] }),
  sleeper: Object.freeze({ tiers: [1, 1], elevationIn: [6, 60], tierSpacingIn: [36, 180], bentSpacingIn: [48, 360] }),
});

const FIELDS = Object.freeze(["tiers", "elevationIn", "tierSpacingIn", "bentSpacingIn"]);

// Nominal steel sizes (inches) — planning geometry, not a structural design.
const STEEL = Object.freeze({ column: 10, beamDepth: 12, beamFlange: 8, strutDepth: 8, strutWidth: 6, brace: 5, sleeper: 12, pier: 18 });

function inRange(kind, field, value) {
  const [lo, hi] = RACK_LIMITS[kind][field];
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  return field === "tiers" ? ok && Number.isInteger(value) : ok;
}

/** Effective rack parameters for an instance of a rack symbol. */
export function rackParams(symbol, instance = {}) {
  const defaults = symbol.rack;
  const kind = defaults.kind;
  const out = {
    kind,
    lengthIn: instance.widthIn ?? symbol.widthIn,
    widthIn: instance.depthIn ?? symbol.depthIn,
  };
  for (const f of FIELDS) {
    const v = instance.rack?.[f];
    out[f] = v !== undefined && inRange(kind, f, v) ? v : defaults[f];
  }
  if (kind === "sleeper") out.tiers = 1;
  return out;
}

/** Bent (or sleeper) positions along the rack: evenly spaced, both ends, spans <= spacing. */
export function rackBentOffsets(lengthIn, spacingIn) {
  const spans = Math.max(1, Math.ceil(lengthIn / spacingIn - 1e-9));
  const step = lengthIn / spans;
  return Array.from({ length: spans + 1 }, (_, i) => -lengthIn / 2 + i * step);
}

export function rackTierElevations(p) {
  return Array.from({ length: p.tiers }, (_, i) => p.elevationIn + i * p.tierSpacingIn);
}

/** Top of steel of the highest tier. */
export function rackTopIn(p) {
  return p.elevationIn + (p.tiers - 1) * p.tierSpacingIn;
}

const box = (kind, x, y, z, sx, sy, sz, rotX = 0) => ({ kind, x, y, z, sx, sy, sz, rotX });

/** Structural members as boxes: { kind, x, y, z (centre), sx, sy, sz, rotX }. */
export function rackMembers3D(p) {
  const bents = rackBentOffsets(p.lengthIn, p.bentSpacingIn);
  const out = [];
  if (p.kind === "sleeper") {
    const pierH = p.elevationIn - STEEL.sleeper;
    for (const x of bents) {
      const sx = Math.min(STEEL.sleeper, p.lengthIn / 2);
      const cx = clampX(x, sx, p.lengthIn);
      out.push(box("sleeper", cx, p.elevationIn - STEEL.sleeper / 2, 0, sx, STEEL.sleeper, p.widthIn));
      if (pierH > 0.5) {
        for (const side of [-1, 1]) {
          const px = Math.min(STEEL.pier, p.lengthIn / 2);
          out.push(box("pier", clampX(x, px, p.lengthIn), pierH / 2, side * (p.widthIn / 2 - STEEL.pier / 2), px, pierH, STEEL.pier));
        }
      }
    }
    return out;
  }

  const top = rackTopIn(p);
  const colZ = p.widthIn / 2 - STEEL.column / 2;
  const tiers = rackTierElevations(p);
  for (const x of bents) {
    const cx = clampX(x, STEEL.column, p.lengthIn);
    for (const side of [-1, 1]) out.push(box("column", cx, top / 2, side * colZ, STEEL.column, top, STEEL.column));
    for (const elev of tiers) {
      out.push(box("beam", cx, elev - STEEL.beamDepth / 2, 0, STEEL.beamFlange, STEEL.beamDepth, p.widthIn));
    }
    // Knee braces under the lowest beam, one per column, 45° in the bent's plane.
    const knee = Math.min(36, p.widthIn / 4);
    const braceLen = knee * Math.SQRT2;
    const yMid = tiers[0] - STEEL.beamDepth - knee / 2;
    for (const side of [-1, 1]) {
      const zMid = side * (p.widthIn / 2 - STEEL.column - knee / 2);
      out.push(box("brace", cx, yMid, zMid, STEEL.brace, braceLen, STEEL.brace, side * (Math.PI / 4)));
    }
  }
  // Longitudinal struts along both column lines at every tier, bay by bay.
  for (let i = 0; i + 1 < bents.length; i++) {
    const span = bents[i + 1] - bents[i] - STEEL.column;
    const cx = (bents[i] + bents[i + 1]) / 2;
    for (const elev of tiers) {
      for (const side of [-1, 1]) {
        out.push(box("strut", cx, elev - STEEL.strutDepth / 2, side * colZ, span, STEEL.strutDepth, STEEL.strutWidth));
      }
    }
  }
  return out;
}

// A member centred on an end bent is pulled inward so it stays inside the
// rack's footprint (the plan outline is the rack's true extent).
function clampX(x, sx, lengthIn) {
  const lim = lengthIn / 2 - sx / 2;
  return Math.max(-lim, Math.min(lim, x));
}

/** Drawing note for the plan: TOS elevation and tiers. */
export function rackLabel(p) {
  if (p.kind === "sleeper") return `SLEEPERS · TOS EL ${feetInchesLabel(p.elevationIn)}`;
  const tiers = p.tiers === 1 ? "1 tier" : `${p.tiers} tiers @ ${feetInchesLabel(p.tierSpacingIn)}`;
  return `TOS EL ${feetInchesLabel(p.elevationIn)} · ${tiers}`;
}

/**
 * Patch a rack instance's parameters (tiers, elevationIn, tierSpacingIn,
 * bentSpacingIn). Only the given fields are stored; each must be in range
 * for the rack kind.
 */
export function setRackParams(design, instanceId, patch = {}) {
  const inst = (design.symbols || []).find((s) => s.id === instanceId);
  if (!inst) throw new Error(`Unknown symbol instance: ${instanceId}`);
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (!symbol?.rack) throw new Error(`${inst.symbolId} is not a rack.`);
  const kind = symbol.rack.kind;
  const next = { ...(inst.rack || {}) };
  for (const f of FIELDS) {
    if (patch[f] === undefined) continue;
    if (!inRange(kind, f, patch[f])) {
      const [lo, hi] = RACK_LIMITS[kind][f];
      const name = f === "elevationIn" ? "Elevation" : f;
      throw new Error(`${name} must be between ${lo} and ${hi} for a ${kind} rack.`);
    }
    next[f] = patch[f];
  }
  return { ...design, symbols: design.symbols.map((s) => (s.id === instanceId ? { ...s, rack: next } : s)) };
}

/** Problems with stored rack parameters (for validateDesign). */
export function rackErrors(design) {
  const errors = [];
  for (const inst of design.symbols || []) {
    if (inst.rack === undefined) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.rack) {
      errors.push(`Symbol ${inst.id} has rack settings but is not a rack.`);
      continue;
    }
    for (const f of FIELDS) {
      const v = inst.rack[f];
      if (v !== undefined && !inRange(symbol.rack.kind, f, v)) errors.push(`Rack ${inst.id} has out-of-range ${f} ${v}.`);
    }
  }
  return errors;
}
