import { execFileSync } from "node:child_process";

import {
  loadGovernanceState,
} from "../governance/loadGovernanceState.mjs";

import {
  loadGovernanceMode,
} from "../governance/loadGovernanceMode.mjs";

const REVIEW_REQUIRED = "REVIEW_REQUIRED";

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

function assertFunction(value, location) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${location} must be a function`,
    );
  }
}

function assertNonEmptyString(value, location) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
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

function defaultRunGit(
  args,
  {
    repositoryRoot,
  },
) {
  if (!Array.isArray(args)) {
    throw new TypeError(
      "args must be an array",
    );
  }

  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  try {
    return execFileSync(
      "git",
      args,
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    ).trimEnd();
  } catch (error) {
    const detail =
      error.stderr?.toString().trim() ||
      error.message ||
      "Unknown Git command failure";

    throw new Error(
      `git ${args.join(" ")} failed: ${detail}`,
    );
  }
}

function parseStatusLines(statusOutput) {
  if (typeof statusOutput !== "string") {
    throw new TypeError(
      "Git status output must be a string",
    );
  }

  if (statusOutput.length === 0) {
    return [];
  }

  return statusOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function buildLiveRepositoryState({
  repositoryRoot,
  runGit,
}) {
  const branch = runGit(
    [
      "branch",
      "--show-current",
    ],
    {
      repositoryRoot,
    },
  );

  const head = runGit(
    [
      "rev-parse",
      "HEAD",
    ],
    {
      repositoryRoot,
    },
  );

  const originMain = runGit(
    [
      "rev-parse",
      "origin/main",
    ],
    {
      repositoryRoot,
    },
  );

  const statusOutput = runGit(
    [
      "status",
      "--short",
    ],
    {
      repositoryRoot,
    },
  );

  const statusLines =
    parseStatusLines(statusOutput);

  return {
    branch,
    head,
    originMain,
    workingTreeClean:
      statusLines.length === 0,
    headMatchesOriginMain:
      head === originMain,
    statusLines,
    modifiedFiles:
      statusLines.map(
        (line) =>
          line.length > 3
            ? line.slice(3)
            : line,
      ),
  };
}

function summarizeValidation(validation) {
  assertPlainObject(
    validation,
    "governanceState.validation",
  );

  const results = [
    validation.focusedTests,
    validation.fullTests,
    validation.productionBuild,
  ];

  for (const [index, result] of results.entries()) {
    assertPlainObject(
      result,
      `governanceState.validation result ${index}`,
    );
  }

  const statuses =
    results.map((result) => result.status);

  if (statuses.includes("failing")) {
    return "failing";
  }

  if (
    statuses.every(
      (status) => status === "passing",
    )
  ) {
    return "passing";
  }

  if (
    statuses.every(
      (status) => status === "not-run",
    )
  ) {
    return "not-run";
  }

  return "partial";
}

function requiresHumanReview(governanceState) {
  const { state } = governanceState;

  return [
    state.activePhase.identifier,
    state.activePhase.title,
    state.currentObjective,
    state.nextSession.objective,
    state.nextSession.startingInspection,
  ].some(
    (value) => value === REVIEW_REQUIRED,
  );
}

function buildRecommendedAction({
  repository,
  validationStatus,
  humanReviewRequired,
}) {
  if (!repository.workingTreeClean) {
    return {
      code: "inspect-working-tree",
      summary:
        "Inspect and classify modified and untracked files before beginning additional implementation.",
    };
  }

  if (validationStatus === "failing") {
    return {
      code: "resolve-validation-failures",
      summary:
        "Resolve recorded validation failures before continuing.",
    };
  }

  if (!repository.headMatchesOriginMain) {
    return {
      code: "review-branch-divergence",
      summary:
        "Review the difference between HEAD and origin/main before continuing.",
    };
  }

  if (humanReviewRequired) {
    return {
      code: "complete-human-review",
      summary:
        "Complete the human-reviewed phase, objective, and next-session fields.",
    };
  }

  if (
    validationStatus === "not-run" ||
    validationStatus === "partial"
  ) {
    return {
      code: "refresh-validation",
      summary:
        "Run the validation required for the current objective.",
    };
  }

  return {
    code: "continue-current-objective",
    summary:
      "The repository is ready to continue the current recorded engineering objective.",
  };
}

export function buildConversationState({
  repositoryRoot = process.cwd(),
  engineeringState,
  now = () => new Date(),
  loadState = loadGovernanceState,
  loadMode = loadGovernanceMode,
  runGit = defaultRunGit,
} = {}) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  assertFunction(now, "now");
  assertFunction(loadState, "loadState");
  assertFunction(loadMode, "loadMode");
  assertFunction(runGit, "runGit");

  if (engineeringState !== undefined) {
    assertPlainObject(
      engineeringState,
      "engineeringState",
    );

    assertPlainObject(
      engineeringState.repository,
      "engineeringState.repository",
    );

    if (
      engineeringState.evolutionReadiness !==
      undefined
    ) {
      assertPlainObject(
        engineeringState.evolutionReadiness,
        "engineeringState.evolutionReadiness",
      );
    }
  }

  const governanceState =
    loadState(
      undefined,
      {
        repositoryRoot,
      },
    );

  const governanceMode =
    loadMode(
      undefined,
      {
        repositoryRoot,
      },
    );

  assertPlainObject(
    governanceState,
    "governanceState",
  );

  assertPlainObject(
    governanceMode,
    "governanceMode",
  );

  assertPlainObject(
    governanceState.repository,
    "governanceState.repository",
  );

  assertPlainObject(
    governanceState.state,
    "governanceState.state",
  );

  assertPlainObject(
    governanceState.state.activePhase,
    "governanceState.state.activePhase",
  );

  assertPlainObject(
    governanceState.state.nextSession,
    "governanceState.state.nextSession",
  );

  assertPlainObject(
    governanceState.validation,
    "governanceState.validation",
  );

  assertPlainObject(
    governanceState.completion,
    "governanceState.completion",
  );

  assertPlainObject(
    governanceState.authority,
    "governanceState.authority",
  );

  assertPlainObject(
    governanceState.synchronization,
    "governanceState.synchronization",
  );

  const generatedAt = now();

  if (
    !(generatedAt instanceof Date) ||
    Number.isNaN(generatedAt.getTime())
  ) {
    throw new TypeError(
      "now must return a valid Date",
    );
  }

  const liveRepository =
    engineeringState === undefined
      ? buildLiveRepositoryState({
          repositoryRoot,
          runGit,
        })
      : {
          branch:
            engineeringState.repository.branch,

          head:
            engineeringState.repository.head,

          originMain:
            engineeringState.repository
              .originMain,

          workingTreeClean:
            engineeringState.repository
              .workingTreeClean,

          headMatchesOriginMain:
            engineeringState.repository
              .headMatchesOriginMain,

          statusLines: [
            ...(
              engineeringState.repository
                .statusLines ??
              engineeringState.repository
                .gitStatus ??
              []
            ),
          ],

          modifiedFiles: [
            ...engineeringState.repository
              .modifiedFiles,
          ],
        };

  const validationStatus =
    summarizeValidation(
      governanceState.validation,
    );

  const humanReviewRequired =
    requiresHumanReview(
      governanceState,
    );

  const recommendedAction =
    buildRecommendedAction({
      repository: liveRepository,
      validationStatus,
      humanReviewRequired,
    });

  return deepFreeze({
    schemaVersion: "1.0",

    generatedAt:
      generatedAt.toISOString(),

    repository: {
      ...liveRepository,

      recordedState: {
        branch:
          governanceState.repository.branch,

        head:
          governanceState.repository.head,

        originMain:
          governanceState.repository.originMain,

        workingTreeClean:
          governanceState.repository
            .workingTreeClean,

        headMatchesOriginMain:
          governanceState.repository
            .headMatchesOriginMain,
      },

      recordedStateMatchesLive: {
        branch:
          governanceState.repository.branch ===
          liveRepository.branch,

        head:
          governanceState.repository.head ===
          liveRepository.head,

        originMain:
          governanceState.repository.originMain ===
          liveRepository.originMain,

        workingTreeClean:
          governanceState.repository
            .workingTreeClean ===
          liveRepository.workingTreeClean,
      },
    },

    evolutionReadiness:
      engineeringState
        ?.evolutionReadiness ??
      null,

    governance: {
      mode:
        governanceMode.mode,

      activePhase: {
        ...governanceState.state.activePhase,
      },

      currentObjective:
        governanceState.state.currentObjective,

      nextSession: {
        ...governanceState.state.nextSession,
      },

      completedWork: [
        ...governanceState.state.completedWork,
      ],

      knownWarnings: [
        ...governanceState.state.knownWarnings,
      ],

      validation: {
        focusedTests: {
          ...governanceState.validation
            .focusedTests,
        },

        fullTests: {
          ...governanceState.validation
            .fullTests,
        },

        productionBuild: {
          ...governanceState.validation
            .productionBuild,
        },
      },

      completion: {
        ...governanceState.completion,
      },

      authority: {
        ...governanceState.authority,
      },

      synchronization: {
        ...governanceState.synchronization,
      },

      latestSnapshot:
        governanceState.session
          ?.latestSnapshot ?? null,

      lastUpdated:
        governanceState.session
          ?.lastUpdated ?? null,
    },

    capabilities: {
      screenReadAvailable: true,
      bootstrapAvailable: false,
      contextCompressionAvailable: false,
      promptRecommendationAvailable: false,
    },

    insights: {
      workingTree:
        liveRepository.workingTreeClean
          ? "clean"
          : "dirty",

      validation:
        validationStatus,

      humanReviewRequired,

      governanceStateCurrent:
        governanceState.repository.head ===
          liveRepository.head &&
        governanceState.repository.branch ===
          liveRepository.branch &&
        governanceState.repository
          .workingTreeClean ===
          liveRepository.workingTreeClean,

      recommendedAction,
    },
  });
}
