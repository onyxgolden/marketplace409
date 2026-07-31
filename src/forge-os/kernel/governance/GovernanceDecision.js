export function createGovernanceDecision({
  decision,
  managerIdentity,
  evidenceReferences = [],
  requirementsEvaluated = [],
  reason,
}) {
  if (
    typeof decision !== "string" ||
    decision.length === 0
  ) {
    throw new Error(
      "Governance decision requires a decision value.",
    );
  }

  if (
    typeof managerIdentity !== "string" ||
    managerIdentity.length === 0
  ) {
    throw new Error(
      "Governance decision requires a manager identity.",
    );
  }

  if (!Array.isArray(evidenceReferences)) {
    throw new Error(
      "Governance decision evidence references must be an array.",
    );
  }

  if (!Array.isArray(requirementsEvaluated)) {
    throw new Error(
      "Governance decision requirements evaluated must be an array.",
    );
  }

  return Object.freeze({
    decision,
    managerIdentity,
    evidenceReferences: Object.freeze([
      ...evidenceReferences,
    ]),
    requirementsEvaluated: Object.freeze([
      ...requirementsEvaluated,
    ]),
    reason,
  });
}
