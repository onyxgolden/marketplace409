import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadGovernanceMode,
} from "./loadGovernanceMode.mjs";

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

function runShadowGovernancePipeline() {
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
    runNodeScript(
      "COLLECT SESSION EVIDENCE",
      "scripts/governance/collectSessionEvidence.mjs",
    );

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

    runNodeScript(
      "VALIDATE SESSION SNAPSHOT",
      "scripts/governance/validateSessionSnapshot.mjs",
      [
        selectedSnapshotPath,
      ],
    );

    runNodeScript(
      "GENERATE CANONICAL GOVERNANCE STATE",
      "scripts/governance/generateGovernanceState.mjs",
      [
        selectedSnapshotPath,
      ],
    );

    runNodeScript(
      "VALIDATE CANONICAL GOVERNANCE STATE",
      "scripts/governance/validateGovernanceState.mjs",
    );

    verifyCanonicalSnapshot(
      selectedSnapshotPath,
    );

    runNodeScript(
      "SYNCHRONIZE SHADOW GOVERNANCE",
      "scripts/governance/synchronizeShadowGovernance.mjs",
    );

    runNodeScript(
      "FINAL GOVERNANCE STATE VALIDATION",
      "scripts/governance/validateGovernanceState.mjs",
    );

    runNodeScript(
      "FINAL SESSION SNAPSHOT VALIDATION",
      "scripts/governance/validateSessionSnapshot.mjs",
      [
        selectedSnapshotPath,
      ],
    );

    runNodeScript(
      "FINAL SHADOW GOVERNANCE VERIFICATION",
      "scripts/governance/verifyShadowGovernance.mjs",
    );

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
function runHybridGovernancePipeline() {
  console.log(
    "Hybrid governance pipeline initialized.",
  );

  runShadowGovernancePipeline();

  console.log(
    "Hybrid governance completed shadow synchronization. Delegated authoritative synchronization is pending implementation.",
  );
}

export function runGovernancePipeline(
  {
    mode,
  } = {},
) {
  const activeMode =
    mode ??
    loadGovernanceMode(
      undefined,
      {
        repositoryRoot,
      },
    ).mode;

  console.log(
    `FORGE governance mode: ${activeMode}`,
  );

  switch (activeMode) {
    case "shadow":
      runShadowGovernancePipeline();
      return;

    case "locked":
      console.log(
        "Governance pipeline is locked. No snapshots, state, or governance documents were written.",
      );
      return;

    case "hybrid":
      runHybridGovernancePipeline();
      return;

    case "authoritative":
      throw new Error(
        `Governance mode "${activeMode}" is recognized but not implemented by the pipeline yet.`,
      );
    default:
      throw new Error(
        `Unsupported governance mode: ${activeMode}`,
      );
  }
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(process.argv[1]),
    ).href
  );
}

if (isDirectExecution()) {
  try {
    runGovernancePipeline();
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );
    process.exit(1);
  }
}
