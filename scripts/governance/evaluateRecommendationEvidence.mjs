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

export function includesReviewRequired(
  value,
) {
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

export function validationPassed(
  validationEvidence,
  {
    location = "validationEvidence",
    acceptedStatuses = [
      "pass",
      "passed",
      "passing",
    ],
  } = {},
) {
  assertObject(
    validationEvidence,
    location,
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
        `${location} entry ${index}`,
      );

      return acceptedStatuses.includes(
        entry.status,
      );
    },
  );
}
