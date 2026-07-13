import {
  execFileSync,
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

const defaultRepositoryRoot =
  process.cwd();

const validationDirectoryRelativePath =
  "governance/validation";

const validatorRelativePath =
  "scripts/governance/validateValidationEvidence.mjs";

function assertNonEmptyString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function runGit(
  repositoryRoot,
  args,
) {
  try {
    return execFileSync(
      "git",
      args,
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    ).trimEnd();
  } catch (error) {
    const detail =
      error.stderr
        ?.toString()
        .trim() ||
      error.message ||
      "Unknown Git command failure";

    throw new Error(
      `git ${args.join(" ")} failed: ${detail}`,
    );
  }
}

function parseStatusLines(
  output,
) {
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map(
      (line) =>
        line.trimEnd(),
    )
    .filter(Boolean);
}

function captureCurrentRepositoryState(
  repositoryRoot,
) {
  const branch =
    runGit(
      repositoryRoot,
      [
        "branch",
        "--show-current",
      ],
    );

  const head =
    runGit(
      repositoryRoot,
      [
        "rev-parse",
        "HEAD",
      ],
    );

  const originMain =
    runGit(
      repositoryRoot,
      [
        "rev-parse",
        "origin/main",
      ],
    );

  const gitStatus =
    parseStatusLines(
      runGit(
        repositoryRoot,
        [
          "status",
          "--short",
        ],
      ),
    );

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

function listArtifactPaths(
  repositoryRoot,
) {
  const validationDirectory =
    path.join(
      repositoryRoot,
      validationDirectoryRelativePath,
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
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".json",
        ),
    )
    .map(
      (entry) =>
        path.join(
          validationDirectoryRelativePath,
          entry.name,
        ),
    )
    .sort();
}

function validateArtifact(
  repositoryRoot,
  relativeArtifactPath,
) {
  const validatorPath =
    path.join(
      repositoryRoot,
      validatorRelativePath,
    );

  if (
    !fs.existsSync(
      validatorPath,
    )
  ) {
    throw new Error(
      `Validation evidence validator does not exist: ${validatorRelativePath}`,
    );
  }

  const result =
    spawnSync(
      process.execPath,
      [
        validatorPath,
        relativeArtifactPath,
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

  return {
    valid:
      !result.error &&
      result.status === 0,

    detail:
      [
        result.stdout,
        result.stderr,
        result.error
          ?.message,
      ]
        .filter(Boolean)
        .join("\n")
        .trim(),
  };
}

function readArtifact(
  repositoryRoot,
  relativeArtifactPath,
) {
  const absolutePath =
    path.join(
      repositoryRoot,
      relativeArtifactPath,
    );

  return JSON.parse(
    fs.readFileSync(
      absolutePath,
      "utf8",
    ),
  );
}

function collectEligibilityReasons(
  artifact,
  currentRepository,
) {
  const reasons = [];

  const before =
    artifact.repository.before;

  const after =
    artifact.repository.after;

  if (
    currentRepository.branch !==
      "main"
  ) {
    reasons.push(
      "current-branch-not-main",
    );
  }

  if (
    currentRepository
      .workingTreeClean !==
      true
  ) {
    reasons.push(
      "current-working-tree-dirty",
    );
  }

  if (
    currentRepository
      .headMatchesOriginMain !==
      true
  ) {
    reasons.push(
      "current-head-does-not-match-origin-main",
    );
  }

  if (
    before.branch !==
      currentRepository.branch ||
    after.branch !==
      currentRepository.branch
  ) {
    reasons.push(
      "artifact-branch-mismatch",
    );
  }

  if (
    before.head !==
      currentRepository.head ||
    after.head !==
      currentRepository.head
  ) {
    reasons.push(
      "artifact-head-mismatch",
    );
  }

  if (
    before.originMain !==
      currentRepository.originMain ||
    after.originMain !==
      currentRepository.originMain
  ) {
    reasons.push(
      "artifact-origin-main-mismatch",
    );
  }

  if (
    before.branch !==
      after.branch ||
    before.head !==
      after.head ||
    before.originMain !==
      after.originMain
  ) {
    reasons.push(
      "artifact-repository-state-changed",
    );
  }

  if (
    before.workingTreeClean !==
      true ||
    after.workingTreeClean !==
      true ||
    before.gitStatus.length !==
      0 ||
    after.gitStatus.length !==
      0
  ) {
    reasons.push(
      "artifact-working-tree-not-clean",
    );
  }

  if (
    before.headMatchesOriginMain !==
      true ||
    after.headMatchesOriginMain !==
      true
  ) {
    reasons.push(
      "artifact-head-does-not-match-origin-main",
    );
  }

  return reasons;
}

function compareEligibleArtifacts(
  left,
  right,
) {
  const completionDifference =
    Date.parse(
      right.artifact.completedAt,
    ) -
    Date.parse(
      left.artifact.completedAt,
    );

  if (
    completionDifference !== 0
  ) {
    return completionDifference;
  }

  return left.path.localeCompare(
    right.path,
  );
}

export function selectEligibleValidationEvidence({
  repositoryRoot =
    defaultRepositoryRoot,
} = {}) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  const currentRepository =
    captureCurrentRepositoryState(
      repositoryRoot,
    );

  const inspectedArtifacts = [];

  for (
    const relativeArtifactPath
    of listArtifactPaths(
      repositoryRoot,
    )
  ) {
    const validation =
      validateArtifact(
        repositoryRoot,
        relativeArtifactPath,
      );

    if (
      !validation.valid
    ) {
      inspectedArtifacts.push({
        path:
          relativeArtifactPath,
        eligible:
          false,
        reasons: [
          "artifact-invalid",
        ],
        validationDetail:
          validation.detail,
      });

      continue;
    }

    const artifact =
      readArtifact(
        repositoryRoot,
        relativeArtifactPath,
      );

    const reasons =
      collectEligibilityReasons(
        artifact,
        currentRepository,
      );

    inspectedArtifacts.push({
      path:
        relativeArtifactPath,
      artifact,
      eligible:
        reasons.length === 0,
      reasons,
    });
  }

  const eligibleArtifacts =
    inspectedArtifacts
      .filter(
        (entry) =>
          entry.eligible,
      )
      .sort(
        compareEligibleArtifacts,
      );

  const selected =
    eligibleArtifacts[0] ??
    null;

  return {
    currentRepository,
    selected:
      selected
        ? {
            path:
              selected.path,
            artifact:
              selected.artifact,
          }
        : null,
    inspectedArtifacts:
      inspectedArtifacts.map(
        (entry) => ({
          path:
            entry.path,
          eligible:
            entry.eligible,
          reasons: [
            ...entry.reasons,
          ],
        }),
      ),
  };
}

function runCli() {
  const result =
    selectEligibleValidationEvidence();

  if (
    result.selected ===
      null
  ) {
    console.log(
      "No eligible validation evidence found.",
    );

    process.exit(2);
  }

  console.log(
    "ELIGIBLE VALIDATION EVIDENCE SELECTED",
  );

  console.log(
    `Artifact: ${result.selected.path}`,
  );

  console.log(
    `Validation ID: ${result.selected.artifact.validationId}`,
  );

  console.log(
    `Repository HEAD: ${result.currentRepository.head}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(
    process.argv[1],
  ) ===
    path.resolve(
      new URL(
        import.meta.url,
      ).pathname,
    )
) {
  try {
    runCli();
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );

    process.exit(1);
  }
}
