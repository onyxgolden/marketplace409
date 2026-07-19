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

function assertArray(value, location) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${location} must be an array`,
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

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const childValue of Object.values(value)) {
    deepFreeze(childValue);
  }

  return Object.freeze(value);
}

function shortenCommit(commit) {
  assertNonEmptyString(commit, "commit");

  return commit.slice(0, 7);
}

function validateConversationState(
  conversationState,
) {
  assertPlainObject(
    conversationState,
    "conversationState",
  );

  assertNonEmptyString(
    conversationState.schemaVersion,
    "conversationState.schemaVersion",
  );

  assertNonEmptyString(
    conversationState.generatedAt,
    "conversationState.generatedAt",
  );

  assertPlainObject(
    conversationState.repository,
    "conversationState.repository",
  );

  assertNonEmptyString(
    conversationState.repository.branch,
    "conversationState.repository.branch",
  );

  assertNonEmptyString(
    conversationState.repository.head,
    "conversationState.repository.head",
  );

  assertNonEmptyString(
    conversationState.repository.originMain,
    "conversationState.repository.originMain",
  );

  assertBoolean(
    conversationState.repository
      .workingTreeClean,
    "conversationState.repository.workingTreeClean",
  );

  assertBoolean(
    conversationState.repository
      .headMatchesOriginMain,
    "conversationState.repository.headMatchesOriginMain",
  );

  assertArray(
    conversationState.repository
      .modifiedFiles,
    "conversationState.repository.modifiedFiles",
  );

  for (
    const [
      index,
      modifiedFile,
    ] of conversationState.repository
      .modifiedFiles.entries()
  ) {
    assertNonEmptyString(
      modifiedFile,
      `conversationState.repository.modifiedFiles[${index}]`,
    );
  }

  assertPlainObject(
    conversationState.governance,
    "conversationState.governance",
  );

  assertNonEmptyString(
    conversationState.governance.mode,
    "conversationState.governance.mode",
  );

  assertPlainObject(
    conversationState.governance.activePhase,
    "conversationState.governance.activePhase",
  );

  assertNonEmptyString(
    conversationState.governance
      .activePhase.identifier,
    "conversationState.governance.activePhase.identifier",
  );

  assertNonEmptyString(
    conversationState.governance
      .activePhase.title,
    "conversationState.governance.activePhase.title",
  );

  assertNonEmptyString(
    conversationState.governance
      .currentObjective,
    "conversationState.governance.currentObjective",
  );

  assertPlainObject(
    conversationState.governance.nextSession,
    "conversationState.governance.nextSession",
  );

  assertNonEmptyString(
    conversationState.governance
      .nextSession.objective,
    "conversationState.governance.nextSession.objective",
  );

  assertPlainObject(
    conversationState.insights,
    "conversationState.insights",
  );

  assertNonEmptyString(
    conversationState.insights.validation,
    "conversationState.insights.validation",
  );

  assertBoolean(
    conversationState.insights
      .humanReviewRequired,
    "conversationState.insights.humanReviewRequired",
  );

  assertBoolean(
    conversationState.insights
      .governanceStateCurrent,
    "conversationState.insights.governanceStateCurrent",
  );

  assertPlainObject(
    conversationState.insights
      .recommendedAction,
    "conversationState.insights.recommendedAction",
  );

  if (
    conversationState.evolutionReadiness !==
    null &&
    conversationState.evolutionReadiness !==
    undefined
  ) {
    assertPlainObject(
      conversationState.evolutionReadiness,
      "conversationState.evolutionReadiness",
    );
  }

  assertNonEmptyString(
    conversationState.insights
      .recommendedAction.code,
    "conversationState.insights.recommendedAction.code",
  );

  assertNonEmptyString(
    conversationState.insights
      .recommendedAction.summary,
    "conversationState.insights.recommendedAction.summary",
  );
}

export function buildRepositorySummary(
  conversationState,
) {
  validateConversationState(
    conversationState,
  );

  const {
    repository,
    governance,
    insights,
  } = conversationState;

  return deepFreeze({
    schemaVersion: "1.0",

    generatedAt:
      conversationState.generatedAt,

    repository: {
      branch:
        repository.branch,

      head:
        repository.head,

      headShort:
        shortenCommit(
          repository.head,
        ),

      originMain:
        repository.originMain,

      originMainShort:
        shortenCommit(
          repository.originMain,
        ),

      headMatchesOriginMain:
        repository.headMatchesOriginMain,

      workingTree: {
        clean:
          repository.workingTreeClean,

        modifiedFileCount:
          repository.modifiedFiles.length,

        modifiedFiles: [
          ...repository.modifiedFiles,
        ],
      },
    },

    governance: {
      mode:
        governance.mode,

      activePhase: {
        identifier:
          governance.activePhase.identifier,

        title:
          governance.activePhase.title,
      },

      currentObjective:
        governance.currentObjective,

      nextObjective:
        governance.nextSession.objective,
    },

    validation: {
      overallStatus:
        insights.validation,
    },

    freshness: {
      recordedStateMatchesLive:
        insights.governanceStateCurrent,
    },

    review: {
      humanReviewRequired:
        insights.humanReviewRequired,
    },

    evolutionReadiness:
      conversationState
        .evolutionReadiness,

    recommendation: {
      code:
        insights.recommendedAction.code,

      summary:
        insights.recommendedAction.summary,
    },
  });
}
