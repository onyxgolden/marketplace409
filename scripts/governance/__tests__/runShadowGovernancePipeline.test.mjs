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

const sourceRepositoryRoot = path.resolve(
  path.dirname(currentFilePath),
  "../../..",
);

const orchestratorRelativePath =
  "scripts/governance/runShadowGovernancePipeline.mjs";

const verifierRelativePath =
  "scripts/governance/verifyShadowGovernance.mjs";

const governanceStateRelativePath =
  "governance/state/current-governance-state.json";

const promotionStateRelativePath =
  "governance/state/promotion-state.json";

const snapshotDirectoryRelativePath =
  "governance/snapshots";

const authoritativeGovernancePaths = [
  "docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md",
  "docs/architecture/FORGE_STATUS.md",
  "docs/architecture/FORGE_SESSION.md",
  "docs/architecture/FORGE_ROADMAP.md",
];

const shadowGovernancePaths = [
  "docs/architecture/synchronized/FORGE_SYNC_CONTROL_CENTER.md",
  "docs/architecture/synchronized/FORGE_SYNC_STATUS.md",
  "docs/architecture/synchronized/FORGE_SYNC_SESSION.md",
  "docs/architecture/synchronized/FORGE_SYNC_ROADMAP.md",
  "docs/architecture/synchronized/FORGE_SYNC_EVALUATION.md",
];

const fixtureDirectoryPaths = [
  "scripts/governance",
  "governance",
  "docs/architecture/synchronized",
];

const fixtureFilePaths = [
  ...authoritativeGovernancePaths,
];

const temporaryRepositories = new Set();

function runProcess(
  command,
  args,
  {
    cwd,
    allowFailure = false,
  } = {},
) {
  const result = spawnSync(
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
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error && !allowFailure) {
    throw result.error;
  }

  if (
    result.status !== 0 &&
    !allowFailure
  ) {
    const output = [
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n");

    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        `Exit status: ${result.status}`,
        output,
      ].join("\n"),
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
  temporaryRepositoryRoot,
  relativePath,
) {
  const sourcePath = path.join(
    sourceRepositoryRoot,
    relativePath,
  );

  const destinationPath = path.join(
    temporaryRepositoryRoot,
    relativePath,
  );

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Fixture source does not exist: ${relativePath}`,
    );
  }

  fs.mkdirSync(
    path.dirname(destinationPath),
    {
      recursive: true,
    },
  );

  fs.cpSync(
    sourcePath,
    destinationPath,
    {
      recursive: true,
    },
  );
}

function initializeGitRepository(
  temporaryRepositoryRoot,
) {
  runProcess(
    "git",
    [
      "init",
      "-b",
      "main",
    ],
    {
      cwd: temporaryRepositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.name",
      "FORGE Governance Test",
    ],
    {
      cwd: temporaryRepositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "config",
      "user.email",
      "forge-governance-test@example.invalid",
    ],
    {
      cwd: temporaryRepositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "add",
      ".",
    ],
    {
      cwd: temporaryRepositoryRoot,
    },
  );

  runProcess(
    "git",
    [
      "commit",
      "-m",
      "Create governance pipeline fixture",
    ],
    {
      cwd: temporaryRepositoryRoot,
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
      cwd: temporaryRepositoryRoot,
    },
  );

  const status = runProcess(
    "git",
    [
      "status",
      "--short",
    ],
    {
      cwd: temporaryRepositoryRoot,
    },
  );

  if (status.stdout.trim() !== "") {
    throw new Error(
      [
        "Temporary fixture repository is not clean.",
        status.stdout,
      ].join("\n"),
    );
  }
}

function createGovernanceFixture() {
  const temporaryRepositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-pipeline-",
      ),
    );

  temporaryRepositories.add(
    temporaryRepositoryRoot,
  );

  for (
    const relativePath
    of fixtureDirectoryPaths
  ) {
    copyFixturePath(
      temporaryRepositoryRoot,
      relativePath,
    );
  }

  for (
    const relativePath
    of fixtureFilePaths
  ) {
    copyFixturePath(
      temporaryRepositoryRoot,
      relativePath,
    );
  }

  initializeGitRepository(
    temporaryRepositoryRoot,
  );

  return temporaryRepositoryRoot;
}

function runNodeScript(
  temporaryRepositoryRoot,
  relativeScriptPath,
  args = [],
  {
    allowFailure = false,
  } = {},
) {
  return runProcess(
    process.execPath,
    [
      path.join(
        temporaryRepositoryRoot,
        relativeScriptPath,
      ),
      ...args,
    ],
    {
      cwd: temporaryRepositoryRoot,
      allowFailure,
    },
  );
}

function runPipeline(
  temporaryRepositoryRoot,
) {
  return runNodeScript(
    temporaryRepositoryRoot,
    orchestratorRelativePath,
    [],
    {
      allowFailure: true,
    },
  );
}

function readRelativeFile(
  temporaryRepositoryRoot,
  relativePath,
) {
  return fs.readFileSync(
    path.join(
      temporaryRepositoryRoot,
      relativePath,
    ),
    "utf8",
  );
}

function captureFiles(
  temporaryRepositoryRoot,
  relativePaths,
) {
  return new Map(
    relativePaths.map(
      (relativePath) => [
        relativePath,
        readRelativeFile(
          temporaryRepositoryRoot,
          relativePath,
        ),
      ],
    ),
  );
}

function expectFilesToEqualCapture(
  temporaryRepositoryRoot,
  capturedFiles,
) {
  for (
    const [
      relativePath,
      expectedContent,
    ]
    of capturedFiles
  ) {
    expect(
      readRelativeFile(
        temporaryRepositoryRoot,
        relativePath,
      ),
      relativePath,
    ).toBe(expectedContent);
  }
}

function listSnapshotNames(
  temporaryRepositoryRoot,
) {
  const snapshotDirectory = path.join(
    temporaryRepositoryRoot,
    snapshotDirectoryRelativePath,
  );

  if (!fs.existsSync(snapshotDirectory)) {
    return [];
  }

  return fs.readdirSync(snapshotDirectory)
    .filter(
      (name) =>
        name.endsWith(".json"),
    )
    .sort();
}

function identifyCreatedSnapshots(
  snapshotsBefore,
  snapshotsAfter,
) {
  const beforeSet =
    new Set(snapshotsBefore);

  return snapshotsAfter.filter(
    (snapshotName) =>
      !beforeSet.has(snapshotName),
  );
}

function listTemporaryFiles(
  rootPath,
) {
  const temporaryFiles = [];

  function inspectDirectory(
    directoryPath,
  ) {
    for (
      const entry
      of fs.readdirSync(
        directoryPath,
        {
          withFileTypes: true,
        },
      )
    ) {
      const entryPath = path.join(
        directoryPath,
        entry.name,
      );

      if (
        entry.isDirectory() &&
        entry.name !== ".git"
      ) {
        inspectDirectory(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".tmp")
      ) {
        temporaryFiles.push(
          path.relative(
            rootPath,
            entryPath,
          ),
        );
      }
    }
  }

  inspectDirectory(rootPath);

  return temporaryFiles.sort();
}

function snapshotRelativePath(
  snapshotName,
) {
  return path.posix.join(
    snapshotDirectoryRelativePath,
    snapshotName,
  );
}

afterEach(() => {
  for (
    const temporaryRepositoryRoot
    of temporaryRepositories
  ) {
    fs.rmSync(
      temporaryRepositoryRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryRepositories.clear();
});

describe.sequential(
  "runShadowGovernancePipeline CLI",
  () => {
    test(
      "executes the real pipeline successfully in a disposable Git repository",
      () => {
        const temporaryRepositoryRoot =
          createGovernanceFixture();

        const snapshotsBefore =
          listSnapshotNames(
            temporaryRepositoryRoot,
          );

        const authoritativeBefore =
          captureFiles(
            temporaryRepositoryRoot,
            authoritativeGovernancePaths,
          );

        const promotionStateBefore =
          readRelativeFile(
            temporaryRepositoryRoot,
            promotionStateRelativePath,
          );

        const result = runPipeline(
          temporaryRepositoryRoot,
        );

        expect(
          result.status,
          result.combinedOutput,
        ).toBe(0);

        const expectedStages = [
          "COLLECT SESSION EVIDENCE",
          "VALIDATE SESSION SNAPSHOT",
          "GENERATE CANONICAL GOVERNANCE STATE",
          "VALIDATE CANONICAL GOVERNANCE STATE",
          "SYNCHRONIZE SHADOW GOVERNANCE",
          "FINAL GOVERNANCE STATE VALIDATION",
          "FINAL SESSION SNAPSHOT VALIDATION",
          "FINAL SHADOW GOVERNANCE VERIFICATION",
        ];

        for (
          const stage
          of expectedStages
        ) {
          expect(
            result.combinedOutput,
          ).toContain(
            `===== ${stage} =====`,
          );

          expect(
            result.combinedOutput,
          ).toContain(
            `PASS: ${stage}`,
          );
        }

        expect(
          result.combinedOutput,
        ).toContain(
          "===== FORGE SHADOW GOVERNANCE PIPELINE COMPLETE =====",
        );

        expect(
          result.combinedOutput,
        ).toContain(
          "Authoritative governance documents: unchanged",
        );

        expect(
          result.combinedOutput,
        ).toContain(
          "Promotion state: unchanged by pipeline design",
        );

        const snapshotsAfter =
          listSnapshotNames(
            temporaryRepositoryRoot,
          );

        const createdSnapshots =
          identifyCreatedSnapshots(
            snapshotsBefore,
            snapshotsAfter,
          );

        expect(createdSnapshots).toHaveLength(1);

        const selectedSnapshotPath =
          snapshotRelativePath(
            createdSnapshots[0],
          );

        expect(
          result.combinedOutput,
        ).toContain(
          `Selected snapshot: ${selectedSnapshotPath}`,
        );

        const snapshotValidation =
          runNodeScript(
            temporaryRepositoryRoot,
            "scripts/governance/validateSessionSnapshot.mjs",
            [
              selectedSnapshotPath,
            ],
          );

        expect(
          snapshotValidation.status,
        ).toBe(0);

        const governanceState = JSON.parse(
          readRelativeFile(
            temporaryRepositoryRoot,
            governanceStateRelativePath,
          ),
        );

        expect(
          governanceState.session.latestSnapshot,
        ).toBe(selectedSnapshotPath);

        expect(
          governanceState.synchronization.sourceSnapshot,
        ).toBe(selectedSnapshotPath);

        const shadowVerification =
          runNodeScript(
            temporaryRepositoryRoot,
            verifierRelativePath,
          );

        expect(
          shadowVerification.status,
        ).toBe(0);

        const evaluationDocument =
          readRelativeFile(
            temporaryRepositoryRoot,
            "docs/architecture/synchronized/FORGE_SYNC_EVALUATION.md",
          );

        expect(
          evaluationDocument,
        ).toContain(
          "## Promotion Recommendations",
        );

        expect(
          evaluationDocument,
        ).toContain(
          "No promotion recommendations have been made.",
        );

        expect(
          evaluationDocument,
        ).toContain(
          "Recommendations do not modify authority. Only the owner may approve promotion.",
        );

        expect(
          evaluationDocument,
        ).not.toContain(
          "recommend promotion to `eligible-for-review`",
        );

        expectFilesToEqualCapture(
          temporaryRepositoryRoot,
          authoritativeBefore,
        );

        expect(
          readRelativeFile(
            temporaryRepositoryRoot,
            promotionStateRelativePath,
          ),
        ).toBe(promotionStateBefore);

        expect(
          listTemporaryFiles(
            temporaryRepositoryRoot,
          ),
        ).toEqual([]);
      },
      60_000,
    );

    test(
      "rolls back generated state after a late-stage verifier failure",
      () => {
        const temporaryRepositoryRoot =
          createGovernanceFixture();

        const snapshotsBefore =
          listSnapshotNames(
            temporaryRepositoryRoot,
          );

        const generatedStateBefore =
          readRelativeFile(
            temporaryRepositoryRoot,
            governanceStateRelativePath,
          );

        const shadowGovernanceBefore =
          captureFiles(
            temporaryRepositoryRoot,
            shadowGovernancePaths,
          );

        const authoritativeBefore =
          captureFiles(
            temporaryRepositoryRoot,
            authoritativeGovernancePaths,
          );

        const promotionStateBefore =
          readRelativeFile(
            temporaryRepositoryRoot,
            promotionStateRelativePath,
          );

        const verifierPath = path.join(
          temporaryRepositoryRoot,
          verifierRelativePath,
        );

        const unavailableVerifierPath =
          `${verifierPath}.unavailable`;

        fs.renameSync(
          verifierPath,
          unavailableVerifierPath,
        );

        let result;

        try {
          result = runPipeline(
            temporaryRepositoryRoot,
          );
        } finally {
          if (
            fs.existsSync(
              unavailableVerifierPath,
            )
          ) {
            fs.renameSync(
              unavailableVerifierPath,
              verifierPath,
            );
          }
        }

        expect(
          result.status,
          result.combinedOutput,
        ).not.toBe(0);

        expect(
          result.combinedOutput,
        ).toContain(
          "SYNCHRONIZE SHADOW GOVERNANCE",
        );

        expect(
          result.combinedOutput,
        ).toMatch(
          /(?:SYNCHRONIZE SHADOW GOVERNANCE|FINAL SHADOW GOVERNANCE VERIFICATION) failed with exit code/,
        );

        expect(
          result.combinedOutput,
        ).toContain(
          "Pipeline failed. Restoring pre-run generated state...",
        );

        expect(
          result.combinedOutput,
        ).toContain(
          "Rollback complete: canonical state and shadow documents restored; new snapshots removed.",
        );

        expect(
          readRelativeFile(
            temporaryRepositoryRoot,
            governanceStateRelativePath,
          ),
        ).toBe(generatedStateBefore);

        expectFilesToEqualCapture(
          temporaryRepositoryRoot,
          shadowGovernanceBefore,
        );

        expectFilesToEqualCapture(
          temporaryRepositoryRoot,
          authoritativeBefore,
        );

        expect(
          readRelativeFile(
            temporaryRepositoryRoot,
            promotionStateRelativePath,
          ),
        ).toBe(promotionStateBefore);

        expect(
          listSnapshotNames(
            temporaryRepositoryRoot,
          ),
        ).toEqual(snapshotsBefore);

        expect(
          fs.existsSync(verifierPath),
        ).toBe(true);

        expect(
          fs.existsSync(
            unavailableVerifierPath,
          ),
        ).toBe(false);

        expect(
          listTemporaryFiles(
            temporaryRepositoryRoot,
          ),
        ).toEqual([]);
      },
      60_000,
    );
  },
);
