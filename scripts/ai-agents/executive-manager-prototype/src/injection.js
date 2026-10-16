/**
 * injection.js — seeded directive-family recognizer for the Executive
 * Manager Agent prototype.
 *
 * Security comes from the absence of capabilities (no tasking, no tracker
 * writes, no approvals, no outbound contact, no model calls) — not from
 * this recognizer. It flags the seeded attack families used by the corpus
 * so quarantined report content can never support a derived statement,
 * metric total or header comparison. Unknown attack coverage is not
 * certified. Pure Node 24 ESM, zero dependencies.
 */

const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?|other\s+reports?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|reports?)\b/i,
  // Executive-Manager-specific: the named "malicious suppress-item"
  // family plus task/approve/deploy/contact directives this agent must
  // refuse as operations, and must never obey when embedded in content.
  /\bsuppress\b[\s\S]{0,40}\b(item|statement|finding|contradiction)\b/i,
  /\b(task|assign)\b[\s\S]{0,30}\b(the\s+)?(team|agent|engineer|owner)\b/i,
  /\bupdate\s+(the\s+)?(actual\s+)?tracker\b/i,
  /\b(approve|deploy|activate|publish)\b[\s\S]{0,30}\b(this|the)\b[\s\S]{0,20}\b(report|rollup|status)\b/i,
  /\bcontact\b[\s\S]{0,30}\b(the\s+)?(team|customer|client|owner)\b/i,
  /\bmark\s+(this\s+)?(item|finding)\s+(as\s+)?(resolved|complete|on\s*track)\b/i,
  /\bact\s+as\s+(the\s+)?(executive|approver|decision[\s-]?maker)\b/i,
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
