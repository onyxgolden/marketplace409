import { spawnSync } from "node:child_process";
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
  fileURLToPath(import.meta.url);

const repositoryRoot = path.resolve(
  path.dirname(currentFilePath),
  "../../..",
);

const validatorPath = path.join(
  repositoryRoot,
  "scripts/governance/validateValidationEvidence.mjs",
);

const temporaryDirectories = new Set();

const commitHash =
  "1234567890abcdef1234567890abcdef12345678";

function createTemporaryRepository() {
  const temporaryRepository =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-validation-evidence-",
      ),
    );

  temporaryDirectories.add(
    temporaryRepository,
  );

  fs.mkdirSync(
    path.join(
      temporaryRepository,
      "governance",
      "validation",
    ),
    {
      recursive: true,
    },
  );

  return temporaryRepository;
}

function createRepositoryState({
  branch = "main",
  head = commitHash,
  originMain = commitHash,
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

function createCommandEvidence({
  category,
  command = "npx",
  args,
  exitCode = 0,
  status = "passing",
  summary = "Validation passed.",
  startedAt =
    "2026-07-13T01:00:01.000Z",
  completedAt =
    "2026-07-13T01:00:02.000Z",
} = {}) {
  return {
    category,
    command,
    args,
    workingDirectory: ".",
    startedAt,
    completedAt,
    exitCode,
    status,
    summary,
  };
}

function createPassingArtifact() {
  const commands = [
    createCommandEvidence({
      category: "focusedTests",
      args: [
        "vitest",
        "run",
        "scripts/governance/__tests__/validateValidationEvidence.test.mjs",
      ],
      summary:
        "Focused validation passed.",
    }),

    createCommandEvidence({
      category: "fullTests",
      args: [
        "vitest",
        "run",
      ],
      startedAt:
        "2026-07-13T01:00:03.000Z",
      completedAt:
        "2026-07-13T01:00:04.000Z",
      summary:
        "Full validation passed.",
    }),

    createCommandEvidence({
      category: "productionBuild",
      command: "npm",
      args: [
        "run",
        "build",
      ],
      startedAt:
        "2026-07-13T01:00:05.000Z",
      completedAt:
        "2026-07-13T01:00:06.000Z",
      summary:
        "Production build passed.",
    }),
  ];

  return {
    schemaVersion: "1.0",
    validationId:
      "forge-validation-20260713-010000",
    capturedAt:
      "2026-07-13T01:00:07.000Z",
    startedAt:
      "2026-07-13T01:00:00.000Z",
    completedAt:
      "2026-07-13T01:00:06.000Z",

    repository: {
      before:
        createRepositoryState(),
      after:
        createRepositoryState(),
    },

    commands,

    results: {
      focusedTests: {
        status: "passing",
        commandIndexes: [0],
        summary:
          "Focused validation passed.",
      },

      fullTests: {
        status: "passing",
        commandIndexes: [1],
        summary:
          "Full validation passed.",
      },

      productionBuild: {
        status: "passing",
        commandIndexes: [2],
        summary:
          "Production build passed.",
      },
    },
  };
}

function writeArtifact(
  temporaryRepository,
  artifact,
  filename =
    "forge-validation-20260713-010000.json",
) {
  const relativePath = path.join(
    "governance",
    "validation",
    filename,
  );

  const absolutePath = path.join(
    temporaryRepository,
    relativePath,
  );

  fs.writeFileSync(
    absolutePath,
    typeof artifact === "string"
      ? artifact
      : `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );

  return relativePath;
}

function runValidator(
  temporaryRepository,
  relativeArtifactPath,
) {
  const result = spawnSync(
    process.execPath,
    [
      validatorPath,
      relativeArtifactPath,
    ],
    {
      cwd: temporaryRepository,
      encoding: "utf8",
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  );

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

afterEach(() => {
  for (
    const temporaryDirectory
    of temporaryDirectories
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "validateValidationEvidence",
  () => {
    test(
      "accepts complete passing validation evidence",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            createPassingArtifact(),
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
          result.combinedOutput,
        ).toBe(0);

        expect(
          result.stdout,
        ).toContain(
          "VALID VALIDATION EVIDENCE",
        );

        expect(
          result.stdout,
        ).toContain(
          commitHash,
        );
      },
    );

    test(
      "accepts consistent dirty-tree evidence as structurally valid historical evidence",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        const dirtyRepositoryState =
          createRepositoryState({
            gitStatus: [
              " M src/example.js",
            ],
          });

        artifact.repository.before =
          dirtyRepositoryState;

        artifact.repository.after = {
          ...dirtyRepositoryState,
          gitStatus: [
            ...dirtyRepositoryState.gitStatus,
          ],
        };

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
          result.combinedOutput,
        ).toBe(0);
      },
    );

    test(
      "rejects malformed JSON",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            "{ invalid-json",
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "Validation evidence is not valid JSON",
        );
      },
    );

    test(
      "rejects additional top-level properties",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.unapprovedProperty =
          true;

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "artifact keys do not match the contract",
        );
      },
    );

    test(
      "rejects a passing command with a nonzero exit code",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.commands[0].exitCode =
          1;

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "cannot pass unless exitCode is 0",
        );
      },
    );

    test(
      "rejects a failing command with exit code zero",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.commands[0].status =
          "failing";

        artifact.results.focusedTests = {
          status: "failing",
          commandIndexes: [0],
          summary:
            "Focused validation failed.",
        };

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "cannot fail with exitCode 0",
        );
      },
    );

    test(
      "rejects passing results without command evidence",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.results.focusedTests
          .commandIndexes = [];

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "must reference at least one executed command",
        );
      },
    );

    test(
      "rejects command evidence assigned to the wrong category",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.commands[0].category =
          "fullTests";

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "category does not match focusedTests",
        );
      },
    );

    test(
      "rejects repository HEAD changes during validation",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.repository.after.head =
          "abcdef1234567890abcdef1234567890abcdef12";

        artifact.repository.after
          .headMatchesOriginMain =
            false;

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "Repository HEAD changed during validation",
        );
      },
    );

    test(
      "rejects origin/main changes during validation",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.repository.after
          .originMain =
            "abcdef1234567890abcdef1234567890abcdef12";

        artifact.repository.after
          .headMatchesOriginMain =
            false;

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "Repository origin/main changed during validation",
        );
      },
    );

    test(
      "rejects working-tree claims that disagree with Git status",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.repository.before
          .gitStatus = [
            " M src/example.js",
          ];

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "workingTreeClean disagrees with gitStatus",
        );
      },
    );

    test(
      "rejects not-run results that reference commands",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.results.focusedTests = {
          status: "not-run",
          commandIndexes: [0],
          summary: null,
        };

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "must not reference commands when status is not-run",
        );
      },
    );

    test(
      "rejects commands that are not referenced by a validation result",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.commands.push(
          createCommandEvidence({
            category:
              "focusedTests",
            args: [
              "vitest",
              "run",
              "another-test.mjs",
            ],
            startedAt:
              "2026-07-13T01:00:02.100Z",
            completedAt:
              "2026-07-13T01:00:02.900Z",
          }),
        );

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "Every command must be referenced by exactly one validation result",
        );
      },
    );

    test(
      "rejects commands executed outside the artifact time boundary",
      () => {
        const temporaryRepository =
          createTemporaryRepository();

        const artifact =
          createPassingArtifact();

        artifact.commands[0].startedAt =
          "2026-07-13T00:59:59.000Z";

        const relativeArtifactPath =
          writeArtifact(
            temporaryRepository,
            artifact,
          );

        const result =
          runValidator(
            temporaryRepository,
            relativeArtifactPath,
          );

        expect(
          result.status,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "startedAt precedes artifact.startedAt",
        );
      },
    );
  },
);
