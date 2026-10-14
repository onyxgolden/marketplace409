/**
 * index.js — public entry for the CI comparison core.
 *
 * Orchestrates: validate input -> run comparison -> gate artifacts ->
 * structured output. Still read-only: no network, no writes, no publication.
 */

import { runComparison } from "./compare.js";
import { gateArtifacts } from "./publish.js";
import { refusal } from "./schemas.js";

export { runComparison } from "./compare.js";
export { evaluateCell, scanForInjection } from "./cells.js";
export { scoreComparison, scoreWithDifference } from "./rubric.js";
export { TrialLedger } from "./ledger.js";
export { EvaluationInterlock } from "./interlock.js";
export { CardRegistry } from "./card.js";
export { classifyChallenge, attemptAllowed, makeChallengeRecord } from "./challenges.js";
export { forgeEvidence, classifyForgeFinding, snapshotPin } from "./inventory.js";

/**
 * Full pipeline: comparison + artifact gate.
 * Returns the comparison output, or a refusal if artifacts fail the gate.
 */
export function runPipeline(input, cellsBySubject) {
  const result = runComparison(input, cellsBySubject);
  if (result.status === "REFUSED" || result.status === "BLOCKED") return result;
  const violations = gateArtifacts(result);
  if (violations.length > 0) {
    return refusal("BLOCKED", "COPY_DETECTED", violations.slice(0, 10));
  }
  return result;
}
