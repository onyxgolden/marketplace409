import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { renderAllShadowDocuments } from "./renderShadowDocuments.mjs";
import { loadGovernanceState } from "./loadGovernanceState.mjs";

const repositoryRoot = process.cwd();

const synchronizedDirectory = path.join(
  repositoryRoot,
  "docs",
  "architecture",
  "synchronized",
);

function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function runNodeScript(relativePath, args = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, relativePath), ...args],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Validation failed: ${relativePath}`,
    );
  }
}

function synchronizeShadowGovernance() {
  const renderedDocuments =
    renderAllShadowDocuments({
      repositoryRoot,
    });

  const originals = new Map();

  for (const [documentName] of Object.entries(renderedDocuments)) {
    const filePath = path.join(
      synchronizedDirectory,
      documentName,
    );

    originals.set(
      filePath,
      fs.readFileSync(filePath, "utf8"),
    );
  }

  try {
    for (const [documentName, content] of Object.entries(
      renderedDocuments,
    )) {
      atomicWrite(
        path.join(
          synchronizedDirectory,
          documentName,
        ),
        content,
      );
    }

    const governanceState =
      loadGovernanceState(
        "governance/state/current-governance-state.json",
        {
          repositoryRoot,
        },
      );

    runNodeScript(
      "scripts/governance/validateGovernanceState.mjs",
    );

    runNodeScript(
      "scripts/governance/validateSessionSnapshot.mjs",
      [
        governanceState.session.latestSnapshot,
      ],
    );

    runNodeScript(
      "scripts/governance/verifyShadowGovernance.mjs",
    );

    console.log(
      "PASS: Shadow governance synchronized successfully.",
    );
  } catch (error) {
    console.error(
      "Synchronization failed. Restoring original shadow documents...",
    );

    for (const [filePath, original] of originals) {
      atomicWrite(filePath, original);
    }

    throw error;
  }
}

try {
  synchronizeShadowGovernance();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
