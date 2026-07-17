import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildContextCompression,
} from "../buildContextCompression.mjs";

function createRepositorySummary({
  branch = "main",
  headShort = "abc1234",
  originMainShort = "abc1234",
  headMatchesOriginMain = true,
  workingTreeClean = true,
  modifiedFiles = [],
  mode = "shadow",
  phaseIdentifier = "15.6",
  phaseTitle =
    "Conversation Intelligence",
  currentObjective =
    "Build context compression",
  nextObjective =
    "Build prompt recommendations",
  validationStatus = "passing",
  recordedStateMatchesLive = true,
  humanReviewRequired = false,
  recommendationCode =
    "continue-current-objective",
  recommendationSummary =
    "The repository is ready to continue the current recorded engineering objective.",
} = {}) {
  return {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T18:00:00.000Z",

    repository: {
      branch,

      head:
        "abc1234567890",

      headShort,

      originMain:
        "abc1234567890",

      originMainShort,

      headMatchesOriginMain,

      workingTree: {
        clean:
          workingTreeClean,

        modifiedFileCount:
          modifiedFiles.length,

        modifiedFiles,
      },
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
      nextObjective,
    },

    validation: {
      overallStatus:
        validationStatus,
    },

    freshness: {
      recordedStateMatchesLive,
    },

    review: {
      humanReviewRequired,
    },

    recommendation: {
      code:
        recommendationCode,

      summary:
        recommendationSummary,
    },
  };
}

describe(
  "buildContextCompression",
  () => {
    it(
      "builds an immutable compressed context from a healthy repository summary",
      () => {
        const result =
          buildContextCompression(
            createRepositorySummary(),
          );

        expect(result).toEqual({
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T18:00:00.000Z",

          repositoryToken:
            "main|abc1234|abc1234|aligned|clean",

          governanceToken:
            "shadow|15.6|Build context compression|Build prompt recommendations",

          repository: {
            branch: "main",
            head: "abc1234",
            originMain: "abc1234",
            aligned: true,
            workingTreeClean: true,
            modifiedFileCount: 0,
            modifiedFiles: [],
          },

          governance: {
            mode: "shadow",
            phase: "15.6",

            phaseTitle:
              "Conversation Intelligence",

            currentObjective:
              "Build context compression",

            nextObjective:
              "Build prompt recommendations",
          },

          status: {
            validation: "passing",
            governanceCurrent: true,
            humanReviewRequired: false,
          },

          recommendation: {
            code:
              "continue-current-objective",

            summary:
              "The repository is ready to continue the current recorded engineering objective.",
          },

          attention: {
            required: false,
            flags: [],
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
            result.repository.modifiedFiles,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.attention.flags,
          ),
        ).toBe(true);
      },
    );

    it(
      "compresses dirty working-tree information without mutating the input",
      () => {
        const modifiedFiles = [
          "src/example.js",
          "new-file.txt",
        ];

        const repositorySummary =
          createRepositorySummary({
            workingTreeClean:
              false,

            modifiedFiles,
          });

        const result =
          buildContextCompression(
            repositorySummary,
          );

        expect(
          result.repositoryToken,
        ).toBe(
          "main|abc1234|abc1234|aligned|dirty:2",
        );

        expect(
          result.repository,
        ).toMatchObject({
          workingTreeClean:
            false,

          modifiedFileCount:
            2,

          modifiedFiles: [
            "src/example.js",
            "new-file.txt",
          ],
        });

        expect(
          result.repository.modifiedFiles,
        ).not.toBe(
          modifiedFiles,
        );

        expect(modifiedFiles).toEqual([
          "src/example.js",
          "new-file.txt",
        ]);
      },
    );

    it(
      "adds attention flags in deterministic priority order",
      () => {
        const result =
          buildContextCompression(
            createRepositorySummary({
              headMatchesOriginMain:
                false,

              workingTreeClean:
                false,

              modifiedFiles: [
                "src/example.js",
              ],

              recordedStateMatchesLive:
                false,

              humanReviewRequired:
                true,

              validationStatus:
                "partial",
            }),
          );

        expect(
          result.attention,
        ).toEqual({
          required: true,

          flags: [
            "branch-divergence",
            "dirty-working-tree",
            "stale-governance-state",
            "human-review-required",
            "validation-not-passing",
          ],
        });
      },
    );

    it(
      "preserves governance and recommendation values",
      () => {
        const result =
          buildContextCompression(
            createRepositorySummary({
              mode:
                "authoritative",

              phaseIdentifier:
                "15.7",

              phaseTitle:
                "Prompt Preparation",

              currentObjective:
                "Build prompt recommendations",

              nextObjective:
                "Build conversation preparation orchestrator",

              recommendationCode:
                "complete-human-review",

              recommendationSummary:
                "Complete the remaining human-reviewed fields before continuing.",
            }),
          );

        expect(
          result.governanceToken,
        ).toBe(
          "authoritative|15.7|Build prompt recommendations|Build conversation preparation orchestrator",
        );

        expect(
          result.governance,
        ).toEqual({
          mode:
            "authoritative",

          phase:
            "15.7",

          phaseTitle:
            "Prompt Preparation",

          currentObjective:
            "Build prompt recommendations",

          nextObjective:
            "Build conversation preparation orchestrator",
        });

        expect(
          result.recommendation,
        ).toEqual({
          code:
            "complete-human-review",

          summary:
            "Complete the remaining human-reviewed fields before continuing.",
        });
      },
    );

    it(
      "rejects a non-object repository summary",
      () => {
        expect(() =>
          buildContextCompression(
            null,
          ),
        ).toThrow(
          "repositorySummary must be an object",
        );
      },
    );

    it(
      "rejects a modified-file count that does not match the file list",
      () => {
        const repositorySummary =
          createRepositorySummary({
            modifiedFiles: [
              "src/example.js",
            ],
          });

        repositorySummary.repository
          .workingTree
          .modifiedFileCount = 2;

        expect(() =>
          buildContextCompression(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.repository.workingTree.modifiedFileCount must match modifiedFiles length",
        );
      },
    );

    it(
      "rejects invalid recommendation content",
      () => {
        const repositorySummary =
          createRepositorySummary();

        repositorySummary.recommendation
          .summary = "";

        expect(() =>
          buildContextCompression(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.recommendation.summary must be a non-empty string",
        );
      },
    );
  },
);
