function assertPlainObject(
  value,
  label,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} must be an object`,
    );
  }
}

function deepFreeze(
  value,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (
    const nestedValue of Object.values(value)
  ) {
    deepFreeze(
      nestedValue,
    );
  }

  return value;
}

export function buildEvolutionReviewContext({
  repositoryEvidence,
  governanceState,
  validationEvidence,
  promotionEvaluation,
  evolutionReadiness,
} = {}) {
  assertPlainObject(
    repositoryEvidence,
    "repositoryEvidence",
  );

  assertPlainObject(
    governanceState,
    "governanceState",
  );

  assertPlainObject(
    validationEvidence,
    "validationEvidence",
  );

  assertPlainObject(
    promotionEvaluation,
    "promotionEvaluation",
  );

  assertPlainObject(
    evolutionReadiness,
    "evolutionReadiness",
  );

  return deepFreeze({
    repositoryEvidence,
    governanceState,
    validationEvidence,
    promotionEvaluation,
    evolutionReadiness,

    humanDecision: {
      status: "pending",
    },
  });
}
