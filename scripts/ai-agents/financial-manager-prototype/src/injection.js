/**
 * injection.js — seeded instruction-injection family recognizer.
 *
 * Security comes from the absence of capabilities (no shell, no network, no
 * file writes, no execution of submitted strings) and from structured
 * allowlists. This recognizer only FLAGS seeded attack families so the
 * pipeline can refuse/quarantine them; it makes no claim of universal
 * attack detection.
 */

const FAMILIES = [
  {
    family: "instruction-override",
    // directives that attempt to override the agent's task or reporting
    patterns: [
      /\[\s*system\s*\]/i,
      /\bignore\s+(all\s+)?(previous|prior|earlier)\s+(instructions|directives)\b/i,
      /\bdisregard\s+(the\s+)?(above|previous|prior)\b/i,
      /\boverride\b/i,
      /\bnew\s+instructions\b/i,
      /\breport\s+ASSEMBLED\s+regardless\b/i,
    ],
  },
  {
    family: "exfiltration-directive",
    patterns: [/\bexfiltrat\w*\b/i, /\bsend\s+(this|the\s+data|it)\s+to\b/i],
  },
  {
    family: "role-spoof",
    patterns: [/\byou\s+are\s+now\b/i, /\bact\s+as\s+(a\s+)?(root|admin|jason)\b/i],
  },
];

export function scanInjection(text) {
  if (typeof text !== "string") return [];
  const hits = [];
  for (const f of FAMILIES) {
    for (const p of f.patterns) {
      if (p.test(text)) {
        hits.push({ family: f.family, pattern: String(p) });
        break;
      }
    }
  }
  return hits;
}

/** True when any seeded injection family is present. */
export function hasInjection(text) {
  return scanInjection(text).length > 0;
}
