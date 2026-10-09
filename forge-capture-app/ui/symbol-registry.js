// FORGE Capture — shared symbol-registry adapter (ui/symbol-registry.js).
//
// PT-5 brief ("exposed to a single shared registry/validation adapter"):
// `workflow-symbols.js` (PT-4, 17 ISO 5807 symbols, plain snake_case
// ids) and `pid-symbols.js` (PT-5, 35 P&ID-inspired symbols, namespaced
// `pid.<family>.<name>` ids) are two separate, independent registries --
// neither imports the other, and neither is edited by this module. This
// file is the ONLY place that knows both exist: it dispatches by the
// `symbolType` string's own shape (a `pid.` prefix routes to
// pid-symbols.js; anything else routes to workflow-symbols.js, which is
// exactly how PT-4's existing ids are already spelled -- no PT-4 id
// collides with the `pid.` prefix, checked by this module's own tests).
//
// process-guide-markup.js imports ONLY from this module, never directly
// from either registry -- so it never needs to know there are two of
// them, and workflow-symbols.js (already reviewed and merged) needed
// zero edits to gain a sibling registry.
//
// Error normalization: the two registries throw their own distinct
// error classes (`WorkflowSymbolError`, `PidSymbolError`). This module
// catches both and rethrows a single `SymbolRegistryError`, so callers
// (process-guide-markup.js) only ever need to catch one type, the same
// way they only ever call one set of functions.

import {
  WORKFLOW_SYMBOLS,
  WorkflowSymbolError,
  symbolDefinition as workflowSymbolDefinition,
  validateSymbolPlacement as workflowValidatePlacement,
  symbolToDrawOps as workflowSymbolToDrawOps,
} from "./workflow-symbols.js";
import {
  PID_SYMBOLS,
  PidSymbolError,
  symbolDefinition as pidSymbolDefinition,
  validateSymbolPlacement as pidValidatePlacement,
  symbolToDrawOps as pidSymbolToDrawOps,
} from "./pid-symbols.js";

export { WORKFLOW_SYMBOLS, PID_SYMBOLS };

export class SymbolRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SymbolRegistryError";
    this.code = code;
  }
}

/** True for a PT-5 P&ID symbolType; false (including non-string input) for everything else, including every PT-4 workflow symbolType. */
export function isPidSymbolType(symbolType) {
  return typeof symbolType === "string" && symbolType.startsWith("pid.");
}

function moduleFor(symbolType) {
  return isPidSymbolType(symbolType)
    ? { symbolDefinition: pidSymbolDefinition, validateSymbolPlacement: pidValidatePlacement, symbolToDrawOps: pidSymbolToDrawOps }
    : { symbolDefinition: workflowSymbolDefinition, validateSymbolPlacement: workflowValidatePlacement, symbolToDrawOps: workflowSymbolToDrawOps };
}

function rethrowNormalized(e) {
  if (e instanceof WorkflowSymbolError || e instanceof PidSymbolError) {
    throw new SymbolRegistryError(e.code, e.message);
  }
  throw e;
}

/** Looks up a symbol's definition in whichever registry owns its id. Throws `SymbolRegistryError` on an unknown id (fails closed, same as either registry alone). */
export function symbolDefinition(symbolType) {
  try {
    return moduleFor(symbolType).symbolDefinition(symbolType);
  } catch (e) {
    return rethrowNormalized(e);
  }
}

/** Same non-throwing lookup, for UI call sites that already use `?.` fallback behavior (e.g. "unknown symbol" display) rather than a hard failure. */
export function findSymbolDefinition(symbolType) {
  try {
    return symbolDefinition(symbolType);
  } catch {
    return undefined;
  }
}

/** Dispatches to whichever registry owns `symbolType`. Throws `SymbolRegistryError` (never the registry's own error class) on anything invalid. */
export function validateSymbolPlacement(symbolType, opts) {
  try {
    return moduleFor(symbolType).validateSymbolPlacement(symbolType, opts);
  } catch (e) {
    return rethrowNormalized(e);
  }
}

/** Dispatches to whichever registry owns `shape.symbolType`. Pure: no canvas calls here, same as either registry's own `symbolToDrawOps`. */
export function symbolToDrawOps(shape) {
  try {
    return moduleFor(shape.symbolType).symbolToDrawOps(shape);
  } catch (e) {
    return rethrowNormalized(e);
  }
}
