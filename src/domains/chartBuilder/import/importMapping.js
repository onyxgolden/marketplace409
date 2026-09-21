// FORGE Chart Builder — mapping confirmation contract (slice 3.2).
//
// Pure helpers behind the mapping step's UX contract: header-detection
// suggestions are hints only, every mapping needs an explicit user choice,
// and the wizard may not continue to preview while required targets are
// missing or ambiguous headers are unresolved.

import {
  IMPORT_MODES,
  ORG_TARGETS,
  WORKFLOW_TARGETS,
  assertImportMode,
  missingRequiredTargets,
} from "./chartImportTypes.js";

export function targetsForMode(mode) {
  assertImportMode(mode);
  return mode === "org" ? ORG_TARGETS : WORKFLOW_TARGETS;
}

export function isKnownImportMode(mode) {
  return IMPORT_MODES.includes(mode);
}

/**
 * Gate the wizard's "continue to preview" action.
 *
 * Returns { complete, missing, ambiguousUnresolved, duplicateTargetClaims }:
 * - missing: required targets with no confirmed mapping (blocks continue).
 * - ambiguousUnresolved: ambiguous header texts the user has not explicitly
 *   chosen a target for (blocks continue — even "leave unmapped" must be an
 *   explicit choice).
 * - duplicateTargetClaims: canonical targets claimed by more than one
 *   header (blocks continue — the mapper's last-wins Map must never pick
 *   silently).
 *
 * @param {"org"|"workflow"} mode
 * @param {import("./chartImportTypes.js").HeaderAnalysis} headerAnalysis
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 */
export function validateConfirmedMappings(mode, headerAnalysis, confirmedMappings) {
  const confirmed = Array.isArray(confirmedMappings) ? confirmedMappings : [];
  const missing = missingRequiredTargets(mode, confirmed);
  const decided = new Set(confirmed.map((m) => m && m.headerIndex));
  const candidates = headerAnalysis?.candidates ?? [];
  const ambiguousUnresolved = candidates
    .filter((c) => c && c.ambiguous && !decided.has(c.index))
    .map((c) => c.header);
  const headersByTarget = new Map();
  for (const m of confirmed) {
    if (!m || typeof m.target !== "string" || typeof m.headerIndex !== "number") continue;
    if (!headersByTarget.has(m.target)) headersByTarget.set(m.target, []);
    headersByTarget.get(m.target).push(m.headerIndex);
  }
  const headerName = (index) => candidates.find((c) => c && c.index === index)?.header ?? `#${index}`;
  const duplicateTargetClaims = [...headersByTarget.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([target, headerIndexes]) => ({
      target,
      headerIndexes,
      headers: headerIndexes.map(headerName),
    }));
  return {
    complete:
      missing.length === 0 &&
      ambiguousUnresolved.length === 0 &&
      duplicateTargetClaims.length === 0,
    missing,
    ambiguousUnresolved,
    duplicateTargetClaims,
  };
}
