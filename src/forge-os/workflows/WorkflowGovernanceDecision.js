export function createWorkflowGovernanceDecision({
  decision,
  workflowId,
  requirementsEvaluated = [],
  reason,
}) {
  if (
    typeof decision !== "string" ||
    decision.length === 0
  ) {
    throw new Error(
      "Workflow governance decision requires a decision value.",
    );
  }

  if (
    typeof workflowId !== "string" ||
    workflowId.length === 0
  ) {
    throw new Error(
      "Workflow governance decision requires a workflowId.",
    );
  }

  if (
    !Array.isArray(
      requirementsEvaluated,
    )
  ) {
    throw new Error(
      "Workflow governance requirements evaluated must be an array.",
    );
  }

  return Object.freeze({
    decision,
    workflowId,
    requirementsEvaluated:
      Object.freeze([
        ...requirementsEvaluated,
      ]),
    reason,
  });
}
