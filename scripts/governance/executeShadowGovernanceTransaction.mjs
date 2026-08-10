import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  executeGovernanceStages,
} from "./executeGovernanceStages.mjs";

const repositoryRoot = process.cwd();

const snapshotDirectory = path.join(
  repositoryRoot,
  "governance",
  "snapshots",
);

const governanceStatePath = path.join(
  repositoryRoot,
  "governance",
  "state",
  "current-governance-state.json",
);

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

function toAbsolutePath(relativePath) {
  return path.join(
    repositoryRoot,
    relativePath,
  );
}

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} does not exist: ${path.relative(repositoryRoot, filePath)}`,
    );
  }

  return fs.readFileSync(
    filePath,
    "utf8",
  );
}

function captureFiles(relativePaths, label) {
  const captured = new Map();

  for (const relativePath of relativePaths) {
    const absolutePath =
      toAbsolutePath(relativePath);

    captured.set(
      absolutePath,
      readRequiredFile(
        absolutePath,
        label,
      ),
    );
  }

  return captured;
}

function restoreFiles(capturedFiles) {
  for (const [filePath, content] of capturedFiles) {
    fs.writeFileSync(
      filePath,
      content,
      "utf8",
    );
  }
}

function listSnapshotNames() {
  if (!fs.existsSync(snapshotDirectory)) {
    return new Set();
  }

  return new Set(
    fs.readdirSync(snapshotDirectory)
      .filter((name) =>
        name.endsWith(".json"),
      ),
  );
}

function identifyNewSnapshot(
  snapshotsBefore,
  snapshotsAfter,
) {
  const createdSnapshots = [
    ...snapshotsAfter,
  ].filter(
    (name) =>
      !snapshotsBefore.has(name),
  );

  if (createdSnapshots.length !== 1) {
    throw new Error(
      `Collector must create exactly one snapshot; created ${createdSnapshots.length}.`,
    );
  }

  return path.join(
    "governance",
    "snapshots",
    createdSnapshots[0],
  );
}

function runNodeScript(
  stage,
  relativeScriptPath,
  args = [],
) {
  console.log(`\n===== ${stage} =====`);

  const result = spawnSync(
    process.execPath,
    [
      toAbsolutePath(relativeScriptPath),
      ...args,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw new Error(
      `${stage} could not run: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${stage} failed with exit code ${result.status}.`,
    );
  }

  console.log(`PASS: ${stage}`);
}

function verifyFilesUnchanged(
  capturedFiles,
  label,
) {
  for (const [filePath, originalContent] of capturedFiles) {
    const currentContent =
      readRequiredFile(
        filePath,
        label,
      );

    if (currentContent !== originalContent) {
      throw new Error(
        `${label} changed unexpectedly: ${path.relative(repositoryRoot, filePath)}`,
      );
    }
  }
}

function verifyCanonicalSnapshot(
  expectedSnapshotPath,
) {
  const governanceState = JSON.parse(
    readRequiredFile(
      governanceStatePath,
      "Canonical governance state",
    ),
  );

  if (
    governanceState.session?.latestSnapshot !==
      expectedSnapshotPath ||
    governanceState.synchronization?.sourceSnapshot !==
      expectedSnapshotPath
  ) {
    throw new Error(
      "Canonical governance state does not reference the snapshot created by this pipeline run.",
    );
  }
}

function removeFileIfPresent(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function removePipelineTemporaryFiles() {
  removeFileIfPresent(
    `${governanceStatePath}.tmp`,
  );

  for (const relativePath of shadowGovernancePaths) {
    removeFileIfPresent(
      `${toAbsolutePath(relativePath)}.tmp`,
    );
  }
}

function removeCreatedSnapshots(
  snapshotsBefore,
) {
  const snapshotsAfter =
    listSnapshotNames();

  for (const snapshotName of snapshotsAfter) {
    if (!snapshotsBefore.has(snapshotName)) {
      removeFileIfPresent(
        path.join(
          snapshotDirectory,
          snapshotName,
        ),
      );
    }
  }
}


export function executeShadowGovernanceTransaction() {
  const snapshotsBefore =
    listSnapshotNames();

  const originalGovernanceState =
    readRequiredFile(
      governanceStatePath,
      "Canonical governance state",
    );

  const originalShadowGovernance =
    captureFiles(
      shadowGovernancePaths,
      "Shadow governance document",
    );

  const originalAuthoritativeGovernance =
    captureFiles(
      authoritativeGovernancePaths,
      "Authoritative governance document",
    );

  let selectedSnapshotPath = null;

  try {
    executeGovernanceStages({
      stages: [
        {
          name:
            "COLLECT SESSION EVIDENCE",
          scriptPath:
            "scripts/governance/collectSessionEvidence.mjs",
        },
      ],
      executeStage: runNodeScript,
    });

    const snapshotsAfterCollection =
      listSnapshotNames();

    selectedSnapshotPath =
      identifyNewSnapshot(
        snapshotsBefore,
        snapshotsAfterCollection,
      );

    console.log(
      `Selected snapshot: ${selectedSnapshotPath}`,
    );

    executeGovernanceStages({
      stages: [
        {
          name:
            "VALIDATE SESSION SNAPSHOT",
          scriptPath:
            "scripts/governance/validateSessionSnapshot.mjs",
          args: [
            selectedSnapshotPath,
          ],
        },
        {
          name:
            "GENERATE CANONICAL GOVERNANCE STATE",
          scriptPath:
            "scripts/governance/generateGovernanceState.mjs",
          args: [
            selectedSnapshotPath,
          ],
        },
        {
          name:
            "VALIDATE CANONICAL GOVERNANCE STATE",
          scriptPath:
            "scripts/governance/validateGovernanceState.mjs",
        },
      ],
      executeStage: runNodeScript,
    });

    verifyCanonicalSnapshot(
      selectedSnapshotPath,
    );

    executeGovernanceStages({
      stages: [
        {
          name:
            "SYNCHRONIZE SHADOW GOVERNANCE",
          scriptPath:
            "scripts/governance/synchronizeShadowGovernance.mjs",
        },
        {
          name:
            "FINAL GOVERNANCE STATE VALIDATION",
          scriptPath:
            "scripts/governance/validateGovernanceState.mjs",
        },
        {
          name:
            "FINAL SESSION SNAPSHOT VALIDATION",
          scriptPath:
            "scripts/governance/validateSessionSnapshot.mjs",
          args: [
            selectedSnapshotPath,
          ],
        },
        {
          name:
            "FINAL SHADOW GOVERNANCE VERIFICATION",
          scriptPath:
            "scripts/governance/verifyShadowGovernance.mjs",
        },
      ],
      executeStage: runNodeScript,
    });

    verifyCanonicalSnapshot(
      selectedSnapshotPath,
    );

    verifyFilesUnchanged(
      originalAuthoritativeGovernance,
      "Authoritative governance document",
    );

    removePipelineTemporaryFiles();

    console.log(
      "\n===== FORGE SHADOW GOVERNANCE PIPELINE COMPLETE =====",
    );
    console.log(
      `Snapshot: ${selectedSnapshotPath}`,
    );
    console.log(
      "Canonical governance state: generated and validated",
    );
    console.log(
      "Shadow governance documents: synchronized and verified",
    );
    console.log(
      "Authoritative governance documents: unchanged",
    );
    console.log(
      "Promotion state: unchanged by pipeline design",
    );

  return Object.freeze({
    status: "completed",
    mode: "shadow",
    snapshotPath:
      path.relative(
        repositoryRoot,
        selectedSnapshotPath,
      ),
    governanceStatePath:
      path.relative(
        repositoryRoot,
        governanceStatePath,
      ),
    shadowDocumentsSynchronized: true,
    authoritativeDocumentsChanged: false,
    promotionStateChanged: false,
  });
} catch (error) {
    console.error(
      "\nPipeline failed. Restoring pre-run generated state...",
    );

    try {
      fs.writeFileSync(
        governanceStatePath,
        originalGovernanceState,
        "utf8",
      );

      restoreFiles(
        originalShadowGovernance,
      );

      removeCreatedSnapshots(
        snapshotsBefore,
      );

      removePipelineTemporaryFiles();

      verifyFilesUnchanged(
        originalAuthoritativeGovernance,
        "Authoritative governance document",
      );

      console.error(
        "Rollback complete: canonical state and shadow documents restored; new snapshots removed.",
      );
    } catch (rollbackError) {
      console.error(
        `ROLLBACK FAILURE: ${rollbackError.message}`,
      );
    }

    throw error;
  }
}
