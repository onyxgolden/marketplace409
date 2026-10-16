/**
 * injection.js — seeded directive-family recognizer for the Maintenance
 * Manager Agent prototype.
 *
 * Security comes from the absence of capabilities (no dispatch, no work
 * closure, no scheduling, no purchasing, no reliability prediction, no
 * model calls) — not from this recognizer. It flags the seeded attack
 * families used by the corpus so quarantined work-order notes can never
 * alter a structured state or produce a control action. Unknown attack
 * coverage is not certified. Pure Node 24 ESM, zero dependencies.
 */

const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?)\b/i,
  // Maintenance-Manager-specific prohibited operations: this agent audits
  // only — it never dispatches, closes, schedules PM work, purchases, or
  // predicts reliability, and must refuse content that tries to talk it
  // into any of those even when embedded in a work order's own notes.
  /\b(dispatch|send)\b[\s\S]{0,30}\b(a\s+)?(tech|technician|crew|contractor)\b/i,
  /\bclose\b[\s\S]{0,30}\b(this\s+)?(work\s*order|ticket)\b/i,
  /\bschedule\b[\s\S]{0,30}\b(the\s+)?(next\s+)?(pm|preventive|maintenance)\b/i,
  /\b(purchase|order)\b[\s\S]{0,30}\b(parts?|replacement)\b/i,
  /\bmark\s+(this\s+)?(work\s*order|occurrence)\s+(as\s+)?(complete|compliant|closed)\b/i,
  /\b(approve|publish|activate)\b[\s\S]{0,30}\b(this|the)\b[\s\S]{0,20}\b(audit|report|finding)\b/i,
  /\bpredict\b[\s\S]{0,30}\b(failure|reliability)\b/i,
  /\bact\s+as\s+(the\s+)?(technician|dispatcher|planner)\b/i,
  /\bfetch\b[\s\S]{0,40}\bhttps?:\/\//i,
  // Executable-looking markup: never rendered, never fetched.
  /<\s*(script|img|iframe|a|svg|object|embed)\b/i,
  /\bon(error|load|click)\s*=/i,
  /\bjavascript:/i,
];

/**
 * Scan one string for seeded directive families. Returns
 * {injected: boolean, matches: [patternIndex...]}.
 */
export function scanDocText(text) {
  const matches = [];
  DIRECTIVE_PATTERNS.forEach((re, i) => {
    if (re.test(text)) matches.push(i);
  });
  return { injected: matches.length > 0, matches };
}

/** Scan several strings; true if any carries a seeded directive family. */
export function scanAnyDocText(strings) {
  for (const s of strings) {
    if (typeof s !== "string" || s.length === 0) continue;
    const r = scanDocText(s);
    if (r.injected) return { injected: true, source: s, matches: r.matches };
  }
  return { injected: false, source: null, matches: [] };
}
