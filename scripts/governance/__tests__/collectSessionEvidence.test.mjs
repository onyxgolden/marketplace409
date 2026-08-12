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

const collectorRelativePath =
  "scripts/governance/collectSessionEvidence.mjs";

const snapshotValidatorRelativePath =
  "scripts/governance/validateSessionSnapshot.mjs";

const fixturePaths = [
  ".gitignore",
  collectorRelativePath,
  snapshotValidatorRelativePath,
  "scripts/governance/buildSessionValidationEvidence.mjs",
  "scripts/governance/reviewedSessionMetadataContract.mjs",
  "scripts/governance/selectEligibleValidationEvidence.mjs",
  "scripts/governance/validateValidationEvidence.mjs",
  "scripts/governance/writeSnapshotWithCollisionSafety.mjs",
  "governance/schema/session-summary.schema.json",
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
        `Exit status: ${result.status}`,
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

  if (
    !fs.existsSync(
      sourcePath,
    )
  ) {
    throw new Error(
      `Fixture source does not exist: ${relativePath}`,
    );
  }

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
      cwd:
        repositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.name",
      "FORGE Collector Test",
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
      "forge-collector@example.invalid",
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
      "Create collector fixture",
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

function createFixture() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-session-collector-",
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
      cwd:
        repositoryRoot,
    },
  ).stdout.trim();
}

function repositoryState(
  head,
) {
  return {
    branch:
      "main",

    head,

    originMain:
      head,

    headMatchesOriginMain:
      true,

    workingTreeClean:
      true,

    gitStatus: [],
  };
}

function createValidationArtifact({
  head,
  validationId =
    "forge-validation-20260713-020000",
} = {}) {
  return {
    schemaVersion:
      "1.0",

    validationId,

    capturedAt:
      "2026-07-13T02:00:04.000Z",

    startedAt:
      "2026-07-13T02:00:00.000Z",

    completedAt:
      "2026-07-13T02:00:03.000Z",

    repository: {
      before:
        repositoryState(
          head,
        ),

      after:
        repositoryState(
          head,
        ),
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
          0,

        status:
          "passing",

        summary:
          "Full tests passed.",
      },

      {
        category:
          "productionBuild",

        command:
          "npm",

        args: [
          "run",
          "build",
        ],

        workingDirectory:
          ".",

        startedAt:
          "2026-07-13T02:00:02.000Z",

        completedAt:
          "2026-07-13T02:00:03.000Z",

        exitCode:
          0,

        status:
          "passing",

        summary:
          "Production build passed.",
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
          "passing",

        commandIndexes: [
          1,
        ],

        summary:
          "Full tests passed.",
      },

      productionBuild: {
        status:
          "passing",

        commandIndexes: [
          2,
        ],

        summary:
          "Production build passed.",
      },
    },
  };
}

function writeValidationArtifact(
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

  const relativePath =
    path.join(
      "governance",
      "validation",
      `${artifact.validationId}.json`,
    );

  fs.writeFileSync(
    path.join(
      repositoryRoot,
      relativePath,
    ),
    `${JSON.stringify(
      artifact,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return relativePath;
}

function runCollector(
  repositoryRoot,
  extraArgs = [],
) {
  return runProcess(
    process.execPath,
    [
      path.join(
        repositoryRoot,
        collectorRelativePath,
      ),
      ...extraArgs,
    ],
    {
      cwd:
        repositoryRoot,
    },
  );
}

function listSnapshots(
  repositoryRoot,
) {
  const snapshotDirectory =
    path.join(
      repositoryRoot,
      "governance",
      "snapshots",
    );

  if (
    !fs.existsSync(
      snapshotDirectory,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      snapshotDirectory,
    )
    .filter(
      (name) =>
        name.endsWith(
          ".json",
        ),
    )
    .sort();
}

function readOnlySnapshot(
  repositoryRoot,
) {
  const snapshots =
    listSnapshots(
      repositoryRoot,
    );

  expect(
    snapshots,
  ).toHaveLength(1);

  const relativePath =
    path.join(
      "governance",
      "snapshots",
      snapshots[0],
    );

  return {
    relativePath,

    snapshot:
      JSON.parse(
        fs.readFileSync(
          path.join(
            repositoryRoot,
            relativePath,
          ),
          "utf8",
        ),
      ),
  };
}

function validateSnapshot(
  repositoryRoot,
  relativeSnapshotPath,
) {
  return runProcess(
    process.execPath,
    [
      path.join(
        repositoryRoot,
        snapshotValidatorRelativePath,
      ),
      relativeSnapshotPath,
    ],
    {
      cwd:
        repositoryRoot,
    },
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
  "collectSessionEvidence validation integration",
  () => {
    test(
      "preserves not-run validation when no eligible artifact exists",
      () => {
        const repositoryRoot =
          createFixture();

        const collectorResult =
          runCollector(
            repositoryRoot,
          );

        expect(
          collectorResult.status,
          collectorResult.combinedOutput,
        ).toBe(0);

        expect(
          collectorResult.stdout,
        ).toContain(
          "Validation evidence: none eligible",
        );

        const {
          relativePath,
          snapshot,
        } =
          readOnlySnapshot(
            repositoryRoot,
          );

        expect(
          snapshot.validation,
        ).toEqual({
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
        });

        expect(
          snapshot.evidence
            .selectedValidationArtifact,
        ).toBeNull();

        const validationResult =
          validateSnapshot(
            repositoryRoot,
            relativePath,
          );

        expect(
          validationResult.status,
          validationResult.combinedOutput,
        ).toBe(0);
      },
    );

    test(
      "consumes eligible validation evidence and records artifact provenance",
      () => {
        const repositoryRoot =
          createFixture();

        const head =
          currentCommit(
            repositoryRoot,
          );

        const artifact =
          createValidationArtifact({
            head,
          });

        const artifactPath =
          writeValidationArtifact(
            repositoryRoot,
            artifact,
          );

        expect(
          runProcess(
            "git",
            [
              "status",
              "--short",
            ],
            {
              cwd:
                repositoryRoot,
            },
          ).stdout.trim(),
        ).toBe("");

        const collectorResult =
          runCollector(
            repositoryRoot,
          );

        expect(
          collectorResult.status,
          collectorResult.combinedOutput,
        ).toBe(0);

        expect(
          collectorResult.stdout,
        ).toContain(
          `Validation evidence: ${artifactPath}`,
        );

        const {
          relativePath,
          snapshot,
        } =
          readOnlySnapshot(
            repositoryRoot,
          );

        expect(
          snapshot.validation,
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
              "passing",

            command:
              "npx vitest run",

            summary:
              "Full tests passed.",
          },

          productionBuild: {
            status:
              "passing",

            command:
              "npm run build",

            summary:
              "Production build passed.",
          },
        });

        expect(
          snapshot.evidence
            .selectedValidationArtifact,
        ).toEqual({
          path:
            artifactPath,

          validationId:
            artifact.validationId,

          completedAt:
            artifact.completedAt,

          repositoryHead:
            head,
        });

        const validationResult =
          validateSnapshot(
            repositoryRoot,
            relativePath,
          );

        expect(
          validationResult.status,
          validationResult.combinedOutput,
        ).toBe(0);
      },
    );

    test(
      "does not consume validation evidence bound to another commit",
      () => {
        const repositoryRoot =
          createFixture();

        writeValidationArtifact(
          repositoryRoot,
          createValidationArtifact({
            head:
              "1234567890abcdef1234567890abcdef12345678",
          }),
        );

        const collectorResult =
          runCollector(
            repositoryRoot,
          );

        expect(
          collectorResult.status,
          collectorResult.combinedOutput,
        ).toBe(0);

        expect(
          collectorResult.stdout,
        ).toContain(
          "Validation evidence: none eligible",
        );

        const {
          snapshot,
        } =
          readOnlySnapshot(
            repositoryRoot,
          );

        expect(
          snapshot.evidence
            .selectedValidationArtifact,
        ).toBeNull();

        expect(
          snapshot.validation.fullTests.status,
        ).toBe(
          "not-run",
        );
      },
    );
  },
);

describe("collectSessionEvidence reviewed metadata: applies fields", () => {
  afterEach(() => {
    for (const repositoryRoot of temporaryRepositories) {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
    temporaryRepositories.clear();
  });

  function writeReviewedMetadataFile(repositoryRoot, metadata) {
    const metadataPath = path.join(repositoryRoot, "reviewed-metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");
    return metadataPath;
  }

  test("applies reviewed phase, objective, and next-session fields when no completion is requested", () => {
    const repositoryRoot = createFixture();
    temporaryRepositories.add(repositoryRoot);

    const metadataPath = writeReviewedMetadataFile(repositoryRoot, {
      phaseIdentifier: "16.9",
      phaseTitle: "Session Closeout Metadata",
      endingObjective: "Ship the reviewed closeout workflow.",
      deliveredWork: ["Added reviewed session metadata contract."],
      nextSessionObjective: "Wire the metadata form into the dashboard.",
    });

    const result = runCollector(repositoryRoot, [
      path.relative(repositoryRoot, metadataPath),
    ]);

    const { snapshot } = readOnlySnapshot(repositoryRoot);

    expect(snapshot.phase.identifier).toBe("16.9");
    expect(snapshot.phase.title).toBe("Session Closeout Metadata");
    expect(snapshot.objective.endingObjective).toBe(
      "Ship the reviewed closeout workflow.",
    );
    expect(snapshot.objective.startingObjective).toBe("REVIEW_REQUIRED");
    expect(snapshot.work.delivered).toEqual([
      "Added reviewed session metadata contract.",
    ]);
    expect(snapshot.nextSession.objective).toBe(
      "Wire the metadata form into the dashboard.",
    );
    expect(snapshot.completion.workComplete).toBe(false);
    expect(result.combinedOutput).toContain(
      "Reviewed session metadata applied",
    );
  });
});

describe("collectSessionEvidence reviewed metadata: completion gating", () => {
  afterEach(() => {
    for (const repositoryRoot of temporaryRepositories) {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
    temporaryRepositories.clear();
  });

  function writeReviewedMetadataFile(repositoryRoot, metadata) {
    const metadataPath = path.join(repositoryRoot, "reviewed-metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");
    return metadataPath;
  }

  test("does not mark the session complete when no eligible validation evidence exists", () => {
    const repositoryRoot = createFixture();
    temporaryRepositories.add(repositoryRoot);

    const metadataPath = writeReviewedMetadataFile(repositoryRoot, {
      markSessionComplete: true,
    });

    runCollector(repositoryRoot, [
      path.relative(repositoryRoot, metadataPath),
    ]);

    const { snapshot } = readOnlySnapshot(repositoryRoot);

    expect(snapshot.completion.workComplete).toBe(false);
    expect(snapshot.completion.supportedByEvidence).toBe(false);
    expect(snapshot.completion.incompleteReason).toContain(
      "does not yet cover a passing result",
    );
    expect(snapshot.phase.status).toBe("incomplete");
  });

  test("does not mark the session complete when validation evidence on disk is bound to a stale commit, even though completion was requested", () => {
    const repositoryRoot = createFixture();
    temporaryRepositories.add(repositoryRoot);

    writeValidationArtifact(
      repositoryRoot,
      createValidationArtifact({
        head: "1234567890abcdef1234567890abcdef12345678",
      }),
    );

    const metadataPath = writeReviewedMetadataFile(repositoryRoot, {
      markSessionComplete: true,
    });

    runCollector(repositoryRoot, [
      path.relative(repositoryRoot, metadataPath),
    ]);

    const { snapshot } = readOnlySnapshot(repositoryRoot);

    expect(snapshot.completion.workComplete).toBe(false);
    expect(snapshot.completion.supportedByEvidence).toBe(false);
    expect(snapshot.completion.incompleteReason).toContain(
      "does not yet cover a passing result",
    );
  });

  test("does not mark the session complete when current evidence includes a failing category, even though completion was requested", () => {
    const repositoryRoot = createFixture();
    temporaryRepositories.add(repositoryRoot);

    const head = currentCommit(repositoryRoot);

    const artifact = createValidationArtifact({ head });
    artifact.commands[1].status = "failing";
    artifact.commands[1].exitCode = 1;
    artifact.results.fullTests.status = "failing";

    writeValidationArtifact(repositoryRoot, artifact);

    const metadataPath = writeReviewedMetadataFile(repositoryRoot, {
      markSessionComplete: true,
    });

    runCollector(repositoryRoot, [
      path.relative(repositoryRoot, metadataPath),
    ]);

    const { snapshot } = readOnlySnapshot(repositoryRoot);

    expect(snapshot.completion.workComplete).toBe(false);
    expect(snapshot.completion.supportedByEvidence).toBe(false);
    expect(snapshot.completion.incompleteReason).toContain(
      "does not yet cover a passing result",
    );
  });
});

describe("collectSessionEvidence reviewed metadata: rejects invalid input", () => {
  afterEach(() => {
    for (const repositoryRoot of temporaryRepositories) {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
    temporaryRepositories.clear();
  });

  function writeReviewedMetadataFile(repositoryRoot, metadata) {
    const metadataPath = path.join(repositoryRoot, "reviewed-metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");
    return metadataPath;
  }

  test("rejects an invalid reviewed metadata file", () => {
    const repositoryRoot = createFixture();
    temporaryRepositories.add(repositoryRoot);

    const metadataPath = writeReviewedMetadataFile(repositoryRoot, {
      unrecognizedField: "x",
    });

    expect(() =>
      runCollector(repositoryRoot, [
        path.relative(repositoryRoot, metadataPath),
      ]),
    ).toThrow();
  });
});
