import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  buildSessionValidationEvidence,
} from "./buildSessionValidationEvidence.mjs";

import {
  applyReviewedSessionMetadata,
  validateReviewedSessionMetadata,
} from "./reviewedSessionMetadataContract.mjs";

const repositoryRoot = process.cwd();
const snapshotDirectory = path.join(
  repositoryRoot,
  "governance",
  "snapshots",
);

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    if (allowFailure) {
      return null;
    }

    const detail =
      error.stderr?.toString().trim() ||
      error.message ||
      "Unknown Git command failure";

    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toSessionTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function parseStatusLines(statusOutput) {
  if (!statusOutput) {
    return [];
  }

  return statusOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function loadReviewedMetadata(metadataPath) {
  const resolvedPath = path.resolve(
    repositoryRoot,
    metadataPath,
  );

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Reviewed session metadata file does not exist: ${resolvedPath}`,
    );
  }

  let rawMetadata;

  try {
    rawMetadata = JSON.parse(
      fs.readFileSync(resolvedPath, "utf8"),
    );
  } catch (error) {
    throw new Error(
      `Reviewed session metadata file is not valid JSON: ${error.message}`,
    );
  }

  return validateReviewedSessionMetadata(rawMetadata);
}

function resolveCompletion({
  baseCompletion,
  reviewedMetadata,
  sessionValidationEvidence,
  head,
}) {
  const evidenceCoversCurrentCommit =
    sessionValidationEvidence.selectedArtifact !== null &&
    sessionValidationEvidence.selectedArtifact.repositoryHead ===
      head;

  const validationAllPassing =
    sessionValidationEvidence.validation.focusedTests
      .status === "passing" &&
    sessionValidationEvidence.validation.fullTests
      .status === "passing" &&
    sessionValidationEvidence.validation.productionBuild
      .status === "passing";

  const completionEligible =
    evidenceCoversCurrentCommit && validationAllPassing;

  const resolvedWorkComplete =
    reviewedMetadata.markSessionComplete === true &&
    completionEligible;

  if (resolvedWorkComplete) {
    return {
      phaseStatus: "complete",
      completion: {
        workComplete: true,
        supportedByEvidence: true,
        incompleteReason: null,
      },
    };
  }

  if (
    reviewedMetadata.markSessionComplete === true &&
    reviewedMetadata.incompleteReason === undefined
  ) {
    return {
      phaseStatus: null,
      completion: {
        ...baseCompletion,
        incompleteReason:
          "Reviewer marked this session complete, but validation evidence does not yet cover a passing result for the current commit.",
      },
    };
  }

  return {
    phaseStatus: null,
    completion: baseCompletion,
  };
}

const now = new Date();
const sessionTimestamp = toSessionTimestamp(now);
const sessionId = `forge-session-${sessionTimestamp}`;

const branch = runGit(["branch", "--show-current"]);
const head = runGit(["rev-parse", "HEAD"]);
const originMain = runGit(["rev-parse", "origin/main"]);
const statusOutput = runGit(["status", "--short"]);
const statusLines = parseStatusLines(statusOutput);

const latestCommit = runGit([
  "log",
  "-1",
  "--format=%H%n%s%n%cI",
]);

const latestCommitParts = latestCommit.split("\n");
const latestCommitHash = latestCommitParts[0] ?? null;
const latestCommitSubject = latestCommitParts[1] ?? null;
const latestCommitDate = latestCommitParts[2] ?? null;

const modifiedFiles = statusLines.map((line) =>
  line.length > 3 ? line.slice(3) : line,
);

const sessionValidationEvidence =
  buildSessionValidationEvidence({
    repositoryRoot,
  });

let snapshot = {
  schemaVersion: "1.0",
  sessionId,
  sessionDate: toLocalDateString(now),

  phase: {
    identifier: "REVIEW_REQUIRED",
    title: "REVIEW_REQUIRED",
    status: "incomplete",
  },

  objective: {
    startingObjective: "REVIEW_REQUIRED",
    endingObjective: "REVIEW_REQUIRED",
  },

  repository: {
    head,
    originMain,
    branch,
    workingTreeClean: statusLines.length === 0,
    implementationCommit: null,
    governanceCommit: null,
  },

  work: {
    delivered: [],
    modifiedFiles,
    knownWarnings: [],
  },

  validation:
    sessionValidationEvidence.validation,

  completion: {
    workComplete: false,
    supportedByEvidence: false,
    incompleteReason:
      "The repository evidence collector does not infer session completion. Human review is required.",
  },

  nextSession: {
    objective: "REVIEW_REQUIRED",
    startingInspection: "REVIEW_REQUIRED",
  },

  evidence: {
    capturedAt: now.toISOString(),
    latestCommit: {
      hash: latestCommitHash,
      subject: latestCommitSubject,
      committedAt: latestCommitDate,
    },
    headMatchesOriginMain: head === originMain,
    gitStatus: statusLines,
    selectedValidationArtifact:
      sessionValidationEvidence.selectedArtifact,
  },
};

const metadataPath = process.argv[2] ?? null;
let reviewedMetadataApplied = false;

if (metadataPath) {
  const reviewedMetadata =
    loadReviewedMetadata(metadataPath);

  snapshot = applyReviewedSessionMetadata({
    snapshot,
    reviewedMetadata,
  });

  const { phaseStatus, completion } =
    resolveCompletion({
      baseCompletion: snapshot.completion,
      reviewedMetadata,
      sessionValidationEvidence,
      head,
    });

  snapshot = {
    ...snapshot,
    phase: phaseStatus
      ? { ...snapshot.phase, status: phaseStatus }
      : snapshot.phase,
    completion,
  };

  reviewedMetadataApplied = true;
}

fs.mkdirSync(snapshotDirectory, {
  recursive: true,
});

const snapshotPath = path.join(
  snapshotDirectory,
  `${sessionId}.json`,
);

if (fs.existsSync(snapshotPath)) {
  throw new Error(
    `Snapshot already exists: ${path.relative(repositoryRoot, snapshotPath)}`,
  );
}

fs.writeFileSync(
  snapshotPath,
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

console.log("FORGE session evidence collected.");
console.log(
  `Snapshot: ${path.relative(repositoryRoot, snapshotPath)}`,
);
console.log(`Branch: ${branch}`);
console.log(`HEAD: ${head}`);
console.log(`origin/main: ${originMain}`);
console.log(
  `Working tree: ${statusLines.length === 0 ? "clean" : "dirty"}`,
);
console.log(
  `HEAD matches origin/main: ${head === originMain ? "yes" : "no"}`,
);
console.log(
  `Validation evidence: ${
    sessionValidationEvidence.selectedArtifact
      ? sessionValidationEvidence.selectedArtifact.path
      : "none eligible"
  }`,
);

if (reviewedMetadataApplied) {
  console.log(
    `Reviewed session metadata applied: ${path.relative(repositoryRoot, path.resolve(repositoryRoot, metadataPath))}`,
  );
  console.log(
    `Session marked complete: ${snapshot.completion.workComplete ? "yes" : "no"}`,
  );
} else {
  console.log("");
  console.log(
    "Review required: phase, objectives, delivered work, validation, completion, and next-session fields were not inferred.",
  );
}
