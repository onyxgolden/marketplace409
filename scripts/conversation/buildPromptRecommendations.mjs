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

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const childValue of Object.values(value)
  ) {
    deepFreeze(childValue);
  }

  return Object.freeze(value);
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
    repositorySummary.repository.headShort,
    "repositorySummary.repository.headShort",
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
    repositorySummary.evolutionReadiness !== null &&
    repositorySummary.evolutionReadiness !== undefined
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

function buildWarnings(
  repositorySummary,
) {
  const warnings = [];

  if (
    !repositorySummary.repository
      .headMatchesOriginMain
  ) {
    warnings.push({
      code:
        "branch-divergence",

      message:
        "HEAD does not match origin/main. Inspect branch and remote divergence before continuing.",
    });
  }

  if (
    !repositorySummary.repository
      .workingTree.clean
  ) {
    warnings.push({
      code:
        "dirty-working-tree",

      message:
        `The working tree contains ${repositorySummary.repository.workingTree.modifiedFileCount} modified or untracked files. Preserve and classify existing work before editing.`,
    });
  }

  if (
    !repositorySummary.freshness
      .recordedStateMatchesLive
  ) {
    warnings.push({
      code:
        "stale-governance-state",

      message:
        "Recorded governance repository state does not match the live repository.",
    });
  }

  if (
    repositorySummary.review
      .humanReviewRequired
  ) {
    warnings.push({
      code:
        "human-review-required",

      message:
        "One or more governance fields require human review before authoritative continuation.",
    });
  }

  if (
    repositorySummary.validation
      .overallStatus !== "passing"
  ) {
    warnings.push({
      code:
        "validation-not-passing",

      message:
        `Recorded validation status is ${repositorySummary.validation.overallStatus}. Run the appropriate validation before promotion or commit.`,
    });
  }

  return warnings;
}

function buildInspectionCommands(
  repositorySummary,
) {
  const commands = [
    [
      "cd ~/USMarketplace/marketplace409",
      "git status --short",
    ].join(" && "),
  ];

  if (
    !repositorySummary.repository
      .headMatchesOriginMain
  ) {
    commands.push(
      [
        "cd ~/USMarketplace/marketplace409",
        "git log --oneline --decorate --graph --max-count=20 --all",
      ].join(" && "),
    );
  }

  if (
    !repositorySummary.repository
      .workingTree.clean
  ) {
    commands.push(
      [
        "cd ~/USMarketplace/marketplace409",
        "git diff --stat",
        "git diff --name-only",
      ].join(" && "),
    );
  }

  return commands;
}

function buildValidationCommands() {
  return [
    [
      "cd ~/USMarketplace/marketplace409",
      "npx vitest run scripts/conversation/__tests__",
    ].join(" && "),

    [
      "cd ~/USMarketplace/marketplace409",
      "git diff --check -- scripts/conversation",
    ].join(" && "),
  ];
}

function buildNextImplementation(
  repositorySummary,
) {
  return {
    objective:
      repositorySummary.governance
        .nextObjective,

    rationale:
      `Continue from Phase ${repositorySummary.governance.activePhase.identifier} — ${repositorySummary.governance.activePhase.title} using the recorded next objective.`,

    constraints: [
      "Inspect current files before editing.",
      "Preserve unrelated repository changes.",
      "Prefer pure deterministic builders.",
      "Do not add filesystem writes unless the orchestration layer explicitly requires them.",
      "Run focused tests before the full conversation subsystem suite.",
    ],
  };
}

export function buildPromptRecommendations(
  repositorySummary,
) {
  validateRepositorySummary(
    repositorySummary,
  );

  const warnings =
    buildWarnings(
      repositorySummary,
    );

  return deepFreeze({
    schemaVersion: "1.0",

    generatedAt:
      repositorySummary.generatedAt,

    readiness: {
      readyToContinue:
        warnings.length === 0,

      warningCount:
        warnings.length,
    },

    evolutionReadiness:
      repositorySummary.evolutionReadiness,

    authoritativeRecommendation: {
      code:
        repositorySummary.recommendation
          .code,

      summary:
        repositorySummary.recommendation
          .summary,
    },

    warnings,

    inspectionCommands:
      buildInspectionCommands(
        repositorySummary,
      ),

    validationCommands:
      buildValidationCommands(),

    nextImplementation:
      buildNextImplementation(
        repositorySummary,
      ),
  });
}
