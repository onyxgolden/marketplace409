// Optional TEMA fields on placed symbol instances.
//
// Instances keep their established shape { id, domain, symbolId, x, y,
// rotationDeg, layer, tag?, widthIn?, depthIn? }; TEMA adds two OPTIONAL
// fields, so the design version does not change and old drawings load and
// render exactly as before:
//   tema:        { front, shell, rear, tubePasses } — configurable exchanger only
//   drawingMode: "detailed" | "pid"                 — symbols with two drawings;
//                absent means the catalog default look.
//
// Pure and framework-free; each operation returns a new design.

import { findSymbol } from "./symbolRegistry";
import { detailedVersionFor } from "./temaExchangerCatalog";
import { temaAnchorsWorld } from "./temaGeometry";
import { normalizeTemaConfig, validateTemaConfig } from "./temaTypes";

export const DRAWING_MODES = Object.freeze(["detailed", "pid"]);

function updateInstance(design, instanceId, update) {
  let changed = false;
  const symbols = (design.symbols || []).map((s) => {
    if (s.id !== instanceId) return s;
    changed = true;
    return update(s);
  });
  if (!changed) throw new Error(`Unknown symbol instance: ${instanceId}`);
  return { ...design, symbols };
}

function instanceAndSymbol(design, instanceId) {
  const inst = (design.symbols || []).find((s) => s.id === instanceId);
  if (!inst) throw new Error(`Unknown symbol instance: ${instanceId}`);
  return { inst, symbol: findSymbol(inst.domain, inst.symbolId) };
}

const isAssembly = (symbol) => symbol?.tema?.kind === "assembly";

/** True when the symbol has both a detailed and a simplified P&ID drawing. */
export function supportsDrawingModes(symbol) {
  return Boolean(symbol?.tema);
}

/** The instance's drawing mode ("detailed" | "pid"), or null for single-drawing symbols. */
export function instanceDrawingMode(symbol, instance) {
  if (!supportsDrawingModes(symbol)) return null;
  return DRAWING_MODES.includes(instance?.drawingMode) ? instance.drawingMode : symbol.tema.defaultMode || "detailed";
}

/** Extra fields to store when placing `symbol`: the default configuration for a configurable exchanger. */
export function initialTemaFields(symbol) {
  return isAssembly(symbol) ? { tema: { ...symbol.tema.defaultConfig } } : {};
}

/** Save a TEMA configuration on a configurable exchanger. Throws on blocked combinations. */
export function setSymbolTemaConfig(design, instanceId, config) {
  const { symbol } = instanceAndSymbol(design, instanceId);
  if (!isAssembly(symbol)) throw new Error("Only a configurable TEMA exchanger has a TEMA configuration.");
  const result = validateTemaConfig(config);
  if (!result.valid) throw new Error(result.errors.map((e) => e.message).join(" "));
  const tema = normalizeTemaConfig(config);
  return updateInstance(design, instanceId, (s) => ({ ...s, tema }));
}

/** Switch between the detailed and P&ID drawing; configuration, size, rotation and anchors are untouched. */
export function setSymbolDrawingMode(design, instanceId, mode) {
  if (!DRAWING_MODES.includes(mode)) throw new Error(`Drawing mode must be one of ${DRAWING_MODES.join(", ")}.`);
  const { symbol } = instanceAndSymbol(design, instanceId);
  if (!supportsDrawingModes(symbol)) throw new Error("This symbol has only one drawing.");
  return updateInstance(design, instanceId, (s) => ({ ...s, drawingMode: mode }));
}

/** Set the instance footprint (either or both of widthIn / depthIn, in inches). */
export function setSymbolSize(design, instanceId, { widthIn, depthIn } = {}) {
  for (const v of [widthIn, depthIn]) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new Error("Symbol size must be a positive number.");
  }
  instanceAndSymbol(design, instanceId);
  return updateInstance(design, instanceId, (s) => ({
    ...s,
    ...(widthIn !== undefined ? { widthIn } : {}),
    ...(depthIn !== undefined ? { depthIn } : {}),
  }));
}

/**
 * Replace a simple symbol with its detailed version in place: same id,
 * position, rotation, layer and tag; the current footprint (instance
 * override or catalog nominal) is kept as the new instance size.
 */
export function replaceWithDetailedVersion(design, instanceId) {
  const { inst, symbol } = instanceAndSymbol(design, instanceId);
  const target = detailedVersionFor(inst.domain, inst.symbolId);
  if (!target) throw new Error("This symbol has no detailed version.");
  return updateInstance(design, instanceId, (s) => {
    const next = {
      ...s,
      symbolId: target.symbolId,
      widthIn: s.widthIn ?? symbol.widthIn,
      depthIn: s.depthIn ?? symbol.depthIn,
      tema: target.tema,
    };
    delete next.drawingMode; // the detailed version's default look
    return next;
  });
}

/** validateDesign messages for an instance's optional TEMA fields. */
export function temaInstanceErrors(instance, symbol) {
  const errors = [];
  if (instance.tema !== undefined) {
    if (!isAssembly(symbol)) {
      errors.push(`Symbol ${instance.id} has a TEMA configuration but is not a configurable TEMA exchanger.`);
    } else {
      const result = validateTemaConfig(instance.tema);
      if (!result.valid) errors.push(`Symbol ${instance.id}: ${result.errors.map((e) => e.message).join(" ")}`);
    }
  }
  if (instance.drawingMode !== undefined && !DRAWING_MODES.includes(instance.drawingMode)) {
    errors.push(`Symbol ${instance.id} has an unknown drawing mode.`);
  }
  return errors;
}

/**
 * The closest connection anchor (nozzle flange face) to `point` within
 * `radiusIn` plan inches, across every placed symbol that has anchors:
 * { symbolInstanceId, anchorId, x, y, distance } or null. Anchors are the
 * same in both drawing modes, so a pipe snapped to one stays put when the
 * symbol switches between detailed and P&ID.
 */
export function nearestConnectionAnchor(design, point, radiusIn) {
  let best = null;
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.tema) continue;
    for (const a of temaAnchorsWorld(symbol, inst)) {
      const distance = Math.hypot(a.x - point.x, a.y - point.y);
      if (distance <= radiusIn && (!best || distance < best.distance)) {
        best = { symbolInstanceId: inst.id, anchorId: a.id, x: a.x, y: a.y, distance };
      }
    }
  }
  return best;
}
