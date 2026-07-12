function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function displayValue(
  value,
  fallback = "Not recorded",
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

function displaySummary(summary) {
  return displayValue(summary);
}

function buildValidationRows(validation) {
  return [
    [
      "Focused tests",
      displayValue(validation.focusedTests.status),
      displaySummary(validation.focusedTests.summary),
    ],
    [
      "Full tests",
      displayValue(validation.fullTests.status),
      displaySummary(validation.fullTests.summary),
    ],
    [
      "Production build",
      displayValue(validation.productionBuild.status),
      displaySummary(validation.productionBuild.summary),
    ],
  ];
}

export function buildValidationEvidence(
  governanceState,
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const validation = governanceState.validation;

  assertObject(
    validation,
    "governanceState.validation",
  );

  assertObject(
    validation.focusedTests,
    "governanceState.validation.focusedTests",
  );

  assertObject(
    validation.fullTests,
    "governanceState.validation.fullTests",
  );

  assertObject(
    validation.productionBuild,
    "governanceState.validation.productionBuild",
  );

  const rows = buildValidationRows(validation);

  return [
    "## Validation Evidence",
    "",
    "| Validation       | Status | Summary |",
    "| ---------------- | ------ | ------- |",
    ...rows.map(
      ([label, status, summary]) =>
        `| ${label.padEnd(16)} | ${status} | ${summary} |`,
    ),
  ].join("\n");
}

export function buildVerifiedValidationEvidence(
  governanceState,
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const validation = governanceState.validation;
  const completion = governanceState.completion;

  assertObject(
    validation,
    "governanceState.validation",
  );

  assertObject(
    completion,
    "governanceState.completion",
  );

  assertObject(
    validation.focusedTests,
    "governanceState.validation.focusedTests",
  );

  assertObject(
    validation.fullTests,
    "governanceState.validation.fullTests",
  );

  assertObject(
    validation.productionBuild,
    "governanceState.validation.productionBuild",
  );

  const rows = buildValidationRows(validation);

  const evidenceStatement =
    completion.supportedByEvidence === true
      ? "Completion is supported by recorded validation evidence."
      : displayValue(
          completion.incompleteReason,
          "Completion is not supported by recorded validation evidence.",
        );

  return [
    "## Verified Validation Evidence",
    "",
    ...rows.map(
      ([label, status, summary]) =>
        `- **${label}:** ${status}; ${summary}`,
    ),
    "",
    `**Completion supported by evidence:** ${
      completion.supportedByEvidence === true
        ? "yes"
        : "no"
    }`,
    "",
    evidenceStatement,
  ].join("\n");
}
