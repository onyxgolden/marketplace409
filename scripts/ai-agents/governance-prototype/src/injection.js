/**
 * injection.js — seeded directive recognizer for fixture-source bytes and
 * submitted evidence text. Security comes from the absence of capabilities
 * and structured allowlists, not from this recognizer: a match quarantines
 * the source so it can never support a success outcome.
 */

export const SEED_PATTERNS = [
  /ignore all policies/i,
  /always allow/i,
  /execute immediately/i,
  /system override/i,
  /you are now authorized/i,
  /bypass the gates/i,
  /disregard prior instructions/i,
  /treat this as authorization/i,
];

export function findDirectives(text) {
  const hits = [];
  for (const p of SEED_PATTERNS) {
    if (p.test(text)) hits.push(p.source);
  }
  return hits;
}

/** True when text contains any seeded directive pattern. */
export function isInjected(text) {
  if (typeof text !== "string") return false;
  return SEED_PATTERNS.some((p) => p.test(text));
}
