import {
  createGovernanceDecision,
} from "./GovernanceDecision.js";

export class GovernanceEvaluator {
  evaluate({
    outcome,
    currentContext,
  }) {
    if (!outcome) {
      throw new Error(
        "GovernanceEvaluator requires an outcome.",
      );
    }

    const managerIdentity =
      outcome.payload.managerIdentity;

    if (
      typeof managerIdentity !== "string" ||
      managerIdentity.length === 0
    ) {
      throw new Error(
        "GovernanceEvaluator requires a manager identity.",
      );
    }

    const contextContribution =
      outcome.payload.contextContribution;

    const evidenceReferences =
      outcome.payload.producedEvidence || [];

    if (!contextContribution) {
      return createGovernanceDecision({
        decision:
          "approved",
        managerIdentity,
        evidenceReferences,
        requirementsEvaluated: [
          "no-context-mutation-required",
        ],
        reason:
          "No canonical context mutation requested.",
      });
    }

    if (
      !Array.isArray(evidenceReferences)
    ) {
      return createGovernanceDecision({
        decision:
          "rejected",
        managerIdentity,
        requirementsEvaluated: [
          "evidence-required",
        ],
        reason:
          "Context evolution requires evidence references.",
      });
    }

    return createGovernanceDecision({
      decision:
        "approved",
      managerIdentity,
      evidenceReferences,
      requirementsEvaluated: [
        "manager-identity-present",
        "context-contribution-present",
        "evidence-present",
      ],
      reason:
        "Governance requirements satisfied.",
    });
  }
}
