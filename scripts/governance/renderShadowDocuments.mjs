import fs from "node:fs";
import path from "node:path";
import {
  evaluatePromotionEligibility,
} from "./evaluatePromotionEligibility.mjs";

import {
  evaluateObjectiveRecommendations,
} from "./evaluateObjectiveRecommendations.mjs";

import {
  buildComparisonResults,
  buildCorrectionsRequired,
  buildObservedFailures,
  buildObservedStrengths,
  buildPromotionRecommendations,
  buildTrialHistory,
} from "./buildEvaluationSections.mjs";

import {
  buildActivePhase,
  buildCurrentObjective,
} from "./buildPhaseObjectiveSections.mjs";

import {
  buildRepositoryHealth,
  buildRepositoryState,
} from "./buildRepositorySections.mjs";

import {
  buildCapabilityStatus,
  buildCompletedWork,
  buildKnownWarnings,
  buildLastCompletedWork,
  buildStartingInspection,
} from "./buildStateSections.mjs";

import {
  buildSynchronizationMetadata,
} from "./buildSynchronizationMetadata.mjs";

import {
  buildValidationEvidence,
  buildVerifiedValidationEvidence,
} from "./buildValidationSections.mjs";

import {
  loadGovernanceState,
} from "./loadGovernanceState.mjs";

import {
  replaceSyncSectionContent,
} from "./replaceSyncSection.mjs";

const synchronizedDirectory =
  "docs/architecture/synchronized";

const promotionStatePath =
  "governance/state/promotion-state.json";

const promotionPolicyPath =
  "governance/policies/promotion-policy.json";

const objectivePolicyPath =
  "governance/policies/objective-policy.json";

const capabilitiesPolicyPath =
  "governance/policies/capabilities.json";

const documentNames = [
  "FORGE_SYNC_CONTROL_CENTER.md",
  "FORGE_SYNC_STATUS.md",
  "FORGE_SYNC_SESSION.md",
  "FORGE_SYNC_ROADMAP.md",
  "FORGE_SYNC_EVALUATION.md",
];

function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function readJsonFile(
  repositoryRoot,
  relativePath,
  label,
) {
  const absolutePath = path.resolve(
    repositoryRoot,
    relativePath,
  );

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `${label} does not exist: ${relativePath}`,
    );
  }

  let content;

  try {
    content = fs.readFileSync(
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${relativePath}: ${error.message}`,
    );
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }
}

function readShadowDocument(
  repositoryRoot,
  documentName,
) {
  const relativePath = path.join(
    synchronizedDirectory,
    documentName,
  );

  const absolutePath = path.resolve(
    repositoryRoot,
    relativePath,
  );

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Shadow document does not exist: ${relativePath}`,
    );
  }

  try {
    return fs.readFileSync(
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `Shadow document could not be read: ${relativePath}: ${error.message}`,
    );
  }
}

function applySectionMap(
  documentContent,
  sectionMap,
) {
  assertObject(
    sectionMap,
    "sectionMap",
  );

  let renderedContent = documentContent;

  for (
    const [sectionId, replacementContent]
    of Object.entries(sectionMap)
  ) {
    renderedContent =
      replaceSyncSectionContent(
        renderedContent,
        sectionId,
        replacementContent,
      );
  }

  return renderedContent;
}

function buildControlCenterSections(
  governanceState,
) {
  return {
    repository_state:
      buildRepositoryState(governanceState),

    active_phase:
      buildActivePhase(governanceState),

    current_objective:
      buildCurrentObjective(governanceState),

    completed_work:
      buildCompletedWork(governanceState),

    validation_evidence:
      buildValidationEvidence(governanceState),

    synchronization_metadata:
      buildSynchronizationMetadata(
        governanceState,
      ),
  };
}

function buildStatusSections(
  governanceState,
) {
  return {
    repository_state:
      buildRepositoryState(governanceState),

    active_phase:
      buildActivePhase(
        governanceState,
        {
          statusDocument: true,
        },
      ),

    current_objective:
      buildCurrentObjective(
        governanceState,
        {
          statusDocument: true,
        },
      ),

    capability_status:
      buildCapabilityStatus(governanceState),

    validation_evidence:
      buildValidationEvidence(governanceState),

    synchronization_metadata:
      buildSynchronizationMetadata(
        governanceState,
      ),
  };
}

function buildSessionSections(
  governanceState,
) {
  return {
    active_phase:
      buildActivePhase(governanceState),

    current_objective:
      buildCurrentObjective(governanceState),

    last_completed_work:
      buildLastCompletedWork(governanceState),

    repository_health:
      buildRepositoryHealth(governanceState),

    known_warnings:
      buildKnownWarnings(governanceState),

    starting_inspection:
      buildStartingInspection(governanceState),

    synchronization_metadata:
      buildSynchronizationMetadata(
        governanceState,
      ),
  };
}

function buildRoadmapSections(
  governanceState,
) {
  return {
    synchronization_metadata:
      buildSynchronizationMetadata(
        governanceState,
      ),

    verified_validation_evidence:
      buildVerifiedValidationEvidence(
        governanceState,
      ),
  };
}

function buildEvaluationSections(
  governanceState,
  promotionState,
  promotionEvaluation,
  objectiveEvaluation,
) {
  return {
    trial_history:
      buildTrialHistory(promotionState),

    comparison_results:
      buildComparisonResults(
        promotionState,
      ),

    observed_strengths:
      buildObservedStrengths(
        promotionState,
      ),

    observed_failures:
      buildObservedFailures(
        promotionState,
      ),

    corrections_required:
      buildCorrectionsRequired(
        promotionState,
      ),

    promotion_recommendations:
      buildPromotionRecommendations(
        promotionEvaluation,
        objectiveEvaluation,
      ),

    synchronization_metadata:
      buildSynchronizationMetadata(
        governanceState,
        {
          evaluationDocument: true,
        },
      ),
  };
}
function buildSectionMapForDocument(
  documentName,
  governanceState,
  promotionState,
  promotionEvaluation,
  objectiveEvaluation,
) {
  switch (documentName) {
    case "FORGE_SYNC_CONTROL_CENTER.md":
      return buildControlCenterSections(
        governanceState,
      );

    case "FORGE_SYNC_STATUS.md":
      return buildStatusSections(
        governanceState,
      );

    case "FORGE_SYNC_SESSION.md":
      return buildSessionSections(
        governanceState,
      );

    case "FORGE_SYNC_ROADMAP.md":
      return buildRoadmapSections(
        governanceState,
      );

    case "FORGE_SYNC_EVALUATION.md":
      return buildEvaluationSections(
        governanceState,
        promotionState,
        promotionEvaluation,
        objectiveEvaluation,
      );

    default:
      throw new Error(
        `Unsupported shadow document: ${documentName}`,
      );
  }
}

export function renderShadowDocumentContent(
  documentName,
  documentContent,
  governanceState,
  promotionState,
  promotionEvaluation = {
    recommendations: [],
    authorityBoundary:
      "Recommendations do not modify authority. Only the owner may approve promotion.",
  },
  objectiveEvaluation = {
    recommendations: [],
    selectedObjective: null,
    authorityBoundary:
      "Recommendations do not select or commit objectives. Human approval remains required.",
  },
) {
  if (
    typeof documentName !== "string" ||
    documentName.length === 0
  ) {
    throw new TypeError(
      "documentName must be a non-empty string",
    );
  }

  if (typeof documentContent !== "string") {
    throw new TypeError(
      "documentContent must be a string",
    );
  }

  assertObject(
    governanceState,
    "governanceState",
  );

  assertObject(
    promotionState,
    "promotionState",
  );

  const sectionMap =
    buildSectionMapForDocument(
      documentName,
      governanceState,
      promotionState,
      promotionEvaluation,
      objectiveEvaluation,
    );

  return applySectionMap(
    documentContent,
    sectionMap,
  );
}

export function renderAllShadowDocuments({
  repositoryRoot = process.cwd(),
  governanceStatePath =
    "governance/state/current-governance-state.json",
} = {}) {
  if (
    typeof repositoryRoot !== "string" ||
    repositoryRoot.length === 0
  ) {
    throw new TypeError(
      "repositoryRoot must be a non-empty string",
    );
  }

  const governanceState =
    loadGovernanceState(
      governanceStatePath,
      {
        repositoryRoot,
      },
    );

  const promotionState = readJsonFile(
    repositoryRoot,
    promotionStatePath,
    "Promotion state",
  );

  const promotionPolicy = readJsonFile(
    repositoryRoot,
    promotionPolicyPath,
    "Promotion policy",
  );

  const promotionEvaluation =
    evaluatePromotionEligibility({
      promotionPolicy,
      promotionState,
      governanceState,
      repositoryEvidence:
        governanceState.repository,
      validationEvidence:
        governanceState.validation,
    });

  const objectivePolicy = readJsonFile(
    repositoryRoot,
    objectivePolicyPath,
    "Objective policy",
  );

  const capabilitiesPolicy = readJsonFile(
    repositoryRoot,
    capabilitiesPolicyPath,
    "Capabilities policy",
  );

  const completedPhaseIdentifiers =
    objectivePolicy.phases
      .filter(
        (phase) =>
          phase.status === "complete",
      )
      .map(
        (phase) =>
          phase.identifier,
      );

  const candidateObjectives =
    objectivePolicy.phases
      .filter(
        (phase) =>
          phase.status !== "complete",
      )
      .map(
        (phase) => ({
          phaseIdentifier:
            phase.identifier,
          title:
            phase.title,
          objective:
            phase.objective,
          prerequisites: [
            ...phase.prerequisites,
          ],
        }),
      );

  const objectiveEvaluation =
    evaluateObjectiveRecommendations({
      governanceState,
      repositoryEvidence:
        governanceState.repository,
      validationEvidence:
        governanceState.validation,
      architecturalProgress: {
        completedPhaseIdentifiers,
      },
      roadmapPosition:
        objectivePolicy.roadmapPosition,
      capabilitiesPolicy,
      candidateObjectives,
    });

  return Object.fromEntries(
    documentNames.map((documentName) => {
      const originalContent =
        readShadowDocument(
          repositoryRoot,
          documentName,
        );

      const renderedContent =
        renderShadowDocumentContent(
          documentName,
          originalContent,
          governanceState,
          promotionState,
          promotionEvaluation,
          objectiveEvaluation,
        );

      return [
        documentName,
        renderedContent,
      ];
    }),
  );
}
