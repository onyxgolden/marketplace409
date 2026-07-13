function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${location} must be an object`,
    );
  }
}

function assertString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function assertStringArray(
  value,
  location,
) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0,
    )
  ) {
    throw new TypeError(
      `${location} must be an array of non-empty strings`,
    );
  }
}

function includesReviewRequired(value) {
  if (value === "REVIEW_REQUIRED") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some(
      includesReviewRequired,
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    return Object.values(value).some(
      includesReviewRequired,
    );
  }

  return false;
}

function validationPassed(
  validationEvidence,
) {
  assertObject(
    validationEvidence,
    "validationEvidence",
  );

  const validationEntries = [
    validationEvidence.focusedTests,
    validationEvidence.fullTests,
    validationEvidence.productionBuild,
  ];

  return validationEntries.every(
    (entry, index) => {
      assertObject(
        entry,
        `validationEvidence entry ${index}`,
      );

      return [
        "pass",
        "passed",
        "passing",
      ].includes(entry.status);
    },
  );
}

function collectSharedReasons({
  governanceState,
  repositoryEvidence,
  validationEvidence,
  capabilitiesPolicy,
}) {
  const reasons = [];

  assertObject(
    governanceState.state,
    "governanceState.state",
  );

  assertObject(
    repositoryEvidence,
    "repositoryEvidence",
  );

  assertObject(
    capabilitiesPolicy.capabilities,
    "capabilitiesPolicy.capabilities",
  );

  if (
    capabilitiesPolicy.capabilities
      .selectNextObjective !== false
  ) {
    reasons.push({
      code:
        "objective-selection-boundary-invalid",
      message:
        "The selectNextObjective capability must remain false.",
    });
  }

  if (
    repositoryEvidence.workingTreeClean !==
    true
  ) {
    reasons.push({
      code: "working-tree-not-clean",
      message:
        "The repository working tree is not clean.",
    });
  }

  if (
    repositoryEvidence.headMatchesOriginMain !==
    true
  ) {
    reasons.push({
      code:
        "head-does-not-match-origin-main",
      message:
        "Repository HEAD does not match origin/main.",
    });
  }

  if (
    !validationPassed(
      validationEvidence,
    )
  ) {
    reasons.push({
      code: "validation-not-passed",
      message:
        "Focused tests, full tests, and production build have not all passed.",
    });
  }

  if (
    !includesReviewRequired(
      governanceState.state,
    )
  ) {
    reasons.push({
      code:
        "objective-review-not-required",
      message:
        "Canonical governance state does not currently require human objective review.",
    });
  }

  return reasons;
}

function evaluateCandidate({
  candidate,
  index,
  sharedReasons,
  architecturalProgress,
  roadmapPosition,
}) {
  assertObject(
    candidate,
    `candidateObjectives[${index}]`,
  );

  assertString(
    candidate.phaseIdentifier,
    `candidateObjectives[${index}].phaseIdentifier`,
  );

  assertString(
    candidate.title,
    `candidateObjectives[${index}].title`,
  );

  assertString(
    candidate.objective,
    `candidateObjectives[${index}].objective`,
  );

  const prerequisites =
    candidate.prerequisites ?? [];

  assertStringArray(
    prerequisites,
    `candidateObjectives[${index}].prerequisites`,
  );

  const reasons = [
    ...sharedReasons,
  ];

  if (
    candidate.phaseIdentifier !==
    roadmapPosition.nextPhaseIdentifier
  ) {
    reasons.push({
      code:
        "candidate-does-not-match-roadmap-position",
      expected:
        roadmapPosition.nextPhaseIdentifier,
      actual:
        candidate.phaseIdentifier,
      message:
        "The candidate does not match the next roadmap phase.",
    });
  }

  const missingPrerequisites =
    prerequisites.filter(
      (phaseIdentifier) =>
        !architecturalProgress
          .completedPhaseIdentifiers
          .includes(phaseIdentifier),
    );

  if (missingPrerequisites.length > 0) {
    reasons.push({
      code:
        "architectural-prerequisites-incomplete",
      missingPrerequisites,
      message:
        "The candidate has incomplete architectural prerequisites.",
    });
  }

  return {
    phaseIdentifier:
      candidate.phaseIdentifier,
    title:
      candidate.title,
    objective:
      candidate.objective,
    prerequisites: [
      ...prerequisites,
    ],
    recommended:
      reasons.length === 0,
    confidence:
      reasons.length === 0
        ? "high"
        : "none",
    reasons,
  };
}

export function evaluateObjectiveRecommendations({
  governanceState,
  repositoryEvidence,
  validationEvidence,
  architecturalProgress,
  roadmapPosition,
  capabilitiesPolicy,
  candidateObjectives,
}) {
  assertObject(
    governanceState,
    "governanceState",
  );

  assertObject(
    repositoryEvidence,
    "repositoryEvidence",
  );

  assertObject(
    validationEvidence,
    "validationEvidence",
  );

  assertObject(
    architecturalProgress,
    "architecturalProgress",
  );

  assertObject(
    roadmapPosition,
    "roadmapPosition",
  );

  assertObject(
    capabilitiesPolicy,
    "capabilitiesPolicy",
  );

  assertStringArray(
    architecturalProgress
      .completedPhaseIdentifiers,
    "architecturalProgress.completedPhaseIdentifiers",
  );

  assertString(
    roadmapPosition.nextPhaseIdentifier,
    "roadmapPosition.nextPhaseIdentifier",
  );

  if (!Array.isArray(candidateObjectives)) {
    throw new TypeError(
      "candidateObjectives must be an array",
    );
  }

  const sharedReasons =
    collectSharedReasons({
      governanceState,
      repositoryEvidence,
      validationEvidence,
      capabilitiesPolicy,
    });

  const candidates =
    candidateObjectives.map(
      (candidate, index) =>
        evaluateCandidate({
          candidate,
          index,
          sharedReasons,
          architecturalProgress,
          roadmapPosition,
        }),
    );

  const recommendations =
    candidates
      .filter(
        (candidate) =>
          candidate.recommended,
      )
      .map(
        (candidate) => ({
          phaseIdentifier:
            candidate.phaseIdentifier,
          title:
            candidate.title,
          objective:
            candidate.objective,
          confidence:
            candidate.confidence,
          requiresOwnerApproval: true,
        }),
      );

  return {
    capabilityVersion:
      capabilitiesPolicy.version,
    roadmapPosition: {
      nextPhaseIdentifier:
        roadmapPosition.nextPhaseIdentifier,
    },
    summary: {
      candidateCount:
        candidates.length,
      recommendationCount:
        recommendations.length,
      blockedCandidateCount:
        candidates.length -
        recommendations.length,
    },
    candidates,
    recommendations,
    selectedObjective: null,
    authorityBoundary:
      "Recommendations do not select or commit objectives. Human approval remains required.",
  };
}
