function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function assertNonNegativeInteger(value, location) {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${location} must be a non-negative integer`,
    );
  }
}

function collectSuccessfulTrials(promotionState) {
  const documents = promotionState.documents;

  assertObject(
    documents,
    "promotionState.documents",
  );

  return Object.entries(documents)
    .map(([documentName, documentState]) => {
      assertObject(
        documentState,
        `promotionState.documents.${documentName}`,
      );

      assertNonNegativeInteger(
        documentState.successfulTrials,
        `promotionState.documents.${documentName}.successfulTrials`,
      );

      return {
        documentName,
        successfulTrials:
          documentState.successfulTrials,
      };
    })
    .filter(
      ({ successfulTrials }) =>
        successfulTrials > 0,
    );
}

export function buildTrialHistory(
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  assertNonNegativeInteger(
    promotionState.trialCount,
    "promotionState.trialCount",
  );

  const successfulTrials =
    collectSuccessfulTrials(promotionState);

  if (
    promotionState.trialCount === 0 &&
    successfulTrials.length === 0
  ) {
    return [
      "# Trial History",
      "",
      "No trial sessions have been recorded.",
    ].join("\n");
  }

  return [
    "# Trial History",
    "",
    `**Recorded trials:** ${promotionState.trialCount}`,
    "",
    successfulTrials.length === 0
      ? "No document has recorded a successful trial."
      : successfulTrials
          .map(
            ({
              documentName,
              successfulTrials,
            }) =>
              `- **${documentName}:** ${successfulTrials} successful trial${
                successfulTrials === 1 ? "" : "s"
              }`,
          )
          .join("\n"),
  ].join("\n");
}

export function buildComparisonResults(
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  assertNonNegativeInteger(
    promotionState.trialCount,
    "promotionState.trialCount",
  );

  return [
    "## Comparison Results",
    "",
    promotionState.trialCount === 0
      ? "No authoritative-to-shadow comparison has been recorded."
      : "Comparison results require recorded evaluation evidence and are not inferred from trial count alone.",
  ].join("\n");
}

export function buildObservedStrengths(
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  const successfulTrials =
    collectSuccessfulTrials(promotionState);

  return [
    "## Observed Strengths",
    "",
    successfulTrials.length === 0
      ? "None recorded."
      : successfulTrials
          .map(
            ({
              documentName,
              successfulTrials,
            }) =>
              `- ${documentName}: ${successfulTrials} successful trial${
                successfulTrials === 1 ? "" : "s"
              } recorded.`,
          )
          .join("\n"),
  ].join("\n");
}

export function buildObservedFailures(
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  return [
    "## Observed Failures",
    "",
    "None recorded.",
  ].join("\n");
}

export function buildCorrectionsRequired(
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  return [
    "## Corrections Required",
    "",
    "None recorded.",
  ].join("\n");
}

export function buildPromotionRecommendations(
  promotionEvaluation,
  objectiveEvaluation = {
    recommendations: [],
    selectedObjective: null,
    authorityBoundary:
      "Recommendations do not select or commit objectives. Human approval remains required.",
  },
) {
  assertObject(
    promotionEvaluation,
    "promotionEvaluation",
  );

  assertObject(
    objectiveEvaluation,
    "objectiveEvaluation",
  );

  if (
    !Array.isArray(
      promotionEvaluation.recommendations,
    )
  ) {
    throw new TypeError(
      "promotionEvaluation.recommendations must be an array",
    );
  }

  if (
    !Array.isArray(
      objectiveEvaluation.recommendations,
    )
  ) {
    throw new TypeError(
      "objectiveEvaluation.recommendations must be an array",
    );
  }

  if (
    objectiveEvaluation.selectedObjective !==
      null
  ) {
    throw new TypeError(
      "objectiveEvaluation.selectedObjective must remain null",
    );
  }

  const promotionRecommendations =
    promotionEvaluation.recommendations.map(
      (
        recommendation,
        index,
      ) => {
        assertObject(
          recommendation,
          `promotionEvaluation.recommendations[${index}]`,
        );

        const {
          documentName,
          sectionName,
          recommendedState,
          requiresOwnerApproval,
        } = recommendation;

        if (
          typeof documentName !== "string" ||
          documentName.length === 0
        ) {
          throw new TypeError(
            `promotionEvaluation.recommendations[${index}].documentName must be a non-empty string`,
          );
        }

        if (
          typeof sectionName !== "string" ||
          sectionName.length === 0
        ) {
          throw new TypeError(
            `promotionEvaluation.recommendations[${index}].sectionName must be a non-empty string`,
          );
        }

        if (
          recommendedState !==
          "eligible-for-review"
        ) {
          throw new TypeError(
            `promotionEvaluation.recommendations[${index}].recommendedState must be eligible-for-review`,
          );
        }

        if (
          requiresOwnerApproval !== true
        ) {
          throw new TypeError(
            `promotionEvaluation.recommendations[${index}].requiresOwnerApproval must be true`,
          );
        }

        return [
          `- **${documentName} / ${sectionName}:**`,
          "recommend promotion to `eligible-for-review`; owner approval remains required.",
        ].join(" ");
      },
    );

  const objectiveRecommendations =
    objectiveEvaluation.recommendations.map(
      (
        recommendation,
        index,
      ) => {
        assertObject(
          recommendation,
          `objectiveEvaluation.recommendations[${index}]`,
        );

        const {
          phaseIdentifier,
          title,
          objective,
          confidence,
          requiresOwnerApproval,
        } = recommendation;

        for (
          const [fieldName, value]
          of Object.entries({
            phaseIdentifier,
            title,
            objective,
            confidence,
          })
        ) {
          if (
            typeof value !== "string" ||
            value.length === 0
          ) {
            throw new TypeError(
              `objectiveEvaluation.recommendations[${index}].${fieldName} must be a non-empty string`,
            );
          }
        }

        if (
          requiresOwnerApproval !== true
        ) {
          throw new TypeError(
            `objectiveEvaluation.recommendations[${index}].requiresOwnerApproval must be true`,
          );
        }

        return [
          `- **Phase ${phaseIdentifier} — ${title}:**`,
          `${objective} Confidence: \`${confidence}\`; owner approval remains required.`,
        ].join(" ");
      },
    );

  return [
    "## Promotion Recommendations",
    "",
    promotionRecommendations.length === 0
      ? "No promotion recommendations have been made."
      : promotionRecommendations.join("\n"),
    "",
    promotionEvaluation.authorityBoundary,
    "",
    "### Objective Recommendations",
    "",
    objectiveRecommendations.length === 0
      ? "No objective recommendations have been made."
      : objectiveRecommendations.join("\n"),
    "",
    objectiveEvaluation.authorityBoundary,
  ].join("\n");
}
