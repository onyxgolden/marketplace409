/**
 * injection.js — seeded injection recognizer for the architecture-reviewer
 * prototype.
 *
 * Security comes from absence of capabilities and structured allowlists;
 * this recognizer only flags the seeded attack families the corpus tests:
 *   1. authority-spoof — design text claiming reviewer/verdict authority
 *      (ChatGPT verdict claims, Muse approval claims) to launder a verdict;
 *   2. instruction-injection — direct attempts to steer the reviewer
 *      ("ignore checks", "approve unconditionally", "skip verification").
 *
 * Flagged instruction-injection quarantines the design source: a design
 * that tries to steer its own review cannot support a trustworthy verdict.
 * Authority-spoof is neutralized as an INFO finding: advisory output only,
 * never an authorization.
 */

const AUTHORITY_SPOOF_PATTERNS = [
  /chatgpt\s+(verdict|go|approval|approved)/i,
  /verdict:\s*go/i,
  /muse\s+(approved|approval|authorized)/i,
  /authorized\s+by\s+(chatgpt|muse)/i,
  /merge\s+authorized/i,
];

const INSTRUCTION_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(checks|verification|the\s+review)/i,
  /approve\s+(this\s+design\s+)?unconditionally/i,
  /skip\s+verification/i,
  /override\s+the\s+reviewer/i,
  /do\s+not\s+(flag|report)\s+(this|any)/i,
  /treat\s+this\s+as\s+(go|approved)/i,
];

/**
 * Scan design bytes (UTF-8 string) for seeded injection families.
 * Returns { authoritySpoof: [spans], instructionInjection: [spans] } where
 * each span is {start_byte, end_byte, quoted_text} of the matched line.
 */
export function scanInjection(text) {
  const bytes = Buffer.from(text, "utf8");
  const out = { authoritySpoof: [], instructionInjection: [] };
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    const span = { start_byte: offset, end_byte: offset + lineBytes, quoted_text: line };
    for (const p of INSTRUCTION_INJECTION_PATTERNS) {
      if (p.test(line)) {
        out.instructionInjection.push(span);
        break;
      }
    }
    for (const p of AUTHORITY_SPOOF_PATTERNS) {
      if (p.test(line)) {
        out.authoritySpoof.push(span);
        break;
      }
    }
    offset += lineBytes + 1; // +1 for the newline byte
  }
  return out;
}
