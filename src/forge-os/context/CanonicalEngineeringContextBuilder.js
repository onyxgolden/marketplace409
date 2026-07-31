import {
  createCanonicalEngineeringContextContract,
} from "../contracts/v1/contexts/index.js";

const CONTEXT_CONTRACT_VERSION = Object.freeze({
  major: 1,
  minor: 0,
  patch: 0,
  identifier: "1.0.0",
});

export function buildCanonicalEngineeringContext({
  contextIdentity,
  provenance,
  repositoryState,
  memoryState,
  governanceState,
  executionState,
  validationState,
  authorityState,
  evidenceReferences = [],
}) {
  return createCanonicalEngineeringContextContract({
    contractId:
      "forge.context.canonical-engineering-context",
    version:
      CONTEXT_CONTRACT_VERSION,
    description:
      "Canonical Engineering Context.",
    provenance,
    contextIdentity,
    repositoryState,
    memoryState,
    governanceState,
    executionState,
    validationState,
    authorityState,
    evidenceReferences,
  });
}
