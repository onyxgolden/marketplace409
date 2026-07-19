import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildRepositorySummary,
} from "../buildRepositorySummary.mjs";

function createConversationState({
  branch = "main",
  head =
    "abc1234567890",
  originMain =
    "abc1234567890",
  workingTreeClean = true,
  headMatchesOriginMain = true,
  modifiedFiles = [],
  mode = "shadow",
  phaseIdentifier = "15.6",
  phaseTitle =
    "Conversation Intelligence",
  currentObjective =
    "Build conversation state",
  nextObjective =
    "Build repository summary",
  validation = "passing",
  humanReviewRequired = false,
  governanceStateCurrent = true,
  recommendationCode =
    "continue-current-objective",
  recommendationSummary =
    "The repository is ready to continue the current recorded engineering objective.",
} = {}) {
  return {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T17:00:00.000Z",

    repository: {
      branch,
      head,
      originMain,
      workingTreeClean,
      headMatchesOriginMain,
      statusLines: [],
      modifiedFiles,
    },

    governance: {
      mode,

      activePhase: {
        identifier:
          phaseIdentifier,

        title:
          phaseTitle,
      },

      currentObjective,

      nextSession: {
        objective:
          nextObjective,

        startingInspection:
          "Inspect conversation scripts",
      },
    },

    evolutionReadiness: {
      status: "review-required",
      eligible: false,
      requiresHumanApproval: true,
      reasons: [],
    },

    insights: {
      workingTree:
        workingTreeClean
          ? "clean"
          : "dirty",

      validation,

      humanReviewRequired,
      governanceStateCurrent,

      recommendedAction: {
        code:
          recommendationCode,

        summary:
          recommendationSummary,
      },
    },
  };
}

describe(
  "buildRepositorySummary",
  () => {
    it(
      "builds an immutable repository summary from conversation state",
      () => {
        const conversationState =
          createConversationState();

        const result =
          buildRepositorySummary(
            conversationState,
          );

        expect(result).toEqual({
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T17:00:00.000Z",

          repository: {
            branch: "main",

            head:
              "abc1234567890",

            headShort:
              "abc1234",

            originMain:
              "abc1234567890",

            originMainShort:
              "abc1234",

            headMatchesOriginMain:
              true,

            workingTree: {
              clean: true,
              modifiedFileCount: 0,
              modifiedFiles: [],
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

            nextObjective:
              "Build repository summary",
          },

          validation: {
            overallStatus:
              "passing",
          },

          freshness: {
            recordedStateMatchesLive:
              true,
          },

          review: {
            humanReviewRequired:
              false,
          },

          evolutionReadiness: {
            status: "review-required",
            eligible: false,
            requiresHumanApproval: true,
            reasons: [],
          },

          recommendation: {
            code:
              "continue-current-objective",

            summary:
              "The repository is ready to continue the current recorded engineering objective.",
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
            result.repository
              .workingTree,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.repository
              .workingTree
              .modifiedFiles,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.recommendation,
          ),
        ).toBe(true);
      },
    );

    it(
      "summarizes dirty working-tree files without mutating the input",
      () => {
        const modifiedFiles = [
          "src/example.js",
          "new-file.txt",
        ];

        const conversationState =
          createConversationState({
            workingTreeClean: false,

            modifiedFiles,

            recommendationCode:
              "inspect-working-tree",

            recommendationSummary:
              "Inspect and classify modified and untracked files before beginning additional implementation.",
          });

        const result =
          buildRepositorySummary(
            conversationState,
          );

        expect(
          result.repository
            .workingTree,
        ).toEqual({
          clean: false,
          modifiedFileCount: 2,

          modifiedFiles: [
            "src/example.js",
            "new-file.txt",
          ],
        });

        expect(
          result.repository
            .workingTree
            .modifiedFiles,
        ).not.toBe(
          modifiedFiles,
        );

        expect(
          modifiedFiles,
        ).toEqual([
          "src/example.js",
          "new-file.txt",
        ]);
      },
    );

    it(
      "preserves branch and remote divergence information",
      () => {
        const result =
          buildRepositorySummary(
            createConversationState({
              branch:
                "feature/conversation",

              head:
                "local123456789",

              originMain:
                "remote987654321",

              headMatchesOriginMain:
                false,

              recommendationCode:
                "review-branch-divergence",

              recommendationSummary:
                "Review the difference between HEAD and origin/main before continuing.",
            }),
          );

        expect(
          result.repository,
        ).toMatchObject({
          branch:
            "feature/conversation",

          head:
            "local123456789",

          headShort:
            "local12",

          originMain:
            "remote987654321",

          originMainShort:
            "remote9",

          headMatchesOriginMain:
            false,
        });
      },
    );

    it(
      "preserves governance mode, active phase, and objectives",
      () => {
        const result =
          buildRepositorySummary(
            createConversationState({
              mode:
                "authoritative",

              phaseIdentifier:
                "15.7",

              phaseTitle:
                "Prompt Preparation",

              currentObjective:
                "Build bootstrap prompt",

              nextObjective:
                "Build context compression",
            }),
          );

        expect(
          result.governance,
        ).toEqual({
          mode:
            "authoritative",

          activePhase: {
            identifier:
              "15.7",

            title:
              "Prompt Preparation",
          },

          currentObjective:
            "Build bootstrap prompt",

          nextObjective:
            "Build context compression",
        });
      },
    );

    it(
      "preserves validation, review, freshness, and recommendation insights",
      () => {
        const result =
          buildRepositorySummary(
            createConversationState({
              validation:
                "partial",

              humanReviewRequired:
                true,

              governanceStateCurrent:
                false,

              recommendationCode:
                "complete-human-review",

              recommendationSummary:
                "Complete the human-reviewed phase, objective, and next-session fields.",
            }),
          );

        expect(result).toMatchObject({
          validation: {
            overallStatus:
              "partial",
          },

          freshness: {
            recordedStateMatchesLive:
              false,
          },

          review: {
            humanReviewRequired:
              true,
          },

          recommendation: {
            code:
              "complete-human-review",

            summary:
              "Complete the human-reviewed phase, objective, and next-session fields.",
          },
        });
      },
    );

    it(
      "rejects a non-object conversation state",
      () => {
        expect(() =>
          buildRepositorySummary(
            null,
          ),
        ).toThrow(
          "conversationState must be an object",
        );
      },
    );

    it(
      "rejects invalid modified-file entries",
      () => {
        const conversationState =
          createConversationState({
            modifiedFiles: [
              "src/example.js",
              "",
            ],
          });

        expect(() =>
          buildRepositorySummary(
            conversationState,
          ),
        ).toThrow(
          "conversationState.repository.modifiedFiles[1] must be a non-empty string",
        );
      },
    );
  },
);
