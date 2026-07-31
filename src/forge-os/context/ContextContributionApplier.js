import {
  buildCanonicalEngineeringContext,
} from "./CanonicalEngineeringContextBuilder.js";

import {
  validateContextContribution,
} from "./ContextContributionValidator.js";

import {
  createContextEvolutionRecordContract,
} from "../contracts/v1/contexts/index.js";

export class ContextContributionApplier {
  apply({
    currentContext,
    managerIdentity,
    contextContribution,
  }) {
    const validation =
      validateContextContribution({
        managerIdentity,
        contextContribution,
        evidenceReferences:
          currentContext.payload.evidenceReferences,
      });

    if (!validation.valid) {
      throw new Error(
        "Invalid context contribution.",
      );
    }

    const previousHistory =
      currentContext.payload.contributionHistory ?? [];

    const evolutionRecord =
      createContextEvolutionRecordContract({
        contractId:
          "forge.context.evolution-record",
        version: {
          major: 1,
          minor: 0,
          patch: 0,
          identifier: "1.0.0",
        },
        description:
          "Records canonical context evolution.",
        provenance:
          currentContext.provenance,
        evolutionId:
          `context-evolution-${previousHistory.length + 1}`,
        sourceManager:
          managerIdentity,
        contribution:
          contextContribution,
        evidenceReferences:
          currentContext.payload.evidenceReferences,
        previousContextIdentity:
          currentContext.payload.contextIdentity,
        resultingContextIdentity:
          currentContext.payload.contextIdentity,
        sequence:
          previousHistory.length + 1,
      });

    const contributionHistory = [
      ...previousHistory,
      evolutionRecord,
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
