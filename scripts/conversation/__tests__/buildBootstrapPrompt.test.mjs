import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildBootstrapPrompt,
} from "../buildBootstrapPrompt.mjs";

function createRepositorySummary({
  branch = "main",
  head =
    "abc1234567890",
  headShort =
    "abc1234",
  originMain =
    "abc1234567890",
  originMainShort =
    "abc1234",
  headMatchesOriginMain = true,
  workingTreeClean = true,
  modifiedFiles = [],
  mode = "shadow",
  phaseIdentifier = "15.6",
  phaseTitle =
    "Conversation Intelligence",
  currentObjective =
    "Build bootstrap prompt",
  nextObjective =
    "Build context compression",
  validationStatus =
    "passing",
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
      "2026-07-17T17:00:00.000Z",

    repository: {
      branch,
      head,
      headShort,
      originMain,
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
  "buildBootstrapPrompt",
  () => {
    it(
      "builds a deterministic bootstrap prompt from a clean repository summary",
      () => {
        const result =
          buildBootstrapPrompt(
            createRepositorySummary(),
          );

        expect(result).toBe(
          [
            "FORGE BOOTSTRAP",
            "",
            "Repository",
            "~/USMarketplace/marketplace409",
            "",
            "Branch",
            "main",
            "",
            "Repository State",
            "HEAD: abc1234",
            "origin/main: abc1234",
            "Remote alignment: aligned",
            "Working tree: clean",
            "",
            "Modified Files",
            "None",
            "",
            "Governance",
            "Mode: shadow",
            "Active phase: 15.6 — Conversation Intelligence",
            "Current objective: Build bootstrap prompt",
            "Next objective: Build context compression",
            "",
            "Validation",
            "Overall status: passing",
            "",
            "Governance Freshness",
            "Recorded state matches live repository: yes",
            "",
            "Human Review",
            "Required: no",
            "",

            "Governance Evolution Readiness",
            "Status: review-required",

            "Recommended Action",
            "Code: continue-current-objective",
            "The repository is ready to continue the current recorded engineering objective.",
            "",
            "Generated at: 2026-07-17T17:00:00.000Z",
          ].join("\n"),
        );
      },
    );

    it(
      "lists dirty working-tree files in their supplied order",
      () => {
        const result =
          buildBootstrapPrompt(
            createRepositorySummary({
              workingTreeClean:
                false,

              modifiedFiles: [
                "src/example.js",
                "new-file.txt",
              ],

              recommendationCode:
                "inspect-working-tree",

              recommendationSummary:
                "Inspect and classify modified and untracked files before beginning additional implementation.",
            }),
          );

        expect(result).toContain(
          "Working tree: dirty (2 modified or untracked files)",
        );

        expect(result).toContain(
          [
            "Modified Files",
            "- src/example.js",
            "- new-file.txt",
          ].join("\n"),
        );

        expect(result).toContain(
          "Code: inspect-working-tree",
        );
      },
    );

    it(
      "reports branch divergence, stale governance, and required review",
      () => {
        const result =
          buildBootstrapPrompt(
            createRepositorySummary({
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

              recordedStateMatchesLive:
                false,

              humanReviewRequired:
                true,
            }),
          );

        expect(result).toContain(
          "Branch\nfeature/conversation",
        );

        expect(result).toContain(
          "Remote alignment: diverged",
        );

        expect(result).toContain(
          "Recorded state matches live repository: no",
        );

        expect(result).toContain(
          "Required: yes",
        );
      },
    );

    it(
      "preserves governance and validation content without inventing values",
      () => {
        const result =
          buildBootstrapPrompt(
            createRepositorySummary({
              mode:
                "authoritative",

              phaseIdentifier:
                "15.7",

              phaseTitle:
                "Prompt Preparation",

              currentObjective:
                "Build context compression",

              nextObjective:
                "Build prompt recommendations",

              validationStatus:
                "partial",
            }),
          );

        expect(result).toContain(
          "Mode: authoritative",
        );

        expect(result).toContain(
          "Active phase: 15.7 — Prompt Preparation",
        );

        expect(result).toContain(
          "Current objective: Build context compression",
        );

        expect(result).toContain(
          "Next objective: Build prompt recommendations",
        );

        expect(result).toContain(
          "Overall status: partial",
        );
      },
    );

    it(
      "rejects a non-object repository summary",
      () => {
        expect(() =>
          buildBootstrapPrompt(
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
          buildBootstrapPrompt(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.repository.workingTree.modifiedFileCount must match modifiedFiles length",
        );
      },
    );

    it(
      "rejects invalid modified-file entries",
      () => {
        const repositorySummary =
          createRepositorySummary({
            modifiedFiles: [
              "src/example.js",
            ],
          });

        repositorySummary.repository
          .workingTree
          .modifiedFiles = [
            "src/example.js",
            "",
          ];

        repositorySummary.repository
          .workingTree
          .modifiedFileCount = 2;

        expect(() =>
          buildBootstrapPrompt(
            repositorySummary,
          ),
        ).toThrow(
          "repositorySummary.repository.workingTree.modifiedFiles[1] must be a non-empty string",
        );
      },
    );
  },
);
