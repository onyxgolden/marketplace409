/**
 * injection.js — seeded injection-family detection for the Research
 * Training Agent prototype. Scans the FULL resolved source text (never
 * a prefix slice): source bytes are already bounded by the aggregate
 * input budget, so a truncated scan would only open a blind spot.
 *
 * Detection is structural-family based (embedded directives, embedded
 * answer keys, executable markup, prompt-override phrasing). A hit
 * quarantines the source: its text and support are excluded from
 * teaching, and the exclusion is reported. This is not a claim of
 * universal injection detection — the structural defense is that
 * fixture text is never executed and never treated as instructions.
 */

const FAMILIES = [
  {
    family: "embedded-directive",
    patterns: [
      /SYSTEM\s+INSTRUCTION/i,
      /ignore\s+(all\s+)?previous\s+(rules|instructions)/i,
      /disregard\s+(the\s+)?(above|previous)/i,
      /you\s+are\s+now\s+(instructed|required)\s+to/i,
      /INJ-[A-Z0-9-]+/,
    ],
  },
  {
    family: "embedded-answer-key",
    patterns: [
      /answer\s+key\s*(is|:)/i,
      /choice\s+[A-D]\s+is\s+correct/i,
      /the\s+correct\s+answer\s+is/i,
      /key\s*:\s*always\s+say/i,
    ],
  },
  {
    family: "executable-markup",
    patterns: [
      /<script[\s>]/i,
      /\beval\s*\(/,
      /\bFunction\s*\(/,
      /javascript\s*:/i,
      /on(error|load|click)\s*=/i,
    ],
  },
  {
    family: "authority-claim",
    patterns: [
      /approved\s+by\s+(the\s+)?(coordinator|orchestrator)/i,
      /this\s+source\s+is\s+(pre-)?verified/i,
      /treat\s+this\s+as\s+established\s+truth/i,
    ],
  },
];

/**
 * Scan an array of texts (full text, no truncation).
 * Returns { hit: bool, families: [family names, sorted] }.
 */
export function scanTexts(texts) {
  const found = new Set();
  for (const text of texts) {
    if (typeof text !== "string") continue;
    for (const { family, patterns } of FAMILIES) {
      for (const re of patterns) {
        if (re.test(text)) found.add(family);
      }
    }
  }
  return { hit: found.size > 0, families: [...found].sort() };
}
