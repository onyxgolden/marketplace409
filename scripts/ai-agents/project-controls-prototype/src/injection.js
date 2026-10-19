// injection.js — seeded injection-family recognizer.
// Structural absence of capabilities is the real defense; this recognizer
// flags known seeded attack text so it can be quarantined with accounting.
// It makes no claim of universal attack detection.

const FAMILIES = [
  {
    id: 'IGNORE_PRIOR',
    name: 'instruction override',
    patterns: [
      /ignore (all |any )?prior instructions/i,
      /disregard (all |the )?(previous|prior|above) instructions/i,
      /forget (your|all) instructions/i,
      /new instructions?:/i,
    ],
  },
  {
    id: 'FAKE_AUTHORITY',
    name: 'fabricated authority claim',
    patterns: [
      /approved by (jason|the owner|management)/i,
      /jason (said|authorized|approved)/i,
      /you are (now )?authorized to/i,
      /override (the )?budget/i,
      /as (an? )?(admin|owner|system)/i,
    ],
  },
  {
    id: 'FAKE_FINALITY',
    name: 'false finality / forecast demand',
    patterns: [
      /this is (the )?final (forecast|budget|number)/i,
      /treat (this|these) as (verified|final|actual)/i,
      /do not (recompute|verify|check)/i,
      /mark .* as physically verified/i,
    ],
  },
  {
    id: 'EXECUTABLE_MARKUP',
    name: 'executable markup',
    patterns: [
      /<script[\s>]/i,
      /javascript:/i,
      /on\w+\s*=\s*["']/i,
      /<iframe[\s>]/i,
    ],
  },
  {
    id: 'SPEND_REQUEST',
    name: 'financial request embedded in data',
    patterns: [
      /transfer \$|send (the )?payment|wire (the )?funds/i,
      /approve (this|the) (spend|spending|payment|draw)/i,
      /release (the )?contingency/i,
    ],
  },
  {
    id: 'PROMPT_EXTRACTION',
    name: 'prompt / system extraction',
    patterns: [
      /reveal your (system )?prompt/i,
      /what (are|is) your instructions/i,
      /repeat (your|the) (system )?instructions/i,
    ],
  },
];

/**
 * Scan text for seeded injection families. Returns array of
 * {family_id, family_name, matched_span} — spans are charged by the caller.
 */
export function recognizeInjections(text) {
  const hits = [];
  if (typeof text !== 'string') return hits;
  for (const fam of FAMILIES) {
    for (const re of fam.patterns) {
      const m = re.exec(text);
      if (m) {
        hits.push({
          family_id: fam.id,
          family_name: fam.name,
          matched_span: m[0].slice(0, 120),
        });
        break; // one hit per family is enough to quarantine
      }
    }
  }
  return hits;
}

export function familyIds() {
  return FAMILIES.map((f) => f.id);
}
