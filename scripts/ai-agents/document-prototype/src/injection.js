/**
 * injection.js — seeded directive-family recognizer for the Document
 * Agent prototype.
 *
 * Security comes from the absence of capabilities (no fetch, no edits,
 * no deletion, no model calls, structured findings that never execute
 * quoted content as markup) — not from this recognizer. It flags the
 * seeded attack families used by the corpus so quarantined document
 * content can never support a checklist/reference/metadata claim or be
 * rendered. Unknown attack coverage is not certified. Pure Node 24 ESM,
 * zero dependencies.
 */

const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bignore\s+(the\s+)?(checklist|policy|polic(y|ies))\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?|other\s+documents?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|documents?)\b/i,
  // Document-specific: self-certification / supersession / skip-review.
  /\b(mark|treat|consider)\b[\s\S]{0,40}\b(this|it)\b[\s\S]{0,20}\b(final|approved|certified|authoritative)\b/i,
  /\bskip\s+(the\s+)?(review|verification|checklist)\b/i,
  /\bsupersedes?\s+(all\s+)?(prior|other|previous)\s+(versions?|documents?|revisions?)\b/i,
  /\bdelete\s+(the\s+)?(conflicting|older|prior)\s+(document|version)\b/i,
  /\bact\s+as\s+(the\s+)?(reviewer|approver|certifying\s+authority)\b/i,
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
