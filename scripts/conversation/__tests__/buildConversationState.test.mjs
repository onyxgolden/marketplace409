import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildConversationState,
} from "../buildConversationState.mjs";

function createGovernanceState({
  branch = "main",
  head = "abc123",
  originMain = "abc123",
  workingTreeClean = true,
  headMatchesOriginMain = true,
  phaseIdentifier = "15.6",
  phaseTitle = "Conversation Intelligence",
  currentObjective = "Build conversation state",
  nextObjective = "Build repository summary",
  startingInspection = "Inspect conversation scripts",
  focusedTestsStatus = "passing",
  fullTestsStatus = "passing",
  productionBuildStatus = "passing",
} = {}) {
  return {
    repository: {
      branch,
      head,
      originMain,
      workingTreeClean,
      headMatchesOriginMain,
    },

    state: {
      activePhase: {
        identifier: phaseIdentifier,
        title: phaseTitle,
      },

      currentObjective,

      nextSession: {
        objective: nextObjective,
        startingInspection,
      },

      completedWork: [
        "Authoritative governance integration",
      ],

      knownWarnings: [],
    },

    validation: {
      focusedTests: {
        status: focusedTestsStatus,
        command: "npx vitest run",
      },

      fullTests: {
        status: fullTestsStatus,
        command: "npx vitest run",
      },

      productionBuild: {
        status: productionBuildStatus,
        command: "npm run build",
      },
    },

    completion: {
      status: "in-progress",
    },

    authority: {
      source: "governance-state",
    },

    synchronization: {
      status: "current",
    },

    session: {
      latestSnapshot:
        "governance/snapshots/latest.json",

      lastUpdated:
        "2026-07-17T12:00:00.000Z",
    },
  };
}

function createDependencies({
  governanceState = createGovernanceState(),
  governanceMode = {
    mode: "shadow",
  },
  branch = "main",
  head = "abc123",
  originMain = "abc123",
  status = "",
} = {}) {
  const loadState =
    vi.fn(() => governanceState);

  const loadMode =
    vi.fn(() => governanceMode);

  const responses = new Map([
    [
      "branch --show-current",
      branch,
    ],
    [
      "rev-parse HEAD",
      head,
    ],
    [
      "rev-parse origin/main",
      originMain,
    ],
    [
      "status --short",
      status,
    ],
  ]);

  const runGit =
    vi.fn((args) => {
      const command = args.join(" ");

      if (!responses.has(command)) {
        throw new Error(
          `Unexpected Git command: ${command}`,
        );
      }

      return responses.get(command);
    });

  return {
    loadState,
    loadMode,
    runGit,
  };
}

describe(
  "buildConversationState",
  () => {
    it(
      "builds an immutable conversation state from governance and live repository data",
      () => {
        const dependencies =
          createDependencies();

        const result =
          buildConversationState({
            repositoryRoot:
              "/repository",

            now: () =>
              new Date(
                "2026-07-17T17:00:00.000Z",
              ),

            ...dependencies,
          });

        expect(result).toMatchObject({
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T17:00:00.000Z",

          repository: {
            branch: "main",
            head: "abc123",
            originMain: "abc123",
            workingTreeClean: true,
            headMatchesOriginMain: true,
            statusLines: [],
            modifiedFiles: [],

            recordedStateMatchesLive: {
              branch: true,
              head: true,
              originMain: true,
              workingTreeClean: true,
            },
          },

          governance: {
            mode: "shadow",

            activePhase: {
              identifier: "15.6",
              title:
                "Conversation Intelligence",
            },

            currentObjective:
              "Build conversation state",
          },

          capabilities: {
            screenReadAvailable: true,
            bootstrapAvailable: false,
            contextCompressionAvailable:
              false,
            promptRecommendationAvailable:
              false,
          },

          insights: {
            workingTree: "clean",
            validation: "passing",
            humanReviewRequired: false,
            governanceStateCurrent: true,

            recommendedAction: {
              code:
                "continue-current-objective",
            },
          },
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.repository,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.insights
              .recommendedAction,
          ),
        ).toBe(true);

        expect(
          dependencies.loadState,
        ).toHaveBeenCalledWith(
          undefined,
          {
            repositoryRoot:
              "/repository",
          },
        );

        expect(
          dependencies.loadMode,
        ).toHaveBeenCalledWith(
          undefined,
          {
            repositoryRoot:
              "/repository",
          },
        );
      },
    );

    it(
      "recommends inspecting a dirty working tree before additional implementation",
      () => {
        const dependencies =
          createDependencies({
            status:
              " M src/example.js\n?? new-file.txt",
          });

        const result =
          buildConversationState({
            repositoryRoot:
              "/repository",

            ...dependencies,
          });

        expect(
          result.repository
            .workingTreeClean,
        ).toBe(false);

        expect(
          result.repository.statusLines,
        ).toEqual([
          " M src/example.js",
          "?? new-file.txt",
        ]);

        expect(
          result.repository.modifiedFiles,
        ).toEqual([
          "src/example.js",
          "new-file.txt",
        ]);

        expect(
          result.insights.workingTree,
        ).toBe("dirty");

        expect(
          result.insights
            .recommendedAction.code,
        ).toBe(
          "inspect-working-tree",
        );
      },
    );

    it(
      "prioritizes recorded validation failures when the working tree is clean",
      () => {
        const governanceState =
          createGovernanceState({
            focusedTestsStatus:
              "failing",
          });

        const dependencies =
          createDependencies({
            governanceState,
          });

        const result =
          buildConversationState({
            ...dependencies,
          });

        expect(
          result.insights.validation,
        ).toBe("failing");

        expect(
          result.insights
            .recommendedAction.code,
        ).toBe(
          "resolve-validation-failures",
        );
      },
    );

    it(
      "recommends reviewing branch divergence when HEAD differs from origin/main",
      () => {
        const dependencies =
          createDependencies({
            head: "local123",
            originMain: "remote456",
          });

        const result =
          buildConversationState({
            ...dependencies,
          });

        expect(
          result.repository
            .headMatchesOriginMain,
        ).toBe(false);

        expect(
          result.insights
            .recommendedAction.code,
        ).toBe(
          "review-branch-divergence",
        );
      },
    );

    it(
      "recognizes governance fields requiring human review",
      () => {
        const governanceState =
          createGovernanceState({
            phaseIdentifier:
              "REVIEW_REQUIRED",

            phaseTitle:
              "REVIEW_REQUIRED",

            currentObjective:
              "REVIEW_REQUIRED",

            nextObjective:
              "REVIEW_REQUIRED",

            startingInspection:
              "REVIEW_REQUIRED",
          });

        const dependencies =
          createDependencies({
            governanceState,
          });

        const result =
          buildConversationState({
            ...dependencies,
          });

        expect(
          result.insights
            .humanReviewRequired,
        ).toBe(true);

        expect(
          result.insights
            .recommendedAction.code,
        ).toBe(
          "complete-human-review",
        );
      },
    );

    it(
      "recommends refreshing validation when validation has not been run",
      () => {
        const governanceState =
          createGovernanceState({
            focusedTestsStatus:
              "not-run",

            fullTestsStatus:
              "not-run",

            productionBuildStatus:
              "not-run",
          });

        const dependencies =
          createDependencies({
            governanceState,
          });

        const result =
          buildConversationState({
            ...dependencies,
          });

        expect(
          result.insights.validation,
        ).toBe("not-run");

        expect(
          result.insights
            .recommendedAction.code,
        ).toBe(
          "refresh-validation",
        );
      },
    );

    it(
      "rejects a clock dependency that does not return a valid Date",
      () => {
        const dependencies =
          createDependencies();

        expect(() =>
          buildConversationState({
            now: () => "not-a-date",
            ...dependencies,
          }),
        ).toThrow(
          "now must return a valid Date",
        );
      },
    );

    it(
      "reuses supplied engineering repository evidence without invoking Git",
      () => {
        const dependencies =
          createDependencies();

        const engineeringState = {
          repository: {
            branch: "engineering",
            head: "deadbeef",
            originMain: "deadbeef",
            headMatchesOriginMain: true,
            workingTreeClean: true,
            statusLines: [],
            modifiedFiles: [],
          },
        };

        const result =
          buildConversationState({
            engineeringState,
            ...dependencies,
          });

        expect(
          dependencies.runGit,
        ).not.toHaveBeenCalled();

        expect(
          result.repository.branch,
        ).toBe("engineering");

        expect(
          result.repository.head,
        ).toBe("deadbeef");
      },
    );
  },
);
