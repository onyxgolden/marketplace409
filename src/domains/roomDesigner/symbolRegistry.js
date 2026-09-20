// Domain-extensible symbol registry for the FORGE room/layout designer.
//
// A "symbol set" is a named collection of placeable symbols registered per
// domain — e.g. "furniture" or "rooms". Each set declares its symbols, their
// default sizes, and optionally custom 2D draw routines. The 2D canvas renders
// registered symbols through the registry (see
// src/components/designer/symbolDrawRoutines.jsx), so a new domain is added
// by registering a set — no changes to the canvas, reducer, or persistence
// code. The registration pattern (Phase 2 example: a "piping" domain with
// pipes, valves, fittings, pumps, tanks, and flow arrows) is documented at
// the bottom of furnitureCatalog.js.
//
// The registry is pure data + lookup: no React, no canvas, no persistence.
// Symbol *instances* (placements) keep living in the design document
// (design.furniture, design.rooms, ...); the registry only describes what
// can be placed and how it draws in 2D.

const sets = new Map();

function assertSymbol(domain, symbol, index) {
  const where = `symbol set "${domain}" symbol #${index}`;
  if (!symbol || typeof symbol !== "object") throw new Error(`${where}: must be an object.`);
  if (typeof symbol.id !== "string" || !symbol.id.trim()) {
    throw new Error(`${where}: id must be a non-empty string.`);
  }
  if (typeof symbol.label !== "string" || !symbol.label.trim()) {
    throw new Error(`${where}: label must be a non-empty string.`);
  }
  for (const dim of ["widthIn", "depthIn"]) {
    if (!(typeof symbol[dim] === "number" && symbol[dim] > 0)) {
      throw new Error(`${where} ("${symbol.id}"): ${dim} must be a positive number.`);
    }
  }
  if (symbol.draw2D !== undefined && typeof symbol.draw2D !== "function") {
    throw new Error(`${where} ("${symbol.id}"): draw2D must be a function.`);
  }
}

/**
 * Register a symbol set: { domain, title, symbols: [{ id, label, widthIn,
 * depthIn, ...extras }] }. Extras are free-form (color, category, shape,
 * heightIn, draw2D, ...) and travel with the symbol to draw routines.
 * Throws when the domain is already registered or a symbol is invalid.
 */
export function registerSymbolSet(set) {
  if (!set || typeof set !== "object") throw new Error("Symbol set must be an object.");
  const { domain, title, symbols } = set;
  if (typeof domain !== "string" || !domain.trim()) {
    throw new Error("Symbol set domain must be a non-empty string.");
  }
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Symbol set title must be a non-empty string.");
  }
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error(`Symbol set "${domain}" needs a non-empty symbols array.`);
  }
  if (sets.has(domain)) throw new Error(`Symbol set already registered: "${domain}".`);
  const seen = new Set();
  symbols.forEach((symbol, i) => {
    assertSymbol(domain, symbol, i);
    if (seen.has(symbol.id)) throw new Error(`Symbol set "${domain}": duplicate symbol id "${symbol.id}".`);
    seen.add(symbol.id);
  });
  const frozen = Object.freeze({
    domain,
    title,
    symbols: Object.freeze(symbols.map((s) => Object.freeze({ ...s }))),
  });
  sets.set(domain, frozen);
  return frozen;
}

/** The registered set for a domain, or undefined when unknown. */
export function getSymbolSet(domain) {
  return sets.get(domain);
}

/** All registered sets, in registration order. */
export function listSymbolSets() {
  return [...sets.values()];
}

/** Find a symbol by domain + id; undefined when unknown. */
export function findSymbol(domain, id) {
  return getSymbolSet(domain)?.symbols.find((s) => s.id === id);
}

/**
 * Reset the registry. Test-only: production code registers each domain
 * exactly once at module load.
 */
export function __resetSymbolRegistry() {
  sets.clear();
}
