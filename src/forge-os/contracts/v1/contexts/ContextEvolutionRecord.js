import {
  createBaseContract,
  createContractMetadata,
  createContractProvenance,
} from "../core/index.js";

function freezeContribution(contribution) {
  if (
    contribution !== null &&
    typeof contribution === "object" &&
    !Array.isArray(contribution)
  ) {
    return Object.freeze({
      ...contribution,
    });
  }

  return contribution;
}

function freezeCollection(value) {
  return Array.isArray(value)
    ? Object.freeze([...value])
    : value;
}

function freezeGovernanceDecision(governanceDecision) {
  if (
    governanceDecision !== null &&
    typeof governanceDecision === "object" &&
    !Array.isArray(governanceDecision)
  ) {
    return Object.freeze({
      ...governanceDecision,
      requirementsEvaluated:
        freezeCollection(
          governanceDecision.requirementsEvaluated,
        ),
    });
  }

  return governanceDecision;
}

export function createContextEvolutionRecordContract({
  contractId,
  version,
  description,
  provenance,
  evolutionId,
  sourceManager,
  contribution,
  evidenceReferences = [],
  governanceDecision,
  previousContextIdentity,
  resultingContextIdentity,
  sequence,
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "context-evolution-record",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    evolutionId,
    sourceManager,
    contribution:
      freezeContribution(contribution),
    evidenceReferences:
      freezeCollection(evidenceReferences),
    governanceDecision:
      freezeGovernanceDecision(governanceDecision),
    previousContextIdentity,
    resultingContextIdentity,
    sequence,
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
