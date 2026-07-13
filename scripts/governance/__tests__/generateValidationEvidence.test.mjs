import {
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const copiedPaths = [
  "scripts/governance/generateValidationEvidence.mjs",
  "scripts/governance/validateValidationEvidence.mjs",
  "scripts/governance/writeValidatedArtifact.mjs",
  "governance/schema/validation-evidence.schema.json",
];

const temporaryRepositories =
  new Set();

function runProcess(
  command,
  args,
  {
    cwd,
    env,
    allowFailure = false,
  } = {},
) {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd,
        env,
        encoding:
          "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
        maxBuffer:
          20 * 1024 * 1024,
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
    combinedOutput:
      [
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
  const sourcePath =
    path.join(
      sourceRepositoryRoot,
      relativePath,
    );

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
    sourcePath,
    destinationPath,
  );
}

function writeExecutable(
  filePath,
  content,
) {
  fs.writeFileSync(
    filePath,
    content,
    "utf8",
  );

  fs.chmodSync(
    filePath,
    0o755,
  );
}

function initializeGitRepository(
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
      cwd:
        repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.name",
      "FORGE Validation Test",
    ],
    {
      cwd:
        repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.email",
      "forge-validation@example.invalid",
    ],
    {
      cwd:
        repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "add",
      ".",
    ],
    {
      cwd:
        repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "commit",
      "-m",
      "Create validation fixture",
    ],
    {
      cwd:
        repositoryRoot,
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
      cwd:
        repositoryRoot,
    },
  );
}

function createFixture({
  npxExitCode = 0,
  npmExitCode = 0,
  mutateDuringNpx = false,
} = {}) {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-validation-generator-",
      ),
    );

  temporaryRepositories.add(
    repositoryRoot,
  );

  for (
    const relativePath
    of copiedPaths
  ) {
    copyFixturePath(
      repositoryRoot,
      relativePath,
    );
  }

  const focusedTestPath =
    "scripts/governance/__tests__/fixture.test.mjs";

  const focusedTestAbsolutePath =
    path.join(
      repositoryRoot,
      focusedTestPath,
    );

  fs.mkdirSync(
    path.dirname(
      focusedTestAbsolutePath,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    focusedTestAbsolutePath,
    "export const fixture = true;\n",
    "utf8",
  );

  const binaryDirectory =
    path.join(
      repositoryRoot,
      "fixture-bin",
    );

  fs.mkdirSync(
    binaryDirectory,
    {
      recursive: true,
    },
  );

  writeExecutable(
    path.join(
      binaryDirectory,
      "npx",
    ),
    [
      "#!/bin/sh",
      'printf "\\033[32mFAKE NPX: %s\\033[0m   \\n" "$*"',
      mutateDuringNpx
        ? 'echo "mutation" > generated-by-validation.txt'
        : "",
      `exit ${npxExitCode}`,
      "",
    ].join("\n"),
  );

  writeExecutable(
    path.join(
      binaryDirectory,
      "npm",
    ),
    [
      "#!/bin/sh",
      'printf "\\033[32mFAKE NPM: %s\\033[0m   \\n" "$*"',
      `exit ${npmExitCode}`,
      "",
    ].join("\n"),
  );

  initializeGitRepository(
    repositoryRoot,
  );

  return {
    repositoryRoot,
    focusedTestPath,
    env: {
      ...process.env,
      PATH:
        `${binaryDirectory}${path.delimiter}${process.env.PATH}`,
    },
  };
}

function runGenerator(
  fixture,
  args,
) {
  return runProcess(
    process.execPath,
    [
      path.join(
        fixture.repositoryRoot,
        "scripts/governance/generateValidationEvidence.mjs",
      ),
      ...args,
    ],
    {
      cwd:
        fixture.repositoryRoot,
      env:
        fixture.env,
      allowFailure:
        true,
    },
  );
}

function listValidationArtifacts(
  repositoryRoot,
) {
  const validationDirectory =
    path.join(
      repositoryRoot,
      "governance",
      "validation",
    );

  if (
    !fs.existsSync(
      validationDirectory,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      validationDirectory,
    )
    .filter(
      (name) =>
        name.endsWith(
          ".json",
        ),
    )
    .sort();
}

function readOnlyArtifact(
  repositoryRoot,
) {
  const artifacts =
    listValidationArtifacts(
      repositoryRoot,
    );

  expect(
    artifacts,
  ).toHaveLength(1);

  return JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        "governance",
        "validation",
        artifacts[0],
      ),
      "utf8",
    ),
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
  "generateValidationEvidence",
  () => {
    test(
      "executes approved focused, full, and build commands and writes valid evidence",
      () => {
        const fixture =
          createFixture();

        const result =
          runGenerator(
            fixture,
            [
              "--focused",
              fixture.focusedTestPath,
              "--full",
              "--build",
            ],
          );

        expect(
          result.status,
          result.combinedOutput,
        ).toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "FORGE validation evidence generated.",
        );

        expect(
          result.combinedOutput,
        ).toContain(
          "Eligible clean committed state: yes",
        );

        const artifact =
          readOnlyArtifact(
            fixture.repositoryRoot,
          );

        expect(
          artifact.commands,
        ).toHaveLength(3);

        expect(
          artifact.commands.map(
            (command) =>
              command.category,
          ),
        ).toEqual([
          "focusedTests",
          "fullTests",
          "productionBuild",
        ]);

        expect(
          artifact.results.focusedTests.status,
        ).toBe(
          "passing",
        );

        expect(
          artifact.results.fullTests.status,
        ).toBe(
          "passing",
        );

        expect(
          artifact.results.productionBuild.status,
        ).toBe(
          "passing",
        );

        expect(
          artifact.repository.before,
        ).toEqual(
          artifact.repository.after,
        );

        for (
          const command
          of artifact.commands
        ) {
          expect(
            command.summary,
          ).not.toContain(
            "\u001b",
          );

          expect(
            command.summary
              .split("\n")
              .some(
                (line) =>
                  /[ \t]+$/.test(
                    line,
                  ),
              ),
          ).toBe(false);
        }
      },
    );

    test(
      "preserves valid failing evidence and exits unsuccessfully",
      () => {
        const fixture =
          createFixture({
            npxExitCode: 1,
          });

        const result =
          runGenerator(
            fixture,
            [
              "--full",
              "--build",
            ],
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "One or more validation commands failed",
        );

        const artifact =
          readOnlyArtifact(
            fixture.repositoryRoot,
          );

        expect(
          artifact.results.fullTests.status,
        ).toBe(
          "failing",
        );

        expect(
          artifact.results.productionBuild.status,
        ).toBe(
          "passing",
        );
      },
    );

    test(
      "records passing dirty-tree evidence but rejects it as eligible proof",
      () => {
        const fixture =
          createFixture({
            mutateDuringNpx:
              true,
          });

        const result =
          runGenerator(
            fixture,
            [
              "--full",
            ],
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "not eligible proof for a clean synchronized main commit",
        );

        const artifact =
          readOnlyArtifact(
            fixture.repositoryRoot,
          );

        expect(
          artifact.results.fullTests.status,
        ).toBe(
          "passing",
        );

        expect(
          artifact.repository.before.workingTreeClean,
        ).toBe(
          true,
        );

        expect(
          artifact.repository.after.workingTreeClean,
        ).toBe(
          false,
        );
      },
    );

    test(
      "rejects unapproved focused paths before executing commands",
      () => {
        const fixture =
          createFixture();

        fs.writeFileSync(
          path.join(
            fixture.repositoryRoot,
            "not-a-test.txt",
          ),
          "not a test\n",
          "utf8",
        );

        const result =
          runGenerator(
            fixture,
            [
              "--focused",
              "not-a-test.txt",
            ],
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "is not an approved test file",
        );

        expect(
          listValidationArtifacts(
            fixture.repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "rejects invocation without an approved validation category",
      () => {
        const fixture =
          createFixture();

        const result =
          runGenerator(
            fixture,
            [],
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "At least one approved validation category must be requested",
        );

        expect(
          listValidationArtifacts(
            fixture.repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "rejects unknown command options",
      () => {
        const fixture =
          createFixture();

        const result =
          runGenerator(
            fixture,
            [
              "--shell",
              "rm -rf .",
            ],
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "Unknown validation option",
        );

        expect(
          listValidationArtifacts(
            fixture.repositoryRoot,
          ),
        ).toEqual([]);
      },
    );
  },
);
