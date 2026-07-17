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

function buildRepositoryToken(
  repository,
) {
  const alignment =
    repository.headMatchesOriginMain
      ? "aligned"
      : "diverged";

  const workingTree =
    repository.workingTree.clean
      ? "clean"
      : `dirty:${repository.workingTree.modifiedFileCount}`;

  return [
    repository.branch,
    repository.headShort,
    repository.originMainShort,
    alignment,
    workingTree,
  ].join("|");
}

function buildGovernanceToken(
  governance,
) {
  return [
    governance.mode,
    governance.activePhase.identifier,
    governance.currentObjective,
    governance.nextObjective,
  ].join("|");
}

function buildAttentionFlags(
  repositorySummary,
) {
  const flags = [];

  if (
    !repositorySummary.repository
      .headMatchesOriginMain
  ) {
    flags.push(
      "branch-divergence",
    );
  }

  if (
    !repositorySummary.repository
      .workingTree.clean
  ) {
    flags.push(
      "dirty-working-tree",
    );
  }

  if (
    !repositorySummary.freshness
      .recordedStateMatchesLive
  ) {
    flags.push(
      "stale-governance-state",
    );
  }

  if (
    repositorySummary.review
      .humanReviewRequired
  ) {
    flags.push(
      "human-review-required",
    );
  }

  if (
    repositorySummary.validation
      .overallStatus !== "passing"
  ) {
    flags.push(
      "validation-not-passing",
    );
  }

  return flags;
}

export function buildContextCompression(
  repositorySummary,
) {
  validateRepositorySummary(
    repositorySummary,
  );

  const attentionFlags =
    buildAttentionFlags(
      repositorySummary,
    );

  return deepFreeze({
    schemaVersion: "1.0",

    generatedAt:
      repositorySummary.generatedAt,

    repositoryToken:
      buildRepositoryToken(
        repositorySummary.repository,
      ),

    governanceToken:
      buildGovernanceToken(
        repositorySummary.governance,
      ),

    repository: {
      branch:
        repositorySummary.repository.branch,

      head:
        repositorySummary.repository
          .headShort,

      originMain:
        repositorySummary.repository
          .originMainShort,

      aligned:
        repositorySummary.repository
          .headMatchesOriginMain,

      workingTreeClean:
        repositorySummary.repository
          .workingTree.clean,

      modifiedFileCount:
        repositorySummary.repository
          .workingTree.modifiedFileCount,

      modifiedFiles: [
        ...repositorySummary.repository
          .workingTree.modifiedFiles,
      ],
    },

    governance: {
      mode:
        repositorySummary.governance.mode,

      phase:
        repositorySummary.governance
          .activePhase.identifier,

      phaseTitle:
        repositorySummary.governance
          .activePhase.title,

      currentObjective:
        repositorySummary.governance
          .currentObjective,

      nextObjective:
        repositorySummary.governance
          .nextObjective,
    },

    status: {
      validation:
        repositorySummary.validation
          .overallStatus,

      governanceCurrent:
        repositorySummary.freshness
          .recordedStateMatchesLive,

      humanReviewRequired:
        repositorySummary.review
          .humanReviewRequired,
    },

    recommendation: {
      code:
        repositorySummary.recommendation
          .code,

      summary:
        repositorySummary.recommendation
          .summary,
    },

    attention: {
      required:
        attentionFlags.length > 0,

      flags:
        attentionFlags,
    },
  });
}
