// Thin CLI orchestration around evaluateMaterialGovernanceChange.mjs -- all comparison logic lives
// in that pure module (with its own focused tests); this script only does the git/fs I/O needed to
// feed it and act on its verdict. Run after the genuine FORGE updater (generateValidationEvidence.mjs
// + `npm run forge:session`) has already produced its output in the working tree -- this script
// never runs FORGE's own generation logic itself.
//
// If nothing material changed: deletes the run's new snapshot file(s), restores the 6 tracked files
// to their exact pre-run committed content, and asserts the working tree is clean afterward --
// hard failure if it isn't, not a best-effort cleanup. If something material did change: leaves the
// complete generated output exactly as FORGE produced it (never partial), ready to commit.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { GOVERNANCE_POINTER_TRACKED_PATHS, evaluateMaterialGovernanceChange } from "./evaluateMaterialGovernanceChange.mjs";

const repositoryRoot = process.cwd();

function runGit(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readCommittedContent(relativePath) {
  try {
    return runGit(["show", `HEAD:${relativePath}`]);
  } catch {
    return "";
  }
}

function readWorkingTreeContent(relativePath) {
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return "";
  return fs.readFileSync(absolutePath, "utf8");
}

function listNewSnapshotFiles() {
  const status = runGit(["status", "--porcelain", "--", "governance/snapshots/"]);
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
}

function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `${name}=${value}\n`);
  } else {
    console.log(`${name}=${value}`);
  }
}

function reconcile() {
  const beforeContents = Object.fromEntries(
    GOVERNANCE_POINTER_TRACKED_PATHS.map((relativePath) => [relativePath, readCommittedContent(relativePath)]),
  );
  const afterContents = Object.fromEntries(
    GOVERNANCE_POINTER_TRACKED_PATHS.map((relativePath) => [relativePath, readWorkingTreeContent(relativePath)]),
  );
  const newSnapshotFiles = listNewSnapshotFiles();

  const { materialChangeDetected, changedFiles } = evaluateMaterialGovernanceChange({ beforeContents, afterContents });

  if (!materialChangeDetected) {
    for (const snapshotFile of newSnapshotFiles) {
      fs.unlinkSync(path.resolve(repositoryRoot, snapshotFile));
    }
    if (GOVERNANCE_POINTER_TRACKED_PATHS.length > 0) {
      runGit(["checkout", "--", ...GOVERNANCE_POINTER_TRACKED_PATHS]);
    }

    const remainingStatus = runGit(["status", "--porcelain"]).trim();
    if (remainingStatus.length > 0) {
      throw new Error(
        `Working tree not clean after restoring no-material-change state:\n${remainingStatus}`,
      );
    }

    console.log("No material governance change detected; deleted the new snapshot, restored all tracked files, working tree verified clean.");
    writeGithubOutput("material_change", "false");
    return;
  }

  console.log(`Material governance change detected in: ${changedFiles.join(", ")}`);
  console.log(`New snapshot file(s) retained: ${newSnapshotFiles.join(", ") || "(none created)"}`);
  writeGithubOutput("material_change", "true");
}

try {
  reconcile();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}
