import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  buildSessionValidationEvidence,
} from "../buildSessionValidationEvidence.mjs";

const commitHash =
  "1234567890abcdef1234567890abcdef12345678";

function createArtifact() {
  return {
    schemaVersion:
      "1.0",

    validationId:
      "forge-validation-20260713-020000",

    capturedAt:
      "2026-07-13T02:00:04.000Z",

    startedAt:
      "2026-07-13T02:00:00.000Z",

    completedAt:
      "2026-07-13T02:00:03.000Z",

    repository: {
      before: {
        branch:
          "main",
        head:
          commitHash,
        originMain:
          commitHash,
        headMatchesOriginMain:
          true,
        workingTreeClean:
          true,
        gitStatus: [],
      },

      after: {
        branch:
          "main",
        head:
          commitHash,
        originMain:
          commitHash,
        headMatchesOriginMain:
          true,
        workingTreeClean:
          true,
        gitStatus: [],
      },
    },

    commands: [
      {
        category:
          "focusedTests",
        command:
          "npx",
        args: [
          "vitest",
          "run",
          "scripts/governance/__tests__/example.test.mjs",
        ],
        workingDirectory:
          ".",
        startedAt:
          "2026-07-13T02:00:00.000Z",
        completedAt:
          "2026-07-13T02:00:01.000Z",
        exitCode:
          0,
        status:
          "passing",
        summary:
          "Focused tests passed.",
      },

      {
        category:
          "fullTests",
        command:
          "npx",
        args: [
          "vitest",
          "run",
        ],
        workingDirectory:
          ".",
        startedAt:
          "2026-07-13T02:00:01.000Z",
        completedAt:
          "2026-07-13T02:00:02.000Z",
        exitCode:
          1,
        status:
          "failing",
        summary:
          "Full tests failed.",
      },
    ],

    results: {
      focusedTests: {
        status:
          "passing",
        commandIndexes: [
          0,
        ],
        summary:
          "Focused tests passed.",
      },

      fullTests: {
        status:
          "failing",
        commandIndexes: [
          1,
        ],
        summary:
          "Full tests failed.",
      },

      productionBuild: {
        status:
          "not-run",
        commandIndexes: [],
        summary:
          null,
      },
    },
  };
}

function createSelection(
  artifact =
    createArtifact(),
) {
  return {
    currentRepository: {
      branch:
        "main",
      head:
        commitHash,
      originMain:
        commitHash,
      headMatchesOriginMain:
        true,
      workingTreeClean:
        true,
      gitStatus: [],
    },

    selected: {
      path:
        "governance/validation/forge-validation-20260713-020000.json",
      artifact,
    },

    inspectedArtifacts: [],
  };
}

describe(
  "buildSessionValidationEvidence",
  () => {
    test(
      "returns not-run validation when no eligible artifact exists",
      () => {
        const selectEvidence =
          vi.fn(() => ({
            currentRepository: {
              branch:
                "main",
            },
            selected:
              null,
            inspectedArtifacts: [],
          }));

        const result =
          buildSessionValidationEvidence({
            repositoryRoot:
              "/repository",
            selectEvidence,
          });

        expect(
          selectEvidence,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            "/repository",
        });

        expect(
          result,
        ).toEqual({
          validation: {
            focusedTests: {
              status:
                "not-run",
              command:
                null,
              summary:
                null,
            },

            fullTests: {
              status:
                "not-run",
              command:
                null,
              summary:
                null,
            },

            productionBuild: {
              status:
                "not-run",
              command:
                null,
              summary:
                null,
            },
          },

          selectedArtifact:
            null,
        });
      },
    );

    test(
      "normalizes eligible artifact results into the session snapshot shape",
      () => {
        const result =
          buildSessionValidationEvidence({
            repositoryRoot:
              "/repository",

            selectEvidence:
              () =>
                createSelection(),
          });

        expect(
          result.validation,
        ).toEqual({
          focusedTests: {
            status:
              "passing",

            command:
              "npx vitest run scripts/governance/__tests__/example.test.mjs",

            summary:
              "Focused tests passed.",
          },

          fullTests: {
            status:
              "failing",

            command:
              "npx vitest run",

            summary:
              "Full tests failed.",
          },

          productionBuild: {
            status:
              "not-run",

            command:
              null,

            summary:
              null,
          },
        });
      },
    );

    test(
      "records the selected artifact identity for auditability",
      () => {
        const result =
          buildSessionValidationEvidence({
            selectEvidence:
              () =>
                createSelection(),
          });

        expect(
          result.selectedArtifact,
        ).toEqual({
          path:
            "governance/validation/forge-validation-20260713-020000.json",

          validationId:
            "forge-validation-20260713-020000",

          completedAt:
            "2026-07-13T02:00:03.000Z",

          repositoryHead:
            commitHash,
        });
      },
    );

    test(
      "joins multiple approved commands for the same validation category",
      () => {
        const artifact =
          createArtifact();

        artifact.commands.push({
          category:
            "focusedTests",
          command:
            "npx",
          args: [
            "vitest",
            "run",
            "scripts/governance/__tests__/second.test.mjs",
          ],
          workingDirectory:
            ".",
          startedAt:
            "2026-07-13T02:00:00.500Z",
          completedAt:
            "2026-07-13T02:00:01.500Z",
          exitCode:
            0,
          status:
            "passing",
          summary:
            "Second focused test passed.",
        });

        artifact.results.focusedTests
          .commandIndexes = [
            0,
            2,
          ];

        const result =
          buildSessionValidationEvidence({
            selectEvidence:
              () =>
                createSelection(
                  artifact,
                ),
          });

        expect(
          result.validation
            .focusedTests
            .command,
        ).toBe(
          "npx vitest run scripts/governance/__tests__/example.test.mjs && " +
          "npx vitest run scripts/governance/__tests__/second.test.mjs",
        );
      },
    );

    test(
      "rejects command references assigned to the wrong category",
      () => {
        const artifact =
          createArtifact();

        artifact.results
          .focusedTests
          .commandIndexes = [
            1,
          ];

        expect(() =>
          buildSessionValidationEvidence({
            selectEvidence:
              () =>
                createSelection(
                  artifact,
                ),
          }),
        ).toThrow(
          "artifact.commands[1].category does not match focusedTests",
        );
      },
    );

    test(
      "rejects invalid command indexes",
      () => {
        const artifact =
          createArtifact();

        artifact.results
          .focusedTests
          .commandIndexes = [
            99,
          ];

        expect(() =>
          buildSessionValidationEvidence({
            selectEvidence:
              () =>
                createSelection(
                  artifact,
                ),
          }),
        ).toThrow(
          "artifact.results.focusedTests.commandIndexes[0] is invalid",
        );
      },
    );

    test(
      "requires a selector function",
      () => {
        expect(() =>
          buildSessionValidationEvidence({
            selectEvidence:
              null,
          }),
        ).toThrow(
          "selectEvidence must be a function",
        );
      },
    );
  },
);
