/**
 * injection.js — seeded directive-family recognizer for the Customer
 * Success Agent prototype.
 *
 * Security comes from the absence of capabilities (no sending, no
 * account-mutation, no model calls, structured drafts that never echo
 * raw ticket text) — not from this recognizer. It flags the seeded
 * attack families used by the corpus so quarantined ticket text can
 * never support a draft or be rendered. Unknown attack coverage is not
 * certified. Pure Node 24 ESM, zero dependencies.
 */

const DIRECTIVE_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bignore\s+(the\s+)?polic(y|ies)\b/i,
  /\bdelete\s+(my\s+)?account\s+(now|immediately)\b/i,
  /\bgrant\s+(admin|root|full\s+access|all\s+permissions)\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?|other\s+customers?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|tickets?|customers?)\b/i,
  // Customer-success-specific: self-approval / outcome-guarantee / send-now / impersonation.
  /\b(pre[\s-]?approved|already\s+approved|treat\s+(this|it)\s+as\s+approved)\b/i,
  /\bsend\b[\s\S]{0,40}\b(immediately|now|without\s+review)\b/i,
  /\bissue\s+(the\s+)?refund\s+(now|immediately|automatically)\b/i,
  /\bguarantee(s|d)?\b[\s\S]{0,40}\b(refund|resolution|sla|no\s+charge)\b/i,
  /\bact\s+as\s+(my|our|a|the)\s+(support\s+agent|admin|account\s+owner|cpa|billing\s+team)\b/i,
  /\bskip\s+(the\s+)?(review|verification)\b/i,
  /\bwaive\s+(the\s+)?(fee|charge|sla)\s+(now|immediately)\b/i,
  // Executable-looking markup: never rendered, never fetched.
  /<\s*(script|img|iframe|a|svg|object|embed)\b/i,
  /\bon(error|load|click)\s*=/i,
  /\bjavascript:/i,
];

/**
 * Scan ticket free text (subject/body/notes) for seeded directive
 * families. Returns {injected: boolean, matches: [patternIndex...]}.
 */
export function scanTicketText(text) {
  const matches = [];
  DIRECTIVE_PATTERNS.forEach((re, i) => {
    if (re.test(text)) matches.push(i);
  });
  return { injected: matches.length > 0, matches };
}

/** Scan several strings; true if any carries a seeded directive family. */
export function scanAnyTicketText(strings) {
  for (const s of strings) {
    if (typeof s !== "string" || s.length === 0) continue;
    const r = scanTicketText(s);
    if (r.injected) return { injected: true, source: s, matches: r.matches };
  }
  return { injected: false, source: null, matches: [] };
}
