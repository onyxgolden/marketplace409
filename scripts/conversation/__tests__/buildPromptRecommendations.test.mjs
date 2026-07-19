import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildPromptRecommendations,
} from "../buildPromptRecommendations.mjs";

function createRepositorySummary({
  branch = "main",
  headMatchesOriginMain = true,
  workingTreeClean = true,
  modifiedFiles = [],
  mode = "shadow",
  phaseIdentifier = "15.6",
  phaseTitle =
    "Conversation Intelligence",
  currentObjective =
    "Build prompt recommendations",
  nextObjective =
    "Build conversation preparation orchestrator",
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

      headShort:
        "abc1234",

      originMain:
        "abc1234567890",

      originMainShort:
        "abc1234",

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

    evolutionReadiness: {
      status: "review-required",
      eligible: false,
      requiresHumanApproval: true,
      reasons: [],
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
  "buildPromptRecommendations",
  () => {
    it(
      "builds immutable recommendations for a healthy repository summary",
      () => {
        const result =
          buildPromptRecommendations(
            createRepositorySummary(),
          );

        expect(result).toEqual({
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T18:00:00.000Z",

          readiness: {
            readyToContinue: true,
            warningCount: 0,
          },

          evolutionReadiness: {
            status: "review-required",
            eligible: false,
            requiresHumanApproval: true,
            reasons: [],
          },

          authoritativeRecommendation: {
            code:
              "continue-current-objective",

            summary:
              "The repository is ready to continue the current recorded engineering objective.",
          },

          warnings: [],

          inspectionCommands: [
            "cd ~/USMarketplace/marketplace409 && git status --short",
          ],

          validationCommands: [
            "cd ~/USMarketplace/marketplace409 && npx vitest run scripts/conversation/__tests__",
            "cd ~/USMarketplace/marketplace409 && git diff --check -- scripts/conversation",
          ],

          nextImplementation: {
            objective:
              "Build conversation preparation orchestrator",

            rationale:
              "Continue from Phase 15.6 — Conversation Intelligence using the recorded next objective.",

            constraints: [
              "Inspect current files before editing.",
              "Preserve unrelated repository changes.",
              "Prefer pure deterministic builders.",
              "Do not add filesystem writes unless the orchestration layer explicitly requires them.",
              "Run focused tests before the full conversation subsystem suite.",
            ],
          },
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.warnings,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.inspectionCommands,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nextImplementation,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nextImplementation
              .constraints,
          ),
        ).toBe(true);
      },
    );

    it(
      "builds deterministic warnings in priority order",
      () => {
        const result =
          buildPromptRecommendations(
            createRepositorySummary({
              headMatchesOriginMain:
                false,

              workingTreeClean:
                false,

              modifiedFiles: [
                "src/example.js",
                "new-file.txt",
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
          result.readiness,
        ).toEqual({
          readyToContinue: false,
          warningCount: 5,
        });

        expect(
          result.warnings.map(
            ({ code }) => code,
          ),
        ).toEqual([
          "branch-divergence",
          "dirty-working-tree",
          "stale-governance-state",
          "human-review-required",
          "validation-not-passing",
        ]);

        expect(
          result.warnings[1].message,
        ).toContain(
          "2 modified or untracked files",
        );

        expect(
          result.warnings[4].message,
        ).toContain(
          "partial",
        );
      },
    );

    it(
      "adds branch and working-tree inspection commands only when required",
      () => {
        const result =
          buildPromptRecommendations(
            createRepositorySummary({
              headMatchesOriginMain:
                false,

              workingTreeClean:
                false,

              modifiedFiles: [
                "src/example.js",
              ],
            }),
          );

        expect(
          result.inspectionCommands,
        ).toEqual([
          "cd ~/USMarketplace/marketplace409 && git status --short",
          "cd ~/USMarketplace/marketplace409 && git log --oneline --decorate --graph --max-count=20 --all",
          "cd ~/USMarketplace/marketplace409 && git diff --stat && git diff --name-only",
        ]);
      },
    );

    it(
      "preserves authoritative recommendation and next objective",
      () => {
        const result =
          buildPromptRecommendations(
            createRepositorySummary({
              mode:
                "authoritative",

              phaseIdentifier:
                "15.7",

              phaseTitle:
                "Prompt Preparation",

              nextObjective:
                "Build conversation preparation orchestrator",

              recommendationCode:
                "complete-human-review",

              recommendationSummary:
                "Complete the remaining human-reviewed fields before continuing.",
            }),
          );

        expect(
          result.authoritativeRecommendation,
        ).toEqual({
          code:
            "complete-human-review",

          summary:
            "Complete the remaining human-reviewed fields before continuing.",
        });

        expect(
          result.nextImplementation,
        ).toMatchObject({
          objective:
            "Build conversation preparation orchestrator",

          rationale:
            "Continue from Phase 15.7 — Prompt Preparation using the recorded next objective.",
        });
      },
    );

    it(
      "rejects a non-object repository summary",
      () => {
        expect(() =>
          buildPromptRecommendations(
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
          buildPromptRecommendations(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.repository.workingTree.modifiedFileCount must match modifiedFiles length",
        );
      },
    );

    it(
      "rejects invalid governance objectives",
      () => {
        const repositorySummary =
          createRepositorySummary();

        repositorySummary.governance
          .nextObjective = "";

        expect(() =>
          buildPromptRecommendations(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.governance.nextObjective must be a non-empty string",
        );
      },
    );
  },
);
