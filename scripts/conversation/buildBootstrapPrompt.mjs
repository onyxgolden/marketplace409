function assertPlainObject(value, location) {
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

function assertNonEmptyString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function assertBoolean(value, location) {
  if (typeof value !== "boolean") {
    throw new TypeError(
      `${location} must be a boolean`,
    );
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
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${location} must be an array`,
    );
  }

  for (
    const [
      index,
      item,
    ] of value.entries()
  ) {
    assertNonEmptyString(
      item,
      `${location}[${index}]`,
    );
  }
}

function validateRepositorySummary(
  repositorySummary,
) {
  assertPlainObject(
    repositorySummary,
    "repositorySummary",
  );

  assertNonEmptyString(
    repositorySummary.schemaVersion,
    "repositorySummary.schemaVersion",
  );

  assertNonEmptyString(
    repositorySummary.generatedAt,
    "repositorySummary.generatedAt",
  );

  assertPlainObject(
    repositorySummary.repository,
    "repositorySummary.repository",
  );

  assertNonEmptyString(
    repositorySummary.repository.branch,
    "repositorySummary.repository.branch",
  );

  assertNonEmptyString(
    repositorySummary.repository.head,
    "repositorySummary.repository.head",
  );

  assertNonEmptyString(
    repositorySummary.repository.headShort,
    "repositorySummary.repository.headShort",
  );

  assertNonEmptyString(
    repositorySummary.repository.originMain,
    "repositorySummary.repository.originMain",
  );

  assertNonEmptyString(
    repositorySummary.repository
      .originMainShort,
    "repositorySummary.repository.originMainShort",
  );

  assertBoolean(
    repositorySummary.repository
      .headMatchesOriginMain,
    "repositorySummary.repository.headMatchesOriginMain",
  );

  assertPlainObject(
    repositorySummary.repository
      .workingTree,
    "repositorySummary.repository.workingTree",
  );

  assertBoolean(
    repositorySummary.repository
      .workingTree.clean,
    "repositorySummary.repository.workingTree.clean",
  );

  assertNonNegativeInteger(
    repositorySummary.repository
      .workingTree.modifiedFileCount,
    "repositorySummary.repository.workingTree.modifiedFileCount",
  );

  assertStringArray(
    repositorySummary.repository
      .workingTree.modifiedFiles,
    "repositorySummary.repository.workingTree.modifiedFiles",
  );

  if (
    repositorySummary.repository
      .workingTree.modifiedFileCount !==
    repositorySummary.repository
      .workingTree.modifiedFiles.length
  ) {
    throw new Error(
      "repositorySummary.repository.workingTree.modifiedFileCount must match modifiedFiles length",
    );
  }

  assertPlainObject(
    repositorySummary.governance,
    "repositorySummary.governance",
  );

  assertNonEmptyString(
    repositorySummary.governance.mode,
    "repositorySummary.governance.mode",
  );

  assertPlainObject(
    repositorySummary.governance.activePhase,
    "repositorySummary.governance.activePhase",
  );

  assertNonEmptyString(
    repositorySummary.governance
      .activePhase.identifier,
    "repositorySummary.governance.activePhase.identifier",
  );

  assertNonEmptyString(
    repositorySummary.governance
      .activePhase.title,
    "repositorySummary.governance.activePhase.title",
  );

  assertNonEmptyString(
    repositorySummary.governance
      .currentObjective,
    "repositorySummary.governance.currentObjective",
  );

  assertNonEmptyString(
    repositorySummary.governance
      .nextObjective,
    "repositorySummary.governance.nextObjective",
  );

  assertPlainObject(
    repositorySummary.validation,
    "repositorySummary.validation",
  );

  assertNonEmptyString(
    repositorySummary.validation
      .overallStatus,
    "repositorySummary.validation.overallStatus",
  );

  assertPlainObject(
    repositorySummary.freshness,
    "repositorySummary.freshness",
  );

  assertBoolean(
    repositorySummary.freshness
      .recordedStateMatchesLive,
    "repositorySummary.freshness.recordedStateMatchesLive",
  );

  assertPlainObject(
    repositorySummary.review,
    "repositorySummary.review",
  );

  if (
    repositorySummary.evolutionReadiness !==
    null &&
    repositorySummary.evolutionReadiness !==
    undefined
  ) {
    assertPlainObject(
      repositorySummary.evolutionReadiness,
      "repositorySummary.evolutionReadiness",
    );
  }

  assertBoolean(
    repositorySummary.review
      .humanReviewRequired,
    "repositorySummary.review.humanReviewRequired",
  );

  assertPlainObject(
    repositorySummary.recommendation,
    "repositorySummary.recommendation",
  );

  assertNonEmptyString(
    repositorySummary.recommendation.code,
    "repositorySummary.recommendation.code",
  );

  assertNonEmptyString(
    repositorySummary.recommendation.summary,
    "repositorySummary.recommendation.summary",
  );
}

function formatAlignment(repository) {
  return repository.headMatchesOriginMain
    ? "aligned"
    : "diverged";
}

function formatWorkingTree(workingTree) {
  if (workingTree.clean) {
    return "clean";
  }

  return `dirty (${workingTree.modifiedFileCount} modified or untracked files)`;
}

function formatModifiedFiles(workingTree) {
  if (workingTree.modifiedFiles.length === 0) {
    return [
      "Modified Files",
      "None",
    ];
  }

  return [
    "Modified Files",
    ...workingTree.modifiedFiles.map(
      (filePath) => `- ${filePath}`,
    ),
  ];
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

export function buildBootstrapPrompt(
  repositorySummary,
) {
  validateRepositorySummary(
    repositorySummary,
  );

  const {
    repository,
    governance,
    validation,
    freshness,
    review,
    recommendation,
  } = repositorySummary;

  return [
    "FORGE BOOTSTRAP",
    "",
    "Repository",
    "~/USMarketplace/marketplace409",
    "",
    "Branch",
    repository.branch,
    "",
    "Repository State",
    `HEAD: ${repository.headShort}`,
    `origin/main: ${repository.originMainShort}`,
    `Remote alignment: ${formatAlignment(repository)}`,
    `Working tree: ${formatWorkingTree(repository.workingTree)}`,
    "",
    ...formatModifiedFiles(
      repository.workingTree,
    ),
    "",
    "Governance",
    `Mode: ${governance.mode}`,
    `Active phase: ${governance.activePhase.identifier} — ${governance.activePhase.title}`,
    `Current objective: ${governance.currentObjective}`,
    `Next objective: ${governance.nextObjective}`,
    "",
    "Validation",
    `Overall status: ${validation.overallStatus}`,
    "",
    "Governance Freshness",
    `Recorded state matches live repository: ${formatBoolean(freshness.recordedStateMatchesLive)}`,
    "",
    "Human Review",
    `Required: ${formatBoolean(review.humanReviewRequired)}`,
    "",

    "Governance Evolution Readiness",
    repositorySummary.evolutionReadiness
      ? `Status: ${repositorySummary.evolutionReadiness.status}`
      : "Status: unavailable",

    "Recommended Action",
    `Code: ${recommendation.code}`,
    recommendation.summary,
    "",
    `Generated at: ${repositorySummary.generatedAt}`,
  ].join("\n");
}
