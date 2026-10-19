/**
 * injection.js — seeded instruction-family detection for the Scheduler
 * Agent prototype. Fixture records are DATA, including any embedded
 * instructions, finality claims, purported signatures or HTML in free
 * text fields. Detection quarantines the record; the structural defense
 * is capability absence (the agent cannot send, execute, export or
 * mutate), not a claim of universal text detection.
 * Pure Node 24 ESM, zero dependencies.
 */

// Seeded families used by the battery. Plain-text markers only — the
// agent never executes, sends, or exports anything regardless.
const FAMILIES = [
  /ignore (all )?previous instructions/i,
  /disregard (the|your) (brief|instructions|policy)/i,
  /you are now (a|an) /i,
  /approve this (schedule|baseline|change)/i,
  /final:? (this is )?approved/i,
  /\[signed\]/i,
  /<script[\s>]/i,
  /commit these dates/i,
  /publish the schedule/i,
];

/** Scan an array of strings. Returns {injected, families}. */
export function scanTexts(texts) {
  const families = [];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    for (let i = 0; i < FAMILIES.length; i++) {
      if (FAMILIES[i].test(t) && !families.includes(i)) families.push(i);
    }
  }
  return { injected: families.length > 0, families };
}
