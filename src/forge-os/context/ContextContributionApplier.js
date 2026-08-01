import {
  buildCanonicalEngineeringContext,
} from "./CanonicalEngineeringContextBuilder.js";

import {
  validateContextContribution,
} from "./ContextContributionValidator.js";

import {
  createContextEvolutionRecordContract,
} from "../contracts/v1/contexts/index.js";

function mergeEvidenceReferences(
  existingReferences = [],
  incomingReferences = [],
) {
  return Object.freeze([
    ...new Set([
      ...existingReferences,
      ...incomingReferences,
    ]),
  ]);
}


export class ContextContributionApplier {
  apply({
    currentContext,
    managerIdentity,
    contextContribution,
    evidenceReferences,
    governanceDecision,
  }) {
    const validation =
      validateContextContribution({
        managerIdentity,
        contextContribution,
        evidenceReferences:
          evidenceReferences,
      });

    if (!validation.valid) {
      throw new Error(
        "Invalid context contribution.",
      );
    }

    const previousHistory =
      currentContext.payload.contributionHistory ?? [];

    const nextEvidenceReferences =
      mergeEvidenceReferences(
        currentContext.payload.evidenceReferences,
        evidenceReferences,
      );

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
          evidenceReferences,
        governanceDecision:
          governanceDecision
            ? {
                decision:
                  governanceDecision.decision,
                reason:
                  governanceDecision.reason,
                requirementsEvaluated:
                  governanceDecision.requirementsEvaluated,
              }
            : undefined,
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
        nextEvidenceReferences,
      contributionHistory,
    });
  }
}
