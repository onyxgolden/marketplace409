import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildGovernanceState,
} from "./buildGovernanceState.mjs";

import {
  loadGovernanceMode,
} from "./loadGovernanceMode.mjs";

const repositoryRoot = process.cwd();

const governanceStatePath =
  "governance/state/current-governance-state.json";

const promotionStatePath =
  "governance/state/promotion-state.json";

const capabilitiesPolicyPath =
  "governance/policies/capabilities.json";

const editableSectionsPolicyPath =
  "governance/policies/editable-sections.json";

function readJson(relativePath, label) {
  const absolutePath = path.resolve(
    repositoryRoot,
    relativePath,
  );

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `${label} does not exist: ${relativePath}`,
    );
  }

  let content;

  try {
    content = fs.readFileSync(
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${relativePath}: ${error.message}`,
    );
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }
}

function normalizeRepositoryPath(
  suppliedPath,
  label,
) {
  if (
    typeof suppliedPath !== "string" ||
    suppliedPath.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string`,
    );
  }

  const absolutePath = path.resolve(
    repositoryRoot,
    suppliedPath,
  );

  const relativePath = path.relative(
    repositoryRoot,
    absolutePath,
  );

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `${label} must remain inside the repository`,
    );
  }

  return relativePath;
}

function runNodeScript(
  relativeScriptPath,
  args = [],
) {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(
        repositoryRoot,
        relativeScriptPath,
      ),
      ...args,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw new Error(
      `${relativeScriptPath} could not run: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `Validation failed: ${relativeScriptPath}`,
    );
  }
}

function writeCandidateState(
  relativePath,
  governanceState,
) {
  const absolutePath = path.resolve(
    repositoryRoot,
    relativePath,
  );

  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(governanceState, null, 2)}\n`,
    "utf8",
  );
}

function generateGovernanceState(
  snapshotPath,
) {
  const normalizedSnapshotPath =
    normalizeRepositoryPath(
      snapshotPath,
      "snapshotPath",
    );

  runNodeScript(
    "scripts/governance/validateSessionSnapshot.mjs",
    [
      normalizedSnapshotPath,
    ],
  );

  const snapshot = readJson(
    normalizedSnapshotPath,
    "Session snapshot",
  );

  const currentGovernanceState = readJson(
    governanceStatePath,
    "Current governance state",
  );

  const promotionState = readJson(
    promotionStatePath,
    "Promotion state",
  );

  const capabilitiesPolicy = readJson(
    capabilitiesPolicyPath,
    "Capabilities policy",
  );

  const editableSectionsPolicy = readJson(
    editableSectionsPolicyPath,
    "Editable-sections policy",
  );

  const governanceMode =
    loadGovernanceMode(
      undefined,
      {
        repositoryRoot,
      },
    );

  const generatedState = {
    schemaVersion: "1.0",

    repository: {
      branch: snapshot.repository.branch,
      head: snapshot.repository.head,
      originMain:
        snapshot.repository.originMain,
      workingTreeClean:
        snapshot.repository.workingTreeClean,
      headMatchesOriginMain:
        snapshot.repository.head ===
        snapshot.repository.originMain,
    },

    session: {
      latestSnapshot:
        normalizedSnapshotPath,
      lastUpdated:
        snapshot.evidence.capturedAt,
    },

    state:
      buildGovernanceState({
        currentGovernanceState,
      }),

    validation:
      snapshot.validation,

    completion:
      currentGovernanceState.completion,

    authority: {
      defaultAuthority:
        promotionState.defaultAuthority,
      promotionStateVersion:
        promotionState.version,
      capabilitiesVersion:
        capabilitiesPolicy.version,
      editableSectionsVersion:
        editableSectionsPolicy.version,
    },

    synchronization: {
      mode:
        governanceMode.mode,
      stateGeneratedAt: null,
      sourceSnapshot:
        normalizedSnapshotPath,
      rendererVersion: null,
    },
  };

  const absoluteStatePath = path.resolve(
    repositoryRoot,
    governanceStatePath,
  );

  const candidatePath =
    `${absoluteStatePath}.tmp`;

  const relativeCandidatePath = path.relative(
    repositoryRoot,
    candidatePath,
  );

  try {
    writeCandidateState(
      relativeCandidatePath,
      generatedState,
    );

    runNodeScript(
      "scripts/governance/validateGovernanceState.mjs",
      [
        relativeCandidatePath,
      ],
    );

    fs.renameSync(
      candidatePath,
      absoluteStatePath,
    );
  } catch (error) {
    if (fs.existsSync(candidatePath)) {
      fs.unlinkSync(candidatePath);
    }

    throw error;
  }

  console.log(
    "PASS: Canonical governance state generated successfully.",
  );

  console.log(
    `Governance mode: ${governanceMode.mode}`,
  );

  console.log(
    `Source snapshot: ${normalizedSnapshotPath}`,
  );

  console.log(
    `Governance state: ${governanceStatePath}`,
  );
}

const suppliedSnapshotPath =
  process.argv[2];

if (!suppliedSnapshotPath) {
  console.error(
    "Usage: node scripts/governance/generateGovernanceState.mjs <session-snapshot-path>",
  );

  process.exit(1);
}

try {
  generateGovernanceState(
    suppliedSnapshotPath,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
