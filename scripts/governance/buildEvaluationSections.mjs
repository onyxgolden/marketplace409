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
  promotionState,
) {
  assertObject(
    promotionState,
    "promotionState",
  );

  assertObject(
    promotionState.documents,
    "promotionState.documents",
  );

  const promotableDocuments =
    Object.entries(promotionState.documents)
      .filter(([, documentState]) => {
        assertObject(
          documentState,
          "promotionState document",
        );

        return (
          documentState.state !== "shadow-only"
        );
      })
      .map(([documentName]) => documentName);

  return [
    "## Promotion Recommendations",
    "",
    promotableDocuments.length === 0
      ? "No promotion recommendations have been made."
      : promotableDocuments
          .map(
            (documentName) =>
              `- Review ${documentName} for its currently recorded promotion state.`,
          )
          .join("\n"),
    "",
    "The synchronizer may recommend promotion but may not approve it.",
  ].join("\n");
}
