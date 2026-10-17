/**
 * injection.js — seeded instruction-family detection for the Finance
 * Agent prototype. Fixture records are DATA, including any embedded
 * instructions, finality claims, financial requests, purported
 * signatures or HTML. Detection quarantines the text/support; the
 * structural defense is capability absence (the agent cannot send,
 * pay, export or mutate), not a claim of universal text detection.
 * Pure Node 24 ESM, zero dependencies.
 */

// Seeded families used by the battery. Plain-text markers only — the
// agent never executes, sends, or exports anything regardless.
const FAMILIES = [
  /ignore (all )?previous instructions/i,
  /disregard (the|your) (brief|instructions|policy)/i,
  /you are now (a|an) /i,
  /send (the )?(money|payment|funds)/i,
  /initiate (a )?payment/i,
  /export (the )?(real )?ledger/i,
  /wire transfer/i,
  /approve this (refund|payment|transfer)/i,
  /final:? (this is )?approved/i,
  /\[signed\]/i,
  /<script[\s>]/i,
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
