/**
 * personal.js — personalized-input ("personal advice") detector for the
 * Tax Agent educational prototype.
 *
 * Personal financial facts or advice requests anywhere in the reachable
 * input — even under a general-looking topic, a disclaimer, a claimed
 * synthetic flag or a claimed expert approval — must force a refusal
 * with professional referral and zero draft content. This recognizer is
 * a finite seeded-pattern screen, not a certified universal personal-data
 * detector: the closed topic/schema boundary is the primary protection,
 * this is defense in depth. Pure Node 24 ESM, zero dependencies.
 */

const DOLLAR_RE = /\$\s?\d[\d,]*(\.\d{1,2})?|\b\d[\d,]{2,}\s?(dollars|usd)\b/i;
const SPELLED_AMOUNT_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)?\s*(hundred|thousand)\s+dollars\b/i;

const PATTERNS = [
  // Pronoun ... tax/financial keyword (either order), first person.
  /\b(my|our|i'm|we're|myself)\b[\s\S]{0,80}\b(income|rental|rentals|property|properties|deduct\w*|depreciat\w*|basis|expense\w*|loss(es)?|gain(s)?|owe(d)?|refund|liabilit\w*|qualif\w*|material participation|reps|passive loss|1031|qbi|entity|llc|s-corp|election|audit|return|taxes|filing)\b/i,
  /\b(income|rental|rentals|property|properties|deduct\w*|depreciat\w*|basis|expense\w*|loss(es)?|gain(s)?|owe(d)?|refund|liabilit\w*|qualif\w*)\b[\s\S]{0,80}\b(my|our|i'm|we're|myself)\b/i,
  // Direct personalization question, first or third person.
  /\b(can|should|am|may|do)\s+(i|we)\b[\s\S]{0,40}\b(deduct|qualify|claim|elect|depreciate|file|owe|write off)\b/i,
  /\b(can|should)\s+(he|she|they)\b[\s\S]{0,40}\b(deduct|qualify|claim|elect|depreciate|file|owe|write off)\b/i,
  /\bdo\s+i\s+qualify\b/i,
  /\bwhich\s+entity\s+should\s+i\b/i,
  /\bhow\s+much\s+can\s+i\s+(deduct|write off|claim)\b/i,
  /\bwhat\s+should\s+i\s+do\s+(about|with)\s+my\b/i,
  // Ownership/transaction facts.
  /\b(i|we)\s+(own|owns|bought|sold|purchased|acquired)\b[\s\S]{0,40}\b(rental|property|home|building|unit|duplex|house|properties)\b/i,
  // Named third-party financial facts (disguise: ask "for a friend").
  /\b[A-Z][a-z]+\s+(earns?|earned|made|owns?|owes?|paid)\b[\s\S]{0,40}\b(income|rental|property|\$|dollars)\b/i,
  // Claimed personal professional relationship.
  /\b(my|our)\s+(cpa|accountant|tax\s+preparer|advisor|attorney)\b/i,
  // Explicit "this is personal/my real situation" framing even inside a disclaimer.
  /\bmy\s+(real|actual)\s+(situation|numbers|income|loss|rental|property)\b/i,
];

function dollarWithContext(text) {
  if (!DOLLAR_RE.test(text) && !SPELLED_AMOUNT_RE.test(text)) return false;
  const CONTEXT_RE = /\b(my|our|i|we|income|earn\w*|paid|salary|rental|bought|sold|owe\w*|refund|deduct\w*|loss|gain)\b/i;
  return CONTEXT_RE.test(text);
}

/**
 * Scan one string for seeded personal-fact / personalized-advice families.
 * Returns {personal: boolean, matches: [patternIndex...]}.
 */
export function scanPersonalFacts(text) {
  if (typeof text !== "string" || text.length === 0) return { personal: false, matches: [] };
  const matches = [];
  PATTERNS.forEach((re, i) => {
    if (re.test(text)) matches.push(i);
  });
  if (dollarWithContext(text)) matches.push("dollar-context");
  return { personal: matches.length > 0, matches };
}

/** Scan several strings; true if any one of them carries a personal-fact family. */
export function scanAnyPersonalFacts(strings) {
  for (const s of strings) {
    if (typeof s !== "string") continue;
    const r = scanPersonalFacts(s);
    if (r.personal) return { personal: true, source: s, matches: r.matches };
  }
  return { personal: false, source: null, matches: [] };
}
