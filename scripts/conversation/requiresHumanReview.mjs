export const REVIEW_REQUIRED = "REVIEW_REQUIRED";

/**
 * The single source of truth for which governance-state fields FORGE's
 * human-review policy requires a reviewer to have actually supplied.
 * True when any of them is still the REVIEW_REQUIRED sentinel.
 *
 * Deliberately excludes work.delivered, work.knownWarnings,
 * objective.startingObjective, and completion.incompleteReason -- those
 * remain legitimately optional; a session can be truthfully incomplete
 * (workComplete: false, incompleteReason explaining why) while still
 * satisfying this policy, as long as phase/current-objective/next-session
 * are populated.
 *
 * Used from both directions on the same governanceState shape
 * ({ state: { activePhase, currentObjective, nextSession } }):
 * buildConversationState.mjs uses it to flag the conversation bootstrap as
 * "still needs a human", and executeProgrammerCommand.js independently
 * uses it to verify a reviewed-session-closeout snapshot/state actually
 * satisfies the same completeness policy before reporting success.
 */
export function requiresHumanReview(governanceState) {
  const { state } = governanceState;

  return [
    state.activePhase.identifier,
    state.activePhase.title,
    state.currentObjective,
    state.nextSession.objective,
    state.nextSession.startingInspection,
  ].some((value) => value === REVIEW_REQUIRED);
}
