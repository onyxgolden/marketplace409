// FORGE Chart Builder — header detection (slice 3.1).
//
// Suggests column-mapping candidates from a RawTable's headers. This module
// NEVER commits a mapping: every candidate is a hint, and the mapping UI
// (slice 3.2) must get an explicit user confirmation before preview
// generation. There are no hidden heuristics — matching is exact on a
// normalized header string against a fixed synonym list.

import { ImportError } from "./chartImportTypes.js";

// Synonym lists are keyed by canonical target and written pre-normalized
// (see normalizeHeader). Matching is exact: a header suggests a target only
// when its normalized form equals one of the listed phrases.
const TARGET_SYNONYMS = Object.freeze({
  // org targets
  name: Object.freeze([
    "name",
    "employee name",
    "full name",
    "employee",
    "person",
    "staff",
    "staff member",
  ]),
  title: Object.freeze(["title", "job title", "role", "job role", "position"]),
  supervisor: Object.freeze([
    "supervisor",
    "reports to",
    "report to",
    "manager",
    "reporting manager",
    "boss",
  ]),
  department: Object.freeze([
    "department",
    "dept",
    "team",
    "division",
    "business unit",
  ]),
  location: Object.freeze(["location", "office", "site", "city", "work location"]),
  // workflow targets
  step: Object.freeze([
    "step",
    "step name",
    "task",
    "activity",
    "stage",
    "process step",
  ]),
  nextStep: Object.freeze([
    "next step",
    "next steps",
    "next",
    "then",
    "follows",
    "goes to",
  ]),
  decision: Object.freeze(["decision", "condition", "branch", "if", "choice"]),
});

const PHRASE_TO_TARGETS = (() => {
  const map = new Map();
  for (const [target, phrases] of Object.entries(TARGET_SYNONYMS)) {
    for (const phrase of phrases) {
      if (!map.has(phrase)) map.set(phrase, []);
      map.get(phrase).push(target);
    }
  }
  return map;
})();

/**
 * Normalize a header for matching: lowercase, trim, underscores/dashes to
 * spaces, drop other punctuation, collapse whitespace.
 */
export function normalizeHeader(header) {
  return String(header ?? "")
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Produce one candidate per header. A candidate is ambiguous when it needs an
 * explicit user choice: the header text matched multiple targets, or another
 * header claimed the same target. Headers matching nothing stay unmapped
 * (empty suggestions) — they are shown, never hidden.
 *
 * @param {string[]} headers
 * @returns {Array<import("./chartImportTypes.js").HeaderCandidate>}
 */
export function produceCandidates(headers) {
  const list = Array.isArray(headers) ? headers : [];
  const candidates = list.map((header, index) => {
    const targets = PHRASE_TO_TARGETS.get(normalizeHeader(header)) ?? [];
    return {
      header: String(header ?? ""),
      index,
      suggestions: targets.map((target) => ({ target, matchedAs: String(header ?? "") })),
      ambiguous: targets.length > 1,
    };
  });
  // A target claimed by more than one header is ambiguous for every claimant.
  const claimCount = new Map();
  for (const c of candidates) {
    for (const s of c.suggestions) {
      claimCount.set(s.target, (claimCount.get(s.target) ?? 0) + 1);
    }
  }
  for (const c of candidates) {
    if (c.suggestions.some((s) => (claimCount.get(s.target) ?? 0) > 1)) {
      c.ambiguous = true;
    }
  }
  return candidates;
}

/**
 * Run header detection over a parsed table.
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @returns {import("./chartImportTypes.js").HeaderAnalysis} always carries
 *   requiresConfirmation: true — mappings are never auto-applied.
 */
export function detectHeaders(rawTable) {
  if (!rawTable || !Array.isArray(rawTable.headers)) {
    throw new ImportError(
      "invalid-table",
      "Header detection needs a parsed table with a headers array."
    );
  }
  return {
    headers: rawTable.headers.slice(),
    candidates: produceCandidates(rawTable.headers),
    requiresConfirmation: true,
  };
}
