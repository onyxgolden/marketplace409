// FORGE Chart Builder — import foundation types (slice 3.1).
//
// The import wizard is a translation pipeline only: it produces input for the
// existing createChartDocument() and never creates a second graph model.
// Everything in this module is plain data + tiny pure helpers; no React,
// no DOM, no chart mutation. All parsing, mapping, validation, and preview
// work is 100% browser-local — nothing is uploaded anywhere.
//
// Slice 3.1 scope: RawTable/RawRow (raw table model), header-analysis shapes,
// the mapping-completeness contract, and ImportError. ImportPreview/ImportIssue
// shapes are declared here as typedefs only; their builders arrive in 3.2/3.3.

/**
 * Import mode. "org" builds a forest of supervisor trees; "workflow" builds
 * a directed graph of steps. Canonical field targets differ per mode.
 */
export const IMPORT_MODES = Object.freeze(["org", "workflow"]);

/**
 * Canonical mapping targets for org imports. "name" and "supervisor" are
 * required; the rest are optional enrichment fields.
 */
export const ORG_TARGETS = Object.freeze([
  "name",
  "title",
  "supervisor",
  "department",
  "location",
]);

/**
 * Canonical mapping targets for workflow imports. "step" and "nextStep" are
 * required; "decision" rides on the edge as a label, and "description" /
 * "owner" enrich the node (slice 3.3 adds the latter two as optional
 * targets so the wizard can offer them).
 */
export const WORKFLOW_TARGETS = Object.freeze([
  "step",
  "nextStep",
  "decision",
  "description",
  "owner",
]);

/**
 * Required targets per mode. A confirmed mapping missing any of these must
 * fail before preview generation (see missingRequiredTargets).
 */
export const REQUIRED_TARGETS = Object.freeze({
  org: Object.freeze(["name", "supervisor"]),
  workflow: Object.freeze(["step", "nextStep"]),
});

export function assertImportMode(mode) {
  if (!IMPORT_MODES.includes(mode)) {
    throw new ImportError(
      "invalid-mode",
      `Unknown import mode "${mode}". Expected one of: ${IMPORT_MODES.join(", ")}.`
    );
  }
  return mode;
}

/**
 * Returns the required targets that have no confirmed mapping yet.
 * A mapping is "confirmed" only after the user explicitly picks it in the
 * mapping UI — header-detection suggestions never count.
 *
 * @param {"org"|"workflow"} mode
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 * @returns {string[]} missing required target names (empty = complete)
 */
export function missingRequiredTargets(mode, confirmedMappings) {
  assertImportMode(mode);
  const mapped = new Set(
    (confirmedMappings ?? []).map((m) => m && m.target).filter(Boolean)
  );
  return REQUIRED_TARGETS[mode].filter((target) => !mapped.has(target));
}

/**
 * Error thrown for every import-pipeline failure: unreadable files, empty
 * input, malformed workbooks, contract violations. Failures are always
 * explicit — the pipeline never silently drops data.
 */
export class ImportError extends Error {
  /**
   * @param {string} code machine-readable code, e.g. "empty-file"
   * @param {string} message human-readable explanation
   * @param {object} [details] extra context for diagnostics (row numbers, etc.)
   */
  constructor(code, message, details) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.details = details ?? null;
  }
}

/**
 * @typedef {object} RawRow
 * A single non-blank spreadsheet row. Blank rows are skipped but counted in
 * RawTable.skippedBlankRows; rowNumber is the original 1-based spreadsheet
 * row so diagnostics can point at the exact source line.
 * @property {number} rowNumber original 1-based row number in the sheet
 * @property {Array<string|null>} values cell values aligned to the table's
 *   headers (padded with null when short, truncated when long); empty cells
 *   are null after trimming
 */

/**
 * @typedef {object} RawTable
 * One parsed sheet: the faithful raw table model the rest of the pipeline
 * reads. No nodes or edges are generated from it in slice 3.1.
 * @property {"csv"|"xlsx"} source which parser produced this table
 * @property {string} sheetName sheet/tab name ("Sheet1" default for CSV)
 * @property {string[]} headers trimmed header cells from the first non-blank row
 * @property {RawRow[]} rows non-blank data rows
 * @property {number} skippedBlankRows count of blank rows ignored (diagnostics)
 */

/**
 * @typedef {object} HeaderCandidate
 * One detected header plus mapping suggestions. Suggestions are hints only —
 * the user must confirm every mapping explicitly before preview generation.
 * @property {string} header the raw header text
 * @property {number} index column index in the table
 * @property {Array<{target:string, matchedAs:string}>} suggestions candidate targets
 * @property {boolean} ambiguous true when the header needs an explicit user
 *   choice: it matched multiple targets, or another header claimed the same target
 */

/**
 * @typedef {object} HeaderAnalysis
 * @property {string[]} headers detected headers
 * @property {HeaderCandidate[]} candidates one per header
 * @property {true} requiresConfirmation always true: mappings are never auto-applied
 */

/**
 * @typedef {object} ColumnMapping
 * A single user-confirmed column mapping. Created only by explicit user
 * action in the mapping UI (slice 3.2); never by header detection.
 * @property {number} headerIndex column index in the RawTable
 * @property {string} target canonical target ("name", "supervisor", ...)
 */

/**
 * @typedef {object} ImportIssue
 * One problem found before commit (slice 3.2/3.3 builder).
 * @property {"error"|"warning"} severity
 * @property {string} message human-readable description
 * @property {number|null} rowNumber original spreadsheet row, when applicable
 * @property {string|null} header related column header, when applicable
 */

/**
 * @typedef {object} ImportPreview
 * Human-readable before-commit summary (slice 3.2/3.3 builder).
 * @property {number} nodeCount draft nodes that would be created
 * @property {number} edgeCount draft edges that would be created
 * @property {number} warningCount
 * @property {number} errorCount
 * @property {Array<{rowNumber:number, label:string, detail:string}>} rowTrace
 *   per-row trace for the preview UI
 * @property {ImportIssue[]} issues
 */
