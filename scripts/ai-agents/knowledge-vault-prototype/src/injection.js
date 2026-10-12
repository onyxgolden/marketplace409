/**
 * injection.js — seeded-family injection recognizer for the
 * knowledge-vault prototype.
 *
 * Security comes from the absence of capabilities (no writes, no tools,
 * structured allowlists), not from this recognizer: it flags the seeded
 * attack families used by the corpus so quarantined sources can never
 * support claims. Unknown attack coverage is not certified.
 * Pure Node 24 ESM, zero dependencies.
 */

// Seeded directive families. A source line matching one of these is an
// executable-looking directive, never a claim.
const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bdelete\s+(all\s+)?(records?|everything|the\s+vault|all\s+data)\b/i,
  /\bdrop\s+(the\s+)?(table|database|vault)\b/i,
  /\bgrant\s+(admin|root|full\s+access|all\s+permissions)\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|sources?)\b/i,
];

/**
 * Scan source text for seeded directive families.
 * Returns {injected: boolean, matches: [patternIndex...]}.
 */
export function scanSourceText(text) {
  const matches = [];
  DIRECTIVE_PATTERNS.forEach((re, i) => {
    if (re.test(text)) matches.push(i);
  });
  return { injected: matches.length > 0, matches };
}

/**
 * Scan a query for seeded directive families.
 * Returns {injected: boolean, matches: [patternIndex...]}.
 */
export function scanQuery(query) {
  const matches = [];
  DIRECTIVE_PATTERNS.forEach((re, i) => {
    if (re.test(query)) matches.push(i);
  });
  return { injected: matches.length > 0, matches };
}
