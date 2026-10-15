/**
 * injection.js — seeded-family injection recognizer for the Tax Agent
 * educational prototype.
 *
 * Security comes from the absence of capabilities (no writes, no tools,
 * structured allowlists, closed topic registry), not from this
 * recognizer: it flags the seeded attack families used by the corpus so
 * quarantined sources/inputs can never support a draft. Unknown attack
 * coverage is not certified. Pure Node 24 ESM, zero dependencies.
 */

// Seeded directive families. Matching text is an executable-looking
// directive or a self-authorization claim, never a claim/template/approval.
const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bdelete\s+(all\s+)?(records?|everything|the\s+registry|all\s+data)\b/i,
  /\bdrop\s+(the\s+)?(table|database|registry)\b/i,
  /\bgrant\s+(admin|root|full\s+access|all\s+permissions)\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|sources?)\b/i,
  // Tax-specific: self-approval / publication / filing / outcome-guarantee.
  /\b(pre[\s-]?approved|already\s+reviewed|already\s+signed\s+off|treat\s+(this|it)\s+as\s+reviewed)\b/i,
  /\bpublish\b[\s\S]{0,40}\b(immediately|without\s+review|now)\b/i,
  /\b(file|submit)\s+(this|the)\s+(return|tax\s+return|form)\b/i,
  /\bguarantee(s|d)?\b[\s\S]{0,40}\b(refund|deduction|outcome|no\s+audit)\b/i,
  /\bact\s+as\s+(my|our|a|the)\s+(cpa|accountant|tax\s+professional|licensed\s+preparer)\b/i,
  /\bskip\s+(the\s+)?(professional\s+)?review\b/i,
];

/**
 * Scan source/registry text for seeded directive families.
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
 * Scan a caller-supplied input string (task_id, topic_label, ...) for
 * seeded directive families.
 * Returns {injected: boolean, matches: [patternIndex...]}.
 */
export function scanInputText(text) {
  const matches = [];
  DIRECTIVE_PATTERNS.forEach((re, i) => {
    if (re.test(text)) matches.push(i);
  });
  return { injected: matches.length > 0, matches };
}
