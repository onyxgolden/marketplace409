/**
 * injection.js — seeded instruction-family detection for the Research
 * Agent prototype. Fixture records are DATA, including any embedded
 * instructions, finality claims, purported signatures or HTML in free
 * text fields. Detection quarantines the passage; the structural defense
 * is capability absence (the agent cannot browse, send, execute, export
 * or mutate), not a claim of universal text detection.
 * Pure Node 24 ESM, zero dependencies.
 */

// Seeded families used by the fixtures. Plain-text markers only — the
// agent never executes, sends, or exports anything regardless.
const FAMILIES = [
  /ignore (all )?previous instructions/i,
  /disregard (the|your) (brief|instructions|policy)/i,
  /you are now (a|an) /i,
  /system instruction:/i,
  /mark all claims .* as (externally )?verified/i,
  /approve this (claim|report|finding)/i,
  /final:? (this is )?approved/i,
  /\[signed\]/i,
  /<script[\s>]/i,
  /relabel .* as supported/i,
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
