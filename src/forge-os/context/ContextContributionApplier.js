import {
  buildCanonicalEngineeringContext,
} from "./CanonicalEngineeringContextBuilder.js";

import {
  validateContextContribution,
} from "./ContextContributionValidator.js";

export class ContextContributionApplier {
  apply({
    currentContext,
    managerIdentity,
    contextContribution,
  }) {
    const validation =
      validateContextContribution(
        contextContribution,
      );

    if (!validation.valid) {
      throw new Error(
        "Invalid context contribution.",
      );
    }

    const contributionHistory = [
      ...(currentContext.payload.contributionHistory ?? []),
      Object.freeze({
        source: managerIdentity,
        contribution: contextContribution,
      }),
    ];

    return buildCanonicalEngineeringContext({
      contextIdentity:
        currentContext.payload.contextIdentity,
      provenance:
        currentContext.provenance,
      repositoryState:
        currentContext.payload.repositoryState,
      memoryState:
        currentContext.payload.memoryState,
      governanceState:
        currentContext.payload.governanceState,
      executionState:
        currentContext.payload.executionState,
      validationState:
        currentContext.payload.validationState,
      authorityState:
        currentContext.payload.authorityState,
      evidenceReferences:
        currentContext.payload.evidenceReferences,
      contributionHistory,
    });
  }
}
