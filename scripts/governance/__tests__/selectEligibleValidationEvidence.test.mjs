import {
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

const currentFilePath =
  fileURLToPath(
    import.meta.url,
  );

const sourceRepositoryRoot =
  path.resolve(
    path.dirname(
      currentFilePath,
    ),
    "../../..",
  );

const selectorRelativePath =
  "scripts/governance/selectEligibleValidationEvidence.mjs";

const fixturePaths = [
  ".gitignore",
  selectorRelativePath,
  "scripts/governance/validateValidationEvidence.mjs",
];

const temporaryRepositories =
  new Set();

function runProcess(
  command,
  args,
  {
    cwd,
    allowFailure = false,
  } = {},
) {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  if (
    !allowFailure &&
    (
      result.error ||
      result.status !== 0
    )
  ) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    ...result,
    combinedOutput: [
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function copyFixturePath(
  repositoryRoot,
  relativePath,
) {
  const destinationPath =
    path.join(
      repositoryRoot,
      relativePath,
    );

  fs.mkdirSync(
    path.dirname(
      destinationPath,
    ),
    {
      recursive: true,
    },
  );

  fs.copyFileSync(
    path.join(
      sourceRepositoryRoot,
      relativePath,
    ),
    destinationPath,
  );
}

function initializeRepository(
  repositoryRoot,
) {
  runProcess(
    "git",
    [
      "init",
      "-b",
      "main",
    ],
    {
      cwd: repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.name",
      "FORGE Eligibility Test",
    ],
    {
      cwd: repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.email",
      "forge-eligibility@example.invalid",
    ],
    {
      cwd: repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "add",
      ".",
    ],
    {
      cwd: repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "commit",
      "-m",
      "Create eligibility fixture",
    ],
    {
      cwd: repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    ],
    {
      cwd: repositoryRoot,
    },
  );
}

function createFixture() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-validation-selector-",
      ),
    );

  temporaryRepositories.add(
    repositoryRoot,
  );

  for (
    const relativePath
    of fixturePaths
  ) {
    copyFixturePath(
      repositoryRoot,
      relativePath,
    );
  }

  initializeRepository(
    repositoryRoot,
  );

  return repositoryRoot;
}

function currentCommit(
  repositoryRoot,
) {
  return runProcess(
    "git",
    [
      "rev-parse",
      "HEAD",
    ],
    {
      cwd: repositoryRoot,
    },
  ).stdout.trim();
}

function repositoryState({
  head,
  originMain = head,
  branch = "main",
  gitStatus = [],
} = {}) {
  return {
    branch,
    head,
    originMain,
    headMatchesOriginMain:
      head === originMain,
    workingTreeClean:
      gitStatus.length === 0,
    gitStatus,
  };
}

function createArtifact({
  validationId,
  head,
  completedAt,
  repositoryBefore,
  repositoryAfter,
} = {}) {
  const before =
    repositoryBefore ??
    repositoryState({
      head,
    });

  const after =
    repositoryAfter ??
    repositoryState({
      head,
    });

  return {
    schemaVersion: "1.0",
    validationId,
    capturedAt:
      "2026-07-13T02:00:03.000Z",
    startedAt:
      "2026-07-13T02:00:00.000Z",
    completedAt,

    repository: {
      before,
      after,
    },

    commands: [
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
          "2026-07-13T02:00:00.000Z",
        completedAt:
          "2026-07-13T02:00:01.000Z",
        exitCode:
          0,
        status:
          "passing",
        summary:
          "Full tests passed.",
      },
    ],

    results: {
      focusedTests: {
        status:
          "not-run",
        commandIndexes: [],
        summary:
          null,
      },

      fullTests: {
        status:
          "passing",
        commandIndexes: [
          0,
        ],
        summary:
          "Full tests passed.",
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

function writeArtifact(
  repositoryRoot,
  artifact,
) {
  const validationDirectory =
    path.join(
      repositoryRoot,
      "governance",
      "validation",
    );

  fs.mkdirSync(
    validationDirectory,
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.join(
      validationDirectory,
      `${artifact.validationId}.json`,
    ),
    `${JSON.stringify(
      artifact,
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function importSelector(
  repositoryRoot,
) {
  const copiedSelector =
    path.join(
      repositoryRoot,
      selectorRelativePath,
    );

  const selectorUrl =
    pathToFileURL(
      copiedSelector,
    );

  selectorUrl.searchParams.set(
    "test",
    `${Date.now()}-${Math.random()}`,
  );

  return import(
    selectorUrl.href,
  );
}

afterEach(() => {
  for (
    const repositoryRoot
    of temporaryRepositories
  ) {
    fs.rmSync(
      repositoryRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryRepositories.clear();
});

describe(
  "selectEligibleValidationEvidence",
  () => {
    test(
      "selects the newest valid artifact bound to the current clean synchronized commit",
      async () => {
        const repositoryRoot =
          createFixture();

        const head =
          currentCommit(
            repositoryRoot,
          );

        writeArtifact(
          repositoryRoot,
          createArtifact({
            validationId:
              "forge-validation-20260713-020000",
            head,
            completedAt:
              "2026-07-13T02:00:01.000Z",
          }),
        );

        writeArtifact(
          repositoryRoot,
          createArtifact({
            validationId:
              "forge-validation-20260713-020100",
            head,
            completedAt:
              "2026-07-13T02:00:02.000Z",
          }),
        );

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected
            ?.artifact
            .validationId,
        ).toBe(
          "forge-validation-20260713-020100",
        );
      },
    );

    test(
      "rejects evidence bound to another commit",
      async () => {
        const repositoryRoot =
          createFixture();

        writeArtifact(
          repositoryRoot,
          createArtifact({
            validationId:
              "forge-validation-20260713-020000",
            head:
              "1234567890abcdef1234567890abcdef12345678",
            completedAt:
              "2026-07-13T02:00:01.000Z",
          }),
        );

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected,
        ).toBeNull();

        expect(
          result.inspectedArtifacts[0]
            .reasons,
        ).toContain(
          "artifact-head-mismatch",
        );
      },
    );

    test(
      "rejects dirty-tree validation evidence",
      async () => {
        const repositoryRoot =
          createFixture();

        const head =
          currentCommit(
            repositoryRoot,
          );

        const dirtyState =
          repositoryState({
            head,
            gitStatus: [
              " M src/example.js",
            ],
          });

        writeArtifact(
          repositoryRoot,
          createArtifact({
            validationId:
              "forge-validation-20260713-020000",
            head,
            completedAt:
              "2026-07-13T02:00:01.000Z",
            repositoryBefore:
              dirtyState,
            repositoryAfter: {
              ...dirtyState,
              gitStatus: [
                ...dirtyState.gitStatus,
              ],
            },
          }),
        );

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected,
        ).toBeNull();

        expect(
          result.inspectedArtifacts[0]
            .reasons,
        ).toContain(
          "artifact-working-tree-not-clean",
        );
      },
    );

    test(
      "returns no selection when the current working tree is dirty",
      async () => {
        const repositoryRoot =
          createFixture();

        const head =
          currentCommit(
            repositoryRoot,
          );

        writeArtifact(
          repositoryRoot,
          createArtifact({
            validationId:
              "forge-validation-20260713-020000",
            head,
            completedAt:
              "2026-07-13T02:00:01.000Z",
          }),
        );

        fs.writeFileSync(
          path.join(
            repositoryRoot,
            "dirty.txt",
          ),
          "dirty\n",
          "utf8",
        );

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected,
        ).toBeNull();

        expect(
          result.inspectedArtifacts[0]
            .reasons,
        ).toContain(
          "current-working-tree-dirty",
        );
      },
    );

    test(
      "ignores malformed validation artifacts",
      async () => {
        const repositoryRoot =
          createFixture();

        const validationDirectory =
          path.join(
            repositoryRoot,
            "governance",
            "validation",
          );

        fs.mkdirSync(
          validationDirectory,
          {
            recursive: true,
          },
        );

        fs.writeFileSync(
          path.join(
            validationDirectory,
            "malformed.json",
          ),
          "{ invalid-json",
          "utf8",
        );

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected,
        ).toBeNull();

        expect(
          result.inspectedArtifacts[0]
            .reasons,
        ).toEqual([
          "artifact-invalid",
        ]);
      },
    );

    test(
      "returns no selection when the validation directory is absent",
      async () => {
        const repositoryRoot =
          createFixture();

        const {
          selectEligibleValidationEvidence,
        } =
          await importSelector(
            repositoryRoot,
          );

        const result =
          selectEligibleValidationEvidence({
            repositoryRoot,
          });

        expect(
          result.selected,
        ).toBeNull();

        expect(
          result.inspectedArtifacts,
        ).toEqual([]);
      },
    );
  },
);
