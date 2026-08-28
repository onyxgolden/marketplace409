// Pure, framework-free guided-workflow session logic (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 12.D
// "Guidance session controller"). No I/O, no React, no fetch -- every function here takes a validated
// session/definition/evaluator-results snapshot and returns a new validated session. The caller (a React
// hook, in this codebase) is responsible for fetching fresh application state and re-running evaluators
// before calling advance() -- this module enforces that a step can only move to "complete" as a result of
// a supplied EvaluatorResult, never as a side effect of being called at all, which is what makes "a click
// alone cannot complete a step" true regardless of what UI ends up calling this.

import {
  validateGuidedWorkflowSession,
  EVALUATOR_RESULT_STATUS,
  GUIDED_WORKFLOW_SESSION_STATUS,
} from "./guidedWorkflowContracts.js";

export class GuidedWorkflowAuthorizationError extends Error {
  constructor(reason) {
    super(`Guided workflow session rejected: ${reason}`);
    this.name = "GuidedWorkflowAuthorizationError";
    this.reason = reason;
  }
}

function resultsByStepId(evaluatorResults) {
  return new Map(evaluatorResults.map((result) => [result.stepId, result]));
}

// The one place that decides whether a step is currently something the session should stop on. A step
// evaluated as REQUIRED or REQUIRES_CONFIRMATION or BLOCKED needs the user's attention; AVAILABLE,
// COMPLETE, and NOT_APPLICABLE are all bypassed automatically. This is deliberately generic (not specific
// to Today's Priorities) since every guided workflow built on this module shares the same rule.
function stepNeedsAttention(status) {
  return status === EVALUATOR_RESULT_STATUS.REQUIRED
    || status === EVALUATOR_RESULT_STATUS.REQUIRES_CONFIRMATION
    || status === EVALUATOR_RESULT_STATUS.BLOCKED;
}

function skipReasonCodeForStatus(status) {
  if (status === EVALUATOR_RESULT_STATUS.NOT_APPLICABLE) return "not_applicable";
  if (status === EVALUATOR_RESULT_STATUS.COMPLETE) return "already_complete";
  if (status === EVALUATOR_RESULT_STATUS.AVAILABLE) return "available_not_required";
  return "not_required";
}

// Walks the definition's fixed step order starting at `fromIndex`, returning the first step that
// currently needs attention along with every step skipped along the way. Order is authored into the
// workflow definition itself (already severity-sorted for Today's Priorities), never re-derived here.
function findNextAttentionStep(workflowDefinition, evaluatorResults, fromIndex) {
  const byId = resultsByStepId(evaluatorResults);
  const skipped = [];
  for (let index = fromIndex; index < workflowDefinition.steps.length; index += 1) {
    const step = workflowDefinition.steps[index];
    const result = byId.get(step.stepId);
    if (!result) {
      throw new GuidedWorkflowAuthorizationError(`missing evaluator result for step "${step.stepId}"`);
    }
    if (stepNeedsAttention(result.status)) {
      return { step, index, skipped };
    }
    skipped.push({ stepId: step.stepId, reasonCode: skipReasonCodeForStatus(result.status) });
  }
  return { step: null, index: workflowDefinition.steps.length, skipped };
}

function assertWorkspaceMatch(session, canonicalOwnerId) {
  if (session.canonicalOwnerId !== canonicalOwnerId) {
    throw new GuidedWorkflowAuthorizationError("session belongs to a different workspace");
  }
}

export function authorizeGuidedWorkflowSessionStart({ actingUserId, canonicalOwnerId }) {
  if (typeof actingUserId !== "string" || actingUserId.trim().length === 0) {
    throw new GuidedWorkflowAuthorizationError("actingUserId is required");
  }
  if (typeof canonicalOwnerId !== "string" || canonicalOwnerId.trim().length === 0) {
    throw new GuidedWorkflowAuthorizationError("canonicalOwnerId is required");
  }
}

export function startGuidedWorkflowSession({
  sessionId, workflowDefinition, evaluatorResults, actingUserId, canonicalOwnerId, now,
}) {
  authorizeGuidedWorkflowSessionStart({ actingUserId, canonicalOwnerId });
  const { step, skipped } = findNextAttentionStep(workflowDefinition, evaluatorResults, 0);
  return validateGuidedWorkflowSession({
    sessionId,
    workflowId: workflowDefinition.workflowId,
    workflowVersion: workflowDefinition.version,
    actingUserId,
    canonicalOwnerId,
    currentStepId: step ? step.stepId : null,
    completedStepIds: [],
    skippedSteps: skipped,
    status: step ? GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE : GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED,
    startedAt: now,
    updatedAt: now,
  });
}

// Advances past the current step (recording it completed -- the user has been shown it, not that they
// performed any mutating action, since GW-1 permits no consequential steps) and finds the next step that
// needs attention using a freshly supplied evaluatorResults snapshot. Never trusts the session's own
// stale completedStepIds/skippedSteps to decide what's still required -- always re-derives from the
// evaluator results passed in for *this* call, which is what makes advancing dependent on real
// application state rather than prior client-side bookkeeping.
export function advanceGuidedWorkflowSession(session, workflowDefinition, evaluatorResults, canonicalOwnerId, now) {
  assertWorkspaceMatch(session, canonicalOwnerId);
  if (session.status !== GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE) {
    throw new GuidedWorkflowAuthorizationError(`cannot advance a session with status "${session.status}"`);
  }
  if (!session.currentStepId) {
    throw new GuidedWorkflowAuthorizationError("cannot advance a session with no current step");
  }
  const currentIndex = workflowDefinition.steps.findIndex((step) => step.stepId === session.currentStepId);
  if (currentIndex === -1) {
    throw new GuidedWorkflowAuthorizationError(`current step "${session.currentStepId}" is not part of this workflow`);
  }
  const { step, skipped } = findNextAttentionStep(workflowDefinition, evaluatorResults, currentIndex + 1);
  return validateGuidedWorkflowSession({
    ...session,
    currentStepId: step ? step.stepId : null,
    completedStepIds: [...session.completedStepIds, session.currentStepId],
    skippedSteps: [...session.skippedSteps, ...skipped],
    status: step ? GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE : GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED,
    updatedAt: now,
  });
}

// Moves to the nearest EARLIER step that still needs attention per the supplied evaluator results --
// not merely the previous step in definition order, since that could land on a step that's already
// not_applicable/complete, contradicting "skip steps already completed or not applicable" (design doc
// Section 12) for the direction of travel too. Purely navigational otherwise: does not mutate
// completedStepIds/skippedSteps bookkeeping, since Back is for review, not for re-litigating what the
// next advance() call will decide.
export function goBackGuidedWorkflowSession(session, workflowDefinition, evaluatorResults, canonicalOwnerId, now) {
  assertWorkspaceMatch(session, canonicalOwnerId);
  if (session.status !== GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE) {
    throw new GuidedWorkflowAuthorizationError(`cannot go back in a session with status "${session.status}"`);
  }
  const byId = resultsByStepId(evaluatorResults);
  const currentIndex = session.currentStepId
    ? workflowDefinition.steps.findIndex((step) => step.stepId === session.currentStepId)
    : workflowDefinition.steps.length;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const step = workflowDefinition.steps[index];
    const result = byId.get(step.stepId);
    if (!result) {
      throw new GuidedWorkflowAuthorizationError(`missing evaluator result for step "${step.stepId}"`);
    }
    if (stepNeedsAttention(result.status)) {
      return validateGuidedWorkflowSession({ ...session, currentStepId: step.stepId, updatedAt: now });
    }
  }
  throw new GuidedWorkflowAuthorizationError("no earlier step currently needs attention");
}

export function pauseGuidedWorkflowSession(session, canonicalOwnerId, now) {
  assertWorkspaceMatch(session, canonicalOwnerId);
  if (session.status !== GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE) {
    throw new GuidedWorkflowAuthorizationError(`cannot pause a session with status "${session.status}"`);
  }
  return validateGuidedWorkflowSession({ ...session, status: GUIDED_WORKFLOW_SESSION_STATUS.PAUSED, updatedAt: now });
}

// Resuming re-validates both the workspace boundary and the workflow version -- a paused session from an
// older workflow definition (or, if this ever ran across workspaces, a different owner) must not silently
// resume as if nothing changed. See design doc Section 14: "Pause/resume preserves the correct workflow
// version and workspace" and "Navigation or refresh does not cross workspace boundaries."
export function resumeGuidedWorkflowSession(session, workflowDefinition, canonicalOwnerId, now) {
  assertWorkspaceMatch(session, canonicalOwnerId);
  if (session.status !== GUIDED_WORKFLOW_SESSION_STATUS.PAUSED) {
    throw new GuidedWorkflowAuthorizationError(`cannot resume a session with status "${session.status}"`);
  }
  if (session.workflowVersion !== workflowDefinition.version) {
    throw new GuidedWorkflowAuthorizationError(
      `session was paused on workflow version "${session.workflowVersion}", current version is "${workflowDefinition.version}"`,
    );
  }
  return validateGuidedWorkflowSession({ ...session, status: GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE, updatedAt: now });
}

export function exitGuidedWorkflowSession(session, canonicalOwnerId, now) {
  assertWorkspaceMatch(session, canonicalOwnerId);
  return validateGuidedWorkflowSession({ ...session, status: GUIDED_WORKFLOW_SESSION_STATUS.EXITED, updatedAt: now });
}
