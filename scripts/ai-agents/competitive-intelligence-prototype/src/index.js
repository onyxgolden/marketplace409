/**
 * index.js — public entry for the CI comparison core.
 *
 * Orchestrates: verify corpus -> validate input -> admit against trusted
 * context -> run comparison -> gate artifacts -> structured output.
 * Still read-only: no network, no writes, no publication.
 */

import { runComparison } from "./compare.js";
import { gateArtifacts } from "./publish.js";
import { refusal } from "./schemas.js";

export { runComparison } from "./compare.js";
export { evaluateCell, scanForInjection, validateCell, CELL_KEYS } from "./cells.js";
export { scoreComparison, scoreWithDifference, scopesComparable } from "./rubric.js";
export {
  TrialLedger,
  createLedgerStore,
  validateCancellationEvidence,
  validateCleanupEvidence,
  checkNoSecrets,
} from "./ledger.js";
export { EvaluationInterlock } from "./interlock.js";
export {
  CardRegistry,
  createIssuanceStore,
  createCardStore,
  validateIssuance,
  validateCardCancellation,
  AGGREGATE_CAP_CENTS,
} from "./card.js";
export {
  classifyChallenge,
  attemptAllowed,
  makeChallengeRecord,
  createWorkflowRegistry,
  createChallengeHistory,
  workflowAttemptKey,
  PERMITTED_PHASE,
} from "./challenges.js";
export { forgeEvidence, classifyForgeFinding, snapshotPin } from "./inventory.js";
export {
  createTrustedContext,
  validateTrustedContext,
  confirmedSetDigest,
  admitSubject,
  admitForgePin,
  resolveCitation,
  resolveForgeRef,
  validateExactScope,
  checkSourceApplicability,
  SCOPE_DIMENSIONS,
  SCOPE_FIELDS,
  sourceFreshness,
  verifyCorpusManifest,
  manifestDigest,
  canonicalize,
  sha256Hex,
} from "./trust.js";
export { TAXONOMY_DIGEST } from "./taxonomy.js";

/**
 * Full pipeline: comparison + artifact gate.
 * trusted: REQUIRED trusted admission context.
 * Returns the comparison output, or a refusal if inputs/artifacts fail.
 */
export function runPipeline(input, cellsBySubject, trusted = null) {
  const result = runComparison(input, cellsBySubject, trusted);
  if (result.status === "REFUSED" || result.status === "BLOCKED") return result;
  const violations = gateArtifacts(result);
  if (violations.length > 0) {
    return refusal("BLOCKED", "COPY_DETECTED", violations.slice(0, 10));
  }
  return result;
}
