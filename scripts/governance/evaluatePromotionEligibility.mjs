import {
  includesReviewRequired,
  validationPassed,
} from "./evaluateRecommendationEvidence.mjs";

function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function assertNonNegativeInteger(
  value,
  location,
) {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${location} must be a non-negative integer`,
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

function collectFailureReasons(
  promotionPolicy,
  evaluationEvidence,
) {
  const reasons = [];

  const requirements =
    promotionPolicy.requirements;

  assertObject(
    requirements,
    "promotionPolicy.requirements",
  );

  const failures =
    evaluationEvidence.failures ?? {};

  assertObject(
    failures,
    "evaluationEvidence.failures",
  );

  const failureRequirementNames = [
    "protectedContentMutations",
    "inventedCompletionClaims",
    "unsupportedArchitecturalClaims",
    "authoritativeDocumentMutations",
    "criticalFactualErrors",
    "incompleteWorkMarkedComplete",
  ];

  for (
    const requirementName
    of failureRequirementNames
  ) {
    const allowedCount =
      requirements[requirementName];

    const actualCount =
      failures[requirementName] ?? 0;

    assertNonNegativeInteger(
      allowedCount,
      `promotionPolicy.requirements.${requirementName}`,
    );

    assertNonNegativeInteger(
      actualCount,
      `evaluationEvidence.failures.${requirementName}`,
    );

    if (actualCount > allowedCount) {
      reasons.push({
        code: "failure-threshold-exceeded",
        requirement: requirementName,
        expectedMaximum: allowedCount,
        actual: actualCount,
        message:
          `${requirementName} exceeds the promotion-policy threshold.`,
      });
    }
  }

  return reasons;
}

function collectEvidenceReasons(
  promotionPolicy,
  promotionState,
  governanceState,
  evaluationEvidence,
  successfulTrials,
) {
  const reasons = [];

  assertNonNegativeInteger(
    promotionPolicy.minimumSuccessfulTrials,
    "promotionPolicy.minimumSuccessfulTrials",
  );

  assertNonNegativeInteger(
    promotionState.trialCount,
    "promotionState.trialCount",
  );

  assertNonNegativeInteger(
    successfulTrials,
    "documentState.successfulTrials",
  );

  if (
    promotionState.trialCount <
    promotionPolicy.minimumSuccessfulTrials
  ) {
    reasons.push({
      code: "insufficient-recorded-trials",
      expected:
        promotionPolicy.minimumSuccessfulTrials,
      actual: promotionState.trialCount,
      message:
        "The repository has not recorded the minimum number of trial sessions.",
    });
  }

  if (
    successfulTrials <
    promotionPolicy.minimumSuccessfulTrials
  ) {
    reasons.push({
      code: "insufficient-successful-trials",
      expected:
        promotionPolicy.minimumSuccessfulTrials,
      actual: successfulTrials,
      message:
        "The document has not recorded the minimum number of successful trials.",
    });
  }

  assertObject(
    governanceState.completion,
    "governanceState.completion",
  );

  if (
    governanceState.completion.workComplete !==
      true ||
    governanceState.completion
      .supportedByEvidence !== true
  ) {
    reasons.push({
      code: "completion-evidence-incomplete",
      message:
        "The canonical governance state does not contain evidence-supported completion.",
    });
  }

  if (
    includesReviewRequired(
      governanceState.state,
    )
  ) {
    reasons.push({
      code: "human-review-required",
      message:
        "The canonical governance state still contains REVIEW_REQUIRED values.",
    });
  }

  if (
    !validationPassed(
      governanceState.validation,
      {
        location:
          "governanceState.validation",
        acceptedStatuses: [
          "pass",
          "passed",
        ],
      },
    )
  ) {
    reasons.push({
      code: "validation-not-passed",
      message:
        "Focused tests, full tests, and production build have not all passed.",
    });
  }

  const recordedTrialTypes =
    evaluationEvidence.trialTypes ?? [];

  assertStringArray(
    recordedTrialTypes,
    "evaluationEvidence.trialTypes",
  );

  assertStringArray(
    promotionPolicy.requiredTrialTypes,
    "promotionPolicy.requiredTrialTypes",
  );

  const missingTrialTypes =
    promotionPolicy.requiredTrialTypes.filter(
      (trialType) =>
        !recordedTrialTypes.includes(
          trialType,
        ),
    );

  if (missingTrialTypes.length > 0) {
    reasons.push({
      code: "required-trial-types-missing",
      missingTrialTypes,
      message:
        "Not all required governance trial types have been recorded.",
    });
  }

  reasons.push(
    ...collectFailureReasons(
      promotionPolicy,
      evaluationEvidence,
    ),
  );

  return reasons;
}

function evaluateSection({
  documentName,
  sectionName,
  sectionState,
  evidenceReasons,
}) {
  const reasons = [
    ...evidenceReasons,
  ];

  if (sectionState === "human") {
    reasons.push({
      code: "human-controlled-section",
      message:
        "This section is explicitly human-controlled.",
    });
  }

  if (sectionState === "suspended") {
    reasons.push({
      code: "section-suspended",
      message:
        "This section is suspended and cannot be recommended for promotion.",
    });
  }

  if (
    [
      "hybrid-control",
      "agent-controlled",
    ].includes(sectionState)
  ) {
    reasons.push({
      code: "authority-already-granted",
      message:
        "This section already has promoted authority.",
    });
  }

  const eligibleForReview =
    sectionState === "shadow-only" &&
    reasons.length === 0;

  return {
    documentName,
    sectionName,
    currentState: sectionState,
    eligibleForReview,
    reasons,
  };
}

export function evaluatePromotionEligibility({
  promotionPolicy,
  promotionState,
  governanceState,
  repositoryEvidence,
  validationEvidence,
  evaluationEvidence = {},
}) {
  assertObject(
    promotionPolicy,
    "promotionPolicy",
  );

  assertObject(
    promotionState,
    "promotionState",
  );

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
    evaluationEvidence,
    "evaluationEvidence",
  );

  assertObject(
    promotionState.documents,
    "promotionState.documents",
  );

  const documents =
    Object.entries(
      promotionState.documents,
    ).map(
      ([
        documentName,
        documentState,
      ]) => {
        assertObject(
          documentState,
          `promotionState.documents.${documentName}`,
        );

        assertObject(
          documentState.sections,
          `promotionState.documents.${documentName}.sections`,
        );

        assertNonNegativeInteger(
          documentState.successfulTrials,
          `promotionState.documents.${documentName}.successfulTrials`,
        );

        const evidenceReasons =
          collectEvidenceReasons(
            promotionPolicy,
            promotionState,
            governanceState,
            evaluationEvidence,
            documentState.successfulTrials,
          );

        const sections =
          Object.entries(
            documentState.sections,
          ).map(
            ([
              sectionName,
              sectionState,
            ]) =>
              evaluateSection({
                documentName,
                sectionName,
                sectionState,
                evidenceReasons,
              }),
          );

        return {
          documentName,
          currentState:
            documentState.state,
          successfulTrials:
            documentState.successfulTrials,
          eligibleSectionCount:
            sections.filter(
              (section) =>
                section.eligibleForReview,
            ).length,
          sections,
        };
      },
    );

  const recommendations =
    documents.flatMap(
      (document) =>
        document.sections
          .filter(
            (section) =>
              section.eligibleForReview,
          )
          .map(
            (section) => ({
              documentName:
                section.documentName,
              sectionName:
                section.sectionName,
              recommendedState:
                "eligible-for-review",
              requiresOwnerApproval:
                promotionPolicy
                  .requirements
                  .explicitOwnerApproval ===
                true,
            }),
          ),
    );

  const sectionCount =
    documents.reduce(
      (total, document) =>
        total +
        document.sections.length,
      0,
    );

  return {
    policyVersion:
      promotionPolicy.version,
    promotionStateVersion:
      promotionState.version,
    scope:
      promotionPolicy.promotionScope,
    minimumSuccessfulTrials:
      promotionPolicy
        .minimumSuccessfulTrials,
    summary: {
      documentCount:
        documents.length,
      sectionCount,
      eligibleSectionCount:
        recommendations.length,
      blockedSectionCount:
        sectionCount -
        recommendations.length,
    },
    documents,
    recommendations,
    authorityBoundary:
      "Recommendations do not modify authority. Only the owner may approve promotion.",
  };
}
